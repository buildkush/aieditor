import { describe, it, expect } from 'vitest'
import { resolveTargetTrackFromY, getCorrespondingLayerTrack, type TrackLaneBounds } from './trackDetection'
import type { Track } from './types'

describe('resolveTargetTrackFromY', () => {
  const tracks: Track[] = [
    { id: 'track-v1', name: 'Video 1', type: 'video', visible: true, locked: false },
    { id: 'track-a1', name: 'Audio 1', type: 'audio', muted: false, locked: false },
  ]

  // Track lanes:
  // Video 1: 100 to 160
  // Audio 1: 160 to 220
  const laneBounds: TrackLaneBounds[] = [
    { trackId: 'track-v1', top: 100, bottom: 160 },
    { trackId: 'track-a1', top: 160, bottom: 220 },
  ]

  describe('Video Asset Dragging', () => {
    it('creates NEW_VIDEO_TRACK when dragged upwards above topmost video track', () => {
      // clientY = 80 (above top = 100)
      const result = resolveTargetTrackFromY(80, 'video', tracks, laneBounds)
      expect(result.targetTrackId).toBe('NEW_VIDEO_TRACK')
      expect(result.isCompatible).toBe(true)
    })

    it('targets existing video track when dragged into top area of topmost video track', () => {
      // clientY = 105 (inside video 1: 100 to 160)
      const result = resolveTargetTrackFromY(105, 'video', tracks, laneBounds)
      expect(result.targetTrackId).toBe('track-v1')
      expect(result.isCompatible).toBe(true)
    })

    it('targets existing video track when dragged inside video lane body', () => {
      // clientY = 130
      const result = resolveTargetTrackFromY(130, 'video', tracks, laneBounds)
      expect(result.targetTrackId).toBe('track-v1')
      expect(result.isCompatible).toBe(true)
    })

    it('NEVER creates new track when dragged downwards into audio track; marks incompatible', () => {
      // clientY = 180 (inside Audio 1)
      const result = resolveTargetTrackFromY(180, 'video', tracks, laneBounds)
      expect(result.targetTrackId).toBe('track-a1')
      expect(result.isCompatible).toBe(false)
      expect(result.targetTrackId).not.toBe('NEW_VIDEO_TRACK')
    })

    it('NEVER creates new track when dragged downwards below all tracks; marks incompatible', () => {
      // clientY = 300 (below all tracks)
      const result = resolveTargetTrackFromY(300, 'video', tracks, laneBounds)
      expect(result.targetTrackId).toBe('track-a1')
      expect(result.isCompatible).toBe(false)
      expect(result.targetTrackId).not.toBe('NEW_VIDEO_TRACK')
    })
  })

  describe('Audio Asset Dragging', () => {
    it('creates NEW_AUDIO_TRACK when dragged downwards below bottommost audio track', () => {
      // clientY = 240 (below bottom = 220)
      const result = resolveTargetTrackFromY(240, 'audio', tracks, laneBounds)
      expect(result.targetTrackId).toBe('NEW_AUDIO_TRACK')
      expect(result.isCompatible).toBe(true)
    })

    it('targets existing audio track when dragged into bottom area of bottommost audio track', () => {
      // clientY = 215 (inside 160 to 220)
      const result = resolveTargetTrackFromY(215, 'audio', tracks, laneBounds)
      expect(result.targetTrackId).toBe('track-a1')
      expect(result.isCompatible).toBe(true)
    })

    it('targets existing audio track when dragged inside audio lane body', () => {
      // clientY = 190
      const result = resolveTargetTrackFromY(190, 'audio', tracks, laneBounds)
      expect(result.targetTrackId).toBe('track-a1')
      expect(result.isCompatible).toBe(true)
    })

    it('NEVER creates new track when dragged upwards into video track; marks incompatible', () => {
      // clientY = 130 (inside Video 1)
      const result = resolveTargetTrackFromY(130, 'audio', tracks, laneBounds)
      expect(result.targetTrackId).toBe('track-v1')
      expect(result.isCompatible).toBe(false)
      expect(result.targetTrackId).not.toBe('NEW_AUDIO_TRACK')
    })

    it('NEVER creates new track when dragged upwards above all tracks; marks incompatible', () => {
      // clientY = 50 (above all tracks)
      const result = resolveTargetTrackFromY(50, 'audio', tracks, laneBounds)
      expect(result.targetTrackId).toBe('track-v1')
      expect(result.isCompatible).toBe(false)
      expect(result.targetTrackId).not.toBe('NEW_AUDIO_TRACK')
    })
  })

  describe('Multi-track stacking', () => {
    const multiTracks: Track[] = [
      { id: 'track-v2', name: 'Video 2', type: 'video', visible: true, locked: false },
      { id: 'track-v1', name: 'Video 1', type: 'video', visible: true, locked: false },
      { id: 'track-a1', name: 'Audio 1', type: 'audio', muted: false, locked: false },
      { id: 'track-a2', name: 'Audio 2', type: 'audio', muted: false, locked: false },
    ]

    const multiBounds: TrackLaneBounds[] = [
      { trackId: 'track-v2', top: 100, bottom: 160 },
      { trackId: 'track-v1', top: 160, bottom: 220 },
      { trackId: 'track-a1', top: 220, bottom: 280 },
      { trackId: 'track-a2', top: 280, bottom: 340 },
    ]

    it('creates NEW_VIDEO_TRACK only when dragged above topmost video track (Video 2)', () => {
      const result = resolveTargetTrackFromY(90, 'video', multiTracks, multiBounds)
      expect(result.targetTrackId).toBe('NEW_VIDEO_TRACK')
      expect(result.isCompatible).toBe(true)
    })

    it('moves to Video 2 when dragged from Video 1 up into Video 2', () => {
      const result = resolveTargetTrackFromY(130, 'video', multiTracks, multiBounds)
      expect(result.targetTrackId).toBe('track-v2')
      expect(result.isCompatible).toBe(true)
    })

    it('moves to Video 1 when dragged from Video 2 down into Video 1 without creating track', () => {
      const result = resolveTargetTrackFromY(190, 'video', multiTracks, multiBounds)
      expect(result.targetTrackId).toBe('track-v1')
      expect(result.isCompatible).toBe(true)
    })

    it('creates NEW_AUDIO_TRACK only when dragged below bottommost audio track (Audio 2)', () => {
      const result = resolveTargetTrackFromY(350, 'audio', multiTracks, multiBounds)
      expect(result.targetTrackId).toBe('NEW_AUDIO_TRACK')
      expect(result.isCompatible).toBe(true)
    })

    it('moves to Audio 2 when dragged from Audio 1 down into Audio 2', () => {
      const result = resolveTargetTrackFromY(300, 'audio', multiTracks, multiBounds)
      expect(result.targetTrackId).toBe('track-a2')
      expect(result.isCompatible).toBe(true)
    })

    it('moves to Audio 1 when dragged from Audio 2 up into Audio 1 without creating track', () => {
      const result = resolveTargetTrackFromY(250, 'audio', multiTracks, multiBounds)
      expect(result.targetTrackId).toBe('track-a1')
      expect(result.isCompatible).toBe(true)
    })
  })

  describe('Empty / Blank Timeline (No Visible Tracks)', () => {
    it('resolves existing video track (track-v1) when video is dragged over blank timeline', () => {
      const result = resolveTargetTrackFromY(100, 'video', tracks, [])
      expect(result.targetTrackId).toBe('track-v1')
      expect(result.isCompatible).toBe(true)
    })

    it('resolves existing audio track (track-a1) when audio is dragged over blank timeline', () => {
      const result = resolveTargetTrackFromY(100, 'audio', tracks, [])
      expect(result.targetTrackId).toBe('track-a1')
      expect(result.isCompatible).toBe(true)
    })
  })

  describe('Single-Type Visible Tracks', () => {
    const onlyVideoBounds: TrackLaneBounds[] = [
      { trackId: 'track-v1', top: 100, bottom: 160 },
    ]

    it('targets existing audio track (track-a1) when audio is dragged below visible video lane', () => {
      const result = resolveTargetTrackFromY(200, 'audio', tracks, onlyVideoBounds)
      expect(result.targetTrackId).toBe('track-a1')
      expect(result.isCompatible).toBe(true)
    })

    it('marks audio drop as incompatible when dragged directly inside video lane', () => {
      const result = resolveTargetTrackFromY(130, 'audio', tracks, onlyVideoBounds)
      expect(result.targetTrackId).toBe('track-a1')
      expect(result.isCompatible).toBe(false)
    })
  })

  describe('Single-clip constraint (allowNewTrack = false)', () => {
    it('clamps upwards video drag to topmost video track instead of creating NEW_VIDEO_TRACK', () => {
      // clientY = 70 (above topmost video top = 100)
      const result = resolveTargetTrackFromY(70, 'video', tracks, laneBounds, false)
      expect(result.targetTrackId).toBe('track-v1')
      expect(result.isCompatible).toBe(true)
    })

    it('clamps downwards audio drag to bottommost audio track instead of creating NEW_AUDIO_TRACK', () => {
      // clientY = 250 (below bottommost audio bottom = 220)
      const result = resolveTargetTrackFromY(250, 'audio', tracks, laneBounds, false)
      expect(result.targetTrackId).toBe('track-a1')
      expect(result.isCompatible).toBe(true)
    })
  })
})

