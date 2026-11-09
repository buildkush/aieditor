import { describe, it, expect, vi } from 'vitest'
// @ts-ignore
import { renderToStaticMarkup } from 'react-dom/server'
import { InspectorPanel } from './InspectorPanel'
import { ScrubbableNumberInput } from './ScrubbableNumberInput'
import {
  UpdateSpeedCommand,
  ToggleKeyframeCommand,
  ToggleAllKeyframesCommand,
  createEmptyProjectState,
  DEFAULT_TRANSFORM,
  type ProjectState,
  type TimelineItem,
  type Track,
  type MediaAsset,
} from '../../core'

describe('Inspector Overhaul & Scrubbable Inputs', () => {
  const asset1: MediaAsset = {
    id: 'asset-1',
    name: 'Sample.mp4',
    type: 'video',
    path: '/media/sample.mp4',
    duration: 10,
  }

  const trackV1: Track = { id: 'track-v1', name: 'Video 1', type: 'video' }

  const item1: TimelineItem = {
    id: 'item-1',
    trackId: 'track-v1',
    assetId: 'asset-1',
    startTime: 0,
    duration: 10,
    sourceIn: 0,
    sourceOut: 10,
    transform: {
      ...DEFAULT_TRANSFORM,
      x: 10.5,
      y: -20.25,
      scale: 1.5,
      scaleX: 1.5,
      scaleY: 1.5,
      rotation: 45,
      anchorX: 5,
      anchorY: -5,
      pitch: 15,
      yaw: -10,
      flipH: true,
      flipV: false,
      blendMode: 'screen',
    },
    crop: {
      left: 10,
      right: 15,
      top: 5,
      bottom: 5,
    },
    speed: {
      speed: 2,
      reversed: false,
      fps: 60,
    },
    keyframeEnabled: {
      zoom: true,
      position: true,
    },
    keyframes: {
      scale: [{ id: 'kf-1', time: 0, value: 1.5, interpolation: 'linear' }],
    },
  }

  it('renders ScrubbableNumberInput with 3 decimals and drag arrow', () => {
    const html = renderToStaticMarkup(
      <ScrubbableNumberInput
        label="X"
        value={12.3456}
        decimals={3}
        suffix="px"
        onChange={vi.fn()}
      />
    )
    expect(html).toContain('scrubbable-input-wrapper')
    expect(html).toContain('scrubbable-label">X</span>')
    expect(html).toContain('12.346') // rounded to 3 decimals
    expect(html).toContain('scrubbable-suffix">px</span>')
    expect(html).toContain('scrubbable-drag-arrow')
    expect(html).toContain('↔')
  })

  it('renders all requested sections: Transform, Crop, Composite, Speed with sub-options and 3 decimals', () => {
    const state: ProjectState = {
      ...createEmptyProjectState(),
      assets: { 'asset-1': asset1 },
      tracks: [trackV1],
      items: { 'item-1': item1 },
      selectedItemId: 'item-1',
    }

    const html = renderToStaticMarkup(<InspectorPanel state={state} dispatch={vi.fn()} />)

    // Section Headers
    expect(html).toContain('Transform')
    expect(html).toContain('Crop')
    expect(html).toContain('Composite')
    expect(html).toContain('Speed')

    // Transform sub-options
    expect(html).toContain('Zoom')
    expect(html).toContain('Position')
    expect(html).toContain('Rotation')
    expect(html).toContain('Anchor')
    expect(html).toContain('Pitch')
    expect(html).toContain('Yaw')
    expect(html).toContain('Flip')

    // 3 decimals check
    expect(html).toContain('10.500') // X
    expect(html).toContain('-20.250') // Y
    expect(html).toContain('1.500') // Zoom
    expect(html).toContain('5.000') // Anchor X
    expect(html).toContain('-5.000') // Anchor Y

    // Flip states (accessible aria-labels)
    expect(html).toContain('Flip Horizontal')
    expect(html).toContain('Flip Vertical')

    // Composite sub-options: Blend mode & opacity
    expect(html).toContain('Blend Mode')
    expect(html).toContain('custom-select-trigger')
    expect(html).toContain('Screen')
    expect(html).toContain('Opacity')

    // Speed sub-options: Speed %, FPS, Reverse, Final duration non-editable
    expect(html).toContain('Speed')
    expect(html).toContain('200.0') // 200%
    expect(html).toContain('Direction')
    expect(html).toContain('Duration')
    expect(html).toContain('00:00:05:00') // 10s at 2x = 5s
    expect(html).not.toContain('🔒') // Non-editable duration without lock icon

    // Keyframe icons
    expect(html).toContain('inspector-kf-diamond')
    expect(html).toContain('◆') // active keyframe
    expect(html).toContain('◇') // inactive keyframe
  })

  it('dispatches UpdateSpeedCommand when speed is modified', () => {
    const itemAudio: TimelineItem = {
      id: 'item-audio',
      trackId: 'track-a1',
      assetId: 'asset-1',
      startTime: 0,
      duration: 10,
      sourceIn: 0,
      sourceOut: 10,
      transform: { ...DEFAULT_TRANSFORM },
      linkedItemId: 'item-1',
    }

    const state: ProjectState = {
      ...createEmptyProjectState(),
      assets: { 'asset-1': asset1 },
      tracks: [trackV1, { id: 'track-a1', name: 'Audio 1', type: 'audio' }],
      items: {
        'item-1': { ...item1, linkedItemId: 'item-audio' },
        'item-audio': itemAudio,
      },
      selectedItemId: 'item-1',
    }

    const cmd = new UpdateSpeedCommand('item-1', { speed: 1.5, reversed: true })
    const nextState = cmd.execute(state)
    expect(nextState.items['item-1'].speed?.speed).toBe(1.5)
    expect(nextState.items['item-1'].speed?.reversed).toBe(true)
    // Duration updated to (10 - 0) / 1.5 = 6.667s
    expect(nextState.items['item-1'].duration).toBeCloseTo(6.667, 3)
    // Frame rate has matching negative sign when reversed
    expect(nextState.items['item-1'].speed?.fps).toBeLessThan(0)
    expect(nextState.items['item-1'].speed?.fps).toBeCloseTo(-45, 1)
    // Linked audio item kept in sync
    expect(nextState.items['item-audio'].speed?.speed).toBe(1.5)
    expect(nextState.items['item-audio'].speed?.reversed).toBe(true)
    expect(nextState.items['item-audio'].duration).toBeCloseTo(6.667, 3)
  })

  it('bidirectionally updates speed and reversed flag when frame rate is adjusted', () => {
    const state: ProjectState = {
      ...createEmptyProjectState({ settings: { width: 1920, height: 1080, fps: 30 } }),
      assets: { 'asset-1': asset1 },
      tracks: [trackV1],
      items: { 'item-1': item1 },
      selectedItemId: 'item-1',
    }

    // Entering -15 fps (negative frame rate)
    const cmdNegativeFps = new UpdateSpeedCommand('item-1', { fps: -15 })
    const stateNeg = cmdNegativeFps.execute(state)
    expect(stateNeg.items['item-1'].speed?.reversed).toBe(true)
    expect(stateNeg.items['item-1'].speed?.speed).toBe(0.5)
    expect(stateNeg.items['item-1'].speed?.fps).toBe(-15)
    expect(stateNeg.items['item-1'].duration).toBe(20) // 10s source / 0.5 speed = 20s

    // Entering +60 fps
    const cmdPositiveFps = new UpdateSpeedCommand('item-1', { fps: 60 })
    const statePos = cmdPositiveFps.execute(stateNeg)
    expect(statePos.items['item-1'].speed?.reversed).toBe(false)
    expect(statePos.items['item-1'].speed?.speed).toBe(2.0)
    expect(statePos.items['item-1'].speed?.fps).toBe(60)
    expect(statePos.items['item-1'].duration).toBe(5) // 10s source / 2.0 speed = 5s
  })

  it('toggles individual and all keyframes via commands', () => {
    const state: ProjectState = {
      ...createEmptyProjectState(),
      assets: { 'asset-1': asset1 },
      tracks: [trackV1],
      items: { 'item-1': item1 },
      selectedItemId: 'item-1',
    }

    // Toggle single keyframe
    const cmdSingle = new ToggleKeyframeCommand('item-1', 'rotation')
    const stateAfterSingle = cmdSingle.execute(state)
    expect(stateAfterSingle.items['item-1'].keyframeEnabled?.rotation).toBe(true)

    // Toggle all transform keyframes
    const keys = ['zoom', 'position', 'rotation', 'anchor', 'pitch', 'yaw']
    const cmdAll = new ToggleAllKeyframesCommand('item-1', keys, true)
    const stateAfterAll = cmdAll.execute(stateAfterSingle)
    for (const k of keys) {
      expect(stateAfterAll.items['item-1'].keyframeEnabled?.[k]).toBe(true)
    }
  })
})
