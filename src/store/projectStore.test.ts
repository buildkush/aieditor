import { describe, it, expect, vi } from 'vitest'
import { ProjectStore } from './projectStore'
import { createEmptyProjectState } from '../core/project/projectState'
import { SetPlayheadCommand, AddTrackCommand } from '../core/commands/editorCommand'

describe('ProjectStore', () => {
  it('initializes with current state', () => {
    const initial = createEmptyProjectState({ name: 'Initial Project' })
    const store = new ProjectStore(initial)
    expect(store.getState().name).toBe('Initial Project')
    expect(store.canUndo()).toBe(false)
    expect(store.canRedo()).toBe(false)
  })

  it('notifies subscribers when command is dispatched and does not add playhead to undo stack', () => {
    const initial = createEmptyProjectState()
    const store = new ProjectStore(initial)
    const listener = vi.fn()

    const unsubscribe = store.subscribe(listener)
    store.dispatch(new SetPlayheadCommand(4.5))

    expect(listener).toHaveBeenCalledTimes(1)
    expect(store.getState().playheadTime).toBe(4.5)
    // Non-undoable commands do not create undo history
    expect(store.canUndo()).toBe(false)

    unsubscribe()
    store.dispatch(new SetPlayheadCommand(10))
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('supports undo and redo with notifications for editing commands', () => {
    const initial = createEmptyProjectState()
    const store = new ProjectStore(initial)
    const listener = vi.fn()

    store.subscribe(listener)
    store.dispatch(
      new AddTrackCommand({
        id: 'track-v2',
        name: 'Video 2',
        type: 'video',
        visible: true,
        locked: false,
      })
    )
    expect(store.getState().tracks.some((t) => t.id === 'track-v2')).toBe(true)
    expect(store.canUndo()).toBe(true)

    // Move playhead (transient)
    store.dispatch(new SetPlayheadCommand(7.5))
    expect(store.getState().playheadTime).toBe(7.5)

    // Undo track creation
    const undone = store.undo()
    expect(undone?.tracks.some((t) => t.id === 'track-v2')).toBe(false)
    // Playhead is preserved across undo!
    expect(undone?.playheadTime).toBe(7.5)
    expect(store.canRedo()).toBe(true)

    // Redo track creation
    const redone = store.redo()
    expect(redone?.tracks.some((t) => t.id === 'track-v2')).toBe(true)
    expect(redone?.playheadTime).toBe(7.5)
    expect(store.canRedo()).toBe(false)
  })

  it('resets state and clears history', () => {
    const initial = createEmptyProjectState({ name: 'Old' })
    const store = new ProjectStore(initial)
    store.dispatch(
      new AddTrackCommand({
        id: 'track-v2',
        name: 'Video 2',
        type: 'video',
        visible: true,
        locked: false,
      })
    )
    expect(store.canUndo()).toBe(true)

    const fresh = createEmptyProjectState({ name: 'New' })
    store.reset(fresh)
    expect(store.getState().name).toBe('New')
    expect(store.canUndo()).toBe(false)
    expect(store.canRedo()).toBe(false)
  })
})
