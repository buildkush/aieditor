import { useRef, useState, useEffect, useCallback } from 'react'
import type { ProjectState } from '../../core/project/projectState'
import type { TimelineItem } from '../../core/timeline/types'
import { captionPlaybackTolerance } from '../../core/captions/playbackTiming'
import type { EditorCommand } from '../../core/commands/editorCommand'
import {
  SelectItemCommand,
  UpdateTransformCommand,
  RemoveTimelineItemCommand,
  SetPlayheadCommand,
} from '../../core/commands/editorCommand'
import { DEFAULT_TRANSFORM } from '../../core/timeline/types'
import { formatTimecode } from '../../core/timecode'
import { usePlayer } from './usePlayer'
import { getPlaybackFrameInfo, type ActiveTransition } from '../../core/playback/timelinePlayback'
import { VideoLayerItem } from './VideoLayerItem'
import { AudioLayerItem } from './AudioLayerItem'
import { CanvasTransformOverlay } from './CanvasTransformOverlay'
import { evaluateItemEffects } from '../../core/timeline/effectEvaluation'
import { getPreviewLayerDimensions } from './previewLayerDimensions'
import { createPreviewWheelHandler } from './previewWheel'
import './PreviewPanel.css'

interface PreviewPanelProps {
  state: ProjectState
  dispatch: (command: EditorCommand) => void
  player?: ReturnType<typeof usePlayer>
  zoomLinked?: boolean
  readOnly?: boolean
  previewCaptions?: TimelineItem[]
}

/**
 * Preview panel.
 * Displays composited real media video frames / images corresponding to timeline playhead
 * within a fixed aspect-ratio project frame (horizontal or vertical), resizing dynamically
 * to take the maximum available preview area.
 * Docked full-width transport bar at the bottom ensures controls never cover the video.
 */
