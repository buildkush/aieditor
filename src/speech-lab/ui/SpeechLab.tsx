import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { isTauri } from '@tauri-apps/api/core'

import { TitleBar } from '../../components/titlebar/TitleBar'

import { resolveMediaUrl } from '../../core/media/mediaUrlResolver'

import { speechService } from '../services/whisperService'

import { benchmarkCsv, benchmarkRows, benchmarkExportSelection, exportSubtitles, timestamp, transcriptJson, transcriptText, transcriptWords, wordErrorRate } from '../services/evaluation'

import { OriginalOutput, WordOutput } from '../../components/captions/TranscriptViews'

export { OriginalOutput, WordOutput } from '../../components/captions/TranscriptViews'

import { romanText, type RomanEdit } from '../services/romanHindi'

import type { AudioSource, Corrections, Environment, Hardware, ModelId, ModelStatus, Progress, TranscriptResult, TranscriptionOptions } from '../types'

import { missingModelRequirements, runSelectedModels } from '../services/modelComparison'

import { LanguageSpanPanel } from './LanguageSpanPanel'

import { runLanguageSpanExperiment, parseSpanVocabulary } from '../services/spanExperiment'

import type { SpanExperiment } from '../services/languageSpans'

import { experimentSrt } from '../services/dualExperiment'

import './SpeechLab.css'



const bytes = (value: number | null | undefined) => value == null ? 'Unavailable' : value >= 1e9 ? `${(value / 1e9).toFixed(2)} GB` : `${(value / 1e6).toFixed(1)} MB`

const seconds = (value: number) => `${value.toFixed(2)} s`

const percent = (value: number | null | undefined) => value == null ? 'Unavailable' : `${value.toFixed(1)}%`

const modelNames: Partial<Record<ModelId, string>> = { shruti: 'Shruti', 'shunya-int8': 'Shunya - CTranslate2 INT8', whistle: 'Whistle (English)', tara: 'Tara – Original (CPU FP32)', 'tara-int8': 'Tara – INT8 Standard', 'tara-int8-speech-aware': 'Tara – Speech-aware', 'tara-int8-speech-aware-parallel': 'Tara – Speech-aware · Parallel' }



export const resultLabel = (run: TranscriptResult) => run.model === 'tara-int8' && run.processingMetadata.chunkingStrategy === 'speech-aware-overlap-v1' ? 'Tara – INT8 Speech-aware' : modelNames[run.model] ?? run.model

export function ModelCard({ name, selected, disabled, onToggle, children }: {
  name: string; selected: boolean; disabled: boolean; onToggle: () => void; children?: ReactNode
}) {
  return <div className={`sl-model ${selected ? 'selected' : ''} ${disabled ? 'selection-disabled' : ''}`}
    onClick={event => { if (!disabled && !(event.target as HTMLElement).closest('button, input, label, select, option, a')) onToggle() }}>
    <label className="sl-model-choice"><input type="checkbox" checked={selected} disabled={disabled} onChange={onToggle} />{name}</label>
    {children}
  </div>
}

