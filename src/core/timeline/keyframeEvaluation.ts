import type { TimelineItem, Transform, Crop, AudioProperties } from './types'
import { DEFAULT_TRANSFORM, DEFAULT_CROP, DEFAULT_AUDIO_PROPERTIES } from './types'
import type { Keyframe, KeyframeInterpolation } from './keyframeTypes'

export function normalizePropertyKey(property: string): string {
  const lower = property.toLowerCase().replace(/[-_]/g, '')
  switch (lower) {
    case 'positionx':
    case 'posx':
    case 'x':
      return 'x'
    case 'positiony':
    case 'posy':
    case 'y':
      return 'y'
    case 'zoom':
    case 'scale':
      return 'scale'
    case 'zoomx':
    case 'scalex':
      return 'scaleX'
    case 'zoomy':
    case 'scaley':
      return 'scaleY'
    case 'rot':
    case 'rotation':
      return 'rotation'
    case 'opacity':
      return 'opacity'
    case 'cropleft':
    case 'left':
      return 'cropLeft'
    case 'cropright':
    case 'right':
      return 'cropRight'
    case 'croptop':
    case 'top':
      return 'cropTop'
    case 'cropbottom':
    case 'bottom':
      return 'cropBottom'
    case 'anchorx':
      return 'anchorX'
    case 'anchory':
      return 'anchorY'
    case 'pitch':
      return 'pitch'
    case 'yaw':
      return 'yaw'
    case 'volume':
      return 'volume'
    case 'pan':
      return 'pan'
    case 'speed':
      return 'speed'
    case 'fontsize':
    case 'size':
      return 'fontSize'
    case 'strokewidth':
    case 'stroke':
      return 'strokeWidth'
    case 'padding':
      return 'padding'
    case 'backgroundopacity':
    case 'bgopacity':
      return 'backgroundOpacity'
    case 'letterspacing':
    case 'tracking':
      return 'letterSpacing'
    case 'lineheight':
    case 'linespacing':
      return 'lineHeight'
    case 'shadowblur':
      return 'shadowBlur'
    case 'shadowoffsetx':
      return 'shadowOffsetX'
    case 'shadowoffsety':
      return 'shadowOffsetY'
    case 'shadowopacity':
      return 'shadowOpacity'
    case 'bgstrokewidth':
      return 'bgStrokeWidth'
    case 'cornerradius':
    case 'radius':
      return 'cornerRadius'
    case 'paddingx':
      return 'paddingX'
    case 'paddingy':
      return 'paddingY'
    case 'bgoffsetx':
      return 'bgOffsetX'
    case 'bgoffsety':
      return 'bgOffsetY'
    default:
      return property
  }
}

/**
 * Pure interpolation calculation given normalized time t in [0, 1].
 */
export function interpolateProgress(t: number, mode: KeyframeInterpolation = 'linear'): number {
  const clampedT = Math.max(0, Math.min(1, t))
  switch (mode) {
    case 'linear':
      return clampedT
    case 'ease-in':
      return clampedT * clampedT
    case 'ease-out':
      return 1 - (1 - clampedT) * (1 - clampedT)
    case 'ease-in-out':
      return clampedT < 0.5
        ? 2 * clampedT * clampedT
        : 1 - Math.pow(-2 * clampedT + 2, 2) / 2
    case 'hold':
      return 0
    default:
      return clampedT
  }
}

/**
 * Pure deterministic evaluation of a single keyframe track.
 * Follows the permanent rules:
 * - Before first keyframe: returns first keyframe value
 * - After last keyframe: returns last keyframe value
 * - At exact keyframe: returns exact keyframe value
 * - Between keyframes: interpolates according to starting keyframe's easing mode
 */
export function evaluateKeyframeTrack(
  keyframes: Keyframe<number>[] | undefined,
  playheadTime: number,
  defaultValue: number
): number {
  if (!keyframes || keyframes.length === 0) {
    return defaultValue
  }

  if (keyframes.length === 1) {
    return keyframes[0].value
  }

  // Sort ascending by time
  const sorted = [...keyframes].sort((a, b) => a.time - b.time)

  const first = sorted[0]
  const last = sorted[sorted.length - 1]

  // Before first keyframe
  if (playheadTime <= first.time + 0.001) {
    return first.value
  }

  // After last keyframe
  if (playheadTime >= last.time - 0.001) {
    return last.value
  }

  // Find surrounding segment
  for (let i = 0; i < sorted.length - 1; i++) {
    const k1 = sorted[i]
    const k2 = sorted[i + 1]

    if (Math.abs(playheadTime - k1.time) <= 0.001) {
      return k1.value
    }
    if (Math.abs(playheadTime - k2.time) <= 0.001) {
      return k2.value
    }

    if (playheadTime > k1.time && playheadTime < k2.time) {
      const dt = k2.time - k1.time
      if (dt <= 0) return k1.value
      const rawT = (playheadTime - k1.time) / dt
      const progress = interpolateProgress(rawT, k1.interpolation ?? 'linear')
      const val = k1.value + (k2.value - k1.value) * progress
      return Math.round(val * 10000) / 10000
    }
  }

  return last.value
}

