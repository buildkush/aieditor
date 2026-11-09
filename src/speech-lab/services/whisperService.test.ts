import { beforeEach, describe, expect, it, vi } from 'vitest'

const bridge = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), unlisten: vi.fn(), callback: null as null | ((event: { payload: Record<string, unknown> }) => void) }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: bridge.invoke, isTauri: () => true }))
vi.mock('@tauri-apps/api/event', () => ({ listen: bridge.listen }))
import { runWorker, speechService } from './whisperService'

beforeEach(() => {
  vi.clearAllMocks()
  bridge.listen.mockImplementation(async (_event, callback) => { bridge.callback = callback; return bridge.unlisten })
  bridge.invoke.mockResolvedValue(undefined)
})
const startCalls = () => bridge.invoke.mock.calls.filter(call => call[0] === 'speech_lab_start')
const terminal = (type: string, data: unknown) => {
  const { jobId } = startCalls().at(-1)![1]
  bridge.callback?.({ payload: { jobId, type, data } })
}

describe('Speech Lab process bridge', () => {
  it('subscribes before spawning and delivers real protocol progress/results', async () => {
    const progress = vi.fn()
    const promise = runWorker<{ text: string }>({ action: 'transcribe' }, progress)
    await vi.waitFor(() => expect(startCalls()).toHaveLength(1))
    expect(bridge.listen.mock.invocationCallOrder[0]).toBeLessThan(bridge.invoke.mock.invocationCallOrder[0])
    terminal('progress', { stage: 'loading', message: 'Loading model' })
    expect(progress).toHaveBeenCalledWith({ stage: 'loading', message: 'Loading model' })
    terminal('result', { text: 'protocol fixture' })
    expect(await promise).toEqual({ text: 'protocol fixture' })
    expect(bridge.unlisten).toHaveBeenCalledOnce()
  })
  it('serializes operations so model deletion and inference cannot race', async () => {
    const first = runWorker({ action: 'transcribe' })
    const second = runWorker({ action: 'remove', model: 'small' })
    await vi.waitFor(() => expect(startCalls()).toHaveLength(1))
    terminal('result', 'first')
    await first
    await vi.waitFor(() => expect(startCalls()).toHaveLength(2))
    terminal('result', 'second')
    expect(await second).toBe('second')
  })
  it.each(['small', 'whistle'])('kills only the matching %s job when aborted and keeps the queue reusable', async model => {
    const abort = new AbortController()
    const promise = runWorker({ action: 'download', model }, undefined, abort.signal)
    const expected = expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(startCalls()).toHaveLength(1))
    abort.abort()
    await vi.waitFor(() => expect(bridge.invoke.mock.calls.some(call => call[0] === 'speech_lab_cancel')).toBe(true))
    expect(bridge.invoke.mock.calls.find(call => call[0] === 'speech_lab_cancel')![1].jobId).toBe(startCalls()[0][1].jobId)
    terminal('cancelled', { message: 'Cancelled' })
    await expected
    const next = runWorker({ action: 'catalog' })
    await vi.waitFor(() => expect(startCalls()).toHaveLength(2))
    terminal('result', [])
    expect(await next).toEqual([])
  })
  it('surfaces worker failures and releases the listener', async () => {
    const promise = runWorker({ action: 'transcribe' })
    const expected = expect(promise).rejects.toThrow('Insufficient memory')
    await vi.waitFor(() => expect(startCalls()).toHaveLength(1))
    terminal('error', { message: 'Insufficient memory' })
    await expected
    expect(bridge.unlisten).toHaveBeenCalledOnce()
  })
  it('imports dropped media in bounded chunks before returning the prepared source path', async () => {
    bridge.invoke.mockImplementation(async (command, args) => {
      expect(command).toBe('speech_lab_import_chunk')
      expect(args.bytes.length).toBeLessThanOrEqual(262144)
      return { uploadId: '123', path: args.done ? 'cache/123.wav' : null }
    })
    const data = new Uint8Array(600000).fill(13)
    const progress = vi.fn()
    const file = new File([data], 'recording.wav')
    const path = await speechService.importFile(file, progress, new AbortController().signal)
    expect(path).toBe('cache/123.wav')
    expect(bridge.invoke).toHaveBeenCalledTimes(3)
    expect(bridge.invoke.mock.calls[0][1].uploadId).toBeNull()
    expect(bridge.invoke.mock.calls[1][1].uploadId).toBe('123')
    expect(bridge.invoke.mock.calls[2][1].done).toBe(true)
    expect(progress.mock.lastCall?.[0].completed).toBe(600000)
  })
  it('uses the same job bridge for Shruti keywords, progress, native responses and errors', async () => {
    const progress = vi.fn()
    const request = speechService.transcribe('prepared-source.mp4', { model: 'shruti', language: 'auto', device: 'auto', vad: false, vadSilenceMs: 500, keywords: ['My Name', 'new product'] }, progress, new AbortController().signal)
    await vi.waitFor(() => expect(startCalls()).toHaveLength(1))
    expect(startCalls()[0][1].request).toMatchObject({ action: 'transcribe', model: 'shruti', language: 'auto', keywords: ['My Name', 'new product'] })
    terminal('progress', { stage: 'transcribing', message: 'Shruti' })
    expect(progress).toHaveBeenCalledWith({ stage: 'transcribing', message: 'Shruti' })
    const fixture = { text: ' मेरा order है ', model: 'shruti', rawResponse: { text: ' मेरा order है ' }, words: [] }
    terminal('result', fixture)
    expect(await request).toEqual(fixture)
    const next = runWorker({ action: 'transcribe', model: 'shruti' })
    const expected = expect(next).rejects.toThrow('Shruti engine failed')
    await vi.waitFor(() => expect(startCalls()).toHaveLength(2))
    terminal('error', { message: 'Shruti engine failed' })
    await expected
  })
})
