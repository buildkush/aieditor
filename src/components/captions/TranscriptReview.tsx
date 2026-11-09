import { CaptionCustomization } from './CaptionCustomization'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CaptionOutputFormat, CaptionTranscript, CaptionEmphasis, WordsPerCaption } from '../../core/captions/types'
import { reviewWordText } from '../../core/captions/transcriptReview'
import { editCaptionReview, initializeCaptionReview, type CaptionReviewEdit } from '../../core/captions/reviewEditing'
import { generateId } from '../../core/utils'
import { CaptionWords } from './CaptionWords'
import { CaptionStylePicker } from './CaptionStylePicker'

export function CaptionFormatSelect({ value, onChange, disabled = false }: { value: CaptionOutputFormat; onChange: (value: CaptionOutputFormat) => void; disabled?: boolean }) {
  return <label className="auto-captions-format">Language
    <select aria-label="Caption output format" value={value} disabled={disabled} onChange={event => onChange(event.target.value as CaptionOutputFormat)}>
      <option value="hinglish">Hinglish</option><option value="hindi">Hindi</option>
    </select>
  </label>
}

function TimeField({ label, value, onCommit }: { label: string; value: number; onCommit: (time: number) => void }) {
  const [text, setText] = useState(value.toFixed(3))
  const [focused, setFocused] = useState(false)
  return <label className="caption-time-field">{label}<input aria-label={label} type="number" min="0" step="0.001" value={focused ? text : value.toFixed(3)}
    onFocus={() => { setFocused(true); setText(value.toFixed(3)) }} onChange={event => setText(event.target.value)}
    onBlur={() => { setFocused(false); if (text.trim() && Number.isFinite(Number(text)) && Number(text) !== value) onCommit(Number(text)) }}
    onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }} /></label>
}

export function WordsPerCaptionSelect({ value, onChange, disabled }: { value: WordsPerCaption; onChange: (value: WordsPerCaption) => void; disabled?: boolean }) {
  return <label className="auto-captions-format">Words per Caption<select aria-label="Words per Caption" value={value} disabled={disabled}
    onChange={event => onChange(event.target.value === 'auto' ? 'auto' : Number(event.target.value) as WordsPerCaption)}>
    <option value="auto">Auto</option>{[1, 2, 3, 4, 5].map(count => <option key={count} value={count}>{count} {count === 1 ? 'word' : 'words'}</option>)}
  </select></label>
}

interface Props {
  transcript: CaptionTranscript
  onChange: (value: CaptionTranscript) => void
  onSeek: (time: number) => void
  onPreview?: (start: number, end: number) => void
  playheadTime?: number
  fps?: number
  onUndo?: () => void
  onRedo?: () => void
  canUndo?: boolean
  canRedo?: boolean
  isPlaying?: boolean
}

