import type { Corrections, TranscriptResult } from '../types'

/** Case/punctuation-normalized, whitespace-tokenized WER; no script conversion or translation. */
export function wordErrorRate(reference: string, hypothesis: string) {
  const tokens = (text: string) => text.normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{S}]/gu, ' ').trim().split(/\s+/u).filter(Boolean)
  const expected = tokens(reference), actual = tokens(hypothesis)
  if (!expected.length) return null
  let previous = Array.from({ length: actual.length + 1 }, (_, i) => ({ cost: i, substitutions: 0, deletions: 0, insertions: i }))
  for (let i = 1; i <= expected.length; i++) {
    const row = [{ cost: i, substitutions: 0, deletions: i, insertions: 0 }]
    for (let j = 1; j <= actual.length; j++) {
      const same = expected[i - 1] === actual[j - 1]
      const diagonal = previous[j - 1]
      const substitute = { ...diagonal, cost: diagonal.cost + (same ? 0 : 1), substitutions: diagonal.substitutions + (same ? 0 : 1) }
      const remove = { ...previous[j], cost: previous[j].cost + 1, deletions: previous[j].deletions + 1 }
      const insert = { ...row[j - 1], cost: row[j - 1].cost + 1, insertions: row[j - 1].insertions + 1 }
      row.push([substitute, remove, insert].reduce((best, next) => next.cost < best.cost ? next : best))
    }
    previous = row
  }
  const final = previous[actual.length]
  return { ...final, referenceWords: expected.length, hypothesisWords: actual.length, rate: final.cost / expected.length }
}

export const transcriptText = (result: TranscriptResult, _corrections: Corrections = {}) => result.text ?? result.segments.map(s => s.text).join(' ')
export const transcriptWords = (result: TranscriptResult) => result.words ?? result.segments.flatMap(s => s.words)
export function transcriptJson(result: TranscriptResult, _corrections: Corrections = {}, romanHindiExperiment: string | null = null) {
  return JSON.stringify({ schemaVersion: 2, original: result, wordTimingPolicy: 'Native words and estimated word intervals are preserved.', romanHindiExperiment }, null, 2)
}
export function timestamp(seconds: number, vtt = false) {
  const ms = Math.max(0, Math.round(seconds * 1000))
  return String(Math.floor(ms / 3600000)).padStart(2, '0') + ':' + String(Math.floor(ms / 60000) % 60).padStart(2, '0') + ':' + String(Math.floor(ms / 1000) % 60).padStart(2, '0') + (vtt ? '.' : ',') + String(ms % 1000).padStart(3, '0')
}
export function benchmarkRows(results: TranscriptResult[], reference: string) {
  return results.map(result => ({ id: result.id, source: result.source.name, audioSha256: result.source.audioSha256,
    ...result.processingMetadata, model: result.model, nativeText: transcriptText(result), nativeWords: transcriptWords(result), wer: wordErrorRate(reference, transcriptText(result)) }))
}
export function benchmarkCsv(results: TranscriptResult[], reference: string) {
  const rows = benchmarkRows(results, reference)
  if (!rows.length) return ''
  const keys = [...new Set(rows.flatMap(row => Object.keys(row)))] as (keyof typeof rows[number])[]
  const quote = (value: unknown) => '"' + (typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '')).replace(/"/g, '""') + '"'
  return [keys.map(quote).join(','), ...rows.map(row => keys.map(key => quote(row[key])).join(','))].join('\r\n')
}
