import { useMemo, useState } from 'react'
import type { TranscriptResult } from '../types'
import { suggestEnglishCorrections } from '../services/englishCorrections'
import { compareTimedTranscripts, reviewSuggestions, decideCorrection, reviewedExperimentText, experimentJson, comparisonSrt, experimentSrt, type CorrectionReview } from '../services/dualExperiment'
import { timestamp } from '../services/evaluation'

export function DualExperimentPanel({ primary, alternative, keywords, onSeek, onExport, disabled = false }: { disabled?: boolean; primary: TranscriptResult; alternative: TranscriptResult; keywords: string[]; onSeek: (time: number) => void; onExport: (name: string, content: string) => Promise<void> }) {
  const [review, setReview] = useState<CorrectionReview>()
  const [error, setError] = useState('')
  const comparison = useMemo(() => { try { return { rows: compareTimedTranscripts(primary, alternative), error: '' } } catch (e) { return { rows: [], error: (e as Error).message } } }, [primary, alternative])
  function decide(index: number, status: 'pending' | 'accepted' | 'rejected', text?: string) {
    try { const next = decideCorrection(review!, index, status, text); reviewedExperimentText(primary, next); setReview(next); setError('') } catch (e) { setError((e as Error).message) }
  }
  async function save(kind: 'json' | 'comparison' | 'shruti' | 'whistle' | 'review') {
    try {
      const content = kind === 'json' ? experimentJson(primary, alternative, review) : kind === 'comparison' ? comparisonSrt(primary, alternative) : kind === 'whistle' ? experimentSrt(alternative) : experimentSrt(primary, kind === 'review' ? review : undefined)
      await onExport(`dual-asr-${primary.id}-${kind}.${kind === 'json' ? 'json' : 'srt'}`, content); setError('')
    } catch (e) { setError((e as Error).message) }
  }
  const labels = { same: 'Agreement', different: 'Different wording / brand spelling', 'primary-only': 'Shruti only / possible Whistle omission', 'alternative-only': 'Whistle only / unverified extra words', unreliable: 'Unreliable English hypothesis over Hindi or weak timing', untimed: 'Unaligned: timestamps unavailable or point-only' }
  return <section className="sl-dual-experiment"><h2>Dual-ASR comparison · Experimental</h2>
    <fieldset disabled={disabled} style={{ border: 0, padding: 0, minWidth: 0 }}><p>Time-aligned sections show hypotheses, not ground truth. Hindi output from the English engine can be unreliable.</p>
    {(error || comparison.error) && <p role="alert" className="sl-error-text">{error || comparison.error}</p>}
    <details open><summary>Word-level differences</summary><div className="sl-difference-scroll"><table><thead><tr><th>Time</th><th>Shruti · primary</th><th>Whistle · English hypothesis</th><th>Alignment</th></tr></thead><tbody>{comparison.rows.map((row, index) => <tr key={index} data-kind={row.kind}>
      <td>{row.startTime == null ? 'Unavailable' : <button onClick={() => onSeek(row.startTime!)}>{timestamp(row.startTime, true)}</button>}</td><td>{row.original || '—'}</td><td>{row.alternative || '—'}</td><td>{labels[row.kind]}</td>
    </tr>)}</tbody></table></div></details>
    <button onClick={() => { setReview(reviewSuggestions(primary, alternative, suggestEnglishCorrections(primary, alternative, keywords))); setError('') }} disabled={!!review}>Suggest English Corrections</button>
    <p>Accepting a suggestion changes only this experimental review. Both original transcripts and word times remain intact.</p>
    {review && (review.decisions.length ? <table><thead><tr><th>Original</th><th>Suggested correction</th><th>Source</th><th>Decision</th></tr></thead><tbody>{review.decisions.map((decision, index) => <tr key={index}>
      <td><button onClick={() => onSeek(decision.suggestion.startTime)}>{timestamp(decision.suggestion.startTime, true)}</button> {decision.suggestion.original}</td>
      <td><textarea rows={2} aria-label={`Suggested correction ${index + 1}`} value={decision.replacement} onChange={event => decide(index, 'pending', event.target.value)} /></td><td>Whistle</td>
      <td><span>{decision.status}</span><button disabled={decision.status === 'accepted'} onClick={() => decide(index, 'accepted')}>Accept</button><button disabled={decision.status === 'rejected'} onClick={() => decide(index, 'rejected')}>Reject</button></td>
    </tr>)}</tbody></table> : <p>No confidently aligned English corrections. Original text remains unchanged.</p>)}
    {review && <details open><summary>Reviewed Shruti text · separate experiment</summary><pre>{reviewedExperimentText(primary, review)}</pre></details>}
    <div className="sl-actions"><button onClick={() => void save('json')}>Export comparison JSON</button><button onClick={() => void save('comparison')}>Export comparison SRT</button>
      <button onClick={() => void save('shruti')}>Export Shruti SRT</button><button onClick={() => void save('whistle')}>Export Whistle SRT</button><button disabled={!review} onClick={() => void save('review')}>Export reviewed SRT</button></div>
  </fieldset></section>
}
