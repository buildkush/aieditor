import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ProjectState } from '../../core/project/projectState'
import { SetPlayheadCommand, type EditorCommand } from '../../core/commands/editorCommand'
import type { CaptionOutputFormat, CaptionTranscript, NativeCaptionWord, WordsPerCaption } from '../../core/captions/types'
import { projectAudioPlan } from '../../core/captions/projectAudioPlan'
import { alignCaptionWords, reviewedCaptionCues } from '../../core/captions/transcriptReview'
import { captionPreviewItems, commitCaptionReview, initializeCaptionReview, regroupCaptionReview, travelCaptionReview, type CaptionReviewHistory } from '../../core/captions/reviewEditing'
import { generateId } from '../../core/utils'
import { autoCaptionsService } from '../../services/autoCaptions'
import type { ModelStatus, Progress, TranscriptResult } from '../../speech-lab/types'
import { PreviewPanel } from '../preview/PreviewPanel'
import type { usePlayer } from '../preview/usePlayer'
import { CaptionFormatSelect, TranscriptReview, WordsPerCaptionSelect } from './TranscriptReview'
import '../dialogs/ProjectSettingsDialog.css'
import './AutoCaptionsDialog.css'

function friendlyError(err: unknown) {
  const message = String((err as Error).message ?? err)
  if (/runtime|desktop app/i.test(message)) return 'Captions are unavailable. Complete the local caption setup and try again.'
  return message
}
interface Props { state: ProjectState; onImport: (transcript: CaptionTranscript) => void; onClose: () => void; dispatch?: (command: EditorCommand) => void; player?: ReturnType<typeof usePlayer> }

