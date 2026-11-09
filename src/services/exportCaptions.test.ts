import { describe, expect, it, vi, beforeEach } from 'vitest'
const bridge = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: bridge.invoke, isTauri: () => true }))
import { exportCaptions } from './exportCaptions'
import { projectCaptionCues } from '../core/subtitles/projectCaptionExport'
import { parseSrt, parseVtt } from '../core/subtitles/subtitleParser'
import { createEmptyProjectState } from '../core/project/projectState'
import { DEFAULT_TRANSFORM } from '../core/timeline/types'

function project() {
  const state = createEmptyProjectState({ name: 'My captions', initialTracks: [{ id: 'c', name: 'Captions', type: 'caption' }, { id: 'hidden', name: 'Hidden', type: 'caption', visible: false }] })
  state.items.later = { id: 'later', assetId: '', trackId: 'c', itemType: 'caption', startTime: 7, duration: 1.5, sourceIn: 0, sourceOut: 1.5, transform: { ...DEFAULT_TRANSFORM }, caption: { text: 'Coke का can' } }
  state.items.first = { ...state.items.later, id: 'first', startTime: 1, caption: { text: 'Reviewed correction\nSecond line' } }
  state.items.hidden = { ...state.items.later, id: 'hidden', trackId: 'hidden', caption: { text: 'Not visible' } }
  return state
}
beforeEach(() => { bridge.invoke.mockReset(); bridge.invoke.mockResolvedValue(null) })
describe('File menu caption export', () => {
  it('exports edited timeline captions in chronological order with Unicode and speech gaps', async () => {
    const state = project(), before = structuredClone(state)
    await exportCaptions(state)
    const [command, args] = bridge.invoke.mock.calls[0]
    expect(command).toBe('export_caption_file')
    expect(args.defaultName).toBe('My captions.srt')
    expect(parseSrt(args.srt).map(cue => [cue.startTime, cue.endTime, cue.text])).toEqual([[1, 2.5, 'Reviewed correction\nSecond line'], [7, 8.5, 'Coke का can']])
    expect(parseVtt(args.vtt).map(cue => cue.text)).toEqual(['Reviewed correction\nSecond line', 'Coke का can'])
    expect(state).toEqual(before)
  })
  it('cancels without changing the project and propagates save failures', async () => {
    await expect(exportCaptions(project())).resolves.toBeUndefined()
    bridge.invoke.mockRejectedValueOnce(new Error('Disk is full'))
    await expect(exportCaptions(project())).rejects.toThrow('Disk is full')
  })
  it('rejects empty or invalid caption exports before opening a save dialog', async () => {
    await expect(exportCaptions(createEmptyProjectState())).rejects.toThrow('Add captions')
    const state = project(); state.items.first.duration = -1
    expect(() => projectCaptionCues(state)).toThrow('invalid timing')
    expect(bridge.invoke).not.toHaveBeenCalled()
  })
})
