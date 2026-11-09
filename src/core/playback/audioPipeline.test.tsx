import { describe, it, expect } from 'vitest'
// @ts-ignore
import { renderToStaticMarkup } from 'react-dom/server'
import {
  type ProjectState,
  type TimelineItem,
  type Track,
  type MediaAsset,
  DEFAULT_AUDIO_PROPERTIES,
  DEFAULT_TRANSFORM,
} from '../../core'
import { updateItemAudio, resetItemAudio } from '../../core/commands/projectCommands'
import { evaluateItemAudio } from '../../core/timeline/keyframeEvaluation'
import { AudioLayerItem } from '../../components/preview/AudioLayerItem'
import type { ActiveAudioClip } from './timelinePlayback'

describe('Audio Volume & Stereo Pan System', () => {
  const assetAudio: MediaAsset = {
    id: 'asset-music-1',
    name: 'Music.mp3',
    type: 'audio',
    path: 'C:/media/music.mp3',
    duration: 60,
  }

  const trackAudio: Track = {
    id: 'track-a1',
    name: 'Audio 1',
    type: 'audio',
    muted: false,
  }

  const audioItem: TimelineItem = {
    id: 'item-audio-1',
    trackId: 'track-a1',
    assetId: 'asset-music-1',
    startTime: 0,
    duration: 30,
    sourceIn: 0,
    sourceOut: 30,
    streamType: 'audio',
    transform: { ...DEFAULT_TRANSFORM },
    audio: {
      volume: 1.0,
      pan: 0,
      muted: false,
    },
  }

  const baseState: ProjectState = {
    id: 'proj-1',
    name: 'Audio Test',
    settings: { width: 1920, height: 1080, fps: 30, sampleRate: 48000 },
    assets: { 'asset-music-1': assetAudio },
    tracks: [trackAudio],
    items: { 'item-audio-1': audioItem },
    playheadTime: 0,
    selectedItemId: 'item-audio-1',
  }

  it('updateItemAudio allows volume levels beyond 100% (e.g. 150%, 200%, up to 400%)', () => {
    // 150% volume (1.5)
    let state = updateItemAudio(baseState, 'item-audio-1', { volume: 1.5 })
    expect(state.items['item-audio-1'].audio?.volume).toBe(1.5)

    // 200% volume (+6dB gain)
    state = updateItemAudio(state, 'item-audio-1', { volume: 2.0 })
    expect(state.items['item-audio-1'].audio?.volume).toBe(2.0)

    // 400% volume (+12dB gain)
    state = updateItemAudio(state, 'item-audio-1', { volume: 4.0 })
    expect(state.items['item-audio-1'].audio?.volume).toBe(4.0)

    // Clamps above 4.0 to 4.0
    state = updateItemAudio(state, 'item-audio-1', { volume: 5.5 })
    expect(state.items['item-audio-1'].audio?.volume).toBe(4.0)

    // Clamps below 0 to 0
    state = updateItemAudio(state, 'item-audio-1', { volume: -0.5 })
    expect(state.items['item-audio-1'].audio?.volume).toBe(0.0)
  })

  it('updateItemAudio sets and clamps stereo pan between -1.0 (Left) and +1.0 (Right)', () => {
    // -0.5 (50% Left)
    let state = updateItemAudio(baseState, 'item-audio-1', { pan: -0.5 })
    expect(state.items['item-audio-1'].audio?.pan).toBe(-0.5)

    // +0.75 (75% Right)
    state = updateItemAudio(state, 'item-audio-1', { pan: 0.75 })
    expect(state.items['item-audio-1'].audio?.pan).toBe(0.75)

    // -1.0 (Full Left)
    state = updateItemAudio(state, 'item-audio-1', { pan: -1.0 })
    expect(state.items['item-audio-1'].audio?.pan).toBe(-1.0)

    // Clamps beyond [-1, 1]
    state = updateItemAudio(state, 'item-audio-1', { pan: -2.0 })
    expect(state.items['item-audio-1'].audio?.pan).toBe(-1.0)

    state = updateItemAudio(state, 'item-audio-1', { pan: 1.8 })
    expect(state.items['item-audio-1'].audio?.pan).toBe(1.0)
  })

  it('resetItemAudio restores default volume 1 and pan 0', () => {
    let state = updateItemAudio(baseState, 'item-audio-1', { volume: 2.5, pan: -0.8 })
    expect(state.items['item-audio-1'].audio?.volume).toBe(2.5)
    expect(state.items['item-audio-1'].audio?.pan).toBe(-0.8)

    state = resetItemAudio(state, 'item-audio-1')
    expect(state.items['item-audio-1'].audio).toEqual(DEFAULT_AUDIO_PROPERTIES)
    expect(state.items['item-audio-1'].audio?.volume).toBe(1)
    expect(state.items['item-audio-1'].audio?.pan).toBe(0)
  })

  it('evaluateItemAudio evaluates and clamps pan and respects boosted volume', () => {
    const item: TimelineItem = {
      ...audioItem,
      audio: { volume: 2.8, pan: 0.65, muted: false },
    }

    const evalProps = evaluateItemAudio(item, 5.0)
    expect(evalProps.volume).toBe(2.8)
    expect(evalProps.pan).toBe(0.65)
    expect(evalProps.muted).toBe(false)
  })

  it('AudioLayerItem renders safely without throwing in server/test environments', () => {
    const activeClip: ActiveAudioClip = {
      item: {
        ...audioItem,
        audio: { volume: 2.0, pan: -0.5, muted: false },
      },
      asset: assetAudio,
      sourceTime: 5.0,
      isMissing: false,
      isMuted: false,
      track: trackAudio,
    }

    const html = renderToStaticMarkup(
      <AudioLayerItem
        clip={activeClip}
        isPlayingForward={false}
        playheadTime={5.0}
      />
    )

    expect(html).toContain('<audio')
    expect(html).toContain('display:none')
  })
})
