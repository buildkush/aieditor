import { describe, expect, it } from 'vitest'
import { createPreviewWheelHandler } from './previewWheel'

function wheel(overrides: Partial<WheelEvent> = {}): WheelEvent {
  return Object.assign(new Event('wheel', { cancelable: true }), {
    deltaX: 0, deltaY: 0, deltaMode: 0,
    clientX: 600, clientY: 350,
    ctrlKey: false, metaKey: false, altKey: false,
  }, overrides) as WheelEvent
}

function setup(zoom = 1, pan = { x: 0, y: 0 }) {
  let viewport = { zoom, pan }
  const onWheel = createPreviewWheelHandler(
    () => viewport,
    (next) => { viewport = next },
    () => ({ left: 100, top: 50, width: 1000, height: 600 }),
  )
  const stage = new EventTarget()
  stage.addEventListener('wheel', onWheel as EventListener, { passive: false })
  return { send: (event: WheelEvent) => stage.dispatchEvent(event), get: () => viewport }
}

describe('preview trackpad navigation', () => {
  it('pinches in and out through cancelable Ctrl-wheel events', () => {
    const viewport = setup()
    const pinchOut = wheel({ ctrlKey: true, deltaY: -12 })
    viewport.send(pinchOut)
    expect(pinchOut.defaultPrevented).toBe(true)
    expect(viewport.get().zoom).toBeGreaterThan(1)
    viewport.send(wheel({ ctrlKey: true, deltaY: 12 }))
    expect(viewport.get().zoom).toBeCloseTo(1)
    expect(viewport.get().pan).toEqual({ x: 0, y: 0 })
  })

  it('accumulates small events delivered before a React render', () => {
    const viewport = setup()
    for (let i = 0; i < 100; i++) {
      viewport.send(wheel({ ctrlKey: true, deltaY: -0.01 }))
    }
    expect(viewport.get().zoom).toBeCloseTo(Math.exp(0.008), 10)
  })

  it('keeps the point under the cursor fixed, including when already panned', () => {
    const viewport = setup(2, { x: 25.5, y: -12.25 })
    // Cursor is (150, -75) relative to the stage center.
    const before = { x: (150 - 25.5) / 2, y: (-75 + 12.25) / 2 }
    viewport.send(wheel({ ctrlKey: true, deltaY: -4.5, clientX: 750, clientY: 275 }))
    const { zoom, pan } = viewport.get()
    expect((150 - pan.x) / zoom).toBeCloseTo(before.x, 10)
    expect((-75 - pan.y) / zoom).toBeCloseTo(before.y, 10)
  })

  it('pans with fractional two-finger swipes without zooming', () => {
    const viewport = setup(1.5)
    for (let i = 0; i < 10; i++) viewport.send(wheel({ deltaX: 0.2, deltaY: -0.3 }))
    expect(viewport.get().zoom).toBe(1.5)
    expect(viewport.get().pan.x).toBeCloseTo(-2)
    expect(viewport.get().pan.y).toBeCloseTo(3)
  })

  it.each([1, 2])('normalizes wheel delta mode %i', (deltaMode) => {
    const viewport = setup()
    viewport.send(wheel({ deltaX: 1, deltaY: -1, deltaMode }))
    const unit = deltaMode === 1 ? 16 : 200
    expect(viewport.get().pan).toEqual({ x: -unit, y: unit })
  })

  it.each(['ctrlKey', 'metaKey', 'altKey'])('supports %s wheel zoom', (modifier) => {
    const viewport = setup()
    viewport.send(wheel({ [modifier]: true, deltaY: -100 }))
    expect(viewport.get().zoom).toBeGreaterThan(1)
  })

  it('clamps zoom without moving the canvas further at its limit', () => {
    for (const [zoom, deltaY] of [[10, -100], [0.1, 100]]) {
      const viewport = setup(zoom, { x: 12.5, y: -25 })
      viewport.send(wheel({ ctrlKey: true, deltaY, clientX: 750 }))
      expect(viewport.get()).toEqual({ zoom, pan: { x: 12.5, y: -25 } })
    }
  })
})
