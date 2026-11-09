import { describe, expect, it } from 'vitest'
import { benchmarkExportSelection, benchmarkCsv, exportSubtitles, timestamp, transcriptJson, transcriptText, transcriptWords, wordErrorRate } from './evaluation'
import { romanHindi } from './romanHindi'
import type { TranscriptResult } from '../types'

const result = { id: 'run', model: 'small', language: 'hi', languageProbability: .9,
  source: { name: 'sample.wav', audioSha256: 'same-audio' }, processingMetadata: { model: 'small', processingSec: 2 },
  segments: [{ id: 0, text: ' नमस्ते world.', startTime: .123, endTime: 1.9999,
    words: [{ text: ' नमस्ते', startTime: .123, endTime: .8, confidence: .9 }, { text: ' world.', startTime: .9, endTime: 1.9999, confidence: .8 }] }],
} as TranscriptResult

describe('Speech Lab evaluation and export', () => {
  it('counts substitutions, insertions and deletions without capping WER at 100%', () => {
    expect(wordErrorRate('Hello world!', 'hello WORLD')).toMatchObject({ rate: 0 })
    expect(wordErrorRate('a b c', 'a x c d')).toMatchObject({ substitutions: 1, deletions: 0, insertions: 1, rate: 2 / 3 })
    expect(wordErrorRate('a b c', 'a c')).toMatchObject({ deletions: 1 })
    expect(wordErrorRate('a', 'b c d')?.rate).toBe(3)
    expect(wordErrorRate('  ', 'hello')).toBeNull()
  })
  it('keeps Devanagari word characters and treats a script mismatch as recognition differences', () => {
    expect(wordErrorRate('नमस्ते दुनिया।', 'नमस्ते दुनिया')?.rate).toBe(0)
    expect(wordErrorRate('नमस्ते', 'namaste')?.rate).toBe(1)
  })
  it('exports rounded SRT/VTT times, original word timing and separate editable text', () => {
    expect(timestamp(1.9999)).toBe('00:00:02,000')
    expect(timestamp(3600.001, true)).toBe('01:00:00.001')
    const edits = { 0: 'नमस्ते, world!' }
    expect(exportSubtitles(result, edits, 'srt')).toContain('00:00:00,123 --> 00:00:02,000\nनमस्ते, world!')
    expect(exportSubtitles(result, edits, 'vtt')).toMatch(/^WEBVTT\n\n1\n00:00:00.123/)
    expect(result.segments[0].text).toBe(' नमस्ते world.')
    expect(result.segments[0].words[0].startTime).toBe(.123)
    expect(transcriptText(result, edits)).toBe('नमस्ते, world!')
  })
  it('quotes benchmark CSV and retains audio identity for fair comparisons', () => {
    const csv = benchmarkCsv([{ ...result, processingMetadata: { ...result.processingMetadata, runtimeVersions: { python: '3.13' } } }], 'नमस्ते world')
    expect(csv).toContain('"audioSha256"')
    expect(csv).toContain('"same-audio"')
    expect(csv).toContain('" नमस्ते world."')
    expect(csv).toContain('""python"":""3.13""')
    expect(csv).not.toContain('[object Object]')
  })
  it('transliterates Devanagari independently while preserving English verbatim', () => {
    expect(romanHindi('नमस्ते world, Video Editor 2.0!')).toBe('namaste world, Video Editor 2.0!')
    expect(romanHindi('हिंदी English')).toBe('hindi English')
    expect(romanHindi('यह test है')).toContain('test')
    expect(romanHindi('English ONLY, punctuation!')).toBe('English ONLY, punctuation!')
  })
  it('exports Shruti native response verbatim and refuses invented subtitle segments', () => {
    const native = { text: '  मेरा order\nकब आएगा?  ', language: 'hi', words: [{ word: 'order', start: .2, end: .7, probability: .8 }] }
    const shruti: TranscriptResult = { ...result, id: 'shruti', model: 'shruti', text: native.text, rawResponse: native, segments: [],
      words: [{ text: 'order', startTime: .2, endTime: .7, confidence: .8 }] }
    expect(transcriptText(shruti, { 0: 'Never rewrite this' })).toBe(native.text)
    expect(transcriptWords(shruti)).toEqual(shruti.words)
    const json = JSON.parse(transcriptJson(shruti, { 0: 'rewritten' }, 'romanized'))
    expect(json.original.rawResponse).toEqual(native)
    expect(json.original.text).toBe(native.text)
    expect(json.romanHindiExperiment).toBe('romanized')
    expect(JSON.parse(transcriptJson(shruti)).romanHindiExperiment).toBeNull()
    expect(json.corrections).toEqual({})
    expect(json.correctedSegments).toEqual([])
    expect(() => exportSubtitles(shruti, {}, 'srt')).toThrow('segment boundaries')
    expect(benchmarkCsv([result, shruti], '')).toContain(native.text)
    expect(JSON.parse(transcriptJson(result, { 0: 'edited' }, 'namaste')).romanHindiExperiment).toBe('namaste')
  })
  it.each(['tara', 'tara-int8'] as const)('exports %s native text and chunk evidence without inventing subtitle boundaries', (model) => {
    const tara: TranscriptResult = { ...result, model, segments: [], words: [], text: 'Harry Potter का key chain',
      rawResponse: { inputChunks: [{ inputStartSec: 0, inputEndSec: 27, text: 'Harry Potter का key chain' }] } }
    expect(transcriptText(tara)).toBe(tara.text)
    expect(transcriptWords(tara)).toEqual([])
    expect(JSON.parse(transcriptJson(tara)).original.rawResponse).toEqual(tara.rawResponse)
    expect(benchmarkCsv([tara], '')).toContain(tara.text)
    expect(() => exportSubtitles(tara, {}, 'srt')).toThrow('segment boundaries')
  })
})


