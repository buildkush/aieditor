import { describe, it, expect } from 'vitest'
import {
  collectSnapTargets,
  snapTimeToTargets,
  DEFAULT_SNAP_THRESHOLD_PIXELS,
} from './snapping'
import type { TimelineItem } from './types'

describe('Timeline Snapping Logic', () => {
  it('defines standard snap threshold of 10 pixels', () => {
    expect(DEFAULT_SNAP_THRESHOLD_PIXELS).toBe(10)
  })

  it('collects snap targets from timeline start, playhead, and stationary clips', () => {
    const items: Record<string, TimelineItem> = {
      'clip-1': {
        id: 'clip-1',
        trackId: 'track-v1',
        assetId: 'a1',
        startTime: 2.0,
        duration: 3.0,
        sourceIn: 0,
        sourceOut: 3,
        transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
      },
      'clip-2': {
        id: 'clip-2',
        trackId: 'track-a1',
        assetId: 'a2',
        startTime: 8.0,
        duration: 4.0,
        sourceIn: 0,
        sourceOut: 4,
        transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
      },
    }

    const targets = collectSnapTargets(items, 5.0, ['clip-2'])
    const times = targets.map((t) => t.time)

    // Should include: 0 (start), 5.0 (playhead), 2.0 (clip-1 start), 5.0 (clip-1 end)
    // clip-2 should be ignored because it's in ignoreItemIds
    expect(times).toContain(0)
    expect(times).toContain(5.0)
    expect(times).toContain(2.0)
    expect(times).not.toContain(8.0)
    expect(times).not.toContain(12.0)
  })

  it('snaps candidate time to closest target within threshold', () => {
    const targets = [
      { time: 0, type: 'timeline-start' as const },
      { time: 4.0, type: 'clip-end' as const },
      { time: 10.0, type: 'playhead' as const },
    ]

    // 0.1s is within 0.25s threshold of 0
    const res1 = snapTimeToTargets(0.1, targets, { thresholdTime: 0.25 })
    expect(res1.hasSnapped).toBe(true)
    expect(res1.snappedTime).toBe(0)
    expect(res1.snapTargetTime).toBe(0)

    // 4.15s is within 0.25s threshold of 4.0
    const res2 = snapTimeToTargets(4.15, targets, { thresholdTime: 0.25 })
    expect(res2.hasSnapped).toBe(true)
    expect(res2.snappedTime).toBe(4.0)
    expect(res2.snapTargetTime).toBe(4.0)

    // 7.0s is not within threshold of any target
    const res3 = snapTimeToTargets(7.0, targets, { thresholdTime: 0.25 })
    expect(res3.hasSnapped).toBe(false)
    expect(res3.snappedTime).toBe(7.0)
  })

  it('snaps clip end edge to preceding or succeeding targets when moving', () => {
    const targets = [
      { time: 5.0, type: 'clip-start' as const },
    ]

    // Clip of duration 3.0s placed at candidate start 2.1s (end = 5.1s)
    // End edge (5.1s) is within 0.25s of 5.0s target
    const res = snapTimeToTargets(2.1, targets, {
      duration: 3.0,
      snapBothEdges: true,
      thresholdTime: 0.25,
    })

    expect(res.hasSnapped).toBe(true)
    expect(res.snappedEdge).toBe('end')
    expect(res.snapTargetTime).toBe(5.0)
    expect(res.snappedTime).toBeCloseTo(2.0, 4) // 5.0 - 3.0 = 2.0
  })

  it('snaps trimmed edges flush to adjacent clips', () => {
    const targets = [
      { time: 3.5, type: 'playhead' as const },
      { time: 6.0, type: 'clip-start' as const },
    ]

    // Right edge trim dragged near 6.0s (e.g. 5.9s)
    const rightTrim = snapTimeToTargets(5.9, targets, { thresholdTime: 0.25 })
    expect(rightTrim.hasSnapped).toBe(true)
    expect(rightTrim.snappedTime).toBe(6.0)

    // Left edge trim dragged near 3.5s (e.g. 3.6s)
    const leftTrim = snapTimeToTargets(3.6, targets, { thresholdTime: 0.25 })
    expect(leftTrim.hasSnapped).toBe(true)
    expect(leftTrim.snappedTime).toBe(3.5)
  })

  it('omits timeline-start 0.0s if target track already has a clip starting at 0.0s', () => {
    const items: Record<string, TimelineItem> = {
      'clip-zero': {
        id: 'clip-zero',
        trackId: 'track-v1',
        assetId: 'a1',
        startTime: 0,
        duration: 3.0,
        sourceIn: 0,
        sourceOut: 3,
        transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
      },
    }

    // When targeting track-v1, 0.0s should NOT be a snap target because track-v1 already has clip-zero at 0
    const targetsTrackV1 = collectSnapTargets(items, 10.0, [], 'track-v1')
    expect(targetsTrackV1.some((t) => t.type === 'timeline-start')).toBe(false)

    // When targeting another track (e.g. track-v2), 0.0s is preserved
    const targetsTrackV2 = collectSnapTargets(items, 10.0, [], 'track-v2')
    expect(targetsTrackV2.some((t) => t.type === 'timeline-start')).toBe(true)
  })

  it('resolves same-track snapping so clips snap side-by-side without fighting or overlap', () => {
    // Stationary clip-1 is from 0.0s to 4.0s on track-v1
    const targets = [
      { time: 4.0, type: 'clip-end' as const, trackId: 'track-v1' },
      { time: 0.0, type: 'clip-start' as const, trackId: 'track-v1' },
    ]

    // Moving clip-2 (duration 3.0s) on track-v1 near clip-1's end (e.g. 3.9s)
    // Start edge (3.9s) snaps to clip-1's end (4.0s) cleanly (Head-to-Tail)
    const res = snapTimeToTargets(3.9, targets, {
      duration: 3.0,
      snapBothEdges: true,
      thresholdTime: 0.25,
      targetTrackId: 'track-v1',
    })
    expect(res.hasSnapped).toBe(true)
    expect(res.snappedTime).toBe(4.0)
    expect(res.snappedEdge).toBe('start')

    // Moving clip-2's start near 0.1s on same track will NOT snap start-to-start (head-to-head overlap)
    const resOverlap = snapTimeToTargets(0.1, targets, {
      duration: 3.0,
      snapBothEdges: true,
      thresholdTime: 0.25,
      targetTrackId: 'track-v1',
    })
    // Start edge does not snap to clip-start on same track!
    expect(resOverlap.snappedEdge).not.toBe('start')
  })

  it('uses generous threshold for timeline start 0.0s to make snapping to beginning effortless', () => {
    const targets = [
      { time: 0, type: 'timeline-start' as const },
      { time: 5.0, type: 'clip-start' as const },
    ]

    // Candidate at 0.75s is well outside normal threshold (0.25s),
    // but within startThresholdTime (0.9s) -> magnetically snaps to 0.0s!
    const resStart = snapTimeToTargets(0.75, targets, {
      thresholdTime: 0.25,
      startThresholdTime: 0.9,
    })
    expect(resStart.hasSnapped).toBe(true)
    expect(resStart.snappedTime).toBe(0)

    // Standard target at 5.0s does NOT snap for a 0.75s difference
    const resMid = snapTimeToTargets(5.75, targets, {
      thresholdTime: 0.25,
      startThresholdTime: 0.9,
    })
    expect(resMid.hasSnapped).toBe(false)
  })
})
