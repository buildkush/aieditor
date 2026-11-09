import type { TimelineItem, ItemEffect } from './types'
import { isEffectActiveAtLocalTime } from './types'

export interface EvaluatedEffects {
  filterStr: string | undefined
  vignette: { amount: number; radius: number } | null
  chromaKey: { keyColor: string; tolerance: number; smoothness: number } | null
  activeEffects: ItemEffect[]
  gainDb: number
}

/**
 * Evaluates active visual and audio effects for a timeline item at a specific project playhead time.
 * Only effects that are enabled AND active within their defined timing range are applied, in stack order.
 */
export function evaluateItemEffects(
  item: TimelineItem,
  playheadTime: number,
  canvasScale: number = 1
): EvaluatedEffects {
  if (!item.effects || item.effects.length === 0) {
    return {
      filterStr: undefined,
      vignette: null,
      chromaKey: null,
      activeEffects: [],
      gainDb: 0,
    }
  }

  const clipLocalTime = playheadTime - item.startTime
  const safeDuration = Math.max(0.01, item.duration)

  // Select only enabled effects within their active time range
  const activeEffects: ItemEffect[] = []
  for (const eff of item.effects) {
    if (eff.enabled !== false && isEffectActiveAtLocalTime(eff, clipLocalTime, safeDuration)) {
      activeEffects.push(eff)
    }
  }

  const filters: string[] = []
  let vignette: { amount: number; radius: number } | null = null
  let chromaKey: { keyColor: string; tolerance: number; smoothness: number } | null = null
  let totalGainDb = 0

  for (const eff of activeEffects) {
    const params = eff.params || {}

    switch (eff.effectId) {
      case 'blur': {
        const radius = Number(params.radius ?? 10)
        if (radius > 0) {
          filters.push(`blur(${(radius * canvasScale).toFixed(1)}px)`)
        }
        break
      }

      case 'grayscale': {
        const intensity = Number(params.intensity ?? 100)
        if (intensity > 0) {
          filters.push(`grayscale(${Math.min(100, Math.max(0, intensity)).toFixed(1)}%)`)
        }
        break
      }

      case 'brightness': {
        const value = Number(params.value ?? 0)
        if (value !== 0) {
          const factor = Math.max(0, 1 + value / 100)
          filters.push(`brightness(${factor.toFixed(2)})`)
        }
        break
      }

      case 'contrast': {
        const value = Number(params.value ?? 0)
        if (value !== 0) {
          const factor = Math.max(0, 1 + value / 100)
          filters.push(`contrast(${factor.toFixed(2)})`)
        }
        break
      }

      case 'saturation': {
        const value = Number(params.value ?? 100)
        if (value !== 100) {
          const factor = Math.max(0, value / 100)
          filters.push(`saturate(${factor.toFixed(2)})`)
        }
        break
      }

      case 'exposure': {
        const ev = Number(params.ev ?? 0)
        if (ev !== 0) {
          const factor = Math.max(0, Math.pow(2, ev))
          filters.push(`brightness(${factor.toFixed(2)})`)
        }
        break
      }

      case 'temperature': {
        const kelvin = Number(params.kelvin ?? 6500)
        if (kelvin > 6500) {
          const warmFactor = Math.min(1, (kelvin - 6500) / 7000)
          filters.push(`sepia(${warmFactor.toFixed(2)})`)
        } else if (kelvin < 6500) {
          const coolDegrees = ((kelvin - 6500) / 4500) * 30
          filters.push(`hue-rotate(${coolDegrees.toFixed(1)}deg)`)
        }
        break
      }

      case 'tint': {
        const amount = Number(params.amount ?? 0)
        if (amount !== 0) {
          filters.push(`hue-rotate(${(amount * 0.9).toFixed(1)}deg)`)
        }
        break
      }

      case 'sharpen': {
        const amount = Number(params.amount ?? 25)
        if (amount > 0) {
          const factor = 1 + amount / 150
          filters.push(`contrast(${factor.toFixed(2)})`)
        }
        break
      }

      case 'glow': {
        const radius = Number(params.radius ?? 20)
        const intensity = Math.min(1, Math.max(0, Number(params.intensity ?? 50) / 100))
        if (radius > 0 && intensity > 0) {
          filters.push(`drop-shadow(0 0 ${(radius * canvasScale).toFixed(1)}px rgba(255,255,255,${intensity.toFixed(2)}))`)
        }
        break
      }

      case 'rgb-split': {
        const dist = Number(params.distance ?? 5) * canvasScale
        if (dist > 0) {
          filters.push(`drop-shadow(-${dist.toFixed(1)}px 0 rgba(239, 68, 68, 0.65)) drop-shadow(${dist.toFixed(1)}px 0 rgba(6, 182, 212, 0.65))`)
        }
        break
      }

      case 'vignette': {
        const amount = Math.min(100, Math.max(0, Number(params.amount ?? 50)))
        const radius = Math.min(100, Math.max(10, Number(params.radius ?? 75)))
        if (amount > 0) {
          vignette = { amount, radius }
        }
        break
      }

      case 'chroma-key':
      case 'vf-chroma-key': {
        const keyColor = String(params.keyColor ?? '#00ff00')
        const tolerance = Math.min(100, Math.max(0, Number(params.tolerance ?? 35)))
        const smoothness = Math.min(100, Math.max(0, Number(params.smoothness ?? 10)))
        chromaKey = { keyColor, tolerance, smoothness }
        break
      }

      case 'gain': {
        const g = Number(params.gain ?? 0)
        totalGainDb += g
        break
      }

      default:
        break
    }
  }

  return {
    filterStr: filters.length > 0 ? filters.join(' ') : undefined,
    vignette,
    chromaKey,
    activeEffects,
    gainDb: totalGainDb,
  }
}
