import { describe, it, expect } from 'vitest'
import {
  createEmptyProjectState,
  DEFAULT_TRANSFORM,
  isTrackCompatible,
  validateTimelineItem,
  addTimelineItem,
  moveTimelineItem,
  type TimelineItem,
  type MediaAsset,
  type Track,
} from '../index'

describe('Track Compatibility Architecture', () => {
  const videoAsset: MediaAsset = {
    id: 'asset-v1',
    name: 'Video.mp4',
    type: 'video',
    path: '/video.mp4',
    duration: 10,
  }

  const audioAsset: MediaAsset = {
    id: 'asset-a1',
    name: 'Audio.mp3',
    type: 'audio',
    path: '/audio.mp3',
    duration: 10,
  }

  const captionAsset: MediaAsset = {
    id: 'asset-c1',
    name: 'Captions.srt',
    type: 'caption' as any,
    path: '/captions.srt',
    duration: 10,
  }

  const graphicsAsset: MediaAsset = {
    id: 'asset-g1',
    name: 'Overlay.png',
    type: 'graphics' as any,
    path: '/overlay.png',
    duration: 10,
  }

  function setupState() {
    let state = createEmptyProjectState({
      initialTracks: [
        { id: 'track-v1', name: 'Video 1', type: 'video', visible: true, locked: false },
        { id: 'track-a1', name: 'Audio 1', type: 'audio', muted: false, locked: false },
      ],
    })
    const captionTrack: Track = {
      id: 'track-c1',
      name: 'Caption 1',
      type: 'caption',
      visible: true,
      locked: false,
    }
    const graphicsTrack: Track = {
      id: 'track-g1',
      name: 'Graphics 1',
      type: 'graphics',
      visible: true,
      locked: false,
    }
    state = {
      ...state,
      tracks: [...state.tracks, captionTrack, graphicsTrack],
      assets: {
        [videoAsset.id]: videoAsset,
        [audioAsset.id]: audioAsset,
        [captionAsset.id]: captionAsset,
        [graphicsAsset.id]: graphicsAsset,
      },
    }
    return state
  }

  describe('isTrackCompatible helper', () => {
    it('allows video asset on video track', () => {
      expect(isTrackCompatible('video', 'video')).toBe(true)
      expect(isTrackCompatible('video', 'image')).toBe(true)
    })

    it('allows audio asset on audio track', () => {
      expect(isTrackCompatible('audio', 'audio')).toBe(true)
    })

    it('forbids video asset on audio track and vice versa', () => {
      expect(isTrackCompatible('audio', 'video')).toBe(false)
      expect(isTrackCompatible('video', 'audio')).toBe(false)
    })

    it('supports extensible track types: caption and graphics', () => {
      expect(isTrackCompatible('caption', 'caption')).toBe(true)
      expect(isTrackCompatible('caption', 'video')).toBe(false)
      expect(isTrackCompatible('graphics', 'graphics')).toBe(true)
      expect(isTrackCompatible('graphics', 'audio')).toBe(false)
    })
  })

  describe('validateTimelineItem', () => {
    it('passes for compatible video item on video track', () => {
      const state = setupState()
      const item: TimelineItem = {
        id: 'item-1',
        trackId: 'track-v1',
        assetId: videoAsset.id,
        startTime: 0,
        duration: 5,
        sourceIn: 0,
        sourceOut: 5,
        transform: DEFAULT_TRANSFORM,
      }
      expect(validateTimelineItem(item, state)).toEqual([])
    })

    it('passes for compatible audio item on audio track', () => {
      const state = setupState()
      const item: TimelineItem = {
        id: 'item-2',
        trackId: 'track-a1',
        assetId: audioAsset.id,
        startTime: 0,
        duration: 5,
        sourceIn: 0,
        sourceOut: 5,
        transform: DEFAULT_TRANSFORM,
      }
      expect(validateTimelineItem(item, state)).toEqual([])
    })

    it('fails when placing video asset on audio track', () => {
      const state = setupState()
      const item: TimelineItem = {
        id: 'item-invalid',
        trackId: 'track-a1',
        assetId: videoAsset.id,
        startTime: 0,
        duration: 5,
        sourceIn: 0,
        sourceOut: 5,
        transform: DEFAULT_TRANSFORM,
      }
      const errors = validateTimelineItem(item, state)
      expect(errors).toContain("asset type 'video' is incompatible with track type 'audio'")
    })

    it('fails when placing audio asset on video track', () => {
      const state = setupState()
      const item: TimelineItem = {
        id: 'item-invalid',
        trackId: 'track-v1',
        assetId: audioAsset.id,
        startTime: 0,
        duration: 5,
        sourceIn: 0,
        sourceOut: 5,
        transform: DEFAULT_TRANSFORM,
      }
      const errors = validateTimelineItem(item, state)
      expect(errors).toContain("asset type 'audio' is incompatible with track type 'video'")
    })
  })

  describe('Command layer track enforcement', () => {
    it('addTimelineItem rejects adding video item to audio track', () => {
      const state = setupState()
      const item: TimelineItem = {
        id: 'item-bad',
        trackId: 'track-a1',
        assetId: videoAsset.id,
        startTime: 0,
        duration: 5,
        sourceIn: 0,
        sourceOut: 5,
        transform: DEFAULT_TRANSFORM,
      }
      const nextState = addTimelineItem(state, item)
      expect(nextState.items['item-bad']).toBeUndefined()
    })

    it('moveTimelineItem prevents moving video item to audio track', () => {
      const state = setupState()
      const item: TimelineItem = {
        id: 'item-v',
        trackId: 'track-v1',
        assetId: videoAsset.id,
        startTime: 0,
        duration: 5,
        sourceIn: 0,
        sourceOut: 5,
        transform: DEFAULT_TRANSFORM,
      }
      const withItem = { ...state, items: { [item.id]: item } }

      // Try moving to track-a1 (incompatible)
      const moved = moveTimelineItem(withItem, item.id, 0, 'track-a1')
      // Track ID must remain track-v1
      expect(moved.items[item.id].trackId).toBe('track-v1')
    })

    it('moveTimelineItem prevents auto-creating video track for audio item', () => {
      const state = setupState()
      const item: TimelineItem = {
        id: 'item-a',
        trackId: 'track-a1',
        assetId: audioAsset.id,
        startTime: 0,
        duration: 5,
        sourceIn: 0,
        sourceOut: 5,
        transform: DEFAULT_TRANSFORM,
      }
      const withItem = { ...state, items: { [item.id]: item } }

      // Try moving audio item to NEW_VIDEO_TRACK
      const moved = moveTimelineItem(withItem, item.id, 0, 'NEW_VIDEO_TRACK')
      // Track ID must remain track-a1 and no new video track was created
      expect(moved.items[item.id].trackId).toBe('track-a1')
      expect(moved.tracks.filter((t) => t.type === 'video').length).toBe(1)
    })
  })
})
