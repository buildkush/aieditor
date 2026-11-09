import { describe, it, expect } from 'vitest'
import {
  createEmptyProjectState,
  DEFAULT_TRANSFORM,
  validateTimelineItem,
  type TimelineItem,
} from '../index'

describe('validateTimelineItem', () => {
  const state = createEmptyProjectState({
    initialTracks: [
      { id: 'track-v1', name: 'Video 1', type: 'video', visible: true, locked: false },
      { id: 'track-a1', name: 'Audio 1', type: 'audio', muted: false, locked: false },
    ],
  })

  it('returns no errors for a valid item', () => {
    const item: TimelineItem = {
      id: 'item-1',
      trackId: 'track-v1',
      assetId: 'asset-1',
      startTime: 0,
      duration: 5,
      sourceIn: 0,
      sourceOut: 5,
      transform: DEFAULT_TRANSFORM,
    }
    expect(validateTimelineItem(item, state)).toEqual([])
  })

  it('rejects negative startTime', () => {
    const item: TimelineItem = {
      id: 'item-1',
      trackId: 'track-v1',
      assetId: 'asset-1',
      startTime: -1,
      duration: 5,
      sourceIn: 0,
      sourceOut: 5,
      transform: DEFAULT_TRANSFORM,
    }
    const errors = validateTimelineItem(item, state)
    expect(errors).toContain('startTime cannot be negative')
  })

  it('rejects zero or negative duration', () => {
    const item: TimelineItem = {
      id: 'item-1',
      trackId: 'track-v1',
      assetId: 'asset-1',
      startTime: 0,
      duration: 0,
      sourceIn: 0,
      sourceOut: 5,
      transform: DEFAULT_TRANSFORM,
    }
    expect(validateTimelineItem(item, state)).toContain('duration must be positive')
  })

  it('rejects negative sourceIn', () => {
    const item: TimelineItem = {
      id: 'item-1',
      trackId: 'track-v1',
      assetId: 'asset-1',
      startTime: 0,
      duration: 5,
      sourceIn: -1,
      sourceOut: 5,
      transform: DEFAULT_TRANSFORM,
    }
    expect(validateTimelineItem(item, state)).toContain('sourceIn cannot be negative')
  })

  it('rejects sourceOut <= sourceIn', () => {
    const item: TimelineItem = {
      id: 'item-1',
      trackId: 'track-v1',
      assetId: 'asset-1',
      startTime: 0,
      duration: 5,
      sourceIn: 5,
      sourceOut: 5,
      transform: DEFAULT_TRANSFORM,
    }
    expect(validateTimelineItem(item, state)).toContain('sourceOut must be greater than sourceIn')
  })

  it('rejects item referencing nonexistent track', () => {
    const item: TimelineItem = {
      id: 'item-1',
      trackId: 'track-nonexistent',
      assetId: 'asset-1',
      startTime: 0,
      duration: 5,
      sourceIn: 0,
      sourceOut: 5,
      transform: DEFAULT_TRANSFORM,
    }
    const errors = validateTimelineItem(item, state)
    expect(errors.some((e) => e.includes('track-nonexistent'))).toBe(true)
  })

  it('reports multiple errors simultaneously', () => {
    const item: TimelineItem = {
      id: 'item-1',
      trackId: 'bad-track',
      assetId: 'asset-1',
      startTime: -5,
      duration: -2,
      sourceIn: -1,
      sourceOut: -3,
      transform: DEFAULT_TRANSFORM,
    }
    const errors = validateTimelineItem(item, state)
    expect(errors.length).toBeGreaterThanOrEqual(4)
  })
})
