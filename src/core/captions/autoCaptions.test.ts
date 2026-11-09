import { describe, expect, it } from 'vitest'
import { createEmptyProjectState, type ProjectState } from '../project/projectState'
import { DEFAULT_TRANSFORM } from '../timeline/types'
import { projectAudioPlan } from './projectAudioPlan'
import { alignCaptionWords, captionWordGroups, reviewedCaptionCues, reviewedWord } from './transcriptReview'
import type { CaptionTranscript, NativeCaptionWord } from './types'
import { ImportAutoCaptionsCommand } from '../commands/importAutoCaptionsCommand'
import { ImportSubtitlesCommand } from '../commands/editorCommand'
import { CommandHistory } from '../commands/commandHistory'
import { deserializeProject, serializeProject, validateProjectFile } from '../persistence/projectSerializer'
import { getPlaybackFrameInfo } from '../playback/timelinePlayback'
import { initializeCaptionReview, editCaptionReview } from './reviewEditing'

function project(): ProjectState {
  const state = createEmptyProjectState({ id: 'unsaved-project', initialTracks: [{ id: 'a1', name: 'Audio 1', type: 'audio' }, { id: 'v1', name: 'Video 1', type: 'video' }] })
  return { ...state, assets: { asset: { id: 'asset', name: 'Source', path: 'C:/source.mp4', type: 'video' } },
    items: { sound: { id: 'sound', assetId: 'asset', trackId: 'a1', itemType: 'audio', startTime: 2, duration: 5, sourceIn: 3, sourceOut: 13, speed: { speed: 2, reversed: false }, transform: { ...DEFAULT_TRANSFORM }, audio: { volume: .8, pan: 0 } } } }
}
const nativeText = 'Guarantee देता हूँ, Coke का golden can है।'
const tokens = ['Guarantee', 'देता', 'हूँ', 'Coke', 'का', 'golden', 'can', 'है']
const words = tokens.map((text, i) => ({ text, startTime: 2 + i * .4, endTime: 2.25 + i * .4, confidence: .9 }))
function transcript(state = project()): CaptionTranscript {
  return { id: 'native-1', nativeText, nativeWords: alignCaptionWords(nativeText, words), rawResponse: { text: nativeText, words: tokens },
    language: 'hi', audioSha256: 'prepared-hash', audioPlan: projectAudioPlan(state), outputFormat: 'hinglish', nativeEdits: {}, romanEdits: {} }
}

