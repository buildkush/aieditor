import { describe, expect, it, vi } from 'vitest'
import { missingModelRequirements, runSelectedModels } from './modelComparison'
import type { AudioSource, ModelId, TranscriptResult, TranscriptionOptions } from '../types'
const source: AudioSource = { path: 'original', audioPath: 'prepared.wav', audioSha256: 'same', duration: 5, name: 'fixture', sampleRate: 16000 }
const settings: TranscriptionOptions = { model: 'shunya-int8', language: 'hi', device: 'cpu', vad: true, vadSilenceMs: 500 }
const run = (model: ModelId) => ({ id: model, model, source }) as TranscriptResult
describe('Selected model comparison', () => {
  it('runs sequentially on identical prepared audio, with independent configurations and outputs', async () => {
    const ready = vi.fn()
    const recognize = vi.fn(async (_path, options) => { expect(ready.mock.calls.length).toBe(options.model === 'shruti' ? 0 : 1); return run(options.model) })
    const results = await runSelectedModels(source, ['shruti', 'shunya-int8'], settings, ['Coke'], new AbortController().signal, recognize, ready, () => {})
    expect(results.map(r => r.model)).toEqual(['shruti', 'shunya-int8'])
    expect(recognize.mock.calls[0][1]).toMatchObject({ language: 'auto', keywords: ['Coke'], vad: false })
    expect(recognize.mock.calls[1][1]).toMatchObject({ language: 'auto', vad: false, device: 'cpu' })
    expect(recognize.mock.calls[1][1].keywords).toBeUndefined()
  })
  it.each([['shruti', 'shunya-int8'], ['shunya-int8', 'whistle'], ['whistle', 'shruti']] as const)('runs the chosen pair %s and %s in order', async (first, second) => {
    const recognize = vi.fn(async (_path, options) => run(options.model))
    const results = await runSelectedModels(source, [first, second], settings, ['Coke'], new AbortController().signal, recognize, () => {}, () => {})
    expect(results.map(r => r.model)).toEqual([first, second])
    if (first === 'whistle' || second === 'whistle') expect(recognize.mock.calls.find(call => call[1].model === 'whistle')?.[1]).toMatchObject({ language: 'en', keywords: ['Coke'], vad: false })
  })
  it('supports single runs and rejects duplicate selections', async () => {
    const recognize = vi.fn(async (_path, options) => run(options.model))
    expect(await runSelectedModels(source, ['shruti'], settings, [], new AbortController().signal, recognize, () => {}, () => {})).toHaveLength(1)
    await expect(runSelectedModels(source, ['shruti', 'shruti'], settings, [], new AbortController().signal, recognize, () => {}, () => {})).rejects.toThrow('different models')
    expect(recognize).toHaveBeenCalledOnce()
  })
  it('cancels before the second model and keeps the first completed result', async () => {
    const abort = new AbortController(), results: TranscriptResult[] = [], recognize = vi.fn(async () => run('shruti'))
    await expect(runSelectedModels(source, ['shruti', 'shunya-int8'], settings, [], abort.signal, recognize, result => { results.push(result); abort.abort() }, () => {})).rejects.toMatchObject({ name: 'AbortError' })
    expect(recognize).toHaveBeenCalledOnce(); expect(results).toHaveLength(1)
  })
  it('propagates model errors and rejects changed audio without appending a bad comparison', async () => {
    const ready = vi.fn(), recognize = vi.fn().mockResolvedValueOnce(run('shruti')).mockRejectedValueOnce(new Error('Tiny failed'))
    await expect(runSelectedModels(source, ['shruti', 'shunya-int8'], settings, [], new AbortController().signal, recognize, ready, () => {})).rejects.toThrow('Tiny failed')
    expect(ready).toHaveBeenCalledOnce()
    await expect(runSelectedModels(source, ['shruti', 'shunya-int8'], settings, [], new AbortController().signal, vi.fn().mockResolvedValue({ ...run('shruti'), source: { ...source, audioSha256: 'changed' } }), () => {}, () => {})).rejects.toThrow('Prepared audio changed')
  })
})


