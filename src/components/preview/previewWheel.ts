interface PreviewViewport {
  zoom: number
  pan: { x: number; y: number }
}

/** View navigation only; clip transforms remain in ProjectState. */
export function createPreviewWheelHandler(
  getViewport: () => PreviewViewport,
  updateViewport: (viewport: PreviewViewport) => void,
  getBounds: () => Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
): (event: WheelEvent) => void {
  return (event) => {
    event.preventDefault()
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 200 : 1
    const dx = event.deltaX * unit
    const dy = event.deltaY * unit
    const { zoom, pan } = getViewport()

    // Chromium reports a trackpad pinch as a wheel event with ctrlKey=true.
    // Trackpad contacts are not exposed as touch/pointer events.
    if (event.ctrlKey || event.metaKey || event.altKey) {
      const delta = Math.max(-40, Math.min(40, dy))
      const nextZoom = Math.min(10, Math.max(0.1, zoom * Math.exp(-delta * 0.008)))
      const rect = getBounds()
      const x = event.clientX - (rect.left + rect.width / 2)
      const y = event.clientY - (rect.top + rect.height / 2)
      const ratio = nextZoom / zoom
      updateViewport({
        zoom: nextZoom,
        // Preserve fractional offsets so small pinch deltas don't drift.
        pan: { x: x - (x - pan.x) * ratio, y: y - (y - pan.y) * ratio },
      })
      return
    }

    // A two-finger swipe pans; it must not change the canvas zoom.
    updateViewport({ zoom, pan: { x: pan.x - dx, y: pan.y - dy } })
  }
}