export default function SpeechLab({ onClose }: { onClose: () => void }) {

  const [environment, setEnvironment] = useState<Environment | null>(null)

  const [hardware, setHardware] = useState<Hardware | null>(null)

  const [models, setModels] = useState<ModelStatus[]>([])

  const [source, setSource] = useState<AudioSource | null>(null)

  const [options, setOptions] = useState<TranscriptionOptions>({ model: 'shruti', language: 'auto', device: 'auto', vad: true, vadSilenceMs: 500 })

  const [spanExperiment, setSpanExperiment] = useState<SpanExperiment | null>(null)

  const [contextSec, setContextSec] = useState(.12)

  const [globalVocabulary, setGlobalVocabulary] = useState(() => { try { return localStorage.getItem('aiditor_lab_english_vocabulary') ?? '' } catch { return '' } })

  const [recordingVocabulary, setRecordingVocabulary] = useState<Record<string, string>>({})

  const [selectedModels, setSelectedModels] = useState<ModelId[]>(['shruti'])

  const [useLanguageSpans, setUseLanguageSpans] = useState(false)

  const bothNeedle = useLanguageSpans && selectedModels.length === 2 && selectedModels.includes('shruti') && selectedModels.includes('whistle')

  const [comparisonGroup, setComparisonGroup] = useState<string[]>([])
  const fixedCpuOnly = selectedModels.every(id => ['shruti', 'shunya-int8', 'whistle', 'tara', 'tara-int8', 'tara-int8-speech-aware', 'tara-int8-speech-aware-parallel'].includes(id))
  const [busy, setBusy] = useState(false)

  const [progress, setProgress] = useState<Progress | null>(null)

  const [error, setError] = useState('')

  const [notice, setNotice] = useState('')

  const [dragging, setDragging] = useState(false)

  const [results, setResults] = useState<TranscriptResult[]>([])

  const [activeId, setActiveId] = useState('')

  const [compareId, setCompareId] = useState('')

  const [reference, setReference] = useState('')

  const [corrections, setCorrections] = useState<Record<string, Corrections>>({})

  const [view, setView] = useState<'segments' | 'words' | 'compare'>('segments')

  const [roman, setRoman] = useState(false)

  const [romanEdits, setRomanEdits] = useState<Record<string, RomanEdit | undefined>>({})

  const [shrutiKeywords, setShrutiKeywords] = useState('')

  const controller = useRef<AbortController | null>(null)

  const player = useRef<HTMLAudioElement>(null)



  useEffect(() => {

    const abort = new AbortController()

    controller.current = abort

    setBusy(true)

    const initialize = async () => {

      if (!isTauri()) throw new Error('Open Speech Lab in the desktop development app: npm run tauri dev, then Ctrl+Shift+L.')

      const env = await speechService.environment()

      if (abort.signal.aborted) return

      setEnvironment(env)

      if (!env.runtimeInstalled) throw new Error('Install the local Python runtime with: powershell -File scripts/setup-speech-lab.ps1')

      const listed = await speechService.models(false, abort.signal)

      const detected = await speechService.hardware(abort.signal)

      if (!abort.signal.aborted) { setModels(listed); setHardware(detected) }

    }

    void initialize().catch(e => { if (!abort.signal.aborted) setError(String(e)) }).finally(() => {

      if (!abort.signal.aborted) { setBusy(false); controller.current = null }

    })

    return () => { abort.abort(); controller.current?.abort() }

  }, [])



  useEffect(() => {
    if (busy || !environment?.runtimeInstalled) return
    let active = true
    const refresh = () => { void speechService.models().then(rows => { if (active) setModels(rows) }).catch(() => {}) }
    window.addEventListener('focus', refresh)
    return () => { active = false; window.removeEventListener('focus', refresh) }
  }, [busy, environment?.runtimeInstalled])

  async function perform(work: (signal: AbortSignal) => Promise<void>) {

    if (controller.current) return

    const abort = new AbortController()

    controller.current = abort

    setBusy(true); setError(''); setNotice(''); setProgress(null)

    try { await work(abort.signal) }

    catch (e) {

      if (abort.signal.aborted) {

        setNotice('Cancelled. Interrupted model downloads can be resumed.')

      } else setError(e instanceof Error ? e.message : String(e))

      void speechService.models().then(setModels).catch(() => {})

    } finally { controller.current = null; setBusy(false); setProgress(null) }

  }



  async function loadPath(path: string, signal: AbortSignal, name?: string) {

    const prepared = await speechService.prepare(path, setProgress, signal)

    setSource({ ...prepared, name: name ?? prepared.name })

    setActiveId(''); setCompareId(''); setReference(''); setSpanExperiment(null); setComparisonGroup([])

  }

  function browse() { void perform(async signal => { const path = await speechService.pick(); if (path) await loadPath(path, signal) }) }

  function drop(file: File) { void perform(async signal => { const path = await speechService.importFile(file, setProgress, signal); await loadPath(path, signal, file.name) }) }

  function transcribe() {

    if (!source) return

    const input = source

    void perform(async signal => {

      if (bothNeedle) {

        const vocabulary = [...new Set([...parseSpanVocabulary(globalVocabulary), ...parseSpanVocabulary(recordingVocabulary[input.audioSha256] ?? '')])]

        try { localStorage.setItem('aiditor_lab_english_vocabulary', globalVocabulary) } catch { /* Optional Lab preference. */ }

        await runLanguageSpanExperiment(input, shrutiKeywords.split(/[,\n]/).map(w => w.trim()).filter(Boolean), vocabulary, contextSec, signal,

          speechService.transcribe, speechService.transcribeSpans,

          run => { setResults(old => [...old, { ...run, source: { ...run.source, name: input.name } }]); setActiveId(run.id) },

          setSpanExperiment, setProgress)

        setNotice('Language spans processed. Hindi and uncertain spans remain with Shruti.'); return

      }

      setSpanExperiment(null)

      const completed: string[] = []; setComparisonGroup([])
      const runs = await runSelectedModels(input, selectedModels, options,

        shrutiKeywords.split(/[,\n]/).map(word => word.trim()).filter(Boolean), signal, speechService.transcribe,

        run => { setResults(old => [...old, { ...run, source: { ...run.source, name: input.name } }]); setActiveId(run.id); completed.push(run.id); setComparisonGroup([...completed]); if (completed.length > 1) { setCompareId(completed[0]); setView('compare') } }, setProgress)

      setComparisonGroup(runs.map(run => run.id)); if (runs.length > 1) { setCompareId(runs[0].id); setView('compare') }

      setNotice(runs.length > 1 ? 'Selected models finished sequentially on the same prepared audio. Compare outputs below.' : 'Transcription finished locally.')

    })

  }

  const matching = results.filter(result => result.source.audioSha256 === source?.audioSha256)

  const active = matching.find(result => result.id === activeId) ?? matching.at(-1)

  const comparison = matching.find(result => result.id === compareId && result.id !== active?.id) ?? matching.find(result => result.id !== active?.id)

  const spanPrimary = matching.find(run => run.id === spanExperiment?.primaryId)

  const exportRuns = benchmarkExportSelection(matching, comparisonGroup, selectedModels)
  function exportBenchmark(format: 'csv' | 'json') {
    const runs = exportRuns
    if (!runs.length) return
    const filename = `speech-benchmark-${runs[0].id.slice(0, 8)}-${crypto.randomUUID().slice(0, 8)}.${format}`
    const content = format === 'csv' ? benchmarkCsv(runs, reference) : JSON.stringify({ reference,
      normalization: 'NFKC, lowercase, punctuation stripped, whitespace tokens', runs: benchmarkRows(runs, reference) }, null, 2)
    void perform(async () => {
      const path = await speechService.export(filename, content)
      setNotice(path ? `Exported ${runs.length} model result(s): ${runs.map(run => resultLabel(run)).join(', ')}. Saved to ${path}` : 'Export cancelled; no new file was saved.')
    })
  }

  const edits = active ? corrections[active.id] ?? {} : {}

  function seek(time: number) { if (player.current) { player.current.currentTime = time; void player.current.play().catch(() => {}) } }

  function exportResult(format: 'json' | 'srt' | 'vtt' | 'txt') {

    try {

    if (!active) return

    const content = format === 'txt' ? transcriptText(active, edits) : format === 'json' ? transcriptJson(active, edits,

      roman ? romanText(transcriptText(active, edits), romanEdits[active.id]) : null) : (active.model === 'shruti' || active.model === 'shruti-needle-3210' || active.model === 'shruti-fp32' || active.model === 'whistle') ? experimentSrt(active) : exportSubtitles(active, edits, format)

    void perform(async () => { const path = await speechService.export(`${active.source.name}.${active.model}.${format}`, content); if (path) setNotice(`Exported ${path}`) })

    } catch (e) { setError((e as Error).message) }

  }

  const installed = (id: ModelId) => models.some(model => model.id === id && model.installed && model.runtimeInstalled !== false)

  const missingRequirements = missingModelRequirements(selectedModels, models)
  const runDisabledReason = busy ? 'An operation is in progress.' : !source ? 'Choose an audio or video source.' : !selectedModels.length ? 'Select one to three models.' : missingRequirements.map(item => `${(modelNames[item.id] ?? item.id)}: ${item.requirement === 'runtime' ? 'install runtime' : 'download model'}`).join('; ')

  const progressValue = progress?.total && progress.completed != null ? Math.min(1, progress.completed / progress.total) : undefined



  return <div className="aiditor-app-root speech-lab-root">

    <TitleBar projectName="Speech Lab · Development" />

    <main className="speech-lab">

      <header className="sl-header"><div><h1>Speech Lab <span>LOCAL SPEECH</span></h1><p>Compare multilingual recognition and word timings. This lab does not create captions or change your project.</p></div>

        <button onClick={onClose} disabled={busy}>Back to editor</button></header>

      <div className="sl-layout">

        <aside>

          <section><h2>Source</h2>

            <div className={`sl-drop ${dragging ? 'dragging' : ''}`} onDragOver={event => { event.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)}

              onDrop={event => { event.preventDefault(); setDragging(false); const file = event.dataTransfer.files[0]; if (file && !busy) drop(file) }}>

              <strong>{source?.name ?? 'Drop audio or video'}</strong><p>WAV, MP3, AAC, M4A, MP4, MOV and FFmpeg-supported media</p>

              <button disabled={busy || !environment?.runtimeInstalled} onClick={browse}>Browse files…</button>

            </div>

            {source && <><p>{seconds(source.duration)} · Prepared at {source.sampleRate.toLocaleString()} Hz, mono</p>

              <audio ref={player} controls src={resolveMediaUrl(source.audioPath)} preload="metadata" aria-label="Source audio playback" />

              <small>Playback uses the extracted audio. Your original file is unchanged.</small></>}

          </section>

          <section aria-label="Models to run">
            <div className="sl-section-heading"><h2>Choose models</h2><button disabled={busy || !environment?.runtimeInstalled} onClick={() => void perform(async signal => setModels(await speechService.models(true, signal)))}>Refresh models</button></div>
            <small>{selectedModels.length} / 3 selected. Click a model card to select or deselect; Run processes selected models sequentially.</small>

            {(Object.keys(modelNames).filter(id => id !== 'tara' && id !== 'tara-int8' && id !== 'tara-int8-speech-aware') as ModelId[]).map(id => {

              const model = models.find(row => row.id === id)

              return <ModelCard key={id} name={modelNames[id] ?? id} selected={selectedModels.includes(id)}
                disabled={busy || (!selectedModels.includes(id) && selectedModels.length >= 3)}
                onToggle={() => setSelectedModels(current => current.includes(id) ? current.filter(model => model !== id) : current.length < 3 ? [...current, id] : current)}>

                {id === 'tara-int8-speech-aware-parallel' && <small>Default Tara configuration · two chunks concurrently, two CPU threads each. Speech-aware boundaries and pause-constrained word alignment.</small>}
                {id === 'shruti' && <small>Cactus Needle 3.2.10 · native engine 3.3.3</small>}
                <p>{bytes(model?.totalBytes)} · {model?.installed ? 'Installed' : model?.partialBytes ? `Partial · ${bytes(model.partialBytes)}` : 'Not installed'}</p>

                {id === 'shunya-int8' ? <small>Verified CPU-study profile. Reuses existing local artifacts; no conversion required.</small> : <>
                  <button disabled={busy || !environment?.runtimeInstalled} onClick={() => void perform(async signal => setModels(await speechService.download(id === 'tara-int8-speech-aware-parallel' ? 'tara-int8' : id, setProgress, signal)))}>{id === 'tara-int8-speech-aware-parallel' ? (model?.installed ? 'Verify conversion' : 'Install / convert') : model?.installed ? 'Verify / repair' : model?.partialBytes ? 'Resume download' : 'Download'}</button>
                  {(model?.installed || !!model?.partialBytes) && <button disabled={busy} onClick={() => void perform(async signal => setModels(await speechService.remove(id === 'tara-int8-speech-aware-parallel' ? 'tara-int8' : id, signal)))}>Remove</button>}
                </>}

                {model?.error && <small className="sl-error-text">{model.error}</small>}

              </ModelCard>

            })}



            <small>Initial model downloads require internet. Installed models transcribe offline. Sizes come from repository manifests.</small>

            {environment && <details><summary>Storage & runtime</summary><p className="sl-path">{environment.storagePath}</p><p className="sl-path">{environment.pythonPath}</p></details>}

          </section>

          <section><h2>Recognition settings</h2>{fixedCpuOnly && <small>Models run sequentially on CPU using the same prepared audio.</small>}

            {selectedModels.some(id => id === 'shruti' || id === 'whistle' || id === 'shruti-needle-3210' || id === 'shruti-fp32') && <>

              <small>Shruti detects language automatically. Whistle uses English recognition. Both run locally on CPU; native outputs stay separate.</small>

              <label>Keyword hints (optional)<textarea aria-label="Shared keyword hints" disabled={busy} rows={3} maxLength={20000} placeholder="Names or phrases, separated by commas or new lines" value={shrutiKeywords} onChange={e => setShrutiKeywords(e.target.value)} /></label>

              <small>Up to 100 hints, 200 characters each. These favour recognition; they do not rewrite the result.</small>

            </>}

            <label className="sl-field">Language hint<select disabled={busy || true} value={options.language} onChange={e => setOptions({ ...options, language: e.target.value as TranscriptionOptions['language'] })}><option value="auto">Auto-detect</option><option value="en">English</option><option value="hi">Hindi</option></select></label>

            <small>Native word timestamps are requested where supported.</small>
            <label className="sl-field">Processing<select disabled={busy || fixedCpuOnly} value={fixedCpuOnly ? 'cpu' : options.device} onChange={e => setOptions({ ...options, device: e.target.value as TranscriptionOptions['device'] })}><option value="auto">Automatic</option><option value="cpu">CPU</option><option value="cuda">NVIDIA GPU if available</option></select></label>


            <label><input type="checkbox" disabled={busy} checked={options.vad} onChange={e => setOptions({ ...options, vad: e.target.checked })} /> Voice activity detection</label>

            {options.vad && <label className="sl-field">Minimum silence (ms)<input type="number" min="100" max="5000" step="100" value={options.vadSilenceMs} disabled={busy} onChange={e => setOptions({ ...options, vadSilenceMs: Number(e.target.value) })} /></label>}

            <small>Language is detected automatically for Shruti and Shunya. Whistle recognizes English. Tara uses Hindi–English mixed-code mode and automatic speech detection for chunk boundaries and word timing; keyword hints and the VAD controls above do not apply.</small>

            {selectedModels.length === 2 && selectedModels.includes('shruti') && selectedModels.includes('whistle') && <label><input type="checkbox" disabled={busy} checked={useLanguageSpans} onChange={e => setUseLanguageSpans(e.target.checked)} /> Experimental English span reconciliation</label>}

            {bothNeedle && <details open><summary>English language spans</summary>

              <label className="sl-field">Audio context (seconds)<input aria-label="English span audio context" type="number" min="0" max="0.5" step="0.02" disabled={busy} value={contextSec} onChange={e => setContextSec(Number(e.target.value))} /></label>

              <label>Global English vocabulary<textarea aria-label="Global English vocabulary" rows={3} disabled={busy} value={globalVocabulary} onChange={e => setGlobalVocabulary(e.target.value)} /></label>

              <label>Project / recording vocabulary<textarea aria-label="Project English vocabulary" rows={3} disabled={busy || !source} value={source ? recordingVocabulary[source.audioSha256] ?? '' : ''} onChange={e => { if (source) setRecordingVocabulary(old => ({ ...old, [source.audioSha256]: e.target.value })) }} /></label>

              <small>One phrase per line. Optional explicit alias: Harry Potter | हैरी पॉटर. Global terms are saved locally; project terms belong only to this recording experiment. Unknown words remain uncertain.</small>

            </details>}

            {hardware && <p>{hardware.logicalCpus} CPU threads · {bytes(hardware.ramBytes)} RAM<br />{hardware.cudaDevices ? `${hardware.cudaDevices} CUDA device(s) · ${hardware.cudaComputeTypes.join(', ')}` : 'No CUDA device detected · CPU fallback available'}</p>}

          </section>

        </aside>

        <div className="sl-workspace">

          <div className="sl-actions"><button className="sl-primary" title={runDisabledReason || undefined} aria-describedby={runDisabledReason ? "sl-run-requirements" : undefined} disabled={busy || !source || !selectedModels.length || selectedModels.some(id => !installed(id))} onClick={transcribe}>Run</button>

            <button disabled={!busy} onClick={() => { setNotice('Cancelling…'); controller.current?.abort() }}>Cancel</button>

            <button disabled={busy || !results.length} onClick={() => { setResults([]); setSpanExperiment(null); setCorrections({}); setRomanEdits({}); setActiveId(''); setCompareId(''); setComparisonGroup([]) }}>Clear results</button></div>

          {!busy && runDisabledReason && <p id="sl-run-requirements" className="sl-notice">{runDisabledReason}</p>}

          {busy && <div className="sl-status" role="status"><strong>{progress?.stage ?? 'Starting local worker'}</strong><progress max="1" value={progressValue} /><p>{progress?.message ?? 'Checking runtime…'}</p></div>}

          {error && <div className="sl-alert" role="alert">{error}</div>}{notice && <p role="status" className="sl-notice">{notice}</p>}

          <section><label className="sl-reference">Optional reference transcript<textarea placeholder="Paste a manually verified transcript to calculate WER" value={reference} onChange={e => setReference(e.target.value)} rows={3} /></label>

            <small>WER uses original recognition, normalized for case and punctuation. Devanagari and Roman Hindi are different tokens; use a matching script.</small></section>

          {spanPrimary && spanExperiment && <LanguageSpanPanel primary={spanPrimary} experiment={spanExperiment}

            key={`${spanPrimary.id}-${spanExperiment.recognition?.id ?? 'pending'}`} busy={busy} onSeek={seek}

            onExport={async (name, content) => { await perform(async () => { const path = await speechService.export(name, content); if (path) setNotice(`Exported ${path}`) }) }} />}

          {active ? <>

            <section><div className="sl-section-heading"><h2>Results</h2><select aria-label="Selected transcription run" value={active.id} onChange={e => setActiveId(e.target.value)}>{matching.map((result, i) => <option key={result.id} value={result.id}>{i + 1}. {resultLabel(result)} · {result.processingMetadata.device} · {seconds(result.processingMetadata.processingSec)}</option>)}</select></div>

              <Metrics result={active} reference={reference} />

              {active.processingMetadata.fallback && <p className="sl-notice">{active.processingMetadata.fallback}</p>}

              <OriginalOutput result={active} />
              {active.processingMetadata.chunkingStrategy === 'speech-aware-overlap-v1' && <small>Assembled speech-aware output. Original chunk hypotheses and boundary warnings are retained below and in JSON.</small>}
              {(active.model === 'tara-int8' || (active.model === 'tara-int8-speech-aware' || active.model === 'tara-int8-speech-aware-parallel')) && active.processingMetadata.wordTimingSource !== 'tara-attention-dtw' && <button disabled={busy} onClick={() => void perform(async signal => {
                const aligned=await speechService.alignTara(active,setProgress,signal)
                setResults(old => [...old,aligned]);setActiveId(aligned.id);setComparisonGroup([]);setView('words')
                setNotice('Aligned the saved transcript without rerunning recognition. Original result preserved.')
              })}>Align saved words</button>}
              {active.processingMetadata.warnings?.map((warning, i) => <p className="sl-notice" key={i}>{warning}</p>)}
              {!!active.rawResponse?.inputChunks?.length && <details><summary>Input coverage: {active.processingMetadata.processedAudioSec?.toFixed(2)} s processed · {active.rawResponse.inputChunks.length} chunks</summary>
                <small>These are input audio ranges, not speech timestamps. Processing every chunk does not guarantee the model recognized every word.</small>
                {active.rawResponse.inputChunks.map((chunk, i) => <div key={i}><strong>Input {chunk.inputStartSec.toFixed(2)}–{chunk.inputEndSec.toFixed(2)} s</strong><pre>{chunk.text || 'No text returned for this input chunk.'}</pre></div>)}
              </details>}
              <button disabled={busy} onClick={() => void navigator.clipboard.writeText(transcriptText(active)).then(() => setNotice('Transcript copied.')).catch(e => setError(String(e)))}>Copy transcript</button>
              {(active.model === 'srota' || active.model === 'srota-cpu' || active.model === 'tara' || ((active.model === 'tara-int8' || (active.model === 'tara-int8-speech-aware' || active.model === 'tara-int8-speech-aware-parallel')) && !active.processingMetadata.wordTimestamps)) && <p>Transcript-only output. No word or subtitle times were generated.</p>}

              {!!Object.keys(edits).length && <details open><summary>Corrected transcript</summary><pre>{transcriptText(active, edits)}</pre><button onClick={() => setCorrections({ ...corrections, [active.id]: {} })}>Restore model text</button></details>}

              <label><input type="checkbox" checked={roman} onChange={e => setRoman(e.target.checked)} /> Roman Hindi · keep English unchanged</label>

              {roman && <RomanOutput result={active} corrections={edits} edit={romanEdits[active.id]} onChange={edit => setRomanEdits(old => ({ ...old, [active.id]: edit }))} />}

              <div className="sl-actions">{((active.model === 'shruti-fp32' || active.model === 'shunya' || active.model === 'srota' || active.model === 'srota-cpu' || active.model === 'shunya-int8' || (active.model === 'tara' || (active.model === 'tara-int8' || (active.model === 'tara-int8-speech-aware' || active.model === 'tara-int8-speech-aware-parallel')))) ? ['json', 'txt'] as const : (active.model === 'shruti' || active.model === 'shruti-needle-3210' || active.model === 'whistle') ? ['json', 'srt', 'txt'] as const : ['json', 'srt', 'vtt'] as const).map(format => <button key={format} disabled={busy} onClick={() => exportResult(format)}>Export {format.toUpperCase()}</button>)}</div>

            </section>

            <section><nav className="sl-tabs" aria-label="Result views">{(['segments', 'words', 'compare'] as const).map(tab => <button key={tab} aria-pressed={view === tab} onClick={() => setView(tab)}>{tab === 'segments' ? 'Segments & edits' : tab === 'words' ? 'Word timestamps' : 'Compare & benchmark'}</button>)}</nav>

              {view === 'segments' && (active.model === 'shruti' || active.model === 'shruti-needle-3210' || active.model === 'shruti-fp32' || active.model === 'whistle' || active.model === 'shunya' || active.model === 'srota' || active.model === 'srota-cpu' || active.model === 'shunya-int8' || (active.model === 'tara' || (active.model === 'tara-int8' || (active.model === 'tara-int8-speech-aware' || active.model === 'tara-int8-speech-aware-parallel')))) && <p>This engine does not provide segment boundaries. Inspect its native transcript above and returned words in Word timestamps.</p>}

              {view === 'segments' && !['shruti', 'shruti-needle-3210', 'shruti-fp32', 'whistle', 'shunya', 'srota', 'srota-cpu', 'shunya-int8', 'tara', 'tara-int8', 'tara-int8-speech-aware', 'tara-int8-speech-aware-parallel'].includes(active.model) && active.segments.map(segment => <div className="sl-segment" key={segment.id}>

                <button className="sl-time" onClick={() => seek(segment.startTime)}>{timestamp(segment.startTime, true)} → {timestamp(segment.endTime, true)}</button>

                <textarea aria-label={`Segment ${segment.id + 1} recognized text`} rows={2} value={edits[segment.id] ?? segment.text} onChange={e => setCorrections({ ...corrections, [active.id]: { ...edits, [segment.id]: e.target.value } })} />

              </div>)}

              {view === 'words' && <WordOutput result={active} onSeek={seek} />}

              {view === 'compare' && <>

                <label className="sl-field">Compare with<select value={comparison?.id ?? ''} onChange={e => { setCompareId(e.target.value) }}><option value="" disabled>Select another run of this recording</option>{matching.filter(r => r.id !== active.id).map((r, i) => <option key={r.id} value={r.id}>{i + 1}. {resultLabel(r)} · {seconds(r.processingMetadata.processingSec)}</option>)}</select></label>

                {comparison ? <ComparisonResults results={comparisonGroup.includes(active.id) && comparisonGroup.length > 2 && comparisonGroup.includes(comparison.id) ? matching.filter(run => comparisonGroup.includes(run.id)) : comparison.model === 'shruti' ? [comparison, active] : [active, comparison]} reference={reference} roman={roman} corrections={corrections} romanEdits={romanEdits}

                  onExport={(run, format) => void perform(async () => { await speechService.export(`${run.source.name}.${run.model}.${format}`, format === 'json' ? transcriptJson(run) : transcriptText(run)) })} onSeek={seek} onRomanChange={(id, edit) => setRomanEdits(old => ({ ...old, [id]: edit }))} /> : <p>Run the other model on this recording to compare.</p>}

                <small>All compared runs use the same prepared audio hash. One recording is not enough to choose an overall accuracy winner. GPU measurements, when available, are device-wide.</small>

                <p>Export includes {exportRuns.length} latest result(s): {exportRuns.map(run => resultLabel(run)).join(', ')}.</p>
                <div className="sl-actions"><button disabled={busy || !exportRuns.length} onClick={() => exportBenchmark('json')}>Export benchmark JSON</button>
                  <button disabled={busy || !exportRuns.length} onClick={() => exportBenchmark('csv')}>Export benchmark CSV</button></div>

              </>}

            </section>

          </> : <section className="sl-empty"><h2>Listen. Transcribe. Compare.</h2><p>Choose a recording and download a model to begin. All speech processing stays on this computer.</p><p>Results include original segments, individual word times, confidence values and measured resource use.</p></section>}

        </div>

      </div>

    </main>

  </div>

}



