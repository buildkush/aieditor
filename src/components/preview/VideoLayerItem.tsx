import React, { useRef, useEffect, useId } from 'react'
import { CaptionWords } from '../captions/CaptionWords'
import type { ActiveVideoClip, ActiveTransition } from '../../core/playback/timelinePlayback'
import {
  evaluateItemTransform,
  evaluateItemCrop,
  evaluateItemProperty,
} from '../../core/timeline/keyframeEvaluation'
import { resolveMediaUrl } from '../../core/media/mediaUrlResolver'
import { evaluateTransitionVisual } from '../../core/playback/transitionEvaluation'
import { getPreviewLayerDimensions } from './previewLayerDimensions'
import { colorWithOpacity } from '../../core/utils'

import { evaluateItemEffects } from '../../core/timeline/effectEvaluation'
import { GlitchFilter } from './GlitchFilter'

export interface VideoLayerItemProps {
  clip: ActiveVideoClip
  isPlayingForward: boolean
  playheadTime: number
  zIndex: number
  canvasScale: number
  projectWidth: number
  projectHeight: number
  activeTransition?: ActiveTransition | null
  adjustmentFilterStr?: string
  adjustmentVignette?: { amount: number; radius: number } | null
  adjustmentTransition?: ActiveTransition | null
  onSelect?: (itemId: string, e: React.MouseEvent) => void
  isSelected?: boolean
  isPreloading?: boolean
  syncTolerance?: number
}

/**
 * Individual visual layer in the preview canvas.
 * Renders video, image, solid color, text, subtitles/captions, or adjustment layer with
 * keyframed transforms, crop, opacity, blend modes, real-time effects, and selection handles.
 */
