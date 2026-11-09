import { describe, it, expect } from 'vitest'
import { createEmptyProjectState } from '../project/projectState'
import type { MediaAsset } from '../media/types'
import { DEFAULT_TRANSFORM } from '../timeline/types'
import {
  removeTimelineItem,
  moveTimelineItem,
  removeMediaAsset,
} from './projectCommands'
import { CommandHistory } from './commandHistory'
import {
  RemoveTimelineItemCommand,
  RemoveTrackCommand,
  CleanupEmptyTracksCommand,
} from './editorCommand'

const mockVideoAsset: MediaAsset = {
  id: 'asset-video-1',
  name: 'test.mp4',
  path: 'C:/test.mp4',
  type: 'video',
  duration: 10,
  metadata: {
    width: 1920,
    height: 1080,
    fps: 30,
  },
}

const mockAudioAsset: MediaAsset = {
  id: 'asset-audio-1',
  name: 'music.mp3',
  path: 'C:/music.mp3',
  type: 'audio',
  duration: 15,
}

describe('Targeted Empty Track Cleanup', () => {
  it('allows explicitly deleting all tracks down to 0 tracks', () => {
    const state = createEmptyProjectState({
      initialTracks: [
        { id: 'track-v1', name: 'Video 1', type: 'video', visible: true, locked: false },
        { id: 'track-a1', name: 'Audio 1', type: 'audio', muted: false, locked: false },
      ],
    })
    const state1 = new RemoveTrackCommand('track-v1').execute(state)
    expect(state1.tracks.length).toBe(1)
    expect(state1.tracks[0].id).toBe('track-a1')

    const state2 = new RemoveTrackCommand('track-a1').execute(state1)
    expect(state2.tracks.length).toBe(0)
  })

  it('preserves the base video layer (track-v1) even when completely empty during clip removal', () => {
    let state = createEmptyProjectState({
      initialTracks: [
        { id: 'track-v1', name: 'Video 1', type: 'video', visible: true, locked: false },
        { id: 'track-a1', name: 'Audio 1', type: 'audio', muted: false, locked: false },
      ],
    })
    state = {
      ...state,
      assets: { [mockVideoAsset.id]: mockVideoAsset },
      items: {
        item1: {
          id: 'item1',
          trackId: 'track-v1',
          assetId: mockVideoAsset.id,
          startTime: 0,
          duration: 5,
          sourceIn: 0,
          sourceOut: 5,
          transform: { ...DEFAULT_TRANSFORM },
        },
      },
    }

    // Delete item1 from track-v1
    const nextState = removeTimelineItem(state, 'item1')
    expect(nextState.items['item1']).toBeUndefined()
    expect(nextState.tracks.some((t) => t.id === 'track-v1')).toBe(true)
    expect(nextState.tracks.find((t) => t.id === 'track-v1')?.name).toBe('Video 1')
  })

  it('preserves the base audio layer (track-a1) even when completely empty during clip removal', () => {
    let state = createEmptyProjectState({
      initialTracks: [
        { id: 'track-v1', name: 'Video 1', type: 'video', visible: true, locked: false },
        { id: 'track-a1', name: 'Audio 1', type: 'audio', muted: false, locked: false },
      ],
    })
    state = {
      ...state,
      assets: { [mockAudioAsset.id]: mockAudioAsset },
      items: {
        itemA: {
          id: 'itemA',
          trackId: 'track-a1',
          assetId: mockAudioAsset.id,
          startTime: 0,
          duration: 5,
          sourceIn: 0,
          sourceOut: 5,
          transform: { ...DEFAULT_TRANSFORM },
        },
      },
    }

    // Delete itemA from track-a1
    const nextState = removeTimelineItem(state, 'itemA')
    expect(nextState.items['itemA']).toBeUndefined()
    expect(nextState.tracks.some((t) => t.id === 'track-a1')).toBe(true)
    expect(nextState.tracks.find((t) => t.id === 'track-a1')?.name).toBe('Audio 1')
  })

  it('preserves a secondary video track (Video 2) when its last clip is deleted (no auto-deletion)', () => {
    let state = createEmptyProjectState()
    state = {
      ...state,
      assets: { [mockVideoAsset.id]: mockVideoAsset },
      tracks: [
        { id: 'track-v2', name: 'Video 2', type: 'video', visible: true, locked: false },
        { id: 'track-v1', name: 'Video 1', type: 'video', visible: true, locked: false },
        { id: 'track-a1', name: 'Audio 1', type: 'audio', muted: false, locked: false },
      ],
      items: {
        item1: {
          id: 'item1',
          trackId: 'track-v1',
          assetId: mockVideoAsset.id,
          startTime: 0,
          duration: 5,
          sourceIn: 0,
          sourceOut: 5,
          transform: { ...DEFAULT_TRANSFORM },
        },
        item2: {
          id: 'item2',
          trackId: 'track-v2',
          assetId: mockVideoAsset.id,
          startTime: 0,
          duration: 5,
          sourceIn: 0,
          sourceOut: 5,
          transform: { ...DEFAULT_TRANSFORM },
        },
      },
    }

    // Deleting item2 leaves track-v2 intact on timeline
    const nextState = removeTimelineItem(state, 'item2')
    expect(nextState.items['item2']).toBeUndefined()
    expect(nextState.tracks.some((t) => t.id === 'track-v2')).toBe(true)
    expect(nextState.tracks.length).toBe(3)
    expect(nextState.tracks.find((t) => t.id === 'track-v2')?.name).toBe('Video 2')
  })

  it('preserves a secondary track when a clip is moved to another track', () => {
    let state = createEmptyProjectState()
    state = {
      ...state,
      assets: { [mockVideoAsset.id]: mockVideoAsset },
      tracks: [
        { id: 'track-v2', name: 'Video 2', type: 'video', visible: true, locked: false },
        { id: 'track-v1', name: 'Video 1', type: 'video', visible: true, locked: false },
        { id: 'track-a1', name: 'Audio 1', type: 'audio', muted: false, locked: false },
      ],
      items: {
        item2: {
          id: 'item2',
          trackId: 'track-v2',
          assetId: mockVideoAsset.id,
          startTime: 0,
          duration: 5,
          sourceIn: 0,
          sourceOut: 5,
          transform: { ...DEFAULT_TRANSFORM },
        },
      },
    }

    // Move item2 from track-v2 down to track-v1: track-v2 stays
    const nextState = moveTimelineItem(state, 'item2', 0, 'track-v1')
    expect(nextState.items['item2'].trackId).toBe('track-v1')
    expect(nextState.tracks.some((t) => t.id === 'track-v2')).toBe(true)
    expect(nextState.tracks.length).toBe(3)
  })

  it('does NOT remove a track if it is moved horizontally on the same track', () => {
    let state = createEmptyProjectState()
    state = {
      ...state,
      assets: { [mockVideoAsset.id]: mockVideoAsset },
      tracks: [
        { id: 'track-v2', name: 'Video 2', type: 'video', visible: true, locked: false },
        { id: 'track-v1', name: 'Video 1', type: 'video', visible: true, locked: false },
        { id: 'track-a1', name: 'Audio 1', type: 'audio', muted: false, locked: false },
      ],
      items: {
        item2: {
          id: 'item2',
          trackId: 'track-v2',
          assetId: mockVideoAsset.id,
          startTime: 0,
          duration: 5,
          sourceIn: 0,
          sourceOut: 5,
          transform: { ...DEFAULT_TRANSFORM },
        },
      },
    }

    // Move item2 horizontally on track-v2
    const nextState = moveTimelineItem(state, 'item2', 10, 'track-v2')
    expect(nextState.items['item2'].trackId).toBe('track-v2')
    expect(nextState.items['item2'].startTime).toBe(10)
    expect(nextState.tracks.some((t) => t.id === 'track-v2')).toBe(true)
  })

  it('preserves tracks when asset is removed', () => {
    let state = createEmptyProjectState()
    state = {
      ...state,
      assets: { [mockVideoAsset.id]: mockVideoAsset },
      tracks: [
        { id: 'track-v2', name: 'Video 2', type: 'video', visible: true, locked: false },
        { id: 'track-v1', name: 'Video 1', type: 'video', visible: true, locked: false },
        { id: 'track-a1', name: 'Audio 1', type: 'audio', muted: false, locked: false },
      ],
      items: {
        item2: {
          id: 'item2',
          trackId: 'track-v2',
          assetId: mockVideoAsset.id,
          startTime: 0,
          duration: 5,
          sourceIn: 0,
          sourceOut: 5,
          transform: { ...DEFAULT_TRANSFORM },
        },
      },
    }

    const nextState = removeMediaAsset(state, mockVideoAsset.id)
    expect(nextState.items['item2']).toBeUndefined()
    expect(nextState.tracks.some((t) => t.id === 'track-v2')).toBe(true)
    expect(nextState.tracks.some((t) => t.id === 'track-v1')).toBe(true)
    expect(nextState.tracks.some((t) => t.id === 'track-a1')).toBe(true)
  })

  it('supports undo and redo for item removal while keeping tracks intact', () => {
    let state = createEmptyProjectState()
    state = {
      ...state,
      assets: { [mockVideoAsset.id]: mockVideoAsset },
      tracks: [
        { id: 'track-v2', name: 'Video 2', type: 'video', visible: true, locked: false },
        { id: 'track-v1', name: 'Video 1', type: 'video', visible: true, locked: false },
        { id: 'track-a1', name: 'Audio 1', type: 'audio', muted: false, locked: false },
      ],
      items: {
        item2: {
          id: 'item2',
          trackId: 'track-v2',
          assetId: mockVideoAsset.id,
          startTime: 0,
          duration: 5,
          sourceIn: 0,
          sourceOut: 5,
          transform: { ...DEFAULT_TRANSFORM },
        },
      },
    }

    const history = new CommandHistory(state)

    // Execute delete command
    history.execute(new RemoveTimelineItemCommand('item2'))
    expect(history.getCurrentState().tracks.some((t) => t.id === 'track-v2')).toBe(true)
    expect(history.getCurrentState().items['item2']).toBeUndefined()

    // Undo -> item2 restored!
    history.undo()
    expect(history.getCurrentState().tracks.some((t) => t.id === 'track-v2')).toBe(true)
    expect(history.getCurrentState().items['item2']).toBeDefined()

    // Redo -> item2 removed again, track still exists!
    history.redo()
    expect(history.getCurrentState().tracks.some((t) => t.id === 'track-v2')).toBe(true)
    expect(history.getCurrentState().items['item2']).toBeUndefined()
  })

  it('explicitly deletes secondary video track (Video 2) and leaves Video 1 intact', () => {
    let state = createEmptyProjectState()
    state = {
      ...state,
      tracks: [
        { id: 'track-v2', name: 'Video 2', type: 'video', visible: true, locked: false },
        { id: 'track-v1', name: 'Video 1', type: 'video', visible: true, locked: false },
        { id: 'track-a1', name: 'Audio 1', type: 'audio', muted: false, locked: false },
      ],
      items: {
        item2: {
          id: 'item2',
          trackId: 'track-v2',
          assetId: mockVideoAsset.id,
          startTime: 0,
          duration: 5,
          sourceIn: 0,
          sourceOut: 5,
          transform: { ...DEFAULT_TRANSFORM },
        },
      },
    }

    const history = new CommandHistory(state)
    history.execute(new RemoveTrackCommand('track-v2'))

    const nextState = history.getCurrentState()
    expect(nextState.tracks.some((t) => t.id === 'track-v2')).toBe(false)
    expect(nextState.tracks.length).toBe(2)
    expect(nextState.tracks.find((t) => t.id === 'track-v1')?.name).toBe('Video 1')
    expect(nextState.items['item2']).toBeUndefined()

    // Undo restores Video 2 and its item
    history.undo()
    expect(history.getCurrentState().tracks.some((t) => t.id === 'track-v2')).toBe(true)
    expect(history.getCurrentState().items['item2']).toBeDefined()
  })

  it('explicitly deletes secondary audio track (Audio 2) and leaves Audio 1 intact', () => {
    let state = createEmptyProjectState()
    state = {
      ...state,
      tracks: [
        { id: 'track-v1', name: 'Video 1', type: 'video', visible: true, locked: false },
        { id: 'track-a1', name: 'Audio 1', type: 'audio', muted: false, locked: false },
        { id: 'track-a2', name: 'Audio 2', type: 'audio', muted: false, locked: false },
      ],
      items: {
        itemA2: {
          id: 'itemA2',
          trackId: 'track-a2',
          assetId: mockAudioAsset.id,
          startTime: 0,
          duration: 5,
          sourceIn: 0,
          sourceOut: 5,
          transform: { ...DEFAULT_TRANSFORM },
        },
      },
    }

    const history = new CommandHistory(state)
    history.execute(new RemoveTrackCommand('track-a2'))

    const nextState = history.getCurrentState()
    expect(nextState.tracks.some((t) => t.id === 'track-a2')).toBe(false)
    expect(nextState.tracks.length).toBe(2)
    expect(nextState.tracks.find((t) => t.id === 'track-a1')?.name).toBe('Audio 1')
    expect(nextState.items['itemA2']).toBeUndefined()
  })

  it('normalizes surviving track names when Video 1 is deleted', () => {
    let state = createEmptyProjectState()
    state = {
      ...state,
      tracks: [
        { id: 'track-v2', name: 'Video 2', type: 'video', visible: true, locked: false },
        { id: 'track-v1', name: 'Video 1', type: 'video', visible: true, locked: false },
        { id: 'track-a1', name: 'Audio 1', type: 'audio', muted: false, locked: false },
      ],
    }

    const nextState = new RemoveTrackCommand('track-v1').execute(state)
    expect(nextState.tracks.some((t) => t.id === 'track-v1')).toBe(false)
    // The surviving video track track-v2 is renamed to Video 1
    const surviving = nextState.tracks.find((t) => t.id === 'track-v2')
    expect(surviving?.name).toBe('Video 1')
  })

  it('cleans up empty secondary tracks (Video 2 and Audio 2) via cleanupEmptyTracks', () => {
    let state = createEmptyProjectState()
    state = {
      ...state,
      tracks: [
        { id: 'track-v2', name: 'Video 2', type: 'video', visible: true, locked: false },
        { id: 'track-v1', name: 'Video 1', type: 'video', visible: true, locked: false },
        { id: 'track-a1', name: 'Audio 1', type: 'audio', muted: false, locked: false },
        { id: 'track-a2', name: 'Audio 2', type: 'audio', muted: false, locked: false },
      ],
      // Clips exist ONLY on base tracks
      items: {
        item1: {
          id: 'item1',
          trackId: 'track-v1',
          assetId: mockVideoAsset.id,
          startTime: 0,
          duration: 5,
          sourceIn: 0,
          sourceOut: 5,
          transform: { ...DEFAULT_TRANSFORM },
        },
      },
    }

    const cleaned = new CleanupEmptyTracksCommand().execute(state)
    expect(cleaned.tracks.length).toBe(2)
    expect(cleaned.tracks.some((t) => t.id === 'track-v2')).toBe(false)
    expect(cleaned.tracks.some((t) => t.id === 'track-a2')).toBe(false)
    expect(cleaned.tracks.find((t) => t.id === 'track-v1')?.name).toBe('Video 1')
    expect(cleaned.tracks.find((t) => t.id === 'track-a1')?.name).toBe('Audio 1')
  })
})
