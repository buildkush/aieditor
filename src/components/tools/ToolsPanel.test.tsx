import { describe, it, expect, vi } from 'vitest'
// @ts-ignore
import { renderToStaticMarkup } from 'react-dom/server'
import { ToolsPanel } from './ToolsPanel'
import {
  createEmptyProjectState,
  type ProjectState,
  type TimelineItem,
  type Track,
} from '../../core'
import { TEXT_TOOL_PRESETS } from './toolPresets'
import { getActiveDraggedTool, setActiveDraggedTool } from './activeDragTool'

describe('ToolsPanel Component', () => {
  const trackV1: Track = { id: 'track-v1', name: 'Video 1', type: 'video' }
  const item1: TimelineItem = {
    id: 'item-1',
    trackId: 'track-v1',
    assetId: 'asset-1',
    startTime: 0,
    duration: 5,
    sourceIn: 0,
    sourceOut: 5,
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
  }

  const baseState: ProjectState = {
    ...createEmptyProjectState(),
    tracks: [trackV1],
    items: { 'item-1': item1 },
    selectedItemId: 'item-1',
    playheadTime: 2.5,
  }

  it('renders minimal simplified categories and presets without numbers or badges', () => {
    const html = renderToStaticMarkup(
      <ToolsPanel state={baseState} dispatch={vi.fn()} />
    )

    // Search header
    expect(html).toContain('tools-search-input')
    expect(html).toContain('Search tools &amp; effects...')

    // Five primary category titles (clean uppercase)
    expect(html).toContain('TEXT')
    expect(html).toContain('OVERLAYS')
    expect(html).toContain('LAYERS')
    expect(html).toContain('TRANSITIONS')
    expect(html).toContain('EFFECTS')
    expect(html).not.toContain('1. Text &amp; Captions')
    expect(html).not.toContain('2. Overlays')

    // TEXT presets
    expect(html).toContain('Text')
    expect(html).toContain('Heading')
    expect(html).toContain('Corner Label')
    expect(html).toContain('Lower Third')
    expect(html).toContain('Subtitle')
    expect(html).toContain('Animated Caption')

    // OVERLAYS: Solid Color only, no unimplemented Gradient or badges
    expect(html).toContain('Solid Color')
    expect(html).not.toContain('Gradient')
    expect(html).not.toContain('Coming Soon')
    expect(html).not.toContain('Insert')

    // LAYERS
    expect(html).toContain('Adjustment Layer')

    // TRANSITIONS with Video Transitions subcategory
    expect(html).toContain('Video Transitions')
    expect(html).toContain('Dissolve')
    expect(html).toContain('Wipe')
    expect(html).toContain('Zoom')

    // EFFECTS subcategories
    expect(html).toContain('Video')
    expect(html).toContain('Color')
    expect(html).toContain('Stylize')
    expect(html).toContain('Distortion')
    expect(html).toContain('Keying')
    expect(html).toContain('Audio')

    // Specific effects
    expect(html).toContain('Blur')
    expect(html).toContain('Sharpen')
    expect(html).toContain('Grayscale')
    expect(html).toContain('Vignette')
    expect(html).toContain('Brightness')
    expect(html).toContain('Contrast')
    expect(html).toContain('Saturation')
    expect(html).toContain('Chroma Key')
    expect(html).toContain('Gain')

    // Only actual items are draggable cards with preview icons, NO add buttons, NO chip badges
    expect(html).toContain('draggable="true"')
    expect(html).toContain('tools-card')
    expect(html).toContain('tools-card-preview')
    expect(html).not.toContain('tools-card-chip')
    expect(html).not.toContain('tools-add-btn')
  })

  it('does NOT contain old promotional AI badges or card galleries', () => {
    const html = renderToStaticMarkup(
      <ToolsPanel state={baseState} dispatch={vi.fn()} />
    )

    expect(html).not.toContain('Smart Auto-Reframe')
    expect(html).not.toContain('Background Removal')
    expect(html).not.toContain('Depth Layering')
    expect(html).not.toContain('Dead-Air Removal')
  })

  it('provides all 6 text tool presets in toolPresets.ts', () => {
    expect(TEXT_TOOL_PRESETS).toHaveLength(6)
    const names = TEXT_TOOL_PRESETS.map((p) => p.name)
    expect(names).toEqual([
      'Text',
      'Heading',
      'Corner Label',
      'Lower Third',
      'Subtitle',
      'Animated Caption',
    ])

    const textItems = TEXT_TOOL_PRESETS.filter((p) => p.itemKind === 'text')
    const captionItems = TEXT_TOOL_PRESETS.filter((p) => p.itemKind === 'caption')
    expect(textItems).toHaveLength(4)
    expect(captionItems).toHaveLength(2)
  })

  it('supports activeDragTool state get and set', () => {
    setActiveDraggedTool(null)
    expect(getActiveDraggedTool()).toBeNull()

    setActiveDraggedTool({
      type: 'layer',
      dragType: 'layer',
      toolId: 'heading',
      name: 'Heading',
      itemKind: 'text',
      duration: 5,
    })

    const current = getActiveDraggedTool()
    expect(current).not.toBeNull()
    expect(current?.dragType).toBe('layer')
    if (current && current.dragType === 'layer') {
      expect(current.name).toBe('Heading')
    }

    setActiveDraggedTool(null)
    expect(getActiveDraggedTool()).toBeNull()
  })
})
