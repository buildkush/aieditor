import { transcriptText, transcriptWords } from '../../speech-lab/services/evaluation'
import type { TranscriptResult } from '../../speech-lab/types'

export function OriginalOutput({ result }: { result: TranscriptResult }) {
  const detected = result.language ?? 'Language unavailable'
  const language = detected
  return <details open><summary>Native {result.model === 'shruti' ? 'Shruti' : 'Tara'} output · {language}</summary><pre>{transcriptText(result) || 'No speech recognized.'}</pre></details>
}

export function WordOutput({ result, onSeek }: { result: TranscriptResult; onSeek: (time: number) => void }) {
  const words = transcriptWords(result)
  return <><small>{result.processingMetadata.wordTimingSource === 'tara-attention-dtw' ? 'Experimental audio-aligned word boundaries. Probabilities describe text tokens, not timing certainty. Uncertain original intervals are retained and marked for review.' : 'Original model words and returned times/probabilities.'} Click a timed word to seek. Manual edits do not realign word times.</small>
    {!words.length && <p>No word timestamps were returned by this model.</p>}
    <div className="sl-words">{words.map((word, i) => <button key={i} disabled={word.startTime == null || word.endTime == null} onClick={() => { if (word.startTime != null) onSeek(word.startTime) }}
      title={`Probability: ${word.confidence == null ? 'unavailable' : `${(word.confidence * 100).toFixed(1)}%`}`}><strong>{word.text}</strong>
      <small>{word.startTime == null || word.endTime == null ? 'Time unavailable' : `${word.startTime.toFixed(3)} – ${word.endTime.toFixed(3)} s`}{word.timingNeedsReview ? ' · Needs review' : ''}</small></button>)}</div></>
}
