import { describe, expect, it } from 'vitest'
import { evaluateTransitionVisual } from './transitionEvaluation'
import { DEFAULT_TRANSFORM, type TimelineItem, type TimelineTransition } from '../timeline/types'
import { TRANSITION_DEFINITIONS, normalizeTransitionId } from '../timeline/transitionDefinitions'
import { getPlaybackFrameInfo } from './timelinePlayback'
import { createEmptyProjectState } from '../project/projectState'

const left: TimelineItem = { id: 'left', trackId: 'track-v1', assetId: 'a', startTime: 0, duration: 4,
  sourceIn: 0, sourceOut: 4, transform: { ...DEFAULT_TRANSFORM } }
const right: TimelineItem = { ...left, id: 'right', assetId: 'b', startTime: 4 }
function transition(id: string, params: TimelineTransition['params'] = {}): TimelineTransition {
  return { id: 'transition', transitionId: id, name: id, trackId: 'track-v1', startTime: 3.5, duration: 1,
    leftClipId: 'left', rightClipId: 'right', params }
}
function visual(id: string, p: number, incoming: boolean, params: TimelineTransition['params'] = {}, width = 1920, height = 1080) {
  return evaluateTransitionVisual({ transition: transition(id, params), progress: p }, incoming ? right : left, width, height, 1)
}