describe('getCorrespondingLayerTrack', () => {
  const multiTracks: Track[] = [
    { id: 'track-v2', name: 'Video 2', type: 'video', visible: true, locked: false },
    { id: 'track-v1', name: 'Video 1', type: 'video', visible: true, locked: false },
    { id: 'track-a1', name: 'Audio 1', type: 'audio', muted: false, locked: false },
    { id: 'track-a2', name: 'Audio 2', type: 'audio', muted: false, locked: false },
  ]

  it('symmetrically maps Layer 1 Video to Layer 1 Audio', () => {
    expect(getCorrespondingLayerTrack(multiTracks, 'video', 'track-v1', 'audio')).toBe('track-a1')
  })

  it('symmetrically maps Layer 1 Audio to Layer 1 Video', () => {
    expect(getCorrespondingLayerTrack(multiTracks, 'audio', 'track-a1', 'video')).toBe('track-v1')
  })

  it('symmetrically maps Layer 2 Video to Layer 2 Audio', () => {
    expect(getCorrespondingLayerTrack(multiTracks, 'video', 'track-v2', 'audio')).toBe('track-a2')
  })

  it('symmetrically maps Layer 2 Audio to Layer 2 Video', () => {
    expect(getCorrespondingLayerTrack(multiTracks, 'audio', 'track-a2', 'video')).toBe('track-v2')
  })

  it('targets NEW_AUDIO_TRACK when video target creates layer 3 and Audio 3 does not exist', () => {
    expect(getCorrespondingLayerTrack(multiTracks, 'video', 'NEW_VIDEO_TRACK', 'audio')).toBe('NEW_AUDIO_TRACK')
  })

  it('targets NEW_VIDEO_TRACK when audio target creates layer 3 and Video 3 does not exist', () => {
    expect(getCorrespondingLayerTrack(multiTracks, 'audio', 'NEW_AUDIO_TRACK', 'video')).toBe('NEW_VIDEO_TRACK')
  })

  it('targets NEW_AUDIO_TRACK when video targets Video 2 but audio only has Audio 1', () => {
    const singleLayerTracks: Track[] = [
      { id: 'track-v2', name: 'Video 2', type: 'video', visible: true, locked: false },
      { id: 'track-v1', name: 'Video 1', type: 'video', visible: true, locked: false },
      { id: 'track-a1', name: 'Audio 1', type: 'audio', muted: false, locked: false },
    ]
    expect(getCorrespondingLayerTrack(singleLayerTracks, 'video', 'track-v2', 'audio')).toBe('NEW_AUDIO_TRACK')
  })
})


