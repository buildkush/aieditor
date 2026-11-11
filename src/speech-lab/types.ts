export type ModelId = 'tara' | 'tara-q5_0' | 'shruti'
export type DevicePreference = 'auto' | 'cpu' | 'cuda' | 'vulkan' | 'metal'
export interface TranscriptionOptions { model: ModelId; language: 'auto' | 'en' | 'hi'; device: DevicePreference; vad: boolean; vadSilenceMs: number; wordTimestamps?: boolean }
export interface TranscriptWord { text: string; startTime: number | null; endTime: number | null; confidence?: number | null; timingNeedsReview?: boolean }
export interface TranscriptSegment { id: number; text: string; startTime: number; endTime: number; words: TranscriptWord[]; averageLogProbability?: number; noSpeechProbability?: number }
export interface AudioSource { path: string; name: string; audioPath: string; audioSha256: string; duration: number; sampleRate: number }
export interface ProcessingMetadata {
  modelVerificationSec?: number;
  inferenceEngine?: string;
  nativeProfile?: { encoderSec: number; generationDecoderSec: number; alignmentDecoderSec?: number; alignmentPostprocessSec?: number; alignmentSec?: number; threads: number; decodeRetries: number; timingBasis?: string; schedule?: { workers: number; threadsPerWorker: number; memoryLimited: boolean } } | null;
  processingSec: number; inferenceSec: number; audioPreparationSec: number; modelLoadSec: number; audioDurationSec: number;
  realTimeFactor: number; peakRamBytes: number; cpuPercentMachine: number; gpuPercentDevice: number | null;
  peakVramMiBDevice: number | null; device: string; computeType: string; requestedDevice: string; fallback: string | null;
  model: ModelId; languageHint: string; vad: boolean; vadSilenceMs: number | null; wordTimestamps: boolean; coldWorker: true;
  modelRepository?: string; modelRevision?: string; runtimeVersions?: Record<string, string>; cpuThreads?: number;
  decodeWindowSec?: number; conditionOnPreviousText?: boolean; durationAfterVadSec?: number;
  processedAudioSec?: number; inputChunkCount?: number; attentionImplementation?: string; warnings?: string[]; resourceMetricsAvailable?: boolean;
  engineRepository?: string; engineRevision?: string; wordTimestampsAvailable?: boolean; keywords?: string[];
  chunkWorkers?: number; requestedChunkWorkers?: number; threadsPerWorker?: number; chunkScheduling?: string;
  chunkingStrategy?: string; processedInputSec?: number; chunkPlanningSec?: number;
  alignmentSec?: number; wordTimingSource?: 'tara-attention-dtw' | null;
  alignmentJobSec?: number; alignmentModelLoadSec?: number; alignmentPeakRamBytes?: number; alignedFromRunId?: string;
}
export interface TranscriptResult { id: string; model: ModelId; language: string | null; languageProbability: number | null; source: AudioSource; segments: TranscriptSegment[]; processingMetadata: ProcessingMetadata; text?: string; words?: TranscriptWord[]; rawResponse?: Record<string, unknown> & { inputChunks?: { inputStartSec: number; inputEndSec: number; text: string }[] } }
export interface ModelStatus { id: ModelId; name: string; repo: string; installed: boolean; runtimeInstalled?: boolean; totalBytes: number | null; partialBytes: number; error: string | null }
export interface Hardware { cpu: string; logicalCpus: number; ramBytes: number; cudaDevices: number; cpuComputeTypes: string[]; cudaComputeTypes: string[]; cudaError: string | null; gpu: { name: string; totalMiB: number } | null }
export interface Progress { stage: string; message: string; completed?: number; total?: number | null }
export interface Environment { storagePath: string; runtimePath: string; runtimeInstalled: boolean }
export type Corrections = Record<number, string>