export const VideoLayerItem = React.memo(function VideoLayerItem({
  clip,
  isPlayingForward,
  playheadTime,
  zIndex,
  canvasScale,
  projectWidth,
  projectHeight,
  activeTransition,
  adjustmentFilterStr,
  adjustmentVignette,
  adjustmentTransition,
  onSelect,
  isSelected,
  isPreloading = false,
  syncTolerance = .25,
}: VideoLayerItemProps) {
  const glitchFilterId = `glitch-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const videoRef = useRef<HTMLVideoElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const bufferCanvasRef = useRef<HTMLCanvasElement>(null)
  const chromaCanvasRef = useRef<HTMLCanvasElement>(null)
  const rafSeekIdRef = useRef<number | null>(null)
  const isSeekingRef = useRef(false)
  const pendingTargetTimeRef = useRef<number | null>(null)

  const isSolid = clip.item.itemType === 'solid' || !!clip.item.solid
  const isText = clip.item.itemType === 'text' || !!clip.item.text
  const isCaption = clip.item.itemType === 'caption' || !!clip.item.caption
  const isAdjustment = clip.item.itemType === 'adjustment'
  const isVideo = !isSolid && !isText && !isCaption && !isAdjustment && clip.asset?.type === 'video'
  const isImage = !isSolid && !isText && !isCaption && !isAdjustment && clip.asset?.type === 'image'

  const evaluatedEffects = evaluateItemEffects(clip.item, playheadTime, canvasScale)
  const evaluatedTransform = evaluateItemTransform(clip.item, playheadTime)
  const evaluatedCrop = evaluateItemCrop(clip.item, playheadTime)
  const transform = evaluatedTransform
  const crop = evaluatedCrop

  const { width: assetWidth, height: assetHeight } = getPreviewLayerDimensions(
    clip.item, clip.asset, projectWidth, projectHeight, playheadTime,
  )

  const baseWidth = assetWidth * canvasScale
  const baseHeight = assetHeight * canvasScale
  let screenX = transform.x * canvasScale
  let screenY = transform.y * canvasScale
  let scaleX = (transform.scaleX !== undefined ? transform.scaleX : transform.scale) * (transform.flipH ? -1 : 1)
  let scaleY = (transform.scaleY !== undefined ? transform.scaleY : transform.scale) * (transform.flipV ? -1 : 1)
  const rotation = transform.rotation
  const pitch = transform.pitch || 0
  const yaw = transform.yaw || 0
  let opacity = transform.opacity
  const anchorX = (transform.anchorX || 0) * canvasScale
  const anchorY = (transform.anchorY || 0) * canvasScale

  // Map blend mode to CSS mixBlendMode ('add' maps to 'plus-lighter')
  const rawBlend = transform.blendMode
  const blendMode =
    rawBlend && rawBlend !== 'normal'
      ? rawBlend === 'add'
        ? 'plus-lighter'
        : rawBlend
      : undefined

  const hasCrop =
    crop.left > 0 || crop.right > 0 || crop.top > 0 || crop.bottom > 0
  const clipPath = hasCrop
    ? `inset(${crop.top}% ${crop.right}% ${crop.bottom}% ${crop.left}%)`
    : undefined

  const transitionVisual = evaluateTransitionVisual(
    activeTransition || adjustmentTransition, clip.item, projectWidth, projectHeight, canvasScale, crop,
  )
  screenX += transitionVisual.x
  screenY += transitionVisual.y
  scaleX *= transitionVisual.scale
  scaleY *= transitionVisual.scale
  opacity *= transitionVisual.opacity
  const transitionFilterStr = transitionVisual.filter
  const transitionClipPath = transitionVisual.clipPath
  const transitionMask = transitionVisual.maskImage

  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [isSeekingState, setIsSeekingState] = React.useState(false)

  // Buffer canvas snapshot to prevent blank frame on rapid or reverse scrub
  const updateBufferCanvas = React.useCallback(() => {
    const video = videoRef.current
    const canvas = bufferCanvasRef.current
    if (!video || !canvas || video.readyState < 2) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const vw = video.videoWidth || 640
    const vh = video.videoHeight || 360
    if (canvas.width !== vw || canvas.height !== vh) {
      canvas.width = vw
      canvas.height = vh
    }
    try {
      ctx.drawImage(video, 0, 0, vw, vh)
    } catch {
      // ignore
    }
  }, [])

  // Real-time canvas chroma keying
  const updateChromaCanvas = React.useCallback(() => {
    const video = videoRef.current
    const canvas = chromaCanvasRef.current
    const keyInfo = evaluatedEffects.chromaKey
    if (!video || !canvas || !keyInfo || video.readyState < 2) return
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return

    const vw = Math.min(1280, video.videoWidth || 640)
    const vh = video.videoWidth ? Math.round((video.videoHeight / video.videoWidth) * vw) : 360
    if (canvas.width !== vw || canvas.height !== vh) {
      canvas.width = vw
      canvas.height = vh
    }
    try {
      ctx.drawImage(video, 0, 0, vw, vh)
      const imgData = ctx.getImageData(0, 0, vw, vh)
      const data = imgData.data

      let c = (keyInfo.keyColor || '').trim().replace(/^#/, '')
      if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2]
      const num = parseInt(c, 16)
      const kr = isNaN(num) ? 0 : (num >> 16) & 255
      const kg = isNaN(num) ? 255 : (num >> 8) & 255
      const kb = isNaN(num) ? 0 : num & 255

      const isGreenKey = kr < 60 && kg > 160 && kb < 60
      const tol = (keyInfo.tolerance / 100) * 360
      const smooth = Math.max(1, (keyInfo.smoothness / 100) * 120)

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i]
        const g = data[i + 1]
        const b = data[i + 2]
        const dr = r - kr
        const dg = g - kg
        const db = b - kb
        const dist = Math.sqrt(dr * dr + dg * dg + db * db)

        const greenDiff = isGreenKey ? g - Math.max(r, b) : 0

        if (dist < tol || (isGreenKey && greenDiff > 35 && keyInfo.tolerance >= 20)) {
          data[i + 3] = 0
        } else if (dist < tol + smooth) {
          const factor = (dist - tol) / smooth
          data[i + 3] = Math.round(data[i + 3] * factor)
          if (isGreenKey && g > Math.max(r, b)) {
            data[i + 1] = Math.round(Math.max(r, b))
          }
        }
      }
      ctx.putImageData(imgData, 0, 0)
    } catch {
      // ignore
    }
  }, [evaluatedEffects.chromaKey])

  // Trigger chroma canvas immediately when chroma key parameters change or playhead updates while paused
  useEffect(() => {
    if (evaluatedEffects.chromaKey) {
      updateChromaCanvas()
    }
  }, [evaluatedEffects.chromaKey, playheadTime, updateChromaCanvas])

  // Playback RAF loop for Chroma Canvas so playing video keys out continuously
  useEffect(() => {
    if (!isPlayingForward || !evaluatedEffects.chromaKey || !isVideo) return
    let animId: number
    const loop = () => {
      updateChromaCanvas()
      animId = requestAnimationFrame(loop)
    }
    animId = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(animId)
  }, [isPlayingForward, evaluatedEffects.chromaKey, isVideo, updateChromaCanvas])

  // Image chroma keying
  useEffect(() => {
    if (!isImage || !evaluatedEffects.chromaKey) return
    const img = imageRef.current
    const canvas = chromaCanvasRef.current
    if (!img || !canvas) return
    const updateImgChroma = () => {
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) return
      const nw = img.naturalWidth || 640
      const nh = img.naturalHeight || 360
      if (canvas.width !== nw || canvas.height !== nh) {
        canvas.width = nw
        canvas.height = nh
      }
      ctx.drawImage(img, 0, 0, nw, nh)
      const imgData = ctx.getImageData(0, 0, nw, nh)
      const data = imgData.data
      const keyInfo = evaluatedEffects.chromaKey!
      let c = (keyInfo.keyColor || '').trim().replace(/^#/, '')
      if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2]
      const num = parseInt(c, 16)
      const kr = isNaN(num) ? 0 : (num >> 16) & 255
      const kg = isNaN(num) ? 255 : (num >> 8) & 255
      const kb = isNaN(num) ? 0 : num & 255

      const isGreenKey = kr < 60 && kg > 160 && kb < 60
      const tol = (keyInfo.tolerance / 100) * 360
      const smooth = Math.max(1, (keyInfo.smoothness / 100) * 120)

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i]
        const g = data[i + 1]
        const b = data[i + 2]
        const dr = r - kr
        const dg = g - kg
        const db = b - kb
        const dist = Math.sqrt(dr * dr + dg * dg + db * db)

        const greenDiff = isGreenKey ? g - Math.max(r, b) : 0

        if (dist < tol || (isGreenKey && greenDiff > 35 && keyInfo.tolerance >= 20)) {
          data[i + 3] = 0
        } else if (dist < tol + smooth) {
          const factor = (dist - tol) / smooth
          data[i + 3] = Math.round(data[i + 3] * factor)
          if (isGreenKey && g > Math.max(r, b)) {
            data[i + 1] = Math.round(Math.max(r, b))
          }
        }
      }
      ctx.putImageData(imgData, 0, 0)
    }

    if (img.complete) {
      updateImgChroma()
    } else {
      img.onload = updateImgChroma
    }
  }, [isImage, evaluatedEffects.chromaKey, clip.asset.path])

  // Non-blocking seek resolution and readyState-aware metadata handling
  useEffect(() => {
    const video = videoRef.current
    if (!video || !isVideo) return

    const handleSeeked = () => {
      isSeekingRef.current = false
      setIsSeekingState(false)
      updateBufferCanvas()
      if (evaluatedEffects.chromaKey) {
        updateChromaCanvas()
      }
      if (pendingTargetTimeRef.current !== null) {
        const nextTarget = pendingTargetTimeRef.current
        pendingTargetTimeRef.current = null
        if (Math.abs(video.currentTime - nextTarget) > 0.02) {
          isSeekingRef.current = true
          setIsSeekingState(true)
          try {
            if (!clip.isSourceHeld && !isPreloading && typeof (video as any).fastSeek === 'function') {
              ;(video as any).fastSeek(nextTarget)
            } else {
              video.currentTime = nextTarget
            }
          } catch {
            video.currentTime = nextTarget
          }
        }
      }
    }

    const handleLoadedMetadata = () => {
      setLoadError(null)
      updateBufferCanvas()
      if (evaluatedEffects.chromaKey) {
        updateChromaCanvas()
      }
      if (pendingTargetTimeRef.current !== null) {
        const nextTarget = pendingTargetTimeRef.current
        pendingTargetTimeRef.current = null
        if (Math.abs(video.currentTime - nextTarget) > 0.02) {
          isSeekingRef.current = true
          setIsSeekingState(true)
          try {
            if (!clip.isSourceHeld && !isPreloading && typeof (video as any).fastSeek === 'function') {
              ;(video as any).fastSeek(nextTarget)
            } else {
              video.currentTime = nextTarget
            }
          } catch {
            video.currentTime = nextTarget
          }
        }
      }
    }

    const handleError = () => {
      const err = video.error
      const msg = err
        ? `Error code ${err.code}: ${err.message || 'Media decode or stream error'}`
        : 'Video playback error'
      console.warn(`[VideoLayerItem] Video load error for ${clip.asset.name}:`, msg, clip.asset.path)
      setLoadError(msg)
    }

    video.addEventListener('seeked', handleSeeked)
    video.addEventListener('loadedmetadata', handleLoadedMetadata)
    video.addEventListener('timeupdate', updateBufferCanvas)
    video.addEventListener('loadeddata', updateBufferCanvas)
    video.addEventListener('error', handleError)
    return () => {
      video.removeEventListener('seeked', handleSeeked)
      video.removeEventListener('loadedmetadata', handleLoadedMetadata)
      video.removeEventListener('timeupdate', updateBufferCanvas)
      video.removeEventListener('loadeddata', updateBufferCanvas)
      video.removeEventListener('error', handleError)
    }
  }, [isVideo, clip.asset?.name, clip.asset?.path, clip.isSourceHeld, isPreloading, updateBufferCanvas, updateChromaCanvas, evaluatedEffects.chromaKey])

  const lastLoadedPathRef = useRef<string | null>(null)

  // 1. Set video.src ONLY when the asset path changes (never on playhead tick)
  useEffect(() => {
    const video = videoRef.current
    if (!video || !isVideo || clip.isMissing || !clip.asset?.path) return

    if (lastLoadedPathRef.current === clip.asset.path) return
    lastLoadedPathRef.current = clip.asset.path

    const resolvedUrl = resolveMediaUrl(clip.asset.path)
    setLoadError(null)
    video.src = resolvedUrl
    video.load()
  }, [isVideo, clip.isMissing, clip.asset?.path])

  // 2. Manage seeking and playback without reloading video source
  useEffect(() => {
    const video = videoRef.current
    if (!video || !isVideo || clip.isMissing) return

    const speed = clip.item.speed?.speed ?? 1
    const isReversed = !!clip.item.speed?.reversed
    const targetTime = clip.sourceTime
    if (video.readyState < 1) {
      pendingTargetTimeRef.current = targetTime
      video.muted = true
      return
    }

    if (isPlayingForward && !isReversed && !clip.isSourceHeld && !isPreloading) {
      pendingTargetTimeRef.current = null
      isSeekingRef.current = false
      setIsSeekingState(false)
      video.muted = true
      const clampedRate = Math.max(0.0625, Math.min(16, speed))
      if (video.playbackRate !== clampedRate) {
        video.playbackRate = clampedRate
      }
      if (video.readyState >= 1) {
        if (!video.seeking && Math.abs(video.currentTime - targetTime) > syncTolerance) {
          video.currentTime = targetTime
        }
      } else {
        pendingTargetTimeRef.current = targetTime
      }
      if (video.paused) {
        video.play().catch(() => {})
      }
    } else {
      if (!video.paused) {
        video.pause()
      }
      video.muted = true

      // Rapid & Reverse scrub optimization: RAF throttled seeks
      if (Math.abs(video.currentTime - targetTime) > 0.02) {
        if (rafSeekIdRef.current) {
          cancelAnimationFrame(rafSeekIdRef.current)
        }
        rafSeekIdRef.current = requestAnimationFrame(() => {
          rafSeekIdRef.current = null
          const v = videoRef.current
          if (!v) return
          if (v.seeking || isSeekingRef.current) {
            pendingTargetTimeRef.current = targetTime
          } else {
            isSeekingRef.current = true
            setIsSeekingState(true)
            try {
              if (!clip.isSourceHeld && !isPreloading && typeof (v as any).fastSeek === 'function') {
                ;(v as any).fastSeek(targetTime)
              } else {
                v.currentTime = targetTime
              }
            } catch {
              v.currentTime = targetTime
            }
          }
        })
      }
    }

    return () => {
      if (rafSeekIdRef.current) {
        cancelAnimationFrame(rafSeekIdRef.current)
      }
    }
  }, [clip.sourceTime, clip.item.speed?.speed, clip.item.speed?.reversed, clip.isSourceHeld, isPreloading, isPlayingForward, isVideo, clip.isMissing, syncTolerance])

  const scaleStr = scaleX === scaleY ? `scale(${scaleX})` : `scale(${scaleX}, ${scaleY})`
  const rot3dStr = pitch || yaw ? ` rotateX(${pitch}deg) rotateY(${yaw}deg)` : ''
  const transformOriginStr = anchorX || anchorY ? `calc(50% + ${anchorX}px) calc(50% + ${anchorY}px)` : 'center center'

  const combinedFilterStr =
    (!isAdjustment
      ? [evaluatedEffects.filterStr, adjustmentFilterStr,
        transitionVisual.glitch ? `url(#${glitchFilterId})` : '', transitionFilterStr].filter(Boolean).join(' ')
      : transitionFilterStr) || undefined

  const activeVignette = !isAdjustment ? (evaluatedEffects.vignette || adjustmentVignette) : null

  return (
    <>
    {transitionVisual.glitch && <GlitchFilter id={glitchFilterId} glitch={transitionVisual.glitch} />}
    <div
      className={`preview-layer ${isSelected ? 'selected' : ''}`}
      style={{
        left: '50%',
        top: '50%',
        width: `${baseWidth}px`,
        height: `${baseHeight}px`,
        zIndex,
        visibility: isPreloading ? 'hidden' : undefined,
        opacity,
        mixBlendMode: blendMode as any,
        transformOrigin: transformOriginStr,
        transform: `translate(-50%, -50%) translate(${screenX}px, ${screenY}px) rotate(${rotation}deg)${rot3dStr} ${scaleStr}`,
        clipPath: transitionClipPath || clipPath,
        WebkitClipPath: transitionClipPath || clipPath,
        maskImage: transitionMask,
        WebkitMaskImage: transitionMask,
        filter: combinedFilterStr,
        WebkitFilter: combinedFilterStr,
        cursor: isSelected ? 'move' : 'pointer',
      }}
      onClick={(e) => {
        e.stopPropagation()
        onSelect?.(clip.item.id, e)
      }}
    >
      {clip.isMissing ? (
        <div className="preview-offline-screen">
          <div className="preview-offline-icon">⚠️</div>
          <div className="preview-offline-title">MEDIA OFFLINE</div>
          <div className="preview-offline-filename">{clip.asset.name}</div>
          <div className="preview-offline-path">{clip.asset.path}</div>
        </div>
      ) : isSolid ? (
        <div
          className="preview-solid-element"
          style={{
            width: '100%',
            height: '100%',
            backgroundColor: clip.item.solid?.color || '#3b82f6',
          }}
        />
      ) : isText ? (() => {
        const textObj = clip.item.text
        const textVal = textObj?.text || 'Text Layer'
        const fontSizeVal = (evaluateItemProperty(clip.item, 'fontSize', playheadTime) || textObj?.fontSize || 64) * canvasScale
        const strokeWidthVal = (evaluateItemProperty(clip.item, 'strokeWidth', playheadTime) || textObj?.strokeWidth || 0) * canvasScale

        // Drop shadow
        const shadowActive = textObj?.shadowEnabled ?? (
          !!textObj?.shadowColor &&
          ((textObj?.shadowBlur ?? 0) > 0 || (textObj?.shadowOffsetX ?? 0) !== 0 || (textObj?.shadowOffsetY ?? 0) !== 0)
        )
        const shadowColor = colorWithOpacity(textObj?.shadowColor || '#000000', textObj?.shadowOpacity ?? 0.8)
        const textShadow = shadowActive
          ? `${(textObj?.shadowOffsetX ?? 2) * canvasScale}px ${(textObj?.shadowOffsetY ?? 4) * canvasScale}px ${(textObj?.shadowBlur ?? 10) * canvasScale}px ${shadowColor}`
          : undefined

        // Background
        const bgActive = textObj?.backgroundEnabled ?? (
          !!textObj?.backgroundColor &&
          ((textObj?.backgroundOpacity ?? 0) > 0 || evaluateItemProperty(clip.item, 'backgroundOpacity', playheadTime) > 0)
        )
        const bgOpacityVal = evaluateItemProperty(clip.item, 'backgroundOpacity', playheadTime) ?? textObj?.backgroundOpacity ?? 0.7
        const bgColor = bgActive ? colorWithOpacity(textObj?.backgroundColor || '#000000', bgOpacityVal) : undefined
        const bgStrokeWidth = bgActive ? (textObj?.bgStrokeWidth ?? 0) * canvasScale : 0
        const bgStrokeColor = bgActive && bgStrokeWidth > 0 ? (textObj?.bgStrokeColor || '#ffffff') : undefined
        const padX = bgActive ? ((textObj?.paddingX ?? textObj?.padding ?? 16) * canvasScale) : 0
        const padY = bgActive ? ((textObj?.paddingY ?? textObj?.padding ?? 10) * canvasScale) : 0
        const radius = bgActive ? ((textObj?.cornerRadius ?? 6) * canvasScale) : 0
        const bgOffsetX = bgActive ? ((textObj?.bgOffsetX ?? 0) * canvasScale) : 0
        const bgOffsetY = bgActive ? ((textObj?.bgOffsetY ?? 0) * canvasScale) : 0

        return (
          <div
            className="preview-text-container"
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent:
                textObj?.align === 'left'
                  ? 'flex-start'
                  : textObj?.align === 'right'
                  ? 'flex-end'
                  : 'center',
              textAlign: textObj?.align || 'center',
              pointerEvents: 'none',
            }}
          >
            <div
              className="preview-text-box"
              style={{
                fontFamily: textObj?.fontFamily || 'Inter, sans-serif',
                fontSize: `${fontSizeVal}px`,
                fontWeight: textObj?.fontWeight || '700',
                fontStyle: textObj?.fontStyle || 'normal',
                textDecoration: textObj?.underline ? 'underline' : undefined,
                textTransform: textObj?.textCase && textObj.textCase !== 'none' ? textObj.textCase : undefined,
                color: textObj?.color || '#FFFFFF',
                lineHeight: textObj?.lineHeight || 1.2,
                letterSpacing: textObj?.letterSpacing ? `${textObj.letterSpacing * canvasScale}px` : undefined,
                WebkitTextStroke: strokeWidthVal > 0 ? `${strokeWidthVal}px ${textObj?.strokeColor || '#000000'}` : undefined,
                textShadow,
                backgroundColor: bgColor,
                border: bgActive && bgStrokeWidth > 0 ? `${bgStrokeWidth}px solid ${bgStrokeColor}` : undefined,
                borderRadius: `${radius}px`,
                padding: `${padY}px ${padX}px`,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                maxWidth: '100%',
                boxSizing: 'border-box',
                transform: (bgOffsetX || bgOffsetY) ? `translate(${bgOffsetX}px, ${bgOffsetY}px)` : undefined,
              }}
            >
              <div
                style={{
                  transform: (bgOffsetX || bgOffsetY) ? `translate(${-bgOffsetX}px, ${-bgOffsetY}px)` : undefined,
                  width: '100%',
                  height: '100%',
                }}
              >
                {textVal}
              </div>
            </div>
          </div>
        )
      })() : isCaption ? (() => {
        const capStyle = clip.item.caption?.style
        const fontSizeVal = (capStyle?.fontSize || 48) * canvasScale
        const strokeWidthVal = (capStyle?.strokeWidth || 0) * canvasScale

        // Drop shadow
        const shadowActive = capStyle?.shadowEnabled ?? (
          !!capStyle?.shadowColor &&
          ((capStyle?.shadowBlur ?? 0) > 0 || (capStyle?.shadowOffsetX ?? 0) !== 0 || (capStyle?.shadowOffsetY ?? 0) !== 0)
        )
        const shadowColor = colorWithOpacity(capStyle?.shadowColor || '#000000', capStyle?.shadowOpacity ?? 0.8)
        const textShadow = shadowActive
          ? `${(capStyle?.shadowOffsetX ?? 2) * canvasScale}px ${(capStyle?.shadowOffsetY ?? 4) * canvasScale}px ${(capStyle?.shadowBlur ?? 10) * canvasScale}px ${shadowColor}`
          : undefined

        // Background
        const bgActive = capStyle?.backgroundEnabled ?? (
          !!capStyle?.backgroundColor && ((capStyle?.backgroundOpacity ?? 0) > 0)
        )
        const bgOpacityVal = capStyle?.backgroundOpacity ?? 0.7
        const bgColor = bgActive ? colorWithOpacity(capStyle?.backgroundColor || '#000000', bgOpacityVal) : undefined
        const bgStrokeWidth = bgActive ? (capStyle?.bgStrokeWidth ?? 0) * canvasScale : 0
        const bgStrokeColor = bgActive && bgStrokeWidth > 0 ? (capStyle?.bgStrokeColor || '#ffffff') : undefined
        const padX = bgActive ? ((capStyle?.paddingX ?? capStyle?.padding ?? 16) * canvasScale) : 0
        const padY = bgActive ? ((capStyle?.paddingY ?? capStyle?.padding ?? 10) * canvasScale) : 0
        const radius = bgActive ? ((capStyle?.cornerRadius ?? 6) * canvasScale) : 0
        const bgOffsetX = bgActive ? ((capStyle?.bgOffsetX ?? 0) * canvasScale) : 0
        const bgOffsetY = bgActive ? ((capStyle?.bgOffsetY ?? 0) * canvasScale) : 0

        return (
          <div
            className="preview-caption-container"
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
            }}
          >
            <div
              className="preview-caption-box"
              style={{
                fontFamily: capStyle?.fontFamily || 'Inter, sans-serif',
                fontSize: `${fontSizeVal}px`,
                fontWeight: capStyle?.fontWeight || '600',
                fontStyle: capStyle?.fontStyle || 'normal',
                textDecoration: capStyle?.underline ? 'underline' : undefined,
                textTransform: capStyle?.textCase && capStyle.textCase !== 'none' ? capStyle.textCase : undefined,
                color: capStyle?.color || '#FFFFFF',
                textAlign: capStyle?.align || 'center',
                lineHeight: capStyle?.lineHeight || 1.25,
                letterSpacing: capStyle?.letterSpacing ? `${capStyle.letterSpacing * canvasScale}px` : undefined,
                WebkitTextStroke: strokeWidthVal > 0 ? `${strokeWidthVal}px ${capStyle?.strokeColor || '#000000'}` : undefined,
                textShadow,
                backgroundColor: bgColor,
                border: bgActive && bgStrokeWidth > 0 ? `${bgStrokeWidth}px solid ${bgStrokeColor}` : undefined,
                borderRadius: `${radius}px`,
                padding: `${padY}px ${padX}px`,
                maxWidth: '100%',
                boxSizing: 'border-box',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                transform: (bgOffsetX || bgOffsetY) ? `translate(${bgOffsetX}px, ${bgOffsetY}px)` : undefined,
              }}
            >
              <div
                style={{
                  transform: (bgOffsetX || bgOffsetY) ? `translate(${-bgOffsetX}px, ${-bgOffsetY}px)` : undefined,
                  width: '100%',
                  height: '100%',
                }}
              >
                {clip.item.caption?.words && clip.item.caption.words.length > 0 ? (
                  <CaptionWords words={clip.item.caption.words} playheadTime={playheadTime} scale={canvasScale} activeColor={clip.item.caption.activeWordColor} presentation={clip.item.caption.presentation} />
                ) : (
                  clip.item.caption?.text || 'Subtitle Caption'
                )}
              </div>
            </div>
          </div>
        )
      })() : isAdjustment ? (
        <div
          className="preview-adjustment-element"
          style={{
            width: '100%',
            height: '100%',
            backdropFilter: evaluatedEffects.filterStr || 'none',
            WebkitBackdropFilter: evaluatedEffects.filterStr || 'none',
            pointerEvents: 'none',
          }}
        >
          {evaluatedEffects.vignette && (
            <div
              className="preview-vignette-overlay"
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                pointerEvents: 'none',
                background: `radial-gradient(circle, transparent ${evaluatedEffects.vignette.radius}%, rgba(0,0,0,${evaluatedEffects.vignette.amount / 100}) 100%)`,
              }}
            />
          )}
        </div>
      ) : isVideo ? (
        loadError ? (
          <div className="preview-offline-screen">
            <div className="preview-offline-icon">⚠️</div>
            <div className="preview-offline-title">VIDEO PLAYBACK ERROR</div>
            <div className="preview-offline-filename">{clip.asset.name}</div>
            <div style={{ fontSize: '11px', color: '#fca5a5', marginTop: '6px' }}>{loadError}</div>
          </div>
        ) : (
          <>
            <canvas
              ref={bufferCanvasRef}
              className="preview-video-element buffer-canvas"
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: 'fill',
                pointerEvents: 'none',
                zIndex: 1,
              }}
            />
            <video
              ref={videoRef}
              className="preview-video-element"
              playsInline
              preload="auto"
              crossOrigin="anonymous"
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: 'fill',
                pointerEvents: 'none',
                zIndex: isSeekingState || evaluatedEffects.chromaKey ? 0 : 2,
                opacity: evaluatedEffects.chromaKey ? 0 : 1,
              }}
            />
            {evaluatedEffects.chromaKey && (
              <canvas
                ref={chromaCanvasRef}
                className="preview-video-element chroma-canvas"
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'fill',
                  pointerEvents: 'none',
                  zIndex: 3,
                }}
              />
            )}
          </>
        )
      ) : isImage ? (
        <>
          <img
            ref={imageRef}
            className="preview-image-element"
            crossOrigin="anonymous"
            src={resolveMediaUrl(clip.asset.path)}
            alt={clip.asset.name}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'fill',
              display: evaluatedEffects.chromaKey ? 'none' : 'block',
            }}
          />
          {evaluatedEffects.chromaKey && (
            <canvas
              ref={chromaCanvasRef}
              className="preview-image-element chroma-canvas"
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'fill',
                pointerEvents: 'none',
                zIndex: 3,
              }}
            />
          )}
        </>
      ) : null}

      {transitionVisual.whiteOpacity > 0 && <div className="preview-transition-white"
        style={{ position: 'absolute', inset: 0, background: '#fff', opacity: transitionVisual.whiteOpacity, pointerEvents: 'none', zIndex: 5 }} />}

      {!isAdjustment && activeVignette && (
        <div
          className="preview-vignette-overlay"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            background: `radial-gradient(circle, transparent ${activeVignette.radius}%, rgba(0,0,0,${activeVignette.amount / 100}) 100%)`,
          }}
        />
      )}
    </div>
    </>
  )
})

