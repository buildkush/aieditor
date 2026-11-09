import { describe, expect, it } from 'vitest'
import { ApplyCaptionStyleCommand, selectedCaptionIds, allCaptionIds } from './captionStyleCommands'
import { ApplyCaptionPresetCommand, ImportSubtitlesCommand, UpdateCaptionCommand } from './editorCommand'
import { CommandHistory } from './commandHistory'
import { createEmptyProjectState } from '../project/projectState'
import { deserializeProject, serializeProject } from '../persistence/projectSerializer'

function fixture() {
  let state = new ImportSubtitlesCommand('1\n00:00:01,000 --> 00:00:02,000\nyour story\n\n2\n00:00:03,000 --> 00:00:04,000\nsomething big\n\n3\n00:00:05,000 --> 00:00:06,000\nanother caption\n').execute(createEmptyProjectState())
  const ids = allCaptionIds(state)
  state = { ...state, selectedItemId: ids[0], selectedItemIds: [ids[0], ids[1]], items: { ...state.items,
    video: { ...state.items[ids[0]], id: 'video', caption: undefined, itemType: 'video', linkedItemId: ids[2] },
  } }
  return { state, ids }
}

describe('Caption style batch commands', () => {
  it('styles every explicitly selected caption once without touching other media or linked partners', () => {
    const { state, ids } = fixture()
    state.selectedItemIds!.push('video', ids[0])
    expect(selectedCaptionIds(state)).toEqual([ids[0], ids[1]])
    const history = new CommandHistory(state)
    const result = history.execute(new ApplyCaptionStyleCommand(selectedCaptionIds(state), { preset: 'Yellow Focus' }))
    for (const id of ids.slice(0, 2)) {
      expect(result.items[id].caption!.preset).toBe('Yellow Focus')
      expect(result.items[id].caption!.words!.filter(word => word.highlight)).toHaveLength(1)
      expect(result.items[id].caption!.text).toBe(state.items[id].caption!.text)
      expect(result.items[id].caption!.words!.map(w=>[w.startTime,w.endTime])).toEqual(state.items[id].caption!.words!.map(w=>[w.startTime,w.endTime]))
    }
    expect(result.items[ids[2]]).toBe(state.items[ids[2]])
    expect(result.items.video).toBe(state.items.video)
    expect(history.undoCount).toBe(1)
    expect(history.undo()).toEqual(state); expect(history.redo()).toEqual(result)
    expect(state.items[ids[0]].caption!.preset).toBe('Clean')
  })
  it('applies the source caption’s custom style to all captions while preserving each emphasis word', () => {
    let { state, ids } = fixture()
    for (const id of ids) state = new ApplyCaptionPresetCommand(id, 'Script Focus').execute(state)
    state = new UpdateCaptionCommand(ids[1], { words: state.items[ids[1]].caption!.words!.map((w,i)=>({...w,highlight:i===0})) }).execute(state)
    state = new UpdateCaptionCommand(ids[0], { style: { fontSize: 77, color: '#abcdef' } }).execute(state)
    const source = state.items[ids[0]].caption!
    const result = new ApplyCaptionStyleCommand(allCaptionIds(state), { preset: source.preset, style: source.style, presentation: source.presentation, activeWordColor: source.activeWordColor }).execute(state)
    for (const id of ids) {
      expect(result.items[id].caption!.style).toEqual(source.style)
      expect(result.items[id].caption!.presentation).toEqual(source.presentation)
      expect(result.items[id].caption!.words).toEqual(state.items[id].caption!.words)
    }
    expect(deserializeProject(serializeProject(result)).state.items).toEqual(result.items)
  })
  it('patches typography across selection without overwriting unrelated per-caption style settings', () => {
    let { state, ids } = fixture()
    state = new ApplyCaptionPresetCommand(ids[1], 'Green Pill').execute(state)
    const result = new ApplyCaptionStyleCommand(selectedCaptionIds(state), { style: { fontSize: 66 } }).execute(state)
    expect(result.items[ids[0]].caption!.style!.fontSize).toBe(66)
    expect(result.items[ids[1]].caption!.style!.fontSize).toBe(66)
    expect(result.items[ids[1]].caption!.presentation).toEqual(state.items[ids[1]].caption!.presentation)
    expect(result.items[ids[1]].caption!.style!.backgroundColor).toBe('#59B86C')
    expect(result.items[ids[2]]).toBe(state.items[ids[2]])
  })
  it('skips locked tracks and invalid/non-caption IDs and safely handles an empty selection', () => {
    const { state, ids } = fixture()
    const locked = { ...state, tracks: state.tracks.map(track=>({...track,locked:true})) }
    expect(new ApplyCaptionStyleCommand(allCaptionIds(locked),{preset:'Bold'}).execute(locked)).toBe(locked)
    expect(new ApplyCaptionStyleCommand(['missing','video'],{preset:'Bold'}).execute(state)).toBe(state)
    expect(new ApplyCaptionStyleCommand([],{preset:'Bold'}).execute(state)).toBe(state)
    expect(selectedCaptionIds({...state,selectedItemId:null,selectedItemIds:[]})).toEqual([])
    const input = { style: { fontSize: 55 } }
    const command = new ApplyCaptionStyleCommand([ids[0], ids[0]], input)
    input.style.fontSize = 99
    expect(command.payload.itemIds).toEqual([ids[0]])
    expect(command.execute(state).items[ids[0]].caption!.style!.fontSize).toBe(55)
  })
})
