import { describe, it, expect, beforeEach } from 'vitest'
import {
  createEmptyProjectState,
  CommandHistory,
  AddMediaAssetCommand,
  AddTimelineItemCommand,
  SplitTimelineItemCommand,
  SelectItemCommand,
  DEFAULT_TRANSFORM,
  type ProjectState,
  type MediaAsset,
  type TimelineItem,
} from '../index'

describe('SplitTimelineItemCommand', () => {
  let state: ProjectState
  let history: CommandHistory

  const testAsset: MediaAsset = {
    id: 'asset-1',
    name: 'clip.mp4',
    type: 'video',
    path: '/media/clip.mp4',
    duration: 30,
  }

  const testItem: TimelineItem = {
    id: 'item-1',
    trackId: 'track-v1',
    assetId: 'asset-1',
    startTime: 5,
    duration: 10,
    sourceIn: 2,
    sourceOut: 12,
    transform: DEFAULT_TRANSFORM,
  }

  beforeEach(() => {
    state = createEmptyProjectState({ id: 'proj-split', name: 'Split Test' })
    history = new CommandHistory(state)
    history.execute(new AddMediaAssetCommand(testAsset))
    history.execute(new AddTimelineItemCommand(testItem))
  })

  it('splits an item at the midpoint', () => {
    const splitTime = 10 // midpoint of item at [5, 15)
    history.execute(new SplitTimelineItemCommand('item-1', splitTime, 'item-1-left', 'item-1-right'))

    const s = history.getCurrentState()

    // Original is gone
    expect(s.items['item-1']).toBeUndefined()

    // Two new items exist
    const left = s.items['item-1-left']
    const right = s.items['item-1-right']
    expect(left).toBeDefined()
    expect(right).toBeDefined()

    // Left half
    expect(left.startTime).toBe(5)
    expect(left.duration).toBe(5) // 10 - 5
    expect(left.sourceIn).toBe(2)
    expect(left.sourceOut).toBe(7) // 2 + 5 * (10/10) = 7
    expect(left.trackId).toBe('track-v1')
    expect(left.assetId).toBe('asset-1')

    // Right half
    expect(right.startTime).toBe(10)
    expect(right.duration).toBe(5) // 15 - 10
    expect(right.sourceIn).toBe(7)
    expect(right.sourceOut).toBe(12)
    expect(right.trackId).toBe('track-v1')
    expect(right.assetId).toBe('asset-1')
  })

  it('preserves transform on both halves', () => {
    const customTransform = { x: 10, y: 20, scale: 1.5, rotation: 45, opacity: 0.8 }
    const customItem: TimelineItem = {
      id: 'item-custom',
      trackId: 'track-v1',
      assetId: 'asset-1',
      startTime: 0,
      duration: 20,
      sourceIn: 0,
      sourceOut: 20,
      transform: customTransform,
    }
    history.execute(new AddTimelineItemCommand(customItem))
    history.execute(new SplitTimelineItemCommand('item-custom', 10, 'left', 'right'))

    const s = history.getCurrentState()
    expect(s.items['left'].transform).toEqual(customTransform)
    expect(s.items['right'].transform).toEqual(customTransform)
  })

  it('does nothing when splitTime is at or before startTime', () => {
    history.execute(new SplitTimelineItemCommand('item-1', 5, 'a', 'b'))
    const s = history.getCurrentState()
    expect(s.items['item-1']).toBeDefined()
    expect(s.items['a']).toBeUndefined()
  })

  it('does nothing when splitTime is at or after end time', () => {
    history.execute(new SplitTimelineItemCommand('item-1', 15, 'a', 'b'))
    const s = history.getCurrentState()
    expect(s.items['item-1']).toBeDefined()
    expect(s.items['a']).toBeUndefined()
  })

  it('does nothing for a non-existent item', () => {
    const stateBefore = history.getCurrentState()
    history.execute(new SplitTimelineItemCommand('nonexistent', 10, 'a', 'b'))
    expect(history.getCurrentState()).toEqual(stateBefore)
  })

  it('selects left half when the original was selected', () => {
    history.execute(new SelectItemCommand('item-1'))
    expect(history.getCurrentState().selectedItemId).toBe('item-1')

    history.execute(new SplitTimelineItemCommand('item-1', 10, 'left', 'right'))
    expect(history.getCurrentState().selectedItemId).toBe('left')
  })

  it('supports undo/redo of split', () => {
    history.execute(new SplitTimelineItemCommand('item-1', 10, 'left', 'right'))

    expect(history.getCurrentState().items['item-1']).toBeUndefined()
    expect(history.getCurrentState().items['left']).toBeDefined()
    expect(history.getCurrentState().items['right']).toBeDefined()

    // Undo restores the original item
    history.undo()
    expect(history.getCurrentState().items['item-1']).toBeDefined()
    expect(history.getCurrentState().items['left']).toBeUndefined()
    expect(history.getCurrentState().items['right']).toBeUndefined()

    // Redo re-applies the split
    history.redo()
    expect(history.getCurrentState().items['item-1']).toBeUndefined()
    expect(history.getCurrentState().items['left']).toBeDefined()
    expect(history.getCurrentState().items['right']).toBeDefined()
  })

  it('handles split at an asymmetric position', () => {
    // Item: startTime=5, duration=10, sourceIn=2, sourceOut=12
    // Split at time 8 => leftDuration=3, rightDuration=7
    history.execute(new SplitTimelineItemCommand('item-1', 8, 'L', 'R'))

    const s = history.getCurrentState()
    const left = s.items['L']
    const right = s.items['R']

    expect(left.startTime).toBe(5)
    expect(left.duration).toBe(3)
    expect(left.sourceIn).toBe(2)
    // sourceRatio = 10/10 = 1, leftSourceOut = 2 + 3*1 = 5
    expect(left.sourceOut).toBe(5)

    expect(right.startTime).toBe(8)
    expect(right.duration).toBe(7)
    expect(right.sourceIn).toBe(5)
    expect(right.sourceOut).toBe(12)

    // Durations sum to original
    expect(left.duration + right.duration).toBe(10)
  })

  it('matches exact specification example: 0->20s clip split at 8.5s into 0->8.5s and 8.5->20s', () => {
    const item20s: TimelineItem = {
      id: 'clip-exact',
      trackId: 'track-v1',
      assetId: 'asset-1',
      startTime: 0,
      duration: 20,
      sourceIn: 0,
      sourceOut: 20,
      transform: DEFAULT_TRANSFORM,
    }
    history.execute(new AddTimelineItemCommand(item20s))
    history.execute(new SplitTimelineItemCommand('clip-exact', 8.5, 'clip-A', 'clip-B'))

    const s = history.getCurrentState()
    expect(s.items['clip-exact']).toBeUndefined()

    const clipA = s.items['clip-A']
    const clipB = s.items['clip-B']
    expect(clipA).toBeDefined()
    expect(clipB).toBeDefined()

    expect(clipA.startTime).toBe(0)
    expect(clipA.duration).toBe(8.5)
    expect(clipA.sourceIn).toBe(0)
    expect(clipA.sourceOut).toBe(8.5)

    expect(clipB.startTime).toBe(8.5)
    expect(clipB.duration).toBe(11.5)
    expect(clipB.sourceIn).toBe(8.5)
    expect(clipB.sourceOut).toBe(20)
  })

  it('supports multiple successive razor cuts on the same timeline item', () => {
    // Cut 1: at 8.0s -> splits item-1 [5, 15) into [5, 8) and [8, 15)
    history.execute(new SplitTimelineItemCommand('item-1', 8.0, 'cut-1-left', 'cut-1-right'))
    let s = history.getCurrentState()
    expect(s.items['cut-1-left'].startTime).toBe(5)
    expect(s.items['cut-1-left'].duration).toBe(3)
    expect(s.items['cut-1-right'].startTime).toBe(8)
    expect(s.items['cut-1-right'].duration).toBe(7)

    // Cut 2: at 11.0s on the right segment [8, 15) -> splits into [8, 11) and [11, 15)
    history.execute(new SplitTimelineItemCommand('cut-1-right', 11.0, 'cut-2-mid', 'cut-2-right'))
    s = history.getCurrentState()
    expect(s.items['cut-1-right']).toBeUndefined()
    expect(s.items['cut-2-mid'].startTime).toBe(8)
    expect(s.items['cut-2-mid'].duration).toBe(3)
    expect(s.items['cut-2-right'].startTime).toBe(11)
    expect(s.items['cut-2-right'].duration).toBe(4)

    // All 3 resulting segments exist and are valid
    expect(s.items['cut-1-left']).toBeDefined()
    expect(s.items['cut-2-mid']).toBeDefined()
    expect(s.items['cut-2-right']).toBeDefined()
  })
})
