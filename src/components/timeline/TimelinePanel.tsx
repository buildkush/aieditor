import { resolveTransitionDrop } from '../../core/timeline/transitionPlacement'
import { useCallback, useRef, useState, useEffect } from 'react'
import type { ProjectState } from '../../core/project/projectState'
import type { EditorCommand } from '../../core/commands/editorCommand'
import {
  SelectItemCommand,
  SelectItemsCommand,
  SetPlayheadCommand,
  RemoveTimelineItemCommand,
  RemoveTimelineItemsCommand,
  SplitTimelineItemCommand,
  SplitTimelineItemsCommand,
  MoveTimelineItemCommand,
  MoveTimelineItemsCommand,
  TrimTimelineItemCommand,
  TrimTimelineItemsCommand,
  AddTimelineItemCommand,
  AddTimelineItemPairCommand,
  LinkTimelineItemsCommand,
  UnlinkTimelineItemsCommand,
  RemoveTrackCommand,
  CleanupEmptyTracksCommand,
  AddTextLayerCommand,
  AddSolidLayerCommand,
  AddCaptionCommand,
  AddAdjustmentLayerCommand,
  ImportSubtitlesCommand,
  ApplyEffectCommand,
  AddTransitionCommand,
  RemoveTransitionCommand,
  UpdateTransitionCommand,
  SelectTransitionCommand,
} from '../../core/commands/editorCommand'
import {
  computeDragPreview,
  type DragPreview,
} from '../../core/timeline/dragPreview'
import {
  DEFAULT_TRANSFORM,
  DEFAULT_TEXT_PROPERTIES,
  isTrackCompatible,
  getItemEffectiveType,
  type ItemEffect,
  type TimelineItem,
  type TimelineTransition,
} from '../../core/timeline/types'
import { formatTimecode } from '../../core/timecode'
import { generateId } from '../../core/utils'
import { getActiveDraggedAsset } from '../media/activeDragAsset'
import {
  getActiveDraggedTool,
  setActiveDraggedTool,
  type LayerToolDragData,
  type TransitionToolDragData,
} from '../tools/activeDragTool'
import {
  resolveTargetTrackFromY,
  getCorrespondingLayerTrack,
  type TrackLaneBounds,
} from '../../core/timeline/trackDetection'
import { computeTimelineDuration } from '../editor/timelineSizing'
import {
  collectSnapTargets,
  snapTimeToTargets,
  DEFAULT_SNAP_THRESHOLD_PIXELS,
  START_SNAP_THRESHOLD_PIXELS,
} from '../../core/timeline/snapping'
import { TimelineFilmstrip } from './TimelineFilmstrip'
import { TimelineWaveform } from './TimelineWaveform'
import {
  getLinkedItemIdsForState,
  computeTransitionTrim,
  DEFAULT_TRANSITION_DURATION,
} from '../../core/commands/projectCommands'
import './TimelinePanel.css'

interface TimelinePanelProps {
  state: ProjectState
  dispatch: (command: EditorCommand) => void
  canUndo?: boolean
  canRedo?: boolean
  onUndo?: () => void
  onRedo?: () => void
  onEffectApplied?: () => void
}

const PIXELS_PER_SECOND = 40
const AUTO_SCROLL_EDGE_ZONE = 60
const AUTO_SCROLL_MAX_SPEED = 24

/**
 * Functional Timeline Panel.
 *
 * Enforces unified coordinate space between ruler and track lanes.
 * Supports:
 * - Single-click seeking and continuous scrubbing (never pollutes undo)
 * - Live drag-to-move horizontally & vertically with same-track overwrite preview
 * - Live vertical destination preview with automatic new-track creation
 * - Edge trimming (left & right handles) with source boundary clamping
 * - 1 Drag / Trim = Exactly 1 Undo command on mouse release
 * - Direct Media Library drag & drop onto timeline with ghost preview
 * - Smooth viewport horizontal auto-scrolling during drag
 * - Pinned track labels and timer readout (fixed UI vs scrolling timeline)
 * - Split at playhead (S), Delete selected (Delete)
 * - Precise timecode representation (HH:MM:SS:FF)
 */
