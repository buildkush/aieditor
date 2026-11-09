import type { AudioSource, Progress, TranscriptResult, TranscriptionOptions } from '../types'
import { segmentLanguageSpans, type LanguageSpan, type SpanRecognition, type SpanExperiment } from './languageSpans'

export function parseSpanVocabulary(text: string): string[] {
  const entries = [...new Set(text.split('\n').map(line => line.trim()).filter(Boolean))]
  if (entries.length > 100 || entries.some(entry => entry.length > 200)) throw new Error('Use at most 100 vocabulary entries, 200 characters per entry.')
  return entries
}
export async function runLanguageSpanExperiment(source: AudioSource, keywords: string[], vocabulary: string[], contextSec: number, signal: AbortSignal,
  recognize: (path: string, options: TranscriptionOptions, progress: (value: Progress) => void, signal: AbortSignal) => Promise<TranscriptResult>,
  recognizeSpans: (source: AudioSource, spans: LanguageSpan[], context: number, keywords: string[], progress: (value: Progress) => void, signal: AbortSignal) => Promise<SpanRecognition>,
  onPrimary: (run: TranscriptResult) => void, onExperiment: (experiment: SpanExperiment) => void, onProgress: (value: Progress) => void) {
  const abort = () => { if (signal.aborted) throw new DOMException('Cancelled', 'AbortError') }
  abort()
  if (!Number.isFinite(contextSec) || contextSec < 0 || contextSec > .5) throw new Error('Use 0–0.5 seconds of context.')
  const hints = [...new Set([...keywords, ...vocabulary.map(entry => entry.split('|')[0].trim())])].filter(Boolean)
  if (hints.length > 100 || hints.some(hint => hint.length > 200)) throw new Error('Combined keywords and vocabulary must fit 100 hints of 200 characters each.')
  const primary = await recognize(source.path, { model: 'shruti', language: 'auto', device: 'auto', vad: false, vadSilenceMs: 500, keywords: hints }, onProgress, signal)
  abort()
  if (primary.source.audioSha256 !== source.audioSha256 || primary.source.audioPath !== source.audioPath) throw new Error('Prepared audio changed; select it again.')
  onPrimary(primary)
  const spans = segmentLanguageSpans(primary, vocabulary.concat(keywords))
  let experiment: SpanExperiment = { primaryId: primary.id, spans, recognition: null, vocabulary: [...new Set([...vocabulary, ...keywords])] }
  onExperiment(experiment); abort()
  const english = spans.filter(span => span.language === 'english' && span.startTime != null && span.endTime != null && span.endTime > span.startTime && span.endTime <= source.duration)
  if (english.length) {
    const recognition = await recognizeSpans(source, english, contextSec, hints, onProgress, signal)
    abort()
    if (recognition.source.audioSha256 !== source.audioSha256 || recognition.source.audioPath !== source.audioPath) throw new Error('Span recognition used different prepared audio.')
    if (recognition.hypotheses.some(h => !english.some(span => span.id === h.spanId)) || new Set(recognition.hypotheses.map(h => h.spanId)).size !== recognition.hypotheses.length) throw new Error('Span hypotheses do not match the requested English intervals.')
    experiment = { ...experiment, recognition }; onExperiment(experiment)
  }
  return { primary, experiment }
}
