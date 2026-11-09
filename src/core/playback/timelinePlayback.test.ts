import { describe, it, expect } from 'vitest'
import { createEmptyProjectState, type ProjectState } from '../project/projectState'
import {
  getPlaybackFrameInfo,
  getNextTimelineCut,
  getPreviousTimelineCut,
} from './timelinePlayback'
import { splitTimelineItem, trimTimelineItem } from '../commands/projectCommands'

describe('Timeline Playback & Real Media Frame Mapping', () => {
  function setupTestTimeline(): ProjectState {
    let state = createEmptyProjectState({
      name: 'Playback Test',
      settings: { width: 1920, height: 1080, fps: 30 },
      initialTracks: [
        { id: 'track-v1', name: 'Video 1', type: 'video', visible: true, locked: false },
        { id: 'track-a1', name: 'Audio 1', type: 'audio', muted: false, locked: false },
      ],
    })

    // Assets:
    // Video A: duration 20s
    // Video B: duration 30s
    // Video C: duration 15s
    state = {
      ...state,
      assets: {
        'asset-a': {
          id: 'asset-a',
          name: 'clipA.mp4',
          type: 'video',
          path: 'C:\\Media\\clipA.mp4',
          duration: 20,
        },
        'asset-b': {
          id: 'asset-b',
          name: 'clipB.mp4',
          type: 'video',
          path: 'C:\\Media\\clipB.mp4',
          duration: 30,
        },
        'asset-c': {
          id: 'asset-c',
          name: 'clipC.mp4',
          type: 'video',
          path: 'C:\\Media\\clipC.mp4',
          duration: 15,
        },
      },
      items: {
        // Clip A: timeline 0 -> 10, sourceIn: 0, sourceOut: 10
        'item-a': {
          id: 'item-a',
          trackId: 'track-v1',
          assetId: 'asset-a',
          startTime: 0,
          duration: 10,
          sourceIn: 0,
          sourceOut: 10,
          transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
        },
        // Clip B: timeline 10 -> 25, sourceIn: 5, sourceOut: 20
        'item-b': {
          id: 'item-b',
          trackId: 'track-v1',
          assetId: 'asset-b',
          startTime: 10,
          duration: 15,
          sourceIn: 5,
          sourceOut: 20,
          transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
        },
        // Gap between 25 and 28
        // Clip C: timeline 28 -> 38, sourceIn: 2, sourceOut: 12
        'item-c': {
          id: 'item-c',
          trackId: 'track-v1',
          assetId: 'asset-c',
          startTime: 28,
          duration: 10,
          sourceIn: 2,
          sourceOut: 12,
          transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
        },
      },
    }

    return state
  }

  it('correctly maps playhead to Clip A source seconds 0 -> 10', () => {
    const state = setupTestTimeline()

    // At playhead 0.0s -> Clip A at source 0.0s
    const frame0 = getPlaybackFrameInfo(state, 0.0)
    expect(frame0.activeVideo?.item.id).toBe('item-a')
    expect(frame0.activeVideo?.sourceTime).toBeCloseTo(0.0)

    // At playhead 5.5s -> Clip A at source 5.5s
    const frame5 = getPlaybackFrameInfo(state, 5.5)
    expect(frame5.activeVideo?.item.id).toBe('item-a')
    expect(frame5.activeVideo?.sourceTime).toBeCloseTo(5.5)

    // At playhead 9.9s -> Clip A at source 9.9s
    const frame9 = getPlaybackFrameInfo(state, 9.9)
    expect(frame9.activeVideo?.item.id).toBe('item-a')
    expect(frame9.activeVideo?.sourceTime).toBeCloseTo(9.9)
  })

  it('seamlessly transitions to Clip B and respects sourceIn offset', () => {
    const state = setupTestTimeline()

    // At playhead 10.0s -> transitions to Clip B!
    // Clip B starts at timeline 10.0, but sourceIn is 5.0!
    const frame10 = getPlaybackFrameInfo(state, 10.0)
    expect(frame10.activeVideo?.item.id).toBe('item-b')
    expect(frame10.activeVideo?.sourceTime).toBeCloseTo(5.0)

    // At playhead 15.0s -> Clip B elapsed is 5.0s, so source time = 5.0 + 5.0 = 10.0s!
    const frame15 = getPlaybackFrameInfo(state, 15.0)
    expect(frame15.activeVideo?.item.id).toBe('item-b')
    expect(frame15.activeVideo?.sourceTime).toBeCloseTo(10.0)

    // At playhead 24.9s -> Clip B elapsed is 14.9s, source time = 5.0 + 14.9 = 19.9s!
    const frame24 = getPlaybackFrameInfo(state, 24.9)
    expect(frame24.activeVideo?.item.id).toBe('item-b')
    expect(frame24.activeVideo?.sourceTime).toBeCloseTo(19.9)
  })

  it('displays empty clean background during gap in timeline', () => {
    const state = setupTestTimeline()

    // Gap between 25.0 and 28.0 has no clips
    const frameGap = getPlaybackFrameInfo(state, 26.5)
    expect(frameGap.activeVideo).toBeNull()
    expect(frameGap.isEmpty).toBe(true)
  })

  it('correctly maps playhead after gap to Clip C', () => {
    const state = setupTestTimeline()

    // Clip C starts at 28.0 with sourceIn = 2.0
    const frame28 = getPlaybackFrameInfo(state, 28.0)
    expect(frame28.activeVideo?.item.id).toBe('item-c')
    expect(frame28.activeVideo?.sourceTime).toBeCloseTo(2.0)

    // At playhead 31.0 -> source = 2.0 + (31.0 - 28.0) = 5.0s
    const frame31 = getPlaybackFrameInfo(state, 31.0)
    expect(frame31.activeVideo?.sourceTime).toBeCloseTo(5.0)
  })

  it('reflects real trimming in playback source ranges', () => {
    let state = setupTestTimeline()

    // Trim left edge of Clip A by +2s (now starts at 2s with sourceIn = 2s)
    state = trimTimelineItem(state, 'item-a', {
      edge: 'left',
      newTime: 2,
    })

    // At playhead 1.0s -> Now empty! Clip A starts at 2s
    expect(getPlaybackFrameInfo(state, 1.0).activeVideo).toBeNull()

    // At playhead 2.0s -> Clip A starts at sourceIn = 2.0s
    const frame2 = getPlaybackFrameInfo(state, 2.0)
    expect(frame2.activeVideo?.item.id).toBe('item-a')
    expect(frame2.activeVideo?.sourceTime).toBeCloseTo(2.0)

    // Trim right edge of Clip B from 25s to 20s
    state = trimTimelineItem(state, 'item-b', {
      edge: 'right',
      newTime: 20,
    })

    // At playhead 22.0s -> Clip B ended at 20s, so this is now empty!
    expect(getPlaybackFrameInfo(state, 22.0).activeVideo).toBeNull()
  })

  it('reflects real splitting in playback source ranges across both split clips', () => {
    let state = setupTestTimeline()

    // Split Clip B (10 -> 25, sourceIn: 5, sourceOut: 20) at playhead 18.0s
    state = splitTimelineItem(state, 'item-b', 18.0, 'item-b1', 'item-b2')

    // Item B1: timeline 10 -> 18, duration 8, sourceIn: 5, sourceOut: 13
    // Item B2: timeline 18 -> 25, duration 7, sourceIn: 13, sourceOut: 20
    const b1 = state.items['item-b1']
    const b2 = state.items['item-b2']
    expect(b1).toBeDefined()
    expect(b2).toBeDefined()
    expect(b1.sourceIn).toBeCloseTo(5)
    expect(b1.sourceOut).toBeCloseTo(13)
    expect(b2.sourceIn).toBeCloseTo(13)
    expect(b2.sourceOut).toBeCloseTo(20)

    // Right before split at 17.9s -> item-b1 at source time 5 + 7.9 = 12.9s
    const frameBefore = getPlaybackFrameInfo(state, 17.9)
    expect(frameBefore.activeVideo?.item.id).toBe('item-b1')
    expect(frameBefore.activeVideo?.sourceTime).toBeCloseTo(12.9)

    // Right after split at 18.1s -> item-b2 at source time 13 + 0.1 = 13.1s
    const frameAfter = getPlaybackFrameInfo(state, 18.1)
    expect(frameAfter.activeVideo?.item.id).toBe('item-b2')
    expect(frameAfter.activeVideo?.sourceTime).toBeCloseTo(13.1)
  })

  it('prioritizes overlay track (higher video track) over base video track', () => {
    let state = setupTestTimeline()

    // Add Video 2 track
    state = {
      ...state,
      tracks: [
        { id: 'track-v1', name: 'Video 1', type: 'video', visible: true },
        { id: 'track-v2', name: 'Video 2', type: 'video', visible: true },
        { id: 'track-a1', name: 'Audio 1', type: 'audio', muted: false },
      ],
      items: {
        ...state.items,
        // Overlay clip on Video 2 at timeline 4 -> 8
        'item-overlay': {
          id: 'item-overlay',
          trackId: 'track-v2',
          assetId: 'asset-c',
          startTime: 4,
          duration: 4,
          sourceIn: 0,
          sourceOut: 4,
          transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
        },
      },
    }

    // At playhead 3.0s -> Base Video 1 (item-a)
    expect(getPlaybackFrameInfo(state, 3.0).activeVideo?.item.id).toBe('item-a')

    // At playhead 5.0s -> Video 2 overlay takes visual precedence!
    expect(getPlaybackFrameInfo(state, 5.0).activeVideo?.item.id).toBe('item-overlay')

    // At playhead 9.0s -> Back to Base Video 1 (item-a)
    expect(getPlaybackFrameInfo(state, 9.0).activeVideo?.item.id).toBe('item-a')
  })

  it('detects missing media assets during playback', () => {
    let state = setupTestTimeline()
    // Mark asset-a as missing
    state = {
      ...state,
      assets: {
        ...state.assets,
        'asset-a': {
          ...state.assets['asset-a'],
          isMissing: true,
        },
      },
    }

    const frame = getPlaybackFrameInfo(state, 3.0)
    expect(frame.activeVideo).toBeDefined()
    expect(frame.activeVideo?.isMissing).toBe(true)
  })

  it('computes next and previous edit cut positions accurately', () => {
    const state = setupTestTimeline()

    // Clips boundaries: 0, 10, 25, 28, 38
    expect(getNextTimelineCut(state, 0)).toBe(10)
    expect(getNextTimelineCut(state, 5)).toBe(10)
    expect(getNextTimelineCut(state, 10)).toBe(25)
    expect(getNextTimelineCut(state, 25)).toBe(28)
    expect(getNextTimelineCut(state, 30)).toBe(38)
    expect(getNextTimelineCut(state, 40)).toBeNull()

    expect(getPreviousTimelineCut(state, 35)).toBe(28)
    expect(getPreviousTimelineCut(state, 28)).toBe(25)
    expect(getPreviousTimelineCut(state, 15)).toBe(10)
    expect(getPreviousTimelineCut(state, 5)).toBe(0)
    expect(getPreviousTimelineCut(state, 0)).toBeNull()
  })

  it('correctly maps source time for speed modified clips (2x speed)', () => {
    let state = setupTestTimeline()
    // Set item-a to 2x speed: duration 5s (source 0 to 10s)
    state = {
      ...state,
      items: {
        ...state.items,
        'item-a': {
          ...state.items['item-a'],
          duration: 5,
          speed: { speed: 2, reversed: false },
        },
      },
    }

    // At playhead 0s -> source 0s
    expect(getPlaybackFrameInfo(state, 0.0).activeVideo?.sourceTime).toBeCloseTo(0.0)
    // At playhead 2.5s -> elapsed 2.5 * 2 = source 5.0s
    expect(getPlaybackFrameInfo(state, 2.5).activeVideo?.sourceTime).toBeCloseTo(5.0)
    // At playhead 4.9s -> elapsed 4.9 * 2 = source 9.8s
    expect(getPlaybackFrameInfo(state, 4.9).activeVideo?.sourceTime).toBeCloseTo(9.8)
  })

  it('correctly maps source time for reversed clips and allows unmuted audio playback', () => {
    let state = setupTestTimeline()
    // Set item-a to reversed at 1x speed: sourceOut 10 down to sourceIn 0 over 10s
    // Also add an audio clip on track-a1 with reversed: true
    state = {
      ...state,
      items: {
        ...state.items,
        'item-a': {
          ...state.items['item-a'],
          speed: { speed: 1, reversed: true },
        },
        'item-audio-rev': {
          id: 'item-audio-rev',
          trackId: 'track-a1',
          assetId: 'asset-a',
          startTime: 0,
          duration: 10,
          sourceIn: 0,
          sourceOut: 10,
          speed: { speed: 1, reversed: true },
          transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
        },
      },
    }

    // At playhead 0s -> source 10.0s (starting at end)
    const frame0 = getPlaybackFrameInfo(state, 0.0)
    expect(frame0.activeVideo?.sourceTime).toBeCloseTo(10.0)
    expect(frame0.activeAudio[0]?.sourceTime).toBeCloseTo(10.0)
    expect(frame0.activeAudio[0]?.isMuted).toBe(false)

    // At playhead 3s -> source 10.0 - 3.0 = 7.0s
    const frame3 = getPlaybackFrameInfo(state, 3.0)
    expect(frame3.activeVideo?.sourceTime).toBeCloseTo(7.0)
    expect(frame3.activeAudio[0]?.sourceTime).toBeCloseTo(7.0)

    // At playhead 9.9s -> source 0.1s
    expect(getPlaybackFrameInfo(state, 9.9).activeVideo?.sourceTime).toBeCloseTo(0.1)
  })
})