/**
 * Evaluates a single named property on a timeline item at a given playhead time.
 */
export function evaluateItemProperty(
  item: TimelineItem,
  property: string,
  playheadTime: number
): number {
  const normKey = normalizePropertyKey(property)

  // Determine static default value from item
  let defaultValue = 0
  const transform = item.transform ?? DEFAULT_TRANSFORM
  const crop = item.crop ?? DEFAULT_CROP
  const audio = item.audio ?? DEFAULT_AUDIO_PROPERTIES

  switch (normKey) {
    case 'x':
      defaultValue = transform.x
      break
    case 'y':
      defaultValue = transform.y
      break
    case 'scale':
      defaultValue = transform.scale
      break
    case 'scaleX':
      defaultValue = transform.scaleX !== undefined ? transform.scaleX : transform.scale
      break
    case 'scaleY':
      defaultValue = transform.scaleY !== undefined ? transform.scaleY : transform.scale
      break
    case 'rotation':
      defaultValue = transform.rotation
      break
    case 'opacity':
      defaultValue = transform.opacity
      break
    case 'anchorX':
      defaultValue = transform.anchorX ?? 0
      break
    case 'anchorY':
      defaultValue = transform.anchorY ?? 0
      break
    case 'pitch':
      defaultValue = transform.pitch ?? 0
      break
    case 'yaw':
      defaultValue = transform.yaw ?? 0
      break
    case 'cropLeft':
      defaultValue = crop.left
      break
    case 'cropRight':
      defaultValue = crop.right
      break
    case 'cropTop':
      defaultValue = crop.top
      break
    case 'cropBottom':
      defaultValue = crop.bottom
      break
    case 'volume':
      defaultValue = audio.volume
      break
    case 'pan':
      defaultValue = audio.pan
      break
    case 'speed':
      defaultValue = item.speed?.speed ?? 1
      break
    case 'fontSize':
      defaultValue = item.text?.fontSize ?? item.caption?.style?.fontSize ?? 64
      break
    case 'strokeWidth':
      defaultValue = item.text?.strokeWidth ?? item.caption?.style?.strokeWidth ?? 0
      break
    case 'padding':
      defaultValue = item.text?.padding ?? item.caption?.style?.padding ?? 12
      break
    case 'backgroundOpacity':
      defaultValue = item.text?.backgroundOpacity ?? item.caption?.style?.backgroundOpacity ?? 0
      break
    default:
      defaultValue = 0
  }

  if (!item.keyframes) {
    return defaultValue
  }

  // Look for keyframes under normalized key or original key
  let kfs = item.keyframes[normKey] || item.keyframes[property]

  // If checking scaleX or scaleY and no specific keyframes, fall back to scale keyframes
  if ((!kfs || kfs.length === 0) && (normKey === 'scaleX' || normKey === 'scaleY')) {
    kfs = item.keyframes['scale'] || item.keyframes['zoom']
  }

  // Also check crop aliases if needed
  if ((!kfs || kfs.length === 0) && normKey.startsWith('crop')) {
    const raw = normKey.replace('crop', '').toLowerCase()
    kfs = item.keyframes[`crop_${raw}`] || item.keyframes[raw]
  }

  return evaluateKeyframeTrack(kfs, playheadTime, defaultValue)
}

/**
 * Evaluates the full Transform for an item at the given playhead time.
 */
export function evaluateItemTransform(item: TimelineItem, playheadTime: number): Transform {
  const base = item.transform ?? DEFAULT_TRANSFORM

  const hasScaleXKf = item.keyframes?.['scaleX']?.length || item.keyframes?.['zoomX']?.length
  const hasScaleYKf = item.keyframes?.['scaleY']?.length || item.keyframes?.['zoomY']?.length
  const evaluatedScale = evaluateItemProperty(item, 'scale', playheadTime)

  const scaleX = hasScaleXKf
    ? evaluateItemProperty(item, 'scaleX', playheadTime)
    : base.scaleX !== undefined
      ? evaluateItemProperty(item, 'scaleX', playheadTime)
      : evaluatedScale

  const scaleY = hasScaleYKf
    ? evaluateItemProperty(item, 'scaleY', playheadTime)
    : base.scaleY !== undefined
      ? evaluateItemProperty(item, 'scaleY', playheadTime)
      : evaluatedScale

  return {
    x: evaluateItemProperty(item, 'x', playheadTime),
    y: evaluateItemProperty(item, 'y', playheadTime),
    scale: evaluatedScale,
    scaleX,
    scaleY,
    rotation: evaluateItemProperty(item, 'rotation', playheadTime),
    opacity: evaluateItemProperty(item, 'opacity', playheadTime),
    anchorX: evaluateItemProperty(item, 'anchorX', playheadTime),
    anchorY: evaluateItemProperty(item, 'anchorY', playheadTime),
    pitch: evaluateItemProperty(item, 'pitch', playheadTime),
    yaw: evaluateItemProperty(item, 'yaw', playheadTime),
    flipH: base.flipH,
    flipV: base.flipV,
    blendMode: base.blendMode,
  }
}

