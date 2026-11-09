/**
 * Keep the app at its normal page scale while allowing custom canvas zoom.
 * Tauri's zoomHotkeysEnabled must stay enabled: on Windows, disabling it
 * also disables WebView2's trackpad pinch input before JS receives it.
 */
export function installBrowserZoomGuard(target: Window): () => void {
  const onWheel = (event: WheelEvent) => {
    if (event.ctrlKey || event.metaKey) event.preventDefault()
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && ['+', '=', '-', '0'].includes(event.key)) {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
  }
  // Tauri's macOS/Linux zoom polyfill uses the legacy mousewheel event.
  const onMouseWheel = (event: WheelEvent) => {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
  }

  target.addEventListener('wheel', onWheel, { passive: false, capture: true })
  target.addEventListener('mousewheel', onMouseWheel as EventListener, { passive: false, capture: true })
  target.addEventListener('keydown', onKeyDown, true)
  return () => {
    target.removeEventListener('wheel', onWheel, { capture: true })
    target.removeEventListener('mousewheel', onMouseWheel as EventListener, { capture: true })
    target.removeEventListener('keydown', onKeyDown, { capture: true })
  }
}