describe('Project auto captions', () => {
  it('imports Tara review flags and engine metadata through commands without changing native times', () => {
    const state=project()
    const source=transcript(state)
    const nativeWords=source.nativeWords.map((w,i)=>({...w,...(i===0?{timingNeedsReview:true}:{})}))
    const draft=initializeCaptionReview({...source,engine:'tara',nativeWords})
    const segment=draft.review!.segments[0], word=segment.words[0]
    expect(word.timingNeedsReview).toBe(true)
    const edited=editCaptionReview(draft,{type:'word-time',id:segment.id,wordId:word.id,startTime:word.startTime,endTime:word.endTime})
    expect(edited.review!.segments[0].words[0].timingNeedsReview).toBeUndefined()
    expect(edited.nativeWords).toEqual(nativeWords)
    const history=new CommandHistory(state)
    const imported=history.execute(new ImportAutoCaptionsCommand(edited))
    const restored=deserializeProject(serializeProject(imported)).state
    expect(restored.captionTranscripts![draft.id].engine).toBe('tara')
    expect(restored.captionTranscripts![draft.id].nativeWords).toEqual(nativeWords)
    expect(history.undo()?.captionTranscripts).toBeUndefined()
    expect(state.captionTranscripts).toBeUndefined()
  })
  it('derives only audible timeline audio, retaining cuts, gaps, trim, speed and gain', () => {
    const state = project()
    state.items.video = { ...state.items.sound, id: 'video', trackId: 'v1', itemType: 'video' }
    state.items.silent = { ...state.items.sound, id: 'silent', audio: { volume: 0, pan: 0 } }
    state.tracks.push({ id: 'muted', name: 'Muted', type: 'audio', muted: true })
    state.items.muted = { ...state.items.sound, id: 'muted', trackId: 'muted' }
    const plan = projectAudioPlan(state)
    expect(plan.duration).toBe(7)
    expect(plan.clips).toHaveLength(1)
    expect(plan.clips[0]).toMatchObject({ startTime: 2, duration: 5, sourceIn: 3, sourceOut: 13, speed: 2, gain: [[0, .8], [5, .8]] })
  })
  it('reflects volume automation, gain effects, reverse and missing audio', () => {
    const state = project()
    state.items.sound = { ...state.items.sound, speed: { speed: 1, reversed: true }, keyframes: { volume: [{ id: 'a', time: 2, value: 0 }, { id: 'b', time: 7, value: 1 }] },
      effects: [{ id: 'g', effectId: 'gain', name: 'Gain', category: 'audio', enabled: true, params: { gain: 6 } }] }
    const clip = projectAudioPlan(state).clips[0]
    expect(clip.reversed).toBe(true)
    expect(clip.gain[0][1]).toBe(0)
    expect(clip.gain.at(-1)![1]).toBeCloseTo(Math.pow(10, 6 / 20))
    expect(() => projectAudioPlan({ ...state, assets: { asset: { ...state.assets.asset, isMissing: true } } })).toThrow('Relink')
  })
  it('preserves native punctuation, English case and exact real word times', () => {
    const aligned = alignCaptionWords(nativeText, words)
    expect(aligned[2].text).toBe('हूँ,')
    expect(aligned.at(-1)!.text).toBe('है।')
    expect(aligned.map(({ startTime, endTime }) => [startTime, endTime])).toEqual(words.map(({ startTime, endTime }) => [startTime, endTime]))
    expect(words[2].text).toBe('हूँ')
  })
  it('changes script repeatedly with no ASR operation or timing changes', () => {
    const draft = transcript()
    const hindi = reviewedCaptionCues({ ...draft, outputFormat: 'hindi' })
    const roman = reviewedCaptionCues(draft)
    expect(hindi.map(cue => cue.text).join(' ')).toBe(nativeText)
    expect(roman.map(cue => cue.text).join(' ')).toBe('Guarantee deta hoon, Coke ka golden can hai.')
    expect(roman.flatMap(cue => cue.words!.map(({ startTime, endTime }) => [startTime, endTime]))).toEqual(hindi.flatMap(cue => cue.words!.map(({ startTime, endTime }) => [startTime, endTime])))
    expect(reviewedCaptionCues({ ...draft, outputFormat: 'hindi' })).toEqual(hindi)
    expect(draft.nativeText).toBe(nativeText)
  })
  it('keeps independent manual review corrections and invalidates stale Roman edits', () => {
    const draft = transcript()
    draft.romanEdits[1] = { sourceText: draft.nativeWords[1].text, text: 'deta' }
    expect(reviewedWord(draft, 1, 'hinglish')).toBe('deta')
    draft.nativeEdits[1] = 'नहीं'
    expect(reviewedWord(draft, 1, 'hinglish')).toBe('nahi')
    expect(reviewedWord(draft, 1, 'hindi')).toBe('नहीं')
    expect(draft.nativeWords[1].text).toBe('देता')
  })
  it('refuses missing, reversed or unmatched word times instead of guessing', () => {
    expect(() => alignCaptionWords('hello extra', [{ text: 'hello', startTime: 0, endTime: 1 }])).toThrow('without word timestamps')
    expect(() => alignCaptionWords('hello', [{ text: 'hello', startTime: 1, endTime: .5 }])).toThrow('invalid word times')
    expect(() => alignCaptionWords('hello', [])).toThrow('no timed words')
    expect(() => alignCaptionWords('hello', [{ text: 'hello', startTime: null, endTime: 1 } as unknown as NativeCaptionWord])).toThrow('invalid word times')
    expect(() => alignCaptionWords('hello world', [{ text: 'hello', startTime: 2, endTime: 3 }, { text: 'world', startTime: 1, endTime: 2 }])).toThrow('unordered')
  })
  it('groups only at word boundaries and retains gaps', () => {
    expect(captionWordGroups([{ text: 'one', startTime: 0, endTime: .2 }, { text: 'two', startTime: 2, endTime: 2.3 }])).toEqual([[0], [1]])
  })
  it.each([.25, .4, .6, 2])('leaves a %s-second speech pause empty in timeline playback', pause => {
    const state = project()
    const nativeWords = [
      { text: 'hello', startTime: 2, endTime: 2.2 },
      { text: 'again', startTime: 2.2 + pause, endTime: 2.4 + pause },
    ]
    const draft = { ...transcript(state), nativeText: 'hello again', nativeWords }
    const next = new ImportAutoCaptionsCommand(draft).execute(state)
    const captionAt = (time: number) => getPlaybackFrameInfo(next, time).activeVideos.filter(clip => clip.item.caption)
    expect(captionAt(2.1)[0].item.caption!.text).toBe('hello')
    expect(captionAt(2.2 + pause / 2)).toEqual([])
    expect(captionAt(nativeWords[1].startTime)[0].item.caption!.text).toBe('again')
    expect(next.captionTranscripts![draft.id].nativeWords).toEqual(nativeWords)
  })
  it('does not merge isolated point words across silence or stretch them to the next utterance', () => {
    const draft = { ...transcript(), nativeWords: [
      { text: 'hello', startTime: 2, endTime: 2.2 },
      { text: 'Coke।', startTime: 3, endTime: 3 },
      { text: 'again', startTime: 5, endTime: 5.2 },
    ] }
    const cues = reviewedCaptionCues(draft)
    expect(cues).toHaveLength(3)
    expect(cues[1].startTime).toBe(3)
    expect(cues[1].endTime).toBeCloseTo(3.1)
    expect(cues[1].words![0]).toMatchObject({ startTime: 3, endTime: 3 })
    const next = new ImportAutoCaptionsCommand(draft).execute(project())
    expect(getPlaybackFrameInfo(next, 4).activeVideos).toEqual([])
  })
  it('imports sub-100ms captions exactly without padding into the next cue', () => {
    const state = project()
    const draft = { ...transcript(state), nativeWords: [
      { text: 'one.', startTime: 2, endTime: 2.02 },
      { text: 'two.', startTime: 2.05, endTime: 2.08 },
      { text: 'three', startTime: 3, endTime: 3.2 },
    ] }
    const next = new ImportAutoCaptionsCommand(draft).execute(state)
    const captions = Object.values(next.items).filter(item => item.caption)
    expect(captions[0].duration).toBeCloseTo(.02)
    expect(captions[0].sourceOut).toBeCloseTo(.02)
    expect(getPlaybackFrameInfo(next, 2.03).activeVideos).toEqual([])
    expect(getPlaybackFrameInfo(next, 2.06).activeVideos[0].item.caption!.text).toBe('two.')
  })
  it('prevents overlapping cue containers while retaining native overlapping word alignments', () => {
    const draft = { ...transcript(), nativeWords: [
      { text: 'one.', startTime: 2, endTime: 2.5 },
      { text: 'two.', startTime: 2.3, endTime: 2.6 },
      { text: 'three', startTime: 2.3, endTime: 2.8 },
    ] }
    const cues = reviewedCaptionCues(draft)
    expect(cues).toHaveLength(2)
    expect(cues[0].endTime).toBe(cues[1].startTime)
    expect(cues.flatMap(cue => cue.words!.map(word => [word.startTime, word.endTime]))).toEqual(draft.nativeWords.map(word => [word.startTime, word.endTime]))
  })
  it('retains native point-aligned words and merges point-only cue groups without made-up times', () => {
    const state = project()
    const nativeWords = [
      { text: 'Coke', startTime: 2, endTime: 2.25 },
      { text: 'है।', startTime: 2.25, endTime: 2.25 },
      { text: 'मेरा।', startTime: 2.3, endTime: 2.3 },
      { text: 'can', startTime: 2.3, endTime: 2.6 },
    ]
    const draft = { ...transcript(state), nativeText: 'Coke है। मेरा। can', nativeWords: alignCaptionWords('Coke है। मेरा। can', nativeWords) }
    const cues = reviewedCaptionCues(draft)
    expect(cues.every(cue => cue.duration > 0)).toBe(true)
    expect(cues.flatMap(cue => cue.words!.map(({ startTime, endTime }) => [startTime, endTime]))).toEqual(nativeWords.map(({ startTime, endTime }) => [startTime, endTime]))
    const next = new ImportAutoCaptionsCommand(draft).execute(state)
    const saved = deserializeProject(serializeProject(next)).state
    expect(saved.captionTranscripts![draft.id].nativeWords[1].endTime).toBe(2.25)
    expect(saved.captionTranscripts![draft.id].nativeWords[1].startTime).toBe(2.25)
    const noInterval = { ...draft, nativeWords: [{ text: 'Coke', startTime: 2, endTime: 2 }] }
    expect(() => reviewedCaptionCues(noInterval)).toThrow('single time point')
  })
  it.each([4, 6])('imports every word of a %i-minute mocked transcript including equal timestamps', minutes => {
    const state = project()
    state.items.sound = { ...state.items.sound, startTime: 0, duration: minutes * 60, sourceIn: 0, sourceOut: minutes * 60, speed: { speed: 1 } }
    const nativeWords = Array.from({ length: minutes * 120 }, (_, index) => ({ text: index % 2 ? 'है।' : 'Coke', startTime: index * .5, endTime: index * .5 + (index % 17 === 0 ? 0 : .3) }))
    const nativeText = nativeWords.map(word => word.text).join(' ')
    const draft = { ...transcript(state), nativeText, nativeWords: alignCaptionWords(nativeText, nativeWords) }
    const next = new ImportAutoCaptionsCommand(draft).execute(state)
    const imported = Object.values(next.items).filter(item => item.caption).flatMap(item => item.caption!.words!)
    expect(imported).toHaveLength(nativeWords.length)
    expect(imported.map(word => word.word)).toEqual(nativeWords.map(word => word.text === 'Coke' ? 'Coke' : 'hai.'))
    expect(imported.map(word => [word.startTime, word.endTime])).toEqual(nativeWords.map(word => [word.startTime, word.endTime]))
    expect(imported.at(-1)!.word).toBe('hai.')
    expect(next.captionTranscripts![draft.id].nativeText).toBe(nativeText)
  })
  it('imports normal editable Caption items and native metadata through one undoable command', () => {
    const original = project(), draft = transcript(original)
    const history = new CommandHistory(original)
    const command = new ImportAutoCaptionsCommand(draft)
    const next = history.execute(command)
    expect(original.tracks).toHaveLength(2)
    expect(Object.keys(original.items)).toEqual(['sound'])
    expect(original.captionTranscripts).toBeUndefined()
    expect(next.tracks[0]).toMatchObject({ type: 'caption', name: 'Auto Captions' })
    const captions = Object.values(next.items).filter(item => item.itemType === 'caption')
    expect(captions).toHaveLength(3)
    expect(captions[0].caption?.words?.[0]).toMatchObject({ word: 'Guarantee', startTime: 2, endTime: 2.25 })
    expect(next.captionTranscripts?.[draft.id].nativeText).toBe(nativeText)
    expect(history.undo()?.captionTranscripts).toBeUndefined()
    expect(history.redo()?.captionTranscripts?.[draft.id]).toEqual(draft)
    expect(command.execute(original)).toEqual(next)
  })
  it('saves/reopens native transcript, format, corrections and real timestamps', () => {
    const original = project(), draft = transcript(original)
    draft.outputFormat = 'hindi'
    const state = new ImportAutoCaptionsCommand(draft).execute(original)
    const saved = serializeProject(state)
    const loaded = deserializeProject(saved).state
    expect(loaded.captionTranscripts?.[draft.id]).toEqual(draft)
    expect(Object.values(loaded.items).find(item => item.caption)?.caption?.words).toEqual(Object.values(state.items).find(item => item.caption)?.caption?.words)
    const corrupt = JSON.parse(saved)
    corrupt.project.captionTranscripts[draft.id].nativeWords[0].endTime = -1
    expect(validateProjectFile(corrupt).isValid).toBe(false)
    corrupt.project.captionTranscripts[draft.id].nativeWords = [null]
    expect(validateProjectFile(corrupt).isValid).toBe(false)
  })
  it('guards import against changed audio and duplicate imports', () => {
    const original = project(), draft = transcript(original), command = new ImportAutoCaptionsCommand(draft)
    expect(() => command.execute({ ...original, items: { ...original.items, sound: { ...original.items.sound, startTime: 9 } } })).toThrow('audio changed')
    expect(() => command.execute({ ...original, id: 'other' })).toThrow('different project')
    expect(() => command.execute(command.execute(original))).toThrow('already been imported')
    const invalid = { ...draft, nativeWords: [{ text: 'late', startTime: 9, endTime: 10 }] }
    expect(() => new ImportAutoCaptionsCommand(invalid).execute(original)).toThrow('word timings')
  })
  it('leaves subtitle-file importing unchanged', () => {
    const original = project()
    const next = new ImportSubtitlesCommand('1\n00:00:01,000 --> 00:00:02,000\nExisting import\n').execute(original)
    expect(Object.values(next.items).some(item => item.caption?.text === 'Existing import')).toBe(true)
    expect(next.captionTranscripts).toBeUndefined()
    const short = new ImportSubtitlesCommand('1\n00:00:01,000 --> 00:00:01,020\nShort file cue\n').execute(original)
    expect(Object.values(short.items).find(item => item.caption)?.duration).toBe(.1)
  })
})
