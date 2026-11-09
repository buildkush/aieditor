import { useRef, useState, useEffect } from 'react'
import type { TimelineItem, Transform } from '../../core/timeline/types'
import type { EditorCommand } from '../../core/commands/editorCommand'
import { UpdateTransformAtPlayheadCommand } from '../../core/commands/editorCommand'
import { evaluateItemTransform, evaluateItemCrop } from '../../core/timeline/keyframeEvaluation'
import { generateId } from '../../core/utils'
import { SCALE_HANDLES, projectLayerPoint, resizeLayer, angleDelta, type ScaleHandle, type Point } from './transformGeometry'
import { snapMoveToFrame, snapResizeToFrame, type SnapGuide } from './canvasSnapping'
import './CanvasTransformOverlay.css'

interface CanvasTransformOverlayProps {
  item: TimelineItem
  playheadTime?: number
  assetWidth: number
  assetHeight: number
  canvasScale: number
  viewportZoom?: number
  panOffset?: Point
  projectWidth?: number
  projectHeight?: number
  snappingEnabled?: boolean
  zoomLinked?: boolean
  dispatch: (command: EditorCommand) => void
}

type DragMode = 'move' | 'rotate' | ScaleHandle
const HANDLE_LABELS: Record<ScaleHandle, string> = {
  tl: 'top left', t: 'top', tr: 'top right', r: 'right',
  br: 'bottom right', b: 'bottom', bl: 'bottom left', l: 'left',
}

