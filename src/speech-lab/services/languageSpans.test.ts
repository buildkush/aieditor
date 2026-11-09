import { describe, expect, it, vi } from 'vitest'
import { segmentLanguageSpans, reconcileLanguageSpans, type SpanExperiment, type SpanRecognition } from './languageSpans'
import { runLanguageSpanExperiment } from './spanExperiment'
import { decideCorrection, reviewedExperimentText } from './dualExperiment'
import type { TranscriptResult } from '../types'
function primary(tokens = ['Bhai', 'Harry', 'Potter', 'ko', 'pachees', 'saal', 'ho', 'gaye']): TranscriptResult {
  return { id: 'shruti', model: 'shruti', text: tokens.join(' '), words: tokens.map((text, i) => ({ text, startTime: i * .4, endTime: i * .4 + .35, confidence: .7 })),
    source: { path: 'input', audioPath: 'cached.wav', audioSha256: 'same', duration: 20 }, processingMetadata: { model: 'shruti', processingSec: 1, modelLoadSec: .2, inferenceSec: .8, peakRamBytes: 1000000, device: 'cpu', languageHint: 'auto' } } as TranscriptResult
}
function experiment(p = primary()): SpanExperiment {
  const spans = segmentLanguageSpans(p)
  const target = spans.find(s => s.language === 'english')!
  return { primaryId: p.id, spans, vocabulary: [], recognition: { id: 'whistle-span-run', source: p.source, contextSec: .12,
    hypotheses: [{ spanId: target.id, cropStart: target.startTime! - .12, cropEnd: target.endTime! + .12, text: 'Harry Potter', words: p.words!.slice(1, 3).map(w => ({ ...w, confidence: .95 })), rawResponse: { native: true }, inferenceSec: .1 }], processingMetadata: { ...p.processingMetadata, model: 'whistle', languageHint: 'en' } } as SpanRecognition }
}
describe('Language-span segmentation and reconciliation', () => {
  it('segments the requested sentence into Hindi / complete English name / Hindi', () => {
    const p = primary(), before = structuredClone(p)
    const spans = segmentLanguageSpans(p)
    expect(spans.map(s => [s.language, s.text])).toEqual([['hindi', 'Bhai'], ['english', 'Harry Potter'], ['hindi', 'ko pachees saal ho gaye']])
    expect(spans[1]).toMatchObject({ sourceIndices: [1, 2], startTime: .4, endTime: 1.15, confidence: .7 })
    expect(p).toEqual(before)
  })
  it('recognizes explicit Devanagari English names and retains unknown/mixed words', () => {
    const spans = segmentLanguageSpans(primary(['भाई', 'हैरी', 'पॉटर', 'को', 'blorple', 'helloहै']))
    expect(spans.map(s => s.language)).toEqual(['hindi', 'english', 'hindi', 'uncertain', 'mixed'])
    expect(spans[1].canonical).toBe('Harry Potter')
    const custom = segmentLanguageSpans(primary(['भाई', 'कस्टम', 'नाम', 'है']), ['Custom Name | कस्टम नाम'])
    expect(custom[1]).toMatchObject({ language: 'english', text: 'कस्टम नाम', canonical: 'Custom Name' })
    const protectedWords = segmentLanguageSpans(primary(['Bhai', 'Harry', 'Potter', 'ko']), ['Brother | Bhai', 'Harry Potter | Harry Potter ko'])
    expect(protectedWords.map(span => span.language)).toEqual(['hindi', 'english', 'hindi'])
  })
  it('preserves full English phrases and classifies close known name spellings without absorbing Hindi', () => {
    expect(segmentLanguageSpans(primary(['Bhai', 'Harry', 'Poter', 'ka', 'wand', 'pen', 'hai'])).map(s => [s.language, s.text])).toEqual([
      ['hindi', 'Bhai'], ['english', 'Harry Poter'], ['hindi', 'ka'], ['english', 'wand pen'], ['hindi', 'hai'],
    ])
    expect(segmentLanguageSpans(primary(['Kinder', 'Joy', 'ka', 'Champions', 'Edition']))[0].text).toBe('Kinder Joy')
  })
  it('keeps agreement unchanged and proposes only complete better English phrases', () => {
    const p = primary(), e = experiment(p)
    expect(reconcileLanguageSpans(p, e).map(r => r.status)).toEqual(['retained', 'agreement', 'retained'])
    const typo = primary(['Bhai', 'Harry', 'Poter', 'ko', 'pachees', 'saal', 'ho', 'gaye'])
    const changed = experiment(typo)
    changed.recognition!.hypotheses[0].words[1].text = 'Potter'
    const suggestion = reconcileLanguageSpans(typo, changed)[1].suggestion!
    expect(suggestion).toMatchObject({ original: 'Harry Poter', proposed: 'Harry Potter', sourceIndices: [1, 2], startTime: .4, endTime: 1.15 })
    const review = decideCorrection({ primaryId: typo.id, alternativeId: changed.recognition!.id, decisions: [{ suggestion, replacement: suggestion.proposed, status: 'pending' }] }, 0, 'accepted')
    expect(reviewedExperimentText(typo, review)).toBe('Bhai Harry Potter ko pachees saal ho gaye')
    expect(typo.text).toBe('Bhai Harry Poter ko pachees saal ho gaye')
  })
  it('does not let context or crossing word times rewrite adjacent Hindi', () => {
    const p = primary(), e = experiment(p), h = e.recognition!.hypotheses[0]
    h.words.unshift({ text: 'Bhai', startTime: 0, endTime: .35 })
    h.words.push({ text: 'ko', startTime: 1.2, endTime: 1.55 })
    h.text = 'Bhai Harry Potter ko'
    expect(reconcileLanguageSpans(p, e)[1].alternative).toBe('Harry Potter')
    h.words[1].startTime = .3
    expect(reconcileLanguageSpans(p, e)[1].status).toBe('uncertain')
  })
  it('allows boundary drift only inside the gap and declines raw words without timestamps', () => {
    const p = primary(), e = experiment(p), h = e.recognition!.hypotheses[0]
    h.words[0].startTime = .36
    expect(reconcileLanguageSpans(p, e)[1].status).toBe('agreement')
    h.words[0].startTime = .34
    expect(reconcileLanguageSpans(p, e)[1].status).toBe('uncertain')
    h.words[0].startTime = .4
    h.text = 'Harry extra Potter'
    expect(reconcileLanguageSpans(p, e)[1].status).toBe('uncertain')
  })
  it('declines weak confidence, missing times, poor coverage and changed audio', () => {
    const p = primary(), e = experiment(p), h = e.recognition!.hypotheses[0]
    h.words = [{ text: 'unrelated', startTime: .5, endTime: .7, confidence: .1 }]
    expect(reconcileLanguageSpans(p, e)[1].status).toBe('uncertain')
    h.words[0].startTime = null
    expect(reconcileLanguageSpans(p, e)[1].status).toBe('uncertain')
    e.recognition!.source = { ...p.source, audioSha256: 'changed' }
    expect(() => reconcileLanguageSpans(p, e)).toThrow('different audio')
  })
})
describe('English-only crop orchestration', () => {
  it('runs full Shruti first, sends only English intervals and keeps partial results', async () => {
    const p = primary(), onPrimary = vi.fn(), onExperiment = vi.fn(), recognition = experiment(p).recognition!
    const recognize = vi.fn().mockResolvedValue(p), crops = vi.fn().mockResolvedValue(recognition)
    const result = await runLanguageSpanExperiment(p.source, ['Kinder Joy'], ['Harry Potter'], .12, new AbortController().signal, recognize, crops, onPrimary, onExperiment, () => {})
    expect(recognize.mock.calls[0][1]).toMatchObject({ model: 'shruti', language: 'auto' })
    expect(crops.mock.calls[0][1].map((s: { text: string }) => s.text)).toEqual(['Harry Potter'])
    expect(onPrimary).toHaveBeenCalledWith(p)
    expect(onExperiment).toHaveBeenCalledTimes(2)
    expect(result.primary).toBe(p)
  })
  it('skips Whistle for Hindi and uncertain spans and stops on cancellation', async () => {
    const p = primary(['Bhai', 'ko', 'blorple']), crops = vi.fn(), abort = new AbortController()
    await runLanguageSpanExperiment(p.source, [], [], .1, abort.signal, vi.fn().mockResolvedValue(p), crops, () => {}, () => {}, () => {})
    expect(crops).not.toHaveBeenCalled()
    await expect(runLanguageSpanExperiment(primary().source, [], [], .1, abort.signal, vi.fn().mockResolvedValue(primary()), crops, () => abort.abort(), () => {}, () => {})).rejects.toMatchObject({ name: 'AbortError' })
    expect(crops).not.toHaveBeenCalled()
  })
  it('retains full Shruti output and span analysis if crop inference fails', async () => {
    const p = primary(), onPrimary = vi.fn(), onExperiment = vi.fn()
    await expect(runLanguageSpanExperiment(p.source, [], [], .1, new AbortController().signal, vi.fn().mockResolvedValue(p), vi.fn().mockRejectedValue(new Error('Whistle failed')), onPrimary, onExperiment, () => {})).rejects.toThrow('Whistle failed')
    expect(onPrimary).toHaveBeenCalledWith(p)
    expect(onExperiment.mock.calls[0][0].recognition).toBeNull()
  })
})
