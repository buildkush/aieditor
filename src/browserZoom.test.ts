import { describe, expect, it } from 'vitest'
import { installBrowserZoomGuard } from './browserZoom'
import config from '../src-tauri/tauri.conf.json'

function input(type: string, props: object) {
  return Object.assign(new Event(type, { cancelable: true }), props)
}

describe('native pinch input and page zoom', () => {
  it('keeps WebView2 pinch delivery enabled in the desktop configuration', () => {
    expect(config.app.windows.find((window) => window.label === 'main')?.zoomHotkeysEnabled).toBe(true)
  })

  it('cancels browser pinch zoom while allowing the canvas to receive the wheel event', () => {
    const target = new EventTarget()
    const remove = installBrowserZoomGuard(target as unknown as Window)
    let delivered = false
    target.addEventListener('wheel', () => { delivered = true })
    const event = input('wheel', { ctrlKey: true })
    target.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(delivered).toBe(true)
    remove()
    const afterCleanup = input('wheel', { ctrlKey: true })
    target.dispatchEvent(afterCleanup)
    expect(afterCleanup.defaultPrevented).toBe(false)
  })

  it.each(['+', '=', '-', '0'])('blocks page zoom shortcut Ctrl+%s', (key) => {
    const target = new EventTarget()
    installBrowserZoomGuard(target as unknown as Window)
    const event = input('keydown', { ctrlKey: true, key })
    target.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })

  it('preserves normal scrolling and editor shortcuts', () => {
    const target = new EventTarget()
    installBrowserZoomGuard(target as unknown as Window)
    for (const event of [input('wheel', {}), input('keydown', { ctrlKey: true, key: 's' })]) {
      target.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(false)
    }
  })
})
