/**
 * Simple ID generation for editor entities.
 * Uses a combination of prefix and crypto.randomUUID() for uniqueness.
 */
export function generateId(prefix = 'id'): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`
  }
  // Fallback for environments without crypto.randomUUID
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Safely parses any hex, rgb, or rgba color string and returns an rgba string with specified opacity.
 */
export function colorWithOpacity(color: string, opacity = 1): string {
  if (!color) return `rgba(0, 0, 0, ${opacity})`
  const clampedOpacity = Math.max(0, Math.min(1, opacity))
  const trimmed = color.trim()

  // Hex format (#rgb or #rrggbb or #rrggbbaa)
  if (trimmed.startsWith('#')) {
    let hex = trimmed.slice(1)
    if (hex.length === 3) {
      hex = hex.split('').map((c) => c + c).join('')
    }
    if (hex.length === 6 || hex.length === 8) {
      const r = parseInt(hex.slice(0, 2), 16) || 0
      const g = parseInt(hex.slice(2, 4), 16) || 0
      const b = parseInt(hex.slice(4, 6), 16) || 0
      return `rgba(${r}, ${g}, ${b}, ${clampedOpacity})`
    }
  }

  // rgb format: rgb(r, g, b)
  if (trimmed.startsWith('rgb(')) {
    const parts = trimmed.slice(4, -1).split(',').map((p) => p.trim())
    if (parts.length >= 3) {
      return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${clampedOpacity})`
    }
  }

  // rgba format: rgba(r, g, b, a)
  if (trimmed.startsWith('rgba(')) {
    const parts = trimmed.slice(5, -1).split(',').map((p) => p.trim())
    if (parts.length >= 3) {
      return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${clampedOpacity})`
    }
  }

  return trimmed
}

/**
 * Calculates display dimensions for a media asset (video, image) fitted inside a project frame
 * while preserving the asset's original aspect ratio.
 */
export function getMediaFittedDimensions(
  rawW: number,
  rawH: number,
  projectWidth: number,
  projectHeight: number
): { width: number; height: number } {
  if (!rawW || !rawH || !projectWidth || !projectHeight) {
    return { width: projectWidth || 1920, height: projectHeight || 1080 }
  }
  const assetAspect = rawW / rawH
  const projectAspect = projectWidth / projectHeight

  if (Math.abs(assetAspect - projectAspect) < 0.02) {
    return { width: projectWidth, height: projectHeight }
  } else if (assetAspect > projectAspect) {
    return { width: projectWidth, height: Math.round(projectWidth / assetAspect) }
  } else {
    return { width: Math.round(projectHeight * assetAspect), height: projectHeight }
  }
}

