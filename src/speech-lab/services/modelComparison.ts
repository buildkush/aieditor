import type { AudioSource, ModelId, ModelStatus, Progress, TranscriptResult, TranscriptionOptions } from '../types'
export function replaceModelResult(results: TranscriptResult[], next: TranscriptResult) {
  return [...results.filter(result => result.model !== next.model || result.source.audioSha256 !== next.source.audioSha256), next]
}
export function missingModelRequirements(selected: ModelId[], models: ModelStatus[]) {
  return selected.filter(id => !models.find(row => row.id === id)?.installed).map(id => ({ id, requirement: 'download' as const }))
}
export async function runSelectedModels(source: AudioSource, selected: ModelId[], settings: TranscriptionOptions, signal: AbortSignal,
  recognize: (path: string, options: TranscriptionOptions, progress: (value: Progress) => void, signal: AbortSignal) => Promise<TranscriptResult>,
  onResult: (result: TranscriptResult) => void, onProgress: (value: Progress) => void,
  onFailure?: (model: ModelId, error: unknown, elapsedSec: number) => void) {
  if (!selected.length || selected.length > 3 || new Set(selected).size !== selected.length || selected.some(id => !['shruti', 'tara', 'tara-q5_0'].includes(id))) throw new Error('Select native Shruti or Tara models.')
  const results: TranscriptResult[] = []
  for (const model of selected) {
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError')
    const started = performance.now()
    try {
      const result = await recognize(source.path, { ...settings, model, vad: false, wordTimestamps: true }, value => onProgress({ ...value, message: `${model} · ${value.message}` }), signal)
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError')
      if (result.source.audioSha256 !== source.audioSha256 || result.source.audioPath !== source.audioPath) throw new Error('Prepared audio changed. Select the recording again.')
      results.push(result); onResult(result)
    } catch (error) {
      if (signal.aborted || !onFailure) throw error
      onFailure(model, error, (performance.now() - started) / 1000)
    }
  }
  return results
}
