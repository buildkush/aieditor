import type { TimelineItem, TimelineTransition } from './types'

/** Portion before the cut: end = left, center = across, start = right. */
export function transitionBeforeCut(alignment: TimelineTransition['alignment']): number {
  return alignment === 'end' ? 1 : alignment === 'start' ? 0 : 0.5
}

export function alignedTransitionTiming(
  left: TimelineItem,
  right: TimelineItem,
  duration: number,
  alignment: TimelineTransition['alignment'],
): { startTime: number; duration: number } {
  const before = transitionBeforeCut(alignment)
  const cut = left.startTime + left.duration
  const maxDuration = Math.min(
    before > 0 ? left.duration / before : Infinity,
    before < 1 ? (right.startTime + right.duration - cut) / (1 - before) : Infinity,
  )
  const clamped = Math.min(Math.max(0.05, duration), Math.max(0.05, maxDuration))
  return { startTime: cut - clamped * before, duration: clamped }
}
