import { describe, expect, it } from 'vitest'
import { suggestEnglishCorrections } from './englishCorrections'
import type { TranscriptResult } from '../types'
function run(model: 'shruti' | 'whistle', tokens: string[]): TranscriptResult {
  return { model, source: { audioSha256: 'same' }, words: tokens.map((text, i) => ({ text, startTime: i, endTime: i + .8 })) } as TranscriptResult
}
describe('Conservative English hypothesis matching', () => {
  it.each([['keeche', 'keychain'], ['younga', 'younger']])('suggests %s using aligned English evidence', (original, proposed) => {
    const primary = run('shruti', [original]), alternative = run('whistle', [proposed])
    const before = structuredClone(primary)
    expect(suggestEnglishCorrections(primary, alternative, [proposed])[0]).toMatchObject({ original, proposed, startTime: 0, endTime: .8 })
    expect(primary).toEqual(before)
  })
  it('aligns a keyword phrase as a span without inventing timings', () => {
    const primary = run('shruti', ['champion', 'sedition']), alternative = run('whistle', ['Champions', 'Edition'])
    expect(suggestEnglishCorrections(primary, alternative, ['Champions Edition'])).toContainEqual({ original: 'champion sedition', proposed: 'Champions Edition', startTime: 0, endTime: 1.8, sourceIndices: [0, 1], alternativeIndices: [0, 1] })
  })
  it('declines Hindi, unrelated English, missing times, and changed audio', () => {
    const secondary = run('whistle', ['keychain'])
    expect(suggestEnglishCorrections(run('shruti', ['कितना']), secondary)).toEqual([])
    expect(suggestEnglishCorrections(run('shruti', ['hai']), secondary)).toEqual([])
    expect(suggestEnglishCorrections(run('shruti', ['potato']), secondary)).toEqual([])
    const primary = run('shruti', ['keeche']); primary.words![0].endTime = null
    expect(suggestEnglishCorrections(primary, secondary)).toEqual([])
    expect(suggestEnglishCorrections(run('shruti', ['keeche']), { ...secondary, source: { ...secondary.source, audioSha256: 'different' } })).toEqual([])
  })
  it('declines time-mismatched and ambiguous hypotheses', () => {
    const other = run('whistle', ['keychain']); other.words![0].startTime = 5; other.words![0].endTime = 6
    expect(suggestEnglishCorrections(run('shruti', ['keeche']), other)).toEqual([])
    const ambiguous = run('whistle', ['keychain', 'keychains']); ambiguous.words![1].startTime = 0; ambiguous.words![1].endTime = .8
    expect(suggestEnglishCorrections(run('shruti', ['keeche']), ambiguous, ['keychain', 'keychains'])).toEqual([])
  })
  it('leaves untimed/point words alone without disabling unrelated reliable matches', () => {
    const primary = run('shruti', ['untimed', 'keeche']), alternative = run('whistle', ['unknown', 'keychain'])
    primary.words![0].startTime = null; primary.words![0].endTime = null
    alternative.words![0].endTime = 0
    expect(suggestEnglishCorrections(primary, alternative)[0]).toMatchObject({ original: 'keeche', proposed: 'keychain', sourceIndices: [1], startTime: 1, endTime: 1.8 })
  })
})
