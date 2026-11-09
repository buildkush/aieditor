import { describe, it, expect } from 'vitest'
import {
  createEmptyProjectState,
  ApplyEffectCommand,
  RemoveEffectCommand,
  ToggleEffectCommand,
  UpdateEffectParamCommand,
  ReorderEffectsCommand,
  type ProjectState,
  type TimelineItem,
  type Track,
  type ItemEffect,
} from '../index'

describe('Effect Commands and ProjectState Reducers', () => {
  const track1: Track = { id: 'track-v1', name: 'Video 1', type: 'video' }
  const item1: TimelineItem = {
    id: 'item-1',
    trackId: 'track-v1',
    assetId: 'asset-1',
    startTime: 0,
    duration: 10,
    sourceIn: 0,
    sourceOut: 10,
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
  }

  const baseState: ProjectState = {
    ...createEmptyProjectState(),
    tracks: [track1],
    items: { 'item-1': item1 },
    selectedItemId: 'item-1',
  }

  const blurEffect: ItemEffect = {
    id: 'fx-blur-1',
    effectId: 'blur',
    name: 'Blur',
    category: 'video',
    enabled: true,
    params: { radius: 10 },
  }

  const brightnessEffect: ItemEffect = {
    id: 'fx-bright-1',
    effectId: 'brightness',
    name: 'Brightness',
    category: 'color',
    enabled: true,
    params: { value: 20 },
  }

  it('ApplyEffectCommand attaches an effect to the target item', () => {
    const cmd = new ApplyEffectCommand('item-1', blurEffect)
    const nextState = cmd.execute(baseState)

    expect(nextState.items['item-1'].effects).toBeDefined()
    expect(nextState.items['item-1'].effects?.length).toBe(1)
    expect(nextState.items['item-1'].effects?.[0].id).toBe('fx-blur-1')
    expect(nextState.items['item-1'].effects?.[0].params.radius).toBe(10)
  })

  it('ToggleEffectCommand enables/disables an attached effect', () => {
    const stateWithEffect: ProjectState = {
      ...baseState,
      items: {
        'item-1': {
          ...item1,
          effects: [blurEffect],
        },
      },
    }

    const cmdToggleOff = new ToggleEffectCommand('item-1', 'fx-blur-1', false)
    const toggledOffState = cmdToggleOff.execute(stateWithEffect)
    expect(toggledOffState.items['item-1'].effects?.[0].enabled).toBe(false)

    const cmdToggleOn = new ToggleEffectCommand('item-1', 'fx-blur-1', true)
    const toggledOnState = cmdToggleOn.execute(toggledOffState)
    expect(toggledOnState.items['item-1'].effects?.[0].enabled).toBe(true)
  })

  it('UpdateEffectParamCommand updates an effect parameter', () => {
    const stateWithEffect: ProjectState = {
      ...baseState,
      items: {
        'item-1': {
          ...item1,
          effects: [blurEffect],
        },
      },
    }

    const cmd = new UpdateEffectParamCommand('item-1', 'fx-blur-1', 'radius', 42.5)
    const nextState = cmd.execute(stateWithEffect)

    expect(nextState.items['item-1'].effects?.[0].params.radius).toBe(42.5)
  })

  it('ReorderEffectsCommand reorders items in the effect stack', () => {
    const stateWithEffects: ProjectState = {
      ...baseState,
      items: {
        'item-1': {
          ...item1,
          effects: [blurEffect, brightnessEffect],
        },
      },
    }

    expect(stateWithEffects.items['item-1'].effects?.[0].id).toBe('fx-blur-1')
    expect(stateWithEffects.items['item-1'].effects?.[1].id).toBe('fx-bright-1')

    const cmd = new ReorderEffectsCommand('item-1', 0, 1)
    const reorderedState = cmd.execute(stateWithEffects)

    expect(reorderedState.items['item-1'].effects?.[0].id).toBe('fx-bright-1')
    expect(reorderedState.items['item-1'].effects?.[1].id).toBe('fx-blur-1')
  })

  it('RemoveEffectCommand removes an effect from the stack', () => {
    const stateWithEffects: ProjectState = {
      ...baseState,
      items: {
        'item-1': {
          ...item1,
          effects: [blurEffect, brightnessEffect],
        },
      },
    }

    const cmd = new RemoveEffectCommand('item-1', 'fx-blur-1')
    const nextState = cmd.execute(stateWithEffects)

    expect(nextState.items['item-1'].effects?.length).toBe(1)
    expect(nextState.items['item-1'].effects?.[0].id).toBe('fx-bright-1')
  })
})
