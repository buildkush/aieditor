import type { TranscriptResult, TranscriptWord, TranscriptionOptions, AudioSource, Progress } from '../types'
import { transcriptText, transcriptWords, timestamp } from './evaluation'
import type { EnglishSuggestion } from './englishCorrections'

const key = (text: string) => text.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}]/gu, '').replace(/\s+/g, ' ').trim()
const timed = (word: TranscriptWord) => word.startTime != null && word.endTime != null && Number.isFinite(word.startTime) && Number.isFinite(word.endTime) && word.startTime >= 0 && word.endTime > word.startTime
export interface Difference { original: string; alternative: string; sourceIndices: number[]; alternativeIndices: number[]; startTime: number | null; endTime: number | null; kind: 'same' | 'different' | 'primary-only' | 'alternative-only' | 'unreliable' | 'untimed' }
export function compareTimedTranscripts(primary: TranscriptResult, alternative: TranscriptResult): Difference[] {
  if (primary.source.audioSha256 !== alternative.source.audioSha256) throw new Error('Compare runs of the same prepared audio.')
  const a = transcriptWords(primary), b = transcriptWords(alternative)
  for (const words of [a, b]) {
    let previous = -1
    for (const word of words) if (timed(word)) { if (word.startTime! < previous) throw new Error('Unordered model timestamps cannot be aligned reliably.'); previous = word.startTime! }
  }
  const rows: Difference[] = []
  let i = 0, j = 0
  const add = (ai: number[], bi: number[], kind: Difference['kind']) => {
    const selected = [...ai.map(k => a[k]), ...bi.map(k => b[k])].filter(timed)
    rows.push({ original: ai.map(k => a[k].text).join(' '), alternative: bi.map(k => b[k].text).join(' '), sourceIndices: ai, alternativeIndices: bi,
      startTime: selected.length ? Math.min(...selected.map(w => w.startTime!)) : null, endTime: selected.length ? Math.max(...selected.map(w => w.endTime!)) : null, kind })
  }
  while (i < a.length || j < b.length) {
    if (i < a.length && !timed(a[i])) { add([i++], [], 'untimed'); continue }
    if (j < b.length && !timed(b[j])) { add([], [j++], 'untimed'); continue }
    if (i >= a.length) { add([], [j++], 'alternative-only'); continue }
    if (j >= b.length) { add([i++], [], 'primary-only'); continue }
    if (a[i].endTime! <= b[j].startTime!) { add([i++], [], 'primary-only'); continue }
    if (b[j].endTime! <= a[i].startTime!) { add([], [j++], 'alternative-only'); continue }
    // Connected time intervals form a section, not an asserted word-for-word map.
    const ai = [i++], bi = [j++]
    let endA = a[ai[0]].endTime!, endB = b[bi[0]].endTime!
    while (true) {
      if (i < a.length && timed(a[i]) && a[i].startTime! < endB) { ai.push(i); endA = Math.max(endA, a[i++].endTime!); continue }
      if (j < b.length && timed(b[j]) && b[j].startTime! < endA) { bi.push(j); endB = Math.max(endB, b[j++].endTime!); continue }
      break
    }
    const original = ai.map(k => a[k].text).join(' '), other = bi.map(k => b[k].text).join(' ')
    const start = Math.max(a[ai[0]].startTime!, b[bi[0]].startTime!)
    const union = Math.max(endA, endB) - Math.min(a[ai[0]].startTime!, b[bi[0]].startTime!)
    const weak = (Math.min(endA, endB) - start) / union < .5 || ai.length > 6 || bi.length > 6 || /[\u0900-\u097f]/u.test(original) && /^[\x00-\x7f]*$/.test(other)
    add(ai, bi, key(original) === key(other) ? 'same' : weak ? 'unreliable' : 'different')
  }
  return rows
}

