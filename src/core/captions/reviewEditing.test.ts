import { describe, expect, it } from 'vitest'
import { createEmptyProjectState } from '../project/projectState'
import { DEFAULT_TRANSFORM } from '../timeline/types'
import { projectAudioPlan } from './projectAudioPlan'
import { activeCaptionWord, captionWordGroups, reviewedCaptionCues } from './transcriptReview'
import { captionPreviewItems, commitCaptionReview, editCaptionReview, initializeCaptionReview, travelCaptionReview, type CaptionReviewHistory } from './reviewEditing'
import type { CaptionTranscript } from './types'
import { isCaptionTranscript } from './types'
import { ImportAutoCaptionsCommand } from '../commands/importAutoCaptionsCommand'
import { CommandHistory } from '../commands/commandHistory'
import { serializeProject, deserializeProject, validateProjectFile } from '../persistence/projectSerializer'
import { getPlaybackFrameInfo } from '../playback/timelinePlayback'
import { captionPlaybackTolerance } from './playbackTiming'

function fixture() {
  const state = createEmptyProjectState({ id: 'review-project', initialTracks: [{ id: 'a1', name: 'Audio', type: 'audio' }, { id: 'c1', name: 'Subtitles', type: 'caption' }] })
  state.assets.source = { id: 'source', path: 'C:/source.wav', name: 'Source', type: 'audio' }
  state.items.audio = { id: 'audio', assetId: 'source', trackId: 'a1', itemType: 'audio', startTime: 0, duration: 12, sourceIn: 0, sourceOut: 12, transform: { ...DEFAULT_TRANSFORM } }
  const nativeWords = [
    { text: 'Coke', startTime: 1, endTime: 1.3 }, { text: 'का', startTime: 1.3, endTime: 1.5 },
    { text: 'can', startTime: 1.5, endTime: 1.8 }, { text: 'है।', startTime: 1.8, endTime: 2.1 },
    { text: 'फिर', startTime: 7, endTime: 7.3 }, { text: 'Coke', startTime: 7.3, endTime: 7.7 }, { text: 'आया।', startTime: 7.7, endTime: 8.1 },
  ]
  const original: CaptionTranscript = { id: 'transcript', nativeText: nativeWords.map(word => word.text).join(' '), nativeWords, rawResponse: { original: true }, language: 'hi', outputFormat: 'hinglish', nativeEdits: {}, romanEdits: {}, audioSha256: 'hash', audioPlan: projectAudioPlan(state) }
  return { state, original, draft: initializeCaptionReview(original) }
}

