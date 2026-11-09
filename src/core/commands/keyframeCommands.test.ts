import { describe, it, expect } from 'vitest'
import { createEmptyProjectState } from '../project/projectState'
import { CommandHistory } from './commandHistory'
import {
  AddKeyframeCommand,
  RemoveKeyframeCommand,
  SetKeyframeValueCommand,
  ToggleKeyframeAtPlayheadCommand,
  MoveKeyframeCommand,
  SetKeyframeInterpolationCommand,
  MoveTimelineItemCommand,
  SplitTimelineItemCommand,
} from './editorCommand'
import type { TimelineItem, Track } from '../timeline/types'
import { DEFAULT_TRANSFORM, DEFAULT_CROP } from '../timeline/types'
import { evaluateItemProperty } from '../timeline/keyframeEvaluation'

describe('Keyframe Command System', () => {
  const trackV1: Track = { id: 'track-v1', name: 'Video 1', type: 'video', visible: true, locked: false }
  const item1: TimelineItem = {
    id: 'item-1',
    trackId: 'track-v1',
    assetId: 'asset-1',
    startTime: 0,
    duration: 10,
    sourceIn: 0,
    sourceOut: 10,
    transform: { ...DEFAULT_TRANSFORM, x: 0, y: 0, scale: 1 },
    crop: { ...DEFAULT_CROP },
  }

  function createHistoryWithItem() {
    const state = {
      ...createEmptyProjectState(),
      tracks: [trackV1],
      items: { 'item-1': item1 },
      selectedItemId: 'item-1',
      playheadTime: 0,
    }
    return new CommandHistory(state)
  }

  it('AddKeyframeCommand adds keyframe and prevents duplicates at same timestamp', () => {
    const history = createHistoryWithItem()

    // Add keyframe at t=2
    let state = history.execute(new AddKeyframeCommand('item-1', 'x', 2, 150))
    let kfs = state.items['item-1'].keyframes?.['x']
    expect(kfs).toHaveLength(1)
    expect(kfs?.[0].time).toBe(2)
    expect(kfs?.[0].value).toBe(150)

    // Add another keyframe at same timestamp t=2 with new value 250 -> updates existing keyframe, no duplicate
    state = history.execute(new AddKeyframeCommand('item-1', 'x', 2, 250))
    kfs = state.items['item-1'].keyframes?.['x']
    expect(kfs).toHaveLength(1)
    expect(kfs?.[0].value).toBe(250)

    // Add keyframe at t=5
    state = history.execute(new AddKeyframeCommand('item-1', 'x', 5, 500))
    kfs = state.items['item-1'].keyframes?.['x']
    expect(kfs).toHaveLength(2)
    expect(kfs?.[0].time).toBe(2)
    expect(kfs?.[1].time).toBe(5)

    // Undo removes the second keyframe
    state = history.undo()!
    kfs = state.items['item-1'].keyframes?.['x']
    expect(kfs).toHaveLength(1)
    expect(kfs?.[0].value).toBe(250)

    // Redo restores it
    state = history.redo()!
    kfs = state.items['item-1'].keyframes?.['x']
    expect(kfs).toHaveLength(2)
  })

  it('RemoveKeyframeCommand removes keyframe by id or timestamp', () => {
    const history = createHistoryWithItem()

    history.execute(new AddKeyframeCommand('item-1', 'x', 2, 100))
    history.execute(new AddKeyframeCommand('item-1', 'x', 6, 600))

    // Remove by timestamp
    let state = history.execute(new RemoveKeyframeCommand('item-1', 'x', 2))
    let kfs = state.items['item-1'].keyframes?.['x']
    expect(kfs).toHaveLength(1)
    expect(kfs?.[0].time).toBe(6)

    // Undo restores the removed keyframe
    state = history.undo()!
    kfs = state.items['item-1'].keyframes?.['x']
    expect(kfs).toHaveLength(2)
  })

  it('ToggleKeyframeAtPlayheadCommand adds if none, removes if exists', () => {
    const history = createHistoryWithItem()

    // At t=3, no keyframe exists -> creates one with evaluated value
    let state = history.execute(new ToggleKeyframeAtPlayheadCommand('item-1', 'scale', 3))
    let kfs = state.items['item-1'].keyframes?.['scale']
    expect(kfs).toHaveLength(1)
    expect(kfs?.[0].time).toBe(3)
    expect(kfs?.[0].value).toBe(1) // default scale

    // Click again at t=3 -> removes it
    state = history.execute(new ToggleKeyframeAtPlayheadCommand('item-1', 'scale', 3))
    kfs = state.items['item-1'].keyframes?.['scale']
    expect(kfs).toBeUndefined()

    // Undo brings it back
    state = history.undo()!
    kfs = state.items['item-1'].keyframes?.['scale']
    expect(kfs).toHaveLength(1)
  })

  it('MoveKeyframeCommand changes timestamp and keeps track sorted', () => {
    const history = createHistoryWithItem()

    history.execute(new AddKeyframeCommand('item-1', 'rotation', 2, 20))
    history.execute(new AddKeyframeCommand('item-1', 'rotation', 8, 80))
    const kfId = history.getCurrentState().items['item-1'].keyframes?.['rotation']?.[0].id!

    // Move first keyframe from 2 to 9 (after 8)
    let state = history.execute(new MoveKeyframeCommand('item-1', 'rotation', kfId, 9))
    const kfs = state.items['item-1'].keyframes?.['rotation']!
    expect(kfs).toHaveLength(2)
    expect(kfs[0].time).toBe(8)
    expect(kfs[1].time).toBe(9)
    expect(kfs[1].value).toBe(20)

    // Undo restores original time
    state = history.undo()!
    const restoredKfs = state.items['item-1'].keyframes?.['rotation']!
    expect(restoredKfs[0].time).toBe(2)
    expect(restoredKfs[1].time).toBe(8)
  })

  it('SetKeyframeInterpolationCommand updates interpolation mode', () => {
    const history = createHistoryWithItem()

    history.execute(new AddKeyframeCommand('item-1', 'x', 2, 100, 'linear'))
    const kfId = history.getCurrentState().items['item-1'].keyframes?.['x']?.[0].id!

    let state = history.execute(new SetKeyframeInterpolationCommand('item-1', 'x', kfId, 'ease-in-out'))
    expect(state.items['item-1'].keyframes?.['x']?.[0].interpolation).toBe('ease-in-out')

    state = history.undo()!
    expect(state.items['item-1'].keyframes?.['x']?.[0].interpolation).toBe('linear')
  })

  it('SetKeyframeValueCommand consolidates continuous edits into ONE undo step via mergeKey', () => {
    const history = createHistoryWithItem()

    // Enable keyframing on x
    history.execute(new AddKeyframeCommand('item-1', 'x', 0, 0))

    // Simulate user dragging/scrubbing Position X at t=5 through multiple intermediate values
    const mergeKey = 'kf-drag-pos-x-test'
    history.execute(new SetKeyframeValueCommand('item-1', 'x', 5, 50, mergeKey))
    history.execute(new SetKeyframeValueCommand('item-1', 'x', 5, 120, mergeKey))
    history.execute(new SetKeyframeValueCommand('item-1', 'x', 5, 230, mergeKey))
    let state = history.execute(new SetKeyframeValueCommand('item-1', 'x', 5, 500, mergeKey))

    // Evaluated value at 5 is 500
    expect(evaluateItemProperty(state.items['item-1'], 'x', 5)).toBe(500)

    // Exactly ONE undo restores the state prior to the drag gesture
    state = history.undo()!
    // Keyframe at 5 should not exist, or value should be before the drag started
    const kfs = state.items['item-1'].keyframes?.['x']
    expect(kfs?.find((k) => k.time === 5)).toBeUndefined()
    expect(kfs).toHaveLength(1)
    expect(kfs?.[0].time).toBe(0)
  })

  it('MoveTimelineItemCommand shifts all keyframe timestamps by timeDelta', () => {
    const history = createHistoryWithItem()

    history.execute(new AddKeyframeCommand('item-1', 'x', 2, 100))
    history.execute(new AddKeyframeCommand('item-1', 'x', 6, 500))

    // Move item from startTime 0 to startTime 4 (timeDelta = +4)
    let state = history.execute(new MoveTimelineItemCommand('item-1', 4, 'track-v1'))

    const movedKfs = state.items['item-1'].keyframes?.['x']
    expect(movedKfs).toHaveLength(2)
    expect(movedKfs?.[0].time).toBe(6) // 2 + 4
    expect(movedKfs?.[1].time).toBe(10) // 6 + 4

    // Undo restores original keyframe timestamps
    state = history.undo()!
    const revertedKfs = state.items['item-1'].keyframes?.['x']
    expect(revertedKfs?.[0].time).toBe(2)
    expect(revertedKfs?.[1].time).toBe(6)
  })

  it('SplitTimelineItemCommand correctly partitions keyframes across left and right clips', () => {
    const history = createHistoryWithItem()

    // Add keyframes at 1s, 4s, and 8s
    history.execute(new AddKeyframeCommand('item-1', 'x', 1, 100))
    history.execute(new AddKeyframeCommand('item-1', 'x', 4, 400))
    history.execute(new AddKeyframeCommand('item-1', 'x', 8, 800))

    // Split at t=5s
    let state = history.execute(new SplitTimelineItemCommand('item-1', 5, 'left-item', 'right-item'))

    // Should now have left-item (0 to 5) and right-item (5 to 10)
    const leftItem = state.items['left-item']
    const rightItem = state.items['right-item']

    expect(leftItem).toBeDefined()
    expect(rightItem).toBeDefined()

    // Left item contains keyframes <= 5 (at 1s, 4s, plus interpolated split point at 5s)
    const leftKfs = leftItem.keyframes?.['x']!
    expect(leftKfs.some((k) => k.time === 1 && k.value === 100)).toBe(true)
    expect(leftKfs.some((k) => k.time === 4 && k.value === 400)).toBe(true)
    expect(leftKfs.some((k) => k.time === 5)).toBe(true)

    // Right item contains keyframes >= 5 (split point at 5s, and 8s)
    const rightKfs = rightItem.keyframes?.['x']!
    expect(rightKfs.some((k) => k.time === 5)).toBe(true)
    expect(rightKfs.some((k) => k.time === 8 && k.value === 800)).toBe(true)
  })
})
