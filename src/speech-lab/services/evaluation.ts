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

export const transcriptText = (result: TranscriptResult, corrections: Corrections = {}) => ((result.model === 'shruti' || result.model === 'shruti-needle-3210' || result.model === 'shruti-fp32') || result.model === 'whistle' || result.model === 'shunya' || result.model === 'srota' || result.model === 'srota-cpu' || result.model === 'shunya-int8' || (result.model === 'tara' || (result.model === 'tara-int8' || (result.model === 'tara-int8-speech-aware' || result.model === 'tara-int8-speech-aware-parallel')))) ? result.text ?? '' : result.segments.map(s => corrections[s.id] ?? s.text).join(' ').replace(/\s+/g, ' ').trim()
export const transcriptWords = (result: TranscriptResult) => ((result.model === 'shruti' || result.model === 'shruti-needle-3210' || result.model === 'shruti-fp32') || result.model === 'whistle' || result.model === 'shunya' || result.model === 'srota' || result.model === 'srota-cpu' || result.model === 'shunya-int8' || (result.model === 'tara' || (result.model === 'tara-int8' || (result.model === 'tara-int8-speech-aware' || result.model === 'tara-int8-speech-aware-parallel')))) ? result.words ?? [] : result.segments.flatMap(segment => segment.words)
export function transcriptJson(result: TranscriptResult, corrections: Corrections = {}, romanHindiExperiment: string | null = null) {
  return JSON.stringify({ schemaVersion: 1, original: result, corrections: ((result.model === 'shruti' || result.model === 'shruti-needle-3210' || result.model === 'shruti-fp32') || result.model === 'whistle' || result.model === 'shunya' || result.model === 'srota' || result.model === 'srota-cpu' || result.model === 'shunya-int8' || (result.model === 'tara' || (result.model === 'tara-int8' || (result.model === 'tara-int8-speech-aware' || result.model === 'tara-int8-speech-aware-parallel')))) ? {} : corrections,
    correctedSegments: ((result.model === 'shruti' || result.model === 'shruti-needle-3210' || result.model === 'shruti-fp32') || result.model === 'whistle' || result.model === 'shunya' || result.model === 'srota' || result.model === 'srota-cpu' || result.model === 'shunya-int8' || (result.model === 'tara' || (result.model === 'tara-int8' || (result.model === 'tara-int8-speech-aware' || result.model === 'tara-int8-speech-aware-parallel')))) ? [] : result.segments.map(segment => ({ id: segment.id, startTime: segment.startTime, endTime: segment.endTime, text: corrections[segment.id] ?? segment.text })),
    wordTimingPolicy: ((result.model === 'shruti' || result.model === 'shruti-needle-3210' || result.model === 'shruti-fp32') || result.model === 'whistle' || result.model === 'shunya' || result.model === 'srota' || result.model === 'srota-cpu' || result.model === 'shunya-int8' || (result.model === 'tara' || (result.model === 'tara-int8' || (result.model === 'tara-int8-speech-aware' || result.model === 'tara-int8-speech-aware-parallel')))) ? 'Native transcript and returned word times are preserved; no segment boundaries are synthesized.' : 'Original model words are preserved; segment corrections are not realigned.',
    romanHindiExperiment }, null, 2)
}
export function timestamp(seconds: number, vtt = false) {
  const milliseconds = Math.max(0, Math.round(seconds * 1000))
  return `${String(Math.floor(milliseconds / 3600000)).padStart(2, '0')}:${String(Math.floor(milliseconds / 60000) % 60).padStart(2, '0')}:${String(Math.floor(milliseconds / 1000) % 60).padStart(2, '0')}${vtt ? '.' : ','}${String(milliseconds % 1000).padStart(3, '0')}`
}
export function exportSubtitles(result: TranscriptResult, corrections: Corrections, format: 'srt' | 'vtt') {
  if (((result.model === 'shruti' || result.model === 'shruti-needle-3210' || result.model === 'shruti-fp32') || result.model === 'whistle' || result.model === 'shunya' || result.model === 'srota' || result.model === 'srota-cpu' || result.model === 'shunya-int8' || (result.model === 'tara' || (result.model === 'tara-int8' || (result.model === 'tara-int8-speech-aware' || result.model === 'tara-int8-speech-aware-parallel'))))) throw new Error('This result does not provide subtitle segment boundaries. Export JSON to preserve its native output and word times.')
  const cues = result.segments.map((segment, i) => `${i + 1}\n${timestamp(segment.startTime, format === 'vtt')} --> ${timestamp(segment.endTime, format === 'vtt')}\n${(corrections[segment.id] ?? segment.text).trim().replace(/-->/g, '→')}\n`).join('\n')
  return (format === 'vtt' ? 'WEBVTT\n\n' : '') + cues
}
export function benchmarkRows(results: TranscriptResult[], reference: string) {
  return results.map(result => ({ id: result.id, source: result.source.name, audioSha256: result.source.audioSha256,
    language: result.language, ...result.processingMetadata,
    wer: wordErrorRate(reference, transcriptText(result)), originalSegments: result.segments,
    ...(((result.model === 'shruti' || result.model === 'shruti-needle-3210' || result.model === 'shruti-fp32') || result.model === 'whistle' || result.model === 'shunya' || result.model === 'srota' || result.model === 'srota-cpu' || result.model === 'shunya-int8' || (result.model === 'tara' || (result.model === 'tara-int8' || (result.model === 'tara-int8-speech-aware' || result.model === 'tara-int8-speech-aware-parallel')))) ? { nativeText: result.text, nativeWords: result.words, rawResponse: result.rawResponse } : {}) }))
}

