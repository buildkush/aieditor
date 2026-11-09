import type { TimelineItem, Crop } from '../timeline/types'
import type { ActiveTransition } from './timelinePlayback'
import { normalizeTransitionId, getTransitionDirection } from '../timeline/transitionDefinitions'

export interface GlitchVisual {
  seed: number
  displacement: number
  rgbOffset: number
  noiseOpacity: number
}

export interface TransitionVisual {
  x: number; y: number; scale: number; opacity: number
  filter: string
  clipPath?: string
  maskImage?: string
  whiteOpacity: number
  glitch?: GlitchVisual
}

/** Rendering derived from the timeline; never changes a clip's editable transform. */
export function evaluateTransitionVisual(
  active: ActiveTransition | null | undefined, item: TimelineItem,
  width: number, height: number, canvasScale: number,
  crop?: Crop,
): TransitionVisual {
  const result: TransitionVisual = { x: 0, y: 0, scale: 1, opacity: 1, filter: '', whiteOpacity: 0 }
  if (!active) return result
  const tr = active.transition
  const id = normalizeTransitionId(tr.transitionId)
  const p = Math.max(0, Math.min(1, active.progress))
  const ease = tr.params?.curve === 'linear' ? p : p * p * (3 - 2 * p)
  const pair = !!(tr.leftClipId && tr.rightClipId)
  const incoming = pair ? tr.rightClipId === item.id : tr.rightClipId === item.id ||
    (tr.alignment === 'start' || (tr.alignment !== 'end' && tr.startTime + tr.duration / 2 < item.startTime + item.duration / 2))
  const reveal = incoming ? ease : 1 - ease
  const intensity = typeof tr.params?.intensity === 'number' ? Math.max(0, Math.min(1, tr.params.intensity / 100)) : 1
  const envelope = Math.sin(p * Math.PI)
  const rawDirection = getTransitionDirection(tr.transitionId, tr.params?.direction)
  const direction = ({ fromLeft: 'left', fromRight: 'right', fromTop: 'up', fromBottom: 'down' } as Record<string, string>)[rawDirection] || rawDirection || (id === 'tr-slide-up' ? 'up' : 'left')
  const vector = direction === 'right' ? { x: 1, y: 0 } : direction === 'up' ? { x: 0, y: -1 } : direction === 'down' ? { x: 0, y: 1 } : { x: -1, y: 0 }
  const w = width * canvasScale, h = height * canvasScale

  switch (id) {
    case 'tr-push-left':
    case 'tr-slide-up': {
      // Travel a full frame even at reduced intensity: partial distances expose
      // the incoming clip at the start and cause a jump when the transition ends.
      const travel = incoming ? -(1 - ease) : ease
      if (id === 'tr-push-left' || incoming || !pair) {
        result.x = vector.x * w * travel
        result.y = vector.y * h * travel
      }
      break
    }
    case 'tr-whip-pan': {
      const blurSetting = typeof tr.params?.blur === 'number' ? Math.max(0, Math.min(100, tr.params.blur)) : 60
      const blur = envelope * blurSetting / 100 * 30 * canvasScale * intensity
      const travel = envelope * 0.12 * intensity * (incoming ? -1 : 1)
      result.x = vector.x * w * travel
      result.y = vector.y * h * travel
      // Overscan covers both the pan offset and the transparent blur fringes.
      result.scale = 1 + 2 * (Math.max(Math.abs(result.x), Math.abs(result.y)) + blur * 3) / Math.max(1, Math.min(w, h))
      result.filter = blur > 0.001 ? `blur(${blur.toFixed(3)}px)` : ''
      if (incoming || !pair) result.opacity = pair ? ease : reveal
      break
    }
    case 'tr-cross-dissolve':
      if (incoming || !pair) result.opacity = pair ? ease : reveal
      break
    case 'tr-zoom-in': {
      const zoomOut = tr.params?.mode === 'zoomOut'
      result.scale = zoomOut ? 1 + (incoming ? 1 - ease : ease) * 0.6 * intensity : 1 + 0.6 * envelope * intensity
      if (incoming || !pair) result.opacity = pair ? ease : reveal
      break
    }
    case 'tr-dip-to-black':
    case 'tr-dip-to-white': {
      if (!pair) {
        if (id === 'tr-dip-to-white') result.whiteOpacity = (1 - reveal) * intensity
        else result.filter = `brightness(${(1 - (1 - reveal) * intensity).toFixed(4)})`
      } else {
        result.opacity = incoming ? (p >= 0.5 ? 1 : 0) : (p <= 0.5 ? 1 : 0)
        const dip = 1 - Math.abs(2 * p - 1)
        if (id === 'tr-dip-to-white') result.whiteOpacity = dip * intensity
        else result.filter = `brightness(${(1 - dip * intensity).toFixed(4)})`
      }
      break
    }
    case 'tr-linear-wipe': {
      if (!pair || incoming) {
        const hidden = (1 - (pair ? ease : reveal)) * 100
        const top = Math.max(crop?.top ?? 0, direction === 'down' ? hidden : 0)
        const right = Math.max(crop?.right ?? 0, direction === 'left' ? hidden : 0)
        const bottom = Math.max(crop?.bottom ?? 0, direction === 'up' ? hidden : 0)
        const left = Math.max(crop?.left ?? 0, direction === 'right' ? hidden : 0)
        result.clipPath = `inset(${top}% ${right}% ${bottom}% ${left}%)`
      }
      break
    }
    case 'tr-clock-wipe': {
      if (!pair || incoming) {
        const angle = (pair ? ease : reveal) * 360
        const from = rawDirection === 'counterClockwise' ? 360 - angle : 0
        result.maskImage = `conic-gradient(from ${from}deg at 50% 50%, #000 0deg ${angle}deg, transparent ${angle}deg 360deg)`
      }
      break
    }
    case 'tr-glitch': {
      const strength = envelope * intensity
      if (strength > 0.001) {
        // Change the pattern at a fixed timeline cadence, not on wall-clock time.
        // Pausing or revisiting the same frame produces exactly the same glitch.
        const seed = Math.floor((tr.startTime + p * tr.duration) * 24) + 1
        const burst = ((Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296
        const displacement = (18 + burst * 46) * canvasScale * strength
        const rgbOffset = (3 + burst * 10) * canvasScale * strength
        result.glitch = { seed, displacement, rgbOffset, noiseOpacity: (0.2 + burst * 0.25) * strength }
        result.x = (burst - 0.5) * 12 * canvasScale * strength
        // Cover displaced bands and separated channels at the frame edges.
        result.scale = 1 + 2 * (Math.abs(result.x) + displacement / 2 + rgbOffset) / Math.max(1, Math.min(w, h))
        result.filter = `contrast(${1 + 0.2 * strength})`
      }
      if (incoming || !pair) result.opacity = pair ? ease : reveal
      break
    }
    default:
      // Unknown older presets degrade to a clean dissolve, not an opaque cut.
      if (incoming || !pair) result.opacity = pair ? ease : reveal
  }
  return result
}
