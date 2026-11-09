import React, { useEffect, useState } from 'react'
import type { TimelineItem } from '../../core/timeline/types'
import type { MediaAsset } from '../../core/media/types'
import { waveformCache, extractAudioWaveformPeaks } from '../../core/media/waveformCache'
import { resolveMediaUrl } from '../../core/media/mediaUrlResolver'

interface TimelineWaveformProps {
  item: TimelineItem
  asset?: MediaAsset | null
  clipWidth: number
}

/**
 * Visualizes audio amplitude waveforms for audio timeline items.
 * Peaks are cached in WaveformCache (independent of ProjectState).
 */
export const TimelineWaveform = React.memo(function TimelineWaveform({
  item,
  asset,
}: TimelineWaveformProps) {
  const [peaks, setPeaks] = useState<number[]>([])

  useEffect(() => {
    if (!asset || asset.isMissing) {
      setPeaks([])
      return
    }

    const cached = waveformCache.get(asset.id)
    if (cached) {
      setPeaks(cached)
      return
    }

    if (!waveformCache.isInFlight(asset.id)) {
      waveformCache.setInFlight(asset.id, true)
      const audioUrl = resolveMediaUrl(asset.path)
      extractAudioWaveformPeaks(audioUrl, 600).then((computedPeaks) => {
        waveformCache.set(asset.id, computedPeaks)
        waveformCache.setInFlight(asset.id, false)
        setPeaks(computedPeaks)
      })
    }
  }, [asset])

  if (peaks.length === 0) return null

  // Slice peaks according to sourceIn and sourceOut relative to asset duration
  const totalDuration = asset?.duration ?? 10
  const startFraction = Math.max(0, Math.min(1, item.sourceIn / totalDuration))
  const endFraction = Math.max(startFraction, Math.min(1, item.sourceOut / totalDuration))

  const startIdx = Math.floor(startFraction * peaks.length)
  const endIdx = Math.max(startIdx + 1, Math.ceil(endFraction * peaks.length))
  const visiblePeaks = peaks.slice(startIdx, endIdx)

  // Spacing: 1.6 units per peak (1.2px width, 0.4px gap) for high-density continuous look
  const totalWidth = visiblePeaks.length * 1.6

  // Construct continuous bottom-up wave path (anchored at y=33, rising upward to y=3)
  // Matching DaVinci Resolve timeline audio tracks: smooth solid filled amplitude contour
  const baseLineY = 32
  const maxAmpHeight = 28

  let pathD = `M 0 ${baseLineY}`
  for (let i = 0; i < visiblePeaks.length; i++) {
    const x = i * 1.6
    const amp = Math.max(0.04, visiblePeaks[i])
    const y = baseLineY - amp * maxAmpHeight
    pathD += ` L ${x.toFixed(1)} ${y.toFixed(1)}`
  }
  pathD += ` L ${totalWidth.toFixed(1)} ${baseLineY} Z`

  return (
    <div className="timeline-waveform-container">
      <svg
        className="timeline-waveform-svg"
        viewBox={`0 0 ${totalWidth} 36`}
        preserveAspectRatio="none"
      >
        {/* Subtle baseline guide */}
        <line
          x1={0}
          y1={baseLineY}
          x2={totalWidth}
          y2={baseLineY}
          stroke="rgba(255, 255, 255, 0.12)"
          strokeWidth="1"
        />
        {/* Continuous Solid Audio Waveform Path */}
        <path
          d={pathD}
          fill="rgba(240, 253, 250, 0.88)"
          stroke="rgba(255, 255, 255, 0.95)"
          strokeWidth="0.5"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  )
})
