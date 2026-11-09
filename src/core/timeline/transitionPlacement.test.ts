import { describe, expect, it } from 'vitest'
import { resolveTransitionAttachment, resolveTransitionDrop } from './transitionPlacement'
import { createEmptyProjectState } from '../project/projectState'
import { AddTransitionCommand, SelectItemCommand, UpdateTransitionCommand } from '../commands/editorCommand'
import { CommandHistory } from '../commands/commandHistory'
import { serializeProject, deserializeProject } from '../persistence/projectSerializer'
import { getClipTransitions } from '../commands/projectCommands'
import { DEFAULT_TRANSFORM, type TimelineItem, type TimelineTransition } from './types'

function project(duration = 4): ReturnType<typeof createEmptyProjectState> {
  const items: Record<string, TimelineItem> = {}
  for (const [index, id] of ['first', 'middle', 'last'].entries()) {
    items[id] = { id, trackId: 'v1', assetId: id, startTime: duration * index, duration,
      sourceIn: 0, sourceOut: duration, transform: { ...DEFAULT_TRANSFORM } }
  }
  return { ...createEmptyProjectState(), tracks: [{ id: 'v1', name: 'Video 1', type: 'video' as const }], items }
}
const effect = { id: 'transition', transitionId: 'tr-glitch', name: 'Digital Glitch', params: { intensity: 65 } }

