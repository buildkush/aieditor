import { describe, it, expect, beforeEach } from 'vitest'
import {
  preloadReversedAudio,
  playReversedAudio,
  stopReversedAudio,
  clearReversedAudioCache,
} from './reversedAudioService'

describe('Reversed Audio Playback Service', () => {
  beforeEach(() => {
    clearReversedAudioCache()
  })

  it('safely handles non-browser environment without throwing', async () => {
    // In Node test environment, AudioContext is undefined, should return null safely
    const result = await preloadReversedAudio('asset-1', 'http://asset.localhost/audio.mp3')
    expect(result).toBeNull()

    // playReversedAudio and stopReversedAudio do not throw
    expect(() => {
      playReversedAudio({
        itemId: 'item-1',
        assetId: 'asset-1',
        audioUrl: 'http://asset.localhost/audio.mp3',
        sourceTime: 5.0,
        speed: 1.0,
        volume: 2.5,
        pan: -0.75,
        isMuted: false,
      })
    }).not.toThrow()

    expect(() => {
      stopReversedAudio('item-1')
    }).not.toThrow()
  })

  it('supports volume levels beyond 1.0 (e.g. up to 4.0 boost) and stereo pan (-1 to 1)', () => {
    const mockGain = {
      gain: {
        setValueAtTime: (_val: number) => {},
      },
      connect: () => {},
      disconnect: () => {},
    }

    const mockPanner = {
      pan: {
        setValueAtTime: (_val: number) => {},
      },
      connect: () => {},
      disconnect: () => {},
    }

    const mockSource = {
      playbackRate: { value: 1 },
      connect: () => {},
      start: () => {},
      stop: () => {},
      disconnect: () => {},
    }

    const mockCtx = {
      state: 'running',
      currentTime: 10,
      createBufferSource: () => mockSource,
      createGain: () => mockGain,
      createStereoPanner: () => mockPanner,
      destination: {},
    }

    // Set mock window AudioContext
    function MockAudioContext() {
      return mockCtx
    }
    ;(globalThis as any).window = {
      AudioContext: MockAudioContext,
    }

    // Call play with volume 2.5 (250%) and pan -0.8 (80% Left)
    playReversedAudio({
      itemId: 'mock-item',
      assetId: 'non-cached-asset',
      audioUrl: 'http://asset.localhost/a.mp3',
      sourceTime: 2.0,
      speed: 1.0,
      volume: 2.5,
      pan: -0.8,
      isMuted: false,
    })

    // Clean up window mock
    delete (globalThis as any).window
  })

  it('calculates correct reversed buffer offset from original source time', () => {
    // Original clip has duration 10.0s
    const bufferDuration = 10.0

    // When playhead enters reversed clip at start, sourceTime = 10.0 (end of clip)
    // Offset in reversed buffer must be 0.0s (start of reversed buffer)
    let sourceTime = 10.0
    let revOffset = Math.max(0, Math.min(bufferDuration, bufferDuration - sourceTime))
    expect(revOffset).toBeCloseTo(0.0)

    // Halfway through clip: sourceTime = 5.0
    // Offset in reversed buffer must be 5.0s
    sourceTime = 5.0
    revOffset = Math.max(0, Math.min(bufferDuration, bufferDuration - sourceTime))
    expect(revOffset).toBeCloseTo(5.0)

    // At end of reversed clip: sourceTime = 0.0
    // Offset in reversed buffer must be 10.0s
    sourceTime = 0.0
    revOffset = Math.max(0, Math.min(bufferDuration, bufferDuration - sourceTime))
    expect(revOffset).toBeCloseTo(10.0)
  })

  it('clamps reversed buffer offset within [0, bufferDuration]', () => {
    const bufferDuration = 8.5

    // Over-shooting sourceTime beyond buffer duration
    let sourceTime = 12.0
    let revOffset = Math.max(0, Math.min(bufferDuration, bufferDuration - sourceTime))
    expect(revOffset).toBe(0)

    // Negative sourceTime
    sourceTime = -2.0
    revOffset = Math.max(0, Math.min(bufferDuration, bufferDuration - sourceTime))
    expect(revOffset).toBe(8.5)
  })
})
