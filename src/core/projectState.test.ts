import { describe, it, expect } from 'vitest'
import {
  createEmptyProjectState,
  DEFAULT_PROJECT_SETTINGS,
  DEFAULT_TRANSFORM,
  addMediaAsset,
  addTimelineItem,
  setPlayheadTime,
  selectItem,
  updateTimelineItem,
  removeMediaAsset,
  type MediaAsset,
  type TimelineItem,
} from './index'

describe('Editor Core Data Model - ProjectState', () => {
  it('creates an empty project with sensible defaults', () => {
    const project = createEmptyProjectState({
      id: 'proj-test',
      name: 'Test Project',
    })

    expect(project.id).toBe('proj-test')
    expect(project.name).toBe('Test Project')
    expect(project.settings).toEqual(DEFAULT_PROJECT_SETTINGS)
    expect(project.assets).toEqual({})
    expect(project.items).toEqual({})
    expect(project.playheadTime).toBe(0)
    expect(project.selectedItemId).toBeNull()

    // Default tracks: 0 tracks (no tracks or layers by default)
    expect(project.tracks).toHaveLength(0)

    // Supports passing initialTracks when explicitly requested
    const custom = createEmptyProjectState({
      initialTracks: [
        { id: 'track-v1', name: 'Video 1', type: 'video', visible: true, locked: false },
        { id: 'track-a1', name: 'Audio 1', type: 'audio', muted: false, locked: false },
      ],
    })
    expect(custom.tracks).toHaveLength(2)
    expect(custom.tracks[0]).toMatchObject({ id: 'track-v1', type: 'video' })
    expect(custom.tracks[1]).toMatchObject({ id: 'track-a1', type: 'audio' })
  })

  it('adds media assets across supported media types (video, audio, image)', () => {
    let project = createEmptyProjectState()

    const videoAsset: MediaAsset = {
      id: 'asset-video-1',
      name: 'clip.mp4',
      type: 'video',
      path: '/media/clip.mp4',
      duration: 12.5,
      metadata: {
        width: 1920,
        height: 1080,
        fps: 30,
        duration: 12.5,
      },
    }

    const audioAsset: MediaAsset = {
      id: 'asset-audio-1',
      name: 'voiceover.wav',
      type: 'audio',
      path: '/media/voiceover.wav',
      duration: 8.0,
      metadata: {
        sampleRate: 48000,
        audioChannels: 2,
        duration: 8.0,
      },
    }

    const imageAsset: MediaAsset = {
      id: 'asset-image-1',
      name: 'logo.png',
      type: 'image',
      path: '/media/logo.png',
      metadata: {
        width: 512,
        height: 512,
      },
    }

    project = addMediaAsset(project, videoAsset)
    project = addMediaAsset(project, audioAsset)
    project = addMediaAsset(project, imageAsset)

    expect(Object.keys(project.assets)).toHaveLength(3)
    expect(project.assets['asset-video-1']).toEqual(videoAsset)
    expect(project.assets['asset-audio-1']).toEqual(audioAsset)
    expect(project.assets['asset-image-1']).toEqual(imageAsset)
  })

  it('adds and modifies timeline items with timing and transform data', () => {
    let project = createEmptyProjectState()

    const item: TimelineItem = {
      id: 'item-1',
      trackId: 'track-v1',
      assetId: 'asset-video-1',
      startTime: 2.5,
      duration: 5.0,
      sourceIn: 1.0,
      sourceOut: 6.0,
      transform: {
        x: 10,
        y: -20,
        scale: 1.2,
        rotation: 45,
        opacity: 0.9,
      },
    }

    project = addTimelineItem(project, item)

    expect(project.items['item-1']).toBeDefined()
    expect(project.items['item-1'].startTime).toBe(2.5)
    expect(project.items['item-1'].duration).toBe(5.0)
    expect(project.items['item-1'].sourceIn).toBe(1.0)
    expect(project.items['item-1'].sourceOut).toBe(6.0)
    expect(project.items['item-1'].transform).toEqual({
      x: 10,
      y: -20,
      scale: 1.2,
      rotation: 45,
      opacity: 0.9,
    })

    // Update transform and timing
    project = updateTimelineItem(project, 'item-1', {
      startTime: 3.0,
      transform: {
        ...project.items['item-1'].transform,
        opacity: 0.8,
      },
    })

    expect(project.items['item-1'].startTime).toBe(3.0)
    expect(project.items['item-1'].duration).toBe(5.0)
    expect(project.items['item-1'].transform.opacity).toBe(0.8)
    expect(project.items['item-1'].transform.scale).toBe(1.2)
  })

  it('maintains playhead time and item selection correctly', () => {
    let project = createEmptyProjectState()

    const item: TimelineItem = {
      id: 'item-1',
      trackId: 'track-v1',
      assetId: 'asset-video-1',
      startTime: 0,
      duration: 10,
      sourceIn: 0,
      sourceOut: 10,
      transform: DEFAULT_TRANSFORM,
    }

    project = addTimelineItem(project, item)

    // Set playhead
    project = setPlayheadTime(project, 4.5)
    expect(project.playheadTime).toBe(4.5)

    // Cannot set negative playhead time
    project = setPlayheadTime(project, -1.0)
    expect(project.playheadTime).toBe(0)

    // Select existing item
    project = selectItem(project, 'item-1')
    expect(project.selectedItemId).toBe('item-1')

    // Selecting non-existing item clears selection
    project = selectItem(project, 'non-existent')
    expect(project.selectedItemId).toBeNull()
  })

  it('cleans up timeline items and selection when associated media asset is removed', () => {
    let project = createEmptyProjectState()

    const asset: MediaAsset = {
      id: 'asset-1',
      name: 'clip.mp4',
      type: 'video',
      path: '/media/clip.mp4',
    }

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

    project = addMediaAsset(project, asset)
    project = addTimelineItem(project, item)
    project = selectItem(project, 'item-1')

    expect(project.assets['asset-1']).toBeDefined()
    expect(project.items['item-1']).toBeDefined()
    expect(project.selectedItemId).toBe('item-1')

    // Removing the asset removes the referencing timeline item and clears selection
    project = removeMediaAsset(project, 'asset-1')
    expect(project.assets['asset-1']).toBeUndefined()
    expect(project.items['item-1']).toBeUndefined()
    expect(project.selectedItemId).toBeNull()
  })
})