describe('Latest comparison export', () => {
  const native = (id: string, model: TranscriptResult['model'], text: string): TranscriptResult => ({ ...result, id, model, text, segments: [], processingMetadata: { ...result.processingMetadata, model, processingSec: id.startsWith('new') ? 17 : 999 } })
  const old = [native('old-shruti', 'shruti', 'old transcript'), native('old-srota', 'srota', 'old legacy model')]
  const latest = [native('new-shruti', 'shruti', 'new first'), native('new-native', 'srota-cpu', 'new second'), native('new-int8', 'shunya-int8', 'new third')]
  it('exports exactly the latest three-model batch in execution order with fresh metrics and text', () => {
    const selected = benchmarkExportSelection([...old, ...latest], latest.map(r => r.id))
    expect(selected.map(r => r.id)).toEqual(latest.map(r => r.id))
    const csv = benchmarkCsv(selected, '')
    for (const run of latest) { expect(csv).toContain(run.id); expect(csv).toContain(run.text) }
    expect(csv).not.toContain('old transcript'); expect(csv).not.toContain('old-srota'); expect(csv).not.toContain('999')
  })
  it('does not fill a cancelled batch with stale results for missing models', () => {
    expect(benchmarkExportSelection([...old, ...latest.slice(0, 1)], ['new-shruti'])).toEqual([latest[0]])
  })
  it('uses the newest available selected models when an older session has no batch metadata', () => {
    expect(benchmarkExportSelection([...old, ...latest], [], ['shruti', 'srota-cpu', 'shunya-int8'])).toEqual(latest)
  })
  it('keeps the finished batch even if model controls change before exporting', () => {
    expect(benchmarkExportSelection([...old, ...latest], latest.map(r => r.id), ['small'])).toEqual(latest)
  })
})


it('retains both Tara chunking variants in benchmark fallback selection', () => {
  const standard: TranscriptResult={...result,id:'standard',model:'tara-int8',processingMetadata:{...result.processingMetadata,chunkingStrategy:'standard'}}
  const aware: TranscriptResult={...standard,id:'aware',processingMetadata:{...standard.processingMetadata,chunkingStrategy:'speech-aware-overlap-v1'}}
  expect(benchmarkExportSelection([standard,aware],[],['tara-int8']).map(r=>r.id)).toEqual(['standard','aware'])
})
