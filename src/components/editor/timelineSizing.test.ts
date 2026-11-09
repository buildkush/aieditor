import { describe, it, expect } from 'vitest'
import {
  getTimelineHeightForLayers,
  DEFAULT_TIMELINE_DURATION,
  computeTimelineDuration,
} from './timelineSizing'

describe('Timeline Height & Layer Capacity Rules', () => {
  it('computes exact pixel heights matching 2 to 7 layers with fixed overhead', () => {
    // 2 layers: 64px overhead + 2*52px + 2px gap = 170px
    expect(getTimelineHeightForLayers(2)).toBe(170)

    // 3 layers: 64px + 3*52px + 4px gap = 224px
    expect(getTimelineHeightForLayers(3)).toBe(224)

    // 4 layers: 64px + 4*52px + 6px gap = 278px
    expect(getTimelineHeightForLayers(4)).toBe(278)

    // 5 layers (default auto maximum): 64px + 5*52px + 8px gap = 332px
    expect(getTimelineHeightForLayers(5)).toBe(332)

    // 6 layers: 64px + 6*52px + 10px gap = 386px
    expect(getTimelineHeightForLayers(6)).toBe(386)

    // 7 layers (drag manual maximum): 64px + 7*52px + 12px gap = 440px
    expect(getTimelineHeightForLayers(7)).toBe(440)
  })

  it('caps automatic timeline height at 5 layers even when 8 layers exist', () => {
    const AUTO_MAX_LAYERS = 5
    const MIN_LAYERS = 2

    // Project opens with 2 layers -> 170px
    const initialTrackCount = 2
    const initialVisible = Math.min(AUTO_MAX_LAYERS, Math.max(MIN_LAYERS, initialTrackCount))
    expect(initialVisible).toBe(2)
    expect(getTimelineHeightForLayers(initialVisible)).toBe(170)

    // User adds layers up to 5 -> height grows to 332px
    const fiveTrackCount = 5
    const fiveVisible = Math.min(AUTO_MAX_LAYERS, Math.max(MIN_LAYERS, fiveTrackCount))
    expect(fiveVisible).toBe(5)
    expect(getTimelineHeightForLayers(fiveVisible)).toBe(332)

    // User adds 8 layers -> height does NOT grow past 5 layers on its own
    const eightTrackCount = 8
    const eightVisible = Math.min(AUTO_MAX_LAYERS, Math.max(MIN_LAYERS, eightTrackCount))
    expect(eightVisible).toBe(5)
    expect(getTimelineHeightForLayers(eightVisible)).toBe(332)
  })

  it('enforces manual drag boundaries between 2 layers (170px) and 7 layers (440px)', () => {
    const MIN_HEIGHT = getTimelineHeightForLayers(2) // 170px
    const MAX_HEIGHT = getTimelineHeightForLayers(7) // 440px

    function clampManualHeight(requestedHeight: number): number {
      return Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, requestedHeight))
    }

    // Dragging down below 2 layers is clamped to 170px
    expect(clampManualHeight(100)).toBe(170)

    // Dragging up above 7 layers is clamped to 440px
    expect(clampManualHeight(600)).toBe(440)

    // Intermediate adjustments within [170, 440] are preserved
    expect(clampManualHeight(224)).toBe(224)
    expect(clampManualHeight(386)).toBe(386)
  })

  it('preserves user manual height without auto-adjusting when tracks change', () => {
    let manualHeight: number | null = null
    const trackCount = 5

    // In auto mode, 5 tracks produces 332px
    let currentHeight =
      manualHeight !== null
        ? manualHeight
        : getTimelineHeightForLayers(Math.min(5, Math.max(2, trackCount)))
    expect(currentHeight).toBe(332)

    // User manually resizes down to 2 layers (170px)
    manualHeight = getTimelineHeightForLayers(2)
    currentHeight =
      manualHeight !== null
        ? manualHeight
        : getTimelineHeightForLayers(Math.min(5, Math.max(2, trackCount)))
    expect(currentHeight).toBe(170)

    // Adding more tracks while manual height is active stays at user-chosen 170px
    const newTrackCount = 8
    currentHeight =
      manualHeight !== null
        ? manualHeight
        : getTimelineHeightForLayers(Math.min(5, Math.max(2, newTrackCount)))
    expect(currentHeight).toBe(170)

    // Resetting manual height returns to auto-adjust mode (5 layers max = 332px)
    manualHeight = null
    currentHeight =
      manualHeight !== null
        ? manualHeight
        : getTimelineHeightForLayers(Math.min(5, Math.max(2, newTrackCount)))
    expect(currentHeight).toBe(332)
  })
})

describe('Fixed Default Timeline Duration & Dynamic Drag Expansion', () => {
  it('keeps timeline fixed at default length when clips are within default duration', () => {
    expect(DEFAULT_TIMELINE_DURATION).toBe(60)

    // Empty project -> 60s
    expect(computeTimelineDuration(0, 0)).toBe(60)

    // Clips ending at 20s or 40s -> fixed at 60s
    expect(computeTimelineDuration(20, 0)).toBe(60)
    expect(computeTimelineDuration(40, 0)).toBe(60)
    expect(computeTimelineDuration(60, 0)).toBe(60)
  })

  it('increases timeline duration dynamically when a clip is dragged beyond default length', () => {
    const committedClipsEnd = 40 // clips in project end at 40s

    // Dragging within default duration does not increase timeline length
    expect(computeTimelineDuration(committedClipsEnd, 50)).toBe(60)
    expect(computeTimelineDuration(committedClipsEnd, 60)).toBe(60)

    // Dragging beyond default duration expands dynamically
    expect(computeTimelineDuration(committedClipsEnd, 72)).toBe(80)
    expect(computeTimelineDuration(committedClipsEnd, 93)).toBe(100)
  })

  it('returns to default length immediately when dragged clip moves back under default duration', () => {
    const committedClipsEnd = 40

    // While dragged at 85s -> 90s
    expect(computeTimelineDuration(committedClipsEnd, 85)).toBe(90)

    // Dragged back to 45s -> immediately returns to default 60s
    expect(computeTimelineDuration(committedClipsEnd, 45)).toBe(60)

    // Drag cancelled -> returns to default 60s
    expect(computeTimelineDuration(committedClipsEnd, 0)).toBe(60)
  })

  it('persists expanded duration only when a clip is committed beyond default length', () => {
    // A clip committed at 85s keeps timeline at 85s
    expect(computeTimelineDuration(85, 0)).toBe(85)

    // When that clip is removed / moved back to 30s, timeline returns to default 60s
    expect(computeTimelineDuration(30, 0)).toBe(60)
  })
})
