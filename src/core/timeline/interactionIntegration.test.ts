import { describe, it, expect } from 'vitest'
import {
  createEmptyProjectState,
  DEFAULT_TRANSFORM,
  CommandHistory,
  AddTimelineItemCommand,
  MoveTimelineItemCommand,
  TrimTimelineItemCommand,
  type TimelineItem,
  type MediaAsset,
} from '../index'

describe('Timeline Interaction Integration & Undo Atomicity', () => {
  const videoAsset: MediaAsset = {
    id: 'asset-video-1',
    name: 'Video 1',
    type: 'video',
    path: '/video1.mp4',
    duration: 30,
  }

  const audioAsset: MediaAsset = {
    id: 'asset-audio-1',
    name: 'Audio 1',
    type: 'audio',
    path: '/audio1.mp3',
    duration: 45,
  }

  function setupHistory() {
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
    return new CommandHistory(state)
  }

  describe('MediaLibrary Drop onto Timeline', () => {
    it('Video asset dropped on Video 1 at 15s creates timeline item at 15s on Video 1', () => {
      const history = setupHistory()
      const newItem: TimelineItem = {
        id: 'item-v-dropped',
        trackId: 'track-v1',
        assetId: videoAsset.id,
        startTime: 15,
        duration: 10,
        sourceIn: 0,
        sourceOut: 10,
        transform: DEFAULT_TRANSFORM,
      }

      // 1 command executed on drop
      history.execute(new AddTimelineItemCommand(newItem))

      const current = history.getCurrentState()
      const item = current.items['item-v-dropped']
      expect(item).toBeDefined()
      expect(item.trackId).toBe('track-v1')
      expect(item.startTime).toBe(15)
      expect(item.duration).toBe(10)
      expect(history.undoCount).toBe(1)

      // 1 undo restores empty timeline
      history.undo()
      expect(history.getCurrentState().items['item-v-dropped']).toBeUndefined()
      expect(history.undoCount).toBe(0)
    })

    it('Audio asset dropped on Audio 1 at 20s creates timeline item at 20s on Audio 1', () => {
      const history = setupHistory()
      const newItem: TimelineItem = {
        id: 'item-a-dropped',
        trackId: 'track-a1',
        assetId: audioAsset.id,
        startTime: 20,
        duration: 15,
        sourceIn: 0,
        sourceOut: 15,
        transform: DEFAULT_TRANSFORM,
      }

      history.execute(new AddTimelineItemCommand(newItem))

      const current = history.getCurrentState()
      const item = current.items['item-a-dropped']
      expect(item).toBeDefined()
      expect(item.trackId).toBe('track-a1')
      expect(item.startTime).toBe(20)
      expect(item.duration).toBe(15)

      // Undo
      history.undo()
      expect(history.getCurrentState().items['item-a-dropped']).toBeUndefined()
    })

    it('Dropping video asset beyond existing tracks (NEW_VIDEO_TRACK) creates Video 2 and places item', () => {
      const history = setupHistory()
      const initialVideoTracks = history.getCurrentState().tracks.filter((t) => t.type === 'video').length
      expect(initialVideoTracks).toBe(1)

      const newItem: TimelineItem = {
        id: 'item-v2',
        trackId: 'NEW_VIDEO_TRACK',
        assetId: videoAsset.id,
        startTime: 5,
        duration: 10,
        sourceIn: 0,
        sourceOut: 10,
        transform: DEFAULT_TRANSFORM,
      }

      history.execute(new AddTimelineItemCommand(newItem))

      const state = history.getCurrentState()
      const videoTracks = state.tracks.filter((t) => t.type === 'video')
      expect(videoTracks.length).toBe(2)
      expect(videoTracks[0].id).toBe('track-v2') // Video tracks stack upwards at the top
      expect(videoTracks[1].id).toBe('track-v1')

      const placed = state.items['item-v2']
      expect(placed.trackId).toBe('track-v2')
      expect(placed.startTime).toBe(5)

      // 1 undo removes created track and item
      history.undo()
      expect(history.getCurrentState().tracks.filter((t) => t.type === 'video').length).toBe(1)
      expect(history.getCurrentState().items['item-v2']).toBeUndefined()
    })

    it('When 1 clip exists in Video 1, dropping another media onto NEW_VIDEO_TRACK creates Video 2 leaving Video 1 intact', () => {
      const history = setupHistory()
      history.execute(
        new AddTimelineItemCommand({
          id: 'clip-1',
          trackId: 'track-v1',
          assetId: videoAsset.id,
          startTime: 0,
          duration: 10,
          sourceIn: 0,
          sourceOut: 10,
          transform: DEFAULT_TRANSFORM,
        })
      )
      expect(history.getCurrentState().items['clip-1']).toBeDefined()
      expect(history.getCurrentState().tracks.filter((t) => t.type === 'video').length).toBe(1)

      history.execute(
        new AddTimelineItemCommand({
          id: 'clip-2',
          trackId: 'NEW_VIDEO_TRACK',
          assetId: videoAsset.id,
          startTime: 5,
          duration: 10,
          sourceIn: 0,
          sourceOut: 10,
          transform: DEFAULT_TRANSFORM,
        })
      )

      const state = history.getCurrentState()
      const videoTracks = state.tracks.filter((t) => t.type === 'video')
      expect(videoTracks.length).toBe(2)
      expect(state.items['clip-1'].trackId).toBe('track-v1')
      expect(state.items['clip-2'].trackId).toBe('track-v2')
    })

    it('Rejects dropping audio asset on Video 1 track', () => {
      const history = setupHistory()
      const invalidItem: TimelineItem = {
        id: 'item-invalid',
        trackId: 'track-v1',
        assetId: audioAsset.id,
        startTime: 0,
        duration: 5,
        sourceIn: 0,
        sourceOut: 5,
        transform: DEFAULT_TRANSFORM,
      }

      history.execute(new AddTimelineItemCommand(invalidItem))
      expect(history.getCurrentState().items['item-invalid']).toBeUndefined()
    })
  })

  describe('Undo Atomicity: 1 continuous operation = 1 undo', () => {
    it('Trimming clip continuously results in ONE history entry on mouse release', () => {
      const history = setupHistory()
      const clip: TimelineItem = {
        id: 'clip-trim',
        trackId: 'track-v1',
        assetId: videoAsset.id,
        startTime: 0,
        duration: 20,
        sourceIn: 0,
        sourceOut: 20,
        transform: DEFAULT_TRANSFORM,
      }
      history.execute(new AddTimelineItemCommand(clip))
      expect(history.undoCount).toBe(1)

      // User drags right edge 20s -> 18s -> 15s -> 10s -> 5s in UI
      // UI dispatches ONLY the final value on mouse release:
      history.execute(
        new TrimTimelineItemCommand('clip-trim', {
          edge: 'right',
          newTime: 5,
        })
      )

      expect(history.undoCount).toBe(2)
      expect(history.getCurrentState().items['clip-trim'].duration).toBe(5)

      // ONE Ctrl+Z restores 5s back to 20s
      history.undo()
      expect(history.getCurrentState().items['clip-trim'].duration).toBe(20)
      expect(history.undoCount).toBe(1)
    })

    it('Moving clip and resolving overwrite produces ONE history entry', () => {
      const history = setupHistory()
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
      const clipB: TimelineItem = {
        id: 'clip-B',
        trackId: 'track-v1',
        assetId: videoAsset.id,
        startTime: 20,
        duration: 6,
        sourceIn: 0,
        sourceOut: 6,
        transform: DEFAULT_TRANSFORM,
      }
      history.execute(new AddTimelineItemCommand(clipA))
      history.execute(new AddTimelineItemCommand(clipB))
      expect(history.undoCount).toBe(2)

      // Move clipB to 7 (partially overwriting A)
      history.execute(new MoveTimelineItemCommand('clip-B', 7, 'track-v1'))
      expect(history.undoCount).toBe(3)
      expect(history.getCurrentState().items['clip-A'].duration).toBe(7)
      expect(history.getCurrentState().items['clip-B'].startTime).toBe(7)

      // ONE Ctrl+Z restores both clip A and clip B to original state
      history.undo()
      expect(history.getCurrentState().items['clip-A'].duration).toBe(10)
      expect(history.getCurrentState().items['clip-B'].startTime).toBe(20)
    })
  })

  describe('Auto-Scroll Velocity Calculation', () => {
    const EDGE_ZONE = 60
    const MAX_SPEED = 24

    function calculateScrollSpeed(clientX: number, rectLeft: number, rectRight: number): number {
      if (clientX > rectRight - EDGE_ZONE) {
        const ratio = Math.min(1, (clientX - (rectRight - EDGE_ZONE)) / EDGE_ZONE)
        return Math.min(MAX_SPEED, Math.max(4, ratio * MAX_SPEED))
      } else if (clientX < rectLeft + EDGE_ZONE) {
        const ratio = Math.min(1, ((rectLeft + EDGE_ZONE) - clientX) / EDGE_ZONE)
        return -Math.min(MAX_SPEED, Math.max(4, ratio * MAX_SPEED))
      }
      return 0
    }

    it('returns positive scroll velocity when dragging near right edge', () => {
      const rectLeft = 140
      const rectRight = 800
      // Pointer at 780 (20px from right edge)
      const speed = calculateScrollSpeed(780, rectLeft, rectRight)
      expect(speed).toBeGreaterThan(0)
      expect(speed).toBeLessThanOrEqual(MAX_SPEED)
    })

    it('returns negative scroll velocity when dragging near left edge', () => {
      const rectLeft = 140
      const rectRight = 800
      // Pointer at 160 (20px from left edge)
      const speed = calculateScrollSpeed(160, rectLeft, rectRight)
      expect(speed).toBeLessThan(0)
      expect(speed).toBeGreaterThanOrEqual(-MAX_SPEED)
    })

    it('returns 0 in the neutral middle zone of the viewport', () => {
      const rectLeft = 140
      const rectRight = 800
      // Pointer at 450 (middle)
      const speed = calculateScrollSpeed(450, rectLeft, rectRight)
      expect(speed).toBe(0)
    })
  })
})
