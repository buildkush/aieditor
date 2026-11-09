import type { TimelineItem } from './types'

export interface SnapTarget {
  time: number
  type: 'timeline-start' | 'playhead' | 'clip-start' | 'clip-end'
  itemId?: string
  trackId?: string
}

export interface SnapResult {
  snappedTime: number
  hasSnapped: boolean
  snapTargetTime?: number
  snapTarget?: SnapTarget
  snappedEdge?: 'start' | 'end'
}

/**
 * Default snap threshold in pixels.
 * At 40px/sec, 10px corresponds to 0.25 seconds (~7.5 frames at 30fps).
 */
export const DEFAULT_SNAP_THRESHOLD_PIXELS = 10

/**
 * Dedicated snap threshold in pixels for timeline start (0.0s).
 * At 40px/sec, 36px corresponds to 0.90 seconds (~27 frames at 30fps).
 * Provides a strong, generous magnetic snap zone making it effortless
 * to place or move clips flush to the complete beginning.
 */
export const START_SNAP_THRESHOLD_PIXELS = 36

/**
 * Collects all candidate snap targets on the timeline:
 * - Timeline start (0.0s)
 * - Current playhead position
 * - In-points and out-points of all stationary clips across tracks
 *
 * If targetTrackId already has a stationary clip occupying 0.0s,
 * 0.0s is excluded for that track so placing clips does not fight
 * between side-by-side and accidental overwrite collision.
 */
export function collectSnapTargets(
  items: Record<string, TimelineItem>,
  playheadTime: number,
  ignoreItemIds: string[] = [],
  targetTrackId?: string
): SnapTarget[] {
  const targets: SnapTarget[] = []
  const ignoreSet = new Set(ignoreItemIds)

  // 1. Stationary clips in-points and out-points
  for (const item of Object.values(items)) {
    if (ignoreSet.has(item.id)) continue

    targets.push({
      time: item.startTime,
      type: 'clip-start',
      itemId: item.id,
      trackId: item.trackId,
    })

    targets.push({
      time: item.startTime + item.duration,
      type: 'clip-end',
      itemId: item.id,
      trackId: item.trackId,
    })
  }

  // 2. Timeline start (0.0s)
  // Only add 0.0s if targetTrackId is not already occupied at 0.0s by another stationary clip
  const isTargetTrackOccupiedAtStart =
    targetTrackId &&
    Object.values(items).some(
      (item) => !ignoreSet.has(item.id) && item.trackId === targetTrackId && item.startTime <= 0.05
    )

  if (!isTargetTrackOccupiedAtStart) {
    targets.push({ time: 0, type: 'timeline-start' })
  }

  // 3. Current playhead position
  if (playheadTime > 0) {
    targets.push({ time: playheadTime, type: 'playhead' })
  }

  return targets
}

/**
 * Snaps a candidate time (or clip start/end boundaries) to the closest snap target within the threshold.
 * Supports:
 * - Clip movement: snaps both start edge and end edge to targets
 * - Edge trimming: snaps trimmed edge to targets
 * - Media library drag-and-drop: snaps drop boundary
 *
 * Conflict Resolution:
 * On the same track, clips snap Head-to-Tail (start edge to clip-end) or
 * Tail-to-Head (end edge to clip-start) to ensure side-by-side placement without overlap.
 */
export function snapTimeToTargets(
  candidateTime: number,
  targets: SnapTarget[],
  options: {
    duration?: number
    snapBothEdges?: boolean
    thresholdTime?: number
    startThresholdTime?: number
    targetTrackId?: string
  } = {}
): SnapResult {
  const {
    duration = 0,
    snapBothEdges = false,
    thresholdTime = 0.25,
    startThresholdTime = 0.9,
    targetTrackId,
  } = options

  let closestDiff = Infinity
  let bestSnappedTime = candidateTime
  let bestTarget: SnapTarget | undefined
  let bestSnapTargetTime: number | undefined
  let bestEdge: 'start' | 'end' | undefined

  for (const target of targets) {
    const isSameTrack = Boolean(targetTrackId && target.trackId && targetTrackId === target.trackId)
    const isTimelineStart = target.type === 'timeline-start' || target.time === 0
    const activeThreshold = isTimelineStart ? Math.max(thresholdTime, startThresholdTime) : thresholdTime

    // 1. Check start edge snapping
    // On the same track, start edge snaps to clip-end (Head-to-Tail / side-by-side)
    // or global targets, avoiding accidental head-to-head overwrites
    const canSnapStart = !isSameTrack || target.type !== 'clip-start'

    if (canSnapStart) {
      const startDiff = Math.abs(candidateTime - target.time)
      if (startDiff <= activeThreshold && startDiff < closestDiff) {
        closestDiff = startDiff
        bestSnappedTime = target.time
        bestSnapTargetTime = target.time
        bestTarget = target
        bestEdge = 'start'
      }
    }

    // 2. Check end edge snapping (for moving clips with duration)
    // On the same track, end edge snaps to clip-start (Tail-to-Head / side-by-side)
    // or global targets, avoiding accidental tail-to-tail overwrites
    const canSnapEnd = !isSameTrack || target.type !== 'clip-end'

    if (snapBothEdges && duration > 0 && canSnapEnd) {
      const currentEnd = candidateTime + duration
      const endDiff = Math.abs(currentEnd - target.time)
      if (endDiff <= activeThreshold && endDiff < closestDiff) {
        const proposedStart = target.time - duration
        if (proposedStart >= 0) {
          closestDiff = endDiff
          bestSnappedTime = proposedStart
          bestSnapTargetTime = target.time
          bestTarget = target
          bestEdge = 'end'
        }
      }
    }
  }

  if (bestTarget !== undefined && bestSnapTargetTime !== undefined) {
    return {
      snappedTime: Math.max(0, bestSnappedTime),
      hasSnapped: true,
      snapTargetTime: bestSnapTargetTime,
      snapTarget: bestTarget,
      snappedEdge: bestEdge,
    }
  }

  return {
    snappedTime: Math.max(0, candidateTime),
    hasSnapped: false,
  }
}
