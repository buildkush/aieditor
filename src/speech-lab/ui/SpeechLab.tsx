import { useEffect, useRef, useState, type ReactNode } from 'react'
import { TitleBar } from '../../components/titlebar/TitleBar'
import { resolveMediaUrl } from '../../core/media/mediaUrlResolver'
import { OriginalOutput, WordOutput } from '../../components/captions/TranscriptViews'
import { speechService } from '../services/whisperService'
import { benchmarkCsv, benchmarkRows, transcriptJson, transcriptText, transcriptWords, wordErrorRate } from '../services/evaluation'
import { missingModelRequirements, replaceModelResult, runSelectedModels } from '../services/modelComparison'
import { romanText, type RomanEdit } from '../services/romanHindi'
import type { AudioSource, Environment, ModelId, ModelStatus, Progress, TranscriptResult, TranscriptionOptions } from '../types'
import './SpeechLab.css'

const choices: { id: ModelId; name: string }[] = [{ id: 'shruti', name: 'Shruti Native' }, { id: 'tara', name: 'Tara Native · Automatic' }, { id: 'tara-q5_0', name: 'Tara Native · Q5_0' }]
export const resultLabel = (run: TranscriptResult) => run.model === 'tara' ? `Tara Native · ${run.processingMetadata.computeType === 'int8_float32' ? 'CT2 INT8' : 'Q8_0'}` : choices.find(c => c.id === run.model)?.name ?? run.model
const seconds = (value: number) => `${value.toFixed(2)} s`
const bytes = (value: number | null | undefined) => value == null ? 'Unavailable' : `${(value / 1e6).toFixed(1)} MB`
export function ModelCard({ name, selected, disabled, onToggle, children }: { name: string; selected: boolean; disabled: boolean; onToggle: () => void; children?: ReactNode }) {
  return <div className={`sl-model ${selected ? 'selected' : ''}`} onClick={e => { if (!disabled && !(e.target as HTMLElement).closest('button, input, label, select, a')) onToggle() }}>
    <label className="sl-model-choice"><input type="checkbox" checked={selected} disabled={disabled} onChange={onToggle} />{name}</label>{children}
  </div>
}
export default function SpeechLab({ onClose }: { onClose: () => void }) {
  const [environment, setEnvironment] = useState<Environment | null>(null)
  const [models, setModels] = useState<ModelStatus[]>([])
  const [source, setSource] = useState<AudioSource | null>(null)
  const [selectedModels, setSelectedModels] = useState<ModelId[]>(['shruti'])
  const [options, setOptions] = useState<TranscriptionOptions>({ model: 'shruti', language: 'hi', device: 'auto', vad: false, vadSilenceMs: 0 })
  const [results, setResults] = useState<TranscriptResult[]>([])
  const [activeId, setActiveId] = useState('')
  const [compareId, setCompareId] = useState('')
  const [view, setView] = useState<'segments' | 'words' | 'compare'>('segments')
  const [progress, setProgress] = useState<Progress | null>(null)
  const [error, setError] = useState('')
  const [failures, setFailures] = useState<Partial<Record<ModelId, string>>>({})
  const [busy, setBusy] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [notice, setNotice] = useState('')
  const [dragging, setDragging] = useState(false)
  const [reference, setReference] = useState('')
  const [roman, setRoman] = useState(false)
  const [romanEdits, setRomanEdits] = useState<Record<string, RomanEdit | undefined>>({})
  const controller = useRef<AbortController | null>(null)
  const player = useRef<HTMLAudioElement>(null)
  const started = useRef(0)
  useEffect(() => {
    let active = true
    void Promise.all([speechService.environment(), speechService.models()]).then(([env, catalog]) => { if (active) { setEnvironment(env); setModels(catalog) } }).catch(e => { if (active) setError(String(e)) })
    return () => { active = false; controller.current?.abort() }
  }, [])
  useEffect(() => { if (!busy) return; const id = window.setInterval(() => setElapsed((performance.now() - started.current) / 1000), 1000); return () => window.clearInterval(id) }, [busy])
  async function perform(work: (signal: AbortSignal) => Promise<void>) {
    if (controller.current) return
    const abort = new AbortController(); controller.current = abort; started.current = performance.now(); setElapsed(0); setBusy(true); setError(''); setNotice(''); setProgress(null)
    try { await work(abort.signal) } catch (e) { setError(abort.signal.aborted ? 'Cancelled.' : String(e)) }
    finally { setElapsed((performance.now() - started.current) / 1000); controller.current = null; setBusy(false); setProgress(null) }
  }
  async function prepare(path: string, signal: AbortSignal) {
    const audio = await speechService.prepare(path, setProgress, signal)
    if (!signal.aborted) { setSource(audio); setResults([]); setFailures({}); setActiveId(''); setCompareId(''); setRomanEdits({}) }
  }
  function browse() { void perform(async signal => { const path = await speechService.pick(); if (path) await prepare(path, signal) }) }
  function drop(file: File) { void perform(async signal => prepare(await speechService.importFile(file, setProgress, signal), signal)) }
  function transcribe() { if (source) void perform(async signal => {
    setResults(old => old.filter(result => !selectedModels.includes(result.model))); setFailures({})
    const replacing = new Set(results.filter(result => selectedModels.includes(result.model)).map(result => result.id))
    setRomanEdits(old => Object.fromEntries(Object.entries(old).filter(([id]) => !replacing.has(id))))
    const runs = await runSelectedModels(source, selectedModels, options, signal, speechService.transcribe, result => {
      setResults(old => replaceModelResult(old, result)); setActiveId(result.id)
    }, setProgress, (model, failure, duration) => setFailures(old => ({ ...old, [model]: `${String(failure)} · Failed after ${seconds(duration)}` })))
    if (runs.length > 1) { setCompareId(runs[0].id); setView('compare') }
    setNotice('Run finished. Each model keeps its latest result for this recording.')
  }) }
  function seek(time: number) { if (player.current) { player.current.currentTime = time; void player.current.play().catch(() => {}) } }
  const matching = results.filter(result => result.source.audioSha256 === source?.audioSha256)
  const active = matching.find(result => result.id === activeId) ?? matching.at(-1)
  const comparison = matching.find(result => result.id === compareId && result.id !== active?.id) ?? matching.find(result => result.id !== active?.id)
  const missing = missingModelRequirements(selectedModels, models)
  const runDisabledReason = !source ? 'Choose an audio or video source.' : !selectedModels.length ? 'Select one to three models.' : missing.map(item => `${item.id}: download model`).join('; ')
  const progressValue = progress?.total && progress.completed != null ? Math.min(1, progress.completed / progress.total) : undefined
  function exportRun(run: TranscriptResult, format: 'json' | 'txt') { void perform(async () => { const path = await speechService.export(`${run.source.name}.${run.model}.${format}`, format === 'json' ? transcriptJson(run, {}, roman ? romanText(transcriptText(run), romanEdits[run.id]) : null) : transcriptText(run)); if (path) setNotice(`Exported ${path}`) }) }
  function exportBenchmark(format: 'csv' | 'json') { void perform(async () => { await speechService.export(`speech-benchmark.${format}`, format === 'csv' ? benchmarkCsv(matching, reference) : JSON.stringify({ reference, runs: benchmarkRows(matching, reference) }, null, 2)) }) }
  return <div className="aiditor-app-root speech-lab-root"><TitleBar projectName="Speech Lab · Development" />
    <main className="speech-lab"><header className="sl-header"><div><h1>Speech Lab <span>LOCAL SPEECH</span></h1><p>Compare multilingual recognition and word timings. This lab does not create captions or change your project.</p></div><button onClick={onClose} disabled={busy}>Back to editor</button></header>
      <div className="sl-layout"><aside>
        <section><h2>Source</h2><div className={`sl-drop ${dragging ? 'dragging' : ''}`} onDragOver={e => { e.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); if (!busy && e.dataTransfer.files[0]) drop(e.dataTransfer.files[0]) }}>
          <strong>{source?.name ?? 'Drop audio or video'}</strong><p>WAV, MP3, AAC, M4A, MP4, MOV and FFmpeg-supported media</p><button disabled={busy || !environment?.runtimeInstalled} onClick={browse}>Browse files…</button>
        </div>{source && <><p>{seconds(source.duration)} · Prepared at {source.sampleRate.toLocaleString()} Hz, mono</p><audio ref={player} controls src={resolveMediaUrl(source.path)} preload="metadata" aria-label="Source audio playback" /><small>Playback uses the original media. Audio extraction stays in cache.</small></>}</section>
        <section aria-label="Models to run"><div className="sl-section-heading"><h2>Choose models</h2><button disabled={busy || !environment} onClick={() => void perform(async signal => setModels(await speechService.models(false, signal)))}>Refresh models</button></div>
          <small>{selectedModels.length} / 3 selected. Click a model card to select or deselect; Run processes selected models sequentially.</small>
          {choices.map(choice => { const model = models.find(row => row.id === choice.id); return <ModelCard key={choice.id} name={choice.name} selected={selectedModels.includes(choice.id)} disabled={busy} onToggle={() => setSelectedModels(old => old.includes(choice.id) ? old.filter(id => id !== choice.id) : [...old, choice.id])}>
            <small>{choice.id === 'shruti' ? 'Native Needle engine · CPU' : choice.id === 'tara' ? 'Automatic native engine · DTW word alignment' : 'Optional lower-memory mode · slower on the tested CPU'}</small><p>{bytes(model?.totalBytes)} · {model?.installed ? 'Installed' : 'Not installed'}</p>
            <button disabled={busy || !environment} onClick={() => void perform(async signal => setModels(await speechService.download(choice.id, setProgress, signal)))}>{model?.installed ? 'Verify / repair' : 'Download'}</button>{model?.error && <small className="sl-error-text">{model.error}</small>}
          </ModelCard> })}
          <small>Initial model downloads require internet. Installed models transcribe offline.</small>{environment && <details><summary>Storage &amp; runtime</summary><p className="sl-path">{environment.storagePath}</p><p className="sl-path">{environment.runtimePath}</p></details>}
        </section>
        <section><h2>Recognition settings</h2><label className="sl-field">Language hint<select value={options.language} disabled={busy} onChange={e => setOptions({ ...options, language: e.target.value as TranscriptionOptions['language'] })}><option value="auto">Auto-detect</option><option value="en">English</option><option value="hi">Hindi / English mixed</option></select></label>
          <label className="sl-field">Processing<select disabled={busy} value={options.device} onChange={e => setOptions({ ...options, device: e.target.value as TranscriptionOptions['device'] })}><option value="auto">Automatic</option><option value="cpu">CPU</option><option value="cuda">NVIDIA GPU if available</option><option value="vulkan">Vulkan GPU if available</option></select></label>
          <small>Shruti detects language automatically and uses CPU. Tara uses the language hint and DTW alignment. No GPU acceleration pack is currently published; Automatic falls back to CPU. Tara can be slow on CPU. Testing both Tara variants runs recognition twice.</small>
        </section>
      </aside><div className="sl-workspace">
        <div className="sl-actions"><button className="sl-primary" title={runDisabledReason || undefined} disabled={busy || !!runDisabledReason} onClick={transcribe}>Run</button><button disabled={!busy} onClick={() => controller.current?.abort()}>Cancel</button><button disabled={busy || !results.length && !Object.keys(failures).length} onClick={() => { setResults([]); setFailures({}); setRomanEdits({}); setActiveId(''); setCompareId('') }}>Clear results</button></div>
        {!busy && runDisabledReason && <p className="sl-notice">{runDisabledReason}</p>}
        {busy && <div className="sl-status" role="status"><strong>{progress?.stage ?? 'Starting local worker'} · Elapsed {seconds(elapsed)}</strong><progress max="1" value={progressValue} /><p>{progress?.message ?? 'Checking runtime…'}</p></div>}
        {!busy && elapsed > 0 && <p className="sl-notice">Last operation · {seconds(elapsed)} elapsed</p>}{error && <div className="sl-alert" role="alert">{error}</div>}{notice && <p role="status" className="sl-notice">{notice}</p>}
        {Object.entries(failures).map(([model, message]) => <div key={model} className="sl-alert" role="alert"><strong>{choices.find(c => c.id === model)?.name}</strong><p>{message}</p></div>)}
        <section><label className="sl-reference">Optional reference transcript<textarea placeholder="Paste a manually verified transcript to calculate WER" rows={3} value={reference} onChange={e => setReference(e.target.value)} /></label><small>WER uses original recognition, normalized for case and punctuation. Use a matching script.</small></section>
        {active ? <section><div className="sl-section-heading"><h2>Results</h2><select aria-label="Selected transcription run" value={active.id} onChange={e => setActiveId(e.target.value)}>{matching.map(result => <option key={result.id} value={result.id}>{resultLabel(result)} · {result.processingMetadata.device} · {seconds(result.processingMetadata.processingSec)}</option>)}</select></div>
          <Metrics result={active} reference={reference} />{active.processingMetadata.fallback && <p className="sl-notice">{active.processingMetadata.fallback}</p>}{active.processingMetadata.warnings?.map((w, i) => <p className="sl-notice" key={i}>{w}</p>)}
          <OriginalOutput result={active} /><div className="sl-actions"><button onClick={() => void navigator.clipboard.writeText(transcriptText(active)).catch(() => {})}>Copy transcript</button><button disabled={busy} onClick={() => exportRun(active, 'txt')}>Export TXT</button><button disabled={busy} onClick={() => exportRun(active, 'json')}>Export JSON</button></div>
          <label className="sl-roman-toggle"><input type="checkbox" checked={roman} onChange={e => setRoman(e.target.checked)} /> Show Roman Hindi (experimental)</label>
          <nav className="sl-tabs">{(['segments', 'words', 'compare'] as const).map(tab => <button key={tab} className={view === tab ? 'active' : ''} onClick={() => setView(tab)}>{tab === 'segments' ? 'Segments' : tab === 'words' ? 'Word timestamps' : 'Compare'}</button>)}</nav>
          {view === 'segments' && <>{active.segments.map(s => <div key={s.id}><button onClick={() => seek(s.startTime)}>{seconds(s.startTime)} – {seconds(s.endTime)}</button><pre>{s.text}</pre></div>)}{roman && <RomanOutput result={active} edit={romanEdits[active.id]} onChange={edit => setRomanEdits(old => ({ ...old, [active.id]: edit }))} />}</>}
          {view === 'words' && <WordOutput result={active} onSeek={seek} />}
          {view === 'compare' && <><label className="sl-field">Compare with<select value={comparison?.id ?? ''} onChange={e => setCompareId(e.target.value)}>{matching.filter(r => r.id !== active.id).map(r => <option key={r.id} value={r.id}>{resultLabel(r)}</option>)}</select></label>{comparison ? <ComparisonResults results={matching} reference={reference} roman={roman} romanEdits={romanEdits} onRomanChange={(id, edit) => setRomanEdits(old => ({ ...old, [id]: edit }))} onSeek={seek} onExport={exportRun} /> : <p>Run the other model on this recording to compare.</p>}<div className="sl-actions"><button disabled={busy} onClick={() => exportBenchmark('json')}>Export benchmark JSON</button><button disabled={busy} onClick={() => exportBenchmark('csv')}>Export benchmark CSV</button></div></>}
        </section> : <section className="sl-empty"><h2>Listen. Transcribe. Compare.</h2><p>Choose a recording and download a model to begin. All speech processing stays on this computer.</p></section>}
      </div></div>
    </main></div>
}
function Metrics({ result, reference }: { result: TranscriptResult; reference: string }) {
  const m = result.processingMetadata, wer = wordErrorRate(reference, transcriptText(result))
  const rows = [['Audio', seconds(m.audioDurationSec)], ['Processing · total', seconds(m.processingSec)], ['Inference', seconds(m.inferenceSec)], ['Model load', seconds(m.modelLoadSec)], ['Audio preparation', seconds(m.audioPreparationSec)], ['Device / compute', `${m.device} / ${m.computeType}`], ['Peak RAM', m.resourceMetricsAvailable === false ? 'Unavailable' : bytes(m.peakRamBytes)], ['WER · original', wer ? `${(wer.rate * 100).toFixed(1)}%` : 'No reference'], ['Runtime versions', Object.entries(m.runtimeVersions ?? {}).map(([k, v]) => `${k} ${v}`).join(' · ')]]
  if (m.modelVerificationSec != null) rows.push(['Model verification', seconds(m.modelVerificationSec)])
  if (m.inferenceEngine) rows.push(['Inference engine', m.inferenceEngine])
  if (m.nativeProfile) {
    const p = m.nativeProfile, basis = p.timingBasis?.startsWith('sum-of-chunk') ? 'sum across workers' : 'included in inference'
    rows.push([`Encoder · ${basis}`, seconds(p.encoderSec)], [`Decoder · ${basis}`, seconds(p.generationDecoderSec)], [`Word alignment · ${basis}`, seconds(p.alignmentSec ?? ((p.alignmentDecoderSec ?? 0) + (p.alignmentPostprocessSec ?? 0)))], ['CPU thread budget', String(p.threads)], ['Decoding retries', String(p.decodeRetries)])
    if (p.schedule) rows.push(['Chunk scheduling', `${p.schedule.workers} workers × ${p.schedule.threadsPerWorker} threads${p.schedule.memoryLimited ? ' · memory limited' : ''}`])
  }
  return <dl className="sl-metrics">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
}
export function RomanOutput({ result, edit, onChange }: { result: TranscriptResult; edit?: RomanEdit; onChange: (edit: RomanEdit | undefined) => void }) {
  const sourceText = transcriptText(result)
  return <div className="sl-roman"><label>Roman Hindi{edit?.sourceText === sourceText ? ' · edited' : ''}<textarea aria-label={`${resultLabel(result)} Roman Hindi text`} rows={5} value={romanText(sourceText, edit)} onChange={e => onChange({ sourceText, text: e.target.value })} /></label>{edit && <button onClick={() => onChange(undefined)}>Reset Roman spelling</button>}<small>Hindi is written in English letters; existing English words stay unchanged. Original recognition and word timings stay intact.</small></div>
}
export function ComparisonResults({ results, reference, roman, romanEdits, onRomanChange, onSeek, onExport }: { results: TranscriptResult[]; reference: string; roman: boolean; romanEdits: Record<string, RomanEdit | undefined>; onRomanChange: (id: string, edit: RomanEdit | undefined) => void; onSeek: (time: number) => void; onExport: (run: TranscriptResult, format: 'txt' | 'json') => void }) {
  return <div className="sl-comparison">{results.map(result => <div key={result.id}><h3>{resultLabel(result)}</h3><Metrics result={result} reference={reference} /><small>{transcriptWords(result).length} native word timestamps</small><OriginalOutput result={result} /><div className="sl-actions"><button onClick={() => onSeek(0)}>Play audio</button><button onClick={() => onExport(result, 'txt')}>Export TXT</button><button onClick={() => onExport(result, 'json')}>Export JSON</button></div><WordOutput result={result} onSeek={onSeek} />{roman && <RomanOutput result={result} edit={romanEdits[result.id]} onChange={edit => onRomanChange(result.id, edit)} />}</div>)}</div>
}