export interface CorrectionDecision { suggestion: EnglishSuggestion; replacement: string; status: 'pending' | 'accepted' | 'rejected' }
export interface CorrectionReview { primaryId: string; alternativeId: string; decisions: CorrectionDecision[] }
export function reviewSuggestions(primary: TranscriptResult, alternative: TranscriptResult, suggestions: EnglishSuggestion[]): CorrectionReview {
  if (primary.model !== 'shruti' || alternative.model !== 'whistle' || primary.source.audioSha256 !== alternative.source.audioSha256) throw new Error('Corrections require Shruti and Whistle runs of the same audio.')
  return { primaryId: primary.id, alternativeId: alternative.id, decisions: suggestions.map(suggestion => ({ suggestion: structuredClone(suggestion), replacement: suggestion.proposed, status: 'pending' })) }
}
export function decideCorrection(review: CorrectionReview, index: number, status: CorrectionDecision['status'], replacement?: string): CorrectionReview {
  if (!review.decisions[index]) throw new Error('Suggestion is unavailable.')
  const value = (replacement ?? review.decisions[index].replacement).trim()
  if (!value && status === 'accepted') throw new Error('A correction cannot be empty.')
  return { ...review, decisions: review.decisions.map((decision, i) => i === index ? { ...decision, replacement: value, status } : decision) }
}
function acceptedEdits(primary: TranscriptResult, review?: CorrectionReview) {
  if (!review) return []
  if (review.primaryId !== primary.id) throw new Error('This review belongs to another run.')
  const accepted = review.decisions.filter(d => d.status === 'accepted').sort((x, y) => x.suggestion.sourceIndices[0] - y.suggestion.sourceIndices[0])
  const words = transcriptWords(primary)
  let previous = -1
  for (const decision of accepted) {
    const indices = decision.suggestion.sourceIndices
    if (!indices.length || indices.some((index, i) => !words[index] || words[index].startTime == null || words[index].endTime == null || !Number.isFinite(words[index].startTime) || !Number.isFinite(words[index].endTime) || words[index].startTime! < 0 || words[index].endTime! < words[index].startTime! || i > 0 && (index !== indices[i - 1] + 1 || words[index].startTime! < words[indices[i - 1]].startTime!)) || indices[0] <= previous) throw new Error('Correction alignment is ambiguous or overlapping.')
    previous = indices.at(-1)!
    if (decision.suggestion.original !== indices.map(i => words[i].text).join(' ') || decision.suggestion.startTime !== words[indices[0]].startTime || decision.suggestion.endTime !== words[previous].endTime) throw new Error('Correction no longer matches the original model words.')
  }
  return accepted
}
export function reviewedExperimentText(primary: TranscriptResult, review?: CorrectionReview): string {
  const accepted = acceptedEdits(primary, review)
  const original = transcriptText(primary)
  if (!accepted.length) return original
  const words = transcriptWords(primary)
  let cursor = 0
  const positions = words.map(word => {
    const start = original.toLowerCase().indexOf(word.text.trim().toLowerCase(), cursor)
    if (start < 0 || /[\p{L}\p{N}]/u.test(original.slice(cursor, start))) throw new Error('Native text and words cannot be aligned safely for review.')
    cursor = start + word.text.trim().length
    return { start, end: cursor }
  })
  let result = original
  for (const decision of [...accepted].reverse()) {
    const indices = decision.suggestion.sourceIndices
    const start = positions[indices[0]].start, end = positions[indices.at(-1)!].end
    const punctuation = /[\p{P}]$/u.test(decision.replacement) ? '' : original.slice(start, end).match(/[\p{P}]+$/u)?.[0] ?? ''
    result = result.slice(0, start) + decision.replacement + punctuation + result.slice(end)
  }
  return result
}

function nativeLabels(result: TranscriptResult, words: TranscriptWord[]) {
  const original = transcriptText(result)
  let cursor = 0
  const starts = words.map(word => {
    const start = original.toLowerCase().indexOf(word.text.trim().toLowerCase(), cursor)
    if (start < 0 || /[\p{L}\p{N}]/u.test(original.slice(cursor, start))) throw new Error('Native transcript contains words without an aligned timestamp. Export JSON.')
    cursor = start + word.text.trim().length
    return start
  })
  if (/[\p{L}\p{N}]/u.test(original.slice(cursor))) throw new Error('Native transcript contains untimed words. Export JSON.')
  return words.map((_, index) => original.slice(index === 0 ? 0 : starts[index], starts[index + 1] ?? original.length).trim())
}

