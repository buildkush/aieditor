import { describe, expect, it } from 'vitest'
import { DEFAULT_TRANSFORM } from '../../core/timeline/types'
import { snapMoveToFrame, snapResizeToFrame } from './canvasSnapping'
import { projectLayerPoint, resizeLayer } from './transformGeometry'

describe('canvas frame snapping', () => {
  it('snaps a nearby clip edge to the video frame edge', () => {
    const result = snapMoveToFrame({ ...DEFAULT_TRANSFORM, x: -657, y: 100 }, 600, 300, 1920, 1080, 1)
    expect(result.patch).toEqual({ x: -660, y: 100 })
    expect(result.guides).toEqual([{ axis: 'x', position: -960 }])
  })

  it('snaps the clip center on both axes', () => {
    const result = snapMoveToFrame({ ...DEFAULT_TRANSFORM, x: 3, y: -4 }, 600, 300, 1920, 1080, 1)
    expect(result.patch).toEqual({ x: 0, y: 0 })
    expect(result.guides).toEqual([{ axis: 'x', position: 0 }, { axis: 'y', position: 0 }])
  })

  it('keeps the snap distance constant in screen pixels across canvas zoom levels', () => {
    const initial = { ...DEFAULT_TRANSFORM, x: 16, y: 100 }
    expect(snapMoveToFrame(initial, 600, 300, 1920, 1080, 0.5).patch.x).toBe(16)
    expect(snapMoveToFrame(initial, 600, 300, 1920, 1080, 0.25).patch.x).toBe(0)
  })

  it('snaps rotated visible bounds rather than the unrotated source dimensions', () => {
    const result = snapMoveToFrame({ ...DEFAULT_TRANSFORM, x: 808, y: 210, rotation: 90 }, 600, 300, 1920, 1080, 1)
    expect(result.patch.x).toBeCloseTo(810)
    expect(result.patch.y).toBe(210)
    expect(result.guides).toContainEqual({ axis: 'x', position: 960 })
  })

  it('snaps a corner back to the exact video dimensions without moving the opposite corner', () => {
    const initial = { ...DEFAULT_TRANSFORM, scale: 0.8, x: -192, y: -108 }
    const result = snapResizeToFrame(initial, 1920, 1080, 'br', { x: 380, y: 213.75 }, 1920, 1080, 1)
    const next = { ...initial, ...result.patch }
    expect(next.scaleX).toBeCloseTo(1)
    expect(next.scaleY).toBeCloseTo(1)
    expect(next.x).toBeCloseTo(0)
    expect(next.y).toBeCloseTo(0)
    expect(projectLayerPoint({ x: -960, y: -540 }, next)).toEqual({ x: -960, y: -540 })
    expect(result.guides).toContainEqual({ axis: 'x', position: 960 })
    expect(result.guides).toContainEqual({ axis: 'y', position: 540 })
  })

  it('snaps side resizing without changing the other axis', () => {
    const result = snapResizeToFrame(DEFAULT_TRANSFORM, 1920, 1080, 'r', { x: 4, y: 50 }, 1920, 1080, 1)
    expect(result.patch).toMatchObject({ scaleX: 1, scaleY: 1, x: 0, y: 0 })
    expect(result.guides).toContainEqual({ axis: 'x', position: 960 })
  })

  it('preserves proportions and the fixed corner when snapping a rotated resize', () => {
    const initial = { ...DEFAULT_TRANSFORM, rotation: 30 }
    const start = projectLayerPoint({ x: 960, y: 540 }, initial)
    const fixed = projectLayerPoint({ x: -960, y: -540 }, initial)
    const direction = { x: start.x - fixed.x, y: start.y - fixed.y }
    const factor = (957 - fixed.x) / direction.x
    const result = snapResizeToFrame(initial, 1920, 1080, 'br',
      { x: direction.x * (factor - 1), y: direction.y * (factor - 1) }, 1920, 1080, 1)
    const next = { ...initial, ...result.patch }
    expect(projectLayerPoint({ x: 960, y: 540 }, next).x).toBeCloseTo(960)
    const opposite = projectLayerPoint({ x: -960, y: -540 }, next)
    expect(Math.hypot(opposite.x - fixed.x, opposite.y - fixed.y)).toBeLessThan(1)
    expect(next.scaleX).toBeCloseTo(next.scaleY!)
  })

  it('leaves resize movement free outside the snap range', () => {
    const result = snapResizeToFrame(DEFAULT_TRANSFORM, 1920, 1080, 'r', { x: 20, y: 0 }, 1920, 1080, 1)
    expect(result.guides).toEqual([])
    expect(result.patch.scaleX).toBeGreaterThan(1)
  })

  it('aligns the exact frame after the command layer rounds scale values', () => {
    const initial = { ...DEFAULT_TRANSFORM, scaleX: 1.016, scaleY: 1, x: 15.789 }
    const result = snapResizeToFrame(initial, 1920, 1080, 'r', { x: -6, y: 0 }, 1920, 1080, 0.2)
    expect(result.patch.scaleX).toBe(1)
    expect(result.patch.x).toBeCloseTo(0)
  })

  it('preserves a portrait video aspect ratio when a linked side handle snaps', () => {
    const initial = { ...DEFAULT_TRANSFORM, scale: 0.8, x: -108 }
    const result = snapResizeToFrame(initial, 1080, 1920, 'r', { x: 211, y: 0 }, 1080, 1920, 1, true)
    expect(result.patch.scaleX).toBe(1)
    expect(result.patch.scaleY).toBe(1)
    expect(result.patch.x).toBeCloseTo(0)
  })

  it('rejects a large resize jump near an almost parallel guide', () => {
    const initial = { ...DEFAULT_TRANSFORM, rotation: 89.9, x: -1.67 }
    const result = snapResizeToFrame(initial, 1920, 1080, 'r', { x: -20, y: 0 }, 1920, 1080, 1, true)
    const free = projectLayerPoint({ x: 960, y: 0 }, { ...initial,
      ...resizeLayer(initial, 1920, 1080, 'r', { x: -20, y: 0 }, true) })
    const snapped = projectLayerPoint({ x: 960, y: 0 }, { ...initial, ...result.patch })
    expect(Math.hypot(free.x - snapped.x, free.y - snapped.y)).toBeLessThanOrEqual(7.001)
  })
})

