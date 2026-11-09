import { describe, it, expect } from 'vitest'
import { createEmptyProjectState, type ProjectState } from '../project/projectState'
import {
  applyItemEffect,
  toggleItemEffect,
  updateItemEffectTiming,
  splitTimelineItem,
  trimTimelineItem,
  moveTimelineItem,
} from '../commands/projectCommands'
import {
  ApplyEffectCommand,
  UpdateEffectTimingCommand,
  ResetEffectParamsCommand,
} from '../commands/editorCommand'
import { CommandHistory } from '../commands/commandHistory'
import {
  type ItemEffect,
  type TimelineItem,
  getEffectActiveRange,
  isEffectActiveAtLocalTime,
} from './types'
import { evaluateItemEffects } from './effectEvaluation'
import { getPlaybackFrameInfo } from '../playback/timelinePlayback'
import { serializeProject, deserializeProject } from '../persistence/projectSerializer'

describe('aiditor — Clip-Level Effects, Timing & Rendering Architecture', () => {
  function createTestState(): ProjectState {
    const base = createEmptyProjectState({
      id: 'proj-fx',
      name: 'Effects Test',
      initialTracks: [
        { id: 'track-v1', name: 'Video 1', type: 'video' },
        { id: 'track-v2', name: 'Video 2', type: 'video' },
      ],
    })
    const item1: TimelineItem = {
      id: 'clip-1',
      trackId: 'track-v1',
      assetId: 'asset-1',
      startTime: 5,
      duration: 10,
      sourceIn: 0,
      sourceOut: 10,
      transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
    }
    const item2: TimelineItem = {
      id: 'clip-2',
      trackId: 'track-v1',
      assetId: 'asset-2',
      startTime: 15,
      duration: 10,
      sourceIn: 0,
      sourceOut: 10,
      transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
    }
    return {
      ...base,
      items: {
        'clip-1': item1,
        'clip-2': item2,
      },
    }
  }

  // 1. Clip-Level Isolation
  it('attaches effect to the specific clip without affecting other clips or tracks', () => {
    let state = createTestState()
    const blurFx: ItemEffect = {
      id: 'fx-blur-1',
      effectId: 'blur',
      name: 'Blur',
      category: 'video',
      enabled: true,
      params: { radius: 15 },
      rangeMode: 'fullClip',
    }

    state = applyItemEffect(state, 'clip-1', blurFx)

    expect(state.items['clip-1'].effects).toBeDefined()
    expect(state.items['clip-1'].effects?.length).toBe(1)
    expect(state.items['clip-1'].effects?.[0].effectId).toBe('blur')

    // clip-2 must remain completely unaffected
    expect(state.items['clip-2'].effects).toBeUndefined()
  })

  // 2. New Effects Cover Full Clip by Default
  it('defaults newly applied effects to fullClip active range covering the entire clip', () => {
    let state = createTestState()
    const brightnessFx: ItemEffect = {
      id: 'fx-bright-1',
      effectId: 'brightness',
      name: 'Brightness',
      category: 'color',
      enabled: true,
      params: { value: 20 },
      rangeMode: 'fullClip',
      startOffset: 0,
      endOffset: 10,
    }

    state = applyItemEffect(state, 'clip-1', brightnessFx)
    const eff = state.items['clip-1'].effects![0]
    const range = getEffectActiveRange(eff, state.items['clip-1'].duration)

    expect(eff.rangeMode).toBe('fullClip')
    expect(range.startOffset).toBe(0)
    expect(range.endOffset).toBe(10)
    expect(range.duration).toBe(10)
  })

  // 3. Independent Effect Timing Adjustment
  it('adjusts effect timing independently to custom range within parent clip duration', () => {
    let state = createTestState()
    const fx: ItemEffect = {
      id: 'fx-1',
      effectId: 'blur',
      name: 'Blur',
      category: 'video',
      enabled: true,
      params: { radius: 10 },
      rangeMode: 'fullClip',
    }
    state = applyItemEffect(state, 'clip-1', fx)

    // Update timing to custom: 2s to 6s
    state = updateItemEffectTiming(state, 'clip-1', 'fx-1', {
      rangeMode: 'custom',
      startOffset: 2,
      endOffset: 6,
    })

    const updated = state.items['clip-1'].effects![0]
    expect(updated.rangeMode).toBe('custom')
    expect(updated.startOffset).toBe(2)
    expect(updated.endOffset).toBe(6)

    // Clamps within valid clip boundaries [0, duration]
    state = updateItemEffectTiming(state, 'clip-1', 'fx-1', {
      startOffset: -5,
      endOffset: 25,
    })
    const clamped = state.items['clip-1'].effects![0]
    expect(clamped.startOffset).toBe(0)
    expect(clamped.endOffset).toBe(10)
  })

  // 4. Moving Clip Preserves Relative Effect Timing
  it('preserves effect timing relative to clip when clip moves on the timeline', () => {
    let state = createTestState()
    const fx: ItemEffect = {
      id: 'fx-1',
      effectId: 'blur',
      name: 'Blur',
      category: 'video',
      enabled: true,
      params: { radius: 10 },
      rangeMode: 'custom',
      startOffset: 2,
      endOffset: 5,
    }
    state = applyItemEffect(state, 'clip-1', fx)

    // Move clip from startTime 5 to 25
    state = moveTimelineItem(state, 'clip-1', 25)

    const moved = state.items['clip-1']
    expect(moved.startTime).toBe(25)
    // Local timing is preserved
    expect(moved.effects?.[0].startOffset).toBe(2)
    expect(moved.effects?.[0].endOffset).toBe(5)

    // In project coordinates, effect is active between 27s and 30s
    expect(isEffectActiveAtLocalTime(moved.effects![0], 1, moved.duration)).toBe(false)
    expect(isEffectActiveAtLocalTime(moved.effects![0], 2.5, moved.duration)).toBe(true)
    expect(isEffectActiveAtLocalTime(moved.effects![0], 6, moved.duration)).toBe(false)
  })

  // 5. Trimming and Splitting Clips
  it('adapts custom effect timing during clip trim', () => {
    let state = createTestState()
    const fx: ItemEffect = {
      id: 'fx-1',
      effectId: 'blur',
      name: 'Blur',
      category: 'video',
      enabled: true,
      params: { radius: 10 },
      rangeMode: 'custom',
      startOffset: 3,
      endOffset: 7,
    }
    state = applyItemEffect(state, 'clip-1', fx)

    // Left trim: start moves from 5 to 6 (delta = 1)
    state = trimTimelineItem(state, 'clip-1', { edge: 'left', newTime: 6 })

    let trimmed = state.items['clip-1']
    expect(trimmed.startTime).toBe(6)
    expect(trimmed.duration).toBe(9)
    // startOffset: 3 - 1 = 2, endOffset: 7 - 1 = 6
    expect(trimmed.effects?.[0].startOffset).toBe(2)
    expect(trimmed.effects?.[0].endOffset).toBe(6)

    // Right trim: shorten clip duration to 5
    state = trimTimelineItem(state, 'clip-1', { edge: 'right', newTime: 11 })
    trimmed = state.items['clip-1']
    expect(trimmed.duration).toBe(5)
    // endOffset clamped to new duration 5
    expect(trimmed.effects?.[0].startOffset).toBe(2)
    expect(trimmed.effects?.[0].endOffset).toBe(5)
  })

  it('partitions effect timing correctly across split clips', () => {
    let state = createTestState() // clip-1 is [5, 15), duration 10
    const earlyFx: ItemEffect = {
      id: 'fx-early',
      effectId: 'blur',
      name: 'Early Blur',
      category: 'video',
      enabled: true,
      params: {},
      rangeMode: 'custom',
      startOffset: 1,
      endOffset: 3,
    }
    const lateFx: ItemEffect = {
      id: 'fx-late',
      effectId: 'grayscale',
      name: 'Late Grayscale',
      category: 'video',
      enabled: true,
      params: {},
      rangeMode: 'custom',
      startOffset: 6,
      endOffset: 9,
    }
    const spanningFx: ItemEffect = {
      id: 'fx-span',
      effectId: 'brightness',
      name: 'Spanning Brightness',
      category: 'color',
      enabled: true,
      params: { value: 30 },
      rangeMode: 'custom',
      startOffset: 2,
      endOffset: 8,
    }
    const fullFx: ItemEffect = {
      id: 'fx-full',
      effectId: 'contrast',
      name: 'Full Contrast',
      category: 'color',
      enabled: true,
      params: {},
      rangeMode: 'fullClip',
    }

    state = applyItemEffect(state, 'clip-1', earlyFx)
    state = applyItemEffect(state, 'clip-1', lateFx)
    state = applyItemEffect(state, 'clip-1', spanningFx)
    state = applyItemEffect(state, 'clip-1', fullFx)

    // Split clip-1 at project time 9 (local time 4 within duration 10)
    state = splitTimelineItem(state, 'clip-1', 9, 'clip-1-left', 'clip-1-right')

    const left = state.items['clip-1-left']
    const right = state.items['clip-1-right']

    expect(left).toBeDefined()
    expect(right).toBeDefined()
    expect(left.duration).toBe(4)
    expect(right.duration).toBe(6)

    // Early effect [1, 3] belongs ONLY to left half
    expect(left.effects?.some((e: ItemEffect) => e.effectId === 'blur')).toBe(true)
    expect(right.effects?.some((e: ItemEffect) => e.effectId === 'blur')).toBe(false)
    const leftEarly = left.effects?.find((e: ItemEffect) => e.effectId === 'blur')!
    expect(leftEarly.startOffset).toBe(1)
    expect(leftEarly.endOffset).toBe(3)

    // Late effect [6, 9] belongs ONLY to right half, offset shifted by 4
    expect(left.effects?.some((e: ItemEffect) => e.effectId === 'grayscale')).toBe(false)
    expect(right.effects?.some((e: ItemEffect) => e.effectId === 'grayscale')).toBe(true)
    const rightLate = right.effects?.find((e: ItemEffect) => e.effectId === 'grayscale')!
    expect(rightLate.startOffset).toBe(2) // 6 - 4
    expect(rightLate.endOffset).toBe(5)   // 9 - 4

    // Spanning effect [2, 8] is partitioned into left [2, 4] and right [0, 4]
    const leftSpan = left.effects?.find((e: ItemEffect) => e.effectId === 'brightness')!
    const rightSpan = right.effects?.find((e: ItemEffect) => e.effectId === 'brightness')!
    expect(leftSpan.startOffset).toBe(2)
    expect(leftSpan.endOffset).toBe(4)
    expect(rightSpan.startOffset).toBe(0)
    expect(rightSpan.endOffset).toBe(4)

    // Full clip effect stays on both pieces
    const leftFull = left.effects?.find((e: ItemEffect) => e.effectId === 'contrast')!
    const rightFull = right.effects?.find((e: ItemEffect) => e.effectId === 'contrast')!
    expect(leftFull.rangeMode).toBe('fullClip')
    expect(rightFull.rangeMode).toBe('fullClip')
  })

  // 6. Multiple Effects on One Clip with Independent Timing
  it('supports multiple effects on one clip with distinct timing ranges and parameters', () => {
    let state = createTestState()
    const blurFx: ItemEffect = {
      id: 'fx-b',
      effectId: 'blur',
      name: 'Blur',
      category: 'video',
      enabled: true,
      params: { radius: 20 },
      rangeMode: 'custom',
      startOffset: 0,
      endOffset: 4,
    }
    const grayFx: ItemEffect = {
      id: 'fx-g',
      effectId: 'grayscale',
      name: 'Grayscale',
      category: 'video',
      enabled: true,
      params: { intensity: 100 },
      rangeMode: 'custom',
      startOffset: 3,
      endOffset: 8,
    }

    state = applyItemEffect(state, 'clip-1', blurFx)
    state = applyItemEffect(state, 'clip-1', grayFx)

    const item = state.items['clip-1']
    expect(item.effects?.length).toBe(2)

    // At playhead 6s (local time 1s): only blur is active
    const evalAt6 = evaluateItemEffects(item, 6)
    expect(evalAt6.filterStr).toContain('blur')
    expect(evalAt6.filterStr).not.toContain('grayscale')

    // At playhead 8.5s (local time 3.5s): both blur and grayscale are active
    const evalAt8_5 = evaluateItemEffects(item, 8.5)
    expect(evalAt8_5.filterStr).toContain('blur')
    expect(evalAt8_5.filterStr).toContain('grayscale')

    // At playhead 11s (local time 6s): only grayscale is active
    const evalAt11 = evaluateItemEffects(item, 11)
    expect(evalAt11.filterStr).not.toContain('blur')
    expect(evalAt11.filterStr).toContain('grayscale')
  })

  // 7. Preview Rendering & Evaluation
  it('generates correct CSS filter strings and respects enable/disable toggles', () => {
    let state = createTestState()
    const fx: ItemEffect = {
      id: 'fx-1',
      effectId: 'brightness',
      name: 'Brightness',
      category: 'color',
      enabled: true,
      params: { value: 50 },
      rangeMode: 'fullClip',
    }
    state = applyItemEffect(state, 'clip-1', fx)

    let evalRes = evaluateItemEffects(state.items['clip-1'], 8)
    expect(evalRes.filterStr).toBe('brightness(1.50)')

    // Disabling effect excludes it from rendering
    state = toggleItemEffect(state, 'clip-1', 'fx-1', false)
    evalRes = evaluateItemEffects(state.items['clip-1'], 8)
    expect(evalRes.filterStr).toBeUndefined()
  })

  // 8. Adjustment Layer Compositing
  it('activates Adjustment Layer in playback frame info during its duration', () => {
    let state = createTestState()
    // Add adjustment layer on track-v2 from 2s to 8s
    const adjLayer: TimelineItem = {
      id: 'adj-1',
      trackId: 'track-v2',
      assetId: '',
      itemType: 'adjustment',
      startTime: 2,
      duration: 6,
      sourceIn: 0,
      sourceOut: 6,
      transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
      effects: [
        {
          id: 'fx-adj-blur',
          effectId: 'blur',
          name: 'Blur',
          category: 'video',
          enabled: true,
          params: { radius: 12 },
          rangeMode: 'fullClip',
        },
      ],
    }
    state = {
      ...state,
      items: {
        ...state.items,
        'adj-1': adjLayer,
      },
    }

    // Playhead at 5s: adjustment layer is active
    const infoActive = getPlaybackFrameInfo(state, 5)
    expect(infoActive.activeVideos.some((c) => c.item.id === 'adj-1')).toBe(true)

    // Playhead at 10s: outside adjustment layer's interval (2s-8s)
    const infoInactive = getPlaybackFrameInfo(state, 10)
    expect(infoInactive.activeVideos.some((c) => c.item.id === 'adj-1')).toBe(false)
  })

  // 9. Command History, Undo & Redo
  it('supports full undo and redo for all effect commands', () => {
    const history = new CommandHistory(createTestState())
    const fx: ItemEffect = {
      id: 'fx-cmd-1',
      effectId: 'blur',
      name: 'Blur',
      category: 'video',
      enabled: true,
      params: { radius: 10 },
      rangeMode: 'fullClip',
    }

    // 1. Apply effect
    history.execute(new ApplyEffectCommand('clip-1', fx))
    expect(history.getCurrentState().items['clip-1'].effects?.length).toBe(1)

    // 2. Update timing
    history.execute(
      new UpdateEffectTimingCommand('clip-1', 'fx-cmd-1', {
        rangeMode: 'custom',
        startOffset: 1,
        endOffset: 5,
      })
    )
    expect(history.getCurrentState().items['clip-1'].effects?.[0].rangeMode).toBe('custom')
    expect(history.getCurrentState().items['clip-1'].effects?.[0].endOffset).toBe(5)

    // 3. Reset params
    history.execute(new ResetEffectParamsCommand('clip-1', 'fx-cmd-1', { radius: 10 }))
    expect(history.getCurrentState().items['clip-1'].effects?.[0].params.radius).toBe(10)

    // Undo reset
    history.undo()
    // Undo timing
    history.undo()
    expect(history.getCurrentState().items['clip-1'].effects?.[0].rangeMode).toBe('fullClip')

    // Undo apply
    history.undo()
    expect(history.getCurrentState().items['clip-1'].effects?.length ?? 0).toBe(0)

    // Redo apply
    history.redo()
    expect(history.getCurrentState().items['clip-1'].effects?.length).toBe(1)
  })

  // 10. Persistence
  it('preserves all effect properties and timing through project serialization/deserialization', () => {
    let state = createTestState()
    const fx: ItemEffect = {
      id: 'fx-persist',
      effectId: 'saturation',
      name: 'Saturation',
      category: 'color',
      enabled: true,
      params: { value: 160 },
      rangeMode: 'custom',
      startOffset: 1.5,
      endOffset: 8.5,
    }
    state = applyItemEffect(state, 'clip-1', fx)

    const serialized = serializeProject(state)
    const { state: restored } = deserializeProject(serialized)

    const restoredFx = restored.items['clip-1'].effects?.[0]
    expect(restoredFx).toBeDefined()
    expect(restoredFx?.effectId).toBe('saturation')
    expect(restoredFx?.rangeMode).toBe('custom')
    expect(restoredFx?.startOffset).toBe(1.5)
    expect(restoredFx?.endOffset).toBe(8.5)
    expect(restoredFx?.params.value).toBe(160)
  })
})
