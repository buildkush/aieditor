import { describe, expect, it, vi } from 'vitest'
// @ts-ignore — Installed react-dom typings omit the server entry point, as in the existing component tests.
import { renderToStaticMarkup } from 'react-dom/server'
import { createEmptyProjectState } from '../../core/project/projectState'
import { DEFAULT_TRANSFORM, type TimelineItem } from '../../core/timeline/types'
import { CommandHistory } from '../../core/commands/commandHistory'
import { UpdateTransformAtPlayheadCommand, UpdateTransformCommand } from '../../core/commands/editorCommand'
import { evaluateItemTransform } from '../../core/timeline/keyframeEvaluation'
import { ProjectStore } from '../../store/projectStore'
import { InspectorPanel } from '../inspector/InspectorPanel'
import { CanvasTransformOverlay } from './CanvasTransformOverlay'
import { getPreviewLayerDimensions } from './previewLayerDimensions'
import { resizeLayer } from './transformGeometry'

function stateWithItem(overrides: Partial<TimelineItem> = {}) {
  const item: TimelineItem = {
    id: 'clip', assetId: 'asset', trackId: 'v1', startTime: 0, duration: 10, sourceIn: 0, sourceOut: 10,
    transform: { ...DEFAULT_TRANSFORM }, ...overrides,
  }
  return { ...createEmptyProjectState(),
    tracks: [{ id: 'v1', name: 'Video', type: 'video' as const }],
    items: { clip: item }, selectedItemId: 'clip', playheadTime: 5,
  }
}

describe('live canvas transform commands', () => {
  it('notifies the inspector during a drag, using the same state as the video', () => {
    const store = new ProjectStore(stateWithItem())
    const received: number[] = []
    store.subscribe(() => received.push(evaluateItemTransform(store.getState().items.clip, 5).x))
    for (const x of [20, 40, 80]) {
      store.dispatch(new UpdateTransformAtPlayheadCommand('clip', 5, { x }, 'drag-1'))
      const html = renderToStaticMarkup(<InspectorPanel state={store.getState()} dispatch={vi.fn()} />)
      expect(html).toContain(x.toFixed(3))
    }
    expect(received).toEqual([20, 40, 80])
    expect(store.getState().items.clip.transform.x).toBe(80)
  })

  it('keeps a whole resize gesture atomic in undo/redo and separates later gestures', () => {
    const state = stateWithItem()
    const history = new CommandHistory(state)
    for (const delta of [100, 200, 400]) {
      history.execute(new UpdateTransformAtPlayheadCommand('clip', 5,
        resizeLayer(state.items.clip.transform, 1920, 1080, 'br', { x: delta, y: delta / 2 }), 'resize-1'))
    }
    const resized = history.getCurrentState().items.clip.transform
    expect(resized.scaleX).toBeGreaterThan(1)
    expect(history.undoCount).toBe(1)
    expect(history.undo()?.items.clip.transform).toEqual(state.items.clip.transform)
    expect(history.redo()?.items.clip.transform).toEqual(resized)
    history.execute(new UpdateTransformAtPlayheadCommand('clip', 5, { rotation: 30 }, 'rotate-2'))
    expect(history.undoCount).toBe(2)
  })

  it('updates animated axes and position at the playhead without replacing base values', () => {
    const state = stateWithItem({ keyframes: {
      x: [{ id: 'x0', time: 0, value: 0 }, { id: 'x1', time: 10, value: 100 }],
      scale: [{ id: 's0', time: 0, value: 1 }, { id: 's1', time: 10, value: 2 }],
    } })
    const history = new CommandHistory(state)
    const updated = history.execute(new UpdateTransformAtPlayheadCommand('clip', 5,
      { x: 250, scale: 2, scaleX: 2, scaleY: 2 }, 'animated-drag'))
    expect(updated.items.clip.transform).toEqual(state.items.clip.transform)
    expect(evaluateItemTransform(updated.items.clip, 5)).toMatchObject({ x: 250, scaleX: 2, scaleY: 2 })
    expect(evaluateItemTransform(updated.items.clip, 0)).toMatchObject({ x: 0, scaleX: 1, scaleY: 1 })
    expect(evaluateItemTransform(updated.items.clip, 10)).toMatchObject({ x: 100, scaleX: 2, scaleY: 2 })
    expect(history.undo()?.items.clip).toEqual(state.items.clip)
  })

  it('renders eight controls and rotation using inspector-provided axis scale', () => {
    const state = stateWithItem()
    const updated = new UpdateTransformCommand('clip', { scaleX: 2, scaleY: 0.5 }).execute(state)
    const html = renderToStaticMarkup(<CanvasTransformOverlay item={updated.items.clip}
      assetWidth={1920} assetHeight={1080} canvasScale={0.25} viewportZoom={2} dispatch={vi.fn()} />)
    expect(html.match(/aria-label="Resize /g)).toHaveLength(8)
    expect(html).toContain('aria-label="Rotate clip"')
    expect(html).not.toContain('transform-rotate-zone')
    expect(html).toContain('points="-960,-135 960,-135 960,135 -960,135"')
    const inspector = renderToStaticMarkup(<InspectorPanel state={updated} dispatch={vi.fn()} />)
    expect(inspector).toContain('2.000')
    expect(inspector).toContain('0.500')
  })

  it('shares fitted media dimensions for portrait media in a landscape project', () => {
    const item = stateWithItem().items.clip
    const dims = getPreviewLayerDimensions(item, { id: 'asset', name: 'portrait', type: 'video', path: 'portrait.mp4',
      metadata: { width: 1080, height: 1920 } }, 1920, 1080, 5)
    expect(dims).toEqual({ width: 608, height: 1080 })
  })
})