export function TimelinePanel({
  state,
  dispatch,
  canUndo: _canUndo = false,
  canRedo: _canRedo = false,
  onUndo: _onUndo,
  onRedo: _onRedo,
  onEffectApplied,
}: TimelinePanelProps) {
  const { playheadTime, selectedItemId, settings } = state
  const fps = settings.fps || 30

  const viewportRef = useRef<HTMLDivElement>(null)
  const headersRef = useRef<HTMLDivElement>(null)
  const lanesRef = useRef<HTMLDivElement>(null)

  // ──── Dragging States ────
  const [moveDrag, setMoveDrag] = useState<{
    itemId: string
    startX: number
    grabOffset: number
    originalStartTime: number
    currentStartTime: number
    targetTrackId: string
    partnerTargetTrackId?: string
    // Tracks all items moving together (multi-selection and/or linked)
    draggedItems: {
      itemId: string
      originalStartTime: number
      originalTrackId: string
      duration: number
    }[]
  } | null>(null)

  const [trimDrag, setTrimDrag] = useState<{
    itemId: string
    edge: 'left' | 'right'
    startX: number
    originalStartTime: number
    originalDuration: number
    currentNewTime: number
    // Linked items to trim proportionally/synchronously
    linkedPartners: {
      itemId: string
      originalStartTime: number
      originalDuration: number
    }[]
  } | null>(null)

  const [mediaDrag, setMediaDrag] = useState<{
    assetId: string
    assetType: string
    assetName: string
    thumbnailUrl?: string
    path?: string
    duration: number
    currentStartTime: number
    targetTrackId: string
    isCompatible: boolean
  } | null>(null)

  const [toolDrag, setToolDrag] = useState<{
    tool: LayerToolDragData
    targetTrackId: string
    currentStartTime: number
    duration: number
    isCompatible: boolean
  } | null>(null)

  const [effectDropTarget, setEffectDropTarget] = useState<{
    itemId: string
    isCompatible: boolean
  } | null>(null)

  const [marquee, setMarquee] = useState<{
    startX: number
    startY: number
    currentX: number
    currentY: number
    left: number
    top: number
    width: number
    height: number
    isShift: boolean
    initialSelectedIds: string[]
    clickTime: number
  } | null>(null)

  const [isScrubbing, setIsScrubbing] = useState(false)
  const [isSnapping, setIsSnapping] = useState(true)
  const [snapIndicatorTime, setSnapIndicatorTime] = useState<number | null>(null)
  const [hoveredTrackId, setHoveredTrackId] = useState<string | null>(null)
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null)

  // Transition Drag & Interaction States
  const [transitionDrag, setTransitionDrag] = useState<{
    transition: TransitionToolDragData
    alignment?: TimelineTransition['alignment']
    targetTrackId: string
    startTime: number
    duration: number
    leftClipId?: string
    rightClipId?: string
  } | null>(null)

  const [transitionInteraction, setTransitionInteraction] = useState<{
    transitionId: string
    mode: 'trim-left' | 'trim-right'
    startX: number
    originalStartTime: number
    originalDuration: number
    currentStartTime: number
    currentDuration: number
  } | null>(null)

  // Context Menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    type: 'clip' | 'track' | 'transition'
    clipId?: string
    trackId?: string
    transitionId?: string
  } | null>(null)

  // Interactive Razor / Split Tool Mode state
  const [isSplitToolActive, setIsSplitToolActive] = useState(false)
  const [splitHover, setSplitHover] = useState<{ time: number; x: number } | null>(null)

  // Close context menu on any outside click or ESC
  useEffect(() => {
    if (!contextMenu) return
    const handleClick = () => setContextMenu(null)
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null)
    }
    window.addEventListener('mousedown', handleClick)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('mousedown', handleClick)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [contextMenu])

  // Add Layer Menu State
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false)
  const addMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isAddMenuOpen) return
    const handleClick = (e: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
        setIsAddMenuOpen(false)
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsAddMenuOpen(false)
    }
    window.addEventListener('mousedown', handleClick)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('mousedown', handleClick)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isAddMenuOpen])

  // Helper: get all connected/linked items
  const getLinkedItemIds = useCallback((itemId: string): string[] => {
    const visited = new Set<string>()
    const queue = [itemId]
    while (queue.length > 0) {
      const cur = queue.shift()!
      if (!visited.has(cur)) {
        visited.add(cur)
        const it = state.items[cur]
        if (it?.linkedItemId && state.items[it.linkedItemId]) {
          queue.push(it.linkedItemId)
        }
        for (const [otherId, other] of Object.entries(state.items)) {
          if (other.linkedItemId === cur && !visited.has(otherId)) {
            queue.push(otherId)
          }
        }
      }
    }
    return Array.from(visited)
  }, [state.items])

  // Selected item ID set
  const selectedItemIds: string[] = state.selectedItemIds && state.selectedItemIds.length > 0
    ? state.selectedItemIds
    : (selectedItemId ? [selectedItemId] : [])



  // Auto-scroll refs
  const lastClientXRef = useRef<number>(0)
  const autoScrollSpeedRef = useRef<number>(0)
  const animFrameAutoScrollRef = useRef<number | null>(null)

  // ──── Compute Total Duration & Width ────
  // Fixed default timeline length (60s), expanding dynamically if a clip is dragged beyond it,
  // and returning to default length when dragged back if no clips remain beyond the default length.
  let maxCommittedClipEnd = state.playheadTime

  for (const item of Object.values(state.items)) {
    maxCommittedClipEnd = Math.max(maxCommittedClipEnd, item.startTime + item.duration)
  }

  let dragEndTime = 0
  if (moveDrag) {
    for (const dItem of moveDrag.draggedItems) {
      const timeDelta = moveDrag.currentStartTime - moveDrag.originalStartTime
      const itemNewStart = Math.max(0, dItem.originalStartTime + timeDelta)
      dragEndTime = Math.max(dragEndTime, itemNewStart + dItem.duration)
    }
  }
  if (mediaDrag) {
    dragEndTime = mediaDrag.currentStartTime + mediaDrag.duration
  }
  if (toolDrag) {
    dragEndTime = toolDrag.currentStartTime + toolDrag.duration
  }
  if (trimDrag) {
    dragEndTime = trimDrag.currentNewTime
  }

  const timelineDuration = computeTimelineDuration(maxCommittedClipEnd, dragEndTime)
  const timelineWidth = timelineDuration * PIXELS_PER_SECOND

  // Ruler tick interval (every 5 seconds)
  const ticks: number[] = []
  for (let t = 0; t <= timelineDuration; t += 5) {
    ticks.push(t)
  }

  // When timeline width contracts (e.g. after dragging back to default length),
  // clamp scrollLeft so the viewport is never left scrolled past the end of the timeline.
  useEffect(() => {
    if (!viewportRef.current) return
    const maxScroll = Math.max(0, timelineWidth - viewportRef.current.clientWidth)
    if (viewportRef.current.scrollLeft > maxScroll) {
      viewportRef.current.scrollLeft = maxScroll
    }
  }, [timelineWidth])

  // Exact time calculation from mouse clientX snapped to frame boundary
  const getTimeFromClientX = useCallback((clientX: number): number => {
    if (!viewportRef.current) return 0
    const rect = viewportRef.current.getBoundingClientRect()
    const x = clientX - rect.left + viewportRef.current.scrollLeft
    const rawTime = Math.max(0, x / PIXELS_PER_SECOND)
    const safeFps = fps > 0 ? fps : 30
    return Math.round(rawTime * safeFps) / safeFps
  }, [fps])

  // ──── Target Track Detection ────
  const getTargetTrackFromPoint = useCallback(
    (
      clientY: number,
      assetType: string,
      _movingItemId?: string
    ): { targetTrackId: string; isCompatible: boolean } => {
      const isVideoAsset = isTrackCompatible('video', assetType)
      const isAudioAsset = isTrackCompatible('audio', assetType)

      // Check whether committed clips exist for this track type
      const hasCommittedVideoClips = Object.values(state.items).some((item) => {
        const trk = state.tracks.find((t) => t.id === item.trackId)
        return trk?.type === 'video'
      })
      const hasCommittedAudioClips = Object.values(state.items).some((item) => {
        const trk = state.tracks.find((t) => t.id === item.trackId)
        return trk?.type === 'audio'
      })

      // Allow creating new layers when moving an existing clip, OR when dropping new media if clips of this type already exist
      const hasExistingForType = isVideoAsset ? hasCommittedVideoClips : hasCommittedAudioClips
      const allowNewTrack = !!_movingItemId || hasExistingForType

      if (!lanesRef.current) {
        return {
          targetTrackId: assetType === 'caption'
            ? (state.tracks.find((t) => t.type === 'caption')?.id ?? 'NEW_CAPTION_TRACK')
            : isAudioAsset
            ? (state.tracks.find((t) => t.type === 'audio')?.id ?? 'NEW_AUDIO_TRACK')
            : (state.tracks.find((t) => t.type === 'video')?.id ?? 'NEW_VIDEO_TRACK'),
          isCompatible: true,
        }
      }

      // Exclude ghost lane from target track detection bounds so real tracks determine boundary zones
      const laneElements = Array.from(
        lanesRef.current.querySelectorAll<HTMLElement>(
          '.track-lane[data-track-id]:not(.ghost-lane)'
        )
      )
      const bounds: TrackLaneBounds[] = laneElements.map((el) => {
        const rect = el.getBoundingClientRect()
        return {
          trackId: el.getAttribute('data-track-id')!,
          top: rect.top,
          bottom: rect.bottom,
        }
      })

      return resolveTargetTrackFromY(clientY, assetType, state.tracks, bounds, allowNewTrack)
    },
    [state.tracks, state.items]
  )

  // ──── Auto-Scroll Loop ────
  const updateAutoScroll = useCallback((clientX: number) => {
    lastClientXRef.current = clientX
    if (!viewportRef.current) return

    const rect = viewportRef.current.getBoundingClientRect()
    const maxScroll = viewportRef.current.scrollWidth - viewportRef.current.clientWidth

    if (clientX > rect.right - AUTO_SCROLL_EDGE_ZONE && viewportRef.current.scrollLeft < maxScroll - 1) {
      const ratio = Math.min(1, (clientX - (rect.right - AUTO_SCROLL_EDGE_ZONE)) / AUTO_SCROLL_EDGE_ZONE)
      autoScrollSpeedRef.current = Math.min(AUTO_SCROLL_MAX_SPEED, Math.max(4, ratio * AUTO_SCROLL_MAX_SPEED))
    } else if (clientX < rect.left + AUTO_SCROLL_EDGE_ZONE && viewportRef.current.scrollLeft > 1) {
      const ratio = Math.min(1, ((rect.left + AUTO_SCROLL_EDGE_ZONE) - clientX) / AUTO_SCROLL_EDGE_ZONE)
      autoScrollSpeedRef.current = -Math.min(AUTO_SCROLL_MAX_SPEED, Math.max(4, ratio * AUTO_SCROLL_MAX_SPEED))
    } else {
      autoScrollSpeedRef.current = 0
    }
  }, [])

  const stopAutoScroll = useCallback(() => {
    autoScrollSpeedRef.current = 0
    if (animFrameAutoScrollRef.current) {
      cancelAnimationFrame(animFrameAutoScrollRef.current)
      animFrameAutoScrollRef.current = null
    }
  }, [])

  // Auto-scroll frame step
  useEffect(() => {
    const isDragging = !!moveDrag || !!trimDrag || !!mediaDrag || !!marquee
    if (!isDragging) {
      stopAutoScroll()
      return
    }

    function scrollTicker() {
      if (autoScrollSpeedRef.current !== 0 && viewportRef.current) {
        const prevScroll = viewportRef.current.scrollLeft
        viewportRef.current.scrollLeft += autoScrollSpeedRef.current
        const actualScrollDelta = viewportRef.current.scrollLeft - prevScroll
        if (actualScrollDelta === 0) {
          animFrameAutoScrollRef.current = requestAnimationFrame(scrollTicker)
          return
        }

        // Live recalculate position while scrolling under static mouse
        const clientX = lastClientXRef.current
        const newTime = getTimeFromClientX(clientX)

        if (moveDrag) {
          let newStart = Math.max(0, newTime - (moveDrag.grabOffset ?? 0))
          if (isSnapping) {
            const movingItem = state.items[moveDrag.itemId]
            const movingDuration = movingItem?.duration ?? 0
            const ignoredIds = moveDrag.draggedItems.map((d) => d.itemId)
            const targets = collectSnapTargets(state.items, state.playheadTime, ignoredIds, moveDrag.targetTrackId)
            const snapResult = snapTimeToTargets(newStart, targets, {
              duration: movingDuration,
              snapBothEdges: true,
              thresholdTime: DEFAULT_SNAP_THRESHOLD_PIXELS / PIXELS_PER_SECOND,
              startThresholdTime: START_SNAP_THRESHOLD_PIXELS / PIXELS_PER_SECOND,
              targetTrackId: moveDrag.targetTrackId,
            })
            if (snapResult.hasSnapped) {
              newStart = snapResult.snappedTime
              setSnapIndicatorTime(snapResult.snapTargetTime ?? null)
            } else {
              setSnapIndicatorTime(null)
            }
          }
          setMoveDrag((prev) => (prev ? { ...prev, currentStartTime: newStart } : null))
        } else if (trimDrag) {
          let snapTime = newTime
          if (isSnapping) {
            const ignoredIds = [trimDrag.itemId, ...trimDrag.linkedPartners.map((p) => p.itemId)]
            const trimTrackId = state.items[trimDrag.itemId]?.trackId
            const targets = collectSnapTargets(state.items, state.playheadTime, ignoredIds, trimTrackId)
            const snapResult = snapTimeToTargets(snapTime, targets, {
              snapBothEdges: false,
              thresholdTime: DEFAULT_SNAP_THRESHOLD_PIXELS / PIXELS_PER_SECOND,
              startThresholdTime: START_SNAP_THRESHOLD_PIXELS / PIXELS_PER_SECOND,
              targetTrackId: trimTrackId,
            })
            if (snapResult.hasSnapped) {
              snapTime = snapResult.snappedTime
              setSnapIndicatorTime(snapResult.snapTargetTime ?? null)
            } else {
              setSnapIndicatorTime(null)
            }
          }
          setTrimDrag((prev) => (prev ? { ...prev, currentNewTime: snapTime } : null))
        } else if (mediaDrag) {
          let targetTime = newTime
          if (isSnapping) {
            const targets = collectSnapTargets(state.items, state.playheadTime, undefined, mediaDrag.targetTrackId)
            const snapResult = snapTimeToTargets(targetTime, targets, {
              duration: mediaDrag.duration,
              snapBothEdges: true,
              thresholdTime: DEFAULT_SNAP_THRESHOLD_PIXELS / PIXELS_PER_SECOND,
              startThresholdTime: START_SNAP_THRESHOLD_PIXELS / PIXELS_PER_SECOND,
              targetTrackId: mediaDrag.targetTrackId,
            })
            if (snapResult.hasSnapped) {
              targetTime = snapResult.snappedTime
              setSnapIndicatorTime(snapResult.snapTargetTime ?? null)
            } else {
              setSnapIndicatorTime(null)
            }
          }
          setMediaDrag((prev) => (prev ? { ...prev, currentStartTime: targetTime } : null))
        } else if (marquee) {
          const rect = viewportRef.current.getBoundingClientRect()
          const currentX = clientX - rect.left + viewportRef.current.scrollLeft
          setMarquee((prev) => {
            if (!prev) return null
            const left = Math.min(prev.startX, currentX)
            const width = Math.abs(currentX - prev.startX)
            return { ...prev, currentX, left, width }
          })
        }
      }
      animFrameAutoScrollRef.current = requestAnimationFrame(scrollTicker)
    }

    animFrameAutoScrollRef.current = requestAnimationFrame(scrollTicker)

    return () => {
      if (animFrameAutoScrollRef.current) {
        cancelAnimationFrame(animFrameAutoScrollRef.current)
      }
    }
  }, [moveDrag, trimDrag, mediaDrag, marquee, getTimeFromClientX, stopAutoScroll])

  // ──── Scrubbing ────
  const handleStartScrub = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      const time = getTimeFromClientX(e.clientX)
      dispatch(new SetPlayheadCommand(time))
      setIsScrubbing(true)
    },
    [getTimeFromClientX, dispatch]
  )

  useEffect(() => {
    if (!isScrubbing) return

    let rafId: number | null = null
    let latestClientX: number | null = null

    function handleMouseMove(e: MouseEvent) {
      latestClientX = e.clientX
      if (rafId === null) {
        rafId = requestAnimationFrame(() => {
          rafId = null
          if (latestClientX !== null) {
            const time = getTimeFromClientX(latestClientX)
            dispatch(new SetPlayheadCommand(time))
          }
        })
      }
    }

    function handleMouseUp(e: MouseEvent) {
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
        rafId = null
      }
      const time = getTimeFromClientX(e.clientX)
      dispatch(new SetPlayheadCommand(time))
      setIsScrubbing(false)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
      }
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isScrubbing, getTimeFromClientX, dispatch])

  // ──── Trimming ────
  const handleTrimMouseDown = useCallback(
    (e: React.MouseEvent, itemId: string, edge: 'left' | 'right') => {
      if (e.button !== 0) return
      e.stopPropagation()
      e.preventDefault()
      const item = state.items[itemId]
      if (!item) return

      // Linked partners to trim in lockstep
      const linked = getLinkedItemIds(itemId).filter((id) => id !== itemId)
      const linkedPartners = linked
        .map((id) => state.items[id])
        .filter((partner): partner is NonNullable<typeof partner> => !!partner)
        .map((partner) => ({
          itemId: partner.id,
          originalStartTime: partner.startTime,
          originalDuration: partner.duration,
        }))

      dispatch(new SelectItemCommand(itemId))
      setTrimDrag({
        itemId,
        edge,
        startX: e.clientX,
        originalStartTime: item.startTime,
        originalDuration: item.duration,
        currentNewTime: edge === 'left' ? item.startTime : item.startTime + item.duration,
        linkedPartners,
      })
    },
    [state.items, getLinkedItemIds, dispatch]
  )

  useEffect(() => {
    if (!trimDrag) return

    function handleMouseMove(e: MouseEvent) {
      if (!trimDrag) return
      updateAutoScroll(e.clientX)
      const deltaX = e.clientX - trimDrag.startX
      const deltaTime = deltaX / PIXELS_PER_SECOND

      let newTime =
        trimDrag.edge === 'right'
          ? Math.max(0, trimDrag.originalStartTime + trimDrag.originalDuration + deltaTime)
          : Math.max(0, trimDrag.originalStartTime + deltaTime)

      if (isSnapping) {
        const ignoredIds = [trimDrag.itemId, ...trimDrag.linkedPartners.map((p) => p.itemId)]
        const trimTrackId = state.items[trimDrag.itemId]?.trackId
        const targets = collectSnapTargets(state.items, state.playheadTime, ignoredIds, trimTrackId)
        const snapResult = snapTimeToTargets(newTime, targets, {
          snapBothEdges: false,
          thresholdTime: DEFAULT_SNAP_THRESHOLD_PIXELS / PIXELS_PER_SECOND,
          startThresholdTime: START_SNAP_THRESHOLD_PIXELS / PIXELS_PER_SECOND,
          targetTrackId: trimTrackId,
        })
        if (snapResult.hasSnapped) {
          newTime = snapResult.snappedTime
          setSnapIndicatorTime(snapResult.snapTargetTime ?? null)
        } else {
          setSnapIndicatorTime(null)
        }
      } else {
        setSnapIndicatorTime(null)
      }

      setTrimDrag((prev) => (prev ? { ...prev, currentNewTime: newTime } : null))
    }

    function handleMouseUp() {
      setSnapIndicatorTime(null)
      if (trimDrag) {
        const origBoundary = trimDrag.edge === 'right'
          ? trimDrag.originalStartTime + trimDrag.originalDuration
          : trimDrag.originalStartTime
        const hasTrimChanged = Math.abs(trimDrag.currentNewTime - origBoundary) >= 0.02

        if (hasTrimChanged) {
          if (trimDrag.linkedPartners.length > 0) {
            const trims = [
              { itemId: trimDrag.itemId, trim: { edge: trimDrag.edge, newTime: trimDrag.currentNewTime } },
              ...trimDrag.linkedPartners.map((partner) => ({
                itemId: partner.itemId,
                trim: { edge: trimDrag.edge, newTime: trimDrag.currentNewTime },
              })),
            ]
            dispatch(new TrimTimelineItemsCommand(trims))
          } else {
            // ONE ATOMIC COMMAND ON RELEASE -> ONE UNDO STEP
            dispatch(
              new TrimTimelineItemCommand(trimDrag.itemId, {
                edge: trimDrag.edge,
                newTime: trimDrag.currentNewTime,
              })
            )
          }
        }
      }
      setTrimDrag(null)
      stopAutoScroll()
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [trimDrag, updateAutoScroll, stopAutoScroll, dispatch])

  // ──── Transition Dragging, Moving & Trimming ────
  const handleTransitionMouseDown = useCallback(
    (e: React.MouseEvent, transitionId: string, mode: 'trim-left' | 'trim-right') => {
      if (e.button !== 0) return
      e.stopPropagation()
      const tr = state.transitions?.[transitionId]
      if (!tr) return

      dispatch(new SelectTransitionCommand(transitionId))
      setTransitionInteraction({
        transitionId,
        mode,
        startX: e.clientX,
        originalStartTime: tr.startTime,
        originalDuration: tr.duration,
        currentStartTime: tr.startTime,
        currentDuration: tr.duration,
      })
    },
    [state.transitions, dispatch]
  )

  useEffect(() => {
    if (!transitionInteraction) return

    function handleMouseMove(e: MouseEvent) {
      if (!transitionInteraction) return
      updateAutoScroll(e.clientX)
      const deltaX = e.clientX - transitionInteraction.startX
      const deltaTime = deltaX / PIXELS_PER_SECOND

      const trimmed = computeTransitionTrim(
        state,
        transitionInteraction.transitionId,
        transitionInteraction.mode,
        transitionInteraction.originalStartTime,
        transitionInteraction.originalDuration,
        deltaTime
      )
      const newStart = trimmed.startTime
      const newDur = trimmed.duration

      setTransitionInteraction((prev) =>
        prev ? { ...prev, currentStartTime: newStart, currentDuration: newDur } : null
      )
    }

    function handleMouseUp() {
      if (transitionInteraction) {
        dispatch(
          new UpdateTransitionCommand(transitionInteraction.transitionId, {
            startTime: transitionInteraction.currentStartTime,
            duration: transitionInteraction.currentDuration,
          })
        )
      }
      setTransitionInteraction(null)
      stopAutoScroll()
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [transitionInteraction, isSnapping, state.transitions, state.items, dispatch, updateAutoScroll, stopAutoScroll])

  // ──── Razor Blade / Split Tool Action ────
  const handleRazorSplit = useCallback(
    (itemId: string, clickTime: number) => {
      const item = state.items[itemId]
      if (!item) return
      // Safe boundary check: must be at least 0.04s inside clip bounds
      if (clickTime <= item.startTime + 0.04 || clickTime >= item.startTime + item.duration - 0.04) return

      const linkedIds = getLinkedItemIds(itemId)
      const splits: { itemId: string; splitTime: number; leftItemId: string; rightItemId: string }[] = []

      for (const id of linkedIds) {
        const it = state.items[id]
        if (!it) continue
        if (clickTime > it.startTime + 0.04 && clickTime < it.startTime + it.duration - 0.04) {
          splits.push({
            itemId: id,
            splitTime: clickTime,
            leftItemId: generateId('item'),
            rightItemId: generateId('item'),
          })
        }
      }

      if (splits.length === 1) {
        dispatch(
          new SplitTimelineItemCommand(
            splits[0].itemId,
            splits[0].splitTime,
            splits[0].leftItemId,
            splits[0].rightItemId
          )
        )
      } else if (splits.length > 1) {
        dispatch(new SplitTimelineItemsCommand(splits))
      }
    },
    [state.items, getLinkedItemIds, dispatch]
  )

  // ──── Clip Movement & Vertical Drag (Single, Multi-Selected & Linked) ────
  const handleClipMouseDown = useCallback(
    (e: React.MouseEvent, itemId: string) => {
      if (e.button !== 0) return
      e.stopPropagation()

      // If Razor / Split Tool is active, clicking on a clip cuts it at clicked position!
      if (isSplitToolActive) {
        e.preventDefault()
        const clickTime = getTimeFromClientX(e.clientX)
        handleRazorSplit(itemId, clickTime)
        return
      }

      const item = state.items[itemId]
      if (!item) return

      let nextSelectedIds: string[] = []

      if (e.altKey) {
        // Alt-click: select ONLY this single clip, even if linked
        nextSelectedIds = [itemId]
        dispatch(new SelectItemCommand(itemId))
      } else if (e.ctrlKey || e.metaKey) {
        // Ctrl/Cmd-click: toggle this clip (and its linked partners) in multi-selection
        const linkedGroup = getLinkedItemIds(itemId)
        const alreadySelected = linkedGroup.some((id) => selectedItemIds.includes(id))
        if (alreadySelected) {
          nextSelectedIds = selectedItemIds.filter((id) => !linkedGroup.includes(id))
        } else {
          nextSelectedIds = Array.from(new Set([...selectedItemIds, ...linkedGroup]))
        }
        dispatch(new SelectItemsCommand(nextSelectedIds))
      } else if (e.shiftKey) {
        // Shift-click: range select all clips in between from the last selected clip
        const allClips = Object.values(state.items).sort((a, b) => a.startTime - b.startTime)
        const lastSelectedId = selectedItemIds[selectedItemIds.length - 1]
        const lastIndex = allClips.findIndex((c) => c.id === lastSelectedId)
        const targetIndex = allClips.findIndex((c) => c.id === itemId)

        if (lastIndex >= 0 && targetIndex >= 0) {
          const [startIdx, endIdx] = lastIndex < targetIndex ? [lastIndex, targetIndex] : [targetIndex, lastIndex]
          const inBetween = allClips.slice(startIdx, endIdx + 1).map((c) => c.id)
          const rangeGroup = new Set<string>(selectedItemIds)
          for (const id of inBetween) {
            rangeGroup.add(id)
            for (const lid of getLinkedItemIds(id)) {
              rangeGroup.add(lid)
            }
          }
          nextSelectedIds = Array.from(rangeGroup)
        } else {
          nextSelectedIds = getLinkedItemIds(itemId)
        }
        dispatch(new SelectItemsCommand(nextSelectedIds))
      } else {
        // Normal click: ALWAYS select this clip AND all of its linked partners together
        nextSelectedIds = getLinkedItemIds(itemId)
        dispatch(new SelectItemsCommand(nextSelectedIds))
      }
      setSelectedTrackId(null)

      const clickTime = getTimeFromClientX(e.clientX)
      const grabOffset = Math.max(0, clickTime - item.startTime)

      // Gather all moving clips: all selected items
      const movingIds = nextSelectedIds.includes(itemId) ? nextSelectedIds : [itemId]
      const draggedItems = movingIds
        .map((id) => state.items[id])
        .filter((it): it is NonNullable<typeof it> => !!it)
        .map((it) => ({
          itemId: it.id,
          originalStartTime: it.startTime,
          originalTrackId: it.trackId,
          duration: it.duration,
        }))

      setMoveDrag({
        itemId,
        startX: e.clientX,
        grabOffset,
        originalStartTime: item.startTime,
        currentStartTime: item.startTime,
        targetTrackId: item.trackId,
        draggedItems,
      })
    },
    [state.items, selectedItemIds, getLinkedItemIds, getTimeFromClientX, dispatch]
  )

  useEffect(() => {
    if (!moveDrag) return

    function handleMouseMove(e: MouseEvent) {
      if (!moveDrag) return
      updateAutoScroll(e.clientX)
      const movingItem = state.items[moveDrag.itemId]
      const asset = movingItem ? state.assets[movingItem.assetId] : null
      const effectiveType = getItemEffectiveType(movingItem, asset)

      const { targetTrackId, isCompatible } = getTargetTrackFromPoint(
        e.clientY,
        effectiveType,
        moveDrag.itemId
      )
      const resolvedTargetTrackId = isCompatible ? targetTrackId : (movingItem?.trackId ?? moveDrag.targetTrackId)

      const currentMouseTime = getTimeFromClientX(e.clientX)
      let newStart = Math.max(0, currentMouseTime - (moveDrag.grabOffset ?? 0))

      if (isSnapping) {
        const movingDuration = movingItem?.duration ?? 0
        const ignoredIds = moveDrag.draggedItems.map((d) => d.itemId)
        const targets = collectSnapTargets(state.items, state.playheadTime, ignoredIds, resolvedTargetTrackId)
        const snapResult = snapTimeToTargets(newStart, targets, {
          duration: movingDuration,
          snapBothEdges: true,
          thresholdTime: DEFAULT_SNAP_THRESHOLD_PIXELS / PIXELS_PER_SECOND,
          startThresholdTime: START_SNAP_THRESHOLD_PIXELS / PIXELS_PER_SECOND,
          targetTrackId: resolvedTargetTrackId,
        })
        if (snapResult.hasSnapped) {
          newStart = snapResult.snappedTime
          setSnapIndicatorTime(snapResult.snapTargetTime ?? null)
        } else {
          setSnapIndicatorTime(null)
        }
      } else {
        setSnapIndicatorTime(null)
      }

      // Calculate corresponding partner track if moving a linked clip pair
      let partnerTargetTrackId: string | undefined
      const partnerItem = movingItem?.linkedItemId ? state.items[movingItem.linkedItemId] : null
      const isPartnerDragged = partnerItem && moveDrag.draggedItems.some((d) => d.itemId === partnerItem.id)
      if (
        isPartnerDragged &&
        partnerItem &&
        (effectiveType === 'video' || effectiveType === 'audio')
      ) {
        const partnerType = partnerItem.streamType === 'audio' ? 'audio' : 'video'
        partnerTargetTrackId = getCorrespondingLayerTrack(
          state.tracks,
          effectiveType,
          resolvedTargetTrackId,
          partnerType
        )
      }

      setMoveDrag((prev) =>
        prev
          ? {
              ...prev,
              currentStartTime: newStart,
              targetTrackId: resolvedTargetTrackId,
              partnerTargetTrackId,
            }
          : null
      )
    }

    function handleMouseUp() {
      setSnapIndicatorTime(null)
      if (moveDrag) {
        const timeDelta = moveDrag.currentStartTime - moveDrag.originalStartTime
        const movingItem = state.items[moveDrag.itemId]
        const originalTrackId = moveDrag.draggedItems.find((d) => d.itemId === moveDrag.itemId)?.originalTrackId ?? movingItem?.trackId
        const hasTrackChanged = moveDrag.targetTrackId !== originalTrackId
        const hasMoved = Math.abs(timeDelta) >= 0.02 || hasTrackChanged

        if (hasMoved) {
          const hasMultiple = moveDrag.draggedItems.length > 1

          if (hasMultiple) {
            const moves = moveDrag.draggedItems.map((dItem) => {
              const newStart = Math.max(0, dItem.originalStartTime + timeDelta)
              let targetTrack = dItem.originalTrackId
              if (dItem.itemId === moveDrag.itemId) {
                targetTrack = moveDrag.targetTrackId
              } else if (moveDrag.partnerTargetTrackId && movingItem?.linkedItemId === dItem.itemId) {
                targetTrack = moveDrag.partnerTargetTrackId
              }
              return {
                itemId: dItem.itemId,
                newStartTime: newStart,
                newTrackId: targetTrack,
              }
            })
            dispatch(new MoveTimelineItemsCommand(moves))
          } else {
            // Single item move
            dispatch(
              new MoveTimelineItemCommand(
                moveDrag.itemId,
                moveDrag.currentStartTime,
                moveDrag.targetTrackId
              )
            )
          }
        }
      }
      setMoveDrag(null)
      stopAutoScroll()
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [moveDrag, state.items, state.assets, getTargetTrackFromPoint, updateAutoScroll, stopAutoScroll, dispatch])

  // ──── Media Library Drag & Drop Listeners ────
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const activeAsset = getActiveDraggedAsset() || (window as any).__AIDITOR_ACTIVE_DRAG_ASSET__
      const activeTool = getActiveDraggedTool() || (window as any).__AIDITOR_ACTIVE_DRAG_TOOL__
      if (!activeAsset && !activeTool) return

      // ── Handle Dragging Layer Tools (Text, Solid, Caption, Adjustment) ──
      if (activeTool && activeTool.dragType === 'layer') {
        updateAutoScroll(e.clientX)
        const itemKind = activeTool.itemKind
        const duration = activeTool.duration ?? 5
        const { targetTrackId, isCompatible } = getTargetTrackFromPoint(e.clientY, itemKind)
        const effectiveTrackId = isCompatible ? targetTrackId : undefined

        let targetTime = getTimeFromClientX(e.clientX)
        if (isSnapping) {
          const targets = collectSnapTargets(state.items, state.playheadTime, undefined, effectiveTrackId)
          const snapResult = snapTimeToTargets(targetTime, targets, {
            duration,
            snapBothEdges: true,
            thresholdTime: DEFAULT_SNAP_THRESHOLD_PIXELS / PIXELS_PER_SECOND,
            startThresholdTime: START_SNAP_THRESHOLD_PIXELS / PIXELS_PER_SECOND,
            targetTrackId: effectiveTrackId,
          })
          if (snapResult.hasSnapped) {
            targetTime = snapResult.snappedTime
            setSnapIndicatorTime(snapResult.snapTargetTime ?? null)
          } else {
            setSnapIndicatorTime(null)
          }
        } else {
          setSnapIndicatorTime(null)
        }

        e.dataTransfer.dropEffect = isCompatible ? 'copy' : 'none'

        setToolDrag({
          tool: activeTool,
          targetTrackId: isCompatible ? targetTrackId : '',
          currentStartTime: targetTime,
          duration,
          isCompatible,
        })
        setMediaDrag(null)
        setEffectDropTarget(null)
        return
      }

      // ── Handle Dragging Effects onto Timeline Items ──
      if (activeTool && activeTool.dragType === 'effect') {
        updateAutoScroll(e.clientX)
        setToolDrag(null)
        setMediaDrag(null)
        setSnapIndicatorTime(null)

        let hoveredClip: TimelineItem | null = null
        const elem = document.elementFromPoint(e.clientX, e.clientY)?.closest('.timeline-clip')
        if (elem) {
          const clipId = elem.getAttribute('data-item-id')
          if (clipId && state.items[clipId]) {
            hoveredClip = state.items[clipId]
          }
        }
        if (!hoveredClip) {
          const { targetTrackId } = getTargetTrackFromPoint(e.clientY, 'video')
          const mouseTime = getTimeFromClientX(e.clientX)
          for (const it of Object.values(state.items)) {
            if (it.trackId === targetTrackId && mouseTime >= it.startTime && mouseTime <= it.startTime + it.duration) {
              hoveredClip = it
              break
            }
          }
        }

        if (hoveredClip) {
          const effCategory = activeTool.effect.category
          const isAudioEffect = effCategory === 'audio'
          const clipTrack = state.tracks.find((t) => t.id === hoveredClip!.trackId)
          const isAudioClip =
            hoveredClip.itemType === 'audio' ||
            hoveredClip.streamType === 'audio' ||
            clipTrack?.type === 'audio'
          const isVisualOnly =
            hoveredClip.itemType === 'text' ||
            hoveredClip.itemType === 'caption' ||
            hoveredClip.itemType === 'solid' ||
            hoveredClip.itemType === 'adjustment'

          let isCompatible = false
          if (isAudioEffect) {
            isCompatible =
              isAudioClip ||
              (!isVisualOnly && state.assets[hoveredClip.assetId]?.metadata?.audioChannels !== 0)
          } else {
            isCompatible = !isAudioClip
          }

          e.dataTransfer.dropEffect = isCompatible ? 'copy' : 'none'
          setEffectDropTarget({ itemId: hoveredClip.id, isCompatible })
        } else {
          e.dataTransfer.dropEffect = 'none'
          setEffectDropTarget(null)
        }
        return
      }

      // ── Handle Dragging Transitions ──
      if (activeTool && activeTool.dragType === 'transition') {
        updateAutoScroll(e.clientX)
        setToolDrag(null)
        setMediaDrag(null)
        setEffectDropTarget(null)

        let hoveredClip: TimelineItem | null = null
        const elem = document.elementFromPoint(e.clientX, e.clientY)?.closest('.timeline-clip')
        if (elem) {
          const clipId = elem.getAttribute('data-item-id')
          if (clipId && state.items[clipId]) {
            hoveredClip = state.items[clipId]
          }
        }

        const resolvedTrackId = hoveredClip?.trackId || getTargetTrackFromPoint(e.clientY, 'video').targetTrackId
        const targetTrack = state.tracks.find((t) => t.id === resolvedTrackId)

        // 1. Cannot be added to audio tracks or audio clips!
        const isAudio =
          !targetTrack ||
          targetTrack.type === 'audio' ||
          hoveredClip?.itemType === 'audio' ||
          hoveredClip?.streamType === 'audio'

        if (isAudio) {
          e.dataTransfer.dropEffect = 'none'
          setTransitionDrag(null)
          setSnapIndicatorTime(null)
          return
        }

        const mouseTime = getTimeFromClientX(e.clientX)
        const attachment = resolveTransitionDrop(state.items, targetTrack.id, mouseTime,
          activeTool.duration ?? DEFAULT_TRANSITION_DURATION, hoveredClip?.id)
        if (!attachment) {
          e.dataTransfer.dropEffect = 'none'
          setTransitionDrag(null)
          setSnapIndicatorTime(null)
          return
        }
        e.dataTransfer.dropEffect = 'copy'
        const left = attachment.leftClipId ? state.items[attachment.leftClipId] : undefined
        setSnapIndicatorTime(left && attachment.rightClipId ? left.startTime + left.duration : null)
        setTransitionDrag({ transition: activeTool, targetTrackId: targetTrack.id, ...attachment })
        return
      }

      // ── Handle Media Dragging ──
      if (activeAsset) {
        updateAutoScroll(e.clientX)
        const { targetTrackId, isCompatible } = getTargetTrackFromPoint(e.clientY, activeAsset.type)
        const effectiveTrackId = isCompatible ? targetTrackId : undefined

        let targetTime = getTimeFromClientX(e.clientX)
        if (isSnapping) {
          const targets = collectSnapTargets(state.items, state.playheadTime, undefined, effectiveTrackId)
          const snapResult = snapTimeToTargets(targetTime, targets, {
            duration: activeAsset.duration,
            snapBothEdges: true,
            thresholdTime: DEFAULT_SNAP_THRESHOLD_PIXELS / PIXELS_PER_SECOND,
            startThresholdTime: START_SNAP_THRESHOLD_PIXELS / PIXELS_PER_SECOND,
            targetTrackId: effectiveTrackId,
          })
          if (snapResult.hasSnapped) {
            targetTime = snapResult.snappedTime
            setSnapIndicatorTime(snapResult.snapTargetTime ?? null)
          } else {
            setSnapIndicatorTime(null)
          }
        } else {
          setSnapIndicatorTime(null)
        }

        e.dataTransfer.dropEffect = isCompatible ? 'copy' : 'none'

        setMediaDrag({
          assetId: activeAsset.assetId,
          assetType: activeAsset.type,
          assetName: activeAsset.name,
          thumbnailUrl: activeAsset.thumbnailUrl,
          path: activeAsset.path,
          duration: activeAsset.duration,
          currentStartTime: targetTime,
          targetTrackId: isCompatible ? targetTrackId : '',
          isCompatible,
        })
      }
    },
    [getTimeFromClientX, getTargetTrackFromPoint, updateAutoScroll, state.items, state.playheadTime, state.tracks, state.assets, isSnapping]
  )

  const handleDragLeave = useCallback(
    (e: React.DragEvent) => {
      // Only clear if pointer genuinely exited the timeline container bounds
      if (viewportRef.current) {
        const rect = viewportRef.current.getBoundingClientRect()
        const headersLeft = headersRef.current?.getBoundingClientRect().left ?? rect.left
        if (
          e.clientX < headersLeft ||
          e.clientX >= rect.right ||
          e.clientY <= rect.top ||
          e.clientY >= rect.bottom
        ) {
          setMediaDrag(null)
          setToolDrag(null)
          setEffectDropTarget(null)
          setTransitionDrag(null)
          setSnapIndicatorTime(null)
          stopAutoScroll()
        }
      }
    },
    [stopAutoScroll]
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setSnapIndicatorTime(null)
      stopAutoScroll()

      let activeTool = getActiveDraggedTool() || (window as any).__AIDITOR_ACTIVE_DRAG_TOOL__
      if (!activeTool) {
        try {
          const rawTool = e.dataTransfer.getData('application/aiditor-tool')
          if (rawTool) activeTool = JSON.parse(rawTool)
        } catch {
          // ignore parse error
        }
      }

      // ── Handle Layer Tool Drop ──
      if (activeTool && activeTool.dragType === 'layer') {
        const targetTime = toolDrag?.currentStartTime ?? getTimeFromClientX(e.clientX)
        const duration = toolDrag?.duration ?? activeTool.duration ?? 5
        const targetTrackId =
          toolDrag?.targetTrackId ||
          getTargetTrackFromPoint(e.clientY, activeTool.itemKind).targetTrackId
        const isCompatible = toolDrag ? toolDrag.isCompatible : isTrackCompatible('video', activeTool.itemKind)

        if (!isCompatible || !targetTrackId) {
          setToolDrag(null)
          setActiveDraggedTool(null)
          return
        }

        const preset = activeTool.preset

        if (activeTool.itemKind === 'caption') {
          dispatch(
            new AddCaptionCommand({
              startTime: targetTime,
              duration,
              trackId: targetTrackId,
              text: preset?.text || 'Caption',
              preset: preset?.captionPreset,
              style: preset?.captionStyle,
              transform: preset?.transform,
            })
          )
        } else if (activeTool.itemKind === 'text') {
          dispatch(
            new AddTextLayerCommand({
              startTime: targetTime,
              duration,
              trackId: targetTrackId,
              text: preset?.text || 'Text',
              properties: preset?.properties,
              transform: preset?.transform,
            })
          )
        } else if (activeTool.itemKind === 'solid') {
          dispatch(
            new AddSolidLayerCommand({
              startTime: targetTime,
              duration,
              trackId: targetTrackId,
              color: activeTool.solidColor || '#3b82f6',
            })
          )
        } else if (activeTool.itemKind === 'adjustment') {
          dispatch(
            new AddAdjustmentLayerCommand({
              startTime: targetTime,
              duration,
              trackId: targetTrackId,
            })
          )
        }

        setToolDrag(null)
        setActiveDraggedTool(null)
        return
      }

      // ── Handle Effect Drop ──
      if (activeTool && activeTool.dragType === 'effect') {
        const targetItemId = effectDropTarget?.itemId
        if (targetItemId && effectDropTarget?.isCompatible) {
          const defaultParams: Record<string, number | string | boolean> = {}
          for (const p of activeTool.effect.params) {
            defaultParams[p.key] = p.defaultVal
          }
          const targetItem = state.items[targetItemId]
          const clipDur = targetItem?.duration || 5
          const newEffect: ItemEffect = {
            id: generateId('fx'),
            effectId: activeTool.effect.id,
            name: activeTool.effect.name,
            category: activeTool.effect.category,
            enabled: true,
            params: defaultParams,
            rangeMode: 'fullClip',
            startOffset: 0,
            endOffset: clipDur,
          }
          dispatch(new ApplyEffectCommand(targetItemId, newEffect))
          dispatch(new SelectItemCommand(targetItemId))
          if (onEffectApplied) {
            onEffectApplied()
          }
        }
        setEffectDropTarget(null)
        setActiveDraggedTool(null)
        return
      }

      // ── Handle Transition Drop ──
      if (activeTool && activeTool.dragType === 'transition') {
        // Recompute at the actual drop coordinates so a stale drag preview cannot choose the pair.
        const element = document.elementFromPoint(e.clientX, e.clientY)?.closest('.timeline-clip')
        const hoveredId = element?.getAttribute('data-item-id') ?? undefined
        const hovered = hoveredId ? state.items[hoveredId] : undefined
        const targetTrackId = hovered?.trackId || getTargetTrackFromPoint(e.clientY, 'video').targetTrackId
        const track = state.tracks.find(track => track.id === targetTrackId)
        const dropTime = getTimeFromClientX(e.clientX)
        const attachment = track && track.type !== 'audio'
          ? resolveTransitionDrop(state.items, track.id, dropTime,
              activeTool.duration ?? DEFAULT_TRANSITION_DURATION, hoveredId)
          : null
        if (attachment) {
          const newTr: TimelineTransition = {
            id: generateId('tr'), transitionId: activeTool.transitionId, name: activeTool.name, ...attachment,
          }
          dispatch(new AddTransitionCommand(newTr))
          const left = attachment.leftClipId ? state.items[attachment.leftClipId] : undefined
          const right = attachment.rightClipId ? state.items[attachment.rightClipId] : undefined
          const contextId = hoveredId ?? (right && dropTime >= right.startTime ? right.id : left?.id ?? right?.id)
          if (contextId) dispatch(new SelectItemCommand(contextId))
          dispatch(new SelectTransitionCommand(newTr.id))
        }

        setTransitionDrag(null)
        setToolDrag(null)
        setEffectDropTarget(null)
        setActiveDraggedTool(null)
        return
      }

      let assetData = getActiveDraggedAsset() || (window as any).__AIDITOR_ACTIVE_DRAG_ASSET__
      if (!assetData) {
        try {
          const raw =
            e.dataTransfer.getData('application/aiditor-asset') ||
            e.dataTransfer.getData('text/plain')
          if (raw) assetData = JSON.parse(raw)
        } catch {
          // ignore parse error
        }
      }

      // If assetData still not resolved, check mediaDrag
      if (!assetData && mediaDrag) {
        assetData = {
          assetId: mediaDrag.assetId,
          type: mediaDrag.assetType,
          duration: mediaDrag.duration,
          name: mediaDrag.assetName,
        }
      }

      if (!assetData) {
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          const file = e.dataTransfer.files[0]
          const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
          if (ext === 'srt' || ext === 'vtt') {
            const reader = new FileReader()
            const targetTime = getTimeFromClientX(e.clientX)
            const targetCaptionTrack = state.tracks.find((t) => t.type === 'caption')?.id ?? 'NEW_CAPTION_TRACK'
            reader.onload = (evt) => {
              const content = evt.target?.result as string
              if (content) {
                dispatch(new ImportSubtitlesCommand(content, targetCaptionTrack, targetTime))
              }
            }
            reader.readAsText(file)
            setMediaDrag(null)
            return
          }
        }
        setMediaDrag(null)
        return
      }

      const asset = state.assets[assetData.assetId] || assetData
      const assetType = asset.type ?? assetData.type ?? 'video'
      const duration = asset.duration ?? assetData.duration ?? 5

      const { targetTrackId, isCompatible } = mediaDrag?.targetTrackId
        ? { targetTrackId: mediaDrag.targetTrackId, isCompatible: mediaDrag.isCompatible }
        : getTargetTrackFromPoint(e.clientY, assetType)

      if (!isCompatible || !targetTrackId) {
        setMediaDrag(null)
        return
      }

      const targetTime = mediaDrag?.currentStartTime ?? getTimeFromClientX(e.clientX)

      if (assetType === 'caption') {
        const targetCaptionTrack =
          targetTrackId && targetTrackId !== 'NEW_VIDEO_TRACK' && targetTrackId !== 'NEW_AUDIO_TRACK'
            ? targetTrackId
            : (state.tracks.find((t) => t.type === 'caption')?.id ?? 'NEW_CAPTION_TRACK')

        const subtitleContent = asset.metadata?.subtitleContent
        if (subtitleContent) {
          dispatch(new ImportSubtitlesCommand(subtitleContent, targetCaptionTrack, targetTime))
        } else {
          dispatch(
            new ImportSubtitlesCommand(
              `1\n00:00:00,000 --> 00:00:04,000\n${asset.name.replace(/\.[^/.]+$/, '')}`,
              targetCaptionTrack,
              targetTime
            )
          )
        }
        setMediaDrag(null)
        return
      }

      const isVideoWithAudio =
        assetType === 'video' &&
        (asset.metadata?.audioChannels !== 0) // Videos by default or with audioChannels > 0

      if (isVideoWithAudio) {
        // Place video on targetTrackId (defaulting to Video 1 or NEW_VIDEO_TRACK) and linked audio on corresponding layer
        const targetVideoTrack = targetTrackId || (state.tracks.find((t) => t.type === 'video')?.id ?? 'NEW_VIDEO_TRACK')
        const audioTrack = getCorrespondingLayerTrack(state.tracks, 'video', targetVideoTrack, 'audio')
        const videoItemId = generateId('item')
        const audioItemId = generateId('item')

        const videoItem = {
          id: videoItemId,
          trackId: targetVideoTrack,
          assetId: assetData.assetId,
          startTime: targetTime,
          duration: duration,
          sourceIn: 0,
          sourceOut: duration,
          transform: { ...DEFAULT_TRANSFORM },
          streamType: 'video' as const,
          linkedItemId: audioItemId,
        }

        const audioItem = {
          id: audioItemId,
          trackId: audioTrack,
          assetId: assetData.assetId,
          startTime: targetTime,
          duration: duration,
          sourceIn: 0,
          sourceOut: duration,
          transform: { ...DEFAULT_TRANSFORM },
          streamType: 'audio' as const,
          linkedItemId: videoItemId,
        }

        dispatch(new AddTimelineItemPairCommand(videoItem, audioItem))
        dispatch(new SelectItemsCommand([videoItemId, audioItemId]))
      } else {
        // Standard single item placement
        const newItemId = generateId('item')
        dispatch(
          new AddTimelineItemCommand({
            id: newItemId,
            trackId: targetTrackId,
            assetId: assetData.assetId,
            startTime: targetTime,
            duration: duration,
            sourceIn: 0,
            sourceOut: duration,
            transform: { ...DEFAULT_TRANSFORM },
            streamType: assetType === 'audio' ? ('audio' as const) : ('video' as const),
          })
        )
        dispatch(new SelectItemCommand(newItemId))
      }

      setMediaDrag(null)
    },
    [
      getTimeFromClientX,
      getTargetTrackFromPoint,
      stopAutoScroll,
      dispatch,
      state.assets,
      state.tracks,
      mediaDrag,
      toolDrag,
      effectDropTarget,
      transitionDrag,
      onEffectApplied,
    ]
  )

  // Global drag cleanup: whenever any drag gesture ends (dropped, cancelled, or released anywhere outside timeline)
  useEffect(() => {
    function handleGlobalDragEnd() {
      setMediaDrag(null)
      setToolDrag(null)
      setEffectDropTarget(null)
      setActiveDraggedTool(null)
      stopAutoScroll()
    }

    window.addEventListener('dragend', handleGlobalDragEnd)
    window.addEventListener('drop', handleGlobalDragEnd)
    return () => {
      window.removeEventListener('dragend', handleGlobalDragEnd)
      window.removeEventListener('drop', handleGlobalDragEnd)
    }
  }, [stopAutoScroll])

  // ──── Compute Live Preview (Without State Mutation) ────
  let activePreview: DragPreview | null = null
  if (moveDrag) {
    const additionalMoves: { itemId: string; targetStartTime: number; targetTrackId: string }[] = []
    const timeDelta = moveDrag.currentStartTime - moveDrag.originalStartTime
    const movingItem = state.items[moveDrag.itemId]
    for (const dItem of moveDrag.draggedItems) {
      if (dItem.itemId === moveDrag.itemId) continue
      const targetStart = Math.max(0, dItem.originalStartTime + timeDelta)
      let targetTrack = dItem.originalTrackId
      if (moveDrag.partnerTargetTrackId && movingItem?.linkedItemId === dItem.itemId) {
        targetTrack = moveDrag.partnerTargetTrackId
      }
      additionalMoves.push({
        itemId: dItem.itemId,
        targetStartTime: targetStart,
        targetTrackId: targetTrack,
      })
    }

    activePreview = {
      type: 'move',
      itemId: moveDrag.itemId,
      targetStartTime: moveDrag.currentStartTime,
      targetTrackId: moveDrag.targetTrackId,
      additionalMoves,
    }
  } else if (trimDrag) {
    const additionalTrims = trimDrag.linkedPartners.map((partner) => ({
      itemId: partner.itemId,
      edge: trimDrag.edge,
      targetTime: trimDrag.currentNewTime,
    }))
    activePreview = {
      type: 'trim',
      itemId: trimDrag.itemId,
      edge: trimDrag.edge,
      targetTime: trimDrag.currentNewTime,
      additionalTrims,
    }
  } else if (toolDrag && toolDrag.isCompatible) {
    const preset = toolDrag.tool.preset
    activePreview = {
      type: 'media-drop',
      assetId: '',
      assetType: toolDrag.tool.itemKind,
      assetName: toolDrag.tool.name,
      duration: toolDrag.duration,
      targetStartTime: toolDrag.currentStartTime,
      targetTrackId: toolDrag.targetTrackId,
      itemType: toolDrag.tool.itemKind,
      text:
        toolDrag.tool.itemKind === 'text'
          ? {
              ...DEFAULT_TEXT_PROPERTIES,
              ...preset?.properties,
              text: preset?.text || 'Text',
            }
          : undefined,
      caption:
        toolDrag.tool.itemKind === 'caption'
          ? {
              text: preset?.text || 'Caption',
              preset: preset?.captionPreset,
              style: preset?.captionStyle,
            }
          : undefined,
      solid:
        toolDrag.tool.itemKind === 'solid'
          ? {
              color: toolDrag.tool.solidColor || '#3b82f6',
            }
          : undefined,
    }
  } else if (mediaDrag && mediaDrag.isCompatible) {
    const asset = state.assets[mediaDrag.assetId]
    const hasAudio =
      mediaDrag.assetType === 'video' &&
      asset?.metadata?.audioChannels !== 0
    const audioTrackId = getCorrespondingLayerTrack(state.tracks, 'video', mediaDrag.targetTrackId, 'audio')

    activePreview = {
      type: 'media-drop',
      assetId: mediaDrag.assetId,
      assetType: mediaDrag.assetType,
      assetName: mediaDrag.assetName,
      duration: mediaDrag.duration,
      targetStartTime: mediaDrag.currentStartTime,
      targetTrackId: mediaDrag.targetTrackId,
      hasAudio,
      audioTrackId,
    }
  }

  const previewState = computeDragPreview(state, activePreview)

  // ──── Split Selected Clip(s) ────
  const handleSplit = useCallback(() => {
    let targetSelection = selectedItemIds
    if (targetSelection.length === 0) {
      targetSelection = Object.values(state.items)
        .filter((it) => playheadTime > it.startTime && playheadTime < it.startTime + it.duration)
        .map((it) => it.id)
    }
    if (targetSelection.length === 0) return

    const candidateIds = new Set<string>()
    for (const id of targetSelection) {
      candidateIds.add(id)
      for (const lid of getLinkedItemIds(id)) {
        candidateIds.add(lid)
      }
    }

    const splits: { itemId: string; splitTime: number; leftItemId: string; rightItemId: string }[] = []
    for (const id of candidateIds) {
      const item = state.items[id]
      if (!item) continue
      const itemEnd = item.startTime + item.duration
      if (playheadTime > item.startTime && playheadTime < itemEnd) {
        splits.push({
          itemId: id,
          splitTime: playheadTime,
          leftItemId: generateId('item'),
          rightItemId: generateId('item'),
        })
      }
    }

    if (splits.length === 0) return

    if (splits.length === 1) {
      dispatch(
        new SplitTimelineItemCommand(
          splits[0].itemId,
          splits[0].splitTime,
          splits[0].leftItemId,
          splits[0].rightItemId
        )
      )
    } else {
      dispatch(new SplitTimelineItemsCommand(splits))
    }
  }, [selectedItemIds, getLinkedItemIds, state.items, playheadTime, dispatch])

  // ──── Delete Selected Clip(s) ────
  const handleDelete = useCallback(() => {
    if (selectedItemIds.length === 0) return
    const candidateIds = new Set<string>()
    for (const id of selectedItemIds) {
      candidateIds.add(id)
      for (const lid of getLinkedItemIds(id)) {
        candidateIds.add(lid)
      }
    }
    const idsToDelete = Array.from(candidateIds)
    if (idsToDelete.length === 1) {
      dispatch(new RemoveTimelineItemCommand(idsToDelete[0]))
    } else {
      dispatch(new RemoveTimelineItemsCommand(idsToDelete))
    }
    dispatch(new SelectItemCommand(null))
  }, [selectedItemIds, getLinkedItemIds, dispatch])

  // ──── Delete Selected Track ────
  const handleDeleteTrack = useCallback((trackId: string) => {
    dispatch(new RemoveTrackCommand(trackId))
    if (selectedTrackId === trackId) {
      setSelectedTrackId(null)
    }
  }, [dispatch, selectedTrackId])

  // Keydown handler: Delete / Backspace for clip or selected track
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented) return
      const activeEl = document.activeElement
      if (
        activeEl instanceof HTMLInputElement ||
        activeEl instanceof HTMLTextAreaElement ||
        (activeEl as HTMLElement)?.isContentEditable
      ) {
        return
      }

      if (e.key === 'c' || e.key === 'C') {
        setIsSplitToolActive(true)
        setSplitHover(null)
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur()
        }
        e.preventDefault()
        return
      }

      if (e.key === 'Escape' || e.key === 'v' || e.key === 'V') {
        setIsSplitToolActive(false)
        setSplitHover(null)
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur()
        }
        e.preventDefault()
        return
      }

      if ((e.key === 's' || e.key === 'S') && !e.ctrlKey && !e.metaKey) {
        handleSplit()
        e.preventDefault()
        return
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (state.selectedTransitionId) {
          dispatch(new RemoveTransitionCommand(state.selectedTransitionId))
          dispatch(new SelectTransitionCommand(null))
          e.preventDefault()
          return
        }
        if (selectedItemIds.length > 0) {
          handleDelete()
          e.preventDefault()
        }
      }

      if (e.key === 'n' || e.key === 'N') {
        setIsSnapping((prev) => !prev)
        e.preventDefault()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedItemIds, handleDelete, handleSplit, isSplitToolActive, dispatch])

  // ──── Link / Unlink Selected Clips ────
  const handleLinkSelected = useCallback(() => {
    if (selectedItemIds.length < 2) return
    dispatch(new LinkTimelineItemsCommand(selectedItemIds))
  }, [selectedItemIds, dispatch])

  const handleUnlinkSelected = useCallback(() => {
    if (selectedItemIds.length === 0) return
    dispatch(new UnlinkTimelineItemsCommand(selectedItemIds))
  }, [selectedItemIds, dispatch])

  // Can link: at least 2 items selected and at least one is unlinked
  const canLink = selectedItemIds.length >= 2 && selectedItemIds.some((id) => !state.items[id]?.linkedItemId)
  // Can unlink: any selected item is linked
  const canUnlink = selectedItemIds.some((id) => !!state.items[id]?.linkedItemId)

  // Unified single toggle: if selection is linked -> unlink; otherwise if can link -> link
  const isLinkedSelection = canUnlink
  const canToggleLink = isLinkedSelection || canLink

  const handleToggleLink = useCallback(() => {
    if (isLinkedSelection) {
      handleUnlinkSelected()
    } else if (canLink) {
      handleLinkSelected()
    }
  }, [isLinkedSelection, handleUnlinkSelected, canLink, handleLinkSelected])

  // ──── Add Text / Solid / Caption / Adjustment Layer Handlers ────
  const handleAddText = useCallback(() => {
    const videoTrack = state.tracks.find((t) => t.type === 'video' || t.type === 'graphics')
    dispatch(
      new AddTextLayerCommand({
        startTime: playheadTime,
        duration: 5,
        text: 'Title Text',
        trackId: videoTrack?.id,
      })
    )
  }, [state.tracks, playheadTime, dispatch])

  const handleAddSolid = useCallback(() => {
    const videoTrack = state.tracks.find((t) => t.type === 'video' || t.type === 'graphics')
    dispatch(
      new AddSolidLayerCommand({
        startTime: playheadTime,
        duration: 5,
        color: '#1e3a8a',
        trackId: videoTrack?.id,
      })
    )
  }, [state.tracks, playheadTime, dispatch])

  const handleAddCaption = useCallback(() => {
    const captionTrack = state.tracks.find((t) => t.type === 'caption')
    dispatch(
      new AddCaptionCommand({
        startTime: playheadTime,
        duration: 3,
        text: 'New subtitle caption',
        trackId: captionTrack?.id,
      })
    )
  }, [state.tracks, playheadTime, dispatch])

  const handleAddAdjustmentLayer = useCallback(() => {
    const videoTrack = state.tracks.find((t) => t.type === 'video' || t.type === 'graphics')
    dispatch(
      new AddAdjustmentLayerCommand({
        startTime: playheadTime,
        duration: 5,
        trackId: videoTrack?.id,
      })
    )
  }, [state.tracks, playheadTime, dispatch])


  const playheadLeft = playheadTime * PIXELS_PER_SECOND

  // All project tracks remain visible once created; no auto-hiding or pruning on empty
  const visibleTracks = previewState.tracks

  // Check if any empty secondary tracks exist
  const vTracks = state.tracks.filter((t) => t.type === 'video')
  const aTracks = state.tracks.filter((t) => t.type === 'audio')
  const hasEmptySecondaryTracks = state.tracks.some((t) => {
    const isSecondary =
      (t.type === 'video' && vTracks.length > 1 && t.name !== 'Video 1') ||
      (t.type === 'audio' && aTracks.length > 1 && t.name !== 'Audio 1') ||
      t.type === 'caption' ||
      t.type === 'graphics'
    const isEmpty = !Object.values(state.items).some((it) => it.trackId === t.id)
    return isSecondary && isEmpty
  })

  // Synchronize track headers scroll with viewport scroll whenever tracks change
  useEffect(() => {
    if (viewportRef.current && headersRef.current) {
      headersRef.current.scrollTop = viewportRef.current.scrollTop
    }
  }, [visibleTracks])

  // Measure visible work area height in timeline time viewport
  const [viewportHeight, setViewportHeight] = useState<number>(0)

  useEffect(() => {
    if (!viewportRef.current) return
    const el = viewportRef.current

    const updateHeight = () => {
      setViewportHeight(el.clientHeight)
    }

    updateHeight()

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => {
        updateHeight()
      })
      observer.observe(el)
      return () => observer.disconnect()
    }
  }, [])

  // Exact vertical centering offset for both track headers and track lanes
  // Ruler / header spacer height = 28px, track height = 52px, track gap = 2px
  // Calculate based on visibleTracks so preview layers remain seamlessly centered during drag and drop
  const visibleTrackCount = visibleTracks.length
  const totalTracksHeight =
    visibleTrackCount > 0 ? visibleTrackCount * 52 + (visibleTrackCount - 1) * 2 : 0
  const availableWorkHeight = Math.max(0, viewportHeight - 28)

  const centeringOffset =
    totalTracksHeight > 0 && availableWorkHeight > totalTracksHeight
      ? Math.floor((availableWorkHeight - totalTracksHeight) / 2)
      : 0

  const firstAudioIndex = visibleTracks.findIndex((t) => t.type === 'audio')

  // ──── Marquee Selection Drag (Pointer Selection Area) ────
  const handleMarqueeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return
      const target = e.target as HTMLElement
      const isEmptyArea =
        target.classList.contains('track-lane') ||
        target.classList.contains('timeline-track-lanes') ||
        target.classList.contains('timeline-time-content') ||
        target.classList.contains('timeline-empty-tracks-placeholder') ||
        target.classList.contains('empty-tracks-text') ||
        target === lanesRef.current
      if (!isEmptyArea) return

      e.preventDefault()

      if (!viewportRef.current) return
      const rect = viewportRef.current.getBoundingClientRect()
      const contentX = e.clientX - rect.left + viewportRef.current.scrollLeft
      const contentY = e.clientY - rect.top + viewportRef.current.scrollTop
      const clickTime = getTimeFromClientX(e.clientX)

      setMarquee({
        startX: contentX,
        startY: contentY,
        currentX: contentX,
        currentY: contentY,
        left: contentX,
        top: contentY,
        width: 0,
        height: 0,
        isShift: e.shiftKey,
        initialSelectedIds: e.shiftKey ? selectedItemIds : [],
        clickTime,
      })
    },
    [getTimeFromClientX, selectedItemIds]
  )

  useEffect(() => {
    if (!marquee) return

    function handleMouseMove(e: MouseEvent) {
      if (!marquee || !viewportRef.current) return
      updateAutoScroll(e.clientX)

      const rect = viewportRef.current.getBoundingClientRect()
      const currentX = e.clientX - rect.left + viewportRef.current.scrollLeft
      const currentY = e.clientY - rect.top + viewportRef.current.scrollTop

      const left = Math.min(marquee.startX, currentX)
      const top = Math.min(marquee.startY, currentY)
      const width = Math.abs(currentX - marquee.startX)
      const height = Math.abs(currentY - marquee.startY)

      setMarquee((prev) => (prev ? { ...prev, currentX, currentY, left, top, width, height } : null))

      if (width > 3 || height > 3) {
        const intersectingIds: string[] = []

        for (const item of Object.values(state.items)) {
          const trackIdx = visibleTracks.findIndex((t) => t.id === item.trackId)
          if (trackIdx < 0) continue

          const clipLeft = item.startTime * PIXELS_PER_SECOND
          const clipRight = Math.max(clipLeft + 8, (item.startTime + item.duration) * PIXELS_PER_SECOND)

          const trackTop = 28 + centeringOffset + trackIdx * 54
          const trackBottom = trackTop + 52

          const overlapsX = clipLeft < left + width && clipRight > left
          const overlapsY = trackTop < top + height && trackBottom > top

          if (overlapsX && overlapsY) {
            intersectingIds.push(item.id)
            if (!e.altKey) {
              for (const lid of getLinkedItemIds(item.id)) {
                if (!intersectingIds.includes(lid)) {
                  intersectingIds.push(lid)
                }
              }
            }
          }
        }

        const nextSelection = marquee.isShift
          ? Array.from(new Set([...marquee.initialSelectedIds, ...intersectingIds]))
          : intersectingIds

        dispatch(new SelectItemsCommand(nextSelection))
      }
    }

    function handleMouseUp() {
      stopAutoScroll()
      if (marquee) {
        if (marquee.width <= 3 && marquee.height <= 3) {
          dispatch(new SetPlayheadCommand(marquee.clickTime))
          if (!marquee.isShift) {
            dispatch(new SelectItemCommand(null))
          }
        }
      }
      setMarquee(null)
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented) return
      if (e.key === 'Escape') {
        setMarquee(null)
        stopAutoScroll()
      }
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [
    marquee,
    state.items,
    visibleTracks,
    centeringOffset,
    getLinkedItemIds,
    updateAutoScroll,
    stopAutoScroll,
    dispatch,
  ])

  return (
    <div
      className="timeline-panel"
      tabIndex={0}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setMediaDrag(null)
          stopAutoScroll()
        }
      }}
    >
      {/* ── Fixed Toolbar: Editor Actions + Pinned Timer ── */}
      <div className="timeline-toolbar">
        <div className="timeline-toolbar-left">
          <span className="timeline-toolbar-title">Timeline</span>
        </div>

        <div className="timeline-toolbar-center">
          {/* Tool Group: Selection Tool (V) & Razor / Split Tool (C) */}
          <button
            type="button"
            className={`timeline-tool-btn ${!isSplitToolActive ? 'active' : ''}`}
            onClick={(e) => {
              setIsSplitToolActive(false)
              setSplitHover(null)
              e.currentTarget.blur()
            }}
            title="Selection Tool (V) — Select, move, and trim clips"
            aria-label="Selection Tool (V)"
          >
            <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor">
              <path d="M3 1.5l8.5 7.5-4.2.8 2.7 4.7-1.7 1-2.7-4.8L3 13.5V1.5z" />
            </svg>
          </button>
          <button
            type="button"
            className={`timeline-tool-btn ${isSplitToolActive ? 'active' : ''}`}
            onClick={(e) => {
              setIsSplitToolActive((prev) => !prev)
              setSplitHover(null)
              e.currentTarget.blur()
            }}
            title={
              isSplitToolActive
                ? 'Split Tool (C) — ACTIVE. Click clips to cut. Press V to switch to Selection Tool'
                : 'Split Tool (C / Razor) — Click anywhere on clips to cut multiple times'
            }
            aria-label="Toggle Split Tool"
          >
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="4" cy="4.5" r="2" />
              <circle cx="4" cy="11.5" r="2" />
              <path d="M5.5 5.5l7 7M5.5 10.5l7-7" strokeLinecap="round" />
            </svg>
          </button>
          <button
            className="timeline-tool-btn danger"
            onClick={handleDelete}
            disabled={selectedItemIds.length === 0}
            title="Delete selected clip(s) (Delete)"
            aria-label="Delete"
          >
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M2.5 4h11M5.5 4V2.5a1 1 0 011-1h3a1 1 0 011 1V4M6.5 7v5M9.5 7v5M3.5 4l.8 9.2a1.5 1.5 0 001.5 1.3h4.4a1.5 1.5 0 001.5-1.3L12.5 4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          {hasEmptySecondaryTracks && (
            <button
              className="timeline-tool-btn"
              onClick={() => dispatch(new CleanupEmptyTracksCommand())}
              title="Delete all empty secondary layers"
              aria-label="Clean empty layers"
            >
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M2 4h12M4 4V2.5a1 1 0 011-1h6a1 1 0 011 1V4M5 7v5M8 7v5M11 7v5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>Clean Empty Layers</span>
            </button>
          )}

          <span className="timeline-toolbar-divider" />

          {/* Snap Toggle Button */}
          <button
            className={`timeline-tool-btn ${isSnapping ? 'active' : ''}`}
            onClick={() => setIsSnapping((prev) => !prev)}
            title={isSnapping ? 'Snapping Enabled (N to toggle)' : 'Snapping Disabled (N to toggle)'}
            aria-label="Toggle Snapping"
          >
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M4 2v5.5a4 4 0 008 0V2M2.5 4.5h3M10.5 4.5h3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          {/* Link / Unlink Toggle Button */}
          <button
            className={`timeline-tool-btn ${isLinkedSelection ? 'active' : ''}`}
            onClick={handleToggleLink}
            disabled={!canToggleLink}
            title={
              isLinkedSelection
                ? 'Unlink selected media clips'
                : canLink
                ? 'Link selected media clips'
                : 'Link / Unlink media clips'
            }
            aria-label={isLinkedSelection ? 'Unlink clips' : 'Link clips'}
          >
            {isLinkedSelection ? (
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M6.5 9.5a3 3 0 010-4.24l2-2a3 3 0 014.24 4.24l-1 1M9.5 6.5a3 3 0 010 4.24l-2 2a3 3 0 01-4.24-4.24l1-1M2 2l12 12" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M6.5 9.5a3 3 0 010-4.24l2-2a3 3 0 014.24 4.24l-1 1M9.5 6.5a3 3 0 010 4.24l-2 2a3 3 0 01-4.24-4.24l1-1" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>

          <span className="timeline-toolbar-divider" />

          {/* Add Layer Menu Dropdown */}
          <div className="timeline-add-menu-container" ref={addMenuRef}>
            <button
              className={`timeline-tool-btn primary ${isAddMenuOpen ? 'active' : ''}`}
              onClick={() => setIsAddMenuOpen((prev) => !prev)}
              title="Add layer or import subtitles at playhead"
              aria-label="Add layer"
              aria-haspopup="true"
              aria-expanded={isAddMenuOpen}
            >
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M8 3v10M3 8h10" strokeLinecap="round" />
              </svg>
              <span>Add</span>
              <span style={{ fontSize: '9px', opacity: 0.7, marginLeft: '1px' }}>▾</span>
            </button>

            {isAddMenuOpen && (
              <div className="timeline-add-dropdown" role="menu">
                <button
                  className="timeline-add-menu-item"
                  role="menuitem"
                  onClick={() => {
                    handleAddText()
                    setIsAddMenuOpen(false)
                  }}
                >
                  <span style={{ fontWeight: 'bold', fontSize: '13px' }}>T</span>
                  <span>Text Layer</span>
                  <span className="menu-shortcut">T</span>
                </button>
                <button
                  className="timeline-add-menu-item"
                  role="menuitem"
                  onClick={() => {
                    handleAddSolid()
                    setIsAddMenuOpen(false)
                  }}
                >
                  <span>🎨</span>
                  <span>Solid Color</span>
                </button>
                <button
                  className="timeline-add-menu-item"
                  role="menuitem"
                  onClick={() => {
                    handleAddCaption()
                    setIsAddMenuOpen(false)
                  }}
                >
                  <span>💬</span>
                  <span>Caption Segment</span>
                </button>
                <button
                  className="timeline-add-menu-item"
                  role="menuitem"
                  onClick={() => {
                    handleAddAdjustmentLayer()
                    setIsAddMenuOpen(false)
                  }}
                >
                  <span>⚡</span>
                  <span>Adjustment Layer</span>
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="timeline-toolbar-right">
          <span className="timeline-time-display" title="Current playhead position">
            {formatTimecode(playheadTime, fps)}
          </span>
        </div>
      </div>

      {/* ── Main Timeline Area ── */}
      <div className="timeline-body">
        {/* Left Column: Fixed Track Headers */}
        <div
          className="timeline-headers-column"
          onWheel={(e) => {
            if (viewportRef.current) {
              if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
                viewportRef.current.scrollLeft += e.deltaX || e.deltaY
              } else {
                viewportRef.current.scrollTop += e.deltaY
              }
            }
          }}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          <div className="timeline-header-spacer">
            <span className="timeline-spacer-text">Tracks</span>
          </div>
          <div className="timeline-headers-viewport" ref={headersRef}>
            <div className="timeline-header-rows" style={{ marginTop: centeringOffset }}>
              {visibleTracks.map((track, index) => {
                  const isGhost = track.id.startsWith('NEW_')
                  const isTargeted = previewState.isCompatible && previewState.targetTrackId === track.id
                  const isFirstAudio = index === firstAudioIndex && index > 0
                  const isHovered = hoveredTrackId === track.id
                  const isSelected = selectedTrackId === track.id
                  const isEven = index % 2 === 0
                  const match = track.name.match(/\d+$/)
                  const trackNum = match ? match[0] : (index + 1)
                  const shortBadge =
                    track.type === 'video'
                      ? `V${trackNum}`
                      : track.type === 'audio'
                      ? `A${trackNum}`
                      : track.type === 'caption'
                      ? `CC${trackNum}`
                      : track.type.substring(0, 1).toUpperCase()

                  const trackClips = Object.values(state.items).filter((it) => it.trackId === track.id)
                  const hasClips = trackClips.length > 0

                  return (
                    <div
                      key={track.id}
                      className={`track-header-row ${track.type} ${isEven ? 'row-even' : 'row-odd'} ${isFirstAudio ? 'section-divider' : ''} ${isGhost ? 'new-track-ghost' : ''} ${isTargeted ? 'targeted' : ''} ${isHovered ? 'is-hovered' : ''} ${isSelected ? 'selected-track' : ''}`}
                      onMouseEnter={() => setHoveredTrackId(track.id)}
                      onMouseLeave={() => setHoveredTrackId(null)}
                      onClick={() => {
                        if (!isGhost) {
                          setSelectedTrackId(track.id)
                          dispatch(new SelectItemCommand(null))
                        }
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        if (!isGhost) {
                          setSelectedTrackId(track.id)
                          setContextMenu({
                            x: e.clientX,
                            y: e.clientY,
                            type: 'track',
                            trackId: track.id,
                          })
                        }
                      }}
                    >
                      <div className="track-header-main">
                        <span className={`track-badge ${track.type}`} title={`${track.type} Track ${trackNum}`}>
                          {track.type === 'video' || track.type === 'graphics' ? (
                            <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.5">
                              <rect x="2" y="3.5" width="8" height="9" rx="1.5" />
                              <path d="M10 6.5l4-2.5v8l-4-2.5" strokeLinecap="round" strokeLinejoin="round" fill="currentColor" fillOpacity="0.25" />
                            </svg>
                          ) : track.type === 'audio' ? (
                            <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.5">
                              <path d="M2.5 6h2l3-3v10l-3-3h-2a.5.5 0 01-.5-.5v-3a.5.5 0 01.5-.5z" fill="currentColor" fillOpacity="0.25" />
                              <path d="M10.5 5.5a3 3 0 010 5M12.5 3.5a5.5 5.5 0 010 9" strokeLinecap="round" />
                            </svg>
                          ) : (
                            <span style={{ fontSize: '10px', marginRight: '1px' }}>💬</span>
                          )}
                          <span className="track-badge-code">{shortBadge}</span>
                        </span>
                        <span className="track-header-name" title={track.name}>{track.name}</span>


                      </div>
                      <div className="track-header-meta">
                        <span className={`track-header-type-tag ${track.type}`}>{track.type}</span>
                        <span className="track-clip-count">{hasClips ? `${trackClips.length} clip${trackClips.length > 1 ? 's' : ''}` : 'empty'}</span>
                      </div>
                    </div>
                  )
                })
              }
            </div>
          </div>
        </div>

        {/* Right Area: Time Viewport */}
        <div
          className="timeline-time-viewport"
          ref={viewportRef}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onScroll={(e) => {
            // Keep header rows in sync with vertical scroll
            if (headersRef.current) {
              headersRef.current.scrollTop = e.currentTarget.scrollTop
            }
          }}
        >
          <div
            className="timeline-time-content"
            style={{ width: timelineWidth, minWidth: '100%' }}
            onMouseDown={handleMarqueeMouseDown}
          >
            {/* Pinned Time Ruler */}
            <div className="timeline-ruler" onMouseDown={handleStartScrub}>
              {ticks.map((t) => (
                <div
                  key={t}
                  className="ruler-tick"
                  style={{ left: t * PIXELS_PER_SECOND }}
                >
                  <span className="ruler-label">{formatTimecode(t, fps)}</span>
                </div>
              ))}

              {/* Playhead Cap on Ruler */}
              <div
                className="ruler-playhead-cap"
                style={{ left: playheadLeft }}
                onMouseDown={handleStartScrub}
              >
                <div className="playhead-diamond" />
              </div>
            </div>

            {/* Track Lanes */}
            <div
              className={`timeline-track-lanes ${isSplitToolActive ? 'split-tool-active' : ''}`}
              ref={lanesRef}
              style={{ marginTop: centeringOffset }}
              onMouseDown={handleMarqueeMouseDown}
              onMouseMove={(e) => {
                if (isSplitToolActive) {
                  const mouseTime = getTimeFromClientX(e.clientX)
                  setSplitHover({
                    time: mouseTime,
                    x: mouseTime * PIXELS_PER_SECOND,
                  })
                }
              }}
              onMouseLeave={() => {
                if (isSplitToolActive) {
                  setSplitHover(null)
                }
              }}
            >
              {/* Razor Cut Line Indicator */}
              {isSplitToolActive && splitHover && (
                <div
                  className="timeline-razor-indicator"
                  style={{ left: splitHover.x }}
                >
                  <div className="timeline-razor-badge">
                    <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <circle cx="4" cy="4.5" r="1.5" />
                      <circle cx="4" cy="11.5" r="1.5" />
                      <path d="M5.5 5.5l7 7M5.5 10.5l7-7" strokeLinecap="round" />
                    </svg>
                    <span>{formatTimecode(splitHover.time, fps)}</span>
                  </div>
                  <div className="timeline-razor-line" />
                </div>
              )}
              {visibleTracks.length === 0 ? null : (
                visibleTracks.map((track, index) => {
                  const trackItems = Object.values(previewState.items).filter((i) => i.trackId === track.id)
                  const isTargetTrack = previewState.isCompatible && previewState.targetTrackId === track.id
                  const isGhost = track.id.startsWith('NEW_')
                  const isFirstAudio = index === firstAudioIndex && index > 0
                  const isHovered = hoveredTrackId === track.id
                  const isEven = index % 2 === 0

                  return (
                    <div
                      key={track.id}
                      className={`track-lane ${track.type} ${isEven ? 'row-even' : 'row-odd'} ${isFirstAudio ? 'section-divider' : ''} ${isTargetTrack ? 'drag-over' : ''} ${isGhost ? 'ghost-lane' : ''} ${isHovered ? 'is-hovered' : ''} ${selectedTrackId === track.id ? 'selected-track' : ''}`}
                      data-track-id={track.id}
                      onMouseEnter={() => setHoveredTrackId(track.id)}
                      onMouseLeave={() => setHoveredTrackId(null)}
                      onClick={(e) => {
                        if ((e.target as HTMLElement).classList.contains('track-lane')) {
                          setSelectedTrackId(track.id)
                        }
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        if (!isGhost) {
                          setSelectedTrackId(track.id)
                          setContextMenu({
                            x: e.clientX,
                            y: e.clientY,
                            type: 'track',
                            trackId: track.id,
                          })
                        }
                      }}
                    >
                    {isGhost && trackItems.length === 0 && (
                      <span className="ghost-lane-text">Drop to create new track</span>
                    )}

                    {trackItems.map((item) => {
                      const isSelected = selectedItemIds.includes(item.id)
                      const isMovingThis = moveDrag?.itemId === item.id || moveDrag?.draggedItems.some((d) => d.itemId === item.id)
                      const isGhostItem = item.id === '__preview_media_drop__' || item.id === '__preview_media_drop_audio__'
                      const asset = state.assets[item.assetId] || (mediaDrag?.assetId === item.assetId ? { name: mediaDrag.assetName, type: mediaDrag.assetType, thumbnailUrl: mediaDrag.thumbnailUrl, path: mediaDrag.path } : null)
                      const isMissing = !!(asset as any)?.isMissing

                      const isSolidItem = item.itemType === 'solid' || !!item.solid
                      const isTextItem = item.itemType === 'text' || !!item.text
                      const isCaptionItem = item.itemType === 'caption' || !!item.caption
                      const isAdjustmentItem = item.itemType === 'adjustment'
                      const itemKind = isSolidItem ? 'solid' : isTextItem ? 'text' : isCaptionItem ? 'caption' : isAdjustmentItem ? 'adjustment' : track.type
                      const clipDisplayName = isSolidItem
                        ? `Solid (${item.solid?.color || '#3b82f6'})`
                        : isTextItem
                        ? `Text: "${item.text?.text || 'Text'}"`
                        : isCaptionItem
                        ? `CC: "${item.caption?.text || 'Caption'}"`
                        : isAdjustmentItem
                        ? 'Adjustment Layer'
                        : (asset?.name ?? item.id)

                      const clipLeft = item.startTime * PIXELS_PER_SECOND
                      const clipWidth = item.duration * PIXELS_PER_SECOND

                      const isEffectTarget = effectDropTarget?.itemId === item.id
                      const effectTargetClass = isEffectTarget
                        ? (effectDropTarget.isCompatible ? 'drop-target-effect-valid' : 'drop-target-effect-invalid')
                        : ''

                      return (
                        <div
                          key={item.id}
                          data-item-id={item.id}
                          className={`timeline-clip ${itemKind} ${isSelected ? 'selected' : ''} ${isMovingThis ? 'moving' : ''} ${isGhostItem ? 'ghost-item' : ''} ${isMissing ? 'is-missing' : ''} ${effectTargetClass}`}
                          style={{
                            left: clipLeft,
                            width: Math.max(clipWidth, 8),
                          }}
                          onMouseDown={(e) => !isGhostItem && handleClipMouseDown(e, item.id)}
                          onContextMenu={(e) => {
                            if (isGhostItem) return
                            e.preventDefault()
                            e.stopPropagation()
                            // If this clip isn't selected, select it (or its linked group)
                            if (!selectedItemIds.includes(item.id)) {
                              const group = getLinkedItemIds(item.id)
                              dispatch(new SelectItemsCommand(group))
                            }
                            setContextMenu({
                              x: e.clientX,
                              y: e.clientY,
                              type: 'clip',
                              clipId: item.id,
                            })
                          }}
                          title={`${clipDisplayName}${isMissing ? ' (Media Offline)' : ''}\n${formatTimecode(item.startTime, fps)} – ${formatTimecode(item.startTime + item.duration, fps)}${item.linkedItemId ? ' [Linked]' : ''}`}
                        >
                          {/* Left Trim Handle */}
                          {!isGhostItem && !isSplitToolActive && (
                            <div
                              className="trim-handle trim-left"
                              onMouseDown={(e) => handleTrimMouseDown(e, item.id, 'left')}
                              title="Trim left edge"
                            />
                          )}

                          {/* Media Display Area (Thumbnails / Waveform / Solid / Text / Caption / Adjustment) */}
                          <div className="clip-media-area">
                            {isSolidItem && (
                              <div
                                style={{
                                  width: '100%',
                                  height: '100%',
                                  backgroundColor: item.solid?.color || '#3b82f6',
                                  display: 'flex',
                                  alignItems: 'center',
                                  paddingLeft: '8px',
                                  opacity: 0.85,
                                }}
                              >
                                <span style={{ fontSize: '10px', color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}>
                                  🎨 Solid Layer
                                </span>
                              </div>
                            )}

                            {isTextItem && (
                              <div
                                style={{
                                  width: '100%',
                                  height: '100%',
                                  display: 'flex',
                                  alignItems: 'center',
                                  paddingLeft: '8px',
                                  fontSize: '11px',
                                  fontWeight: 600,
                                  color: item.text?.color || '#ffffff',
                                  textShadow: '0 1px 2px rgba(0,0,0,0.8)',
                                  overflow: 'hidden',
                                  whiteSpace: 'nowrap',
                                  textOverflow: 'ellipsis',
                                }}
                              >
                                🔤 {item.text?.text || 'Title Text'}
                              </div>
                            )}

                            {isCaptionItem && (
                              <div
                                style={{
                                  width: '100%',
                                  height: '100%',
                                  display: 'flex',
                                  alignItems: 'center',
                                  paddingLeft: '8px',
                                  fontSize: '10.5px',
                                  fontWeight: 500,
                                  color: '#fbcfe8',
                                  overflow: 'hidden',
                                  whiteSpace: 'nowrap',
                                  textOverflow: 'ellipsis',
                                }}
                              >
                                💬 {item.caption?.text || 'Caption'}
                              </div>
                            )}

                            {isAdjustmentItem && (
                              <div
                                style={{
                                  width: '100%',
                                  height: '100%',
                                  background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.45) 0%, rgba(139, 92, 246, 0.6) 100%)',
                                  display: 'flex',
                                  alignItems: 'center',
                                  paddingLeft: '8px',
                                  gap: '4px',
                                }}
                              >
                                <span style={{ fontSize: '10px', color: '#f3e8ff', fontWeight: 600, letterSpacing: '0.02em', textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}>
                                  ⚡ Adjustment Layer
                                </span>
                              </div>
                            )}

                            {!isSolidItem && !isTextItem && !isCaptionItem && !isAdjustmentItem && (track.type === 'video' || track.type === 'graphics') && !isGhostItem && (
                              <TimelineFilmstrip
                                item={item}
                                asset={asset as any}
                                clipWidth={clipWidth}
                              />
                            )}

                            {!isSolidItem && !isTextItem && !isCaptionItem && !isAdjustmentItem && track.type === 'audio' && !isGhostItem && (
                              <TimelineWaveform
                                item={item}
                                asset={asset as any}
                                clipWidth={clipWidth}
                              />
                            )}
                          </div>

                          {/* Solid Bottom Name Bar */}
                          <div className="clip-bottom-bar">
                            <span className="clip-name">
                              {item.speed?.reversed && <span className="clip-speed-badge rev" title="Reverse playback">◀ REV</span>}
                              {item.speed?.speed && item.speed.speed !== 1 && (
                                <span className="clip-speed-badge" title={`Speed: ${Math.round(item.speed.speed * 100)}%`}>
                                  {Math.round(item.speed.speed * 100)}%
                                </span>
                              )}
                              {clipDisplayName}
                              {isMissing && <span className="clip-missing-badge">⚠️ OFFLINE</span>}
                            </span>
                            {clipWidth > 60 && (
                              <span className="clip-duration">
                                {formatTimecode(item.duration, fps)}
                              </span>
                            )}
                          </div>

                          {/* Right Trim Handle */}
                          {!isGhostItem && !isSplitToolActive && (
                            <div
                              className="trim-handle trim-right"
                              onMouseDown={(e) => handleTrimMouseDown(e, item.id, 'right')}
                              title="Trim right edge"
                            />
                          )}
                        </div>
                      )
                    })}

                    {/* ── Transitions on this Track (Placed on clips / across cuts) ── */}
                    {Object.values(state.transitions || {})
                      .filter((tr) => tr.trackId === track.id)
                      .filter((tr) => {
                        // While dragging a clip: if the clip (or any linked partner) is displaced away from its original position/track, vanish!
                        // If moved back to original position without dropping, immediately come back!
                        if (moveDrag) {
                          const movingItem = state.items[moveDrag.itemId]
                          const draggedIds = new Set(moveDrag.draggedItems.map((d) => d.itemId))
                          if (moveDrag.itemId) draggedIds.add(moveDrag.itemId)
                          for (const id of Array.from(draggedIds)) {
                            for (const lid of getLinkedItemIdsForState(state, id)) {
                              draggedIds.add(lid)
                            }
                          }

                          const isAffected = !!((tr.leftClipId && draggedIds.has(tr.leftClipId)) || (tr.rightClipId && draggedIds.has(tr.rightClipId)))
                          if (isAffected) {
                            const timeDelta = Math.abs(moveDrag.currentStartTime - moveDrag.originalStartTime)
                            const originalTrackId = moveDrag.draggedItems.find((d) => d.itemId === moveDrag.itemId)?.originalTrackId ?? movingItem?.trackId
                            const trackChanged = moveDrag.targetTrackId !== originalTrackId
                            const isDisplaced = timeDelta >= 0.02 || trackChanged
                            if (isDisplaced) {
                              return false // Vanish while dragged away!
                            }
                          }
                        }

                        // While trimming a clip: if trimmed away from original cut, vanish!
                        // If moved back to original boundary, immediately come back!
                        if (trimDrag) {
                          const trimmedIds = new Set([trimDrag.itemId, ...trimDrag.linkedPartners.map((p) => p.itemId)])
                          for (const id of Array.from(trimmedIds)) {
                            for (const lid of getLinkedItemIdsForState(state, id)) {
                              trimmedIds.add(lid)
                            }
                          }

                          const isAffected = !!((tr.leftClipId && trimmedIds.has(tr.leftClipId)) || (tr.rightClipId && trimmedIds.has(tr.rightClipId)))
                          if (isAffected) {
                            const origBoundary = trimDrag.edge === 'right'
                              ? trimDrag.originalStartTime + trimDrag.originalDuration
                              : trimDrag.originalStartTime
                            const trimDelta = Math.abs(trimDrag.currentNewTime - origBoundary)
                            if (trimDelta >= 0.02) {
                              return false // Vanish while trimmed away!
                            }
                          }
                        }

                        return true
                      })
                      .map((tr) => {
                        const isInteracting = transitionInteraction?.transitionId === tr.id
                        const startTime = isInteracting
                          ? transitionInteraction.currentStartTime
                          : tr.startTime
                        const duration = isInteracting
                          ? transitionInteraction.currentDuration
                          : tr.duration
                        const isSelected = state.selectedTransitionId === tr.id

                        const left = startTime * PIXELS_PER_SECOND
                        const width = Math.max(3, duration * PIXELS_PER_SECOND)

                        const isTwoClip = !!(
                          tr.leftClipId &&
                          tr.rightClipId &&
                          state.items[tr.leftClipId] &&
                          state.items[tr.rightClipId]
                        )

                        return (
                          <div
                            key={tr.id}
                            data-transition-id={tr.id}
                            className={`timeline-transition-box ${isSelected ? 'selected' : ''} ${isInteracting ? 'interacting' : ''} ${isTwoClip ? 'two-clip' : 'single-clip'}`}
                            style={{
                              left,
                              width,
                              cursor: 'default',
                            }}
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation()
                              dispatch(new SelectTransitionCommand(tr.id))
                            }}
                            onContextMenu={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              dispatch(new SelectTransitionCommand(tr.id))
                              setContextMenu({
                                x: e.clientX,
                                y: e.clientY,
                                type: 'transition',
                                transitionId: tr.id,
                              })
                            }}
                            title={
                              isTwoClip
                                ? `${tr.name} (${duration.toFixed(2)}s)\nAttached to edit cut • Resize duration using the selected alignment`
                                : `${tr.name} (${duration.toFixed(2)}s)\nAnchored to clip edge • Drag edges to trim duration`
                            }
                          >
                            <div
                              className="tr-trim-handle left"
                              onMouseDown={(e) => handleTransitionMouseDown(e, tr.id, 'trim-left')}
                              title={
                                isTwoClip
                                  ? 'Resize duration using the selected alignment'
                                  : 'Drag to trim transition start'
                              }
                            />
                            <div className="tr-box-content">
                              <span className="tr-box-name">{tr.name}</span>
                            </div>
                            <div
                              className="tr-trim-handle right"
                              onMouseDown={(e) => handleTransitionMouseDown(e, tr.id, 'trim-right')}
                              title={
                                isTwoClip
                                  ? 'Resize duration using the selected alignment'
                                  : 'Drag to trim transition duration'
                              }
                            />
                          </div>
                        )
                      })}

                    {/* Transition Drag Ghost Preview */}
                    {transitionDrag && transitionDrag.targetTrackId === track.id && (
                      <div
                        className="timeline-transition-box ghost"
                        style={{
                          left: transitionDrag.startTime * PIXELS_PER_SECOND,
                          width: Math.max(3, transitionDrag.duration * PIXELS_PER_SECOND),
                        }}
                      >
                        <div className="tr-box-content">
                          <span className="tr-box-name">{transitionDrag.transition.name}</span>
                        </div>
                      </div>
                    )}
                  </div>
                )
              }))}
            </div>

            {/* Marquee Selection Area Box */}
            {marquee && (marquee.width > 3 || marquee.height > 3) && (
              <div
                className="timeline-marquee-selection"
                style={{
                  left: marquee.left,
                  top: marquee.top,
                  width: marquee.width,
                  height: marquee.height,
                }}
              />
            )}

            {/* Visual Snap Indicator Vertical Line */}
            {snapIndicatorTime !== null && (
              <div
                className="timeline-snap-indicator"
                style={{ left: snapIndicatorTime * PIXELS_PER_SECOND }}
              />
            )}

            {/* Full-Height Playhead Vertical Line */}
            <div
              className="timeline-playhead-line"
              style={{ left: playheadLeft }}
            />
          </div>
        </div>
      </div>

      {/* ── Context Menu Overlay ── */}
      {contextMenu && (
        <div
          className="timeline-context-menu"
          style={{
            top: Math.min(contextMenu.y, window.innerHeight - 80),
            left: Math.min(contextMenu.x, window.innerWidth - 120),
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {contextMenu.type === 'clip' && (
            <>
              {canUnlink && (
                <button
                  className="timeline-context-item"
                  onClick={() => {
                    handleUnlinkSelected()
                    setContextMenu(null)
                  }}
                >
                  Unlink
                </button>
              )}

              {canLink && (
                <button
                  className="timeline-context-item"
                  onClick={() => {
                    handleLinkSelected()
                    setContextMenu(null)
                  }}
                >
                  Link
                </button>
              )}

              <button
                className="timeline-context-item danger"
                onClick={() => {
                  handleDelete()
                  setContextMenu(null)
                }}
              >
                Delete
              </button>
            </>
          )}

          {contextMenu.type === 'track' && contextMenu.trackId && (
            <button
              className="timeline-context-item danger"
              onClick={() => {
                handleDeleteTrack(contextMenu.trackId!)
                setContextMenu(null)
              }}
            >
              Delete Track
            </button>
          )}

          {contextMenu.type === 'transition' && contextMenu.transitionId && (
            <button
              className="timeline-context-item danger"
              onClick={() => {
                dispatch(new RemoveTransitionCommand(contextMenu.transitionId!))
                dispatch(new SelectTransitionCommand(null))
                setContextMenu(null)
              }}
            >
              Delete Transition
            </button>
          )}
        </div>
      )}
    </div>
  )
}

