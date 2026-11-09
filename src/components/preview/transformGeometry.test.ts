import { describe, expect, it } from 'vitest'
import { DEFAULT_TRANSFORM, type Transform } from '../../core/timeline/types'
import { projectLayerPoint, resizeLayer, angleDelta, SCALE_HANDLES, type ScaleHandle } from './transformGeometry'

describe('canvas transform geometry', () => {
  it('uses independent axes, flips, rotation, and anchor offsets in the same order as the video', () => {
    const transform = { ...DEFAULT_TRANSFORM, x: 100, y: -20, scaleX: 2, scaleY: 0.5, rotation: 90, anchorX: 10, anchorY: 20, flipH: true }
    const point = projectLayerPoint({ x: 30, y: 40 }, transform)
    expect(point.x).toBeCloseTo(100)
    expect(point.y).toBeCloseTo(-40)
  })

  it.each(Object.keys(SCALE_HANDLES) as ScaleHandle[])('keeps the opposite %s handle fixed when resizing', (handle) => {
    const initial: Transform = {
      ...DEFAULT_TRANSFORM, x: 130, y: -75, rotation: 37, scaleX: 1.6, scaleY: 0.8,
      anchorX: 100, anchorY: -40, flipH: true, pitch: 12, yaw: 18,
    }
    const h = SCALE_HANDLES[handle]
    const opposite = { x: -h.x * 1920, y: -h.y * 1080 }
    const before = projectLayerPoint(opposite, initial)
    const resized = { ...initial, ...resizeLayer(initial, 1920, 1080, handle, { x: 100, y: 80 }) }
    const after = projectLayerPoint(opposite, resized)
    expect(after.x).toBeCloseTo(before.x, 8)
    expect(after.y).toBeCloseTo(before.y, 8)
    if (h.x && h.y) expect(resized.scaleX! / resized.scaleY!).toBeCloseTo(2)
    else if (h.x) expect(resized.scaleY).toBe(initial.scaleY)
    else expect(resized.scaleX).toBe(initial.scaleX)
  })

  it('allows scaling beyond 1 and applies an exact corner displacement', () => {
    const next = { ...DEFAULT_TRANSFORM, ...resizeLayer(DEFAULT_TRANSFORM, 1920, 1080, 'br', { x: 960, y: 540 }) }
    expect(next.scaleX).toBeCloseTo(1.5)
    expect(next.scaleY).toBeCloseTo(1.5)
    expect(next.x).toBeCloseTo(480)
    expect(next.y).toBeCloseTo(270)
    expect(projectLayerPoint({ x: -960, y: -540 }, next)).toEqual({ x: -960, y: -540 })
  })

  it('does not resize the other axis with a side handle', () => {
    const next = resizeLayer(DEFAULT_TRANSFORM, 1920, 1080, 'r', { x: 960, y: 500 })
    expect(next.scaleX).toBe(1.5)
    expect(next.scaleY).toBe(1)
    expect(next.x).toBe(480)
    expect(next.y).toBe(0)
  })

  it.each(['l', 'r', 't', 'b'] as ScaleHandle[])('preserves proportions with the linked %s side handle', handle => {
    const initial = { ...DEFAULT_TRANSFORM, scaleX: 1.2, scaleY: 1.2 }
    const h = SCALE_HANDLES[handle]
    const patch = resizeLayer(initial, 1080, 1920, handle, { x: -200, y: -200 }, true)
    expect(patch.scaleX).toBeCloseTo(patch.scaleY!)
    const opposite = { x: -h.x * 1080, y: -h.y * 1920 }
    const before = projectLayerPoint(opposite, initial)
    const after = projectLayerPoint(opposite, { ...initial, ...patch })
    expect(after.x).toBeCloseTo(before.x)
    expect(after.y).toBeCloseTo(before.y)
  })

  it('clamps resizing and handles an edge-on 3D layer without invalid values', () => {
    expect(resizeLayer(DEFAULT_TRANSFORM, 1920, 1080, 'r', { x: -10000, y: 0 }).scaleX).toBe(0.05)
    expect(resizeLayer(DEFAULT_TRANSFORM, 1920, 1080, 'r', { x: 100000, y: 0 }).scaleX).toBe(20)
    expect(resizeLayer({ ...DEFAULT_TRANSFORM, yaw: 90 }, 1920, 1080, 'r', { x: 100, y: 0 })).toEqual({})
  })

  it('rotates smoothly across the ±180 degree boundary', () => {
    expect(angleDelta(179, -179)).toBe(2)
    expect(angleDelta(-179, 179)).toBe(-2)
  })
})