/** Export the last execution batch, independently of which historical run is viewed. */
export function benchmarkExportSelection(results: TranscriptResult[], batchIds: string[], selectedModels?: TranscriptResult['model'][]) {
  const batch = batchIds.flatMap(id => results.find(run => run.id === id) ?? [])
  if (batch.length) return batch
  // Older sessions may not have retained a batch. Keep the newest result for
  // each model instead of exporting every historical attempt oldest-first.
  const latest = new Map<string, TranscriptResult>()
  for (const result of results) latest.set(`${result.model}:${(result.model === 'tara-int8' || (result.model === 'tara-int8-speech-aware' || result.model === 'tara-int8-speech-aware-parallel')) ? result.processingMetadata.chunkingStrategy ?? 'standard' : ''}`, result)
  return selectedModels ? selectedModels.flatMap(model => [...latest.values()].filter(result => result.model === model)) : [...latest.values()]
}
export function benchmarkCsv(results: TranscriptResult[], reference: string) {
  const rows = benchmarkRows(results, reference).map(({ wer, originalSegments, ...row }) => ({ ...row,
    wer: wer?.rate ?? null, substitutions: wer?.substitutions ?? null, deletions: wer?.deletions ?? null,
    insertions: wer?.insertions ?? null, transcript: ((row.model === 'shruti' || row.model === 'shruti-needle-3210' || row.model === 'shruti-fp32') || row.model === 'whistle' || row.model === 'shunya' || row.model === 'srota' || row.model === 'srota-cpu' || row.model === 'shunya-int8' || (row.model === 'tara' || (row.model === 'tara-int8' || (row.model === 'tara-int8-speech-aware' || row.model === 'tara-int8-speech-aware-parallel')))) ? row.nativeText : originalSegments.map(s => s.text).join('') }))
  if (!rows.length) return ''
  const keys = [...new Set(rows.flatMap(row => Object.keys(row)))] as (keyof typeof rows[number])[]
  const quote = (value: unknown) => `"${(typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '')).replace(/"/g, '""')}"`
  return [keys.map(quote).join(','), ...rows.map(row => keys.map(key => quote(row[key])).join(','))].join('\r\n')
}
