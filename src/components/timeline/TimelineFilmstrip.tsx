import React, { useState, useEffect } from 'react'
import type { TimelineItem } from '../../core/timeline/types'
import type { MediaAsset } from '../../core/media/types'
import { filmstripCache } from '../../core/media/filmstripCache'
import { resolveMediaUrl } from '../../core/media/mediaUrlResolver'

export const HORIZONTAL_FRAME_WIDTH = 64
export const VERTICAL_FRAME_WIDTH = 28
const DEFAULT_PIXELS_PER_SECOND = 40

interface TimelineFilmstripProps {
  item: TimelineItem
  asset?: MediaAsset | null
  clipWidth: number
  pixelsPerSecond?: number
}

interface FilmstripTileProps {
  assetId: string
  videoUrl: string
  timestamp: number
  frameWidth: number
  targetWidth: number
  fallbackUrl: string
}

/**
 * Individual fixed-size tile within the video filmstrip.
 * Displays cached frame at timestamp, or gracefully falls back to poster frame while extracting.
 */
const FilmstripTile = React.memo(function FilmstripTile({
  assetId,
  videoUrl,
  timestamp,
  frameWidth,
  targetWidth,
  fallbackUrl,
}: FilmstripTileProps) {
  const [frameUrl, setFrameUrl] = useState<string | null>(() => {
    return filmstripCache.get(assetId, timestamp) ?? null
  })

  useEffect(() => {
    const cached = filmstripCache.get(assetId, timestamp)
    if (cached) {
      setFrameUrl(cached)
      return
    }

    let isCancelled = false
    // 60ms debounce to avoid spamming decoders during rapid trimming/scrubbing
    const timerId = setTimeout(() => {
      filmstripCache
        .requestFrame(assetId, videoUrl, timestamp, targetWidth)
        .then((url) => {
          if (!isCancelled && url) {
            setFrameUrl(url)
          }
        })
    }, 60)

    return () => {
      isCancelled = true
      clearTimeout(timerId)
    }
  }, [assetId, videoUrl, timestamp, targetWidth])

  const displaySrc = frameUrl || fallbackUrl

  return (
    <div
      className="filmstrip-frame"
      style={{
        width: frameWidth,
        minWidth: frameWidth,
        maxWidth: frameWidth,
        flex: `0 0 ${frameWidth}px`,
      }}
    >
      <img src={displaySrc} alt="" draggable={false} />
    </div>
  )
})

/**
 * Renders thumbnail frames across the visible duration of a video timeline clip.
 * 
 * Key architectural guarantees:
 * 1. Uses actual video frames extracted at proportional timestamps along the clip duration.
 * 2. Strict fixed dimensions for both Horizontal (64px) and Vertical (28px) formats according to aspect ratio.
 * 3. Trimming never deforms, stretches, or squishes images; any non-multiple clip duration cleanly
 *    cuts the last image at the container boundary (overflow: hidden), completely eliminating flickering.
 */
export const TimelineFilmstrip = React.memo(function TimelineFilmstrip({
  item,
  asset,
  clipWidth,
  pixelsPerSecond = DEFAULT_PIXELS_PER_SECOND,
}: TimelineFilmstripProps) {
  if (!asset || (asset.type !== 'video' && asset.type !== 'image') || asset.isMissing) {
    return null
  }

  const isImage = asset.type === 'image'
  const thumbUrl = asset.thumbnailUrl || (isImage ? resolveMediaUrl(asset.path) : null)
  if (!thumbUrl) return null

  // Determine whether video/image is vertical (portrait, e.g. 9:16 Shorts/Reels) or horizontal (landscape, 16:9)
  const isVertical = Boolean(
    asset.metadata?.width &&
    asset.metadata?.height &&
    asset.metadata.height > asset.metadata.width
  )

  const frameWidth = isVertical ? VERTICAL_FRAME_WIDTH : HORIZONTAL_FRAME_WIDTH
  const targetWidth = isVertical ? 48 : 96

  // Calculate count of rigid, fixed-size tiles to cover clipWidth
  const count = Math.max(1, Math.ceil(clipWidth / frameWidth))

  if (isImage) {
    return (
      <div className={`timeline-filmstrip ${isVertical ? 'vertical' : 'horizontal'}`}>
        {Array.from({ length: count }, (_, idx) => (
          <div
            key={idx}
            className="filmstrip-frame"
            style={{
              width: frameWidth,
              minWidth: frameWidth,
              maxWidth: frameWidth,
              flex: `0 0 ${frameWidth}px`,
            }}
          >
            <img
              src={thumbUrl}
              alt=""
              draggable={false}
              onError={(e) => {
                const fallback = resolveMediaUrl(asset.path)
                if (fallback && (e.currentTarget as HTMLImageElement).src !== fallback) {
                  ;(e.currentTarget as HTMLImageElement).src = fallback
                }
              }}
            />
          </div>
        ))}
      </div>
    )
  }

  const tileTimelineDuration = frameWidth / pixelsPerSecond
  const speed = item.duration > 0 ? (item.sourceOut - item.sourceIn) / item.duration : 1
  const tileSourceDuration = tileTimelineDuration * speed
  const isReversed = !!item.speed?.reversed
  const maxSourceTime = asset.duration ? Math.min(item.sourceOut, asset.duration - 0.05) : item.sourceOut

  const videoUrl = resolveMediaUrl(asset.path)

  const tiles = Array.from({ length: count }, (_, idx) => {
    const rawTime = isReversed
      ? item.sourceOut - idx * tileSourceDuration
      : item.sourceIn + idx * tileSourceDuration
    const timestamp = Math.max(0, Math.min(maxSourceTime, rawTime))
    return { idx, timestamp }
  })

  return (
    <div className={`timeline-filmstrip ${isVertical ? 'vertical' : 'horizontal'}`}>
      {tiles.map(({ idx, timestamp }) => (
        <FilmstripTile
          key={idx}
          assetId={asset.id}
          videoUrl={videoUrl}
          timestamp={timestamp}
          frameWidth={frameWidth}
          targetWidth={targetWidth}
          fallbackUrl={thumbUrl}
        />
      ))}
    </div>
  )
})
