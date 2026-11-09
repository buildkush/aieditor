import { describe, expect, it, vi } from 'vitest'
import { compareTimedTranscripts, comparisonSrt, decideCorrection, experimentJson, experimentSrt, reviewedExperimentText, reviewSuggestions, runDualExperiment } from './dualExperiment'
import { suggestEnglishCorrections } from './englishCorrections'
import { parseSrt } from '../../core/subtitles/subtitleParser'
import type { TranscriptResult } from '../types'
function run(model: 'shruti' | 'whistle', text = model === 'shruti' ? 'keeche' : 'keychain', start = 1): TranscriptResult {
  return { id: `${model}-run`, model, text, source: { path: 'input.wav', audioPath: 'prepared.wav', audioSha256: 'same', duration: 10 }, words: [{ text, startTime: start, endTime: start + .8 }], rawResponse: { text }, segments: [] } as unknown as TranscriptResult
}
describe('Dual ASR comparison and review', () => {
  it('shows differences, agreements, missing and additional hypotheses without forcing alignment', () => {
    expect(compareTimedTranscripts(run('shruti'), run('whistle'))[0].kind).toBe('different')
    expect(compareTimedTranscripts(run('shruti', 'Coke'), run('whistle', 'Coke'))[0].kind).toBe('same')
    expect(compareTimedTranscripts(run('shruti'), run('whistle', 'keychain', 5)).map(row => row.kind)).toEqual(['primary-only', 'alternative-only'])
    expect(compareTimedTranscripts(run('shruti', 'मेरा'), run('whistle', 'mirror'))[0].kind).toBe('unreliable')
    const missing = run('shruti'); missing.words![0].startTime = null
    expect(compareTimedTranscripts(missing, run('whistle'))[0].kind).toBe('untimed')
  })
  it('rejects unrelated audio or unordered timestamp alignment', () => {
    const other = run('whistle'); other.source.audioSha256 = 'different'
    expect(() => compareTimedTranscripts(run('shruti'), other)).toThrow('same prepared audio')
    const bad = run('shruti'); bad.words!.push({ text: 'late', startTime: .1, endTime: .8 })
    expect(() => compareTimedTranscripts(bad, run('whistle'))).toThrow('Unordered')
  })
  it('edits, accepts, and rejects individual suggestions while keeping originals and times', () => {
    const primary = run('shruti'), alternative = run('whistle'), before = structuredClone(primary)
    let review = reviewSuggestions(primary, alternative, suggestEnglishCorrections(primary, alternative))
    expect(reviewedExperimentText(primary, review)).toBe('keeche')
    review = decideCorrection(review, 0, 'accepted', 'Keychain')
    expect(reviewedExperimentText(primary, review)).toBe('Keychain')
    expect(primary).toEqual(before)
    expect(review.decisions[0].suggestion).toMatchObject({ startTime: 1, endTime: 1.8 })
    review = decideCorrection(review, 0, 'rejected')
    expect(reviewedExperimentText(primary, review)).toBe('keeche')
    expect(() => decideCorrection(review, 0, 'accepted', '')).toThrow('empty')
  })
  it('preserves punctuation and surrounding Hindi when exporting accepted changes', () => {
    const primary = run('shruti'); primary.text = 'मेरा keeche, है।'; primary.words = [{ text: 'मेरा', startTime: 0, endTime: .5 }, ...primary.words!, { text: 'है', startTime: 4, endTime: 4.4 }]
    const alternative = run('whistle')
    const review = decideCorrection(reviewSuggestions(primary, alternative, suggestEnglishCorrections(primary, alternative)), 0, 'accepted', 'keychain')
    expect(reviewedExperimentText(primary, review)).toBe('मेरा keychain, है।')
    const cues = parseSrt(experimentSrt(primary, review))
    expect(cues.map(c => c.text)).toEqual(['मेरा', 'keychain,', 'है।'])
    expect(cues.map(c => [c.startTime, c.endTime])).toEqual([[0, .5], [1, 1.8], [4, 4.4]])
    const json = JSON.parse(experimentJson(primary, alternative, review))
    expect(json.primary.text).toBe('मेरा keeche, है।')
    expect(json.reviewedText).toBe('मेरा keychain, है।')
    expect(json.primary.words).toEqual(primary.words)
  })
  it('exports phrase corrections as one original timed span, without inventing new word times', () => {
    const primary = run('shruti', 'champion'); primary.text = 'champion sedition'; primary.words!.push({ text: 'sedition', startTime: 2, endTime: 2.6 })
    const alternative = run('whistle', 'Champions'); alternative.text = 'Champions Edition'; alternative.words!.push({ text: 'Edition', startTime: 2, endTime: 2.6 })
    const review = decideCorrection(reviewSuggestions(primary, alternative, suggestEnglishCorrections(primary, alternative, ['Champions Edition'])), 0, 'accepted')
    expect(parseSrt(experimentSrt(primary, review))).toMatchObject([{ text: 'Champions Edition', startTime: 1, endTime: 2.6 }])
    expect(parseSrt(comparisonSrt(primary, alternative))[0].text).toContain('Shruti: champion')
  })
  it('declines SRT with missing or point times and unsafe review associations', () => {
    const primary = run('shruti'), alternative = run('whistle')
    const review = reviewSuggestions(primary, alternative, suggestEnglishCorrections(primary, alternative))
    expect(() => reviewedExperimentText({ ...primary, id: 'other' }, review)).toThrow('another run')
    primary.words![0].endTime = 1
    expect(() => experimentSrt(primary)).toThrow('real word intervals')
    expect(() => comparisonSrt(primary, alternative)).toThrow('real timed intervals')
  })
  it('retains point-aligned words in SRT using adjacent real boundaries, without altering word times', () => {
    const primary = run('shruti', 'my'); primary.text = 'my keychain'; primary.words![0].endTime = 1
    primary.words!.push({ text: 'keychain', startTime: 1, endTime: 1.8 })
    expect(parseSrt(experimentSrt(primary))).toMatchObject([{ text: 'my keychain', startTime: 1, endTime: 1.8 }])
    expect(primary.words![0].endTime).toBe(1)
  })
  it('preserves punctuation embedded in native word objects when accepting a correction', () => {
    const primary = run('shruti', 'keeche,'), alternative = run('whistle')
    const review = decideCorrection(reviewSuggestions(primary, alternative, suggestEnglishCorrections(primary, alternative)), 0, 'accepted')
    expect(reviewedExperimentText(primary, review)).toBe('keychain,')
    expect(parseSrt(experimentSrt(primary, review))[0].text).toBe('keychain,')
    expect(primary.text).toBe('keeche,')
  })
})
describe('Sequential experiment orchestration', () => {
  it('uses the same prepared source and distinct configurations, recording each result separately', async () => {
    const source = run('shruti').source, results: TranscriptResult[] = []
    const recognize = vi.fn(async (_path, options) => { expect(results.length).toBe(options.model === 'shruti' ? 0 : 1); return run(options.model) })
    const runs = await runDualExperiment(source, ['M&M\'s', 'Kinder Joy'], new AbortController().signal, recognize, result => results.push(result), () => {})
    expect(runs.map(r => r.model)).toEqual(['shruti', 'whistle'])
    expect(recognize.mock.calls.map(c => c[1].language)).toEqual(['auto', 'en'])
    expect(recognize.mock.calls[1][1].keywords).toEqual(["M&M's", 'Kinder Joy'])
  })
  it('cancels before the next engine and retains completed results on failure', async () => {
    const source = run('shruti').source, controller = new AbortController(), complete: TranscriptResult[] = []
    const recognize = vi.fn(async () => run('shruti'))
    await expect(runDualExperiment(source, [], controller.signal, recognize, result => { complete.push(result); controller.abort() }, () => {})).rejects.toMatchObject({ name: 'AbortError' })
    expect(recognize).toHaveBeenCalledOnce(); expect(complete).toHaveLength(1)
    const error = vi.fn().mockResolvedValueOnce(run('shruti')).mockRejectedValueOnce(new Error('Whistle failed'))
    await expect(runDualExperiment(source, [], new AbortController().signal, error, () => {}, () => {})).rejects.toThrow('Whistle failed')
    const changed = run('whistle'); changed.source.audioPath = 'changed.wav'
    await expect(runDualExperiment(source, [], new AbortController().signal, vi.fn().mockResolvedValue(changed), () => {}, () => {})).rejects.toThrow('Prepared audio changed')
  })
})
