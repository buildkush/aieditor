import type { Transform } from '../../core/timeline/types'

export interface Point { x: number; y: number }
export const SCALE_HANDLES = {
  tl: { x: -0.5, y: -0.5 }, t: { x: 0, y: -0.5 }, tr: { x: 0.5, y: -0.5 },
  r: { x: 0.5, y: 0 }, br: { x: 0.5, y: 0.5 }, b: { x: 0, y: 0.5 },
  bl: { x: -0.5, y: 0.5 }, l: { x: -0.5, y: 0 },
} as const
export type ScaleHandle = keyof typeof SCALE_HANDLES
const radians = (degrees: number) => degrees * Math.PI / 180

// Same order as VideoLayerItem's CSS: rotateZ -> rotateX -> rotateY -> scale.
function rotationMatrix(transform: Transform) {
  const r = radians(transform.rotation)
  const p = radians(transform.pitch ?? 0)
  const y = radians(transform.yaw ?? 0)
  const cr = Math.cos(r), sr = Math.sin(r), cp = Math.cos(p), sp = Math.sin(p)
  const cy = Math.cos(y), sy = Math.sin(y)
  return { a: cr * cy - sr * sp * sy, b: sr * cy + cr * sp * sy, c: -sr * cp, d: cr * cp }
}

function rotate(point: Point, transform: Transform): Point {
  const m = rotationMatrix(transform)
  return { x: m.a * point.x + m.c * point.y, y: m.b * point.x + m.d * point.y }
}

/** Project a point relative to the layer center into project coordinates. */
export function projectLayerPoint(point: Point, transform: Transform): Point {
  const ax = transform.anchorX ?? 0, ay = transform.anchorY ?? 0
  const projected = rotate({
    x: (point.x - ax) * (transform.scaleX ?? transform.scale) * (transform.flipH ? -1 : 1),
    y: (point.y - ay) * (transform.scaleY ?? transform.scale) * (transform.flipV ? -1 : 1),
  }, transform)
  return { x: transform.x + ax + projected.x, y: transform.y + ay + projected.y }
}

/** Resize from one handle while leaving the opposite handle fixed in the canvas. */
export function resizeLayer(
  transform: Transform, width: number, height: number, handle: ScaleHandle, delta: Point,
  preserveAspect = false,
): Partial<Transform> {
  const h = SCALE_HANDLES[handle]
  const m = rotationMatrix(transform)
  const determinant = m.a * m.d - m.b * m.c
  // An edge-on 3D layer has no stable inverse projection for resizing.
  if (Math.abs(determinant) < 0.00001) return {}
  const localDelta = {
    x: (m.d * delta.x - m.c * delta.y) / determinant,
    y: (-m.b * delta.x + m.a * delta.y) / determinant,
  }
  const sx = transform.scaleX ?? transform.scale, sy = transform.scaleY ?? transform.scale
  const fx = transform.flipH ? -1 : 1, fy = transform.flipV ? -1 : 1
  let nx = sx, ny = sy, scale = transform.scale
  if ((h.x && h.y) || preserveAspect) {
    const vx = 2 * h.x * width * sx * fx, vy = 2 * h.y * height * sy * fy
    const factor = Math.max(Math.max(0.05 / sx, 0.05 / sy), Math.min(
      Math.min(20 / sx, 20 / sy), 1 + (localDelta.x * vx + localDelta.y * vy) / (vx * vx + vy * vy),
    ))
    nx = sx * factor
    ny = sy * factor
    scale = Math.max(0.05, Math.min(20, transform.scale * factor))
  } else if (h.x) {
    nx = Math.max(0.05, Math.min(20, sx + localDelta.x / (2 * h.x * width * fx)))
  } else {
    ny = Math.max(0.05, Math.min(20, sy + localDelta.y / (2 * h.y * height * fy)))
  }
  const opposite = { x: -h.x * width, y: -h.y * height }
  const fixed = projectLayerPoint(opposite, transform)
  const next = { ...transform, scale, scaleX: nx, scaleY: ny }
  const moved = projectLayerPoint(opposite, next)
  return { scale, scaleX: nx, scaleY: ny, x: transform.x + fixed.x - moved.x, y: transform.y + fixed.y - moved.y }
}

export function angleDelta(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180
}