describe('Run requirements', () => {
  it('explains a missing runtime even when Shunya weights are downloaded', () => {
    const srota = { id: 'shunya-int8', installed: true, runtimeInstalled: false } as import('../types').ModelStatus
    expect(missingModelRequirements(['shunya-int8'], [srota])).toEqual([{ id: 'shunya-int8', requirement: 'runtime' }])
    expect(missingModelRequirements(['shunya-int8'], [{ ...srota, runtimeInstalled: true }])).toEqual([])
  })
  it('checks both selected models without requiring an optional runtime for Shruti', () => {
    const shruti = { id: 'shruti', installed: true } as import('../types').ModelStatus
    expect(missingModelRequirements(['shruti', 'shunya-int8'], [shruti])).toEqual([{ id: 'shunya-int8', requirement: 'download' }])
  })
})


it('runs the three CPU profiles serially and preserves each completed result', async () => {
  const results: TranscriptResult[] = []
  const recognize = vi.fn(async (_path, options) => {
    expect(results).toHaveLength(recognize.mock.calls.length - 1)
    if (options.model === 'shunya-int8') expect(options).toMatchObject({ device: 'cpu', language: 'auto', vad: false })
    return run(options.model)
  })
  await runSelectedModels(source, ['shruti', 'whistle', 'shunya-int8'], settings, [], new AbortController().signal, recognize, result => results.push(result), () => {})
  expect(results.map(r => r.model)).toEqual(['shruti', 'whistle', 'shunya-int8'])
  expect(recognize.mock.calls[1][1].language).toBe('en')
  expect(recognize.mock.calls[2][1].wordTimestamps).toBe(true)
})


it('rejects removed models before inference', async () => {
  const recognize = vi.fn()
  for (const model of ['small', 'large-v3-turbo', 'tiny-hinglish', 'srota', 'srota-cpu', 'shunya', 'shruti-needle-3210', 'shruti-fp32', 'tara', 'tara-int8', 'tara-int8-speech-aware'] as ModelId[]) {
    await expect(runSelectedModels(source, [model], settings, [], new AbortController().signal, recognize, () => {}, () => {})).rejects.toThrow('removed')
  }
  expect(recognize).not.toHaveBeenCalled()
})


it('runs the single canonical Shruti configuration with the existing caption settings', async () => {
  const recognize = vi.fn(async (_path, options) => run(options.model))
  const results = await runSelectedModels(source, ['shruti'], settings, ['Coke'], new AbortController().signal, recognize, () => {}, () => {})
  expect(results.map(result => result.model)).toEqual(['shruti'])
  expect(recognize.mock.calls[0][1]).toEqual({...settings, model:'shruti', language:'auto', device:'auto', vad:false, keywords:['Coke']})
})
it('rejects more than three selections before calling a worker', async () => {
  const recognize = vi.fn()
  await expect(runSelectedModels(source, ['shruti', 'shruti-needle-3210', 'shruti-fp32', 'whistle'], settings, [], new AbortController().signal, recognize, () => {}, () => {})).rejects.toThrow('up to three')
  expect(recognize).not.toHaveBeenCalled()
})


it('runs Tara with Shruti in sequence on the same audio, with its own accuracy settings', async () => {
  const received: TranscriptResult[] = []
  const recognize = vi.fn(async (_path, options) => {
    expect(received).toHaveLength(recognize.mock.calls.length - 1)
    return run(options.model)
  })
  await runSelectedModels(source, ['shruti', 'tara-int8-speech-aware-parallel'], settings, ['Coke'], new AbortController().signal,
    recognize, result => received.push(result), () => {})
  expect(received.map(r => r.model)).toEqual(['shruti', 'tara-int8-speech-aware-parallel'])
  expect(recognize.mock.calls[1][1]).toMatchObject({ device: 'cpu', language: 'hi', vad: false, wordTimestamps: true })
  expect(recognize.mock.calls[1][1].keywords).toBeUndefined()
})


it('runs the only Tara profile with speech-aware alignment', async () => {
  const recognize = vi.fn(async (_path, options) => run(options.model))
  await runSelectedModels(source, ['tara-int8-speech-aware-parallel'], settings, [], new AbortController().signal, recognize, () => {}, () => {})
  expect(recognize.mock.calls[0][1]).toMatchObject({ model:'tara-int8-speech-aware-parallel', taraChunking:'speech-aware', wordTimestamps:true, device:'cpu' })
})