export function PreviewPanel({ state, dispatch, player: externalPlayer, zoomLinked = true, readOnly = false, previewCaptions }: PreviewPanelProps) {
  const { settings, playheadTime, items, selectedItemId } = state
  const fps = settings.fps || 30
  const projectWidth = settings.width || 1920
  const projectHeight = settings.height || 1080
  const projectAspect = projectWidth / projectHeight

  const stageRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [stageSize, setStageSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 })
  const [showTransformOverlay, setShowTransformOverlay] = useState(!readOnly)
  const [canvasSnapping, setCanvasSnapping] = useState(true)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [viewportZoom, setViewportZoom] = useState<number>(1.0) // 1.0 = Fit
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const viewportZoomRef = useRef(viewportZoom)
  viewportZoomRef.current = viewportZoom
  const panOffsetRef = useRef(panOffset)
  panOffsetRef.current = panOffset
  const [isPanning, setIsPanning] = useState(false)
  const panStartRef = useRef<{ clientX: number; clientY: number; startPanX: number; startPanY: number } | null>(null)
  const isSpacePressedRef = useRef(false)

  const resetZoomPan = useCallback(() => {
    setViewportZoom(1.0)
    setPanOffset({ x: 0, y: 0 })
  }, [])

  const handleToggleFullscreen = useCallback(async () => {
    const el = panelRef.current || stageRef.current
    if (!el) return

    if (!document.fullscreenElement && !isFullscreen) {
      try {
        if (el.requestFullscreen) {
          await el.requestFullscreen()
          setIsFullscreen(true)
        }
      } catch (err) {
        try {
          const { getCurrentWindow } = await import('@tauri-apps/api/window')
          await getCurrentWindow().setFullscreen(true)
          setIsFullscreen(true)
        } catch {
          setIsFullscreen(true)
        }
      }
    } else {
      try {
        if (document.fullscreenElement) {
          await document.exitFullscreen()
        }
      } catch {
        // ignore
      }
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window')
        if (await getCurrentWindow().isFullscreen()) {
          await getCurrentWindow().setFullscreen(false)
        }
      } catch {
        // ignore
      }
      setIsFullscreen(false)
    }
  }, [isFullscreen])

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement)
    }
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])

  // Listen on the stage itself so header/transport gestures don't move the canvas.
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return

    const onWheel = createPreviewWheelHandler(
      () => ({ zoom: viewportZoomRef.current, pan: panOffsetRef.current }),
      ({ zoom, pan }) => {
        // A burst of wheel events can arrive before React renders again.
        // Advance both refs immediately so every pinch delta accumulates.
        viewportZoomRef.current = zoom
        panOffsetRef.current = pan
        setViewportZoom(zoom)
        setPanOffset(pan)
      },
      () => stage.getBoundingClientRect(),
    )
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => stage.removeEventListener('wheel', onWheel)
  }, [])

  // Multi-touch gestures for touchscreens (trackpads use the wheel handler above)
  useEffect(() => {
    const el = stageRef.current
    if (!el) return

    // Tauri webviews support Pointer Events; use one path for touchscreen gestures.
    const activePointers = new Map<number, { x: number; y: number }>()
    let pointerStartDist = 0
    let pointerStartZoom = 1.0
    let pointerStartPan = { x: 0, y: 0 }
    let pointerStartMid = { x: 0, y: 0 }

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'touch' || e.pointerType === 'pen') {
        activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
        if (activePointers.size === 2) {
          const pts = Array.from(activePointers.values())
          pointerStartDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y)
          pointerStartZoom = viewportZoomRef.current
          pointerStartPan = { ...panOffsetRef.current }
          pointerStartMid = {
            x: (pts[0].x + pts[1].x) / 2,
            y: (pts[0].y + pts[1].y) / 2,
          }
        }
      }
    }

    const onPointerMove = (e: PointerEvent) => {
      if (activePointers.has(e.pointerId)) {
        activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
        if (activePointers.size === 2) {
          e.preventDefault()
          const pts = Array.from(activePointers.values())
          const currDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y)
          if (pointerStartDist > 0) {
            const scale = currDist / pointerStartDist
            const nextZoom = Math.min(10.0, Math.max(0.1, Math.round(pointerStartZoom * scale * 100) / 100))
            setViewportZoom(nextZoom)
          }
          const currMidX = (pts[0].x + pts[1].x) / 2
          const currMidY = (pts[0].y + pts[1].y) / 2
          const dx = currMidX - pointerStartMid.x
          const dy = currMidY - pointerStartMid.y
          setPanOffset({
            x: Math.round(pointerStartPan.x + dx),
            y: Math.round(pointerStartPan.y + dy),
          })
        }
      }
    }

    const onPointerUp = (e: PointerEvent) => {
      activePointers.delete(e.pointerId)
      if (activePointers.size < 2) {
        pointerStartDist = 0
      }
    }

    el.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointermove', onPointerMove, { passive: false })
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)

    return () => {
      el.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
    }
  }, [])

  // Spacebar hand tool detection
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && (e.target as HTMLElement)?.tagName !== 'INPUT' && (e.target as HTMLElement)?.tagName !== 'TEXTAREA') {
        isSpacePressedRef.current = true
      }
    }
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        isSpacePressedRef.current = false
        setIsPanning(false)
        panStartRef.current = null
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [])

  const handleStagePointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Middle click, Space+left click, OR left click directly on stage background
      const isStageBgClick = e.button === 0 && (e.target === stageRef.current || (e.target as HTMLElement)?.classList?.contains('preview-stage'))
      if (e.button === 1 || (e.button === 0 && isSpacePressedRef.current) || isStageBgClick) {
        e.preventDefault()
        e.stopPropagation()
        setIsPanning(true)
        panStartRef.current = {
          clientX: e.clientX,
          clientY: e.clientY,
          startPanX: panOffset.x,
          startPanY: panOffset.y,
        }
        try {
          e.currentTarget.setPointerCapture(e.pointerId)
        } catch {
          // fallback
        }
      }
    },
    [panOffset]
  )

  const handleStagePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (isPanning && panStartRef.current) {
        const dx = e.clientX - panStartRef.current.clientX
        const dy = e.clientY - panStartRef.current.clientY
        setPanOffset({
          x: Math.round(panStartRef.current.startPanX + dx),
          y: Math.round(panStartRef.current.startPanY + dy),
        })
      }
    },
    [isPanning]
  )

  const handleStagePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (isPanning) {
        setIsPanning(false)
        panStartRef.current = null
        try {
          e.currentTarget.releasePointerCapture(e.pointerId)
        } catch {
          // fallback
        }
      }
    },
    [isPanning]
  )

  useEffect(() => {
    const el = stageRef.current
    if (!el) return

    const updateSize = () => {
      const rect = el.getBoundingClientRect()
      // Leave room for the round handles and rotation control at Fit.
      const inset = showTransformOverlay ? 48 : 12
      const availableWidth = Math.max(0, rect.width - inset * 2)
      const availableHeight = Math.max(0, rect.height - inset * 2)
      setStageSize({ width: availableWidth, height: availableHeight })
    }

    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(el)
    return () => observer.disconnect()
  }, [showTransformOverlay])

  // Calculate maximum canvas dimensions inside the stage while strictly preserving project aspect ratio
  let canvasWidth = stageSize.width
  let canvasHeight = stageSize.height
  if (stageSize.width > 0 && stageSize.height > 0) {
    const stageAspect = stageSize.width / stageSize.height
    if (stageAspect > projectAspect) {
      // Stage is wider than target aspect ratio -> height-constrained
      canvasHeight = stageSize.height
      canvasWidth = Math.round(canvasHeight * projectAspect)
    } else {
      // Stage is taller than target aspect ratio -> width-constrained
      canvasWidth = stageSize.width
      canvasHeight = Math.round(canvasWidth / projectAspect)
    }
  }

  const canvasScale = canvasWidth > 0 && projectWidth > 0 ? canvasWidth / projectWidth : 1

  const contentDuration = Object.values(items).reduce(
    (max, item) => Math.max(max, item.startTime + item.duration),
    0
  )

  const localPlayer = usePlayer({
    playheadTime,
    contentDuration,
    timelineDuration: Math.max(30, contentDuration),
    fps,
    dispatch,
    previewContainerRef: stageRef,
  })

  const player = externalPlayer ?? localPlayer
  const isPlayingForward = player.playbackMode === 'forward'

  // Resolve current active video/image and audio items at playhead
  const frameInfo = getPlaybackFrameInfo(state, playheadTime)
  const activeVideos = previewCaptions ? [
    ...frameInfo.activeVideos.filter(clip => !clip.item.caption),
    ...previewCaptions.filter(item => playheadTime >= item.startTime && playheadTime < item.startTime + item.duration).map(item => ({ item,
      asset: { id: item.id, name: 'Caption preview', path: '', type: 'caption' as const }, sourceTime: playheadTime - item.startTime,
      isMissing: false, track: { id: item.trackId, name: 'Caption preview', type: 'caption' as const } })),
  ] : frameInfo.activeVideos
  const activeAudio = frameInfo.activeAudio
  const hasCaptions = !!previewCaptions || state.tracks.some(track => track.type === 'caption' && track.visible !== false)

  // Find currently selected clip if active at playhead
  const selectedClip = selectedItemId && !state.selectedTransitionId
    ? activeVideos.find((c) => c.item.id === selectedItemId)
    : null

  const handleSelectClip = useCallback(
    (itemId: string) => {
      if (!readOnly) dispatch(new SelectItemCommand(itemId))
    },
    [dispatch, readOnly]
  )

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent) => {
      if (!readOnly && e.target === e.currentTarget) {
        dispatch(new SelectItemCommand(null))
      }
    },
    [dispatch, readOnly]
  )

  const handleCanvasKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (readOnly || !selectedItemId || state.selectedTransitionId) return
      const item = state.items[selectedItemId]
      if (!item) return

      const step = e.shiftKey ? 10 : 1
      let dx = 0
      let dy = 0

      if (e.key === 'ArrowLeft') dx = -step
      else if (e.key === 'ArrowRight') dx = step
      else if (e.key === 'ArrowUp') dy = -step
      else if (e.key === 'ArrowDown') dy = step
      else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        e.stopPropagation()
        dispatch(new RemoveTimelineItemCommand(item.id))
        return
      }

      if (dx !== 0 || dy !== 0) {
        e.preventDefault()
        e.stopPropagation()
        const current = item.transform || DEFAULT_TRANSFORM
        dispatch(
          new UpdateTransformCommand(item.id, {
            x: current.x + dx,
            y: current.y + dy,
          })
        )
      }
    },
    [selectedItemId, state.items, state.selectedTransitionId, dispatch, readOnly]
  )

  const progressTrackRef = useRef<HTMLDivElement | null>(null)
  const isScrubbingRef = useRef(false)
  const [hoverScrub, setHoverScrub] = useState<{ percent: number; time: number } | null>(null)

  const effectiveDuration = contentDuration > 0 ? contentDuration : 1
  const progressPercent = Math.min(100, Math.max(0, (playheadTime / effectiveDuration) * 100))

  const getTimeFromPointerEvent = useCallback(
    (e: React.PointerEvent) => {
      if (!progressTrackRef.current) return 0
      const rect = progressTrackRef.current.getBoundingClientRect()
      if (rect.width <= 0) return 0
      const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
      const rawTime = ratio * effectiveDuration
      const safeFps = state.settings.fps > 0 ? state.settings.fps : 30
      return Math.round(rawTime * safeFps) / safeFps
    },
    [effectiveDuration, state.settings.fps]
  )

  const handleProgressPointerDown = useCallback(
    (e: React.PointerEvent) => {
      isScrubbingRef.current = true
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        // pointer capture fallback
      }
      const targetTime = getTimeFromPointerEvent(e)
      dispatch(new SetPlayheadCommand(targetTime))
    },
    [getTimeFromPointerEvent, dispatch]
  )

  const handleProgressPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!progressTrackRef.current) return
      const rect = progressTrackRef.current.getBoundingClientRect()
      if (rect.width <= 0) return
      const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
      const safeFps = state.settings.fps > 0 ? state.settings.fps : 30
      const targetTime = Math.round(ratio * effectiveDuration * safeFps) / safeFps

      if (isScrubbingRef.current) {
        dispatch(new SetPlayheadCommand(targetTime))
      }

      setHoverScrub({
        percent: ratio * 100,
        time: targetTime,
      })
    },
    [effectiveDuration, state.settings.fps, dispatch]
  )

  const handleProgressPointerUp = useCallback((e: React.PointerEvent) => {
    if (isScrubbingRef.current) {
      isScrubbingRef.current = false
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        // no-op
      }
    }
  }, [])

  const handleProgressPointerLeave = useCallback(() => {
    if (!isScrubbingRef.current) {
      setHoverScrub(null)
    }
  }, [])

  return (
    <div className={`preview-panel-container ${isFullscreen ? 'is-fullscreen' : ''}`} ref={panelRef}>
      {/* Pinned Top Panel Header */}
      <div className="panel-header preview-panel-header">
        <span className="panel-header-title">Preview</span>
        <div className="preview-header-controls">
          <button type="button" className={`preview-zoom-btn ${canvasSnapping ? 'active' : ''}`}
            aria-label="Canvas snapping" aria-pressed={canvasSnapping}
            title="Snap clip edges and center to the video frame (hold Alt to bypass)"
            onClick={() => setCanvasSnapping(enabled => !enabled)}>Snap</button>
          {/* Viewport Zoom & Pan Controls */}
          <div className="preview-zoom-selector">
            <button
              type="button"
              className={`preview-zoom-btn ${viewportZoom === 1.0 && panOffset.x === 0 && panOffset.y === 0 ? 'active' : ''}`}
              onClick={resetZoomPan}
              title="Fit to Screen (Double-click stage to reset)"
            >
              Fit
            </button>
            <button
              type="button"
              className="preview-zoom-btn"
              onClick={() => setViewportZoom((prev) => Math.max(0.25, Math.round(prev * 0.8 * 100) / 100))}
              title="Zoom Out (Ctrl+Wheel down)"
            >
              −
            </button>
            <span className="preview-zoom-label" title="Hold Ctrl+Wheel or trackpad pinch to zoom">
              {Math.round(viewportZoom * 100)}%
            </span>
            <button
              type="button"
              className="preview-zoom-btn"
              onClick={() => setViewportZoom((prev) => Math.min(8.0, Math.round(prev * 1.25 * 100) / 100))}
              title="Zoom In (Ctrl+Wheel up)"
            >
              +
            </button>
          </div>
          <span className="preview-resolution">
            {projectWidth}×{projectHeight} · {fps}fps
          </span>
        </div>
      </div>

      {/* Main Preview Stage (Fills complete area between header and transport) */}
      <div
        className="preview-stage"
        ref={stageRef}
        onPointerDown={handleStagePointerDown}
        onPointerMove={handleStagePointerMove}
        onPointerUp={handleStagePointerUp}
        onDoubleClick={resetZoomPan}
        style={{
          cursor: isPanning ? 'grabbing' : isSpacePressedRef.current ? 'grab' : undefined,
        }}
        title="Pinch trackpad or Ctrl+wheel to zoom • Drag background or swipe 2 fingers to move • Double-click to reset Fit"
      >
        <div
          className="preview-canvas"
          tabIndex={0}
          onClick={handleCanvasClick}
          onKeyDown={handleCanvasKeyDown}
          style={{
            width: canvasWidth > 0 ? `${canvasWidth}px` : '100%',
            height: canvasHeight > 0 ? `${canvasHeight}px` : '100%',
            transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${viewportZoom})`,
            transformOrigin: 'center center',
            outline: 'none',
          }}
        >
          {/* Inner clipped viewport for visual media content */}
          <div className="preview-canvas-viewport">
            {[...activeVideos, ...(frameInfo.preloadVideos ?? [])].map((clip, index) => {
                // Find all active adjustment layers on tracks above this clip
                const adjustmentLayersAbove = activeVideos.slice(index + 1).filter(
                  (c) => c.item.itemType === 'adjustment'
                )
                const adjustmentFilters: string[] = []
                let adjustmentVignette: { amount: number; radius: number } | null = null
                let adjustmentTransition: ActiveTransition | null = null

                for (const adj of adjustmentLayersAbove) {
                  const adjFX = evaluateItemEffects(adj.item, playheadTime, canvasScale)
                  if (adjFX.filterStr) {
                    adjustmentFilters.push(adjFX.filterStr)
                  }
                  if (adjFX.vignette && !adjustmentVignette) {
                    adjustmentVignette = adjFX.vignette
                  }
                  if (!adjustmentTransition) {
                    const tr = frameInfo.activeTransitions?.find(
                      (at) => at.transition.trackId === adj.track.id
                    )
                    if (tr) adjustmentTransition = tr
                  }
                }

                const clipTransition = frameInfo.activeTransitions?.find(
                  (at) =>
                    at.transition.trackId === clip.track.id &&
                    (at.transition.leftClipId === clip.item.id ||
                      at.transition.rightClipId === clip.item.id ||
                      (!at.transition.leftClipId && !at.transition.rightClipId))
                ) ?? null

                return (
                  <VideoLayerItem
                    key={clip.item.id}
                    clip={clip}
                    isPlayingForward={isPlayingForward}
                    playheadTime={playheadTime}
                    syncTolerance={captionPlaybackTolerance(hasCaptions, clip.item.speed?.speed ?? 1)}
                    zIndex={index + 1}
                    canvasScale={canvasScale}
                    projectWidth={projectWidth}
                    projectHeight={projectHeight}
                    activeTransition={clipTransition}
                    adjustmentFilterStr={adjustmentFilters.length > 0 ? adjustmentFilters.join(' ') : undefined}
                    adjustmentVignette={adjustmentVignette}
                    adjustmentTransition={adjustmentTransition}
                    onSelect={handleSelectClip}
                    isPreloading={index >= activeVideos.length}
                    isSelected={!readOnly && index < activeVideos.length && clip.item.id === selectedItemId}
                  />
                )
              })}
            {activeVideos.length === 0 && (
              <div className="preview-empty">
                <span className="preview-empty-icon">⬛</span>
                <span>No clip at playhead</span>
                <span className="preview-empty-dims">
                  {projectWidth} × {projectHeight}
                </span>
              </div>
            )}
          </div>

          {/* Simultaneous multi-track audio players */}
          {activeAudio.map((clip) => (
            <AudioLayerItem
              key={clip.item.id}
              clip={clip}
              isPlayingForward={isPlayingForward}
              playheadTime={playheadTime}
              syncTolerance={captionPlaybackTolerance(hasCaptions, clip.item.speed?.speed ?? 1)}
            />
          ))}
        </div>
        {/* Workspace overlay: outside the clipped video and viewport scaling. */}
        {!readOnly && selectedClip && showTransformOverlay && (() => {
          const dimensions = getPreviewLayerDimensions(
            selectedClip.item, selectedClip.asset, projectWidth, projectHeight, playheadTime,
          )
          return <CanvasTransformOverlay
            key={selectedClip.item.id}
            item={selectedClip.item}
            playheadTime={playheadTime}
            assetWidth={dimensions.width}
            assetHeight={dimensions.height}
            canvasScale={canvasScale}
            viewportZoom={viewportZoom}
            panOffset={panOffset}
            projectWidth={projectWidth}
            projectHeight={projectHeight}
            snappingEnabled={canvasSnapping}
            zoomLinked={zoomLinked}
            dispatch={dispatch}
          />
        })()}
      </div>

      {/* Full-Width Docked Bottom Transport Controls (Never covers video) */}
      <div className="preview-footer-transport">
        {/* Full-Width Interactive Playback Progress & Scrubber Track */}
        <div
          className="preview-progress-track"
          ref={progressTrackRef}
          onPointerDown={handleProgressPointerDown}
          onPointerMove={handleProgressPointerMove}
          onPointerUp={handleProgressPointerUp}
          onPointerLeave={handleProgressPointerLeave}
          title="Click or drag to seek playhead"
          role="slider"
          tabIndex={0}
          onKeyDown={event => {
            const offsets: Record<string, number> = { ArrowLeft: -1 / fps, ArrowRight: 1 / fps, PageDown: -1, PageUp: 1 }
            if (!(event.key in offsets) && event.key !== 'Home' && event.key !== 'End') return
            event.preventDefault(); event.stopPropagation(); player.stop()
            const time = event.key === 'Home' ? 0 : event.key === 'End' ? effectiveDuration : playheadTime + offsets[event.key]
            dispatch(new SetPlayheadCommand(Math.max(0, Math.min(effectiveDuration, time))))
          }}
          aria-label="Playback progress"
          aria-valuemin={0}
          aria-valuemax={effectiveDuration}
          aria-valuenow={playheadTime}
        >
          <div
            className="preview-progress-fill"
            style={{ width: `${progressPercent}%` }}
          />
          <div
            className="preview-progress-thumb"
            style={{ left: `${progressPercent}%` }}
          />
          {hoverScrub && (
            <div
              className="preview-progress-tooltip"
              style={{ left: `${hoverScrub.percent}%` }}
            >
              {formatTimecode(hoverScrub.time, fps)}
            </div>
          )}
        </div>

        <div className="preview-transport-left">
          {!readOnly && <button
            className={`transport-btn ${showTransformOverlay ? 'active' : ''}`}
            onClick={() => setShowTransformOverlay((prev) => !prev)}
            title={showTransformOverlay ? 'Transform Overlay: ON (Click to hide handles)' : 'Transform Overlay: OFF (Click to show handles)'}
            aria-label="Toggle Transform Mode"
          >
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="2.5" y="2.5" width="11" height="11" strokeDasharray="2 2" rx="1.5" />
              <rect x="1" y="1" width="3.5" height="3.5" fill="currentColor" rx="0.5" />
              <rect x="11.5" y="1" width="3.5" height="3.5" fill="currentColor" rx="0.5" />
              <rect x="11.5" y="11.5" width="3.5" height="3.5" fill="currentColor" rx="0.5" />
              <rect x="1" y="11.5" width="3.5" height="3.5" fill="currentColor" rx="0.5" />
            </svg>
          </button>}
          <span className="preview-timecode">{formatTimecode(playheadTime, fps)}</span>
        </div>

        <div className="preview-controls">
          <button
            className="transport-btn"
            onClick={player.stop}
            title="Stop"
            aria-label="Stop"
          >
            <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
              <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
            </svg>
          </button>
          <button
            className={`transport-btn primary ${player.playbackMode === 'forward' ? 'active' : ''}`}
            onClick={player.togglePlay}
            title="Play/Pause (Space)"
            aria-label="Play/Pause"
          >
            {player.playbackMode === 'forward' ? (
              <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
                <rect x="3" y="2.5" width="3.5" height="11" rx="1" />
                <rect x="9.5" y="2.5" width="3.5" height="11" rx="1" />
              </svg>
            ) : (
              <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
                <polygon points="4,2.5 13.5,8 4,13.5" />
              </svg>
            )}
          </button>
          <button
            className={`transport-btn ${player.isLooping ? 'active' : ''}`}
            onClick={player.toggleLoop}
            title={player.isLooping ? 'Loop Playback (Enabled)' : 'Loop Playback (Disabled)'}
            aria-label="Loop Playback"
          >
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11.5 2.5l2 2-2 2" />
              <path d="M2.5 7.5V6a2.5 2.5 0 012.5-2.5h8.5" />
              <path d="M4.5 13.5l-2-2 2-2" />
              <path d="M13.5 8.5V10a2.5 2.5 0 01-2.5 2.5H2.5" />
            </svg>
          </button>
        </div>

        <div className="preview-transport-right">
          <span className="preview-duration">{formatTimecode(contentDuration, fps)}</span>
          <button
            className={`transport-btn ${isFullscreen ? 'active' : ''}`}
            onClick={handleToggleFullscreen}
            title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen Preview'}
            aria-label={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen Preview'}
          >
            {isFullscreen ? (
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5.5 2v3.5H2M10.5 2v3.5H14M2 10.5h3.5V14M14 10.5h-3.5V14" />
              </svg>
            ) : (
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 5.5V2.5h3M11 2.5h3v3M14 10.5v3h-3M5 13.5H2v-3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
