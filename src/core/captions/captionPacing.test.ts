import { describe, expect, it } from 'vitest'
import { captionWordGroups, captionWordTarget, reviewedCaptionCues } from './transcriptReview'
import { initializeCaptionReview, regroupCaptionReview, editCaptionReview, commitCaptionReview, travelCaptionReview } from './reviewEditing'
import type { CaptionPacing, CaptionTranscript, WordsPerCaption } from './types'
import { isCaptionTranscript } from './types'

const words = ['Guarantee', 'delivery', 'football', 'collection', 'special', 'edition', 'original', 'product'].map((text, i) => ({ text, startTime: i * .4, endTime: i * .4 + .3 }))
const pacing = (wordsPerCaption: WordsPerCaption, aspectRatio = 9 / 16): CaptionPacing => ({ wordsPerCaption, aspectRatio })
function draft(): CaptionTranscript {
  return initializeCaptionReview({ id: 'pacing', nativeText: words.map(w => w.text).join(' '), nativeWords: words, language: 'hi', audioSha256: 'hash', audioPlan: { projectId: 'project', clips: [], duration: 10 }, outputFormat: 'hinglish', nativeEdits: {}, romanEdits: {} })
}
describe('Caption presentation pacing', () => {
  it('defaults vertical projects to two words while retaining landscape grouping', () => {
    expect(captionWordGroups(words, pacing('auto')).map(g => g.length)).toEqual([2, 2, 2, 2])
    expect(captionWordGroups(words, pacing('auto', 16 / 9))).toEqual(captionWordGroups(words))
    expect(captionWordTarget(pacing('auto', 1))).toBe(3)
  })
  it.each([1, 2, 3, 4, 5] as const)('manual %i overrides the aspect-ratio default', count => {
    expect(captionWordTarget(pacing(count))).toBe(count)
    expect(captionWordGroups(words, pacing(count))).toEqual(captionWordGroups(words, pacing(count, 16 / 9)))
  })
  it('keeps short phrases together and allows readable short triples in portrait Auto', () => {
    const phrase = ['if', 'it', 'happens', 'and', 'then', 'continue'].map((text, i) => ({ text, startTime: i * .4, endTime: i * .4 + .3 }))
    const groups = captionWordGroups(phrase, pacing(1))
    expect(groups.some(group => group.includes(0) && group.includes(1))).toBe(true)
    expect(groups.some(group => group.includes(3) && group.includes(4))).toBe(true)
    const short = ['it', 'is', 'a', 'wonderful', 'product'].map((text, i) => ({ text, startTime: i * .4, endTime: i * .4 + .3 }))
    expect(captionWordGroups(short, pacing('auto'))[0]).toEqual([0, 1, 2])
    const connected = ['Coke', 'का', 'golden', 'can'].map((text, i) => ({ text, startTime: i * .4, endTime: i * .4 + .3 }))
    expect(captionWordGroups(connected, pacing('auto'))).toEqual([[0, 1], [2, 3]])
  })
  it('never bridges a speech pause to meet the selected count', () => {
    const paused = words.map((word, i) => ({ ...word, startTime: word.startTime + (i >= 3 ? 3 : 0), endTime: word.endTime + (i >= 3 ? 3 : 0) }))
    expect(captionWordGroups(paused, pacing(5)).some(group => group.includes(2) && group.includes(3))).toBe(false)
  })
  it('regroups edited review words without losing timestamps, corrections, emphasis or archive', () => {
    const original = draft(), first = original.review!.segments[0]
    let edited = editCaptionReview(original, { type: 'emphasis', id: first.id, wordIds: [first.words[0].id], style: { color: '#ff0000' } })
    edited = editCaptionReview(edited, { type: 'text', id: first.id, text: 'Guarantee corrected football collection' })
    const before = edited.review!.segments.flatMap(segment => segment.words)
    const next = regroupCaptionReview(edited, pacing(2))
    expect(next.review!.segments.flatMap(segment => segment.words)).toEqual(before)
    expect(next.nativeWords).toEqual(original.nativeWords)
    expect(next.nativeText).toBe(original.nativeText)
    expect(reviewedCaptionCues(next).map(cue => cue.text).join(' ')).toContain('corrected')
    expect(isCaptionTranscript(JSON.parse(JSON.stringify(next)))).toBe(true)
    const history = commitCaptionReview({ past: [], present: edited, future: [] }, next)
    expect(travelCaptionReview(history, 'undo').present).toEqual(edited)
    expect(travelCaptionReview(travelCaptionReview(history, 'undo'), 'redo').present).toEqual(next)
  })
  it('keeps deleted and manually inserted words when regrouping', () => {
    let edited = draft()
    edited = editCaptionReview(edited, { type: 'delete', id: edited.review!.segments[0].id })
    edited = editCaptionReview(edited, { type: 'insert', id: 'new-caption', time: 5 })
    const before = edited.review!.segments.flatMap(segment => segment.words)
    expect(regroupCaptionReview(edited, pacing('auto')).review!.segments.flatMap(segment => segment.words)).toEqual(before)
  })
})
