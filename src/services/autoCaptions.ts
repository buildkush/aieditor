import { runWorker } from './speechWorker'
import type { ProjectAudioPlan } from '../core/captions/types'
import type { ModelStatus, Progress, TranscriptResult } from '../speech-lab/types'

export const autoCaptionsService = {
  status: (signal: AbortSignal, quickMode = false) => runWorker<ModelStatus>({ action: 'caption_status', quickMode }, undefined, signal, 'captions'),
  install: (progress: (value: Progress) => void, signal: AbortSignal, quickMode = false) => runWorker<ModelStatus[]>({ action: 'download', model: quickMode ? 'shruti' : 'tara' }, progress, signal, 'captions'),
  generate: (plan: ProjectAudioPlan, progress: (value: Progress) => void, signal: AbortSignal, quickMode = false) => runWorker<TranscriptResult>({ action: 'auto_captions', plan, quickMode }, progress, signal, 'captions'),
}