describe('Editable local caption review', () => {
  it('initializes readable groups while preserving ASR archive and silence', () => {
    const { draft, original } = fixture()
    expect(draft.review!.segments.map(segment => segment.words.length)).toEqual([4, 3])
    expect(reviewedCaptionCues(draft).map(cue => [cue.startTime, cue.endTime])).toEqual([[1, 2.1], [7, 8.1]])
    expect(draft.nativeWords).toEqual(original.nativeWords)
    expect(original.review).toBeUndefined()
  })
  it('inserts a missing word without redistributing existing word timestamps or IDs', () => {
    const { draft } = fixture(), first = draft.review!.segments[0]
    const edited = editCaptionReview(draft, { type: 'text', id: first.id, text: 'Coke golden ka can hai.' })
    const retained = edited.review!.segments[0].words.filter(word => word.nativeIndex !== undefined)
    expect(retained.map(word => [word.id, word.startTime, word.endTime])).toEqual(first.words.map(word => [word.id, word.startTime, word.endTime]))
    expect(reviewedCaptionCues(edited)[0].text).toBe('Coke golden ka can hai.')
    expect(edited.nativeWords).toEqual(draft.nativeWords)
    expect(isCaptionTranscript(edited)).toBe(true)
  })
  it('keeps independent script corrections without rerunning recognition', () => {
    const { draft } = fixture(), id = draft.review!.segments[0].id
    const edited = editCaptionReview(draft, { type: 'text', id, text: 'Coke ka can hain.' })
    expect(reviewedCaptionCues(edited)[0].text).toBe('Coke ka can hain.')
    expect(reviewedCaptionCues({ ...edited, outputFormat: 'hindi' })[0].text).toBe('Coke का can है।')
    expect(edited.nativeText).toBe(draft.nativeText)
  })
  it('adds at the playhead inside a free gap, and deletes without changing native words', () => {
    const { draft } = fixture()
    const added = editCaptionReview(draft, { type: 'insert', id: 'manual', time: 4 })
    expect(added.review!.segments[1]).toMatchObject({ id: 'manual', startTime: 4, endTime: 5.2 })
    expect(added.review!.segments[1].words.every(word => word.nativeIndex === undefined)).toBe(true)
    expect(editCaptionReview(added, { type: 'delete', id: 'manual' })).toEqual(draft)
    expect(() => editCaptionReview(draft, { type: 'insert', id: 'late', time: 12 })).toThrow('room')
  })
  it('splits at a word boundary and merges without changing word times or styling', () => {
    const { draft } = fixture(), first = draft.review!.segments[0]
    const styled = editCaptionReview(draft, { type: 'emphasis', id: first.id, wordIds: [first.words[1].id], style: { fontWeight: '700', fontStyle: 'italic', color: '#ff0000', backgroundColor: '#222222' } })
    const split = editCaptionReview(styled, { type: 'split', id: first.id, at: 2, newId: 'split' })
    expect(split.review!.segments[0].endTime).toBe(1.5)
    expect(split.review!.segments[1].startTime).toBe(1.5)
    expect(editCaptionReview(split, { type: 'merge', id: first.id })).toEqual(styled)
    expect(() => editCaptionReview(draft, { type: 'split', id: first.id, at: 0, newId: 'bad' })).toThrow('between words')
  })
  it('allows explicit timing corrections, prevents overlap/out-of-audio bounds and preserves the native archive', () => {
    const { draft } = fixture(), first = draft.review!.segments[0]
    const shifted = editCaptionReview(draft, { type: 'time', id: first.id, startTime: 1.5, endTime: 2.6, shiftWords: true })
    expect(shifted.review!.segments[0].words[0]).toMatchObject({ startTime: 1.5, endTime: 1.8 })
    expect(shifted.nativeWords).toEqual(draft.nativeWords)
    expect(() => editCaptionReview(draft, { type: 'time', id: first.id, startTime: 1, endTime: 7.1 })).toThrow('overlap')
    expect(() => editCaptionReview(draft, { type: 'time', id: first.id, startTime: -1, endTime: 2 })).toThrow('inside the audio')
    expect(() => editCaptionReview(draft, { type: 'time', id: first.id, startTime: 1, endTime: 13 })).toThrow('inside the audio')
    expect(() => editCaptionReview(draft, { type: 'word-time', id: first.id, wordId: first.words[0].id, startTime: .5, endTime: 1.3 })).toThrow('inside their caption')
  })
  it('undoes/redoes corrections and keeps a retried transcript until explicit replacement', () => {
    const { draft } = fixture()
    const start: CaptionReviewHistory = { past: [], present: draft, future: [] }
    const changed = commitCaptionReview(start, editCaptionReview(draft, { type: 'delete', id: draft.review!.segments[0].id }))
    expect(travelCaptionReview(changed, 'undo').present).toEqual(draft)
    expect(travelCaptionReview(travelCaptionReview(changed, 'undo'), 'redo')).toEqual(changed)
    const newCandidate = { ...draft, id: 'retry' }
    expect(changed.present.id).toBe('transcript')
    const replaced = commitCaptionReview(changed, newCandidate)
    expect(replaced.present.id).toBe('retry')
    expect(travelCaptionReview(replaced, 'undo').present).toEqual(changed.present)
  })
  it('imports into the existing subtitle track with styles, undo/redo, and save/reopen', () => {
    const { state, draft } = fixture(), first = draft.review!.segments[0]
    const styled = editCaptionReview(editCaptionReview(draft, { type: 'preset', preset: 'Bold' }), { type: 'emphasis', id: first.id, wordIds: [first.words[0].id], style: { fontFamily: 'Georgia, serif', fontStyle: 'italic', backgroundColor: '#333333' } })
    const history = new CommandHistory(state)
    const imported = history.execute(new ImportAutoCaptionsCommand(styled))
    expect(imported.tracks).toHaveLength(state.tracks.length)
    const item = imported.items[first.id]
    expect(item.trackId).toBe('c1')
    expect(item.caption?.preset).toBe('Bold')
    expect(item.caption?.words?.[0]).toMatchObject({ fontStyle: 'italic', fontFamily: 'Georgia, serif', backgroundColor: '#333333' })
    expect(history.undo()).toEqual(state)
    expect(history.redo()).toEqual(imported)
    expect(deserializeProject(serializeProject(imported)).state.captionTranscripts).toEqual(imported.captionTranscripts)
    expect(deserializeProject(serializeProject(imported)).state.items[first.id]).toEqual(item)
    const corrupt = JSON.parse(serializeProject(imported)); corrupt.project.captionTranscripts.transcript.review.segments[0].endTime = 20
    expect(validateProjectFile(corrupt).isValid).toBe(false)
  })
  it('previews exactly the imported caption timing and active words on project playback', () => {
    const { state, draft } = fixture()
    const preview = captionPreviewItems(draft)
    const imported = new ImportAutoCaptionsCommand(draft).execute(state)
    for (const time of [0, 1, 1.3, 1.799, 2.1, 4, 7, 8.1]) {
      const visible = preview.filter(item => time >= item.startTime && time < item.startTime + item.duration)
      const playing = getPlaybackFrameInfo(imported, time).activeVideos.filter(clip => clip.item.caption).map(clip => clip.item)
      expect(visible.map(item => item.caption)).toEqual(playing.map(item => item.caption))
    }
    const words = preview[0].caption!.words!
    expect(activeCaptionWord(words, 1.3)).toBe(1)
    expect(activeCaptionWord(words, 2.1)).toBe(-1)
    expect(activeCaptionWord(words, 4)).toBe(-1)
    expect(captionPlaybackTolerance(true, 2) / 2).toBeCloseTo(.06)
  })
  it('does not hide imported captions behind overlapping existing captions', () => {
    const { state, draft } = fixture()
    state.items.old = { ...captionPreviewItems(draft)[0], id: 'old', trackId: 'c1' }
    expect(() => new ImportAutoCaptionsCommand(draft).execute(state)).toThrow('already on the subtitle track')
  })
  it('targets 2–4 words and keeps connected phrases and pauses together', () => {
    const words = ['one', 'two', 'three', 'four', 'five'].map((text, i) => ({ text, startTime: i * .3, endTime: i * .3 + .25 }))
    expect(captionWordGroups(words).map(group => group.length)).toEqual([3, 2])
    words[3].text = 'the'
    const groups = captionWordGroups(words)
    expect(groups.some(group => group.includes(3) && group.includes(4))).toBe(true)
    words[4] = { ...words[4], startTime: 4, endTime: 4.3 }
    expect(captionWordGroups(words).at(-1)).toEqual([4])
  })
})
