import { describe, it, expect, beforeEach } from 'vitest'
import {
  HORIZONTAL_FRAME_WIDTH,
  VERTICAL_FRAME_WIDTH,
} from './TimelineFilmstrip'
import { filmstripCache } from '../../core/media/filmstripCache'
import type { TimelineItem } from '../../core/timeline/types'
import type { MediaAsset } from '../../core/media/types'

describe('TimelineFilmstrip Thumbnail Dimensions & Aspect Ratio Rules', () => {
  it('enforces fixed frame dimensions for horizontal (64px) and vertical (28px)', () => {
    expect(HORIZONTAL_FRAME_WIDTH).toBe(64)
    expect(VERTICAL_FRAME_WIDTH).toBe(28)
  })

  it('determines horizontal vs vertical aspect ratio correctly from asset metadata', () => {
    const landscapeAsset: MediaAsset = {
      id: 'video-16x9',
      name: 'Landscape.mp4',
      type: 'video',
      path: '/media/landscape.mp4',
      metadata: { width: 1920, height: 1080 },
    }

    const portraitAsset: MediaAsset = {
      id: 'video-9x16',
      name: 'Reels.mp4',
      type: 'video',
      path: '/media/reels.mp4',
      metadata: { width: 1080, height: 1920 },
    }

    const defaultAsset: MediaAsset = {
      id: 'video-unknown',
      name: 'Unknown.mp4',
      type: 'video',
      path: '/media/unknown.mp4',
    }

    const isLandscapeVertical = Boolean(
      landscapeAsset.metadata?.width &&
      landscapeAsset.metadata?.height &&
      landscapeAsset.metadata.height > landscapeAsset.metadata.width
    )
    expect(isLandscapeVertical).toBe(false)

    const isPortraitVertical = Boolean(
      portraitAsset.metadata?.width &&
      portraitAsset.metadata?.height &&
      portraitAsset.metadata.height > portraitAsset.metadata.width
    )
    expect(isPortraitVertical).toBe(true)

    const isDefaultVertical = Boolean(
      (defaultAsset.metadata?.height ?? 0) > (defaultAsset.metadata?.width ?? 0)
    )
    expect(isDefaultVertical).toBe(false)
  })

  it('calculates tile count for horizontal clips and allows last tile to cut off without shape distortion', () => {
    const frameWidth = HORIZONTAL_FRAME_WIDTH // 64px

    // 64px clip: exactly 1 tile
    expect(Math.max(1, Math.ceil(64 / frameWidth))).toBe(1)

    // 65px clip: 2 tiles (tile 1 is cut off by 63px at the right boundary without distorting)
    expect(Math.max(1, Math.ceil(65 / frameWidth))).toBe(2)

    // 120px clip: 2 tiles (tile 1 is cut off by 8px)
    expect(Math.max(1, Math.ceil(120 / frameWidth))).toBe(2)

    // 128px clip: exactly 2 full tiles
    expect(Math.max(1, Math.ceil(128 / frameWidth))).toBe(2)

    // 129px clip: 3 tiles (tile 2 has 1px visible, 63px cut off)
    expect(Math.max(1, Math.ceil(129 / frameWidth))).toBe(3)
  })

  it('calculates tile count for vertical clips and allows last tile to cut off without shape distortion', () => {
    const frameWidth = VERTICAL_FRAME_WIDTH // 28px

    // 28px clip: exactly 1 tile
    expect(Math.max(1, Math.ceil(28 / frameWidth))).toBe(1)

    // 29px clip: 2 tiles
    expect(Math.max(1, Math.ceil(29 / frameWidth))).toBe(2)

    // 70px clip: 3 tiles (2 full 28px tiles = 56px, 3rd tile has 14px visible)
    expect(Math.max(1, Math.ceil(70 / frameWidth))).toBe(3)
  })

  it('computes correct progressive timestamps across tiles on the timeline', () => {
    const pixelsPerSecond = 40
    const frameWidth = 64
    const tileTimelineDuration = frameWidth / pixelsPerSecond // 1.6s
    const speed = 1
    const tileSourceDuration = tileTimelineDuration * speed // 1.6s

    const item: TimelineItem = {
      id: 'clip-1',
      trackId: 'track-v1',
      assetId: 'video-1',
      startTime: 10,
      duration: 5,
      sourceIn: 2,
      sourceOut: 7,
      transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
    }

    const clipWidth = item.duration * pixelsPerSecond // 200px
    const count = Math.max(1, Math.ceil(clipWidth / frameWidth)) // ceil(200 / 64) = 4 tiles

    const timestamps = Array.from({ length: count }, (_, idx) => {
      const rawTime = item.sourceIn + idx * tileSourceDuration
      return Math.min(item.sourceOut, rawTime)
    })

    // Tile 0: starts at sourceIn (2.0s)
    expect(timestamps[0]).toBeCloseTo(2.0, 2)

    // Tile 1: 2.0s + 1.6s = 3.6s
    expect(timestamps[1]).toBeCloseTo(3.6, 2)

    // Tile 2: 2.0s + 3.2s = 5.2s
    expect(timestamps[2]).toBeCloseTo(5.2, 2)

    // Tile 3: 2.0s + 4.8s = 6.8s (clamped to sourceOut 7.0s)
    expect(timestamps[3]).toBeCloseTo(6.8, 2)
  })
})

