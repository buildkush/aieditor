import { describe, it, expect } from 'vitest'
import type { TimelineItem } from './types'
import { DEFAULT_TRANSFORM, DEFAULT_CROP, DEFAULT_AUDIO_PROPERTIES } from './types'
import {
  evaluateKeyframeTrack,
  evaluateItemTransform,
  evaluateItemCrop,
  evaluateItemAudio,
  hasKeyframeAtPlayhead,
  isPropertyKeyframed,
  getAdjacentKeyframes,
  getAllKeyframeTimes,
  normalizePropertyKey,
} from './keyframeEvaluation'
import type { Keyframe } from './keyframeTypes'

describe('Keyframe Evaluation Engine', () => {
  const baseItem: TimelineItem = {
    id: 'clip-1',
    trackId: 'track-v1',
    assetId: 'asset-1',
    startTime: 2,
    duration: 10,
    sourceIn: 0,
    sourceOut: 10,
    transform: { ...DEFAULT_TRANSFORM, x: 100, y: 50, scale: 1.0, rotation: 10, opacity: 1 },
    crop: { ...DEFAULT_CROP, left: 10, right: 20 },
    audio: { ...DEFAULT_AUDIO_PROPERTIES, volume: 0.8, pan: 0.2 },
  }

  describe('Pure Track Evaluation', () => {
    it('returns fallback value when track is empty or undefined', () => {
      expect(evaluateKeyframeTrack(undefined, 5, 42)).toBe(42)
      expect(evaluateKeyframeTrack([], 5, 42)).toBe(42)
    })

    it('returns exact value when only one keyframe exists', () => {
      const track: Keyframe<number>[] = [{ id: 'k1', time: 5, value: 200, interpolation: 'linear' }]
      expect(evaluateKeyframeTrack(track, 2, 0)).toBe(200) // Before first
      expect(evaluateKeyframeTrack(track, 5, 0)).toBe(200) // At exact
      expect(evaluateKeyframeTrack(track, 8, 0)).toBe(200) // After last
    })

    it('returns first keyframe value before first keyframe, last after last', () => {
      const track: Keyframe<number>[] = [
        { id: 'k1', time: 2, value: 100, interpolation: 'linear' },
        { id: 'k2', time: 6, value: 500, interpolation: 'linear' },
      ]
      expect(evaluateKeyframeTrack(track, 0, 0)).toBe(100)
      expect(evaluateKeyframeTrack(track, 1.99, 0)).toBe(100)
      expect(evaluateKeyframeTrack(track, 6, 0)).toBe(500)
      expect(evaluateKeyframeTrack(track, 10, 0)).toBe(500)
    })

    it('evaluates exact keyframe value at keyframe timestamp', () => {
      const track: Keyframe<number>[] = [
        { id: 'k1', time: 2, value: 100, interpolation: 'linear' },
        { id: 'k2', time: 6, value: 500, interpolation: 'linear' },
      ]
      expect(evaluateKeyframeTrack(track, 2, 0)).toBe(100)
      expect(evaluateKeyframeTrack(track, 6, 0)).toBe(500)
    })

    it('linearly interpolates between two keyframes', () => {
      const track: Keyframe<number>[] = [
        { id: 'k1', time: 2, value: 100, interpolation: 'linear' },
        { id: 'k2', time: 6, value: 500, interpolation: 'linear' },
      ]
      // At t=4 (midpoint): 100 + 0.5 * (500 - 100) = 300
      expect(evaluateKeyframeTrack(track, 4, 0)).toBeCloseTo(300, 3)
      // At t=3 (25%): 100 + 0.25 * 400 = 200
      expect(evaluateKeyframeTrack(track, 3, 0)).toBeCloseTo(200, 3)
    })

    it('evaluates ease-in interpolation', () => {
      const track: Keyframe<number>[] = [
        { id: 'k1', time: 0, value: 0, interpolation: 'ease-in' },
        { id: 'k2', time: 4, value: 100, interpolation: 'linear' },
      ]
      // Ease-in starts slower: at t=2 (t=0.5), value should be less than linear (50)
      const mid = evaluateKeyframeTrack(track, 2, 0)
      expect(mid).toBeLessThan(50)
      expect(mid).toBeGreaterThan(0)
    })

    it('evaluates ease-out interpolation', () => {
      const track: Keyframe<number>[] = [
        { id: 'k1', time: 0, value: 0, interpolation: 'ease-out' },
        { id: 'k2', time: 4, value: 100, interpolation: 'linear' },
      ]
      // Ease-out starts faster: at t=2 (t=0.5), value should be greater than linear (50)
      const mid = evaluateKeyframeTrack(track, 2, 0)
      expect(mid).toBeGreaterThan(50)
      expect(mid).toBeLessThan(100)
    })

    it('evaluates ease-in-out interpolation', () => {
      const track: Keyframe<number>[] = [
        { id: 'k1', time: 0, value: 0, interpolation: 'ease-in-out' },
        { id: 'k2', time: 4, value: 100, interpolation: 'linear' },
      ]
      // At exact midpoint, ease-in-out is symmetrical (50)
      expect(evaluateKeyframeTrack(track, 2, 0)).toBeCloseTo(50, 2)
      // At 25% (t=1), it is slower than linear 25
      expect(evaluateKeyframeTrack(track, 1, 0)).toBeLessThan(25)
      // At 75% (t=3), it is faster than linear 75
      expect(evaluateKeyframeTrack(track, 3, 0)).toBeGreaterThan(75)
    })

    it('evaluates hold interpolation', () => {
      const track: Keyframe<number>[] = [
        { id: 'k1', time: 0, value: 10, interpolation: 'hold' },
        { id: 'k2', time: 4, value: 50, interpolation: 'linear' },
      ]
      // Hold maintains k1's value until k2
      expect(evaluateKeyframeTrack(track, 1, 0)).toBe(10)
      expect(evaluateKeyframeTrack(track, 3.99, 0)).toBe(10)
      expect(evaluateKeyframeTrack(track, 4, 0)).toBe(50)
    })

    it('evaluates multiple keyframes across timeline', () => {
      const track: Keyframe<number>[] = [
        { id: 'k1', time: 0, value: 0, interpolation: 'linear' },
        { id: 'k2', time: 2, value: 100, interpolation: 'linear' },
        { id: 'k3', time: 4, value: 50, interpolation: 'linear' },
        { id: 'k4', time: 6, value: 200, interpolation: 'linear' },
      ]
      expect(evaluateKeyframeTrack(track, 1, 0)).toBeCloseTo(50)
      expect(evaluateKeyframeTrack(track, 3, 0)).toBeCloseTo(75)
      expect(evaluateKeyframeTrack(track, 5, 0)).toBeCloseTo(125)
    })
  })

  describe('Item Property Evaluation & Static Fallback', () => {
    it('returns static item transform values when no keyframes exist', () => {
      const tf = evaluateItemTransform(baseItem, 5)
      expect(tf.x).toBe(100)
      expect(tf.y).toBe(50)
      expect(tf.scale).toBe(1.0)
      expect(tf.rotation).toBe(10)
      expect(tf.opacity).toBe(1)
    })

    it('returns static crop and audio values when no keyframes exist', () => {
      const crop = evaluateItemCrop(baseItem, 5)
      expect(crop.left).toBe(10)
      expect(crop.right).toBe(20)

      const audio = evaluateItemAudio(baseItem, 5)
      expect(audio.volume).toBe(0.8)
      expect(audio.pan).toBe(0.2)
    })

    it('evaluates animated properties while preserving static ones', () => {
      const animatedItem: TimelineItem = {
        ...baseItem,
        keyframes: {
          x: [
            { id: 'k1', time: 2, value: 0, interpolation: 'linear' },
            { id: 'k2', time: 6, value: 400, interpolation: 'linear' },
          ],
        },
      }

      // X is animated
      expect(evaluateItemTransform(animatedItem, 2).x).toBe(0)
      expect(evaluateItemTransform(animatedItem, 4).x).toBeCloseTo(200)
      expect(evaluateItemTransform(animatedItem, 6).x).toBe(400)

      // Y, rotation, opacity remain static
      expect(evaluateItemTransform(animatedItem, 4).y).toBe(50)
      expect(evaluateItemTransform(animatedItem, 4).rotation).toBe(10)
      expect(evaluateItemTransform(animatedItem, 4).opacity).toBe(1)
    })

    it('interpolates multiple independent properties simultaneously', () => {
      const animatedItem: TimelineItem = {
        ...baseItem,
        keyframes: {
          x: [
            { id: 'kx1', time: 0, value: 0, interpolation: 'linear' },
            { id: 'kx2', time: 10, value: 1000, interpolation: 'linear' },
          ],
          scale: [
            { id: 'ks1', time: 2, value: 1, interpolation: 'linear' },
            { id: 'ks2', time: 6, value: 3, interpolation: 'linear' },
          ],
          rotation: [
            { id: 'kr1', time: 4, value: 0, interpolation: 'linear' },
            { id: 'kr2', time: 8, value: 360, interpolation: 'linear' },
          ],
          cropLeft: [
            { id: 'kc1', time: 0, value: 0, interpolation: 'linear' },
            { id: 'kc2', time: 5, value: 50, interpolation: 'linear' },
          ],
        },
      }

      // At t=5:
      // x: midpoint of 0 to 10 -> 500
      // scale: after last keyframe at 6 -> 3.0
      // rotation: midpoint of 4 to 8 -> 180
      // cropLeft: exact keyframe at 5 -> 50
      const tf = evaluateItemTransform(animatedItem, 5)
      expect(tf.x).toBeCloseTo(500)
      expect(tf.scale).toBeCloseTo(2.5) // (5 - 2)/(6 - 2) * 2 + 1 = 0.75 * 2 + 1 = 2.5
      expect(tf.rotation).toBeCloseTo(90) // (5 - 4)/(8 - 4) * 360 = 0.25 * 360 = 90

      const crop = evaluateItemCrop(animatedItem, 5)
      expect(crop.left).toBeCloseTo(50)
    })

    it('evaluates crop validation rules (values clamped 0 to 100)', () => {
      const animatedCrop: TimelineItem = {
        ...baseItem,
        crop: { left: 0, right: 0, top: 0, bottom: 0 },
        keyframes: {
          cropLeft: [
            { id: 'c1', time: 0, value: -10, interpolation: 'linear' },
            { id: 'c2', time: 10, value: 150, interpolation: 'linear' },
          ],
        },
      }
      expect(evaluateItemCrop(animatedCrop, 0).left).toBe(0)
      expect(evaluateItemCrop(animatedCrop, 10).left).toBeCloseTo(99.9, 1)
    })
  })

  describe('Keyframe Navigation & Helpers', () => {
    const itemWithKfs: TimelineItem = {
      ...baseItem,
      keyframes: {
        x: [
          { id: 'k1', time: 2, value: 100, interpolation: 'linear' },
          { id: 'k2', time: 5, value: 300, interpolation: 'linear' },
        ],
        rotation: [
          { id: 'k3', time: 3.5, value: 45, interpolation: 'linear' },
        ],
      },
    }

    it('checks hasKeyframeAtPlayhead accurately with tolerance', () => {
      expect(hasKeyframeAtPlayhead(itemWithKfs, 'x', 2.0)).toBe(true)
      expect(hasKeyframeAtPlayhead(itemWithKfs, 'x', 2.005, 0.01)).toBe(true)
      expect(hasKeyframeAtPlayhead(itemWithKfs, 'x', 2.1)).toBe(false)
      expect(hasKeyframeAtPlayhead(itemWithKfs, 'x', 5.0)).toBe(true)
      expect(hasKeyframeAtPlayhead(itemWithKfs, 'rotation', 3.5)).toBe(true)
      expect(hasKeyframeAtPlayhead(itemWithKfs, 'scale', 2.0)).toBe(false)
    })

    it('checks isPropertyKeyframed', () => {
      expect(isPropertyKeyframed(itemWithKfs, 'x')).toBe(true)
      expect(isPropertyKeyframed(itemWithKfs, 'positionX')).toBe(true)
      expect(isPropertyKeyframed(itemWithKfs, 'rotation')).toBe(true)
      expect(isPropertyKeyframed(itemWithKfs, 'scale')).toBe(false)
    })

    it('retrieves adjacent prev and next keyframes correctly', () => {
      const { prev: p1, next: n1 } = getAdjacentKeyframes(itemWithKfs, 'x', 1.0)
      expect(p1).toBeNull()
      expect(n1?.time).toBe(2)

      const { prev: p2, next: n2 } = getAdjacentKeyframes(itemWithKfs, 'x', 3.0)
      expect(p2?.time).toBe(2)
      expect(n2?.time).toBe(5)

      const { prev: p3, next: n3 } = getAdjacentKeyframes(itemWithKfs, 'x', 6.0)
      expect(p3?.time).toBe(5)
      expect(n3).toBeNull()
    })

    it('retrieves all sorted unique keyframe timestamps on an item', () => {
      const times = getAllKeyframeTimes(itemWithKfs)
      expect(times).toEqual([2, 3.5, 5])
    })

    it('evaluates boosted volume beyond 100% and clamped stereo pan', () => {
      const audioItem: TimelineItem = {
        ...baseItem,
        audio: { volume: 2.5, pan: -0.8, muted: false },
      }

      const audio = evaluateItemAudio(audioItem, 5)
      expect(audio.volume).toBe(2.5)
      expect(audio.pan).toBe(-0.8)

      // Out of bounds pan is clamped to [-1, 1]
      const clampedItem: TimelineItem = {
        ...baseItem,
        audio: { volume: 3.0, pan: 1.5, muted: false },
      }
      expect(evaluateItemAudio(clampedItem, 5).pan).toBe(1.0)
    })

    it('interpolates keyframed volume (> 100%) and pan smoothly across timeline', () => {
      const animatedAudioItem: TimelineItem = {
        ...baseItem,
        audio: { volume: 1.0, pan: -1.0, muted: false },
        keyframes: {
          volume: [
            { id: 'k-v1', time: 2, value: 1.0, interpolation: 'linear' },
            { id: 'k-v2', time: 6, value: 3.0, interpolation: 'linear' },
          ],
          pan: [
            { id: 'k-p1', time: 2, value: -1.0, interpolation: 'linear' },
            { id: 'k-p2', time: 6, value: 1.0, interpolation: 'linear' },
          ],
        },
      }

      // Midpoint at 4.0s
      const mid = evaluateItemAudio(animatedAudioItem, 4.0)
      expect(mid.volume).toBeCloseTo(2.0)
      expect(mid.pan).toBeCloseTo(0.0)

      // At 6.0s
      const end = evaluateItemAudio(animatedAudioItem, 6.0)
      expect(end.volume).toBeCloseTo(3.0)
      expect(end.pan).toBeCloseTo(1.0)
    })

    it('normalizes property keys correctly', () => {
      expect(normalizePropertyKey('positionX')).toBe('x')
      expect(normalizePropertyKey('pos_x')).toBe('x')
      expect(normalizePropertyKey('zoom')).toBe('scale')
      expect(normalizePropertyKey('cropLeft')).toBe('cropLeft')
      expect(normalizePropertyKey('crop_left')).toBe('cropLeft')
    })
  })
})