export function CanvasTransformOverlay({
  item, playheadTime = 0, assetWidth, assetHeight, canvasScale,
  viewportZoom = 1, panOffset = { x: 0, y: 0 }, dispatch,
  projectWidth = assetWidth, projectHeight = assetHeight, snappingEnabled = true,
  zoomLinked = true,
}: CanvasTransformOverlayProps) {
  const boxRef = useRef<HTMLDivElement>(null)
  const cleanupRef = useRef<(() => void) | null>(null)
  const [activeDrag, setActiveDrag] = useState<DragMode | null>(null)
  const [snapGuides, setSnapGuides] = useState<SnapGuide[]>([])
  const transform = evaluateItemTransform(item, playheadTime)
  const crop = evaluateItemCrop(item, playheadTime)
  const viewScale = canvasScale * viewportZoom
  const point = (x: number, y: number): Point => {
    const p = projectLayerPoint({ x: x * assetWidth, y: y * assetHeight }, transform)
    return { x: p.x * viewScale, y: p.y * viewScale }
  }
  const corners = [point(-0.5, -0.5), point(0.5, -0.5), point(0.5, 0.5), point(-0.5, 0.5)]
  const points = (list: Point[]) => list.map(p => `${p.x},${p.y}`).join(' ')
  const top = point(0, -0.5)
  const center = point(0, 0)
  const length = Math.hypot(top.x - center.x, top.y - center.y) || 1
  const rotationHandle = {
    x: top.x + (top.x - center.x) / length * 30,
    y: top.y + (top.y - center.y) / length * 30,
  }

  useEffect(() => () => cleanupRef.current?.(), [])

  const beginDrag = (mode: DragMode, event: React.PointerEvent) => {
    if (event.button !== 0 || event.isPrimary === false || viewScale <= 0) return
    event.preventDefault()
    event.stopPropagation()
    cleanupRef.current?.()
    const start = { x: event.clientX, y: event.clientY }
    const initial = transform
    const lastValues: Record<string, unknown> = { ...initial }
    const mergeKey = generateId(`canvas-transform-${item.id}`)
    const target = event.currentTarget
    const pointerId = event.pointerId
    const bounds = boxRef.current!.getBoundingClientRect()
    const pivot = {
      x: bounds.left + (initial.x + (initial.anchorX ?? 0)) * viewScale,
      y: bounds.top + (initial.y + (initial.anchorY ?? 0)) * viewScale,
    }
    let lastAngle = Math.atan2(start.y - pivot.y, start.x - pivot.x) * 180 / Math.PI
    let totalAngle = 0
    setActiveDrag(mode)
    try { target.setPointerCapture(pointerId) } catch { /* Window listeners also support capture-less hosts. */ }

    const update = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return
      e.preventDefault()
      const delta = { x: (e.clientX - start.x) / viewScale, y: (e.clientY - start.y) / viewScale }
      let patch: Partial<Transform>
      let guides: SnapGuide[] = []
      if (mode === 'move') {
        patch = { x: initial.x + delta.x, y: initial.y + delta.y }
        if (snappingEnabled && !e.altKey) {
          const snapped = snapMoveToFrame({ ...initial, ...patch }, assetWidth, assetHeight,
            projectWidth, projectHeight, viewScale)
          patch = snapped.patch
          guides = snapped.guides
        }
      } else if (mode === 'rotate') {
        const angle = Math.atan2(e.clientY - pivot.y, e.clientX - pivot.x) * 180 / Math.PI
        totalAngle += angleDelta(lastAngle, angle)
        lastAngle = angle
        const rotation = initial.rotation + totalAngle
        patch = { rotation: e.shiftKey ? Math.round(rotation / 15) * 15 : Math.round(rotation * 10) / 10 }
      } else {
        if (snappingEnabled && !e.altKey) {
          const snapped = snapResizeToFrame(initial, assetWidth, assetHeight, mode, delta,
            projectWidth, projectHeight, viewScale, zoomLinked)
          patch = snapped.patch
          guides = snapped.guides
        } else {
          patch = resizeLayer(initial, assetWidth, assetHeight, mode, delta, zoomLinked)
        }
      }
      setSnapGuides(guides)
      const changed = Object.fromEntries(Object.entries(patch).filter(([key, value]) =>
        typeof value === 'number' && Number.isFinite(value) && Math.abs(value - Number(lastValues[key] ?? 0)) > 0.00001,
      ))
      if (Object.keys(changed).length) {
        Object.assign(lastValues, changed)
        // Live state drives both the video and Inspector. One drag is one undo step.
        dispatch(new UpdateTransformAtPlayheadCommand(item.id, playheadTime, changed, mergeKey))
      }
    }
    const cleanup = () => {
      window.removeEventListener('pointermove', update)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('blur', cancel)
      target.removeEventListener('lostpointercapture', cancel)
      cleanupRef.current = null
      try { if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId) } catch { /* Already released. */ }
    }
    const cancel = () => { cleanup(); setActiveDrag(null); setSnapGuides([]) }
    const finish = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return
      update(e)
      cancel()
    }
    cleanupRef.current = cleanup
    window.addEventListener('pointermove', update, { passive: false })
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('blur', cancel)
    target.addEventListener('lostpointercapture', cancel)
  }

  const cropPoints = [
    point(-0.5 + crop.left / 100, -0.5 + crop.top / 100),
    point(0.5 - crop.right / 100, -0.5 + crop.top / 100),
    point(0.5 - crop.right / 100, 0.5 - crop.bottom / 100),
    point(-0.5 + crop.left / 100, 0.5 - crop.bottom / 100),
  ]

  return (
    <div ref={boxRef} className={`transform-overlay-box ${activeDrag ? 'active-drag' : ''}`}
      style={{ transform: `translate(${panOffset.x}px, ${panOffset.y}px)` }}
      onClick={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}>
      <svg className="transform-overlay-outline" width="1" height="1" aria-hidden="true">
        <polygon className="transform-overlay-interior" points={points(corners)}
          onPointerDown={e => beginDrag('move', e)}><title>Drag to move clip</title></polygon>
        {Object.values(crop).some(value => value > 0) && (
          <polygon className="transform-crop-guide" points={points(cropPoints)} />
        )}
        <line className="transform-rotation-stem" x1={top.x} y1={top.y} x2={rotationHandle.x} y2={rotationHandle.y} />
        {snapGuides.map(guide => <line key={`${guide.axis}-${guide.position}`} className="transform-snap-guide"
          x1={(guide.axis === 'x' ? guide.position : -projectWidth / 2) * viewScale}
          x2={(guide.axis === 'x' ? guide.position : projectWidth / 2) * viewScale}
          y1={(guide.axis === 'y' ? guide.position : -projectHeight / 2) * viewScale}
          y2={(guide.axis === 'y' ? guide.position : projectHeight / 2) * viewScale} />)}
      </svg>
      {(Object.entries(SCALE_HANDLES) as [ScaleHandle, Point][]).map(([handle, position]) => {
        const p = point(position.x, position.y)
        return <button key={handle} type="button" className={`transform-handle transform-handle-${handle}`}
          style={{ left: p.x, top: p.y }} onPointerDown={e => beginDrag(handle, e)}
          aria-label={`Resize ${HANDLE_LABELS[handle]}`} title={(position.x && position.y) || zoomLinked ? 'Drag to scale proportionally' : 'Drag edge to stretch this axis'} />
      })}
      <button type="button" className={`transform-rotation-handle ${activeDrag === 'rotate' ? 'rotating' : ''}`}
        style={{ left: rotationHandle.x, top: rotationHandle.y }} onPointerDown={e => beginDrag('rotate', e)}
        aria-label="Rotate clip" title="Drag to rotate (Shift: snap to 15°)">↻</button>
    </div>
  )
}