describe('transition attachment', () => {
  it.each([0.5, 4, 4.5, 7.5, 8, 11.5])('locks the snapped position after dropping at %ss', time => {
    const state = project()
    const preview = resolveTransitionDrop(state.items, 'v1', time, 1)!
    const dropped = new AddTransitionCommand({ ...effect, ...preview }).execute(state)
    expect(dropped.transitions!.transition).toMatchObject(preview)
    const moved = new UpdateTransitionCommand(effect.id, { startTime: 100 }).execute(dropped)
    expect(moved.transitions!.transition.startTime).toBe(preview.startTime)
    expect(moved.transitions!.transition.leftClipId).toBe(preview.leftClipId)
    expect(moved.transitions!.transition.rightClipId).toBe(preview.rightClipId)
  })

  it.each([
    [4, 'center', 3.5, 'first', 'middle'],
    [4.5, 'start', 4, 'first', 'middle'],
    [3.5, 'end', 3, 'first', 'middle'],
    [8, 'center', 7.5, 'middle', 'last'],
    [7.5, 'end', 7, 'middle', 'last'],
    [8.5, 'start', 8, 'middle', 'last'],
  ] as const)('automatically aligns a drop at %ss to %s while retaining the cut pair', (time, alignment, startTime, left, right) => {
    const state = project()
    const attachment = resolveTransitionDrop(state.items, 'v1', time, 1)!
    expect(attachment).toMatchObject({ alignment, startTime, leftClipId: left, rightClipId: right })
    const added = new AddTransitionCommand({ ...effect, ...attachment }).execute(state)
    expect(added.transitions!.transition).toMatchObject(attachment)
  })

  it('keeps start and end drops on the middle clip linked to their respective neighbours', () => {
    let state = project()
    state = new AddTransitionCommand({ ...effect, id: 'incoming',
      ...resolveTransitionDrop(state.items, 'v1', 4.5, 1, 'middle')! }).execute(state)
    state = new AddTransitionCommand({ ...effect, id: 'outgoing',
      ...resolveTransitionDrop(state.items, 'v1', 7.5, 1, 'middle')! }).execute(state)
    expect(getClipTransitions(state, 'middle').startTransition).toMatchObject({ id: 'incoming',
      alignment: 'start', startTime: 4, leftClipId: 'first', rightClipId: 'middle' })
    expect(getClipTransitions(state, 'middle').endTransition).toMatchObject({ id: 'outgoing',
      alignment: 'end', startTime: 7, leftClipId: 'middle', rightClipId: 'last' })
    state = new UpdateTransitionCommand('incoming', { alignment: 'center', duration: 2 }).execute(state)
    expect(getClipTransitions(state, 'middle').startTransition).toMatchObject({ startTime: 3,
      leftClipId: 'first', rightClipId: 'middle' })
    expect(getClipTransitions(state, 'middle').endTransition?.id).toBe('outgoing')
  })

  it.each([
    ['first cut centered', 'start', 'center', 3.5, 'first', 'middle'],
    ['second cut centered', 'end', 'center', 7.5, 'middle', 'last'],
    ['first cut entirely in middle', 'start', 'start', 4, 'first', 'middle'],
    ['second cut entirely in middle', 'end', 'end', 7, 'middle', 'last'],
  ] as const)('matches the diagram: %s without changing the linked pair', (_name, edge, alignment, start, left, right) => {
    const state = project()
    const initial = new AddTransitionCommand({ ...effect,
      ...resolveTransitionAttachment(state.items, 'middle', edge, 1)! }).execute(state)
    const changed = new UpdateTransitionCommand(effect.id, { alignment }).execute(initial)
    expect(changed.transitions!.transition).toMatchObject({ startTime: start, duration: 1,
      leftClipId: left, rightClipId: right })
  })

  it('keeps independent transitions on both cuts of the middle clip, including inward alignments', () => {
    let state = project()
    state = new AddTransitionCommand({ ...effect, id: 'incoming',
      ...resolveTransitionAttachment(state.items, 'middle', 'start', 1)! }).execute(state)
    state = new AddTransitionCommand({ ...effect, id: 'outgoing',
      ...resolveTransitionAttachment(state.items, 'middle', 'end', 1)! }).execute(state)
    const cuts = getClipTransitions(state, 'middle')
    expect(cuts.startTransition?.startTime).toBe(3.5)
    expect(cuts.endTransition?.startTime).toBe(7.5)
    state = new UpdateTransitionCommand('incoming', { alignment: 'start' }).execute(state)
    state = new UpdateTransitionCommand('outgoing', { alignment: 'end' }).execute(state)
    expect(Object.keys(state.transitions!)).toHaveLength(2)
    expect(getClipTransitions(state, 'middle').startTransition).toMatchObject({ id: 'incoming', startTime: 4,
      leftClipId: 'first', rightClipId: 'middle' })
    expect(getClipTransitions(state, 'middle').endTransition).toMatchObject({ id: 'outgoing', startTime: 7,
      leftClipId: 'middle', rightClipId: 'last' })
  })

  it.each([
    [4.2, 'first', 'middle'], [5.5, 'first', 'middle'], [6.5, 'middle', 'last'], [7.8, 'middle', 'last'],
  ])('chooses the middle clip edge at %ss', (time, left, right) => {
    const state = project()
    const attachment = resolveTransitionDrop(state.items, 'v1', Number(time), 1, 'middle')!
    expect(attachment.leftClipId).toBe(left)
    expect(attachment.rightClipId).toBe(right)
    const added = new AddTransitionCommand({ ...effect, ...attachment }).execute(state)
    expect(added.transitions!.transition.leftClipId).toBe(left)
    expect(added.transitions!.transition.rightClipId).toBe(right)
  })

  it('chooses the nearest edge even when both cuts fall within the old snap threshold', () => {
    const state = project(0.4)
    const attachment = resolveTransitionDrop(state.items, 'v1', 0.72, 1, 'middle')!
    expect(attachment.leftClipId).toBe('middle')
    expect(attachment.rightClipId).toBe('last')
  })

  it('uses the same attachment for coordinate-only drops and command callers', () => {
    const state = project()
    const attachment = resolveTransitionDrop(state.items, 'v1', 7, 1)!
    const added = new AddTransitionCommand({ ...effect, trackId: 'v1', startTime: 6.5, duration: 1 }).execute(state)
    expect(added.transitions!.transition).toMatchObject(attachment)
    const shuffled = { last: state.items.last, first: state.items.first, middle: state.items.middle }
    expect(resolveTransitionDrop(shuffled, 'v1', 7, 1)).toEqual(attachment)
  })

  it('keeps gap and outer-edge transitions attached to a single clip', () => {
    const state = project()
    state.items.last = { ...state.items.last, startTime: 10 }
    expect(resolveTransitionDrop(state.items, 'v1', 9, 1)).toBeNull()
    const end = resolveTransitionAttachment(state.items, 'middle', 'end', 1)!
    expect(end.leftClipId).toBe('middle')
    expect(end.rightClipId).toBeUndefined()
    const start = resolveTransitionAttachment(state.items, 'first', 'start', 1)!
    expect(start.leftClipId).toBeUndefined()
    expect(start.rightClipId).toBe('first')
  })

  it('never links a different track or an audio clip', () => {
    const state = project()
    state.items.last = { ...state.items.last, trackId: 'v2' }
    expect(resolveTransitionAttachment(state.items, 'middle', 'end', 1)?.rightClipId).toBeUndefined()
    state.items.last = { ...state.items.last, trackId: 'v1', streamType: 'audio' }
    expect(resolveTransitionAttachment(state.items, 'middle', 'end', 1)?.rightClipId).toBeUndefined()
    expect(resolveTransitionDrop(state.items, 'v1', 9, 1, 'last')).toBeNull()
  })

  it('retargets through an explicit command atomically, preserving values, selection and undo', () => {
    let state = project()
    state = new AddTransitionCommand({ ...effect,
      ...resolveTransitionAttachment(state.items, 'middle', 'end', 1, 'start')! }).execute(state)
    state = new SelectItemCommand('middle').execute(state)
    const history = new CommandHistory(state)
    const changed = history.execute(new UpdateTransitionCommand(effect.id,
      resolveTransitionAttachment(state.items, 'middle', 'start', 1, 'start')!))
    expect(changed.transitions!.transition).toMatchObject({ leftClipId: 'first', rightClipId: 'middle',
      duration: 1, alignment: 'start', startTime: 4, params: { intensity: 65 } })
    expect(changed.selectedItemId).toBe('middle')
    expect(getClipTransitions(changed, 'last').startTransition).toBeNull()
    expect(getClipTransitions(changed, 'middle').startTransition?.id).toBe(effect.id)
    expect(history.undo()!.transitions!.transition.leftClipId).toBe('middle')
    expect(history.redo()!.transitions!.transition.leftClipId).toBe('first')
    expect(deserializeProject(serializeProject(changed)).state.transitions!.transition).toEqual(changed.transitions!.transition)
  })

  it('clears the old neighbour when reattaching to an outside edge', () => {
    let state = project()
    state = new AddTransitionCommand({ ...effect,
      ...resolveTransitionAttachment(state.items, 'last', 'start', 1)! }).execute(state)
    const changed = new UpdateTransitionCommand(effect.id,
      resolveTransitionAttachment(state.items, 'last', 'end', 1)!).execute(state)
    expect(changed.transitions!.transition).toMatchObject({ leftClipId: 'last', rightClipId: undefined, startTime: 11 })
    expect(getClipTransitions(changed, 'middle').endTransition).toBeNull()
  })

  it('replaces an existing transition on the destination edge in the same undo step', () => {
    let state = project()
    state = new AddTransitionCommand({ ...effect,
      ...resolveTransitionAttachment(state.items, 'middle', 'start', 1)! }).execute(state)
    state = new AddTransitionCommand({ ...effect, id: 'existing',
      ...resolveTransitionAttachment(state.items, 'middle', 'end', 1)! }).execute(state)
    const history = new CommandHistory(state)
    const changed = history.execute(new UpdateTransitionCommand(effect.id,
      resolveTransitionAttachment(state.items, 'middle', 'end', 1)!))
    expect(Object.keys(changed.transitions!)).toEqual([effect.id])
    expect(Object.keys(history.undo()!.transitions!)).toHaveLength(2)
  })

  it('rejects invalid reattachments without moving the transition', () => {
    let state = project()
    state = new AddTransitionCommand({ ...effect,
      ...resolveTransitionAttachment(state.items, 'middle', 'end', 1)! }).execute(state)
    for (const update of [{ leftClipId: 'first', rightClipId: 'last' }, { leftClipId: 'missing' },
      { leftClipId: undefined, rightClipId: undefined }] satisfies Partial<TimelineTransition>[]) {
      expect(new UpdateTransitionCommand(effect.id, update).execute(state)).toBe(state)
    }
  })
})
