import type { TranscriptResult } from '../types'
export const fixture: TranscriptResult = { id: 'native', model: 'tara', text: 'Hello, नमस्ते', language: 'hi', languageProbability: null,
 source: { name: 'fixture.wav', path: 'fixture.wav', audioPath: 'cache.f32', audioSha256: 'same', duration: 2, sampleRate: 16000 },
 words: [{ text: 'Hello,', startTime: .1, endTime: .7 }, { text: 'नमस्ते', startTime: 1, endTime: 1.8 }], segments: [],
 processingMetadata: { model: 'tara', device: 'cpu', processingSec: 1, inferenceSec: .8, computeType: 'q8_0', audioPreparationSec: .1, modelLoadSec: .1, audioDurationSec: 2, realTimeFactor: .5, peakRamBytes: 0, cpuPercentMachine: 0, gpuPercentDevice: null, peakVramMiBDevice: null, requestedDevice: 'auto', fallback: null, languageHint: 'hi', vad: false, vadSilenceMs: null, wordTimestamps: true, coldWorker: true },
}
