import { describe, it, expect } from 'vitest'
import {
  createEmptyProjectState,
  AddAdjustmentLayerCommand,
  isTrackCompatible,
  type ProjectState,
  type Track,
} from '../index'

describe('Adjustment Layer System', () => {
  const trackV1: Track = { id: 'track-v1', name: 'Video 1', type: 'video' }

  it('marks adjustment layer compatible with video and graphics tracks', () => {
    expect(isTrackCompatible('video', 'adjustment')).toBe(true)
    expect(isTrackCompatible('graphics', 'adjustment')).toBe(true)
    expect(isTrackCompatible('audio', 'adjustment')).toBe(false)
    expect(isTrackCompatible('caption', 'adjustment')).toBe(false)
  })

  it('adds adjustment layer to video track and updates ProjectState deterministically', () => {
    const initialState: ProjectState = {
      ...createEmptyProjectState(),
      tracks: [trackV1],
    }

    const cmd = new AddAdjustmentLayerCommand({
      startTime: 2,
      duration: 6,
      trackId: 'track-v1',
    })

    const nextState = cmd.execute(initialState)
    const items = Object.values(nextState.items)
    expect(items.length).toBe(1)

    const adj = items[0]
    expect(adj.itemType).toBe('adjustment')
    expect(adj.trackId).toBe('track-v1')
    expect(adj.startTime).toBe(2)
    expect(adj.duration).toBe(6)
    expect(nextState.selectedItemId).toBe(adj.id)
  })

  it('automatically resolves a new video track if none exists', () => {
    const emptyState: ProjectState = createEmptyProjectState()
    const cmd = new AddAdjustmentLayerCommand({
      startTime: 0,
      duration: 5,
    })

    const nextState = cmd.execute(emptyState)
    const items = Object.values(nextState.items)
    expect(items.length).toBe(1)
    expect(items[0].itemType).toBe('adjustment')
    expect(nextState.tracks.some((t) => t.type === 'video')).toBe(true)
  })
})
