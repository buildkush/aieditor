import { expect, it, vi } from 'vitest'
import { fixture } from './nativeFixture'
import { missingModelRequirements, replaceModelResult, runSelectedModels } from './modelComparison'
import type { TranscriptionOptions } from '../types'
const options: TranscriptionOptions = { model: 'tara', language: 'hi', device: 'auto', vad: false, vadSilenceMs: 0 }
it('uses selected native models and preserves acceleration preference', async () => {
 const recognize = vi.fn().mockImplementation(async (_path, settings) => ({ ...fixture, model: settings.model }))
 const runs = await runSelectedModels(fixture.source, ['tara', 'shruti'], options, new AbortController().signal, recognize, () => {}, () => {})
 expect(runs.map(r => r.model)).toEqual(['tara', 'shruti'])
 expect(recognize.mock.calls[0][1]).toMatchObject({ device: 'auto', wordTimestamps: true, vad: false })
 expect(missingModelRequirements(['tara-q5_0'], [])).toEqual([{ id: 'tara-q5_0', requirement: 'download' }])
})
it('rejects mismatched prepared audio and duplicate selection', async () => {
 await expect(runSelectedModels(fixture.source, ['tara', 'tara'], options, new AbortController().signal, vi.fn(), () => {}, () => {})).rejects.toThrow('Select native')
 await expect(runSelectedModels(fixture.source, ['tara'], options, new AbortController().signal, vi.fn().mockResolvedValue({ ...fixture, source: { ...fixture.source, audioSha256: 'other' } }), () => {}, () => {})).rejects.toThrow('Prepared audio changed')
})
it('retry replaces the same model result and retains other models', () => {
 const shruti = { ...fixture, id: 'shruti', model: 'shruti' as const }
 const first = { ...fixture, id: 'first' }, retry = { ...fixture, id: 'retry' }
 const results = replaceModelResult([shruti, first, { ...first, id: 'duplicate' }], retry)
 expect(results.map(result => result.id)).toEqual(['shruti', 'retry'])
 expect(replaceModelResult(results, { ...retry, id: 'third' }).filter(result => result.model === 'tara')).toHaveLength(1)
})
it('retains successful results and continues with Q5 after a Q8 failure', async () => {
 const recognize = vi.fn().mockImplementation(async (_path, settings) => {
  if (settings.model === 'tara') throw new Error('fixture Q8 failure')
  return { ...fixture, id: settings.model, model: settings.model }
 })
 const failed = vi.fn(), received = vi.fn()
 const runs = await runSelectedModels(fixture.source, ['shruti', 'tara', 'tara-q5_0'], options, new AbortController().signal, recognize, received, () => {}, failed)
 expect(runs.map(result => result.model)).toEqual(['shruti', 'tara-q5_0'])
 expect(failed).toHaveBeenCalledWith('tara', expect.any(Error), expect.any(Number))
 expect(received).toHaveBeenCalledTimes(2)
})
it('does not continue a cancelled batch or present cancellation as a model failure', async () => {
 const controller = new AbortController(), failed = vi.fn()
 const recognize = vi.fn().mockImplementation(async () => { controller.abort(); throw new DOMException('Cancelled', 'AbortError') })
 await expect(runSelectedModels(fixture.source, ['shruti', 'tara'], options, controller.signal, recognize, () => {}, () => {}, failed)).rejects.toMatchObject({ name: 'AbortError' })
 expect(recognize).toHaveBeenCalledTimes(1)
 expect(failed).not.toHaveBeenCalled()
})
