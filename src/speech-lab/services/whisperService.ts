import { invoke } from '@tauri-apps/api/core'
import { runWorker } from '../../services/speechWorker'
export { runWorker } from '../../services/speechWorker'
import type { AudioSource, Environment, Hardware, ModelId, ModelStatus, Progress, TranscriptResult, TranscriptionOptions } from '../types'

const cancelled = () => new DOMException('Operation cancelled', 'AbortError')

export const speechService = {
  environment: () => invoke<Environment>('speech_lab_environment'),
  hardware: (signal?: AbortSignal) => runWorker<Hardware>({ action: 'hardware' }, undefined, signal),
  models: (online = false, signal?: AbortSignal) => runWorker<ModelStatus[]>({ action: 'catalog', online }, undefined, signal),
  download: (model: ModelId, progress: (p: Progress) => void, signal: AbortSignal) => runWorker<ModelStatus[]>({ action: 'download', model }, progress, signal).then(() => speechService.models(false, signal)),
  pick: () => invoke<string | null>('speech_lab_pick'),
  prepare: (path: string, progress: (p: Progress) => void, signal: AbortSignal) => runWorker<AudioSource>({ action: 'prepare', path }, progress, signal),
  transcribe: (path: string, options: TranscriptionOptions, progress: (p: Progress) => void, signal: AbortSignal) =>
    runWorker<TranscriptResult>({ action: 'transcribe', path, ...options }, progress, signal),
  export: (name: string, content: string) => invoke<string | null>('speech_lab_export', { name, content }),
  async importFile(file: File, progress: (p: Progress) => void, signal: AbortSignal): Promise<string> {
    let uploadId: string | null = null
    let path: string | null = null
    for (let offset = 0; offset < file.size; offset += 262144) {
      if (signal.aborted) throw cancelled()
      const bytes = Array.from(new Uint8Array(await file.slice(offset, offset + 262144).arrayBuffer()))
      const result: { uploadId: string; path: string | null } = await invoke('speech_lab_import_chunk', {
        name: file.name, bytes, uploadId, done: offset + bytes.length >= file.size,
      })
      uploadId = result.uploadId; path = result.path
      progress({ stage: 'import', message: `Importing ${file.name}`, completed: offset + bytes.length, total: file.size })
    }
    if (!path) throw new Error('The selected file is empty')
    return path
  },
}
