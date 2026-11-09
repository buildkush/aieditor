import React, { useRef, useEffect } from 'react'
import type { ActiveAudioClip } from '../../core/playback/timelinePlayback'
import { resolveMediaUrl } from '../../core/media/mediaUrlResolver'
import { evaluateItemAudio } from '../../core/timeline/keyframeEvaluation'
import { evaluateItemEffects } from '../../core/timeline/effectEvaluation'
import {
  getSharedAudioContext,
  preloadReversedAudio,
  playReversedAudio,
  stopReversedAudio,
} from '../../core/playback/reversedAudioService'

interface AudioGraphNodes {
  sourceNode: MediaElementAudioSourceNode
  gainNode: GainNode
  pannerNode: StereoPannerNode | null
}

interface AudioLayerItemProps {
  clip: ActiveAudioClip
  isPlayingForward: boolean
  playheadTime: number
  syncTolerance?: number
}

/**
 * Dedicated audio stream player element.
 * Allows multiple audio tracks (A1, A2, etc.) to play simultaneously without interfering.
 * Supports standard forward streaming via HTML5 <audio> routed through Web Audio API
 * (for stereo panning and volume boost > 100%) and backwards reverse playback via Web Audio API.
 */
export const AudioLayerItem = React.memo(function AudioLayerItem({
  clip,
  isPlayingForward,
  playheadTime,
  syncTolerance = .25,
}: AudioLayerItemProps) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const webAudioRef = useRef<AudioGraphNodes | null>(null)
  const isReversed = !!clip.item.speed?.reversed
  const speed = clip.item.speed?.speed ?? 1

  const evaluatedAudio = evaluateItemAudio(clip.item, playheadTime)
  const evaluatedEffects = evaluateItemEffects(clip.item, playheadTime)
  const gainMultiplier = evaluatedEffects.gainDb !== 0 ? Math.pow(10, evaluatedEffects.gainDb / 20) : 1
  const isItemMuted = !!evaluatedAudio.muted
  const itemVolume = Math.max(0, evaluatedAudio.volume * gainMultiplier)
  const itemPan = Math.max(-1, Math.min(1, evaluatedAudio.pan))
  const isEffectivelyMuted = clip.isMissing || clip.isMuted || isItemMuted

  const audioUrl = clip.asset?.path ? resolveMediaUrl(clip.asset.path) : ''

  // Initialize Web Audio graph for the media element once mounted
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    // Prevent duplicate source nodes in React 18 StrictMode
    const existing = (audio as any).__aiditorAudioGraph as AudioGraphNodes | undefined
    if (existing) {
      webAudioRef.current = existing
      return
    }

    const ctx = getSharedAudioContext()
    if (ctx && typeof ctx.createMediaElementSource === 'function') {
      try {
        const sourceNode = ctx.createMediaElementSource(audio)
        const gainNode = ctx.createGain()
        let pannerNode: StereoPannerNode | null = null
        if (typeof ctx.createStereoPanner === 'function') {
          pannerNode = ctx.createStereoPanner()
        }

        sourceNode.connect(gainNode)
        if (pannerNode) {
          gainNode.connect(pannerNode)
          pannerNode.connect(ctx.destination)
        } else {
          gainNode.connect(ctx.destination)
        }

        const graph: AudioGraphNodes = { sourceNode, gainNode, pannerNode }
        webAudioRef.current = graph
        ;(audio as any).__aiditorAudioGraph = graph
      } catch (err) {
        console.warn('Web Audio routing initialization error for audio layer:', err)
      }
    }
  }, [])

  // Pre-load and decode reversed audio buffer whenever a clip is set to reversed
  useEffect(() => {
    if (isReversed && clip.asset?.id && audioUrl) {
      preloadReversedAudio(clip.asset.id, audioUrl)
    }
  }, [isReversed, clip.asset?.id, audioUrl])

  // Cleanup reversed audio session on unmount
  useEffect(() => {
    const itemId = clip.item.id
    return () => {
      stopReversedAudio(itemId)
    }
  }, [clip.item.id])

  useEffect(() => {
    const audio = audioRef.current

    if (isReversed) {
      // Pause standard HTML5 audio element
      if (audio && !audio.paused) {
        audio.pause()
      }

      if (isPlayingForward && !isEffectivelyMuted && clip.asset?.id && audioUrl) {
        playReversedAudio({
          itemId: clip.item.id,
          assetId: clip.asset.id,
          audioUrl,
          sourceTime: clip.sourceTime,
          speed,
          volume: itemVolume,
          pan: itemPan,
          isMuted: isEffectivelyMuted,
        })
      } else {
        stopReversedAudio(clip.item.id)
      }
      return
    }

    // Normal forward playback: ensure reversed player is stopped
    stopReversedAudio(clip.item.id)

    if (!audio) return

    const ctx = getSharedAudioContext()
    const targetGain = isEffectivelyMuted ? 0 : itemVolume
    const targetPan = isEffectivelyMuted ? 0 : itemPan

    // Apply Web Audio gain & stereo pan if graph is active
    if (webAudioRef.current && ctx) {
      if (ctx.state === 'suspended' && isPlayingForward) {
        ctx.resume().catch(() => {})
      }
      const now = ctx.currentTime
      webAudioRef.current.gainNode.gain.setValueAtTime(targetGain, now)
      if (webAudioRef.current.pannerNode) {
        webAudioRef.current.pannerNode.pan.setValueAtTime(targetPan, now)
      }
      // Keep audio element volume at 1 (or 0 if muted) so Web Audio gain is not clamped
      audio.volume = isEffectivelyMuted ? 0 : 1
    } else {
      // Fallback when Web Audio is not available
      audio.volume = Math.max(0, Math.min(1, targetGain))
    }

    if (isEffectivelyMuted) {
      if (!audio.paused) {
        audio.pause()
      }
      return
    }

    if (audio.src !== audioUrl && !audio.src.endsWith(encodeURI(clip.asset.path))) {
      audio.src = audioUrl
    }

    if (isPlayingForward) {
      const clampedRate = Math.max(0.25, Math.min(4, speed))
      if (audio.playbackRate !== clampedRate) {
        audio.playbackRate = clampedRate
      }
      if (!audio.seeking && Math.abs(audio.currentTime - clip.sourceTime) > syncTolerance) {
        audio.currentTime = clip.sourceTime
      }
      if (audio.paused) {
        audio.play().catch(() => {})
      }
    } else {
      if (!audio.paused) {
        audio.pause()
      }
      if (Math.abs(audio.currentTime - clip.sourceTime) > 0.05) {
        audio.currentTime = clip.sourceTime
      }
    }
  }, [
    clip,
    isPlayingForward,
    playheadTime,
    isReversed,
    speed,
    itemVolume,
    itemPan,
    isEffectivelyMuted,
    audioUrl,
    syncTolerance,
  ])

  return (
    <audio
      ref={audioRef}
      style={{ display: 'none' }}
      preload="auto"
      crossOrigin="anonymous"
      onError={() => {
        // Fallback without crossOrigin if custom host rejected CORS
        const audio = audioRef.current
        if (audio && audio.crossOrigin) {
          audio.removeAttribute('crossOrigin')
          audio.load()
        }
      }}
    />
  )
})