/**
 * Evaluates the Crop properties for an item at the given playhead time,
 * enforcing border sum <= 99.9% rules.
 */
export function evaluateItemCrop(item: TimelineItem, playheadTime: number): Crop {
  let left = Math.max(0, Math.min(100, evaluateItemProperty(item, 'cropLeft', playheadTime)))
  let right = Math.max(0, Math.min(100, evaluateItemProperty(item, 'cropRight', playheadTime)))
  let top = Math.max(0, Math.min(100, evaluateItemProperty(item, 'cropTop', playheadTime)))
  let bottom = Math.max(0, Math.min(100, evaluateItemProperty(item, 'cropBottom', playheadTime)))

  if (left + right > 99.9) {
    const excess = left + right - 99.9
    left = Math.max(0, left - excess / 2)
    right = Math.max(0, right - excess / 2)
  }

  if (top + bottom > 99.9) {
    const excess = top + bottom - 99.9
    top = Math.max(0, top - excess / 2)
    bottom = Math.max(0, bottom - excess / 2)
  }

  return {
    left: Math.round(left * 1000) / 1000,
    right: Math.round(right * 1000) / 1000,
    top: Math.round(top * 1000) / 1000,
    bottom: Math.round(bottom * 1000) / 1000,
  }
}

/**
 * Evaluates AudioProperties for an item at the given playhead time.
 */
export function evaluateItemAudio(item: TimelineItem, playheadTime: number): AudioProperties {
  const base = item.audio ?? DEFAULT_AUDIO_PROPERTIES
  return {
    volume: Math.max(0, evaluateItemProperty(item, 'volume', playheadTime)),
    pan: Math.max(-1, Math.min(1, evaluateItemProperty(item, 'pan', playheadTime))),
    muted: base.muted,
  }
}

/**
 * Checks whether an item has an existing keyframe for a property at the current playhead time.
 */
export function hasKeyframeAtPlayhead(
  item: TimelineItem,
  property: string,
  playheadTime: number,
  tolerance = 0.01,
  fps = 30
): boolean {
  if (!item.keyframes) return false
  const normKey = normalizePropertyKey(property)
  const kfs = (item.keyframes[normKey] || item.keyframes[property]) as Keyframe<number>[] | undefined
  if (!kfs || kfs.length === 0) return false

  const safeFps = fps > 0 ? fps : 30
  const playheadFrame = Math.round(playheadTime * safeFps)

  return kfs.some((kf: Keyframe<number>) => {
    const kfFrame = Math.round(kf.time * safeFps)
    // Frame check: Must be on the exact same frame
    if (playheadFrame !== kfFrame) return false

    // Time difference within the frame
    const maxDiff = Math.max(tolerance, 0.45 / safeFps)
    return Math.abs(kf.time - playheadTime) <= maxDiff
  })
}

/**
 * Checks if a property is actively keyframed (has keyframes or keyframing mode is explicitly enabled).
 */
export function isPropertyKeyframed(item: TimelineItem, property: string): boolean {
  const normKey = normalizePropertyKey(property)
  const hasKeyframes = (item.keyframes?.[normKey]?.length ?? 0) > 0
  const isEnabled = !!(item.keyframeEnabled?.[normKey] || item.keyframeEnabled?.[property])
  return hasKeyframes || isEnabled
}

/**
 * Gets nearest previous and next keyframes relative to playhead time.
 * If property is omitted, searches across all animated properties on the item.
 */
export function getAdjacentKeyframes(
  item: TimelineItem,
  property: string | undefined,
  playheadTime: number,
  tolerance = 0.001
): { prev: Keyframe | null; next: Keyframe | null } {
  if (!item.keyframes) return { prev: null, next: null }

  let allKfs: Keyframe[] = []
  if (property) {
    const normKey = normalizePropertyKey(property)
    allKfs = item.keyframes[normKey] || item.keyframes[property] || []
  } else {
    for (const list of Object.values(item.keyframes)) {
      if (Array.isArray(list)) {
        allKfs.push(...list)
      }
    }
  }

  if (allKfs.length === 0) return { prev: null, next: null }

  let prev: Keyframe | null = null
  let next: Keyframe | null = null

  for (const kf of allKfs) {
    if (kf.time < playheadTime - tolerance) {
      if (!prev || kf.time > prev.time) {
        prev = kf
      }
    } else if (kf.time > playheadTime + tolerance) {
      if (!next || kf.time < next.time) {
        next = kf
      }
    }
  }

  return { prev, next }
}

/**
 * Returns a sorted unique list of all keyframe times across all properties on an item.
 */
export function getAllKeyframeTimes(item: TimelineItem): number[] {
  if (!item.keyframes) return []
  const times = new Set<number>()
  for (const list of Object.values(item.keyframes)) {
    if (Array.isArray(list)) {
      for (const kf of list) {
        times.add(Math.round(kf.time * 10000) / 10000)
      }
    }
  }
  return Array.from(times).sort((a, b) => a - b)
}