export function ComparisonResults({ results, reference, roman, corrections, romanEdits, onRomanChange, onSeek = () => {}, onExport }: {

  results: TranscriptResult[]; reference: string; roman: boolean; corrections: Record<string, Corrections>;

  romanEdits: Record<string, RomanEdit | undefined>; onRomanChange: (id: string, edit: RomanEdit | undefined) => void; onSeek?: (time: number) => void; onExport?: (result: TranscriptResult, format: 'txt' | 'json') => void;

}) {

  return <div className="sl-comparison">{results.map(result => <div key={result.id}>

    <h3>{resultLabel(result)}</h3><Metrics result={result} reference={reference} />

    <small>{result.processingMetadata.wordTimingSource === 'tara-attention-dtw' ? 'Audio-aligned word timing · experimental' : (result.processingMetadata.wordTimestampsAvailable ?? result.processingMetadata.wordTimestamps) ? 'Native word timestamps available' : 'No native word timestamps'}</small>
    {result.processingMetadata.warnings?.map((warning, i) => <p key={i}>{warning}</p>)}
    <small>Original recognition</small><pre>{transcriptText(result)}</pre>
    <div className="sl-actions"><button onClick={() => onSeek(0)}>Play audio</button><button onClick={() => void navigator.clipboard.writeText(transcriptText(result)).catch(() => {})}>Copy transcript</button>{onExport && <><button onClick={() => onExport(result, 'txt')}>Export TXT</button><button onClick={() => onExport(result, 'json')}>Export JSON</button></>}</div>

    {(result.model === 'shruti' || result.model === 'shruti-needle-3210' || result.model === 'shruti-fp32' || result.model === 'whistle' || result.model === 'shunya' || result.model === 'srota' || result.model === 'srota-cpu' || result.model === 'shunya-int8' || (result.model === 'tara' || (result.model === 'tara-int8' || (result.model === 'tara-int8-speech-aware' || result.model === 'tara-int8-speech-aware-parallel')))) && <WordOutput result={result} onSeek={onSeek} />}

    {roman && <RomanOutput result={result} corrections={corrections[result.id] ?? {}} edit={romanEdits[result.id]} onChange={edit => onRomanChange(result.id, edit)} />}

  </div>)}</div>

}



