import { useMemo, useState } from 'react'
import type { TranscriptResult } from '../types'
import { reconcileLanguageSpans, type SpanExperiment } from '../services/languageSpans'
import { decideCorrection, experimentSrt, reviewedExperimentText, type CorrectionReview } from '../services/dualExperiment'
import { timestamp } from '../services/evaluation'

export function LanguageSpanPanel({ primary, experiment, busy, onSeek, onExport }: { primary: TranscriptResult; experiment: SpanExperiment; busy: boolean; onSeek: (time: number) => void; onExport: (name: string, content: string) => Promise<void> }) {
  const decisions = useMemo(() => reconcileLanguageSpans(primary, experiment), [primary, experiment])
  const [review, setReview] = useState<CorrectionReview>()
  const [error, setError] = useState('')
  function decide(index: number, status: 'accepted' | 'pending' | 'rejected', text?: string) {
    try { const next = decideCorrection(review!, index, status, text); reviewedExperimentText(primary, next); setReview(next); setError('') } catch (e) { setError((e as Error).message) }
  }
  async function save(kind: 'json' | 'srt') {
    try { const content = kind === 'json' ? JSON.stringify({ experimental: true, schemaVersion: 1, primary, experiment, decisions, review, reviewedText: reviewedExperimentText(primary, review) }, null, 2) : experimentSrt(primary, review)
      await onExport(`language-spans-${primary.id}.${kind}`, content)
    } catch (e) { setError((e as Error).message) }
  }
  const metadata = experiment.recognition?.processingMetadata
  return <section className="sl-dual-experiment"><h2>Language-span reconciliation · Experimental</h2>
    <p>Shruti owns sentence structure. Only confidently classified English phrases are cropped for Whistle. Hindi, mixed and uncertain spans remain unchanged.</p>
    {metadata && <p>Whistle English crops · CPU · load {metadata.modelLoadSec.toFixed(2)} s · inference {metadata.inferenceSec.toFixed(2)} s · peak RAM {(metadata.peakRamBytes / 1e6).toFixed(1)} MB</p>}
    {error && <p className="sl-error-text" role="alert">{error}</p>}
    <div className="sl-difference-scroll"><table><thead><tr><th>Language / time</th><th>Shruti phrase</th><th>Whistle phrase</th><th>Decision evidence</th></tr></thead><tbody>{experiment.spans.map((span, index) => <tr key={span.id} data-kind={span.language === 'uncertain' || span.language === 'mixed' ? 'untimed' : 'same'}>
      <td>{span.language}<br />{span.startTime == null ? 'Timing unavailable' : <button onClick={() => onSeek(span.startTime!)}>{timestamp(span.startTime, true)} → {timestamp(span.endTime!, true)}</button>}<small>{span.reason}</small></td>
      <td>{span.text}<small>Confidence: {span.confidence == null ? 'unavailable' : `${(span.confidence * 100).toFixed(1)}%`}</small></td><td>{decisions[index].alternative || 'Not replaced'}{experiment.recognition?.hypotheses.find(h => h.spanId === span.id) && <details><summary>Raw crop output and context</summary>{experiment.recognition.hypotheses.filter(h => h.spanId === span.id).map(h => <div key={h.spanId}><small>Crop {h.cropStart.toFixed(3)}–{h.cropEnd.toFixed(3)} s · {h.inferenceSec.toFixed(2)} s processing</small><pre>{h.text}</pre>{h.error && <p className="sl-error-text">{h.error}</p>}{h.words.map((word, i) => <small key={i}>{word.text} · {word.startTime?.toFixed(3) ?? '?'}–{word.endTime?.toFixed(3) ?? '?'} s · {word.confidence == null ? 'confidence unavailable' : `${(word.confidence * 100).toFixed(1)}%`}</small>)}</div>)}</details>}</td>
      <td>{decisions[index].status}<br />{decisions[index].reason}</td>
    </tr>)}</tbody></table></div>
    <fieldset disabled={busy} style={{ border: 0, padding: 0 }}><button disabled={!!review || !experiment.recognition} onClick={() => setReview({ primaryId: primary.id, alternativeId: experiment.recognition!.id,
      decisions: decisions.flatMap(decision => decision.suggestion ? [{ suggestion: decision.suggestion, replacement: decision.suggestion.proposed, status: 'pending' as const }] : []) })}>Suggest English Corrections</button>
      {review && (review.decisions.length ? <table><thead><tr><th>Original English span</th><th>Proposed phrase · Whistle</th><th>Review</th></tr></thead><tbody>{review.decisions.map((decision, i) => <tr key={i}><td>{decision.suggestion.original}</td><td><textarea aria-label={`English phrase correction ${i + 1}`} value={decision.replacement} onChange={event => decide(i, 'pending', event.target.value)} /></td><td>{decision.status}<button onClick={() => decide(i, 'accepted')}>Accept</button><button onClick={() => decide(i, 'rejected')}>Reject</button></td></tr>)}</tbody></table> : <p>No clearly stronger English phrases. Shruti retained.</p>)}
      {review && <details open><summary>Reviewed text · original Shruti preserved</summary><pre>{reviewedExperimentText(primary, review)}</pre></details>}
      <div className="sl-actions"><button onClick={() => void save('json')}>Export span experiment JSON</button><button onClick={() => void save('srt')}>Export reviewed SRT</button></div>
    </fieldset>
  </section>
}
