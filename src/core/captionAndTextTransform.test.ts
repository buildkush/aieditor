import { describe, it, expect } from 'vitest'
import { createEmptyProjectState, type ProjectState } from './project/projectState'
import { resolveTrackOrNew } from './commands/projectCommands'
import { getMediaTypeFromFilename } from './media/mediaExtractor'
import { measureTextDimensions } from './timeline/textMeasurement'
import { resolveTargetTrackFromY } from './timeline/trackDetection'
import { computeDragPreview } from './timeline/dragPreview'
import { ImportSubtitlesCommand } from './commands/editorCommand'
import { DEFAULT_TRANSFORM, type Track } from './timeline/types'

describe('Caption Track Layering, Subtitle Media Ingestion & Text Transform Bounding Box', () => {
  it('places caption tracks above video tracks in track hierarchy', () => {
    let state = createEmptyProjectState()
    state = {
      ...state,
      tracks: [
        { id: 'track-v1', name: 'Video 1', type: 'video', visible: true, locked: false },
        { id: 'track-a1', name: 'Audio 1', type: 'audio', muted: false, locked: false },
      ],
    }

    const { nextTracks, resolvedTrackId } = resolveTrackOrNew(state.tracks, 'NEW_CAPTION_TRACK', 'caption')
    expect(resolvedTrackId).toBe('track-c1')
    expect(nextTracks.length).toBe(3)

    // Caption track MUST be placed before video track (at index 0, above video)
    expect(nextTracks[0].type).toBe('caption')
    expect(nextTracks[0].id).toBe('track-c1')
    expect(nextTracks[1].type).toBe('video')
    expect(nextTracks[2].type).toBe('audio')
  })

  it('recognizes .srt and .vtt as caption media files', () => {
    expect(getMediaTypeFromFilename('sample.srt')).toBe('caption')
    expect(getMediaTypeFromFilename('dialogue.vtt')).toBe('caption')
    expect(getMediaTypeFromFilename('subtitles.SRT')).toBe('caption')
    expect(getMediaTypeFromFilename('captions.VTT')).toBe('caption')
  })

  it('measures text dimensions accurately and accounts for font size, padding and stroke', () => {
    const defaultDims = measureTextDimensions({
      text: 'Hello World',
      fontSize: 64,
      fontFamily: 'Inter, sans-serif',
      padding: 12,
      strokeWidth: 2,
    })

    expect(defaultDims.width).toBeGreaterThan(100)
    expect(defaultDims.height).toBeGreaterThan(60)

    const largerDims = measureTextDimensions({
      text: 'Hello World',
      fontSize: 128,
      fontFamily: 'Inter, sans-serif',
      padding: 12,
      strokeWidth: 2,
    })

    // Doubling font size should increase width and height
    expect(largerDims.width).toBeGreaterThan(defaultDims.width)
    expect(largerDims.height).toBeGreaterThan(defaultDims.height)

    // Multi-line text should increase height accordingly
    const multiLineDims = measureTextDimensions({
      text: 'Line 1\nLine 2\nLine 3',
      fontSize: 64,
      fontFamily: 'Inter, sans-serif',
      padding: 12,
      strokeWidth: 0,
    })

    expect(multiLineDims.height).toBeGreaterThan(defaultDims.height)
  })

  it('resolves target caption track when caption asset is dragged over timeline', () => {
    const tracks = [
      { id: 'track-v1', name: 'Video 1', type: 'video' as const, visible: true, locked: false },
      { id: 'track-a1', name: 'Audio 1', type: 'audio' as const, muted: false, locked: false },
    ]
    const bounds = [
      { trackId: 'track-v1', top: 100, bottom: 160 },
      { trackId: 'track-a1', top: 160, bottom: 220 },
    ]

    // Dragging caption asset upwards above video routes to NEW_CAPTION_TRACK (which will be placed above video)
    const resultAbove = resolveTargetTrackFromY(50, 'caption', tracks, bounds, true)
    expect(resultAbove.isCompatible).toBe(true)
    expect(resultAbove.targetTrackId).toBe('NEW_CAPTION_TRACK')

    // Dragging caption asset over video lane is incompatible
    const resultOverVideo = resolveTargetTrackFromY(120, 'caption', tracks, bounds, true)
    expect(resultOverVideo.isCompatible).toBe(false)
    expect(resultOverVideo.targetTrackId).toBe('track-v1')

    // Drag preview creates ghost caption track at top of tracks array
    const state = {
      ...createEmptyProjectState(),
      tracks,
    }
    const preview = computeDragPreview(state, {
      type: 'media-drop',
      assetId: 'asset-srt',
      assetType: 'caption',
      assetName: 'subs.srt',
      duration: 10,
      targetStartTime: 2,
      targetTrackId: 'NEW_CAPTION_TRACK',
    })

    expect(preview.isCompatible).toBe(true)
    expect(preview.tracks[0].type).toBe('caption')
    expect(preview.tracks[0].id).toBe('NEW_CAPTION_TRACK')
  })

  it('creates new caption tracks on top (not below) and numbers them sequentially top-down', () => {
    let state = createEmptyProjectState()
    state = {
      ...state,
      tracks: [
        { id: 'track-v1', name: 'Video 1', type: 'video', visible: true, locked: false },
        { id: 'track-a1', name: 'Audio 1', type: 'audio', muted: false, locked: false },
      ],
    }

    // 1st caption track: Caption 1
    const res1 = resolveTrackOrNew(state.tracks, 'NEW_CAPTION_TRACK', 'caption')
    expect(res1.resolvedTrackId).toBe('track-c1')
    expect(res1.nextTracks[0].id).toBe('track-c1')
    expect(res1.nextTracks[0].name).toBe('Caption 1')

    // 2nd caption track: Caption 2 placed on top of Caption 1
    const res2 = resolveTrackOrNew(res1.nextTracks, 'NEW_CAPTION_TRACK', 'caption')
    expect(res2.resolvedTrackId).toBe('track-c2')
    // Top track must be the newly created caption track
    expect(res2.nextTracks[0].id).toBe('track-c2')
    expect(res2.nextTracks[1].id).toBe('track-c1')
    expect(res2.nextTracks[2].id).toBe('track-v1')
  })

  it('strictly rejects moving caption item to a video track', () => {
    let state: ProjectState = {
      ...createEmptyProjectState(),
      tracks: [
        { id: 'track-c1', name: 'Caption 1', type: 'caption', visible: true, locked: false },
        { id: 'track-v1', name: 'Video 1', type: 'video', visible: true, locked: false },
        { id: 'track-a1', name: 'Audio 1', type: 'audio', muted: false, locked: false },
      ],
      items: {
        'cap-1': {
          id: 'cap-1',
          trackId: 'track-c1',
          assetId: '',
          itemType: 'caption',
          streamType: 'caption',
          startTime: 1,
          duration: 3,
          sourceIn: 0,
          sourceOut: 3,
          transform: { ...DEFAULT_TRANSFORM },
          caption: {
            text: 'Hello Subtitle',
            words: [],
          },
        },
      },
    }

    // Attempting to move caption item to video track track-v1
    const preview = computeDragPreview(state, {
      type: 'move',
      itemId: 'cap-1',
      targetStartTime: 2,
      targetTrackId: 'track-v1',
    })
    expect(preview.isCompatible).toBe(false)
  })

  it('imports subtitle cues into caption track positioned above video', () => {
    const initialTracks: Track[] = [
      { id: 'track-v1', name: 'Video 1', type: 'video', visible: true, locked: false },
      { id: 'track-a1', name: 'Audio 1', type: 'audio', muted: false, locked: false },
    ]
    let state: ProjectState = {
      ...createEmptyProjectState(),
      tracks: initialTracks,
    }

    const srt = `1
00:00:01,000 --> 00:00:03,000
First line of text

2
00:00:04,000 --> 00:00:06,000
Second line of text`

    state = new ImportSubtitlesCommand(srt).execute(state)

    expect(state.tracks[0].type).toBe('caption')
    expect(state.tracks[1].type).toBe('video')
    expect(state.tracks[2].type).toBe('audio')

    const captionItems = Object.values(state.items).filter((it) => it.itemType === 'caption')
    expect(captionItems.length).toBe(2)
    expect(captionItems[0].caption?.text).toBe('First line of text')
    expect(captionItems[1].caption?.text).toBe('Second line of text')
  })
})