/** SRT display cues use returned boundaries. New phrase text stays one timed span. */
export function experimentSrt(result: TranscriptResult, review?: CorrectionReview): string {
  const words = transcriptWords(result)
  if (!words.length || words.some(word => word.startTime == null || word.endTime == null || !Number.isFinite(word.startTime) || !Number.isFinite(word.endTime) || word.startTime < 0 || word.endTime < word.startTime)) throw new Error('SRT needs real word intervals for every word. Export JSON when timings are missing.')
  const accepted = acceptedEdits(result, review)
  const labels = nativeLabels(result, words)
  const cues: { text: string; start: number; end: number }[] = []
  for (let i = 0; i < words.length;) {
    const decision = accepted.find(d => d.suggestion.sourceIndices[0] === i)
    const endIndex = decision ? decision.suggestion.sourceIndices.at(-1)! : i
    const start = words[i].startTime!, end = words[endIndex].endTime!
    if (end > result.source.duration + .1 || i > 0 && start < words[i - 1].startTime!) throw new Error('Invalid word ordering or bounds; use JSON to inspect raw timings.')
    const punctuation = decision && !/[\p{P}]$/u.test(decision.replacement) ? labels[endIndex].match(/[\p{P}]+$/u)?.[0] ?? '' : ''
    cues.push({ text: decision ? decision.replacement + punctuation : labels[i], start, end }); i = endIndex + 1
  }
  for (let i = 0; i < cues.length;) {
    const cue = cues[i]
    if (cue.end > cue.start) { i++; continue }
    const left = cues[i - 1], right = cues[i + 1]
    const leftGap = left ? Math.max(0, cue.start - left.end) : Infinity
    const rightGap = right ? Math.max(0, right.start - cue.end) : Infinity
    if (Math.min(leftGap, rightGap) >= .25) throw new Error('SRT needs real word intervals. This isolated point has no display interval; export JSON.')
    if (leftGap <= rightGap) { left.end = Math.max(left.end, cue.end); left.text += ` ${cue.text}`; cues.splice(i, 1); i = Math.max(0, i - 1) }
    else { right.start = Math.min(right.start, cue.start); right.text = `${cue.text} ${right.text}`; cues.splice(i, 1) }
  }
  return cues.map((cue, i) => `${i + 1}\n${timestamp(cue.start)} --> ${timestamp(cue.end)}\n${cue.text.replace(/-->/g, '→')}\n`).join('\n')
}
export function experimentJson(primary: TranscriptResult, alternative: TranscriptResult, review?: CorrectionReview) {
  if (review && review.alternativeId !== alternative.id) throw new Error('Review belongs to a different comparison.')
  return JSON.stringify({ schemaVersion: 1, experimental: true, primary, alternative, differences: compareTimedTranscripts(primary, alternative), review,
    reviewedText: reviewedExperimentText(primary, review), timingPolicy: 'Raw model word times preserved. Accepted phrases retain the original Shruti span; no new word times.' }, null, 2)
}

export function comparisonSrt(primary: TranscriptResult, alternative: TranscriptResult) {
  const rows = compareTimedTranscripts(primary, alternative)
  if (!rows.length || rows.some(row => row.startTime == null || row.endTime == null)) throw new Error('Comparison SRT requires real timed intervals. Export JSON for untimed differences.')
  return rows.map((row, i) => `${i + 1}\n${timestamp(row.startTime!)} --> ${timestamp(row.endTime!)}\nShruti: ${row.original || '[no matching word]'}\nWhistle: ${row.alternative || '[no matching word]'}\n`).join('\n')
}

type Recognize = (path: string, options: TranscriptionOptions, progress: (value: Progress) => void, signal: AbortSignal) => Promise<TranscriptResult>
export async function runDualExperiment(source: AudioSource, keywords: string[], signal: AbortSignal, recognize: Recognize, onResult: (value: TranscriptResult) => void, onProgress: (value: Progress) => void) {
  const runs: TranscriptResult[] = []
  for (const model of ['shruti', 'whistle'] as const) {
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError')
    const run = await recognize(source.path, { model, language: model === 'whistle' ? 'en' : 'auto', device: 'auto', vad: false, vadSilenceMs: 500, keywords }, onProgress, signal)
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError')
    if (run.source.audioSha256 !== source.audioSha256 || run.source.audioPath !== source.audioPath) throw new Error('Prepared audio changed. Select the recording again.')
    runs.push(run); onResult(run)
  }
  return runs
}