describe('transition rendering', () => {
  it.each(['tr-push-left', 'tr-slide-up'])('%s covers the entire frame in every direction throughout the cut', id => {
    for (const [width, height] of [[1920, 1080], [1080, 1920]]) {
      for (const direction of ['left', 'right', 'up', 'down']) {
        for (const intensity of [0, 40, 100]) {
          for (let frame = 0; frame <= 60; frame++) {
            const p = frame / 60
            const outgoing = visual(id, p, false, { direction, intensity }, width, height)
            const incoming = visual(id, p, true, { direction, intensity }, width, height)
            const horizontal = direction === 'left' || direction === 'right'
            const span = horizontal ? width : height
            const offsets = horizontal ? [outgoing.x, incoming.x] : [outgoing.y, incoming.y]
            const intervals = offsets.map(offset => [offset - span / 2, offset + span / 2]).sort((a, b) => a[0] - b[0])
            expect(intervals[0][0]).toBeLessThanOrEqual(-span / 2 + 0.00001)
            expect(intervals[1][1]).toBeGreaterThanOrEqual(span / 2 - 0.00001)
            expect(intervals[0][1]).toBeGreaterThanOrEqual(intervals[1][0] - 0.00001)
          }
        }
      }
    }
  })

  it('Whip covers pan displacement and blur fringes instead of exposing black borders', () => {
    for (const [width, height] of [[1920, 1080], [1080, 1920]]) {
      for (const direction of ['left', 'right', 'up', 'down']) {
        for (let frame = 1; frame < 60; frame++) {
          for (const incoming of [true, false]) {
            const v = visual('tr-whip-pan', frame / 60, incoming, { direction }, width, height)
            const blur = Number(v.filter.match(/blur\(([^p]+)/)?.[1] ?? 0)
            expect(v.x - width * v.scale / 2 + blur * 3).toBeLessThanOrEqual(-width / 2 + 0.002)
            expect(v.x + width * v.scale / 2 - blur * 3).toBeGreaterThanOrEqual(width / 2 - 0.002)
            expect(v.y - height * v.scale / 2 + blur * 3).toBeLessThanOrEqual(-height / 2 + 0.002)
            expect(v.y + height * v.scale / 2 - blur * 3).toBeGreaterThanOrEqual(height / 2 - 0.002)
          }
        }
      }
    }
  })

  it.each(['tr-whip-pan', 'tr-glitch', 'tr-zoom-in'])('%s starts and ends at the normal clip transform', id => {
    for (const [p, incoming] of [[0, false], [1, true]] as const) {
      const v = visual(id, p, incoming)
      expect(v.x).toBeCloseTo(0)
      expect(v.y).toBeCloseTo(0)
      expect(v.scale).toBeCloseTo(1)
      expect(v.opacity).toBe(1)
      expect(v.filter).toBe('')
    }
    expect(visual(id, 0, true).opacity).toBe(0)
  })

  it('single-clip start and end slides enter and leave on the correct boundary', () => {
    const start = { ...transition('tr-slide-up'), leftClipId: undefined, rightClipId: 'right', startTime: 4 }
    const end = { ...transition('tr-slide-up'), rightClipId: undefined, startTime: 3 }
    expect(evaluateTransitionVisual({ transition: start, progress: 1 }, right, 1920, 1080, 1).y).toBe(0)
    expect(evaluateTransitionVisual({ transition: end, progress: 0 }, left, 1920, 1080, 1).y).toBeCloseTo(0)
    expect(evaluateTransitionVisual({ transition: end, progress: 1 }, left, 1920, 1080, 1).y).toBe(-1080)
  })

  it('White uses an actual white overlay while Black remains an intentional dip', () => {
    expect(visual('tr-dip-to-white', 0.5, true).whiteOpacity).toBe(1)
    expect(visual('tr-dip-to-black', 0.5, true).filter).toBe('brightness(0.0000)')
  })

  it('counterclockwise wipe starts hidden and finishes fully revealed', () => {
    expect(visual('tr-clock-wipe', 0, true, { direction: 'counterClockwise' }).maskImage).toContain('#000 0deg 0deg')
    expect(visual('tr-clock-wipe', 1, true, { direction: 'counterClockwise' }).maskImage).toContain('#000 0deg 360deg')
    expect(visual('tr-clock-wipe', 0.5, false).maskImage).toBeUndefined()
  })

  it('Zoom Out does not shrink both clips away from the frame', () => {
    for (let frame = 0; frame <= 60; frame++) {
      for (const incoming of [true, false]) {
        expect(visual('tr-zoom-in', frame / 60, incoming, { mode: 'zoomOut' }).scale).toBeGreaterThanOrEqual(1)
      }
    }
  })

  it('keeps the editable crop during a wipe', () => {
    const v = evaluateTransitionVisual({ transition: transition('tr-linear-wipe'), progress: 0.5 }, right,
      1920, 1080, 1, { top: 10, right: 15, bottom: 20, left: 5 })
    expect(v.clipPath).toBe('inset(10% 50% 20% 5%)')
  })

  it('Digital Glitch produces tearing, RGB separation, and noise instead of a hue cycle', () => {
    const frame = visual('tr-glitch', 0.5, true)
    expect(frame.glitch?.displacement).toBeGreaterThan(18)
    expect(frame.glitch?.rgbOffset).toBeGreaterThan(3)
    expect(frame.glitch?.noiseOpacity).toBeGreaterThan(0.2)
    expect(frame.filter).not.toContain('hue-rotate')
    expect(frame.scale).toBeGreaterThan(1)
  })

  it('Glitch noise follows timeline frames and is repeatable when scrubbing', () => {
    expect(visual('tr-glitch', 0.4, true)).toEqual(visual('tr-glitch', 0.4, true))
    expect(visual('tr-glitch', 0.4, true).glitch?.seed).not.toBe(visual('tr-glitch', 0.46, true).glitch?.seed)
    expect(visual('tr-glitch', 0, false).glitch).toBeUndefined()
    expect(visual('tr-glitch', 1, true).glitch).toBeUndefined()
    expect(visual('tr-glitch', 0.5, true, { intensity: 0 }).glitch).toBeUndefined()
  })

  it('Glitch intensity scales noise and displacement together', () => {
    const full = visual('tr-glitch', 0.5, true).glitch!
    const half = visual('tr-glitch', 0.5, true, { intensity: 50 }).glitch!
    expect(half.displacement).toBeCloseTo(full.displacement / 2)
    expect(half.rgbOffset).toBeCloseTo(full.rgbOffset / 2)
    expect(half.noiseOpacity).toBeCloseTo(full.noiseOpacity / 2)
  })

  it('keeps image coverage through the glitch displacement and channel offsets', () => {
    for (let frame = 1; frame < 60; frame++) {
      const v = visual('tr-glitch', frame / 60, true)
      const margin = (v.glitch?.displacement ?? 0) / 2 + (v.glitch?.rgbOffset ?? 0)
      expect(v.x - 1920 * v.scale / 2 + margin).toBeLessThanOrEqual(-960 + 0.001)
      expect(v.x + 1920 * v.scale / 2 - margin).toBeGreaterThanOrEqual(960 - 0.001)
    }
  })
})

describe('transition media preparation', () => {
  const state = { ...createEmptyProjectState(),
    tracks: [{ id: 'track-v1', name: 'Video 1', type: 'video' as const }],
    assets: {
      a: { id: 'a', name: 'a.mp4', type: 'video' as const, path: 'a.mp4', duration: 4 },
      b: { id: 'b', name: 'b.mp4', type: 'video' as const, path: 'b.mp4', duration: 4 },
    }, items: { left, right }, transitions: { transition: transition('tr-push-left') },
  }

  it('prepares the incoming video before the transition without showing it early', () => {
    const before = getPlaybackFrameInfo(state, 3)
    expect(before.activeVideos.map(clip => clip.item.id)).toEqual(['left'])
    expect(before.preloadVideos?.map(clip => clip.item.id)).toEqual(['right'])
    expect(before.preloadVideos?.[0].sourceTime).toBe(0)
    const during = getPlaybackFrameInfo(state, 3.75)
    expect(during.activeVideos.map(clip => clip.item.id)).toEqual(['left', 'right'])
    expect(during.preloadVideos).toEqual([])
  })

  it('holds the first or last source frame when media has no extra handles', () => {
    expect(getPlaybackFrameInfo(state, 3.75).activeVideos[1]).toMatchObject({ sourceTime: 0, isSourceHeld: true })
    expect(getPlaybackFrameInfo(state, 4.25).activeVideos[0]).toMatchObject({ sourceTime: 3.99, isSourceHeld: true })
    expect(getPlaybackFrameInfo(state, 4.25).activeVideos[1].isSourceHeld).toBe(false)
  })

  it('uses real source handles when available and respects hidden tracks', () => {
    const withHandles = { ...state, assets: { ...state.assets, b: { ...state.assets.b, duration: 10 } },
      items: { ...state.items, right: { ...right, sourceIn: 2, sourceOut: 6 } } }
    expect(getPlaybackFrameInfo(withHandles, 3.75).activeVideos[1]).toMatchObject({ sourceTime: 1.75, isSourceHeld: false })
    expect(getPlaybackFrameInfo({ ...state, tracks: [{ ...state.tracks[0], visible: false }] }, 3).preloadVideos).toEqual([])
  })
})

describe('transition library cleanup', () => {
  it('offers one entry per supported effect and retains old project aliases', () => {
    const ids = TRANSITION_DEFINITIONS.map(def => def.id)
    expect(new Set(ids).size).toBe(10)
    expect(ids).not.toContain('tr-crash-zoom')
    expect(ids).not.toContain('tr-light-leak')
    for (const alias of ['tr-crash-zoom', 'tr-zoom', 'tr-dissolve', 'tr-dip-black', 'tr-dip-white', 'tr-slide', 'tr-wipe', 'tr-light-leak']) {
      expect(ids).toContain(normalizeTransitionId(alias))
    }
  })

  it('preserves the horizontal direction of old Slide presets', () => {
    expect(visual('tr-slide', 0.5, true).x).toBeGreaterThan(0)
    expect(visual('tr-slide', 0.5, true).y).toBeCloseTo(0)
    expect(visual('tr-slide-up', 0.5, true).y).toBeGreaterThan(0)
  })
})
