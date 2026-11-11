import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { Progress } from '../speech-lab/types'

interface WorkerEvent { jobId: string; type: 'progress' | 'result' | 'error' | 'cancelled'; data: unknown }
let queue: Promise<unknown> = Promise.resolve()
const cancelled = () => new DOMException('Operation cancelled', 'AbortError')

/** Shared serialized native job protocol for Tara/Shruti and project audio. */
export function runWorker<T>(request: Record<string, unknown>, onProgress?: (progress: Progress) => void, signal?: AbortSignal, channel: 'lab' | 'captions' = 'lab'): Promise<T> {
  const startCommand = channel === 'lab' ? 'speech_lab_start' : 'auto_captions_start'
  const cancelCommand = channel === 'lab' ? 'speech_lab_cancel' : 'auto_captions_cancel'
  const operation = queue.catch(() => {}).then(async () => {
    if (signal?.aborted) throw cancelled()
    if (!isTauri()) throw new Error(channel === 'lab' ? 'Speech Lab needs the desktop development build. Run npm run tauri dev, then Ctrl+Shift+L.' : 'Auto captions require the desktop app and native caption runtime.')
    const jobId = crypto.randomUUID()
    let finish: (() => void) | undefined
    return new Promise<T>((resolve, reject) => {
      const abort = () => { void invoke(cancelCommand, { jobId }).catch(error => { finish?.(); reject(error) }) }
      void listen<WorkerEvent>('speech-lab-event', event => {
        if (event.payload.jobId !== jobId) return
        const { type, data } = event.payload
        if (type === 'progress') { onProgress?.(data as Progress); return }
        finish?.()
        if (type === 'result') resolve(data as T)
        else if (type === 'cancelled') reject(cancelled())
        else reject(new Error((data as { message: string }).message))
      }).then(unlisten => {
        finish = () => { unlisten(); signal?.removeEventListener('abort', abort) }
        if (signal?.aborted) { finish(); reject(cancelled()); return }
        signal?.addEventListener('abort', abort, { once: true })
        void invoke(startCommand, { jobId, request }).then(() => { if (signal?.aborted) abort() })
          .catch(error => { finish?.(); reject(new Error(String(error))) })
      }).catch(reject)
    })
  })
  queue = operation
  return operation
}
