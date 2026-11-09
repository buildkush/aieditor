import { describe, it, expect, beforeEach } from 'vitest'
import {
  createEmptyProjectState,
  CommandHistory,
  AddMediaAssetCommand,
  RemoveMediaAssetCommand,
  AddTrackCommand,
  RemoveTrackCommand,
  AddTimelineItemCommand,
  RemoveTimelineItemCommand,
  UpdateTimelineItemCommand,
  MoveTimelineItemCommand,
  TrimTimelineItemCommand,
  SetPlayheadCommand,
  SelectItemCommand,
  UpdateTransformCommand,
  DEFAULT_TRANSFORM,
  type ProjectState,
  type MediaAsset,
  type TimelineItem,
  type Track,
} from '../index'

describe('Editor Command & History System', () => {
  let initialState: ProjectState
  let history: CommandHistory

  const testAsset: MediaAsset = {
    id: 'asset-video-1',
    name: 'sample.mp4',
    type: 'video',
    path: '/media/sample.mp4',
    duration: 30,
  }

  const testTrack: Track = {
    id: 'track-v2',
    name: 'Video 2',
    type: 'video',
    visible: true,
    locked: false,
  }

  const testItem: TimelineItem = {
    id: 'item-1',
    trackId: 'track-v1',
    assetId: 'asset-video-1',
    startTime: 2,
    duration: 8,
    sourceIn: 0,
    sourceOut: 8,
    transform: DEFAULT_TRANSFORM,
  }

  beforeEach(() => {
    initialState = createEmptyProjectState({ id: 'proj-1', name: 'Aiditor Test' })
    history = new CommandHistory(initialState)
  })

  it('verifies initial state and canUndo/canRedo states', () => {
    expect(history.getCurrentState()).toEqual(initialState)
    expect(history.canUndo()).toBe(false)
    expect(history.canRedo()).toBe(false)
    expect(history.undo()).toBeNull()
    expect(history.redo()).toBeNull()
  })

  it('executes a single command and advances state', () => {
    const cmd = new AddMediaAssetCommand(testAsset)
    const nextState = history.execute(cmd)

    expect(nextState.assets[testAsset.id]).toEqual(testAsset)
    expect(history.getCurrentState().assets[testAsset.id]).toEqual(testAsset)
    expect(history.canUndo()).toBe(true)
    expect(history.canRedo()).toBe(false)
  })

  it('executes multiple commands sequentially', () => {
    history.execute(new AddMediaAssetCommand(testAsset))
    history.execute(new AddTrackCommand(testTrack))
    history.execute(new AddTimelineItemCommand(testItem))

    const state = history.getCurrentState()
    expect(state.assets[testAsset.id]).toBeDefined()
    expect(state.tracks.some((t) => t.id === testTrack.id)).toBe(true)
    expect(state.items[testItem.id]).toBeDefined()
    expect(history.canUndo()).toBe(true)
    expect(history.canRedo()).toBe(false)
    expect(history.undoCount).toBe(3)
  })

  it('supports undo restoring exact previous state', () => {
    const cmd = new AddMediaAssetCommand(testAsset)
    history.execute(cmd)

    expect(history.getCurrentState().assets[testAsset.id]).toBeDefined()

    const undoneState = history.undo()
    expect(undoneState).toEqual(initialState)
    expect(history.getCurrentState()).toEqual(initialState)
    expect(history.getCurrentState().assets[testAsset.id]).toBeUndefined()
    expect(history.canUndo()).toBe(false)
    expect(history.canRedo()).toBe(true)
  })

  it('supports redo restoring state produced by undone command', () => {
    const cmd = new AddMediaAssetCommand(testAsset)
    history.execute(cmd)
    const stateAfterExec = history.getCurrentState()

    history.undo()
    expect(history.getCurrentState()).toEqual(initialState)

    const redoneState = history.redo()
    expect(redoneState).toEqual(stateAfterExec)
    expect(history.getCurrentState().assets[testAsset.id]).toEqual(testAsset)
    expect(history.canUndo()).toBe(true)
    expect(history.canRedo()).toBe(false)
  })

  it('clears redo stack when executing a new command after undo', () => {
    history.execute(new AddMediaAssetCommand(testAsset))
    history.execute(new AddTrackCommand(testTrack))

    // Undo track addition
    history.undo()
    expect(history.canRedo()).toBe(true)

    // Execute alternative command
    const newTrack: Track = { id: 'track-v3', name: 'Video 3', type: 'video' }
    history.execute(new AddTrackCommand(newTrack))

    // Redo stack must be cleared
    expect(history.canRedo()).toBe(false)
    expect(history.redo()).toBeNull()
    expect(history.getCurrentState().tracks.some((t) => t.id === 'track-v3')).toBe(true)
    expect(history.getCurrentState().tracks.some((t) => t.id === 'track-v2')).toBe(false)
  })

  it('supports multiple undo operations all the way back to initial state', () => {
    history.execute(new AddMediaAssetCommand(testAsset))
    history.execute(new AddTrackCommand(testTrack))
    history.execute(new AddTimelineItemCommand(testItem))

    expect(history.undoCount).toBe(3)

    // Undo 1: item removed
    history.undo()
    expect(history.getCurrentState().items[testItem.id]).toBeUndefined()
    expect(history.getCurrentState().tracks.some((t) => t.id === testTrack.id)).toBe(true)

    // Undo 2: track removed
    history.undo()
    expect(history.getCurrentState().tracks.some((t) => t.id === testTrack.id)).toBe(false)
    expect(history.getCurrentState().assets[testAsset.id]).toBeDefined()

    // Undo 3: asset removed -> back to initial state
    history.undo()
    expect(history.getCurrentState()).toEqual(initialState)
    expect(history.canUndo()).toBe(false)
    expect(history.canRedo()).toBe(true)
  })

  it('supports multiple redo operations back to the latest state', () => {
    history.execute(new AddMediaAssetCommand(testAsset))
    history.execute(new AddTrackCommand(testTrack))
    history.execute(new AddTimelineItemCommand(testItem))

    const finalState = history.getCurrentState()

    // Undo all 3
    history.undo()
    history.undo()
    history.undo()

    expect(history.getCurrentState()).toEqual(initialState)

    // Redo all 3
    history.redo()
    expect(history.getCurrentState().assets[testAsset.id]).toBeDefined()

    history.redo()
    expect(history.getCurrentState().tracks.some((t) => t.id === testTrack.id)).toBe(true)

    history.redo()
    expect(history.getCurrentState()).toEqual(finalState)
    expect(history.canRedo()).toBe(false)
  })

  it('handles timeline item modification followed by undo and redo', () => {
    history.execute(new AddMediaAssetCommand(testAsset))
    history.execute(new AddTimelineItemCommand(testItem))

    // Update transform
    history.execute(
      new UpdateTimelineItemCommand(testItem.id, {
        transform: {
          x: 100,
          y: 50,
          scale: 1.5,
          rotation: 90,
          opacity: 0.8,
        },
      })
    )

    expect(history.getCurrentState().items[testItem.id].transform).toEqual({
      x: 100,
      y: 50,
      scale: 1.5,
      rotation: 90,
      opacity: 0.8,
    })

    // Move timeline item
    history.execute(new MoveTimelineItemCommand(testItem.id, 10.5))
    expect(history.getCurrentState().items[testItem.id].startTime).toBe(10.5)

    // Trim timeline item
    history.execute(
      new TrimTimelineItemCommand(testItem.id, {
        sourceIn: 2,
        sourceOut: 7,
        duration: 5,
      })
    )
    expect(history.getCurrentState().items[testItem.id].sourceIn).toBe(2)
    expect(history.getCurrentState().items[testItem.id].sourceOut).toBe(7)
    expect(history.getCurrentState().items[testItem.id].duration).toBe(5)

    // Undo trim
    history.undo()
    expect(history.getCurrentState().items[testItem.id].sourceIn).toBe(0)
    expect(history.getCurrentState().items[testItem.id].duration).toBe(8)
    expect(history.getCurrentState().items[testItem.id].startTime).toBe(10.5)

    // Undo move
    history.undo()
    expect(history.getCurrentState().items[testItem.id].startTime).toBe(2)

    // Undo update transform
    history.undo()
    expect(history.getCurrentState().items[testItem.id].transform).toEqual(DEFAULT_TRANSFORM)

    // Redo all three
    history.redo()
    expect(history.getCurrentState().items[testItem.id].transform.x).toBe(100)
    history.redo()
    expect(history.getCurrentState().items[testItem.id].startTime).toBe(10.5)
    history.redo()
    expect(history.getCurrentState().items[testItem.id].duration).toBe(5)
  })

  it('ensures playhead movement does not pollute undo history and preserves playhead on undo/redo', () => {
    expect(history.getCurrentState().playheadTime).toBe(0)

    // Moving playhead does not add to undo stack
    history.execute(new SetPlayheadCommand(5.25))
    expect(history.getCurrentState().playheadTime).toBe(5.25)
    expect(history.canUndo()).toBe(false)
    expect(history.undoCount).toBe(0)

    // Perform an actual edit
    history.execute(new AddTimelineItemCommand(testItem))
    expect(history.canUndo()).toBe(true)
    expect(history.undoCount).toBe(1)

    // Move playhead after edit
    history.execute(new SetPlayheadCommand(12.0))
    expect(history.getCurrentState().playheadTime).toBe(12.0)
    expect(history.undoCount).toBe(1) // Still 1!

    // Undo edit: restores state (item removed) but preserves current playhead at 12.0
    history.undo()
    expect(history.getCurrentState().items[testItem.id]).toBeUndefined()
    expect(history.getCurrentState().playheadTime).toBe(12.0)
    expect(history.canRedo()).toBe(true)

    // Scrubbing does not blow away the redo stack!
    history.execute(new SetPlayheadCommand(15.0))
    expect(history.canRedo()).toBe(true)
    expect(history.getCurrentState().playheadTime).toBe(15.0)

    // Redo restores item and retains current playhead at 15.0
    history.redo()
    expect(history.getCurrentState().items[testItem.id]).toBeDefined()
    expect(history.getCurrentState().playheadTime).toBe(15.0)
  })

  it('handles item selection changes with undo and redo', () => {
    history.execute(new AddTimelineItemCommand(testItem))
    expect(history.getCurrentState().selectedItemId).toBeNull()

    history.execute(new SelectItemCommand(testItem.id))
    expect(history.getCurrentState().selectedItemId).toBe(testItem.id)

    history.execute(new SelectItemCommand(null))
    expect(history.getCurrentState().selectedItemId).toBeNull()

    history.undo()
    expect(history.getCurrentState().selectedItemId).toBe(testItem.id)

    history.undo()
    expect(history.getCurrentState().selectedItemId).toBeNull()

    history.redo()
    expect(history.getCurrentState().selectedItemId).toBe(testItem.id)
  })

  it('handles item and track removal commands with undo and redo', () => {
    history.execute(new AddTrackCommand(testTrack))
    history.execute(new AddTimelineItemCommand(testItem))

    // Remove timeline item
    history.execute(new RemoveTimelineItemCommand(testItem.id))
    expect(history.getCurrentState().items[testItem.id]).toBeUndefined()

    history.undo()
    expect(history.getCurrentState().items[testItem.id]).toBeDefined()

    // Remove track
    history.execute(new RemoveTrackCommand(testTrack.id))
    expect(history.getCurrentState().tracks.some((t) => t.id === testTrack.id)).toBe(false)

    history.undo()
    expect(history.getCurrentState().tracks.some((t) => t.id === testTrack.id)).toBe(true)
  })

  it('handles media asset removal with undo and redo', () => {
    history.execute(new AddMediaAssetCommand(testAsset))
    history.execute(new AddTimelineItemCommand(testItem))
    history.execute(new SelectItemCommand(testItem.id))

    // Remove asset
    history.execute(new RemoveMediaAssetCommand(testAsset.id))
    expect(history.getCurrentState().assets[testAsset.id]).toBeUndefined()
    expect(history.getCurrentState().items[testItem.id]).toBeUndefined()
    expect(history.getCurrentState().selectedItemId).toBeNull()

    // Undo restores asset, referencing item, and selection
    history.undo()
    expect(history.getCurrentState().assets[testAsset.id]).toBeDefined()
    expect(history.getCurrentState().items[testItem.id]).toBeDefined()
    expect(history.getCurrentState().selectedItemId).toBe(testItem.id)
  })

  it('clears history completely with clear()', () => {
    history.execute(new AddMediaAssetCommand(testAsset))
    history.execute(new AddTimelineItemCommand(testItem))

    expect(history.canUndo()).toBe(true)
    history.undo()
    expect(history.canRedo()).toBe(true)

    history.clear()
    expect(history.canUndo()).toBe(false)
    expect(history.canRedo()).toBe(false)
    expect(history.undoCount).toBe(0)
    expect(history.redoCount).toBe(0)

    // Current state is retained
    expect(history.getCurrentState().assets[testAsset.id]).toBeDefined()
  })

  it('merges continuous edits with the same mergeKey into a single undo step', () => {
    history.execute(new AddMediaAssetCommand(testAsset))
    history.execute(new AddTimelineItemCommand(testItem))

    const baselineUndoCount = history.undoCount

    // User types '1', '10', '100', '105' in Position X input
    history.execute(new UpdateTransformCommand(testItem.id, { x: 1 }, 'transform-x-test-item-1'))
    expect(history.getCurrentState().items[testItem.id].transform.x).toBe(1)
    expect(history.undoCount).toBe(baselineUndoCount + 1)

    history.execute(new UpdateTransformCommand(testItem.id, { x: 10 }, 'transform-x-test-item-1'))
    expect(history.getCurrentState().items[testItem.id].transform.x).toBe(10)
    // undoCount should NOT increase
    expect(history.undoCount).toBe(baselineUndoCount + 1)

    history.execute(new UpdateTransformCommand(testItem.id, { x: 100 }, 'transform-x-test-item-1'))
    expect(history.getCurrentState().items[testItem.id].transform.x).toBe(100)
    expect(history.undoCount).toBe(baselineUndoCount + 1)

    history.execute(new UpdateTransformCommand(testItem.id, { x: 105 }, 'transform-x-test-item-1'))
    expect(history.getCurrentState().items[testItem.id].transform.x).toBe(105)
    expect(history.undoCount).toBe(baselineUndoCount + 1)

    // User finishes editing X (blur/mouse up)
    history.clearMergeKey()

    // 1 Undo step should restore back to before editing Position X began (x: 0)
    history.undo()
    expect(history.getCurrentState().items[testItem.id].transform.x).toBe(0)
    expect(history.undoCount).toBe(baselineUndoCount)

    // Redo restores final value 105
    history.redo()
    expect(history.getCurrentState().items[testItem.id].transform.x).toBe(105)
  })
})
