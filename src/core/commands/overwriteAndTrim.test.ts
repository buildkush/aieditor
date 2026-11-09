import { describe, it, expect } from 'vitest'
import {
  createEmptyProjectState,
  DEFAULT_TRANSFORM,
  CommandHistory,
  MoveTimelineItemCommand,
  TrimTimelineItemCommand,
  resolveTrackOverwrites,
  type TimelineItem,
  type MediaAsset,
  type ProjectState,
} from '../index'

describe('Track Overwrite Semantics & Trimming', () => {
  const asset20s: MediaAsset = {
    id: 'asset-20s',
    name: 'Test 20s',
    type: 'video',
    path: '/test.mp4',
    duration: 20,
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
      assets: { [asset20s.id]: asset20s },
    }
    const clipA: TimelineItem = {
      id: 'clip-A',
      trackId: 'track-v1',
      assetId: asset20s.id,
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

  describe('resolveTrackOverwrites', () => {
    it('handles no overlap', () => {
      const { state } = setupState()
      const clipB: TimelineItem = {
        id: 'clip-B',
        trackId: 'track-v1',
        assetId: asset20s.id,
        startTime: 15,
        duration: 5,
        sourceIn: 0,
        sourceOut: 5,
        transform: DEFAULT_TRANSFORM,
      }
      const withB = { ...state, items: { ...state.items, [clipB.id]: clipB } }
      const resolved = resolveTrackOverwrites(withB, clipB.id)

      expect(resolved.items['clip-A'].startTime).toBe(0)
      expect(resolved.items['clip-A'].duration).toBe(10)
      expect(resolved.items['clip-B'].startTime).toBe(15)
      expect(resolved.items['clip-B'].duration).toBe(5)
    })

    it('handles exact edge contact without modification', () => {
      const { state } = setupState()
      // A is 0 -> 10, B starts exactly at 10 -> 15
      const clipB: TimelineItem = {
        id: 'clip-B',
        trackId: 'track-v1',
        assetId: asset20s.id,
        startTime: 10,
        duration: 5,
        sourceIn: 0,
        sourceOut: 5,
        transform: DEFAULT_TRANSFORM,
      }
      const withB = { ...state, items: { ...state.items, [clipB.id]: clipB } }
      const resolved = resolveTrackOverwrites(withB, clipB.id)

      expect(resolved.items['clip-A'].startTime).toBe(0)
      expect(resolved.items['clip-A'].duration).toBe(10)
      expect(resolved.items['clip-B'].startTime).toBe(10)
      expect(resolved.items['clip-B'].duration).toBe(5)
    })

    it('handles partial overlap at end (A: 0->10, B: 8->15 => A: 0->8, B: 8->15)', () => {
      const { state } = setupState()
      const clipB: TimelineItem = {
        id: 'clip-B',
        trackId: 'track-v1',
        assetId: asset20s.id,
        startTime: 8,
        duration: 7,
        sourceIn: 0,
        sourceOut: 7,
        transform: DEFAULT_TRANSFORM,
      }
      const withB = { ...state, items: { ...state.items, [clipB.id]: clipB } }
      const resolved = resolveTrackOverwrites(withB, clipB.id)

      expect(resolved.items['clip-A'].startTime).toBe(0)
      expect(resolved.items['clip-A'].duration).toBe(8)
      expect(resolved.items['clip-A'].sourceIn).toBe(0)
      expect(resolved.items['clip-A'].sourceOut).toBe(8)
      expect(resolved.items['clip-B'].startTime).toBe(8)
      expect(resolved.items['clip-B'].duration).toBe(7)
    })

    it('handles partial overlap at start (A: 5->15, B: 0->8 => A: 8->15, B: 0->8)', () => {
      let state = createEmptyProjectState()
      const clipA: TimelineItem = {
        id: 'clip-A',
        trackId: 'track-v1',
        assetId: asset20s.id,
        startTime: 5,
        duration: 10,
        sourceIn: 2,
        sourceOut: 12,
        transform: DEFAULT_TRANSFORM,
      }
      const clipB: TimelineItem = {
        id: 'clip-B',
        trackId: 'track-v1',
        assetId: asset20s.id,
        startTime: 0,
        duration: 8,
        sourceIn: 0,
        sourceOut: 8,
        transform: DEFAULT_TRANSFORM,
      }
      state = { ...state, items: { [clipA.id]: clipA, [clipB.id]: clipB } }
      const resolved = resolveTrackOverwrites(state, clipB.id)

      expect(resolved.items['clip-B'].startTime).toBe(0)
      expect(resolved.items['clip-B'].duration).toBe(8)
      // A starts at 8, duration was 10, now 15 - 8 = 7
      expect(resolved.items['clip-A'].startTime).toBe(8)
      expect(resolved.items['clip-A'].duration).toBe(7)
      // sourceIn was 2, trimmed by 3s (8 - 5 = 3) -> sourceIn = 5
      expect(resolved.items['clip-A'].sourceIn).toBe(5)
      expect(resolved.items['clip-A'].sourceOut).toBe(12)
    })

    it('handles B placed completely inside A (splits A into left/right around B)', () => {
      const { state } = setupState()
      // A is 0 -> 10. B is 3 -> 7.
      const clipB: TimelineItem = {
        id: 'clip-B',
        trackId: 'track-v1',
        assetId: asset20s.id,
        startTime: 3,
        duration: 4,
        sourceIn: 0,
        sourceOut: 4,
        transform: DEFAULT_TRANSFORM,
      }
      const withB = { ...state, items: { ...state.items, [clipB.id]: clipB } }
      let counter = 1
      const resolved = resolveTrackOverwrites(withB, clipB.id, (p) => `${p}-split-${counter++}`)

      // Original A should be gone, replaced by left and right
      expect(resolved.items['clip-A']).toBeUndefined()
      expect(resolved.items['clip-B'].startTime).toBe(3)
      expect(resolved.items['clip-B'].duration).toBe(4)

      const remaining = Object.values(resolved.items).filter((i) => i.id !== 'clip-B')
      expect(remaining.length).toBe(2)

      const leftPart = remaining.find((i) => i.startTime === 0)!
      const rightPart = remaining.find((i) => i.startTime === 7)!

      expect(leftPart).toBeDefined()
      expect(leftPart.duration).toBe(3)
      expect(leftPart.sourceIn).toBe(0)
      expect(leftPart.sourceOut).toBe(3)

      expect(rightPart).toBeDefined()
      expect(rightPart.duration).toBe(3) // 10 - 7 = 3
      expect(rightPart.sourceIn).toBe(7)
      expect(rightPart.sourceOut).toBe(10)
    })

    it('handles B completely covering A (A is removed)', () => {
      const { state } = setupState()
      // A is 0 -> 10. B is 0 -> 15.
      const clipB: TimelineItem = {
        id: 'clip-B',
        trackId: 'track-v1',
        assetId: asset20s.id,
        startTime: 0,
        duration: 15,
        sourceIn: 0,
        sourceOut: 15,
        transform: DEFAULT_TRANSFORM,
      }
      const withB = { ...state, items: { ...state.items, [clipB.id]: clipB } }
      const resolved = resolveTrackOverwrites(withB, clipB.id)

      expect(resolved.items['clip-A']).toBeUndefined()
      expect(resolved.items['clip-B']).toBeDefined()
      expect(Object.keys(resolved.items)).toEqual(['clip-B'])
    })
  })

  describe('Move command with undo/redo & automatic track creation', () => {
    it('moves clip and resolves overwrite with full undo/redo', () => {
      const { state } = setupState()
      const clipB: TimelineItem = {
        id: 'clip-B',
        trackId: 'track-v1',
        assetId: asset20s.id,
        startTime: 20,
        duration: 5,
        sourceIn: 0,
        sourceOut: 5,
        transform: DEFAULT_TRANSFORM,
      }
      const initial = { ...state, items: { ...state.items, [clipB.id]: clipB } }
      const history = new CommandHistory(initial)

      // Move B to 8 (partially overlapping A: 0->10)
      history.execute(new MoveTimelineItemCommand('clip-B', 8))
      expect(history.getCurrentState().items['clip-A'].duration).toBe(8)
      expect(history.getCurrentState().items['clip-B'].startTime).toBe(8)

      // Undo restores A to duration 10 and B to start 20
      history.undo()
      expect(history.getCurrentState().items['clip-A'].duration).toBe(10)
      expect(history.getCurrentState().items['clip-B'].startTime).toBe(20)

      // Redo reapplies overwrite
      history.redo()
      expect(history.getCurrentState().items['clip-A'].duration).toBe(8)
      expect(history.getCurrentState().items['clip-B'].startTime).toBe(8)
    })

    it('automatically creates a new video track when dragged upwards (NEW_VIDEO_TRACK placed at top)', () => {
      const { state, clipA } = setupState()
      const history = new CommandHistory(state)
      expect(state.tracks.filter((t) => t.type === 'video').length).toBe(1)

      // Move clipA to NEW_VIDEO_TRACK
      history.execute(new MoveTimelineItemCommand(clipA.id, 0, 'NEW_VIDEO_TRACK'))

      const tracks = history.getCurrentState().tracks
      const videoTracks = tracks.filter((t) => t.type === 'video')
      expect(videoTracks.length).toBe(2)
      expect(videoTracks[0].id).toBe('track-v2') // Video tracks stack upwards at index 0
      expect(videoTracks[1].id).toBe('track-v1')
      expect(history.getCurrentState().items[clipA.id].trackId).toBe('track-v2')

      // Undo removes created track and restores clip to track-v1
      history.undo()
      expect(history.getCurrentState().tracks.filter((t) => t.type === 'video').length).toBe(1)
      expect(history.getCurrentState().items[clipA.id].trackId).toBe('track-v1')
    })

    it('automatically creates a new audio track when dragged below last audio track', () => {
      const { state } = setupState()
      const audioItem: TimelineItem = {
        id: 'audio-1',
        trackId: 'track-a1',
        assetId: 'audio-asset',
        startTime: 0,
        duration: 10,
        sourceIn: 0,
        sourceOut: 10,
        transform: DEFAULT_TRANSFORM,
      }
      const withAudio = { ...state, items: { ...state.items, [audioItem.id]: audioItem } }
      const history = new CommandHistory(withAudio)

      history.execute(new MoveTimelineItemCommand(audioItem.id, 2, 'NEW_AUDIO_TRACK'))
      const aTracks = history.getCurrentState().tracks.filter((t) => t.type === 'audio')
      expect(aTracks.length).toBe(2)
      expect(aTracks[1].id).toBe('track-a2')
      expect(history.getCurrentState().items[audioItem.id].trackId).toBe('track-a2')
      expect(history.getCurrentState().items[audioItem.id].startTime).toBe(2)
    })
  })

  describe('Trimming', () => {
    it('trims right edge properly (updates duration and sourceOut, preserves startTime and sourceIn)', () => {
      const { state, clipA } = setupState()
      const history = new CommandHistory(state)

      // Clip A: start 0, duration 10, sourceIn 0, sourceOut 10.
      // Trim right edge to 6s
      history.execute(
        new TrimTimelineItemCommand(clipA.id, {
          edge: 'right',
          newTime: 6,
        })
      )

      const item = history.getCurrentState().items[clipA.id]
      expect(item.startTime).toBe(0)
      expect(item.duration).toBe(6)
      expect(item.sourceIn).toBe(0)
      expect(item.sourceOut).toBe(6)

      // Undo
      history.undo()
      expect(history.getCurrentState().items[clipA.id].duration).toBe(10)
      expect(history.getCurrentState().items[clipA.id].sourceOut).toBe(10)
    })

    it('trims left edge properly according to example in requirement 4', () => {
      // 20-second source. Clip originally starts at 0 with duration 20 (sourceIn 0 -> 20).
      let state = createEmptyProjectState()
      state = { ...state, assets: { [asset20s.id]: asset20s } }
      const clip: TimelineItem = {
        id: 'clip-20s',
        trackId: 'track-v1',
        assetId: asset20s.id,
        startTime: 0,
        duration: 20,
        sourceIn: 0,
        sourceOut: 20,
        transform: DEFAULT_TRANSFORM,
      }
      state = { ...state, items: { [clip.id]: clip } }
      const history = new CommandHistory(state)

      // User wants only source 5s -> 10s.
      // Step 1: Drag left edge to 5s.
      history.execute(
        new TrimTimelineItemCommand(clip.id, {
          edge: 'left',
          newTime: 5,
        })
      )
      let item = history.getCurrentState().items[clip.id]
      expect(item.startTime).toBe(5)
      expect(item.sourceIn).toBe(5)
      expect(item.sourceOut).toBe(20)
      expect(item.duration).toBe(15)

      // Step 2: Drag right edge to 10s on timeline.
      history.execute(
        new TrimTimelineItemCommand(clip.id, {
          edge: 'right',
          newTime: 10,
        })
      )
      item = history.getCurrentState().items[clip.id]
      expect(item.startTime).toBe(5)
      expect(item.sourceIn).toBe(5)
      expect(item.sourceOut).toBe(10)
      expect(item.duration).toBe(5)

      // Undo step 2
      history.undo()
      item = history.getCurrentState().items[clip.id]
      expect(item.duration).toBe(15)
      expect(item.sourceOut).toBe(20)

      // Undo step 1
      history.undo()
      item = history.getCurrentState().items[clip.id]
      expect(item.startTime).toBe(0)
      expect(item.sourceIn).toBe(0)
      expect(item.duration).toBe(20)
    })
  })
})