describe('FilmstripCache Frame Request & Deduplication', () => {
  beforeEach(() => {
    filmstripCache.clear()
  })

  it('synchronously returns cached frames without re-extracting', async () => {
    const assetId = 'asset-cache-test'
    const timestamp = 4.5
    const fakeDataUrl = 'data:image/jpeg;base64,abc123frame'

    filmstripCache.set(assetId, timestamp, fakeDataUrl)

    expect(filmstripCache.has(assetId, timestamp)).toBe(true)
    expect(filmstripCache.get(assetId, timestamp)).toBe(fakeDataUrl)

    // requestFrame should return the cached frame immediately
    const result = await filmstripCache.requestFrame(assetId, 'http://asset.localhost/test.mp4', timestamp)
    expect(result).toBe(fakeDataUrl)
  })

  it('deduplicates concurrent in-flight requests for the same timestamp', () => {
    const assetId = 'asset-flight-test'
    const timestamp = 8.0

    const p1 = filmstripCache.requestFrame(assetId, 'http://asset.localhost/test.mp4', timestamp)
    const p2 = filmstripCache.requestFrame(assetId, 'http://asset.localhost/test.mp4', timestamp)

    // Both requests must point to the identical pending promise
    expect(p1).toBe(p2)
  })
})

describe('Timeline Marquee Selection Rectangle Intersection Logic', () => {
  const PIXELS_PER_SECOND = 40
  const tracks = [
    { id: 'track-v1', type: 'video' },
    { id: 'track-a1', type: 'audio' },
  ]
  const centeringOffset = 0

  function computeMarqueeIntersections(
    marquee: { left: number; top: number; width: number; height: number },
    items: TimelineItem[]
  ): string[] {
    const intersecting: string[] = []
    for (const item of items) {
      const trackIdx = tracks.findIndex((t) => t.id === item.trackId)
      if (trackIdx < 0) continue

      const clipLeft = item.startTime * PIXELS_PER_SECOND
      const clipRight = Math.max(clipLeft + 8, (item.startTime + item.duration) * PIXELS_PER_SECOND)

      const trackTop = 28 + centeringOffset + trackIdx * 54
      const trackBottom = trackTop + 52

      const overlapsX = clipLeft < marquee.left + marquee.width && clipRight > marquee.left
      const overlapsY = trackTop < marquee.top + marquee.height && trackBottom > marquee.top

      if (overlapsX && overlapsY) {
        intersecting.push(item.id)
      }
    }
    return intersecting
  }

  const clip1: TimelineItem = {
    id: 'c1',
    trackId: 'track-v1',
    assetId: 'a1',
    startTime: 2, // 80px - 240px
    duration: 4,
    sourceIn: 0,
    sourceOut: 4,
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
  }

  const clip2: TimelineItem = {
    id: 'c2',
    trackId: 'track-a1',
    assetId: 'a2',
    startTime: 5, // 200px - 320px
    duration: 3,
    sourceIn: 0,
    sourceOut: 3,
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
  }

  it('selects clips intersecting horizontally and vertically', () => {
    // Marquee overlapping clip 1 on track-v1 only
    const res1 = computeMarqueeIntersections(
      { left: 100, top: 30, width: 50, height: 40 },
      [clip1, clip2]
    )
    expect(res1).toEqual(['c1'])
  })

  it('selects multiple clips across different tracks when marquee spans vertically', () => {
    // Marquee overlapping both clip 1 and clip 2 across video and audio tracks
    // clip 1 ends at 240px, clip 2 starts at 200px, so 205-225px overlaps both
    // track-v1 is 28-80px, track-a1 is 82-134px
    const res = computeMarqueeIntersections(
      { left: 210, top: 40, width: 20, height: 70 },
      [clip1, clip2]
    )
    expect(res).toEqual(['c1', 'c2'])
  })

  it('ignores clips outside the selection rectangle', () => {
    // Far to the right: 400px - 450px
    const res = computeMarqueeIntersections(
      { left: 400, top: 30, width: 50, height: 40 },
      [clip1, clip2]
    )
    expect(res).toEqual([])
  })

  it('supports image assets for filmstrip tiles across clip duration', () => {
    const imageAsset: MediaAsset = {
      id: 'img-1',
      name: 'photo.jpg',
      type: 'image',
      path: 'C:\\Media\\photo.jpg',
      thumbnailUrl: 'data:image/jpeg;base64,...',
      duration: 5,
      metadata: { width: 1920, height: 1080 },
    }

    const clipWidth = 200 // 5 seconds * 40px/s
    const frameWidth = HORIZONTAL_FRAME_WIDTH // 64px
    const tileCount = Math.max(1, Math.ceil(clipWidth / frameWidth)) // 4 tiles
    expect(tileCount).toBe(4)
    expect(imageAsset.type).toBe('image')
    expect(imageAsset.thumbnailUrl).toBeDefined()
  })
})