export function AutoCaptionsDialog({ state, onImport, onClose, dispatch, player }: Props) {
  const [format, setFormat] = useState<CaptionOutputFormat>('hinglish')
  const [wordsPerCaption, setWordsPerCaption] = useState<WordsPerCaption>('auto')
  const [quickMode, setQuickMode] = useState(false)
  const [model, setModel] = useState<ModelStatus | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState<Progress | null>(null)
  const [history, setHistory] = useState<CaptionReviewHistory | null>(null)
  const [candidate, setCandidate] = useState<CaptionTranscript | null>(null)
  const transcript = history?.present ?? null
  const controller = useRef<AbortController | null>(null)
  const mounted = useRef(false)
  const card = useRef<HTMLDivElement>(null)
  const previewEnd = useRef<number | null>(null)
  const stop = player?.stop
  const close = useCallback(() => { stop?.(); onClose() }, [stop, onClose])
  const closeRef = useRef(close)
  closeRef.current = close
  const playerRef = useRef(player)
  playerRef.current = player
  const planError = useMemo(() => {
    try { return projectAudioPlan(state).clips.length ? '' : 'Add an unmuted audio clip to the timeline before generating captions.' } catch (err) { return String((err as Error).message) }
  }, [state.id, state.items, state.tracks, state.assets])
  const previewItems = useMemo(() => transcript ? captionPreviewItems(transcript) : [], [transcript])
  function commit(value: CaptionTranscript) { setHistory(old => old ? commitCaptionReview(old, value) : { past: [], present: value, future: [] }) }
  function travel(direction: 'undo' | 'redo') { setHistory(old => old ? travelCaptionReview(old, direction) : old) }

  useEffect(() => {
    mounted.current = true
    setBusy(true); setModel(null); setError('')
    const abort = new AbortController(); controller.current = abort
    void autoCaptionsService.status(abort.signal, quickMode).then(value => { if (!abort.signal.aborted) setModel(value) })
      .catch(err => { if (!abort.signal.aborted) setError(friendlyError(err)) })
      .finally(() => { if (!abort.signal.aborted) { setBusy(false); controller.current = null } })
    return () => { mounted.current = false; abort.abort(); controller.current?.abort() }
  }, [quickMode])
  useEffect(() => () => stop?.(), [stop])
  useEffect(() => {
    if (previewEnd.current !== null && state.playheadTime >= previewEnd.current) { stop?.(); previewEnd.current = null }
  }, [state.playheadTime, stop])
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    card.current?.querySelector<HTMLElement>('select, button')?.focus()
    const handle = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current() }
      if (event.code === 'Space' && !['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes((event.target as HTMLElement).tagName)) { event.preventDefault(); playerRef.current?.togglePlay() }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !['INPUT', 'TEXTAREA'].includes((event.target as HTMLElement).tagName)) { event.preventDefault(); travel(event.shiftKey ? 'redo' : 'undo') }
      if (event.key !== 'Tab') return
      const fields = card.current?.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), input:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]')
      if (!fields?.length) return
      const first = fields[0], last = fields[fields.length - 1]
      if (event.shiftKey && (document.activeElement === first || !card.current?.contains(document.activeElement))) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && (document.activeElement === last || !card.current?.contains(document.activeElement))) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', handle)
    return () => { document.removeEventListener('keydown', handle); previous?.focus() }
  }, [])

  async function perform(work: (signal: AbortSignal) => Promise<void>) {
    if (controller.current) return
    const abort = new AbortController(); controller.current = abort; setBusy(true); setError(''); setProgress(null); stop?.()
    try { await work(abort.signal) }
    catch (err) { if (mounted.current) setError(abort.signal.aborted ? 'Cancelled. Your reviewed captions are unchanged.' : friendlyError(err)) }
    finally { if (mounted.current) { controller.current = null; setBusy(false); setProgress(null) } }
  }
  function generate() {
    void perform(async signal => {
      const plan = projectAudioPlan(state)
      const value: TranscriptResult = await autoCaptionsService.generate(plan, setProgress, signal, quickMode)
      if (signal.aborted) return
      const timed: NativeCaptionWord[] = (value.words ?? []).map(word => {
        if (word.startTime == null || word.endTime == null || word.endTime > value.source.duration + .1) throw new Error('Valid word timings were not returned. Please try again.')
        return { ...word, startTime: word.startTime, endTime: word.endTime }
      })
      const fresh = initializeCaptionReview({ id: generateId('auto-caption'), nativeText: value.text ?? '', nativeWords: alignCaptionWords(value.text ?? '', timed), language: value.language,
        rawResponse: value.rawResponse, engine: quickMode ? 'shruti' : 'tara', modelRevision: value.processingMetadata.modelRevision, audioSha256: value.source.audioSha256, audioPlan: plan,
        outputFormat: transcript?.outputFormat ?? format, nativeEdits: {}, romanEdits: {},
        pacing: { wordsPerCaption: transcript?.pacing?.wordsPerCaption ?? wordsPerCaption, aspectRatio: state.settings.width / state.settings.height } })
      if (transcript) setCandidate(fresh)
      else setHistory({ past: [], present: fresh, future: [] })
    })
  }
  function setOutput(value: CaptionOutputFormat) { setFormat(value); if (transcript) commit({ ...transcript, outputFormat: value }) }
  function setPacing(value: WordsPerCaption) {
    try {
      if (transcript) commit(regroupCaptionReview(transcript, { wordsPerCaption: value, aspectRatio: state.settings.width / state.settings.height }))
      setWordsPerCaption(value); setError('')
    } catch (err) { setError(friendlyError(err)) }
  }
  function seek(time: number) { stop?.(); previewEnd.current = null; dispatch?.(new SetPlayheadCommand(time)) }
  function preview(start: number, end: number) { stop?.(); player?.play(); dispatch?.(new SetPlayheadCommand(start)); previewEnd.current = end }
  function importCaptions() { if (!transcript) return; try { reviewedCaptionCues(transcript); stop?.(); onImport(transcript) } catch (err) { setError(friendlyError(err)) } }
  const progressValue = progress?.total && progress.completed != null ? Math.min(1, progress.completed / progress.total) : undefined
  return <div className="aiditor-modal-backdrop" onClick={close}>
    <div ref={card} className={`aiditor-modal-card auto-captions-card ${transcript ? 'review' : ''}`} role="dialog" aria-modal="true" aria-labelledby="auto-captions-title" onClick={event => event.stopPropagation()}>
      <div className="aiditor-modal-header"><div className="aiditor-modal-title" id="auto-captions-title">{transcript ? 'Review captions' : 'Generate Auto Captions'}</div><button className="aiditor-modal-close" onClick={close} aria-label="Close auto captions">✕</button></div>
      <div className="auto-captions-body">
        <div className="caption-setup-controls"><CaptionFormatSelect value={transcript?.outputFormat ?? format} onChange={setOutput} disabled={busy} />
          <WordsPerCaptionSelect value={transcript?.pacing?.wordsPerCaption ?? wordsPerCaption} onChange={setPacing} disabled={busy} />
        </div>
        <label className="caption-quick-mode"><input type="checkbox" checked={quickMode} disabled={busy} onChange={event => setQuickMode(event.target.checked)} aria-describedby="caption-quick-mode-note" />Quick mode</label>
        <small id="caption-quick-mode-note">Faster captions, but may be less accurate, especially for English names and mixed-language speech.</small>
        {(transcript?.review ? transcript.review.segments.some(segment => segment.words.some(word => word.timingNeedsReview)) : transcript?.nativeWords.some(word => word.timingNeedsReview)) && <p role="status">Some original word timings need review. You can adjust them before importing.</p>}
        {planError && !transcript && <p role="alert">{planError}</p>}
        {(error || model?.error) && <p role="alert" className="auto-captions-error">{error || 'Captions need local setup before they can be generated.'}</p>}
        {(!model?.installed || model.runtimeInstalled === false) && !busy && model && <button onClick={() => void perform(async signal => { const rows = await autoCaptionsService.install(setProgress, signal, quickMode); if (!signal.aborted) setModel(rows.find(row => row.id === (quickMode ? 'shruti' : 'tara')) ?? null) })}>Set up captions</button>}
        {busy && <div role="status" className="auto-captions-progress"><progress max={1} value={progressValue} /><span>{progress?.stage === 'audio' ? 'Preparing audio…' : progress?.stage === 'downloading' ? 'Setting up captions…' : transcript || progress ? 'Generating captions…' : 'Getting ready…'}</span><button onClick={() => controller.current?.abort()}>Stop</button></div>}
        {candidate && <div className="caption-retry-choice" role="status"><span>New captions are ready. Keep your edits or use the new version.</span><button onClick={() => setCandidate(null)}>Keep edits</button><button onClick={() => { commit(candidate); setCandidate(null) }}>Use new captions</button></div>}
        {transcript && <div className="caption-review-layout">
          <div className="caption-video">{dispatch && player && <PreviewPanel state={state} dispatch={dispatch} player={player} readOnly previewCaptions={previewItems} />}</div>
          <TranscriptReview transcript={transcript} onChange={commit} onSeek={seek} onPreview={preview} playheadTime={state.playheadTime} fps={state.settings.fps || 30}
            isPlaying={player?.playbackMode === 'forward'}
            onUndo={() => travel('undo')} onRedo={() => travel('redo')} canUndo={!!history?.past.length} canRedo={!!history?.future.length} />
        </div>}
      </div>
      <div className="auto-captions-footer"><button onClick={close}>Cancel</button>
        {transcript && <button disabled={busy || !!candidate} onClick={generate}>Retry</button>}
        {transcript ? <button className="primary" disabled={busy || !transcript.review?.segments.length} onClick={importCaptions}>Import</button> : <button className="primary" disabled={busy || !!planError || !model?.installed || model.runtimeInstalled === false} onClick={generate}>Generate captions</button>}
      </div>
    </div>
  </div>
}
