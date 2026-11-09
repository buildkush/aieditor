import type { AudioSource, ModelId, ModelStatus, Progress, TranscriptResult, TranscriptionOptions } from '../types'

export function missingModelRequirements(selected: ModelId[], models: ModelStatus[]) {
  return selected.flatMap(id => {
    const model = models.find(row => row.id === id)
    const missing: { id: ModelId; requirement: 'download' | 'runtime' }[] = []
    if (!model?.installed) missing.push({ id, requirement: 'download' })
    if (model?.runtimeInstalled === false) missing.push({ id, requirement: 'runtime' })
    return missing
  })
}

export async function runSelectedModels(source: AudioSource, selected: ModelId[], settings: TranscriptionOptions, keywords: string[], signal: AbortSignal,
  recognize: (path: string, options: TranscriptionOptions, progress: (value: Progress) => void, signal: AbortSignal) => Promise<TranscriptResult>,
  onResult: (result: TranscriptResult) => void, onProgress: (value: Progress) => void) {
  if (!selected.length || selected.length > 3 || new Set(selected).size !== selected.length) throw new Error('Select up to three different models.')
  if (selected.some(id => !['shruti', 'shunya-int8', 'whistle', 'tara-int8-speech-aware-parallel'].includes(id))) throw new Error('This model has been removed from Audio Lab.')
  const results: TranscriptResult[] = []
  for (const model of selected) {
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError')
    const options: TranscriptionOptions = model === 'tara-int8-speech-aware-parallel'
      ? { ...settings, model, device: 'cpu', language: 'hi', vad: false, keywords: undefined, wordTimestamps: true }
      : model === 'shunya-int8'
      ? { ...settings, model, device: 'cpu', language: 'auto', vad: false, keywords: undefined, wordTimestamps: model === 'shunya-int8' }
      : model === 'shruti' || model === 'whistle'
      ? { ...settings, model, language: model === 'shruti' ? 'auto' : 'en', device: 'auto', vad: false, keywords }
      : { ...settings, model, language: 'auto', keywords: undefined }
    if (model === 'tara-int8-speech-aware-parallel') { options.taraChunking = 'speech-aware'; options.wordTimestamps = true }
    const result = await recognize(source.path, options, value => onProgress({ ...value, message: `${model} · ${value.message}` }), signal)
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError')
    if (result.source.audioSha256 !== source.audioSha256 || result.source.audioPath !== source.audioPath) throw new Error('Prepared audio changed. Select the recording again.')
    results.push(result); onResult(result)
  }
  return results
}
