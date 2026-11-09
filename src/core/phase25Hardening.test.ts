import { describe, it, expect } from 'vitest'
import { modalCoordinator } from './modalCoordinator'
import { createEmptyProjectState } from './project/projectState'
import {
  AddMediaAssetCommand,
  AddTimelineItemCommand,
  AddTimelineItemPairCommand,
  validateTimelineItem,
} from './commands/editorCommand'
import { getPlaybackFrameInfo } from './playback/timelinePlayback'
import { DEFAULT_TRANSFORM, type TimelineItem, type Track } from './timeline/types'
import { waveformCache } from './media/waveformCache'
import { filmstripCache } from './media/filmstripCache'
import { serializeProject } from './persistence/projectSerializer'
import type { MediaAsset } from './media/types'

describe('Phase 2.5 Hardening Test Suite', () => {
  // ──── 1. Modal & Picker Single-Flight Guard ────
  describe('Modal Coordinator Single-Flight', () => {
    it('executes exclusive modal operation and blocks concurrent requests', async () => {
      let runCount = 0
      let finishFirst: () => void = () => {}
      const firstPromise = new Promise<void>((resolve) => {
        finishFirst = resolve
      })

      const p1 = modalCoordinator.runExclusive('testPicker', async () => {
        runCount++
        await firstPromise
        return 'first'
      })

      // Immediate second call while first is in flight
      const p2 = modalCoordinator.runExclusive('testPicker2', async () => {
        runCount++
        return 'second'
      })

      expect(modalCoordinator.getIsBlocked()).toBe(true)

      const res2 = await p2
      expect(res2).toBeNull() // Blocked!
      expect(runCount).toBe(1)

      finishFirst()
      const res1 = await p1
      expect(res1).toBe('first')
      expect(modalCoordinator.getIsBlocked()).toBe(false)
    })

    it('resets busy state properly on error or cancellation', async () => {
      expect(modalCoordinator.getIsBlocked()).toBe(false)

      await expect(
        modalCoordinator.runExclusive('failingPicker', async () => {
          throw new Error('User cancelled / window closed')
        })
      ).rejects.toThrow('User cancelled / window closed')

      expect(modalCoordinator.getIsBlocked()).toBe(false)
    })
  })

  // ──── 2. Multi-Track Video Compositing ────
  describe('Multi-Track Video Compositing', () => {
    it('composites all active visual tracks and resolves V2 above V1', () => {
      let state = createEmptyProjectState({
        name: 'Compositing Test',
        initialTracks: [
          { id: 'track-v1', name: 'Video 1', type: 'video', visible: true, locked: false },
          { id: 'track-a1', name: 'Audio 1', type: 'audio', muted: false, locked: false },
        ],
      })
      const assetV1: MediaAsset = {
        id: 'asset-main',
        name: 'Main.mp4',
        type: 'video',
        path: '/main.mp4',
        duration: 20,
      }
      const assetV2: MediaAsset = {
        id: 'asset-broll',
        name: 'B-roll.mp4',
        type: 'video',
        path: '/broll.mp4',
        duration: 10,
      }

      state = new AddMediaAssetCommand(assetV1).execute(state)
      state = new AddMediaAssetCommand(assetV2).execute(state)

      // Add Video 2 track above Video 1
      const trackV2: Track = {
        id: 'track-v2',
        name: 'Video 2',
        type: 'video',
        visible: true,
      }
      state = { ...state, tracks: [trackV2, ...state.tracks] }

      // Item on V1 (0s -> 20s)
      const itemV1: TimelineItem = {
        id: 'item-v1',
        trackId: 'track-v1',
        assetId: 'asset-main',
        startTime: 0,
        duration: 20,
        sourceIn: 0,
        sourceOut: 20,
        transform: { ...DEFAULT_TRANSFORM, opacity: 1 },
      }

      // Item on V2 (5s -> 15s) with opacity 0.8
      const itemV2: TimelineItem = {
        id: 'item-v2',
        trackId: 'track-v2',
        assetId: 'asset-broll',
        startTime: 5,
        duration: 10,
        sourceIn: 0,
        sourceOut: 10,
        transform: { ...DEFAULT_TRANSFORM, opacity: 0.8 },
      }

      state = new AddTimelineItemCommand(itemV1).execute(state)
      state = new AddTimelineItemCommand(itemV2).execute(state)

      // At playhead 7s: both V1 and V2 overlap!
      const frameInfo = getPlaybackFrameInfo(state, 7)

      expect(frameInfo.activeVideos.length).toBe(2)
      // Level order: V1 at bottom (index 0), V2 above V1 (index 1)
      expect(frameInfo.activeVideos[0].item.id).toBe('item-v1')
      expect(frameInfo.activeVideos[0].track.name).toBe('Video 1')
      expect(frameInfo.activeVideos[1].item.id).toBe('item-v2')
      expect(frameInfo.activeVideos[1].track.name).toBe('Video 2')
      expect(frameInfo.activeVideos[1].item.transform.opacity).toBe(0.8)

      // Topmost video is V2
      expect(frameInfo.activeVideo?.item.id).toBe('item-v2')
    })
  })

  // ──── 3. Multi-Track Audio Mixing & Embedded Video Audio ────
  describe('Multi-Track Audio Mixing & Embedded Audio Stream', () => {
    it('resolves multiple overlapping audio tracks simultaneously', () => {
      let state = createEmptyProjectState({
        name: 'Audio Mixing Test',
        initialTracks: [
          { id: 'track-v1', name: 'Video 1', type: 'video', visible: true, locked: false },
          { id: 'track-a1', name: 'Audio 1', type: 'audio', muted: false, locked: false },
        ],
      })
      const musicAsset: MediaAsset = {
        id: 'asset-music',
        name: 'Music.mp3',
        type: 'audio',
        path: '/music.mp3',
        duration: 60,
      }
      const sfxAsset: MediaAsset = {
        id: 'asset-sfx',
        name: 'SFX.wav',
        type: 'audio',
        path: '/sfx.wav',
        duration: 5,
      }

      state = new AddMediaAssetCommand(musicAsset).execute(state)
      state = new AddMediaAssetCommand(sfxAsset).execute(state)

      const trackA2: Track = {
        id: 'track-a2',
        name: 'Audio 2',
        type: 'audio',
      }
      state = { ...state, tracks: [...state.tracks, trackA2] }

      const musicItem: TimelineItem = {
        id: 'item-music',
        trackId: 'track-a1',
        assetId: 'asset-music',
        startTime: 0,
        duration: 60,
        sourceIn: 0,
        sourceOut: 60,
        transform: DEFAULT_TRANSFORM,
        streamType: 'audio',
      }

      const sfxItem: TimelineItem = {
        id: 'item-sfx',
        trackId: 'track-a2',
        assetId: 'asset-sfx',
        startTime: 10,
        duration: 5,
        sourceIn: 0,
        sourceOut: 5,
        transform: DEFAULT_TRANSFORM,
        streamType: 'audio',
      }

      state = new AddTimelineItemCommand(musicItem).execute(state)
      state = new AddTimelineItemCommand(sfxItem).execute(state)

      // At playhead 12s: both Music and SFX play simultaneously
      const frameInfo = getPlaybackFrameInfo(state, 12)
      expect(frameInfo.activeAudio.length).toBe(2)
      expect(frameInfo.activeAudio.map((a) => a.asset.name)).toEqual(['Music.mp3', 'SFX.wav'])
      expect(frameInfo.activeAudio[0].sourceTime).toBe(12)
      expect(frameInfo.activeAudio[1].sourceTime).toBe(2) // 12 - 10 = 2s into SFX
    })

    it('creates linked video and audio timeline item pair in single undoable command', () => {
      let state = createEmptyProjectState({ name: 'Embedded Video Audio Test' })
      const videoWithAudio: MediaAsset = {
        id: 'asset-interview',
        name: 'Interview.mp4',
        type: 'video',
        path: '/interview.mp4',
        duration: 30,
        metadata: { width: 1920, height: 1080, audioChannels: 2, sampleRate: 48000 },
      }
      state = new AddMediaAssetCommand(videoWithAudio).execute(state)

      const videoItem: TimelineItem = {
        id: 'v-clip-1',
        trackId: 'track-v1',
        assetId: 'asset-interview',
        startTime: 0,
        duration: 30,
        sourceIn: 0,
        sourceOut: 30,
        transform: DEFAULT_TRANSFORM,
        streamType: 'video',
        linkedItemId: 'a-clip-1',
      }

      const audioItem: TimelineItem = {
        id: 'a-clip-1',
        trackId: 'track-a1',
        assetId: 'asset-interview',
        startTime: 0,
        duration: 30,
        sourceIn: 0,
        sourceOut: 30,
        transform: DEFAULT_TRANSFORM,
        streamType: 'audio',
        linkedItemId: 'v-clip-1',
      }

      const pairCommand = new AddTimelineItemPairCommand(videoItem, audioItem)
      state = pairCommand.execute(state)

      // Both items exist on their respective tracks referencing the SAME source asset
      expect(state.items['v-clip-1']).toBeDefined()
      expect(state.items['a-clip-1']).toBeDefined()
      expect(state.items['v-clip-1'].assetId).toBe('asset-interview')
      expect(state.items['a-clip-1'].assetId).toBe('asset-interview')
      expect(state.items['v-clip-1'].streamType).toBe('video')
      expect(state.items['a-clip-1'].streamType).toBe('audio')
      expect(state.items['v-clip-1'].linkedItemId).toBe('a-clip-1')
      expect(state.items['a-clip-1'].linkedItemId).toBe('v-clip-1')
    })
  })

  // ──── 4. Filmstrip & Waveform Caches Decoupled from ProjectState ────
  describe('Filmstrip & Waveform Caches (Project Separation)', () => {
    it('waveformCache stores and retrieves peaks locally without polluting ProjectState', async () => {
      const assetId = 'test-audio-cache'
      const peaks = [0.1, 0.4, 0.8, 0.2]
      waveformCache.set(assetId, peaks)

      expect(waveformCache.get(assetId)).toEqual(peaks)
      expect(waveformCache.has(assetId)).toBe(true)

      // ProjectState serialization does NOT include waveformCache
      const state = createEmptyProjectState({ name: 'State Isolation Test' })
      const serialized = serializeProject(state)
      expect(serialized).not.toContain('waveform')
      expect(serialized).not.toContain('peaks')
    })

    it('filmstripCache stores frame thumbnails locally without polluting ProjectState', () => {
      const assetId = 'test-filmstrip-cache'
      filmstripCache.set(assetId, 5.0, 'data:image/jpeg;base64,sampleFrame5s')

      expect(filmstripCache.get(assetId, 5.0)).toBe('data:image/jpeg;base64,sampleFrame5s')
      expect(filmstripCache.has(assetId, 5.0)).toBe(true)

      const state = createEmptyProjectState({ name: 'State Isolation Test' })
      const serialized = serializeProject(state)
      expect(serialized).not.toContain('sampleFrame5s')
    })
  })

  // ──── 5. Timeline Track Type Safety ────
  describe('Timeline Track Type Safety', () => {
    it('strictly forbids video item on audio track and vice versa', () => {
      let state = createEmptyProjectState({
        initialTracks: [
          { id: 'track-v1', name: 'Video 1', type: 'video', visible: true, locked: false },
          { id: 'track-a1', name: 'Audio 1', type: 'audio', muted: false, locked: false },
        ],
      })
      const vAsset: MediaAsset = {
        id: 'v-1',
        name: 'V.mp4',
        type: 'video',
        path: '/v.mp4',
        duration: 10,
      }
      state = new AddMediaAssetCommand(vAsset).execute(state)

      // Video item with streamType: video cannot be on track-a1
      const videoOnAudioItem: TimelineItem = {
        id: 'item-invalid',
        trackId: 'track-a1',
        assetId: 'v-1',
        startTime: 0,
        duration: 10,
        sourceIn: 0,
        sourceOut: 10,
        transform: DEFAULT_TRANSFORM,
        streamType: 'video',
      }

      const errors = validateTimelineItem(videoOnAudioItem, state)
      expect(errors.length).toBeGreaterThan(0)
      expect(errors[0]).toContain("is incompatible with track type 'audio'")

      // Adding it via AddTimelineItemCommand fails safely
      const nextState = new AddTimelineItemCommand(videoOnAudioItem).execute(state)
      expect(nextState.items['item-invalid']).toBeUndefined()
    })
  })
})
