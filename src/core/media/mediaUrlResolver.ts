import { convertFileSrc } from '@tauri-apps/api/core'

/**
 * Resolves a local media file path or URI to a valid URL that the webview can play.
 * Supports:
 * - Real local paths in Tauri (via asset protocol: http://asset.localhost/...)
 * - Blob / Object URLs (blob:http://...)
 * - Remote / Data URLs (http://, https://, data:)
 */
export function resolveMediaUrl(path: string): string {
  if (!path) return ''

  // Already a web-compatible URL
  if (
    path.startsWith('blob:') ||
    path.startsWith('http://') ||
    path.startsWith('https://') ||
    path.startsWith('data:')
  ) {
    return path
  }

  // Running inside Tauri webview
  try {
    if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
      return convertFileSrc(path)
    }
  } catch (err) {
    console.warn('convertFileSrc failed for path:', path, err)
  }

  // Fallback for custom asset protocol or dev
  const normalized = path.replace(/\\/g, '/')
  return `http://asset.localhost/${encodeURI(normalized)}`
}
