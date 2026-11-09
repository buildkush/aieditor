import type { Transform } from '../../core/timeline/types'
import { projectLayerPoint, resizeLayer, SCALE_HANDLES, type Point, type ScaleHandle } from './transformGeometry'

export interface SnapGuide { axis: 'x' | 'y'; position: number }
export interface CanvasSnapResult { patch: Partial<Transform>; guides: SnapGuide[] }
const SNAP_PIXELS = 7
const axes = ['x', 'y'] as const

function frameTargets(width: number, height: number) {
  return { x: [-width / 2, 0, width / 2], y: [-height / 2, 0, height / 2] }
}

/** Use screen pixels for the capture distance, regardless of viewport zoom. */
export function snapMoveToFrame(
  transform: Transform, width: number, height: number,
  frameWidth: number, frameHeight: number, viewScale: number,
): CanvasSnapResult {
  const corners = [
    { x: -width / 2, y: -height / 2 }, { x: width / 2, y: -height / 2 },
    { x: width / 2, y: height / 2 }, { x: -width / 2, y: height / 2 },
  ].map(p => projectLayerPoint(p, transform))
  const targets = frameTargets(frameWidth, frameHeight)
  const patch = { x: transform.x, y: transform.y }
  const guides: SnapGuide[] = []
  for (const axis of axes) {
    const min = Math.min(...corners.map(p => p[axis]))
    const max = Math.max(...corners.map(p => p[axis]))
    let bestDistance = SNAP_PIXELS / Math.max(viewScale, 0.00001)
    let match: { offset: number; target: number } | undefined
    for (const source of [min, (min + max) / 2, max]) {
      for (const target of targets[axis]) {
        const offset = target - source
        if (Math.abs(offset) <= bestDistance) {
          bestDistance = Math.abs(offset)
          match = { offset, target }
        }
      }
    }
    if (match) {
      patch[axis] += match.offset
      guides.push({ axis, position: match.target })
    }
  }
  return { patch, guides }
}

/** Snap the dragged resize handle without moving its opposite anchor. */
export function snapResizeToFrame(
  initial: Transform, width: number, height: number, handle: ScaleHandle, delta: Point,
  frameWidth: number, frameHeight: number, viewScale: number,
  preserveAspect = false,
): CanvasSnapResult {
  const patch = resizeLayer(initial, width, height, handle, delta, preserveAspect)
  const h = SCALE_HANDLES[handle]
  const localHandle = { x: h.x * width, y: h.y * height }
  const fixed = projectLayerPoint({ x: -localHandle.x, y: -localHandle.y }, initial)
  const start = projectLayerPoint(localHandle, initial)
  const direction = { x: start.x - fixed.x, y: start.y - fixed.y }
  const current = projectLayerPoint(localHandle, { ...initial, ...patch })
  const targets = frameTargets(frameWidth, frameHeight)
  let bestDistance = SNAP_PIXELS / Math.max(viewScale, 0.00001)
  let snapped: CanvasSnapResult = { patch, guides: [] }
  for (const axis of axes) {
    if (Math.abs(direction[axis]) < 0.00001) continue
    for (const target of targets[axis]) {
      const distance = Math.abs(target - current[axis])
      if (distance > bestDistance) continue
      const factor = (target - fixed[axis]) / direction[axis]
      const candidate = resizeLayer(initial, width, height, handle, {
        x: direction.x * (factor - 1), y: direction.y * (factor - 1),
      }, preserveAspect)
      const point = projectLayerPoint(localHandle, { ...initial, ...candidate })
      // Reject unreachable targets, including those beyond the scale limits.
      if (Math.abs(point[axis] - target) > 0.001) continue
      // A nearly parallel rotated edge must not jump far to reach a guide.
      if (Math.hypot(point.x - current.x, point.y - current.y) * viewScale > SNAP_PIXELS + 0.001) continue
      bestDistance = distance
      const guides = axes.flatMap(a =>
        targets[a].filter(t => Math.abs(point[a] - t) < 0.001).map(position => ({ axis: a, position })),
      )
      // Commands store scale at three decimal places. Align the resulting
      // rounded size, so a frame-size snap also gives exact Inspector values.
      const precise = { ...candidate }
      for (const key of ['scale', 'scaleX', 'scaleY'] as const) {
        if (precise[key] !== undefined) precise[key] = Math.round(precise[key]! * 1000) / 1000
      }
      const renderedPoint = projectLayerPoint(localHandle, { ...initial, ...precise })
      for (const guide of guides) {
        precise[guide.axis] = (precise[guide.axis] ?? initial[guide.axis]) + guide.position - renderedPoint[guide.axis]
      }
      snapped = { patch: precise, guides }
    }
  }
  return snapped
}