export function TranscriptReview({ transcript, onChange, onSeek, onPreview, playheadTime = 0, fps = 30, onUndo, onRedo, canUndo, canRedo, isPlaying = false }: Props) {
  const draft = useMemo(() => initializeCaptionReview(transcript), [transcript])
  const segments = draft.review!.segments
  const [selectedId, setSelectedId] = useState(segments[0]?.id ?? '')
  const [selectedWords, setSelectedWords] = useState<string[]>([])
  const [error, setError] = useState('')
  const splitAt = useRef(1)
  const list = useRef<HTMLDivElement>(null)
  const selected = segments.find(segment => segment.id === selectedId)
  const selectedIndex = segments.findIndex(segment => segment.id === selectedId)
  const activeId = segments.find(segment => playheadTime >= segment.startTime && playheadTime < segment.endTime)?.id
  useEffect(() => {
    if (!segments.some(segment => segment.id === selectedId)) { setSelectedId(segments[0]?.id ?? ''); setSelectedWords([]) }
  }, [segments, selectedId])
  function scrollToCaption(id: string | undefined) {
    const element = Array.from(list.current?.querySelectorAll<HTMLElement>('[data-caption-id]') ?? []).find(element => element.dataset.captionId === id)
    if (!element || !list.current) return
    if (id === segments[0]?.id) { list.current.scrollTop = 0; return }
    const bounds = element.getBoundingClientRect(), viewport = list.current.getBoundingClientRect()
    const top = viewport.top + 46
    // Scroll this list only: scrollIntoView also moves the modal body, hiding
    // setup controls and transport in a constrained-height review dialog.
    if (bounds.top < top || bounds.height > viewport.height - 46) list.current.scrollTop += bounds.top - top
    else if (bounds.bottom > viewport.bottom) list.current.scrollTop += bounds.bottom - viewport.bottom
  }
  useEffect(() => { scrollToCaption(selectedId) }, [selectedId])
  useEffect(() => { if (document.activeElement?.tagName !== 'TEXTAREA') scrollToCaption(activeId) }, [activeId])
  function apply(edit: CaptionReviewEdit) {
    try { onChange(editCaptionReview(draft, edit)); setError(''); return true } catch (err) { setError((err as Error).message); return false }
  }
  function select(id: string, time: number) { setSelectedId(id); setSelectedWords([]); splitAt.current = 1; onSeek(time) }
  function emphasis(style: CaptionEmphasis | null) { if (selected) apply({ type: 'emphasis', id: selected.id, wordIds: selectedWords, style }) }
  function navigate(offset: number) { const next = segments[Math.max(0, Math.min(segments.length - 1, selectedIndex + offset))]; if (next) select(next.id, next.startTime) }
  const review = draft.review!
  const emphasisWords = selected?.words.filter(word => selectedWords.includes(word.id)) ?? []
  const allBold = emphasisWords.length > 0 && emphasisWords.every(word => Number(word.emphasis?.fontWeight ?? review.style.fontWeight ?? 400) >= 600)
  const allItalic = emphasisWords.length > 0 && emphasisWords.every(word => (word.emphasis?.fontStyle ?? review.style.fontStyle) === 'italic')
  return <div ref={list} className="auto-captions-review" aria-label="Editable transcript review">
    <div className="caption-review-toolbar">
      <button onClick={onUndo} disabled={!canUndo} title="Undo review edit">↶ Undo</button><button onClick={onRedo} disabled={!canRedo} title="Redo review edit">↷ Redo</button>
      <span className="caption-toolbar-spacer" />
      <button onClick={() => { const id = generateId('caption'); if (apply({ type: 'insert', id, time: playheadTime })) { setSelectedId(id); setSelectedWords([]) } }}>＋ Add caption</button>
    </div>
    <details className="caption-style-section"><summary>Caption styling</summary>
      <p className="caption-style-scope">Style applies to all captions in this review. Emphasis words stay editable per caption.</p>
      <CaptionStylePicker value={review.preset} onChange={preset => apply({ type: 'preset', preset })} />
      <CaptionCustomization style={review.style} presentation={review.presentation} activeColor={review.activeWordColor}
        onStyle={style=>apply({type:'style',style})} onPresentation={presentation=>apply({type:'style',style:{},presentation})}
        onActiveColor={activeWordColor=>apply({type:'style',style:{},activeWordColor})}/>
</details>
    {error && <p className="auto-captions-error" role="alert">{error}</p>}
    <div className="caption-segment-list" aria-label="Caption segments">
      {!segments.length && <p>No captions. Add one at the playhead.</p>}
      {segments.map((segment, index) => {
        const isSelected = selectedId === segment.id
        const active = playheadTime >= segment.startTime && playheadTime < segment.endTime
        const text = segment.words.map(word => reviewWordText(word, draft.outputFormat)).join(' ')
        return <section key={segment.id} data-caption-id={segment.id} className={`auto-caption-cue ${isSelected ? 'selected' : ''} ${active ? 'playing' : ''}`} aria-label={`Caption ${index + 1}`}>
          <div className="caption-cue-heading"><button className="auto-caption-time" onClick={() => select(segment.id, segment.startTime)} aria-label={`Jump to caption ${index + 1}`}>
            <span>{String(index + 1).padStart(2, '0')}</span> {segment.startTime.toFixed(3)} → {segment.endTime.toFixed(3)}
          </button>{active && <span className="caption-live">{isPlaying ? 'Playing' : 'At playhead'}</span>}</div>
          {isSelected ? <textarea key={`${segment.id}-${draft.outputFormat}-${text}`} aria-label={`Caption ${index + 1} text`} defaultValue={text} rows={2}
            onBlur={event => { if (event.target.value.trim() !== text) apply({ type: 'text', id: segment.id, text: event.target.value }) }}
            onSelect={event => {
              const el = event.currentTarget
              const tokens = [...el.value.matchAll(/\S+/gu)]
              const before = tokens.filter(token => token.index < el.selectionStart).length
              splitAt.current = Math.max(1, Math.min(segment.words.length - 1, before))
              if (el.selectionEnd > el.selectionStart) {
                const from = tokens.findIndex(token => token.index + token[0].length > el.selectionStart)
                const until = tokens.filter(token => token.index < el.selectionEnd).length
                setSelectedWords(segment.words.slice(Math.max(0, from), until).map(word => word.id))
              }
            }} /> : <button className="caption-cue-text" onClick={() => select(segment.id, segment.startTime)}>{text}</button>}
    {isSelected && selected && <div className="caption-selection-tools">
      {review.presentation?.emphasis && <div aria-label="Fixed emphasis word"><small>Emphasis word · stays highlighted for the whole caption</small>
        <div className="caption-focus-words">{selected.words.map(word => <button key={word.id} aria-pressed={!!word.highlight} onClick={() => apply({ type: 'focus-word', id: selected.id, wordId: word.id })}>{reviewWordText(word, draft.outputFormat)}</button>)}</div>
      </div>}
      <div className="caption-review-toolbar"><button onClick={() => navigate(-1)} disabled={selectedIndex <= 0} aria-label="Previous caption">↑</button><button onClick={() => navigate(1)} disabled={selectedIndex >= segments.length - 1} aria-label="Next caption">↓</button>
        <button onClick={() => (onPreview ?? ((start: number) => onSeek(start)))(selected.startTime, selected.endTime)}>▶ Play caption</button>
        <button disabled={selected.words.length < 2} onClick={() => apply({ type: 'split', id: selected.id, at: splitAt.current, newId: generateId('caption') })} title="Place the text cursor between words, then split">Split</button>
        <button disabled={selectedIndex >= segments.length - 1} onClick={() => apply({ type: 'merge', id: selected.id })}>Merge next</button>
        <button onClick={() => { apply({ type: 'delete', id: selected.id }); setSelectedId(segments[selectedIndex + 1]?.id ?? segments[selectedIndex - 1]?.id ?? '') }}>Delete</button>
      </div>
      <div className="caption-timing-tools">
        <TimeField label="Start (s)" value={selected.startTime} onCommit={startTime => apply({ type: 'time', id: selected.id, startTime, endTime: selected.endTime })} />
        <TimeField label="End (s)" value={selected.endTime} onCommit={endTime => apply({ type: 'time', id: selected.id, startTime: selected.startTime, endTime })} />
        <button title="Move one frame earlier" onClick={() => apply({ type: 'time', id: selected.id, startTime: selected.startTime - 1 / fps, endTime: selected.endTime - 1 / fps, shiftWords: true })}>−1 frame</button>
        <button title="Move one frame later" onClick={() => apply({ type: 'time', id: selected.id, startTime: selected.startTime + 1 / fps, endTime: selected.endTime + 1 / fps, shiftWords: true })}>+1 frame</button>
      </div>
      <details><summary>Word timing & emphasis</summary>
        <p>Select words here or select a phrase in the text.</p>
        <div className="caption-word-selection">{selected.words.map(word => <button key={word.id} aria-pressed={selectedWords.includes(word.id)} onClick={() => setSelectedWords(ids => ids.includes(word.id) ? ids.filter(id => id !== word.id) : [...ids, word.id])}>{reviewWordText(word, draft.outputFormat)}</button>)}</div>
        <fieldset disabled={!selectedWords.length} className="caption-emphasis-tools"><legend>Emphasis</legend>
          <button aria-pressed={allBold} onClick={() => emphasis({ fontWeight: allBold ? '400' : '700' })}>Bold</button><button aria-pressed={allItalic} onClick={() => emphasis({ fontStyle: allItalic ? 'normal' : 'italic' })}>Italic</button>
          <label>Font<select aria-label="Emphasis font" defaultValue="Inter, sans-serif" onChange={event => emphasis({ fontFamily: event.target.value })}>{['Inter, sans-serif', 'Arial, sans-serif', 'Georgia, serif', 'monospace'].map(font => <option key={font}>{font}</option>)}</select></label>
          <label>Color<input aria-label="Emphasis color" type="color" defaultValue="#ffd166" onChange={event => emphasis({ color: event.target.value })} /></label>
          <label>Background<input aria-label="Emphasis background" type="color" defaultValue="#334155" onChange={event => emphasis({ backgroundColor: event.target.value })} /></label>
          <button onClick={() => emphasis(null)}>Clear</button>
        </fieldset>
        {selected.words.filter(word => selectedWords.includes(word.id)).map(word => <div key={word.id} className="caption-word-timing"><span>{reviewWordText(word, draft.outputFormat)}{word.timingNeedsReview ? ' · Needs review' : ''}</span>
          <TimeField label={`${reviewWordText(word, draft.outputFormat)} start`} value={word.startTime} onCommit={startTime => apply({ type: 'word-time', id: selected.id, wordId: word.id, startTime, endTime: word.endTime })} />
          <TimeField label={`${reviewWordText(word, draft.outputFormat)} end`} value={word.endTime} onCommit={endTime => apply({ type: 'word-time', id: selected.id, wordId: word.id, startTime: word.startTime, endTime })} />
        </div>)}
      </details>
    </div>}
          {active && <div className="caption-speaking-line" aria-label="Spoken words"><CaptionWords words={segment.words.map(word => ({ id: word.id, word: reviewWordText(word, draft.outputFormat), startTime: word.startTime, endTime: word.endTime, highlight: word.highlight, ...word.emphasis }))} playheadTime={playheadTime} activeColor={review.activeWordColor} presentation={review.presentation} /></div>}
        </section>
      })}
    </div>
  </div>
}
