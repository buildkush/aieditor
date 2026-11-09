export const MIN_LAYERS = 2
export const AUTO_MAX_LAYERS = 5
export const MANUAL_MAX_LAYERS = 7

export const TRACK_HEIGHT = 52
export const TRACK_GAP = 2
export const TIMELINE_OVERHEAD = 64 // 36px toolbar + 28px ruler

/**
 * Calculates the exact pixel height for a given number of visible layers
 * including toolbar and ruler overhead, track heights, and track gaps.
 */
export function getTimelineHeightForLayers(layerCount: number): number {
  const count = Math.max(1, layerCount)
  return TIMELINE_OVERHEAD + count * TRACK_HEIGHT + (count - 1) * TRACK_GAP
}

export const MIN_TIMELINE_HEIGHT = getTimelineHeightForLayers(MIN_LAYERS) // 170px
export const AUTO_MAX_TIMELINE_HEIGHT = getTimelineHeightForLayers(AUTO_MAX_LAYERS) // 332px
export const MANUAL_MAX_TIMELINE_HEIGHT = getTimelineHeightForLayers(MANUAL_MAX_LAYERS) // 440px

export const DEFAULT_TIMELINE_DURATION = 60 // 60 seconds (00:01:00:00) default length
export const MIN_TIMELINE_DURATION = 30 // 30 seconds minimum

/**
 * Computes timeline duration according to user rule:
 * - Fixed default length up to DEFAULT_TIMELINE_DURATION (60s) (or max committed clip if clips exceed 60s).
 * - If a clip is dragged beyond that, the timeline expands dynamically.
 * - If dragged back (or cancelled), returns to default length if no clip is present beyond it.
 * - Scrolling does NOT increase timeline length.
 */
export function computeTimelineDuration(
  maxCommittedClipEnd: number,
  dragEndTime: number = 0
): number {
  const baseline = Math.max(
    DEFAULT_TIMELINE_DURATION,
    Math.ceil(maxCommittedClipEnd / 5) * 5
  )

  const active = dragEndTime > baseline
    ? Math.ceil((dragEndTime + 5) / 5) * 5
    : baseline

  return Math.max(MIN_TIMELINE_DURATION, active)
}
