export interface TransitionDefinition {
  id: string
  name: string
  category: 'dissolve' | 'motion' | 'wipe' | 'stylized'
  description: string
  icon: string
  defaultDurationSec: number
}

/** Shared by the Tools browser, transition browser, and Inspector. */
export const TRANSITION_DEFINITIONS: TransitionDefinition[] = [
  { id: 'tr-cross-dissolve', name: 'Cross Dissolve', category: 'dissolve', description: 'Smooth blend between clips', icon: '🌫️', defaultDurationSec: 1 },
  { id: 'tr-dip-to-black', name: 'Dip to Black', category: 'dissolve', description: 'Fade through black', icon: '⬛', defaultDurationSec: 1 },
  { id: 'tr-dip-to-white', name: 'Dip to White', category: 'dissolve', description: 'Fade through a white flash', icon: '⬜', defaultDurationSec: 1 },
  { id: 'tr-push-left', name: 'Push', category: 'motion', description: 'Incoming clip pushes the outgoing clip away', icon: '⬅️', defaultDurationSec: 1 },
  { id: 'tr-slide-up', name: 'Slide', category: 'motion', description: 'Incoming clip slides over the outgoing clip', icon: '⬆️', defaultDurationSec: 1 },
  { id: 'tr-whip-pan', name: 'Whip Pan', category: 'motion', description: 'Fast pan with motion blur', icon: '💨', defaultDurationSec: 0.8 },
  { id: 'tr-zoom-in', name: 'Zoom', category: 'motion', description: 'Zoom and blend into the next clip', icon: '🔍', defaultDurationSec: 1 },
  { id: 'tr-linear-wipe', name: 'Linear Wipe', category: 'wipe', description: 'Directional reveal across the frame', icon: '📐', defaultDurationSec: 1 },
  { id: 'tr-clock-wipe', name: 'Clock Wipe', category: 'wipe', description: 'Radial reveal around the frame center', icon: '⏱️', defaultDurationSec: 1 },
  { id: 'tr-glitch', name: 'Digital Glitch', category: 'stylized', description: 'Animated static, horizontal tearing, and RGB channel split', icon: '⚡', defaultDurationSec: 0.8 },
]

// Keep existing projects readable without retaining duplicate library entries.
const ALIASES: Record<string, string> = {
  'tr-dissolve': 'tr-cross-dissolve', 'tr-fade': 'tr-cross-dissolve',
  'tr-dip-black': 'tr-dip-to-black', 'tr-dip-white': 'tr-dip-to-white',
  'tr-wipe': 'tr-linear-wipe', 'tr-slide': 'tr-slide-up',
  'tr-zoom': 'tr-zoom-in', 'tr-crash-zoom': 'tr-zoom-in',
  'tr-light-leak': 'tr-dip-to-white',
}

export function normalizeTransitionId(id: string): string {
  const key = id.toLowerCase()
  return ALIASES[key] ?? key
}

export function getTransitionDirection(id: string, value?: unknown): string {
  const key = normalizeTransitionId(id)
  const direction = String(value ?? '')
  if (key === 'tr-clock-wipe') return direction === 'counterClockwise' ? direction : 'clockwise'
  const motion = ({ fromLeft: 'left', fromRight: 'right', fromTop: 'up', fromBottom: 'down' } as Record<string, string>)[direction] ?? direction
  if (key === 'tr-linear-wipe') {
    return ({ left: 'fromLeft', right: 'fromRight', up: 'fromTop', down: 'fromBottom' } as Record<string, string>)[motion] ?? 'fromLeft'
  }
  return ['left', 'right', 'up', 'down'].includes(motion) ? motion : key === 'tr-slide-up' && id.toLowerCase() !== 'tr-slide' ? 'up' : 'left'
}