export function RomanOutput({ result, corrections, edit, onChange }: { result: TranscriptResult; corrections: Corrections; edit?: RomanEdit; onChange: (edit: RomanEdit | undefined) => void }) {

  const sourceText = transcriptText(result, corrections)

  const manual = edit?.sourceText === sourceText

  return <div className="sl-roman">

    <label>Roman Hindi{manual ? ' · edited' : ''}<textarea aria-label={`${resultLabel(result)} Roman Hindi text`} rows={5} value={romanText(sourceText, edit)} onChange={e => onChange({ sourceText, text: e.target.value })} /></label>

    {manual && <button onClick={() => onChange(undefined)}>Reset Roman spelling</button>}

    <small>Hindi is written in English letters; existing English words stay unchanged. Editable spelling for this run. Original recognition and word timings stay intact. Names and recognition errors may need correction. JSON includes this text separately{result.model === 'shruti' ? '.' : '; SRT/VTT use segment text.'}</small>

  </div>

}



function Metrics({ result, reference }: { result: TranscriptResult; reference: string }) {

  const m = result.processingMetadata

  const wer = useMemo(() => wordErrorRate(reference, transcriptText(result)), [reference, result])

  return <dl className="sl-metrics">{[

    ['Chunking', m.chunkingStrategy === 'speech-aware-overlap-v1' ? 'Speech-aware · experimental' : 'Standard'], ['Audio', seconds(m.audioDurationSec)], ['Processing', seconds(m.processingSec)], ['Real-time factor', `${m.realTimeFactor.toFixed(3)}×`],

    ['Inference', seconds(m.inferenceSec)], ['Model load', seconds(m.modelLoadSec)], ['Audio preparation', seconds(m.audioPreparationSec)],
    ...(m.alignmentSec != null ? [[m.alignedFromRunId ? 'Saved word alignment' : (m.chunkWorkers ?? 1) > 1 ? 'Alignment work · sum across chunks' : 'Word alignment · included in inference', seconds(m.alignmentSec)]] : []),
    ...(m.wordTimingSource === 'tara-attention-dtw' ? [['Word timing coverage', `${transcriptWords(result).filter(w => w.startTime != null && w.endTime != null).length} / ${transcriptWords(result).length} words timed`]] : []),
    ...(m.alignmentJobSec != null ? [['Alignment job · separate from recognition', seconds(m.alignmentJobSec)], ['Alignment peak RAM', bytes(m.alignmentPeakRamBytes)]] : []),
    ...(m.chunkPlanningSec ? [['Chunk planning · included in preparation',seconds(m.chunkPlanningSec)]] : []),

    ['Device / compute', `${m.device} / ${m.computeType}`], ['Peak RAM', bytes(m.peakRamBytes)], ['CPU · machine', percent(m.cpuPercentMachine)],

    ...(m.chunkWorkers != null ? [['Chunk scheduling', `${m.chunkWorkers} worker(s) × ${m.threadsPerWorker ?? 4} threads`]] : []),
    ['Runtime versions', m.runtimeVersions ? Object.entries(m.runtimeVersions).map(([name, value]) => `${name} ${value}`).join(' · ') : 'Unavailable'],
    ['GPU · device', percent(m.gpuPercentDevice)], ['Peak VRAM · device', m.peakVramMiBDevice == null ? 'Unavailable' : `${m.peakVramMiBDevice.toFixed(0)} MiB`],

    ['WER · original', wer ? `${percent(wer.rate * 100)} · S${wer.substitutions} D${wer.deletions} I${wer.insertions}` : 'No reference'],

  ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>

}

