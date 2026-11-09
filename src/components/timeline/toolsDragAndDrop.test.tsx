import { describe, it, expect } from 'vitest'
import {
  createEmptyProjectState,
  type ProjectState,
  type TimelineItem,
  type Track,
} from '../../core'
import {
  AddTextLayerCommand,
  AddCaptionCommand,
  AddSolidLayerCommand,
  AddAdjustmentLayerCommand,
  ApplyEffectCommand,
} from '../../core/commands/editorCommand'
import { isTrackCompatible } from '../../core/timeline/types'
import { EFFECT_DEFINITIONS } from '../tools/effectDefinitions'
import { TEXT_TOOL_PRESETS } from '../tools/toolPresets'
import { setActiveDraggedTool, getActiveDraggedTool } from '../tools/activeDragTool'

describe('Tools Drag and Drop Integration', () => {
  const trackV1: Track = { id: 'track-v1', name: 'Video 1', type: 'video' }
  const trackA1: Track = { id: 'track-a1', name: 'Audio 1', type: 'audio' }
  const trackC1: Track = { id: 'track-c1', name: 'Caption 1', type: 'caption' }

  const videoClip: TimelineItem = {
    id: 'clip-v1',
    trackId: 'track-v1',
    assetId: 'asset-video',
    startTime: 0,
    duration: 10,
    sourceIn: 0,
    sourceOut: 10,
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
    streamType: 'video',
  }

  const audioClip: TimelineItem = {
    id: 'clip-a1',
    trackId: 'track-a1',
    assetId: 'asset-audio',
    startTime: 0,
    duration: 10,
    sourceIn: 0,
    sourceOut: 10,
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
    streamType: 'audio',
  }

  const baseState: ProjectState = {
    ...createEmptyProjectState(),
    tracks: [trackV1, trackA1, trackC1],
    items: {
      'clip-v1': videoClip,
      'clip-a1': audioClip,
    },
    selectedItemId: 'clip-v1',
    playheadTime: 0,
  }

  it('rejects dropping visual layer tools on audio tracks', () => {
    // Text, Solid, Adjustment must never be compatible with audio tracks
    expect(isTrackCompatible('audio', 'text')).toBe(false)
    expect(isTrackCompatible('audio', 'solid')).toBe(false)
    expect(isTrackCompatible('audio', 'adjustment')).toBe(false)
    expect(isTrackCompatible('audio', 'caption')).toBe(false)

    // Visual tracks accept text, solid, adjustment
    expect(isTrackCompatible('video', 'text')).toBe(true)
    expect(isTrackCompatible('video', 'solid')).toBe(true)
    expect(isTrackCompatible('video', 'adjustment')).toBe(true)
    expect(isTrackCompatible('caption', 'caption')).toBe(true)
  })

  it('dispatches AddTextLayerCommand with preset configuration when text presets are dropped', () => {
    const headingPreset = TEXT_TOOL_PRESETS.find((p) => p.name === 'Heading')!
    expect(headingPreset).toBeDefined()

    const cmd = new AddTextLayerCommand({
      startTime: 3.5,
      duration: headingPreset.duration,
      trackId: 'track-v1',
      text: headingPreset.text,
      properties: headingPreset.properties,
      transform: headingPreset.transform,
    })

    const nextState = cmd.execute(baseState)
    const newItems = Object.values(nextState.items).filter((it) => it.id !== 'clip-v1' && it.id !== 'clip-a1')
    expect(newItems).toHaveLength(1)
    const created = newItems[0]
    expect(created.itemType).toBe('text')
    expect(created.text?.text).toBe('HEADING')
    expect(created.text?.fontSize).toBe(76)
    expect(created.text?.fontWeight).toBe('800')
    expect(created.startTime).toBe(3.5)
    expect(created.trackId).toBe('track-v1')
  })

  it('dispatches AddCaptionCommand with preset configuration when subtitle presets are dropped', () => {
    const subtitlePreset = TEXT_TOOL_PRESETS.find((p) => p.name === 'Subtitle')!
    expect(subtitlePreset).toBeDefined()

    const cmd = new AddCaptionCommand({
      startTime: 2.0,
      duration: subtitlePreset.duration,
      trackId: 'track-c1',
      text: subtitlePreset.text,
      preset: subtitlePreset.captionPreset,
      style: subtitlePreset.captionStyle,
      transform: subtitlePreset.transform,
    })

    const nextState = cmd.execute(baseState)
    const newItems = Object.values(nextState.items).filter((it) => it.id !== 'clip-v1' && it.id !== 'clip-a1')
    expect(newItems).toHaveLength(1)
    const created = newItems[0]
    expect(created.itemType).toBe('caption')
    expect(created.caption?.text).toBe('Subtitle cue')
    expect(created.caption?.preset).toBe('Clean')
    expect(created.caption?.words).toBeDefined()
    expect(created.startTime).toBe(2.0)
    expect(created.trackId).toBe('track-c1')
  })

  it('dispatches AddSolidLayerCommand when solid color is dropped', () => {
    const cmd = new AddSolidLayerCommand({
      startTime: 1.0,
      duration: 5,
      trackId: 'track-v1',
      color: '#3b82f6',
    })

    const nextState = cmd.execute(baseState)
    const newItems = Object.values(nextState.items).filter((it) => it.id !== 'clip-v1' && it.id !== 'clip-a1')
    expect(newItems).toHaveLength(1)
    const created = newItems[0]
    expect(created.itemType).toBe('solid')
    expect(created.solid?.color).toBe('#3b82f6')
    expect(created.startTime).toBe(1.0)
  })

  it('dispatches AddAdjustmentLayerCommand when adjustment layer is dropped', () => {
    const cmd = new AddAdjustmentLayerCommand({
      startTime: 0.5,
      duration: 5,
      trackId: 'track-v1',
    })

    const nextState = cmd.execute(baseState)
    const newItems = Object.values(nextState.items).filter((it) => it.id !== 'clip-v1' && it.id !== 'clip-a1')
    expect(newItems).toHaveLength(1)
    const created = newItems[0]
    expect(created.itemType).toBe('adjustment')
    expect(created.startTime).toBe(0.5)
  })

  it('applies effect to target clip via ApplyEffectCommand', () => {
    const blurDef = EFFECT_DEFINITIONS.find((e) => e.id === 'blur')!
    expect(blurDef).toBeDefined()

    const defaultParams: Record<string, any> = {}
    for (const p of blurDef.params) {
      defaultParams[p.key] = p.defaultVal
    }

    const cmd = new ApplyEffectCommand('clip-v1', {
      id: 'fx-test-1',
      effectId: blurDef.id,
      name: blurDef.name,
      category: blurDef.category,
      enabled: true,
      params: defaultParams,
    })

    const nextState = cmd.execute(baseState)
    const updated = nextState.items['clip-v1']
    expect(updated.effects).toBeDefined()
    expect(updated.effects).toHaveLength(1)
    expect(updated.effects![0].effectId).toBe('blur')
    expect(updated.effects![0].name).toBe('Blur')
    expect(updated.effects![0].enabled).toBe(true)
    expect(updated.effects![0].params.radius).toBe(10)
  })

  it('handles active drag tool state cleanly across drag lifecycle', () => {
    setActiveDraggedTool(null)
    expect(getActiveDraggedTool()).toBeNull()

    const blurDef = EFFECT_DEFINITIONS.find((e) => e.id === 'blur')!
    setActiveDraggedTool({
      type: 'effect',
      dragType: 'effect',
      effect: blurDef,
    })

    const active = getActiveDraggedTool()
    expect(active?.dragType).toBe('effect')
    if (active && active.dragType === 'effect') {
      expect(active.effect.id).toBe('blur')
    }

    setActiveDraggedTool(null)
    expect(getActiveDraggedTool()).toBeNull()
  })
})
