import { beforeEach, describe, expect, it, vi } from 'vitest'
const bridge = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), callback: null as null | ((event: { payload: Record<string, unknown> }) => void), unlisten: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: bridge.invoke, isTauri: () => true }))
vi.mock('@tauri-apps/api/event', () => ({ listen: bridge.listen }))
import { autoCaptionsService } from './autoCaptions'

beforeEach(() => { vi.clearAllMocks(); bridge.invoke.mockResolvedValue(undefined); bridge.listen.mockImplementation(async (_name, callback) => { bridge.callback = callback; return bridge.unlisten }) })
const starts = () => bridge.invoke.mock.calls.filter(call => call[0] === 'auto_captions_start')
function finish(type: string, data: unknown) { bridge.callback?.({ payload: { jobId: starts().at(-1)![1].jobId, type, data } }) }

describe('Project caption job bridge', () => {
  it.each([false,true])('checks and installs the selected caption engine (quick=%s)', async quickMode => {
    const abort=new AbortController()
    const status=autoCaptionsService.status(abort.signal,quickMode)
    await vi.waitFor(() => expect(starts()).toHaveLength(1))
    expect(starts()[0][1].request).toEqual({action:'caption_status',quickMode})
    finish('result',{installed:false});await status
    const install=autoCaptionsService.install(() => {},abort.signal,quickMode)
    await vi.waitFor(() => expect(starts()).toHaveLength(2))
    expect(starts()[1][1].request).toEqual({action:'download',model:quickMode?'shruti':'tara-int8'})
    finish('result',[]);await install
  })
  it('uses the caption allowlist and sends one project audio plan without an output language', async () => {
    const plan = { projectId: 'active-project', duration: 3, clips: [] }
    const promise = autoCaptionsService.generate(plan, () => {}, new AbortController().signal)
    await vi.waitFor(() => expect(starts()).toHaveLength(1))
    expect(starts()[0][1].request).toEqual({ action: 'auto_captions', plan, quickMode: false })
    finish('result', { model: 'shruti', text: 'Coke का can है।', words: [] })
    expect((await promise).text).toBe('Coke का can है।')
    expect(bridge.invoke.mock.calls.some(call => call[0] === 'speech_lab_start')).toBe(false)
  })
  it('cancels through the same owned job lifecycle and keeps the queue usable', async () => {
    const abort = new AbortController()
    const promise = autoCaptionsService.generate({ projectId: 'project', clips: [], duration: 2 }, () => {}, abort.signal)
    const expected = expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(starts()).toHaveLength(1))
    abort.abort()
    await vi.waitFor(() => expect(bridge.invoke.mock.calls.some(call => call[0] === 'auto_captions_cancel')).toBe(true))
    finish('cancelled', {})
    await expected
    const next = autoCaptionsService.status(new AbortController().signal)
    await vi.waitFor(() => expect(starts()).toHaveLength(2))
    finish('result', { id: 'shruti', installed: true })
    expect((await next).installed).toBe(true)
  })
  it('selects Shruti only with explicit Quick mode', async () => {
    const plan = { projectId: 'project', duration: 3, clips: [] }
    const promise = autoCaptionsService.generate(plan, () => {}, new AbortController().signal, true)
    await vi.waitFor(() => expect(starts()).toHaveLength(1))
    expect(starts()[0][1].request).toEqual({ action: 'auto_captions', plan, quickMode: true })
    finish('result', { text: 'Coke', words: [] })
    await promise
  })
})
