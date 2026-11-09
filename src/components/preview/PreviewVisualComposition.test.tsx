import { describe, it, expect, vi } from 'vitest'
// @ts-ignore
import { renderToStaticMarkup } from 'react-dom/server'
import { PreviewPanel } from './PreviewPanel'
import { CanvasTransformOverlay } from './CanvasTransformOverlay'
import {
  DEFAULT_TRANSFORM,
  type ProjectState,
  type TimelineItem,
  type Track,
  type MediaAsset,
} from '../../core'
import { getMediaFittedDimensions } from '../../core/utils'

describe('Preview Visual Composition Component', () => {
  const asset1: MediaAsset = {
    id: 'asset-1',
    name: 'background.mp4',
    type: 'video',
    path: '/media/bg.mp4',
    duration: 30,
    metadata: { width: 1920, height: 1080 },
  }

  const asset2: MediaAsset = {
    id: 'asset-2',
    name: 'broll.mp4',
    type: 'video',
    path: '/media/broll.mp4',
    duration: 15,
    metadata: { width: 1920, height: 1080 },
  }

  const track1: Track = { id: 'track-v1', name: 'Video 1', type: 'video', visible: true }
  const track2: Track = { id: 'track-v2', name: 'Video 2', type: 'video', visible: true }

  const item1: TimelineItem = {
    id: 'item-1',
    trackId: 'track-v1',
    assetId: 'asset-1',
    startTime: 0,
    duration: 20,
    sourceIn: 0,
    sourceOut: 20,
    transform: { ...DEFAULT_TRANSFORM },
  }

  const item2: TimelineItem = {
    id: 'item-2',
    trackId: 'track-v2',
    assetId: 'asset-2',
    startTime: 5,
    duration: 10,
    sourceIn: 0,
    sourceOut: 10,
    transform: {
      x: 200,
      y: -100,
      scale: 0.5,
      rotation: 15,
      opacity: 0.8,
    },
    crop: {
      left: 10,
      right: 10,
      top: 5,
      bottom: 5,
    },
  }

  const baseState: ProjectState = {
    id: 'test-proj',
    name: 'Test Project',
    settings: { width: 1920, height: 1080, fps: 30, sampleRate: 48000 },
    assets: { 'asset-1': asset1, 'asset-2': asset2 },
    tracks: [track2, track1],
    items: { 'item-1': item1, 'item-2': item2 },
    playheadTime: 7, // Both items active
    selectedItemId: null,
  }

  it('renders multi-track video layers with V2 stacked above V1', () => {
    const html = renderToStaticMarkup(
      <PreviewPanel state={baseState} dispatch={vi.fn()} />
    )

    // Canvas container
    expect(html).toContain('preview-canvas')
    // Both preview layers present
    expect(html).toContain('preview-layer')
    // z-index 1 for V1, z-index 2 for V2
    expect(html).toContain('z-index:1')
    expect(html).toContain('z-index:2')
    // Transforms applied
    expect(html).toContain('scale(0.5)')
    expect(html).toContain('rotate(15deg)')
    expect(html).toContain('opacity:0.8')
    // Crop clip-path applied
    expect(html).toContain('clip-path:inset(5% 10% 5% 10%)')
  })

  it('does NOT render bounding box when no clip is selected', () => {
    const html = renderToStaticMarkup(
      <PreviewPanel state={baseState} dispatch={vi.fn()} />
    )
    expect(html).not.toContain('transform-overlay-box')
  })

  it('renders bounding box and handles when item-2 is selected', () => {
    const selectedState: ProjectState = {
      ...baseState,
      selectedItemId: 'item-2',
    }

    const html = renderToStaticMarkup(
      <PreviewPanel state={selectedState} dispatch={vi.fn()} />
    )

    // Bounding box container
    expect(html).toContain('transform-overlay-box')
    // Interior move area
    expect(html).toContain('transform-overlay-interior')
    // Corner scale handles
    expect(html).toContain('transform-handle-tl')
    expect(html).toContain('transform-handle-tr')
    expect(html).toContain('transform-handle-br')
    expect(html).toContain('transform-handle-bl')
    // Rotation stem and handle
    expect(html).toContain('transform-rotation-stem')
    expect(html).toContain('transform-rotation-handle')
    // Crop guide
    expect(html).toContain('transform-crop-guide')
  })

  it('renders CanvasTransformOverlay standalone with correct handles', () => {
    const html = renderToStaticMarkup(
      <CanvasTransformOverlay
        item={item2}
        assetWidth={1920}
        assetHeight={1080}
        canvasScale={0.5}
        dispatch={vi.fn()}
      />
    )

    expect(html).toContain('transform-overlay-box')
    expect(html).toContain('transform-rotation-handle')
    expect(html).toContain('transform-handle-br')
  })

  it('calculates getMediaFittedDimensions accurately matching project frame', () => {
    // 16:9 720p in 1080p project -> full fit 1920x1080
    const matched = getMediaFittedDimensions(1280, 720, 1920, 1080)
    expect(matched.width).toBe(1920)
    expect(matched.height).toBe(1080)

    // Ultrawide (21:9) in 16:9 project -> fits width (1920), height scales down
    const wider = getMediaFittedDimensions(2560, 1080, 1920, 1080)
    expect(wider.width).toBe(1920)
    expect(wider.height).toBe(Math.round(1920 / (2560 / 1080)))

    // Vertical (9:16) in 16:9 project -> fits height (1080), width pillarboxed
    const vertical = getMediaFittedDimensions(1080, 1920, 1920, 1080)
    expect(vertical.height).toBe(1080)
    expect(vertical.width).toBe(Math.round(1080 * (1080 / 1920)))
  })

  it('renders preview header zoom controls, transform mode toggle, and fullscreen button', () => {
    const html = renderToStaticMarkup(
      <PreviewPanel state={baseState} dispatch={vi.fn()} />
    )

    expect(html).toContain('preview-zoom-selector')
    expect(html).toContain('aria-label="Canvas snapping" aria-pressed="true"')
    expect(html).toContain('Fit')
    expect(html).toContain('100%')
    expect(html).toContain('Toggle Transform Mode')
    expect(html).toContain('Fullscreen Preview')
  })
})
