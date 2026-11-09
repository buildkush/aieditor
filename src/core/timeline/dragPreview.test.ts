import { describe, it, expect } from 'vitest'
import {
  createEmptyProjectState,
  DEFAULT_TRANSFORM,
  computeDragPreview,
  type TimelineItem,
  type MediaAsset,
  type ProjectState,
} from '../index'

describe('Timeline Drag Preview (computeDragPreview)', () => {
  const videoAsset: MediaAsset = {
    id: 'asset-video',
    name: 'Video 20s',
    type: 'video',
    path: '/video.mp4',
    duration: 20,
  }

  const audioAsset: MediaAsset = {
    id: 'asset-audio',
    name: 'Audio 30s',
    type: 'audio',
    path: '/audio.mp3',
    duration: 30,
  }

  function setupState(): { state: ProjectState; clipA: TimelineItem } {
    let state = createEmptyProjectState({
      initialTracks: [
        { id: 'track-v1', name: 'Video 1', type: 'video', visible: true, locked: false },
        { id: 'track-a1', name: 'Audio 1', type: 'audio', muted: false, locked: false },
      ],
    })
    state = {
      ...state,
      assets: {
        [videoAsset.id]: videoAsset,
        [audioAsset.id]: audioAsset,
      },
    }
    const clipA: TimelineItem = {
      id: 'clip-A',
      trackId: 'track-v1',
      assetId: videoAsset.id,
      startTime: 0,
      duration: 10,
      sourceIn: 0,
      sourceOut: 10,
      transform: DEFAULT_TRANSFORM,
    }
    state = {
      ...state,
      items: { [clipA.id]: clipA },
    }
    return { state, clipA }
  }

  describe('Move Item Preview', () => {
    it('previews partial overlap at end by trimming clip A visually without mutating state', () => {
      const { state } = setupState()
      const clipB: TimelineItem = {
        id: 'clip-B',
        trackId: 'track-v1',
        assetId: videoAsset.id,
        startTime: 20,
        duration: 5,
        sourceIn: 0,
        sourceOut: 5,
        transform: DEFAULT_TRANSFORM,
      }
      const stateWithB = { ...state, items: { ...state.items, [clipB.id]: clipB } }

      // Preview dragging B to startTime: 8 (overlaps A at 8..10)
      const preview = computeDragPreview(stateWithB, {
        type: 'move',
        itemId: 'clip-B',
        targetStartTime: 8,
        targetTrackId: 'track-v1',
      })

      expect(preview.isCompatible).toBe(true)
      // Visually, A is trimmed to duration 8
      expect(preview.items['clip-A'].duration).toBe(8)
      expect(preview.items['clip-B'].startTime).toBe(8)

      // CRITICAL: Original state was NOT mutated
      expect(stateWithB.items['clip-A'].duration).toBe(10)
      expect(stateWithB.items['clip-B'].startTime).toBe(20)
    })

    it('previews B placed completely inside A by splitting A visually into left and right', () => {
      const { state } = setupState()
      const clipB: TimelineItem = {
        id: 'clip-B',
        trackId: 'track-v1',
        assetId: videoAsset.id,
        startTime: 20,
        duration: 4,
        sourceIn: 0,
        sourceOut: 4,
        transform: DEFAULT_TRANSFORM,
      }
      const stateWithB = { ...state, items: { ...state.items, [clipB.id]: clipB } }

      // Preview dragging B to startTime: 3 (inside A 0..10)
      const preview = computeDragPreview(stateWithB, {
        type: 'move',
        itemId: 'clip-B',
        targetStartTime: 3,
        targetTrackId: 'track-v1',
      })

      expect(preview.isCompatible).toBe(true)
      expect(preview.items['clip-A']).toBeUndefined() // original A is split
      expect(preview.items['clip-B'].startTime).toBe(3)

      const remaining = Object.values(preview.items).filter((i) => i.id !== 'clip-B')
      expect(remaining.length).toBe(2)
      const leftPart = remaining.find((i) => i.startTime === 0)!
      const rightPart = remaining.find((i) => i.startTime === 7)!
      expect(leftPart.duration).toBe(3)
      expect(rightPart.duration).toBe(3)

      // Original state untouched
      expect(stateWithB.items['clip-A']).toBeDefined()
    })

    it('previews new video track placeholder when dragging beyond existing video tracks', () => {
      const { state, clipA } = setupState()
      const preview = computeDragPreview(state, {
        type: 'move',
        itemId: clipA.id,
        targetStartTime: 5,
        targetTrackId: 'NEW_VIDEO_TRACK',
      })

      expect(preview.isCompatible).toBe(true)
      expect(preview.isNewTrack).toBe(true)
      expect(preview.tracks.some((t) => t.id === 'NEW_VIDEO_TRACK')).toBe(true)
      expect(preview.items[clipA.id].trackId).toBe('NEW_VIDEO_TRACK')
      expect(preview.items[clipA.id].startTime).toBe(5)

      // Original state unchanged
      expect(state.tracks.some((t) => t.id === 'NEW_VIDEO_TRACK')).toBe(false)
      expect(state.items[clipA.id].trackId).toBe('track-v1')
    })

    it('rejects dragging video clip to audio track', () => {
      const { state, clipA } = setupState()
      const preview = computeDragPreview(state, {
        type: 'move',
        itemId: clipA.id,
        targetStartTime: 5,
        targetTrackId: 'track-a1',
      })

      expect(preview.isCompatible).toBe(false)
      // Items remain in original position
      expect(preview.items[clipA.id].trackId).toBe('track-v1')
    })
  })

  describe('Trim Item Preview', () => {
    it('previews right edge trimming accurately without mutating state', () => {
      const { state, clipA } = setupState()
      const preview = computeDragPreview(state, {
        type: 'trim',
        itemId: clipA.id,
        edge: 'right',
        targetTime: 7,
      })

      expect(preview.items[clipA.id].startTime).toBe(0)
      expect(preview.items[clipA.id].duration).toBe(7)
      expect(preview.items[clipA.id].sourceOut).toBe(7)

      // State is unchanged
      expect(state.items[clipA.id].duration).toBe(10)
    })

    it('previews left edge trimming accurately without mutating state', () => {
      const { state, clipA } = setupState()
      const preview = computeDragPreview(state, {
        type: 'trim',
        itemId: clipA.id,
        edge: 'left',
        targetTime: 4,
      })

      expect(preview.items[clipA.id].startTime).toBe(4)
      expect(preview.items[clipA.id].sourceIn).toBe(4)
      expect(preview.items[clipA.id].duration).toBe(6)

      // State is unchanged
      expect(state.items[clipA.id].startTime).toBe(0)
      expect(state.items[clipA.id].duration).toBe(10)
    })

    it('previews linked clips trimming synchronously during trim drag', () => {
      const { state, clipA } = setupState()
      // Create clipB on audio track linked to clipA
      const clipB: TimelineItem = {
        id: 'clip-B',
        trackId: 'track-a1',
        assetId: 'asset-audio-1',
        startTime: 0,
        duration: 10,
        sourceIn: 0,
        sourceOut: 10,
        transform: DEFAULT_TRANSFORM,
        streamType: 'audio',
        linkedItemId: clipA.id,
      }
      const stateWithLinked: ProjectState = {
        ...state,
        items: {
          ...state.items,
          [clipB.id]: clipB,
        },
      }

      const preview = computeDragPreview(stateWithLinked, {
        type: 'trim',
        itemId: clipA.id,
        edge: 'right',
        targetTime: 6,
        additionalTrims: [
          {
            itemId: clipB.id,
            edge: 'right',
            targetTime: 6,
          },
        ],
      })

      // Both clipA and linked clipB should have duration 6 during live preview
      expect(preview.items[clipA.id].duration).toBe(6)
      expect(preview.items[clipB.id].duration).toBe(6)

      // State is unchanged
      expect(stateWithLinked.items[clipA.id].duration).toBe(10)
      expect(stateWithLinked.items[clipB.id].duration).toBe(10)
    })
  })

  describe('Media Library Drop Preview', () => {
    it('previews video asset dropped on video track with overwrite preview', () => {
      const { state } = setupState()
      // A is at 0..10. Preview dropping videoAsset at 6 with duration 8 (6..14)
      const preview = computeDragPreview(state, {
        type: 'media-drop',
        assetId: videoAsset.id,
        assetType: 'video',
        assetName: videoAsset.name,
        duration: 8,
        targetStartTime: 6,
        targetTrackId: 'track-v1',
      })

      expect(preview.isCompatible).toBe(true)
      expect(preview.items['clip-A'].duration).toBe(6) // Trimmed by preview
      expect(preview.items['__preview_media_drop__']).toBeDefined()
      expect(preview.items['__preview_media_drop__'].startTime).toBe(6)
      expect(preview.items['__preview_media_drop__'].duration).toBe(8)

      // Original state untouched
      expect(state.items['clip-A'].duration).toBe(10)
      expect(state.items['__preview_media_drop__']).toBeUndefined()
    })

    it('rejects video asset dropped on audio track', () => {
      const { state } = setupState()
      const preview = computeDragPreview(state, {
        type: 'media-drop',
        assetId: videoAsset.id,
        assetType: 'video',
        assetName: videoAsset.name,
        duration: 5,
        targetStartTime: 0,
        targetTrackId: 'track-a1',
      })

      expect(preview.isCompatible).toBe(false)
      expect(preview.items['__preview_media_drop__']).toBeUndefined()
    })

    it('previews video asset dropped on NEW_VIDEO_TRACK with ghost track', () => {
      const { state } = setupState()
      const preview = computeDragPreview(state, {
        type: 'media-drop',
        assetId: videoAsset.id,
        assetType: 'video',
        assetName: videoAsset.name,
        duration: 5,
        targetStartTime: 3,
        targetTrackId: 'NEW_VIDEO_TRACK',
      })

      expect(preview.isCompatible).toBe(true)
      expect(preview.isNewTrack).toBe(true)
      expect(preview.tracks.some((t) => t.id === 'NEW_VIDEO_TRACK')).toBe(true)
      expect(preview.items['__preview_media_drop__'].trackId).toBe('NEW_VIDEO_TRACK')
      expect(preview.items['__preview_media_drop__'].startTime).toBe(3)
    })
  })
})
