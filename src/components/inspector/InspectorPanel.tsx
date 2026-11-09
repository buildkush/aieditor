import { CaptionCustomization } from '../captions/CaptionCustomization'
import { selectedCaptionIds, allCaptionIds } from '../../core/commands/captionStyleCommands'
import { CaptionStylePicker } from '../captions/CaptionStylePicker'
import { useState, useMemo, useRef, useEffect } from 'react'
import type { ProjectState } from '../../core/project/projectState'
import type { EditorCommand } from '../../core/commands/editorCommand'
import {
  UpdateTransformCommand,
  ResetTransformCommand,
  UpdateCropCommand,
  ResetCropCommand,
  UpdateAudioPropertiesCommand,
  ResetAudioPropertiesCommand,
  UpdateSpeedCommand,
  ResetSpeedCommand,
  SetKeyframeValueCommand,
  ToggleKeyframeAtPlayheadCommand,
  UpdateSolidLayerCommand,
  UpdateTextCommand,
  UpdateCaptionCommand,
  SplitCaptionCommand,
  MergeCaptionsCommand,
  ApplyCaptionStyleCommand,
  SetBlendModeCommand,
  RemoveEffectCommand,
  ToggleEffectCommand,
  UpdateEffectParamCommand,
  ReorderEffectsCommand,
  ResetEffectParamsCommand,
  RemoveTransitionCommand,
  UpdateTransitionCommand,
  SelectTransitionCommand,
} from '../../core/commands/editorCommand'
import { getClipTransitions } from '../../core/commands/projectCommands'
import {
  DEFAULT_TRANSFORM,
  DEFAULT_CROP,
  DEFAULT_AUDIO_PROPERTIES,
  DEFAULT_SPEED_PROPERTIES,
  DEFAULT_SOLID_PROPERTIES,
  DEFAULT_TEXT_PROPERTIES,
  type TimelineItem,
  type TimelineTransition,
  type TextProperties,
} from '../../core/timeline/types'
import {
  evaluateItemTransform,
  evaluateItemCrop,
  evaluateItemAudio,
  evaluateItemProperty,
  normalizePropertyKey,
  hasKeyframeAtPlayhead,
  isPropertyKeyframed,
} from '../../core/timeline/keyframeEvaluation'
import { generateWordTiming } from '../../core/subtitles/subtitleParser'
import { formatTimecode } from '../../core/timecode'
import { useClearMergeKey } from '../../store/projectStore'
import { ScrubbableNumberInput } from './ScrubbableNumberInput'
import { CustomSelect, type SelectOption } from './CustomSelect'
import { Thumbwheel } from './Thumbwheel'
import { TextStyleControls, TextShadowSection, TextBackgroundSection, InspectorColorInput } from './TextStyleControls'
import { getEffectDefinition } from '../tools/effectDefinitions'
import { TRANSITION_DEFINITIONS, normalizeTransitionId, getTransitionDirection } from '../../core/timeline/transitionDefinitions'
import './InspectorPanel.css'

export type InspectorTab = 'video' | 'audio' | 'effects' | 'transitions'

export const AVAILABLE_TRANSITIONS = TRANSITION_DEFINITIONS

export interface InspectorPanelProps {
  state: ProjectState
  dispatch: (command: EditorCommand) => void
  onClearMergeKey?: () => void
  onToggleCollapse?: () => void
  forcedTab?: InspectorTab | null
  onTabChange?: (tab: InspectorTab) => void
  zoomLinked?: boolean
  onZoomLinkedChange?: (linked: boolean) => void
}

const BLEND_MODE_OPTIONS: SelectOption[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'multiply', label: 'Multiply' },
  { value: 'screen', label: 'Screen' },
  { value: 'overlay', label: 'Overlay' },
  { value: 'soft-light', label: 'Soft Light' },
  { value: 'hard-light', label: 'Hard Light' },
  { value: 'darken', label: 'Darken' },
  { value: 'lighten', label: 'Lighten' },
  { value: 'difference', label: 'Difference' },
  { value: 'add', label: 'Add' },
  { value: 'color-dodge', label: 'Color Dodge' },
  { value: 'color-burn', label: 'Color Burn' },
  { value: 'exclusion', label: 'Exclusion' },
  { value: 'luminosity', label: 'Luminosity' },
]

/**
 * Modern, consistent NLE Inspector Panel.
 * - Consistent input widths (68px) and row structures across all sections.
 * - Pure numbers with no units.
 * - Sliders for Rotation, Pitch, Yaw, Opacity, Crop edges, Volume, and Pan.
 * - Icons for Flip Horizontal and Flip Vertical.
 * - Two icon buttons for Speed Direction (Forward / Reverse) with active highlight.
 * - Four separate rows for Crop (Left, Right, Top, Bottom).
 * - Custom dark dropdown for Blend Mode.
 * - Clean disabled input for Duration without lock icon.
 */
export function InspectorPanel({
  state,
  dispatch,
  onClearMergeKey,
  onToggleCollapse,
  forcedTab,
  onTabChange,
  zoomLinked: controlledZoomLinked,
  onZoomLinkedChange,
}: InspectorPanelProps) {
  const { settings } = state
  const fps = settings.fps || 30
  const storeClearMergeKey = useClearMergeKey()
  const clearMergeKey = onClearMergeKey || storeClearMergeKey
  const selectedTransition = state.selectedTransitionId ? state.transitions?.[state.selectedTransitionId] : null

  // Find all items relevant to current selection (including linked partners)
  const relevantItems = useMemo(() => {
    const ids = new Set<string>()
    if (state.selectedItemId) ids.add(state.selectedItemId)
    if (state.selectedItemIds) {
      for (const id of state.selectedItemIds) ids.add(id)
    }
    // Older saved selections may contain only a transition ID. Resolve its clip
    // context so the Inspector always uses the same clip tabs and transition list.
    if (selectedTransition && ![selectedTransition.leftClipId, selectedTransition.rightClipId].some(id => id && ids.has(id))) {
      ids.clear()
      const owner = selectedTransition.rightClipId ?? selectedTransition.leftClipId
      if (owner) ids.add(owner)
    }

    const items: TimelineItem[] = []
    for (const id of ids) {
      const it = state.items[id]
      if (it) {
        items.push(it)
        if (it.linkedItemId && !ids.has(it.linkedItemId)) {
          const partner = state.items[it.linkedItemId]
          if (partner) items.push(partner)
        }
      }
    }
    return items
  }, [state.selectedItemId, state.selectedItemIds, state.items, selectedTransition])

  // Categorize items into Solid, Text, Captions, Video, Audio
  const solidItem = useMemo(() => {
    return relevantItems.find((it) => it.itemType === 'solid' || !!it.solid) ?? null
  }, [relevantItems])

  const textItem = useMemo(() => {
    return relevantItems.find((it) => it.itemType === 'text' || !!it.text) ?? null
  }, [relevantItems])

  const captionItem = useMemo(() => {
    return (
      relevantItems.find((it) => {
        const track = state.tracks.find((t) => t.id === it.trackId)
        return (
          track?.type === 'caption' ||
          it.streamType === 'caption' ||
          it.itemType === 'caption' ||
          !!it.caption
        )
      }) ?? null
    )
  }, [relevantItems, state.tracks])

  const rawVideoItem = useMemo(() => {
    return (
      relevantItems.find((it) => {
        const track = state.tracks.find((t) => t.id === it.trackId)
        const asset = state.assets[it.assetId]
        return (
          track?.type === 'video' ||
          track?.type === 'graphics' ||
          track?.type === 'caption' ||
          it.streamType === 'video' ||
          it.streamType === 'caption' ||
          asset?.type === 'video' ||
          asset?.type === 'image' ||
          it.itemType === 'video' ||
          it.itemType === 'image' ||
          it.itemType === 'solid' ||
          it.itemType === 'text' ||
          it.itemType === 'caption' ||
          it.itemType === 'adjustment' ||
          !!it.solid ||
          !!it.text ||
          !!it.caption
        )
      }) ?? null
    )
  }, [relevantItems, state.tracks, state.assets])

  const audioItem = useMemo(() => {
    return (
      relevantItems.find((it) => {
        const track = state.tracks.find((t) => t.id === it.trackId)
        const asset = state.assets[it.assetId]
        return (
          track?.type === 'audio' ||
          it.streamType === 'audio' ||
          asset?.type === 'audio'
        )
      }) ?? null
    )
  }, [relevantItems, state.tracks, state.assets])

  // Visual item: rawVideoItem, or any item that has visual properties (including text, caption, solid, adjustment)
  const videoItem =
    rawVideoItem ??
    (!audioItem && relevantItems.length > 0 ? relevantItems[0] : captionItem ?? textItem ?? solidItem ?? null)

  const isSolid = !!solidItem || (videoItem?.itemType === 'solid' || !!videoItem?.solid)
  const isText = !!textItem || (videoItem?.itemType === 'text' || !!videoItem?.text)
  const isCaption = !!captionItem || (videoItem?.itemType === 'caption' || !!videoItem?.caption)
  const isAdjustment = videoItem?.itemType === 'adjustment'

  // Primary selected target item for attached effects
  const targetItem = videoItem || audioItem || (relevantItems.length > 0 ? relevantItems[0] : null)
  const appliedEffects = targetItem?.effects || []
  const hasEffects = appliedEffects.length > 0

  // Determine available tabs
  const hasVideo = !!videoItem
  const hasAudio = !!audioItem

  // User explicitly selected tab (video, audio, effects)
  const [userTab, setUserTab] = useState<InspectorTab | null>(null)

  // Track primary selection ID so switching clips automatically adapts the tab
  const primarySelectedId = state.selectedItemId ?? (state.selectedItemIds && state.selectedItemIds[0]) ?? null
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(primarySelectedId)

  if (primarySelectedId !== lastSelectedId) {
    setLastSelectedId(primarySelectedId)
    setUserTab(null)
  }

  const clipTransitions = targetItem ? getClipTransitions(state, targetItem.id) : null
  const hasTransitionsTab = !!selectedTransition || !!clipTransitions?.startTransition || !!clipTransitions?.endTransition

  // Derive effective activeTab dynamically
  const activeTab: InspectorTab = useMemo(() => {
    if (selectedTransition) return 'transitions'
    if (forcedTab && (forcedTab !== 'transitions' || hasTransitionsTab)) return forcedTab
    const requested = userTab
    if (requested === 'transitions') {
      if (hasTransitionsTab) return 'transitions'
      return hasVideo ? 'video' : hasAudio ? 'audio' : 'video'
    }
    if (requested === 'effects') {
      if (hasEffects) return 'effects'
      return hasVideo ? 'video' : hasAudio ? 'audio' : 'video'
    }
    if (requested === 'audio') {
      if (hasAudio) return 'audio'
      return hasVideo ? 'video' : hasEffects ? 'effects' : 'audio'
    }
    if (requested === 'video') {
      if (hasVideo) return 'video'
      return hasAudio ? 'audio' : hasEffects ? 'effects' : 'video'
    }
    // Default priority
    if (hasVideo) return 'video'
    if (hasAudio) return 'audio'
    if (hasEffects) return 'effects'
    if (hasTransitionsTab) return 'transitions'
    return 'video'
  }, [forcedTab, selectedTransition, userTab, hasVideo, hasAudio, hasEffects, hasTransitionsTab])

  // Collapsible section states
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({
    solid: false,
    adjustment: false,
    text: false,
    textShadow: false,
    textBackground: false,
    transform: false,
    crop: false,
    composite: false,
    speed: false,
    audio: false,
    captionContent: false,
    captionPresets: false,
    captionStyle: false,
    captionShadow: false,
    captionBackground: false,
    captionAnimation: false,
    captionWords: false,
  })

  const toggleSection = (section: string) => {
    setCollapsed((prev) => ({ ...prev, [section]: !prev[section] }))
  }

  // Zoom uniform link state (default linked)
  const [localZoomLinked, setLocalZoomLinked] = useState(true)
  const zoomLinked = controlledZoomLinked ?? localZoomLinked
  const setZoomLinked = onZoomLinkedChange ?? setLocalZoomLinked

  const activeItem =
    activeTab === 'video'
      ? videoItem
      : activeTab === 'audio'
      ? audioItem
      : (captionItem ?? videoItem ?? audioItem)

  // If no items selected and no transition selected
  if ((relevantItems.length === 0 || !activeItem) && !selectedTransition) {
    return (
      <div className="inspector-container">
        <div className="panel-header">
          <span className="panel-header-title">Inspector</span>
          {onToggleCollapse && (
            <button
              className="panel-collapse-btn"
              onClick={onToggleCollapse}
              title="Collapse Inspector Panel"
              aria-label="Collapse Inspector Panel"
            >
              ›
            </button>
          )}
        </div>
        <div className="inspector-body inspector-empty">
          <div className="inspector-empty-content">
            <span className="inspector-empty-icon">🔍</span>
            <p>Select a clip to inspect</p>
          </div>
        </div>
      </div>
    )
  }

  const playheadTime = state.playheadTime ?? 0
  const transform = videoItem ? evaluateItemTransform(videoItem, playheadTime) : DEFAULT_TRANSFORM
  const crop = videoItem ? evaluateItemCrop(videoItem, playheadTime) : DEFAULT_CROP
  const audioProps = audioItem ? evaluateItemAudio(audioItem, playheadTime) : DEFAULT_AUDIO_PROPERTIES
  const speedProps = activeItem?.speed ?? DEFAULT_SPEED_PROPERTIES

  const isKfActive = (key: string) => {
    if (!activeItem) return false
    const frameTol = 0.005
    if (key === 'position') {
      return (
        hasKeyframeAtPlayhead(activeItem, 'x', playheadTime, frameTol, fps) ||
        hasKeyframeAtPlayhead(activeItem, 'y', playheadTime, frameTol, fps)
      )
    }
    if (key === 'zoom') {
      return (
        hasKeyframeAtPlayhead(activeItem, 'scale', playheadTime, frameTol, fps) ||
        hasKeyframeAtPlayhead(activeItem, 'scaleX', playheadTime, frameTol, fps) ||
        hasKeyframeAtPlayhead(activeItem, 'scaleY', playheadTime, frameTol, fps)
      )
    }
    if (key === 'anchor') {
      return (
        hasKeyframeAtPlayhead(activeItem, 'anchorX', playheadTime, frameTol, fps) ||
        hasKeyframeAtPlayhead(activeItem, 'anchorY', playheadTime, frameTol, fps)
      )
    }
    if (key === 'crop') {
      return (
        hasKeyframeAtPlayhead(activeItem, 'cropLeft', playheadTime, frameTol, fps) ||
        hasKeyframeAtPlayhead(activeItem, 'cropRight', playheadTime, frameTol, fps) ||
        hasKeyframeAtPlayhead(activeItem, 'cropTop', playheadTime, frameTol, fps) ||
        hasKeyframeAtPlayhead(activeItem, 'cropBottom', playheadTime, frameTol, fps)
      )
    }
    const normKey = normalizePropertyKey(key)
    return hasKeyframeAtPlayhead(activeItem, normKey, playheadTime, frameTol, fps)
  }

  const toggleKf = (key: string) => {
    if (!activeItem) return
    dispatch(new ToggleKeyframeAtPlayheadCommand(activeItem.id, key, playheadTime))
  }

  const renderKfControl = (key: string, titleText: string) => {
    const atPlayhead = isKfActive(key)

    return (
      <div className="inspector-kf-group">
        <button
          className={`inspector-kf-btn ${atPlayhead ? 'active' : ''}`}
          onClick={(e) => {
            e.stopPropagation()
            toggleKf(key)
          }}
          title={atPlayhead ? `${titleText} (Keyframe present - Click to remove)` : `${titleText} (Click to add keyframe)`}
          aria-label={titleText}
        >
          <span className="inspector-kf-diamond">{atPlayhead ? '◆' : '◇'}</span>
        </button>
      </div>
    )
  }

  // ──── Transform Handlers ────
  const handleZoomXChange = (newVal: number) => {
    if (!videoItem) return
    const isKf =
      isPropertyKeyframed(videoItem, 'zoom') ||
      isPropertyKeyframed(videoItem, 'scale') ||
      isPropertyKeyframed(videoItem, 'scaleX')
    if (isKf) {
      if (zoomLinked) {
        dispatch(new SetKeyframeValueCommand(videoItem.id, 'scale', playheadTime, newVal, `kf-scale-${videoItem.id}`))
        dispatch(new SetKeyframeValueCommand(videoItem.id, 'scaleX', playheadTime, newVal, `kf-scalex-${videoItem.id}`))
        dispatch(new SetKeyframeValueCommand(videoItem.id, 'scaleY', playheadTime, newVal, `kf-scaley-${videoItem.id}`))
      } else {
        dispatch(new SetKeyframeValueCommand(videoItem.id, 'scaleX', playheadTime, newVal, `kf-scalex-${videoItem.id}`))
      }
    } else {
      if (zoomLinked) {
        dispatch(
          new UpdateTransformCommand(
            videoItem.id,
            { scale: newVal, scaleX: newVal, scaleY: newVal },
            `transform-scale-${videoItem.id}`
          )
        )
      } else {
        dispatch(
          new UpdateTransformCommand(
            videoItem.id,
            { scaleX: newVal },
            `transform-scalex-${videoItem.id}`
          )
        )
      }
    }
  }

  const handleZoomYChange = (newVal: number) => {
    if (!videoItem) return
    const isKf =
      isPropertyKeyframed(videoItem, 'zoom') ||
      isPropertyKeyframed(videoItem, 'scale') ||
      isPropertyKeyframed(videoItem, 'scaleY')
    if (isKf) {
      if (zoomLinked) {
        dispatch(new SetKeyframeValueCommand(videoItem.id, 'scale', playheadTime, newVal, `kf-scale-${videoItem.id}`))
        dispatch(new SetKeyframeValueCommand(videoItem.id, 'scaleX', playheadTime, newVal, `kf-scalex-${videoItem.id}`))
        dispatch(new SetKeyframeValueCommand(videoItem.id, 'scaleY', playheadTime, newVal, `kf-scaley-${videoItem.id}`))
      } else {
        dispatch(new SetKeyframeValueCommand(videoItem.id, 'scaleY', playheadTime, newVal, `kf-scaley-${videoItem.id}`))
      }
    } else {
      if (zoomLinked) {
        dispatch(
          new UpdateTransformCommand(
            videoItem.id,
            { scale: newVal, scaleX: newVal, scaleY: newVal },
            `transform-scale-${videoItem.id}`
          )
        )
      } else {
        dispatch(
          new UpdateTransformCommand(
            videoItem.id,
            { scaleY: newVal },
            `transform-scaley-${videoItem.id}`
          )
        )
      }
    }
  }

  const handlePosXChange = (newVal: number) => {
    if (!videoItem) return
    if (isPropertyKeyframed(videoItem, 'position') || isPropertyKeyframed(videoItem, 'x')) {
      dispatch(new SetKeyframeValueCommand(videoItem.id, 'x', playheadTime, newVal, `kf-x-${videoItem.id}`))
    } else {
      dispatch(new UpdateTransformCommand(videoItem.id, { x: newVal }, `transform-x-${videoItem.id}`))
    }
  }

  const handlePosYChange = (newVal: number) => {
    if (!videoItem) return
    if (isPropertyKeyframed(videoItem, 'position') || isPropertyKeyframed(videoItem, 'y')) {
      dispatch(new SetKeyframeValueCommand(videoItem.id, 'y', playheadTime, newVal, `kf-y-${videoItem.id}`))
    } else {
      dispatch(new UpdateTransformCommand(videoItem.id, { y: newVal }, `transform-y-${videoItem.id}`))
    }
  }

  const handleRotationChange = (newVal: number) => {
    if (!videoItem) return
    if (isPropertyKeyframed(videoItem, 'rotation')) {
      dispatch(new SetKeyframeValueCommand(videoItem.id, 'rotation', playheadTime, newVal, `kf-rot-${videoItem.id}`))
    } else {
      dispatch(new UpdateTransformCommand(videoItem.id, { rotation: newVal }, `transform-rot-${videoItem.id}`))
    }
  }

  const handleAnchorXChange = (newVal: number) => {
    if (!videoItem) return
    if (isPropertyKeyframed(videoItem, 'anchor') || isPropertyKeyframed(videoItem, 'anchorX')) {
      dispatch(new SetKeyframeValueCommand(videoItem.id, 'anchorX', playheadTime, newVal, `kf-anchorx-${videoItem.id}`))
    } else {
      dispatch(new UpdateTransformCommand(videoItem.id, { anchorX: newVal }, `transform-anchorx-${videoItem.id}`))
    }
  }

  const handleAnchorYChange = (newVal: number) => {
    if (!videoItem) return
    if (isPropertyKeyframed(videoItem, 'anchor') || isPropertyKeyframed(videoItem, 'anchorY')) {
      dispatch(new SetKeyframeValueCommand(videoItem.id, 'anchorY', playheadTime, newVal, `kf-anchory-${videoItem.id}`))
    } else {
      dispatch(new UpdateTransformCommand(videoItem.id, { anchorY: newVal }, `transform-anchory-${videoItem.id}`))
    }
  }

  const handlePitchChange = (newVal: number) => {
    if (!videoItem) return
    if (isPropertyKeyframed(videoItem, 'pitch')) {
      dispatch(new SetKeyframeValueCommand(videoItem.id, 'pitch', playheadTime, newVal, `kf-pitch-${videoItem.id}`))
    } else {
      dispatch(new UpdateTransformCommand(videoItem.id, { pitch: newVal }, `transform-pitch-${videoItem.id}`))
    }
  }

  const handleYawChange = (newVal: number) => {
    if (!videoItem) return
    if (isPropertyKeyframed(videoItem, 'yaw')) {
      dispatch(new SetKeyframeValueCommand(videoItem.id, 'yaw', playheadTime, newVal, `kf-yaw-${videoItem.id}`))
    } else {
      dispatch(new UpdateTransformCommand(videoItem.id, { yaw: newVal }, `transform-yaw-${videoItem.id}`))
    }
  }

  const handleFlipH = () => {
    if (!videoItem) return
    dispatch(new UpdateTransformCommand(videoItem.id, { flipH: !transform.flipH }))
  }

  const handleFlipV = () => {
    if (!videoItem) return
    dispatch(new UpdateTransformCommand(videoItem.id, { flipV: !transform.flipV }))
  }

  // ──── Crop Handlers ────
  const handleCropChange = (edge: 'left' | 'right' | 'top' | 'bottom', val: number) => {
    if (!videoItem) return
    const propKey = `crop${edge.charAt(0).toUpperCase() + edge.slice(1)}`
    if (
      isPropertyKeyframed(videoItem, 'crop') ||
      isPropertyKeyframed(videoItem, propKey) ||
      isPropertyKeyframed(videoItem, `crop_${edge}`)
    ) {
      dispatch(new SetKeyframeValueCommand(videoItem.id, propKey, playheadTime, val, `kf-crop-${edge}-${videoItem.id}`))
    } else {
      dispatch(new UpdateCropCommand(videoItem.id, { [edge]: val }, `crop-${edge}-${videoItem.id}`))
    }
  }

  // ──── Composite Handlers ────
  const handleBlendModeChange = (mode: string) => {
    if (!videoItem) return
    dispatch(new SetBlendModeCommand(videoItem.id, mode))
  }




  const handleOpacityChange = (valPercent: number) => {
    if (!videoItem) return
    const opacityVal = Math.max(0, Math.min(1, valPercent / 100))
    if (isPropertyKeyframed(videoItem, 'opacity') || isPropertyKeyframed(videoItem, 'composite')) {
      dispatch(new SetKeyframeValueCommand(videoItem.id, 'opacity', playheadTime, opacityVal, `kf-opacity-${videoItem.id}`))
    } else {
      dispatch(new UpdateTransformCommand(videoItem.id, { opacity: opacityVal }, `opacity-${videoItem.id}`))
    }
  }

  // ──── Speed Handlers ────
  const projectFps = fps > 0 ? fps : 30
  const currentSpeedAbs = Math.abs(speedProps.speed || 1)
  const isReversed = !!speedProps.reversed
  const signedSpeedRatio = (isReversed ? -1 : 1) * currentSpeedAbs
  const displaySpeedPercent = Math.round(signedSpeedRatio * 100000) / 1000
  const displayFps = Math.round(signedSpeedRatio * projectFps * 1000) / 1000

  const handleSpeedPercentChange = (valPercent: number) => {
    if (!activeItem) return
    const safePercent = Number.isFinite(valPercent) ? valPercent : 100
    const reversed = safePercent < 0
    const rawSpeed = Math.max(0.01, Math.min(100, Math.abs(safePercent) / 100))
    const syncedFps = (reversed ? -1 : 1) * (Math.round(rawSpeed * projectFps * 1000) / 1000)
    dispatch(
      new UpdateSpeedCommand(
        activeItem.id,
        { speed: rawSpeed, reversed, fps: syncedFps },
        `speed-${activeItem.id}`
      )
    )
  }

  const handleSpeedFpsChange = (valFps: number) => {
    if (!activeItem) return
    const safeFpsVal = Number.isFinite(valFps) ? valFps : projectFps
    const reversed = safeFpsVal < 0
    const rawSpeed = Math.max(0.01, Math.min(100, Math.abs(safeFpsVal) / projectFps))
    const syncedFps = (reversed ? -1 : 1) * (Math.round(rawSpeed * projectFps * 1000) / 1000)
    dispatch(
      new UpdateSpeedCommand(
        activeItem.id,
        { speed: rawSpeed, reversed, fps: syncedFps },
        `speed-fps-${activeItem.id}`
      )
    )
  }

  const handleSetDirection = (reversed: boolean) => {
    if (!activeItem || isReversed === reversed) return
    const syncedFps = (reversed ? -1 : 1) * (Math.round(currentSpeedAbs * projectFps * 1000) / 1000)
    dispatch(
      new UpdateSpeedCommand(activeItem.id, {
        speed: currentSpeedAbs,
        reversed,
        fps: syncedFps,
      })
    )
  }

  // Final duration readout calculation
  const rawClipDuration = activeItem ? Math.max(0.01, activeItem.sourceOut - activeItem.sourceIn) : 0
  const finalDurationSec = rawClipDuration / Math.max(0.01, currentSpeedAbs)
  const finalDurationFormatted = formatTimecode(finalDurationSec, fps)

  // ──── Audio Handlers ────
  const handleVolumeChange = (valPercent: number) => {
    if (!audioItem) return
    const vol = Math.max(0, Math.min(4, valPercent / 100))
    if (isPropertyKeyframed(audioItem, 'volume') || isPropertyKeyframed(audioItem, 'audio')) {
      dispatch(new SetKeyframeValueCommand(audioItem.id, 'volume', playheadTime, vol, `kf-vol-${audioItem.id}`))
    } else {
      dispatch(new UpdateAudioPropertiesCommand(audioItem.id, { volume: vol }, `audio-vol-${audioItem.id}`))
    }
  }

  const handlePanChange = (panVal: number) => {
    if (!audioItem) return
    const clamped = Math.max(-1, Math.min(1, panVal / 100))
    if (isPropertyKeyframed(audioItem, 'pan') || isPropertyKeyframed(audioItem, 'audio')) {
      dispatch(new SetKeyframeValueCommand(audioItem.id, 'pan', playheadTime, clamped, `kf-pan-${audioItem.id}`))
    } else {
      dispatch(new UpdateAudioPropertiesCommand(audioItem.id, { pan: clamped }, `audio-pan-${audioItem.id}`))
    }
  }

  // ──── Double-Click Reset Handlers ────
  const resetZoom = () => {
    if (!videoItem) return
    handleZoomXChange(1)
    handleZoomYChange(1)
    dispatch(new UpdateTransformCommand(videoItem.id, { scale: 1, scaleX: 1, scaleY: 1 }))
    clearMergeKey()
  }

  const resetZoomX = () => {
    if (!videoItem) return
    handleZoomXChange(1)
    dispatch(new UpdateTransformCommand(videoItem.id, { scaleX: 1, ...(zoomLinked ? { scale: 1, scaleY: 1 } : {}) }))
    clearMergeKey()
  }

  const resetZoomY = () => {
    if (!videoItem) return
    handleZoomYChange(1)
    dispatch(new UpdateTransformCommand(videoItem.id, { scaleY: 1, ...(zoomLinked ? { scale: 1, scaleX: 1 } : {}) }))
    clearMergeKey()
  }

  const resetPosition = () => {
    if (!videoItem) return
    handlePosXChange(0)
    handlePosYChange(0)
    dispatch(new UpdateTransformCommand(videoItem.id, { x: 0, y: 0 }))
    clearMergeKey()
  }

  const resetPosX = () => {
    if (!videoItem) return
    handlePosXChange(0)
    dispatch(new UpdateTransformCommand(videoItem.id, { x: 0 }))
    clearMergeKey()
  }

  const resetPosY = () => {
    if (!videoItem) return
    handlePosYChange(0)
    dispatch(new UpdateTransformCommand(videoItem.id, { y: 0 }))
    clearMergeKey()
  }

  const resetRotation = () => {
    if (!videoItem) return
    handleRotationChange(0)
    dispatch(new UpdateTransformCommand(videoItem.id, { rotation: 0 }))
    clearMergeKey()
  }

  const resetAnchor = () => {
    if (!videoItem) return
    handleAnchorXChange(0)
    handleAnchorYChange(0)
    dispatch(new UpdateTransformCommand(videoItem.id, { anchorX: 0, anchorY: 0 }))
    clearMergeKey()
  }

  const resetAnchorX = () => {
    if (!videoItem) return
    handleAnchorXChange(0)
    dispatch(new UpdateTransformCommand(videoItem.id, { anchorX: 0 }))
    clearMergeKey()
  }

  const resetAnchorY = () => {
    if (!videoItem) return
    handleAnchorYChange(0)
    dispatch(new UpdateTransformCommand(videoItem.id, { anchorY: 0 }))
    clearMergeKey()
  }

  const resetPitch = () => {
    if (!videoItem) return
    handlePitchChange(0)
    dispatch(new UpdateTransformCommand(videoItem.id, { pitch: 0 }))
    clearMergeKey()
  }

  const resetYaw = () => {
    if (!videoItem) return
    handleYawChange(0)
    dispatch(new UpdateTransformCommand(videoItem.id, { yaw: 0 }))
    clearMergeKey()
  }

  const resetFlip = () => {
    if (!videoItem) return
    dispatch(new UpdateTransformCommand(videoItem.id, { flipH: false, flipV: false }))
    clearMergeKey()
  }

  const resetCropProp = (prop: 'left' | 'right' | 'top' | 'bottom') => {
    if (!videoItem) return
    handleCropChange(prop, 0)
    dispatch(new UpdateCropCommand(videoItem.id, { [prop]: 0 }))
    clearMergeKey()
  }

  const resetBlendMode = () => {
    if (!videoItem) return
    handleBlendModeChange('normal')
    dispatch(new UpdateTransformCommand(videoItem.id, { blendMode: 'normal' }))
    clearMergeKey()
  }

  const resetOpacity = () => {
    if (!videoItem) return
    handleOpacityChange(100)
    dispatch(new UpdateTransformCommand(videoItem.id, { opacity: 1 }))
    clearMergeKey()
  }

  const resetSpeed = () => {
    if (!activeItem) return
    dispatch(new ResetSpeedCommand(activeItem.id))
    clearMergeKey()
  }

  const resetDirection = () => {
    handleSetDirection(false)
    clearMergeKey()
  }

  const resetVolume = () => {
    if (!audioItem) return
    handleVolumeChange(100)
    dispatch(new UpdateAudioPropertiesCommand(audioItem.id, { volume: 1 }))
    clearMergeKey()
  }

  const resetPan = () => {
    if (!audioItem) return
    handlePanChange(0)
    dispatch(new UpdateAudioPropertiesCommand(audioItem.id, { pan: 0 }))
    clearMergeKey()
  }

  // Top level keyframe toggle for Transform
  const transformKeys = ['zoom', 'position', 'rotation', 'anchor', 'pitch', 'yaw']
  const allTransformKfActive = transformKeys.every((k) => isKfActive(k))
  const toggleTransformAllKf = () => {
    if (!videoItem) return
    const shouldAdd = !allTransformKfActive
    for (const k of transformKeys) {
      const active = isKfActive(k)
      if (shouldAdd && !active) {
        dispatch(new ToggleKeyframeAtPlayheadCommand(videoItem.id, k, playheadTime))
      } else if (!shouldAdd && active) {
        dispatch(new ToggleKeyframeAtPlayheadCommand(videoItem.id, k, playheadTime))
      }
    }
  }

  const scaleXVal = transform.scaleX !== undefined ? transform.scaleX : transform.scale
  const scaleYVal = transform.scaleY !== undefined ? transform.scaleY : transform.scale

  // ──── Solid Handlers ────
  const solidProps = (videoItem?.solid || solidItem?.solid) ?? DEFAULT_SOLID_PROPERTIES

  // ──── Text Handlers ────
  const textProps = (videoItem?.text || textItem?.text) ?? DEFAULT_TEXT_PROPERTIES
  const evaluatedFontSize = videoItem
    ? evaluateItemProperty(videoItem, 'fontSize', playheadTime) ?? textProps.fontSize
    : textProps.fontSize
  const evaluatedStrokeWidth = videoItem
    ? evaluateItemProperty(videoItem, 'strokeWidth', playheadTime) ?? textProps.strokeWidth
    : textProps.strokeWidth
  const evaluatedLetterSpacing = videoItem
    ? evaluateItemProperty(videoItem, 'letterSpacing', playheadTime) ?? textProps.letterSpacing
    : textProps.letterSpacing
  const evaluatedLineHeight = videoItem
    ? evaluateItemProperty(videoItem, 'lineHeight', playheadTime) ?? textProps.lineHeight
    : textProps.lineHeight
  const evaluatedShadowBlur = videoItem
    ? evaluateItemProperty(videoItem, 'shadowBlur', playheadTime) ?? textProps.shadowBlur
    : textProps.shadowBlur
  const evaluatedShadowOffsetX = videoItem
    ? evaluateItemProperty(videoItem, 'shadowOffsetX', playheadTime) ?? textProps.shadowOffsetX
    : textProps.shadowOffsetX
  const evaluatedShadowOffsetY = videoItem
    ? evaluateItemProperty(videoItem, 'shadowOffsetY', playheadTime) ?? textProps.shadowOffsetY
    : textProps.shadowOffsetY
  const evaluatedShadowOpacity = videoItem
    ? evaluateItemProperty(videoItem, 'shadowOpacity', playheadTime) ?? textProps.shadowOpacity
    : textProps.shadowOpacity
  const evaluatedBgOpacity = videoItem
    ? evaluateItemProperty(videoItem, 'backgroundOpacity', playheadTime) ?? textProps.backgroundOpacity
    : textProps.backgroundOpacity
  const evaluatedCornerRadius = videoItem
    ? evaluateItemProperty(videoItem, 'cornerRadius', playheadTime) ?? textProps.cornerRadius
    : textProps.cornerRadius
  const evaluatedPaddingX = videoItem
    ? evaluateItemProperty(videoItem, 'paddingX', playheadTime) ?? textProps.paddingX
    : textProps.paddingX
  const evaluatedPaddingY = videoItem
    ? evaluateItemProperty(videoItem, 'paddingY', playheadTime) ?? textProps.paddingY
    : textProps.paddingY
  const evaluatedBgStrokeWidth = videoItem
    ? evaluateItemProperty(videoItem, 'bgStrokeWidth', playheadTime) ?? textProps.bgStrokeWidth
    : textProps.bgStrokeWidth
  const evaluatedBgOffsetX = videoItem
    ? evaluateItemProperty(videoItem, 'bgOffsetX', playheadTime) ?? textProps.bgOffsetX
    : textProps.bgOffsetX
  const evaluatedBgOffsetY = videoItem
    ? evaluateItemProperty(videoItem, 'bgOffsetY', playheadTime) ?? textProps.bgOffsetY
    : textProps.bgOffsetY

  const handleTextPropChange = <K extends keyof TextProperties>(key: K, val: TextProperties[K]) => {
    if (!videoItem) return
    const numericKfKeys = [
      'fontSize',
      'strokeWidth',
      'padding',
      'paddingX',
      'paddingY',
      'backgroundOpacity',
      'letterSpacing',
      'lineHeight',
      'shadowBlur',
      'shadowOffsetX',
      'shadowOffsetY',
      'shadowOpacity',
      'cornerRadius',
      'bgStrokeWidth',
      'bgOffsetX',
      'bgOffsetY',
    ]
    if (numericKfKeys.includes(key as string) && isPropertyKeyframed(videoItem, key as string)) {
      dispatch(
        new SetKeyframeValueCommand(
          videoItem.id,
          key as string,
          playheadTime,
          val as number,
          `kf-${key}-${videoItem.id}`
        )
      )
    } else {
      dispatch(new UpdateTextCommand(videoItem.id, { [key]: val }))
    }
  }

  // ──── Caption Handlers ────
  const currentCaption = captionItem?.caption
  const captionSelection = selectedCaptionIds(state)
  const editableCaptionIds = (ids: string[]) => ids.filter(id => !state.tracks.some(track => track.id === state.items[id]?.trackId && track.locked))
  const editableSelection = editableCaptionIds(captionSelection)
  const editableCaptions = editableCaptionIds(allCaptionIds(state))
  const mixedCaptionPresets = new Set(captionSelection.map(id => state.items[id].caption?.preset ?? 'Clean')).size > 1
  const handleCaptionTextChange = (newText: string) => {
    if (!captionItem) return
    const newWords = generateWordTiming(newText, captionItem.startTime, captionItem.startTime + captionItem.duration)
    dispatch(new UpdateCaptionCommand(captionItem.id, { text: newText, words: newWords }))
  }

  const handleApplyPreset = (presetName: string) => {
    if (!captionItem) return
    if (editableSelection.length) dispatch(new ApplyCaptionStyleCommand(editableSelection, { preset: presetName }))
  }

  const handleCaptionStyleChange = (styleUpdate: Partial<TextProperties>) => {
    if (!captionItem) return
    if (editableSelection.length) dispatch(new ApplyCaptionStyleCommand(editableSelection, { style: styleUpdate }))
  }

  const handleSplitCaptionAtPlayhead = () => {
    if (!captionItem) return
    if (
      playheadTime > captionItem.startTime + 0.05 &&
      playheadTime < captionItem.startTime + captionItem.duration - 0.05
    ) {
      dispatch(new SplitCaptionCommand(captionItem.id, playheadTime))
    }
  }

  const handleMergeWithNextCaption = () => {
    if (!captionItem) return
    const trackItems = Object.values(state.items).filter(
      (it) => it.trackId === captionItem.trackId && it.id !== captionItem.id
    )
    const nextItem = trackItems
      .filter((it) => it.startTime >= captionItem.startTime)
      .sort((a, b) => a.startTime - b.startTime)[0]
    if (nextItem) {
      dispatch(new MergeCaptionsCommand(captionItem.id, nextItem.id))
    }
  }

  const handleWordEmphasis = (wordIndex: number, colorOverride?: string) => {
    if (!captionItem || !currentCaption?.words) return
    const updatedWords = currentCaption.words.map((w, i) => {
      if (currentCaption.presentation?.emphasis) return { ...w, highlight: i === wordIndex }
      if (i === wordIndex) {
        return { ...w, color: colorOverride || (w.color ? undefined : '#f59e0b') }
      }
      return w
    })
    dispatch(new UpdateCaptionCommand(captionItem.id, { words: updatedWords }))
  }

  return (
    <div className="inspector-container">
      <div className="panel-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
          <span className="panel-header-title">Inspector</span>
          <span className="inspector-type-badge">
            {isSolid
              ? '🎨 Solid'
              : isText
              ? '🔤 Text'
              : isAdjustment
              ? '⚡ Adjustment'
              : isCaption
              ? '💬 Caption'
              : activeTab === 'audio'
              ? '🔊 Audio'
              : activeTab === 'effects'
              ? '✨ Effect'
              : '🎬 Video'}
          </span>
        </div>
        {onToggleCollapse && (
          <button
            className="panel-collapse-btn"
            onClick={onToggleCollapse}
            title="Collapse Inspector Panel"
            aria-label="Collapse Inspector Panel"
          >
            ›
          </button>
        )}
      </div>

      {/* Tabs Header: Video, Audio, Effects, Transitions */}
      <div className="inspector-tabs">
        <button
          className={`inspector-tab-btn ${activeTab === 'video' ? 'active' : ''} ${!hasVideo ? 'disabled' : ''}`}
          onClick={() => {
            if (hasVideo) {
              if (selectedTransition) {
                dispatch(new SelectTransitionCommand(null))
              }
              setUserTab('video')
              onTabChange?.('video')
            }
          }}
          disabled={!hasVideo}
          title={
            isSolid
              ? 'Solid layer properties & transforms'
              : isText
              ? 'Text typography & transforms'
              : isCaption
              ? 'Caption content, timing & style'
              : isAdjustment
              ? 'Adjustment layer & transforms'
              : 'Video transforms, crop, composite, speed'
          }
        >
          <span className="inspector-tab-icon">🎬</span>
          <span>Video</span>
        </button>

        <button
          className={`inspector-tab-btn ${activeTab === 'audio' ? 'active' : ''} ${!hasAudio ? 'disabled' : ''}`}
          onClick={() => {
            if (hasAudio) {
              if (selectedTransition) {
                dispatch(new SelectTransitionCommand(null))
              }
              setUserTab('audio')
              onTabChange?.('audio')
            }
          }}
          disabled={!hasAudio}
          title={hasAudio ? 'Audio volume and pan' : 'No audio on selected item'}
        >
          <span className="inspector-tab-icon">🔊</span>
          <span>Audio</span>
        </button>

        <button
          className={`inspector-tab-btn ${activeTab === 'effects' ? 'active' : ''} ${!hasEffects ? 'disabled' : ''}`}
          onClick={() => {
            if (hasEffects) {
              if (selectedTransition) {
                dispatch(new SelectTransitionCommand(null))
              }
              setUserTab('effects')
              onTabChange?.('effects')
            }
          }}
          disabled={!hasEffects}
          title={
            hasEffects
              ? 'Applied effects'
              : 'No effects applied (disabled until attached)'
          }
        >
          <span className="inspector-tab-icon">✨</span>
          <span>Effect</span>
        </button>

        <button
          className={`inspector-tab-btn ${activeTab === 'transitions' ? 'active' : ''} ${!hasTransitionsTab ? 'disabled' : ''}`}
          onClick={() => {
            if (hasTransitionsTab) {
              setUserTab('transitions')
              onTabChange?.('transitions')
            }
          }}
          disabled={!hasTransitionsTab}
          title={hasTransitionsTab ? 'Applied transitions' : 'No transitions applied (disabled until attached)'}
        >
          <span className="inspector-tab-icon">🔀</span>
          <span>Transitions</span>
        </button>
      </div>

      <div className="inspector-body">
        {/* ──── TAB: VIDEO / VISUAL ──── */}
        {activeTab === 'video' && videoItem && (
          <>
            {/* 0a. SOLID LAYER PROPERTIES */}
            {isSolid && (
              <div className="inspector-section">
                <div className="inspector-section-header" onClick={() => toggleSection('solid')}>
                  <div className="inspector-header-left">
                    <span className="inspector-chevron">{collapsed.solid ? '▶' : '▼'}</span>
                    <span className="inspector-section-title">Solid Layer</span>
                  </div>
                  <div className="inspector-header-actions">
                    <button
                      className="inspector-reset-icon-btn"
                      onClick={(e) => {
                        e.stopPropagation()
                        if (videoItem) {
                          dispatch(new UpdateSolidLayerCommand(videoItem.id, { color: DEFAULT_SOLID_PROPERTIES.color }))
                        }
                      }}
                      title="Reset Solid Color"
                    >
                      ↺
                    </button>
                  </div>
                </div>

                {!collapsed.solid && (
                  <div className="inspector-section-content">
                    <div className="inspector-row">
                      <span
                        className="inspector-label resettable"
                        onDoubleClick={() => {
                          if (videoItem) {
                            dispatch(new UpdateSolidLayerCommand(videoItem.id, { color: '#3B82F6' }))
                          }
                        }}
                        title="Double-click to reset Color to #3B82F6"
                      >
                        Color
                      </span>
                      <div className="inspector-row-controls">
                        <InspectorColorInput
                          value={solidProps.color || '#3B82F6'}
                          onChange={(hex) => {
                            if (videoItem) {
                              dispatch(new UpdateSolidLayerCommand(videoItem.id, { color: hex }))
                            }
                          }}
                          defaultColor="#3B82F6"
                          title="Solid Color"
                        />
                        <span className="inspector-kf-spacer" />
                        <button
                          type="button"
                          className="inspector-reset-icon-btn"
                          onClick={() => {
                            if (videoItem) {
                              dispatch(new UpdateSolidLayerCommand(videoItem.id, { color: '#3B82F6' }))
                            }
                          }}
                          title="Reset Color to #3B82F6"
                        >
                          ↺
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 0b. ADJUSTMENT LAYER */}
            {isAdjustment && (
              <div className="inspector-section">
                <div className="inspector-section-header" onClick={() => toggleSection('adjustment')}>
                  <div className="inspector-header-left">
                    <span className="inspector-chevron">{collapsed.adjustment ? '▶' : '▼'}</span>
                    <span className="inspector-section-title">Adjustment Layer</span>
                  </div>
                </div>
                {!collapsed.adjustment && (
                  <div className="inspector-section-content">
                    <p style={{ fontSize: '11px', color: 'var(--text-tertiary)', margin: '0 0 6px 0', lineHeight: 1.4 }}>
                      Applies color grades, blend modes, and visual effects to all underlying timeline layers.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* 0c. TEXT PROPERTIES */}
            {isText && (
              <>
                <div className="inspector-section">
                  <div className="inspector-section-header" onClick={() => toggleSection('text')}>
                    <div className="inspector-header-left">
                      <span className="inspector-chevron">{collapsed.text ? '▶' : '▼'}</span>
                      <span className="inspector-section-title">Text</span>
                    </div>
                    <div className="inspector-header-actions">
                      <button
                        type="button"
                        className="inspector-reset-icon-btn"
                        onClick={(e) => {
                          e.stopPropagation()
                          if (videoItem) {
                            dispatch(new UpdateTextCommand(videoItem.id, DEFAULT_TEXT_PROPERTIES))
                          }
                        }}
                        title="Reset Text Properties"
                      >
                        ↺
                      </button>
                    </div>
                  </div>

                  {!collapsed.text && (
                    <div className="inspector-section-content">
                      {/* Direct Text Box (shown straight away without separate label row) */}
                      <textarea
                        className="inspector-textarea"
                        rows={3}
                        value={textProps.text}
                        onChange={(e) => {
                          if (videoItem) {
                            dispatch(new UpdateTextCommand(videoItem.id, { text: e.target.value }))
                          }
                        }}
                        placeholder="Type text here..."
                      />

                      {/* Shared Text Style Controls */}
                      <TextStyleControls
                        properties={textProps}
                        onChange={(patch) => {
                          if (!videoItem) return
                          for (const [k, v] of Object.entries(patch)) {
                            handleTextPropChange(k as keyof TextProperties, v as never)
                          }
                        }}
                        onClearMergeKey={clearMergeKey}
                        renderKfControl={renderKfControl}
                        evaluatedFontSize={evaluatedFontSize}
                        evaluatedColor={textProps.color}
                        evaluatedStrokeWidth={evaluatedStrokeWidth}
                        evaluatedLetterSpacing={evaluatedLetterSpacing}
                        evaluatedLineHeight={evaluatedLineHeight}
                      />
                    </div>
                  )}
                </div>

                {/* Drop Shadow Section */}
                <TextShadowSection
                  properties={textProps}
                  collapsed={!!collapsed.textShadow}
                  onToggleCollapse={() => toggleSection('textShadow')}
                  onChange={(patch) => {
                    if (!videoItem) return
                    for (const [k, v] of Object.entries(patch)) {
                      handleTextPropChange(k as keyof TextProperties, v as never)
                    }
                  }}
                  onClearMergeKey={clearMergeKey}
                  renderKfControl={renderKfControl}
                  evaluatedBlur={evaluatedShadowBlur}
                  evaluatedOffsetX={evaluatedShadowOffsetX}
                  evaluatedOffsetY={evaluatedShadowOffsetY}
                  evaluatedOpacity={evaluatedShadowOpacity}
                  onReset={() => {
                    if (!videoItem) return
                    handleTextPropChange('shadowEnabled', false)
                    handleTextPropChange('shadowColor', '#000000')
                    handleTextPropChange('shadowOpacity', 0.8)
                    handleTextPropChange('shadowOffsetX', 2)
                    handleTextPropChange('shadowOffsetY', 4)
                    handleTextPropChange('shadowBlur', 10)
                  }}
                />

                {/* Background Section */}
                <TextBackgroundSection
                  properties={textProps}
                  collapsed={!!collapsed.textBackground}
                  onToggleCollapse={() => toggleSection('textBackground')}
                  onChange={(patch) => {
                    if (!videoItem) return
                    for (const [k, v] of Object.entries(patch)) {
                      handleTextPropChange(k as keyof TextProperties, v as never)
                    }
                  }}
                  onClearMergeKey={clearMergeKey}
                  renderKfControl={renderKfControl}
                  evaluatedCornerRadius={evaluatedCornerRadius}
                  evaluatedPaddingX={evaluatedPaddingX}
                  evaluatedPaddingY={evaluatedPaddingY}
                  evaluatedBgStrokeWidth={evaluatedBgStrokeWidth}
                  evaluatedBgOffsetX={evaluatedBgOffsetX}
                  evaluatedBgOffsetY={evaluatedBgOffsetY}
                  evaluatedBgOpacity={evaluatedBgOpacity}
                  onReset={() => {
                    if (!videoItem) return
                    handleTextPropChange('backgroundEnabled', false)
                    handleTextPropChange('backgroundColor', '#000000')
                    handleTextPropChange('backgroundOpacity', 0.7)
                    handleTextPropChange('bgStrokeColor', '#ffffff')
                    handleTextPropChange('bgStrokeWidth', 0)
                    handleTextPropChange('paddingX', 16)
                    handleTextPropChange('paddingY', 10)
                    handleTextPropChange('cornerRadius', 6)
                    handleTextPropChange('bgOffsetX', 0)
                    handleTextPropChange('bgOffsetY', 0)
                  }}
                />
              </>
            )}

            {/* 0d. CAPTION PROPERTIES */}
            {isCaption && currentCaption && (
              <>
                {/* 1. Subtitle Content */}
                <div className="inspector-section">
                  <div className="inspector-section-header" onClick={() => toggleSection('captionContent')}>
                    <div className="inspector-header-left">
                      <span className="inspector-chevron">{collapsed.captionContent ? '▶' : '▼'}</span>
                      <span className="inspector-section-title">Subtitle Content</span>
                    </div>
                  </div>

                  {!collapsed.captionContent && (
                    <div className="inspector-section-content">
                      <div className="inspector-row vertical">
                        <textarea
                          className="inspector-textarea"
                          rows={3}
                          value={currentCaption.text}
                          onChange={(e) => handleCaptionTextChange(e.target.value)}
                          placeholder="Caption text..."
                        />
                      </div>

                      {/* Timing details */}
                      <div className="inspector-row">
                        <span className="inspector-label">Start / End</span>
                        <div className="inspector-row-controls">
                          <span className="mono" style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                            {formatTimecode((captionItem || videoItem).startTime, fps)} →{' '}
                            {formatTimecode((captionItem || videoItem).startTime + (captionItem || videoItem).duration, fps)}
                          </span>
                        </div>
                      </div>

                      {/* Actions: Split / Merge */}
                      <div className="inspector-row" style={{ marginTop: '4px' }}>
                        <span className="inspector-label">Edit</span>
                        <div className="inspector-row-controls" style={{ gap: '6px' }}>
                          <button
                            className="caption-action-btn"
                            onClick={handleSplitCaptionAtPlayhead}
                            title="Split caption at playhead time"
                          >
                            ✂ Split
                          </button>
                          <button
                            className="caption-action-btn"
                            onClick={handleMergeWithNextCaption}
                            title="Merge with adjacent caption on track"
                          >
                            ⇲ Merge Next
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* 2. Style Presets */}
                <div className="inspector-section">
                  <div className="inspector-section-header" onClick={() => toggleSection('captionPresets')}>
                    <div className="inspector-header-left">
                      <span className="inspector-chevron">{collapsed.captionPresets ? '▶' : '▼'}</span>
                      <span className="inspector-section-title">Caption Presets</span>
                    </div>
                  </div>

                  {!collapsed.captionPresets && (
                    <div className="inspector-section-content">
                      <p className="caption-style-scope">{captionSelection.length > 1 ? `Style changes apply to ${editableSelection.length} selected captions.` : 'Style changes apply to the selected caption.'}{mixedCaptionPresets ? ' Mixed styles.' : ''}</p>
                      <CaptionStylePicker value={mixedCaptionPresets ? '' : currentCaption.preset ?? 'Clean'} onChange={handleApplyPreset} />
                      <button type="button" className="caption-action-btn caption-apply-all" disabled={!editableCaptions.length} title="Copy this caption’s preset and custom style to all unlocked captions" onClick={() => dispatch(new ApplyCaptionStyleCommand(editableCaptions, {
                        preset: currentCaption.preset ?? 'Clean', style: currentCaption.style,
                        presentation: currentCaption.presentation ?? { timing: 'active', underline: true }, activeWordColor: currentCaption.activeWordColor ?? '#FFE600',
                      }))}>Apply to all captions</button>
                      {editableCaptions.length < allCaptionIds(state).length && <small className="caption-style-scope">Captions on locked tracks are excluded.</small>}
                    </div>
                  )}
                </div>

                {/* 3. Style & Typography */}
                <div className="inspector-section">
                  <div className="inspector-section-header" onClick={() => toggleSection('captionStyle')}>
                    <div className="inspector-header-left">
                      <span className="inspector-chevron">{collapsed.captionStyle ? '▶' : '▼'}</span>
                      <span className="inspector-section-title">Style & Typography</span>
                    </div>
                  </div>

                  {!collapsed.captionStyle && (
                    <div className="inspector-section-content">
                      <TextStyleControls
                        properties={currentCaption.style || {}}
                        onChange={handleCaptionStyleChange}
                        onClearMergeKey={clearMergeKey}
                      />
                    </div>
                  )}
                </div>

                {/* 3b. Caption Drop Shadow */}
                <TextShadowSection
                  properties={currentCaption.style || {}}
                  collapsed={!!collapsed.captionShadow}
                  onToggleCollapse={() => toggleSection('captionShadow')}
                  onChange={handleCaptionStyleChange}
                  onClearMergeKey={clearMergeKey}
                  onReset={() => {
                    handleCaptionStyleChange({
                      shadowEnabled: false,
                      shadowColor: '#000000',
                      shadowOpacity: 0.8,
                      shadowOffsetX: 2,
                      shadowOffsetY: 4,
                      shadowBlur: 10,
                    })
                  }}
                />

                {/* 3c. Caption Background */}
                <TextBackgroundSection
                  properties={currentCaption.style || {}}
                  collapsed={!!collapsed.captionBackground}
                  onToggleCollapse={() => toggleSection('captionBackground')}
                  onChange={handleCaptionStyleChange}
                  onClearMergeKey={clearMergeKey}
                  onReset={() => {
                    handleCaptionStyleChange({
                      backgroundEnabled: false,
                      backgroundColor: '#000000',
                      backgroundOpacity: 0.7,
                      bgStrokeColor: '#ffffff',
                      bgStrokeWidth: 0,
                      paddingX: 16,
                      paddingY: 10,
                      cornerRadius: 6,
                      bgOffsetX: 0,
                      bgOffsetY: 0,
                    })
                  }}
                />

                {/* 4. Word Animation */}
                <div className="inspector-section">
                  <div className="inspector-section-header" onClick={() => toggleSection('captionAnimation')}>
                    <div className="inspector-header-left">
                      <span className="inspector-chevron">{collapsed.captionAnimation ? '▶' : '▼'}</span>
                      <span className="inspector-section-title">Word Animation</span>
                    </div>
                  </div>
                  {!collapsed.captionAnimation && (
                    <div className="inspector-section-content">
                      <CaptionCustomization style={currentCaption.style??{}} presentation={currentCaption.presentation} activeColor={currentCaption.activeWordColor} appearance={false}
                        onStyle={handleCaptionStyleChange}
                        onPresentation={presentation=>{if(editableSelection.length)dispatch(new ApplyCaptionStyleCommand(editableSelection,{presentation}))}}
                        onActiveColor={activeWordColor=>{if(editableSelection.length)dispatch(new ApplyCaptionStyleCommand(editableSelection,{activeWordColor}))}}/>

                    </div>
                  )}
                </div>

                {/* 5. Word Timing */}
                <div className="inspector-section">
                  <div className="inspector-section-header" onClick={() => toggleSection('captionWords')}>
                    <div className="inspector-header-left">
                      <span className="inspector-chevron">{collapsed.captionWords ? '▶' : '▼'}</span>
                      <span className="inspector-section-title">Word Timing</span>
                    </div>
                  </div>

                  {!collapsed.captionWords && (
                    <div className="inspector-section-content">
                      <p style={{ margin: '0 0 6px 0', fontSize: '11px', color: 'var(--text-tertiary)' }}>
                        {currentCaption.presentation?.emphasis ? 'Choose the fixed emphasis word.' : 'Click a word to toggle its fixed emphasis color.'}
                      </p>
                      <div className="word-timing-container">
                        {(currentCaption.words || []).map((w, idx) => {
                          const isEmphasized = !!w.color || (!!currentCaption.presentation?.emphasis && !!w.highlight)
                          const wStart = w.start ?? w.startTime ?? 0
                          const wEnd = w.end ?? w.endTime ?? 0
                          return (
                            <span
                              key={idx}
                              className={`word-timing-pill ${isEmphasized ? 'emphasized' : ''}`}
                              onClick={() => handleWordEmphasis(idx)}
                              title={`${w.word} (${(wStart - (captionItem || videoItem).startTime).toFixed(2)}s - ${(
                                wEnd - (captionItem || videoItem).startTime
                              ).toFixed(2)}s). Click to choose emphasis.`}
                              style={w.color ? { color: w.color, borderColor: w.color } : {}}
                            >
                              <strong>{w.word}</strong>
                              <span style={{ fontSize: '9px', opacity: 0.6 }}>{(wEnd - wStart).toFixed(2)}s</span>
                            </span>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* 1. TRANSFORM */}
            <div className="inspector-section">
              <div className="inspector-section-header" onClick={() => toggleSection('transform')}>
                <div className="inspector-header-left">
                  <span className="inspector-chevron">{collapsed.transform ? '▶' : '▼'}</span>
                  <span className="inspector-section-title">Transform</span>
                </div>
                <div className="inspector-header-actions">
                  <button
                    className={`inspector-kf-btn ${allTransformKfActive ? 'active' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleTransformAllKf()
                    }}
                    title={allTransformKfActive ? 'Remove all transform keyframes' : 'Keyframe all transform properties'}
                  >
                    <span className="inspector-kf-diamond">{allTransformKfActive ? '◆' : '◇'}</span>
                  </button>
                  <button
                    className="inspector-reset-icon-btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      dispatch(new ResetTransformCommand(videoItem.id))
                    }}
                    title="Reset all transform properties"
                  >
                    ↺
                  </button>
                </div>
              </div>

              {!collapsed.transform && (
                <div className="inspector-section-content">
                  {/* Zoom X & Y with Link button */}
                  <div className="inspector-row">
                    <span
                      className="inspector-label resettable"
                      onDoubleClick={resetZoom}
                      title="Double-click to reset Zoom to 1.000"
                    >
                      Zoom
                    </span>
                    <div className="inspector-row-controls">
                      <span
                        className="inspector-sublabel resettable"
                        onDoubleClick={resetZoomX}
                        title="Double-click to reset Zoom X to 1.000"
                      >
                        X
                      </span>
                      <ScrubbableNumberInput
                        value={scaleXVal}
                        step={0.01}
                        decimals={3}
                        min={0.05}
                        max={20}
                        title="Zoom X"
                        onChange={handleZoomXChange}
                        onCommit={clearMergeKey}
                      />
                      <button
                        className={`inspector-link-btn ${zoomLinked ? 'active' : ''}`}
                        onClick={() => setZoomLinked(!zoomLinked)}
                        title={zoomLinked ? 'Zoom linked (Uniform scale)' : 'Zoom unlinked (Independent scale)'}
                      >
                        {zoomLinked ? '🔗' : '⛓️'}
                      </button>
                      <span
                        className="inspector-sublabel resettable"
                        onDoubleClick={resetZoomY}
                        title="Double-click to reset Zoom Y to 1.000"
                      >
                        Y
                      </span>
                      <ScrubbableNumberInput
                        value={scaleYVal}
                        step={0.01}
                        decimals={3}
                        min={0.05}
                        max={20}
                        title="Zoom Y"
                        onChange={handleZoomYChange}
                        onCommit={clearMergeKey}
                      />
                      {renderKfControl('zoom', 'Keyframe Zoom')}
                      <button
                        className="inspector-reset-icon-btn"
                        onClick={resetZoom}
                        title="Reset Zoom to 1.000"
                      >
                        ↺
                      </button>
                    </div>
                  </div>

                  {/* Position X & Y */}
                  <div className="inspector-row">
                    <span
                      className="inspector-label resettable"
                      onDoubleClick={resetPosition}
                      title="Double-click to reset Position to (0, 0)"
                    >
                      Position
                    </span>
                    <div className="inspector-row-controls">
                      <span
                        className="inspector-sublabel resettable"
                        onDoubleClick={resetPosX}
                        title="Double-click to reset Position X to 0"
                      >
                        X
                      </span>
                      <ScrubbableNumberInput
                        value={transform.x}
                        step={1}
                        decimals={3}
                        title="Position X"
                        onChange={handlePosXChange}
                        onCommit={clearMergeKey}
                      />
                      <div className="inspector-link-placeholder" />
                      <span
                        className="inspector-sublabel resettable"
                        onDoubleClick={resetPosY}
                        title="Double-click to reset Position Y to 0"
                      >
                        Y
                      </span>
                      <ScrubbableNumberInput
                        value={transform.y}
                        step={1}
                        decimals={3}
                        title="Position Y"
                        onChange={handlePosYChange}
                        onCommit={clearMergeKey}
                      />
                      {renderKfControl('position', 'Keyframe Position')}
                      <button
                        className="inspector-reset-icon-btn"
                        onClick={resetPosition}
                        title="Reset Position to (0, 0)"
                      >
                        ↺
                      </button>
                    </div>
                  </div>

                  {/* Rotation with Slider */}
                  <div className="inspector-row">
                    <span
                      className="inspector-label resettable"
                      onDoubleClick={resetRotation}
                      title="Double-click to reset Rotation to 0"
                    >
                      Rotation
                    </span>
                    <div className="inspector-row-controls">
                      <input
                        type="range"
                        className="inspector-slider"
                        min={-180}
                        max={180}
                        step={0.5}
                        value={transform.rotation}
                        onChange={(e) => handleRotationChange(parseFloat(e.target.value))}
                        onPointerUp={clearMergeKey}
                        title="Rotate clip (-180° to 180°)"
                      />
                      <ScrubbableNumberInput
                        value={transform.rotation}
                        step={0.5}
                        decimals={3}
                        min={-360}
                        max={360}
                        title="Rotation angle"
                        onChange={handleRotationChange}
                        onCommit={clearMergeKey}
                      />
                      {renderKfControl('rotation', 'Keyframe Rotation')}
                      <button
                        className="inspector-reset-icon-btn"
                        onClick={resetRotation}
                        title="Reset Rotation to 0"
                      >
                        ↺
                      </button>
                    </div>
                  </div>

                  {/* Anchor Point X & Y */}
                  <div className="inspector-row">
                    <span
                      className="inspector-label resettable"
                      onDoubleClick={resetAnchor}
                      title="Double-click to reset Anchor Point to (0, 0)"
                    >
                      Anchor
                    </span>
                    <div className="inspector-row-controls">
                      <span
                        className="inspector-sublabel resettable"
                        onDoubleClick={resetAnchorX}
                        title="Double-click to reset Anchor X to 0"
                      >
                        X
                      </span>
                      <ScrubbableNumberInput
                        value={transform.anchorX || 0}
                        step={1}
                        decimals={3}
                        title="Anchor X"
                        onChange={handleAnchorXChange}
                        onCommit={clearMergeKey}
                      />
                      <div className="inspector-link-placeholder" />
                      <span
                        className="inspector-sublabel resettable"
                        onDoubleClick={resetAnchorY}
                        title="Double-click to reset Anchor Y to 0"
                      >
                        Y
                      </span>
                      <ScrubbableNumberInput
                        value={transform.anchorY || 0}
                        step={1}
                        decimals={3}
                        title="Anchor Y"
                        onChange={handleAnchorYChange}
                        onCommit={clearMergeKey}
                      />
                      {renderKfControl('anchor', 'Keyframe Anchor Point')}
                      <button
                        className="inspector-reset-icon-btn"
                        onClick={resetAnchor}
                        title="Reset Anchor Point to center"
                      >
                        ↺
                      </button>
                    </div>
                  </div>

                  {/* Pitch with Slider */}
                  <div className="inspector-row">
                    <span
                      className="inspector-label resettable"
                      onDoubleClick={resetPitch}
                      title="Double-click to reset Pitch to 0"
                    >
                      Pitch
                    </span>
                    <div className="inspector-row-controls">
                      <input
                        type="range"
                        className="inspector-slider"
                        min={-90}
                        max={90}
                        step={0.5}
                        value={transform.pitch || 0}
                        onChange={(e) => handlePitchChange(parseFloat(e.target.value))}
                        onPointerUp={clearMergeKey}
                        title="3D Tilt on X axis (-90° to 90°)"
                      />
                      <ScrubbableNumberInput
                        value={transform.pitch || 0}
                        step={0.5}
                        decimals={3}
                        min={-180}
                        max={180}
                        title="Pitch angle"
                        onChange={handlePitchChange}
                        onCommit={clearMergeKey}
                      />
                      {renderKfControl('pitch', 'Keyframe Pitch')}
                      <button
                        className="inspector-reset-icon-btn"
                        onClick={resetPitch}
                        title="Reset Pitch to 0"
                      >
                        ↺
                      </button>
                    </div>
                  </div>

                  {/* Yaw with Slider */}
                  <div className="inspector-row">
                    <span
                      className="inspector-label resettable"
                      onDoubleClick={resetYaw}
                      title="Double-click to reset Yaw to 0"
                    >
                      Yaw
                    </span>
                    <div className="inspector-row-controls">
                      <input
                        type="range"
                        className="inspector-slider"
                        min={-90}
                        max={90}
                        step={0.5}
                        value={transform.yaw || 0}
                        onChange={(e) => handleYawChange(parseFloat(e.target.value))}
                        onPointerUp={clearMergeKey}
                        title="3D Rotation on Y axis (-90° to 90°)"
                      />
                      <ScrubbableNumberInput
                        value={transform.yaw || 0}
                        step={0.5}
                        decimals={3}
                        min={-180}
                        max={180}
                        title="Yaw angle"
                        onChange={handleYawChange}
                        onCommit={clearMergeKey}
                      />
                      {renderKfControl('yaw', 'Keyframe Yaw')}
                      <button
                        className="inspector-reset-icon-btn"
                        onClick={resetYaw}
                        title="Reset Yaw to 0"
                      >
                        ↺
                      </button>
                    </div>
                  </div>

                  {/* Flip Horizontal & Vertical */}
                  <div className="inspector-row">
                    <span
                      className="inspector-label resettable"
                      onDoubleClick={resetFlip}
                      title="Double-click to reset Flip"
                    >
                      Flip
                    </span>
                    <div className="inspector-row-controls">
                      <button
                        className={`inspector-flip-btn ${transform.flipH ? 'active' : ''}`}
                        onClick={handleFlipH}
                        title="Flip Horizontal (Mirror X)"
                        aria-label="Flip Horizontal"
                      >
                        <svg
                          width="13"
                          height="13"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M12 2v20" strokeDasharray="2 2" />
                          <path d="M8 6l-6 6 6 6V6z" />
                          <path d="M16 6l6 6-6 6V6z" />
                        </svg>
                      </button>
                      <button
                        className={`inspector-flip-btn ${transform.flipV ? 'active' : ''}`}
                        onClick={handleFlipV}
                        title="Flip Vertical (Mirror Y)"
                        aria-label="Flip Vertical"
                      >
                        <svg
                          width="13"
                          height="13"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M2 12h20" strokeDasharray="2 2" />
                          <path d="M6 8l6-6 6 6H6z" />
                          <path d="M6 16l6 6 6-6H6z" />
                        </svg>
                      </button>
                      <div className="inspector-row-spacer" />
                      <button
                        className="inspector-reset-icon-btn"
                        onClick={resetFlip}
                        title="Reset Flip"
                      >
                        ↺
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* 2. CROP (Four separate rows: Left, Right, Top, Bottom) */}
            {!isSolid && !isText && !isCaption && !isAdjustment && (
              <div className="inspector-section">
                <div className="inspector-section-header" onClick={() => toggleSection('crop')}>
                  <div className="inspector-header-left">
                    <span className="inspector-chevron">{collapsed.crop ? '▶' : '▼'}</span>
                    <span className="inspector-section-title">Crop</span>
                  </div>
                <div className="inspector-header-actions">
                  <button
                    className={`inspector-kf-btn ${isKfActive('crop') ? 'active' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleKf('crop')
                    }}
                    title="Keyframe Crop"
                  >
                    <span className="inspector-kf-diamond">{isKfActive('crop') ? '◆' : '◇'}</span>
                  </button>
                  <button
                    className="inspector-reset-icon-btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      dispatch(new ResetCropCommand(videoItem.id))
                    }}
                    title="Reset Crop to 0"
                  >
                    ↺
                  </button>
                </div>
              </div>

              {!collapsed.crop && (
                <div className="inspector-section-content">
                  {/* Left */}
                  <div className="inspector-row">
                    <span
                      className="inspector-label resettable"
                      onDoubleClick={() => resetCropProp('left')}
                      title="Double-click to reset Crop Left to 0"
                    >
                      Left
                    </span>
                    <div className="inspector-row-controls">
                      <input
                        type="range"
                        className="inspector-slider"
                        min={0}
                        max={100}
                        step={0.5}
                        value={crop.left}
                        onChange={(e) => handleCropChange('left', parseFloat(e.target.value))}
                        onPointerUp={clearMergeKey}
                        title="Crop Left (0% to 100%)"
                      />
                      <ScrubbableNumberInput
                        value={crop.left}
                        step={0.5}
                        decimals={3}
                        min={0}
                        max={100}
                        title="Crop Left"
                        onChange={(v) => handleCropChange('left', v)}
                        onCommit={clearMergeKey}
                      />
                      {renderKfControl('crop_left', 'Keyframe Crop Left')}
                      <button
                        className="inspector-reset-icon-btn"
                        onClick={() => resetCropProp('left')}
                        title="Reset Crop Left"
                      >
                        ↺
                      </button>
                    </div>
                  </div>

                  {/* Right */}
                  <div className="inspector-row">
                    <span
                      className="inspector-label resettable"
                      onDoubleClick={() => resetCropProp('right')}
                      title="Double-click to reset Crop Right to 0"
                    >
                      Right
                    </span>
                    <div className="inspector-row-controls">
                      <input
                        type="range"
                        className="inspector-slider"
                        min={0}
                        max={100}
                        step={0.5}
                        value={crop.right}
                        onChange={(e) => handleCropChange('right', parseFloat(e.target.value))}
                        onPointerUp={clearMergeKey}
                        title="Crop Right (0% to 100%)"
                      />
                      <ScrubbableNumberInput
                        value={crop.right}
                        step={0.5}
                        decimals={3}
                        min={0}
                        max={100}
                        title="Crop Right"
                        onChange={(v) => handleCropChange('right', v)}
                        onCommit={clearMergeKey}
                      />
                      {renderKfControl('crop_right', 'Keyframe Crop Right')}
                      <button
                        className="inspector-reset-icon-btn"
                        onClick={() => resetCropProp('right')}
                        title="Reset Crop Right"
                      >
                        ↺
                      </button>
                    </div>
                  </div>

                  {/* Top */}
                  <div className="inspector-row">
                    <span
                      className="inspector-label resettable"
                      onDoubleClick={() => resetCropProp('top')}
                      title="Double-click to reset Crop Top to 0"
                    >
                      Top
                    </span>
                    <div className="inspector-row-controls">
                      <input
                        type="range"
                        className="inspector-slider"
                        min={0}
                        max={100}
                        step={0.5}
                        value={crop.top}
                        onChange={(e) => handleCropChange('top', parseFloat(e.target.value))}
                        onPointerUp={clearMergeKey}
                        title="Crop Top (0% to 100%)"
                      />
                      <ScrubbableNumberInput
                        value={crop.top}
                        step={0.5}
                        decimals={3}
                        min={0}
                        max={100}
                        title="Crop Top"
                        onChange={(v) => handleCropChange('top', v)}
                        onCommit={clearMergeKey}
                      />
                      {renderKfControl('crop_top', 'Keyframe Crop Top')}
                      <button
                        className="inspector-reset-icon-btn"
                        onClick={() => resetCropProp('top')}
                        title="Reset Crop Top"
                      >
                        ↺
                      </button>
                    </div>
                  </div>

                  {/* Bottom */}
                  <div className="inspector-row">
                    <span
                      className="inspector-label resettable"
                      onDoubleClick={() => resetCropProp('bottom')}
                      title="Double-click to reset Crop Bottom to 0"
                    >
                      Bottom
                    </span>
                    <div className="inspector-row-controls">
                      <input
                        type="range"
                        className="inspector-slider"
                        min={0}
                        max={100}
                        step={0.5}
                        value={crop.bottom}
                        onChange={(e) => handleCropChange('bottom', parseFloat(e.target.value))}
                        onPointerUp={clearMergeKey}
                        title="Crop Bottom (0% to 100%)"
                      />
                      <ScrubbableNumberInput
                        value={crop.bottom}
                        step={0.5}
                        decimals={3}
                        min={0}
                        max={100}
                        title="Crop Bottom"
                        onChange={(v) => handleCropChange('bottom', v)}
                        onCommit={clearMergeKey}
                      />
                      {renderKfControl('crop_bottom', 'Keyframe Crop Bottom')}
                      <button
                        className="inspector-reset-icon-btn"
                        onClick={() => resetCropProp('bottom')}
                        title="Reset Crop Bottom"
                      >
                        ↺
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
            )}

            {/* 3. COMPOSITE */}
            {!isCaption && (
              <div className="inspector-section">
                <div className="inspector-section-header" onClick={() => toggleSection('composite')}>
                  <div className="inspector-header-left">
                    <span className="inspector-chevron">{collapsed.composite ? '▶' : '▼'}</span>
                    <span className="inspector-section-title">Composite</span>
                  </div>
                  <div className="inspector-header-actions">
                    <button
                      className={`inspector-kf-btn ${isKfActive('composite') ? 'active' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleKf('composite')
                      }}
                      title="Keyframe Composite"
                    >
                      <span className="inspector-kf-diamond">{isKfActive('composite') ? '◆' : '◇'}</span>
                    </button>
                    <button
                      className="inspector-reset-icon-btn"
                      onClick={(e) => {
                        e.stopPropagation()
                        dispatch(new UpdateTransformCommand(videoItem.id, { blendMode: 'normal', opacity: 1 }))
                      }}
                      title="Reset Composite"
                    >
                      ↺
                    </button>
                  </div>
                </div>

                {!collapsed.composite && (
                  <div className="inspector-section-content">
                    {/* Blend Mode with Custom Dark Dropdown */}
                    <div className="inspector-row">
                      <span
                        className="inspector-label resettable"
                        onDoubleClick={resetBlendMode}
                        title="Double-click to reset Blend Mode to Normal"
                      >
                        Blend Mode
                      </span>
                      <div className="inspector-row-controls">
                        <CustomSelect
                          value={transform.blendMode || 'normal'}
                          options={BLEND_MODE_OPTIONS}
                          onChange={handleBlendModeChange}
                          title="Select Blend Mode"
                        />
                        <span className="inspector-kf-spacer" />
                        <button
                          type="button"
                          className="inspector-reset-icon-btn"
                          onClick={resetBlendMode}
                          title="Reset Blend Mode to Normal"
                        >
                          ↺
                        </button>
                      </div>
                    </div>

                    {/* Opacity with Slider */}
                    <div className="inspector-row">
                      <span
                        className="inspector-label resettable"
                        onDoubleClick={resetOpacity}
                        title="Double-click to reset Opacity to 100%"
                      >
                        Opacity
                      </span>
                      <div className="inspector-row-controls">
                        <input
                          type="range"
                          className="inspector-slider"
                          min={0}
                          max={100}
                          step={1}
                          value={transform.opacity * 100}
                          onChange={(e) => handleOpacityChange(parseFloat(e.target.value))}
                          onPointerUp={clearMergeKey}
                          title="Composite Opacity (0% to 100%)"
                        />
                        <ScrubbableNumberInput
                          value={transform.opacity * 100}
                          step={1}
                          decimals={3}
                          min={0}
                          max={100}
                          title="Opacity percentage"
                          onChange={handleOpacityChange}
                          onCommit={clearMergeKey}
                        />
                        {renderKfControl('opacity', 'Keyframe Opacity')}
                        <button
                          className="inspector-reset-icon-btn"
                          onClick={resetOpacity}
                          title="Reset Opacity to 100"
                        >
                          ↺
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 4. SPEED */}
            {!isSolid && !isText && !isCaption && !isAdjustment && (
              <div className="inspector-section">
                <div className="inspector-section-header" onClick={() => toggleSection('speed')}>
                <div className="inspector-header-left">
                  <span className="inspector-chevron">{collapsed.speed ? '▶' : '▼'}</span>
                  <span className="inspector-section-title">Speed</span>
                </div>
                <div className="inspector-header-actions">
                  <button
                    className={`inspector-kf-btn ${isKfActive('speed') ? 'active' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleKf('speed')
                    }}
                    title="Keyframe Speed (Top Level)"
                  >
                    <span className="inspector-kf-diamond">{isKfActive('speed') ? '◆' : '◇'}</span>
                  </button>
                  <button
                    className="inspector-reset-icon-btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      resetSpeed()
                    }}
                    title="Reset Speed to 100"
                  >
                    ↺
                  </button>
                </div>
              </div>

              {!collapsed.speed && (
                <div className="inspector-section-content">
                  {/* Speed % with Thumbwheel (-200 to 200) */}
                  <div className="inspector-row">
                    <span
                      className="inspector-label resettable"
                      onDoubleClick={resetSpeed}
                      title="Double-click to reset Speed to 100%"
                    >
                      Speed
                    </span>
                    <div className="inspector-row-controls">
                      <Thumbwheel
                        value={displaySpeedPercent}
                        min={-200}
                        max={200}
                        step={1}
                        defaultValue={100}
                        onChange={handleSpeedPercentChange}
                        onCommit={clearMergeKey}
                        title="Knurled Speed Thumbwheel: Drag left/right or scroll (-200% to 200%)"
                      />
                      <ScrubbableNumberInput
                        value={displaySpeedPercent}
                        step={1}
                        decimals={3}
                        title="Speed percentage (Negative when reversed. Manual entry supported)"
                        onChange={handleSpeedPercentChange}
                        onCommit={clearMergeKey}
                      />
                      {renderKfControl('speed', 'Keyframe Speed')}
                      <button
                        className="inspector-reset-icon-btn"
                        onClick={resetSpeed}
                        title="Reset Speed to 100%"
                      >
                        ↺
                      </button>
                    </div>
                  </div>

                  {/* Frame Rate with Thumbwheel (-200 to 200) */}
                  <div className="inspector-row">
                    <span
                      className="inspector-label resettable"
                      onDoubleClick={resetSpeed}
                      title="Double-click to reset Frame Rate to project FPS"
                    >
                      Frame Rate
                    </span>
                    <div className="inspector-row-controls">
                      <Thumbwheel
                        value={displayFps}
                        min={-200}
                        max={200}
                        step={0.5}
                        defaultValue={projectFps}
                        onChange={handleSpeedFpsChange}
                        onCommit={clearMergeKey}
                        title="Knurled Frame Rate Thumbwheel: Drag left/right or scroll (-200 to 200 fps)"
                      />
                      <ScrubbableNumberInput
                        value={displayFps}
                        step={0.5}
                        decimals={3}
                        title="Effective playback FPS (Negative when reversed. Manual entry supported)"
                        onChange={handleSpeedFpsChange}
                        onCommit={clearMergeKey}
                      />
                      <div className="inspector-kf-spacer" />
                      <button
                        className="inspector-reset-icon-btn"
                        onClick={resetSpeed}
                        title="Reset Frame Rate to project FPS"
                      >
                        ↺
                      </button>
                    </div>
                  </div>

                  {/* Direction with Two Arrow Buttons */}
                  <div className="inspector-row">
                    <span
                      className="inspector-label resettable"
                      onDoubleClick={resetDirection}
                      title="Double-click to reset Direction to Forward"
                    >
                      Direction
                    </span>
                    <div className="inspector-row-controls">
                      <button
                        className={`inspector-dir-btn ${!isReversed ? 'active' : ''}`}
                        onClick={() => handleSetDirection(false)}
                        title="Forward Playback"
                        aria-label="Forward Playback"
                      >
                        <svg
                          width="10"
                          height="10"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <line x1="4" y1="12" x2="20" y2="12" />
                          <polyline points="13 5 20 12 13 19" />
                        </svg>
                      </button>
                      <button
                        className={`inspector-dir-btn ${isReversed ? 'active' : ''}`}
                        onClick={() => handleSetDirection(true)}
                        title="Reverse Playback"
                        aria-label="Reverse Playback"
                      >
                        <svg
                          width="10"
                          height="10"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <line x1="20" y1="12" x2="4" y2="12" />
                          <polyline points="11 5 4 12 11 19" />
                        </svg>
                      </button>
                      <div className="inspector-row-spacer" />
                      <button
                        className="inspector-reset-icon-btn"
                        onClick={resetDirection}
                        title="Reset Direction to Forward"
                      >
                        ↺
                      </button>
                    </div>
                  </div>

                  {/* Final Duration Readout (Disabled input without lock icon) */}
                  <div className="inspector-row">
                    <span className="inspector-label">Duration</span>
                    <div className="inspector-row-controls">
                      <div
                        className="scrubbable-input-wrapper disabled"
                        style={{ width: '100%', maxWidth: '146px' }}
                        title="Final duration after speed retiming (Read-only)"
                      >
                        <span
                          className="scrubbable-value-display mono"
                          style={{ width: '100%', textAlign: 'center', opacity: 0.6 }}
                        >
                          {finalDurationFormatted}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
            )}
          </>
        )}

        {/* ──── TAB: AUDIO ──── */}
        {activeTab === 'audio' && (
          audioItem ? (
            <div className="inspector-section">
              <div className="inspector-section-header" onClick={() => toggleSection('audio')}>
                <div className="inspector-header-left">
                  <span className="inspector-chevron">{collapsed.audio ? '▶' : '▼'}</span>
                  <span className="inspector-section-title">Audio</span>
                </div>
                <div className="inspector-header-actions">
                  <button
                    className={`inspector-kf-btn ${isKfActive('audio') ? 'active' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleKf('audio')
                    }}
                    title="Keyframe Audio"
                  >
                    <span className="inspector-kf-diamond">{isKfActive('audio') ? '◆' : '◇'}</span>
                  </button>
                  <button
                    className="inspector-reset-icon-btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      dispatch(new ResetAudioPropertiesCommand(audioItem.id))
                    }}
                    title="Reset Audio to default (100 volume, 0 pan)"
                  >
                    ↺
                  </button>
                </div>
              </div>

              {!collapsed.audio && (
                <div className="inspector-section-content">
                  {/* Volume with Slider */}
                  <div className="inspector-row">
                    <span
                      className="inspector-label resettable"
                      onDoubleClick={resetVolume}
                      title="Double-click to reset Volume to 100"
                    >
                      Volume
                    </span>
                    <div className="inspector-row-controls">
                      <input
                        type="range"
                        className="inspector-slider"
                        min={0}
                        max={400}
                        step={1}
                        value={audioProps.volume * 100}
                        onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                        onPointerUp={clearMergeKey}
                        title="Volume (0% to 400%)"
                      />
                      <ScrubbableNumberInput
                        value={audioProps.volume * 100}
                        step={1}
                        decimals={3}
                        min={0}
                        max={400}
                        title="Volume percentage"
                        onChange={handleVolumeChange}
                        onCommit={clearMergeKey}
                      />
                      {renderKfControl('volume', 'Keyframe Volume')}
                      <button
                        className="inspector-reset-icon-btn"
                        onClick={resetVolume}
                        title="Reset Volume to 100"
                      >
                        ↺
                      </button>
                    </div>
                  </div>

                  {/* Pan with Slider */}
                  <div className="inspector-row">
                    <span
                      className="inspector-label resettable"
                      onDoubleClick={resetPan}
                      title="Double-click to reset Pan to 0"
                    >
                      Pan
                    </span>
                    <div className="inspector-row-controls">
                      <input
                        type="range"
                        className="inspector-slider"
                        min={-100}
                        max={100}
                        step={1}
                        value={audioProps.pan * 100}
                        onChange={(e) => handlePanChange(parseFloat(e.target.value))}
                        onPointerUp={clearMergeKey}
                        title="Pan (-100% Left to +100% Right)"
                      />
                      <ScrubbableNumberInput
                        value={audioProps.pan * 100}
                        step={1}
                        decimals={3}
                        min={-100}
                        max={100}
                        title="Pan / Balance"
                        onChange={handlePanChange}
                        onCommit={clearMergeKey}
                      />
                      {renderKfControl('pan', 'Keyframe Pan')}
                      <button
                        className="inspector-reset-icon-btn"
                        onClick={resetPan}
                        title="Reset Pan to 0"
                      >
                        ↺
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="inspector-placeholder-box">
              <span style={{ fontSize: '20px', display: 'block', marginBottom: '8px' }}>🔊</span>
              <strong style={{ color: 'var(--text-primary)', display: 'block', marginBottom: '4px', fontSize: '12px' }}>
                No Audio Stream
              </strong>
              <p style={{ margin: 0, fontSize: '11px', color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
                The selected item has no associated audio track or audio stream.
              </p>
            </div>
          )
        )}

        {/* ──── TAB: EFFECTS ──── */}
        {activeTab === 'effects' && (
          <div className="inspector-effects-container">
            {appliedEffects.length === 0 ? (
              <div className="inspector-placeholder-box">
                <span style={{ fontSize: '20px', display: 'block', marginBottom: '8px' }}>✨</span>
                <strong style={{ color: 'var(--text-primary)', display: 'block', marginBottom: '4px', fontSize: '12px' }}>
                  No Effects Attached
                </strong>
                <p style={{ margin: 0, fontSize: '11px', color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
                  Select an effect from Tools → Effects on the left panel to attach it to this clip.
                </p>
              </div>
            ) : (
              <div className="inspector-effects-list">
                {appliedEffects.map((eff, effIdx) => {
                  const def = getEffectDefinition(eff.effectId)
                  const isEffCollapsed = collapsed[`fx_${eff.id}`] ?? false

                  return (
                    <div key={eff.id} className={`inspector-effect-card ${!eff.enabled ? 'disabled' : ''}`}>
                      <div
                        className="inspector-effect-header"
                        onClick={() => toggleSection(`fx_${eff.id}`)}
                      >
                        <div className="inspector-effect-header-left">
                          <span className="inspector-chevron">{isEffCollapsed ? '▶' : '▼'}</span>
                          <input
                            type="checkbox"
                            className="inspector-header-toggle inspector-effect-toggle"
                            checked={eff.enabled}
                            onChange={(e) => {
                              e.stopPropagation()
                              if (targetItem) {
                                dispatch(new ToggleEffectCommand(targetItem.id, eff.id, e.target.checked))
                              }
                            }}
                            onClick={(e) => e.stopPropagation()}
                            title={eff.enabled ? 'Disable Effect' : 'Enable Effect'}
                          />
                          <span className="inspector-effect-name">{eff.name}</span>
                        </div>

                        <div className="inspector-effect-header-actions" onClick={(e) => e.stopPropagation()}>
                          {effIdx > 0 && (
                            <button
                              className="inspector-effect-btn"
                              onClick={() => {
                                if (targetItem) {
                                  dispatch(new ReorderEffectsCommand(targetItem.id, effIdx, effIdx - 1))
                                }
                              }}
                              title="Move Effect Up"
                            >
                              ▲
                            </button>
                          )}
                          {effIdx < appliedEffects.length - 1 && (
                            <button
                              className="inspector-effect-btn"
                              onClick={() => {
                                if (targetItem) {
                                  dispatch(new ReorderEffectsCommand(targetItem.id, effIdx, effIdx + 1))
                                }
                              }}
                              title="Move Effect Down"
                            >
                              ▼
                            </button>
                          )}
                          <button
                            className="inspector-effect-btn"
                            onClick={() => {
                              if (targetItem && def) {
                                const defaultParams: Record<string, number | string | boolean> = {}
                                for (const p of def.params) {
                                  defaultParams[p.key] = p.defaultVal
                                }
                                dispatch(new ResetEffectParamsCommand(targetItem.id, eff.id, defaultParams))
                              }
                            }}
                            title="Reset all parameters to default"
                          >
                            ↺
                          </button>
                          <button
                            className="inspector-effect-btn remove"
                            onClick={() => {
                              if (targetItem) {
                                dispatch(new RemoveEffectCommand(targetItem.id, eff.id))
                              }
                            }}
                            title="Remove Effect"
                          >
                            ✕
                          </button>
                        </div>
                      </div>

                      {!isEffCollapsed && (
                        <div className="inspector-effect-content">
                          {def ? (
                            def.params.map((pDef) => {
                              const currentVal = eff.params[pDef.key] ?? pDef.defaultVal

                              return (
                                <div className="inspector-row" key={pDef.key}>
                                  <span
                                    className="inspector-label resettable"
                                    onDoubleClick={() => {
                                      if (targetItem) {
                                        dispatch(
                                          new UpdateEffectParamCommand(
                                            targetItem.id,
                                            eff.id,
                                            pDef.key,
                                            pDef.defaultVal
                                          )
                                        )
                                      }
                                    }}
                                    title={`Double-click to reset ${pDef.label} to default (${pDef.defaultVal})`}
                                  >
                                    {pDef.label}
                                  </span>
                                  <div className="inspector-row-controls">
                                    {pDef.type === 'color' && (
                                      <div className="inspector-color-input-wrapper">
                                        <input
                                          type="color"
                                          className="inspector-color-picker"
                                          value={String(currentVal || pDef.defaultVal)}
                                          onChange={(e) => {
                                            if (targetItem) {
                                              dispatch(
                                                new UpdateEffectParamCommand(
                                                  targetItem.id,
                                                  eff.id,
                                                  pDef.key,
                                                  e.target.value
                                                )
                                              )
                                            }
                                          }}
                                          title={`Pick ${pDef.label}`}
                                        />
                                        <input
                                          type="text"
                                          className="inspector-color-hex-text"
                                          value={String(currentVal || pDef.defaultVal).toUpperCase()}
                                          onChange={(e) => {
                                            if (targetItem) {
                                              dispatch(
                                                new UpdateEffectParamCommand(
                                                  targetItem.id,
                                                  eff.id,
                                                  pDef.key,
                                                  e.target.value
                                                )
                                              )
                                            }
                                          }}
                                          title="Hex Color Code"
                                        />
                                        {pDef.key === 'keyColor' && (
                                          <div className="inspector-color-presets">
                                            <button
                                              type="button"
                                              className="inspector-color-preset green"
                                              style={{ backgroundColor: '#00ff00' }}
                                              title="Green Screen (#00FF00)"
                                              onClick={() => {
                                                if (targetItem) {
                                                  dispatch(new UpdateEffectParamCommand(targetItem.id, eff.id, pDef.key, '#00ff00'))
                                                }
                                              }}
                                            />
                                            <button
                                              type="button"
                                              className="inspector-color-preset blue"
                                              style={{ backgroundColor: '#0055ff' }}
                                              title="Blue Screen (#0055FF)"
                                              onClick={() => {
                                                if (targetItem) {
                                                  dispatch(new UpdateEffectParamCommand(targetItem.id, eff.id, pDef.key, '#0055ff'))
                                                }
                                              }}
                                            />
                                            <button
                                              type="button"
                                              className="inspector-color-preset magenta"
                                              style={{ backgroundColor: '#ff00ff' }}
                                              title="Magenta (#FF00FF)"
                                              onClick={() => {
                                                if (targetItem) {
                                                  dispatch(new UpdateEffectParamCommand(targetItem.id, eff.id, pDef.key, '#ff00ff'))
                                                }
                                              }}
                                            />
                                          </div>
                                        )}
                                      </div>
                                    )}

                                    {pDef.type === 'select' && (
                                      <select
                                        className="inspector-select"
                                        value={String(currentVal || pDef.defaultVal)}
                                        onChange={(e) => {
                                          if (targetItem) {
                                            dispatch(
                                              new UpdateEffectParamCommand(
                                                targetItem.id,
                                                eff.id,
                                                pDef.key,
                                                e.target.value
                                              )
                                            )
                                          }
                                        }}
                                      >
                                        {(pDef.options || []).map((opt) => (
                                          <option key={opt.value} value={opt.value}>
                                            {opt.label}
                                          </option>
                                        ))}
                                      </select>
                                    )}

                                    {pDef.type === 'number' && (
                                      <>
                                        <input
                                          type="range"
                                          className="inspector-slider"
                                          min={pDef.min ?? 0}
                                          max={pDef.max ?? 100}
                                          step={pDef.step ?? 1}
                                          value={Number(currentVal)}
                                          onChange={(e) => {
                                            if (targetItem) {
                                              dispatch(
                                                new UpdateEffectParamCommand(
                                                  targetItem.id,
                                                  eff.id,
                                                  pDef.key,
                                                  parseFloat(e.target.value),
                                                  `fx-${eff.id}-${pDef.key}`
                                                )
                                              )
                                            }
                                          }}
                                          onPointerUp={clearMergeKey}
                                          title={`${pDef.label} (${currentVal}${pDef.unit || ''})`}
                                        />
                                        <ScrubbableNumberInput
                                          value={Number(currentVal)}
                                          step={pDef.step ?? 1}
                                          decimals={pDef.step && pDef.step < 1 ? 1 : 0}
                                          min={pDef.min}
                                          max={pDef.max}
                                          suffix={pDef.unit}
                                          title={pDef.label}
                                          onChange={(v) => {
                                            if (targetItem) {
                                              dispatch(
                                                new UpdateEffectParamCommand(
                                                  targetItem.id,
                                                  eff.id,
                                                  pDef.key,
                                                  v,
                                                  `fx-${eff.id}-${pDef.key}`
                                                )
                                              )
                                            }
                                          }}
                                          onCommit={clearMergeKey}
                                        />
                                      </>
                                    )}
                                    <button
                                      className="inspector-reset-icon-btn"
                                      onClick={() => {
                                        if (targetItem) {
                                          dispatch(
                                            new UpdateEffectParamCommand(
                                              targetItem.id,
                                              eff.id,
                                              pDef.key,
                                              pDef.defaultVal
                                            )
                                          )
                                        }
                                      }}
                                      title={`Reset ${pDef.label} to default`}
                                    >
                                      ↺
                                    </button>
                                  </div>
                                </div>
                              )
                            })
                          ) : (
                            <p style={{ margin: 0, fontSize: '11px', color: 'var(--text-tertiary)' }}>
                              Custom Effect: {eff.effectId}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ──── TAB: TRANSITIONS ──── */}
        {activeTab === 'transitions' && (
          <div className="inspector-transitions-tab">
            {targetItem ? (() => {
              const { startTransition, endTransition } = getClipTransitions(state, targetItem.id)

              return (
                <div className="inspector-clip-transitions-container">
                  {([
                    ['start', startTransition],
                    ['end', endTransition],
                  ] as const).map(([placement, transition]) => transition ? (
                    <TransitionControls key={placement} transition={transition} dispatch={dispatch}
                      placement={placement}
                      selected={selectedTransition?.id === transition.id}
                      onSelect={() => dispatch(new SelectTransitionCommand(transition.id))} />
                  ) : null)}
                  {!startTransition && !endTransition && (
                    <div className="inspector-empty-state">
                      <span className="inspector-empty-title">No transitions applied</span>
                    </div>
                  )}
                </div>
              )
            })() : (
              <div className="inspector-empty-state">
                <span className="inspector-empty-icon">🔀</span>
                <span className="inspector-empty-title">No Transition Selected</span>
                <span className="inspector-empty-desc">
                  Select a clip or click a transition on the timeline to configure transitions.
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function TransitionControls({
  transition,
  dispatch,
  placement,
  selected,
  onSelect,
}: {
  transition: TimelineTransition
  dispatch: (command: EditorCommand) => void
  placement: 'start' | 'end'
  selected: boolean
  onSelect: () => void
}) {
  const cardRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (selected) cardRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selected])
  const trId = normalizeTransitionId(transition.transitionId)
  const intensityVal = typeof transition.params?.intensity === 'number'
    ? Number(transition.params.intensity)
    : 100
  const dirVal = getTransitionDirection(transition.transitionId, transition.params?.direction)
  const shared = Boolean(transition.leftClipId && transition.rightClipId)
  const alignment = shared ? transition.alignment ?? 'center' : placement
  const alignments = [
    { value: 'end', label: 'Left', title: 'End of previous clip', x: 2 },
    { value: 'center', label: 'Center', title: 'Across both clips', x: 7 },
    { value: 'start', label: 'Right', title: 'Start of next clip', x: 12 },
  ] as const


  return (
    <div ref={cardRef} className="inspector-section inspector-transition-card"
      data-transition-id={transition.id} role="region" aria-label={`${transition.name} (${placement})`}
      onPointerDown={event => { if (event.button === 0 && !selected) onSelect() }}>
      <div className="inspector-section-header">
        <div className="inspector-header-left">
          <span className="inspector-section-title">{transition.name}</span>
          <span className="inspector-transition-position">{placement === 'start' ? 'Start' : 'End'}</span>
        </div>
        <button
          type="button"
          className="inspector-reset-icon-btn"
          onClick={() => {
            dispatch(new RemoveTransitionCommand(transition.id))
          }}
          title="Delete Transition"
        >
          ✕
        </button>
      </div>

      <div className="inspector-section-content">
        {/* Transition Type Dropdown */}
        <div className="inspector-row">
          <span className="inspector-label">Type</span>
          <div className="inspector-row-controls">
            <select
              className="inspector-select"
              value={normalizeTransitionId(transition.transitionId)}
              onChange={(e) => {
                const found = AVAILABLE_TRANSITIONS.find((t) => t.id === e.target.value)
                if (found) {
                  dispatch(
                    new UpdateTransitionCommand(transition.id, {
                      transitionId: found.id,
                      name: found.name,
                      params: { direction: getTransitionDirection(found.id) },
                    })
                  )
                }
              }}
            >
              {AVAILABLE_TRANSITIONS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.icon} {t.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="inspector-row">
          <span className="inspector-label">Alignment</span>
          <div className="inspector-row-controls" role="group" aria-label="Transition alignment">
            {alignments.map(option => (
              <button key={option.value} type="button"
                className={`inspector-flip-btn ${alignment === option.value ? 'active' : ''}`}
                aria-label={`Align transition ${option.label.toLowerCase()}`}
                aria-pressed={alignment === option.value}
                disabled={!shared && placement !== option.value}
                title={!shared && placement !== option.value
                  ? 'Requires two adjacent clips' : `${option.label}: ${option.title}`}
                onClick={() => dispatch(new UpdateTransitionCommand(transition.id, { alignment: option.value }))}>
                <svg width="16" height="14" viewBox="0 0 24 20" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M12 1v18" strokeDasharray="2 2" />
                  <rect x={option.x} y="5" width="10" height="10" rx="1.5" fill="currentColor" fillOpacity="0.3" />
                </svg>
              </button>
            ))}
          </div>
        </div>

        {/* Duration Row */}
        <div className="inspector-row">
          <span
            className="inspector-label resettable"
            onDoubleClick={() => {
              dispatch(new UpdateTransitionCommand(transition.id, { duration: 1.0 }))
            }}
            title="Double click to reset duration to 1.0s"
          >
            Duration
          </span>
          <div className="inspector-row-controls">
            <input
              type="range"
              className="inspector-slider"
              min={0.1}
              max={5.0}
              step={0.05}
              value={Number(transition.duration.toFixed(2))}
              onChange={(e) => {
                dispatch(new UpdateTransitionCommand(transition.id, { duration: parseFloat(e.target.value) }))
              }}
              title={`Duration: ${transition.duration.toFixed(2)}s`}
            />
            <ScrubbableNumberInput
              value={Number(transition.duration.toFixed(2))}
              step={0.05}
              decimals={2}
              min={0.1}
              max={10}
              suffix="s"
              title="Transition Duration"
              onChange={(dur) => {
                dispatch(new UpdateTransitionCommand(transition.id, { duration: dur }))
              }}
            />
            <button
              type="button"
              className="inspector-reset-icon-btn"
              onClick={() => {
                dispatch(new UpdateTransitionCommand(transition.id, { duration: 1.0 }))
              }}
              title="Reset duration to 1.0s"
            >
              ↺
            </button>
          </div>
        </div>

        {/* Linear Wipe Direction */}
        {(trId.includes('wipe') && !trId.includes('clock')) && (
          <div className="inspector-row">
            <span className="inspector-label">Direction</span>
            <div className="inspector-row-controls">
              <select
                className="inspector-select"
                value={dirVal || 'fromLeft'}
                onChange={(e) => {
                  dispatch(
                    new UpdateTransitionCommand(transition.id, {
                      params: { direction: e.target.value },
                    })
                  )
                }}
              >
                <option value="fromLeft">Left to Right</option>
                <option value="fromRight">Right to Left</option>
                <option value="fromTop">Top to Bottom</option>
                <option value="fromBottom">Bottom to Top</option>
              </select>
            </div>
          </div>
        )}

        {/* Clock Wipe Direction */}
        {trId.includes('clock') && (
          <div className="inspector-row">
            <span className="inspector-label">Direction</span>
            <div className="inspector-row-controls">
              <select
                className="inspector-select"
                value={dirVal || 'clockwise'}
                onChange={(e) => {
                  dispatch(
                    new UpdateTransitionCommand(transition.id, {
                      params: { direction: e.target.value },
                    })
                  )
                }}
              >
                <option value="clockwise">Clockwise</option>
                <option value="counterClockwise">Counter-Clockwise</option>
              </select>
            </div>
          </div>
        )}

        {/* Push / Slide Direction */}
        {(trId.includes('push') || trId.includes('slide')) && (
          <div className="inspector-row">
            <span className="inspector-label">Direction</span>
            <div className="inspector-row-controls">
              <select
                className="inspector-select"
                value={dirVal || (trId.includes('up') ? 'up' : 'left')}
                onChange={(e) => {
                  dispatch(
                    new UpdateTransitionCommand(transition.id, {
                      params: { direction: e.target.value },
                    })
                  )
                }}
              >
                <option value="left">Left</option>
                <option value="right">Right</option>
                <option value="up">Up</option>
                <option value="down">Down</option>
              </select>
            </div>
          </div>
        )}

        {/* Whip Pan Direction & Blur */}
        {trId.includes('whip') && (
          <>
            <div className="inspector-row">
              <span className="inspector-label">Direction</span>
              <div className="inspector-row-controls">
                <select
                  className="inspector-select"
                  value={dirVal || 'left'}
                  onChange={(e) => {
                    dispatch(
                      new UpdateTransitionCommand(transition.id, {
                        params: { direction: e.target.value },
                      })
                    )
                  }}
                >
                  <option value="left">Left</option>
                  <option value="right">Right</option>
                </select>
              </div>
            </div>
            <div className="inspector-row">
              <span className="inspector-label">Blur</span>
              <div className="inspector-row-controls">
                <input
                  type="range"
                  className="inspector-slider"
                  min={10}
                  max={100}
                  step={5}
                  value={typeof transition.params?.blur === 'number' ? Number(transition.params.blur) : 60}
                  onChange={(e) => {
                    dispatch(
                      new UpdateTransitionCommand(transition.id, {
                        params: { blur: parseInt(e.target.value, 10) },
                      })
                    )
                  }}
                />
                <span className="inspector-unit-badge">
                  {typeof transition.params?.blur === 'number' ? transition.params.blur : 60}%
                </span>
              </div>
            </div>
          </>
        )}

        {/* Zoom Mode */}
        {trId.includes('zoom') && (
          <div className="inspector-row">
            <span className="inspector-label">Mode</span>
            <div className="inspector-row-controls">
              <select
                className="inspector-select"
                value={String(transition.params?.mode || 'zoomIn')}
                onChange={(e) => {
                  dispatch(
                    new UpdateTransitionCommand(transition.id, {
                      params: { mode: e.target.value },
                    })
                  )
                }}
              >
                <option value="zoomIn">Zoom In</option>
                <option value="zoomOut">Zoom Out</option>
              </select>
            </div>
          </div>
        )}

        {/* Dissolve Curve */}
        {(trId.includes('dissolve') || trId.includes('fade')) && (
          <div className="inspector-row">
            <span className="inspector-label">Curve</span>
            <div className="inspector-row-controls">
              <select
                className="inspector-select"
                value={String(transition.params?.curve || 'smooth')}
                onChange={(e) => {
                  dispatch(
                    new UpdateTransitionCommand(transition.id, {
                      params: { curve: e.target.value },
                    })
                  )
                }}
              >
                <option value="smooth">Smooth Easing</option>
                <option value="linear">Linear</option>
              </select>
            </div>
          </div>
        )}

        {/* Intensity / Amount Slider (for Zoom, Black, White, Glitch, etc.) */}
        {(trId.includes('zoom') || trId.includes('glitch') || trId.includes('black') || trId.includes('white')) && (
          <div className="inspector-row">
            <span
              className="inspector-label resettable"
              onDoubleClick={() => {
                dispatch(new UpdateTransitionCommand(transition.id, { params: { intensity: 100 } }))
              }}
              title="Double click to reset intensity to 100%"
            >
              Intensity
            </span>
            <div className="inspector-row-controls">
              <input
                type="range"
                className="inspector-slider"
                min={0}
                max={100}
                step={1}
                value={intensityVal}
                onChange={(e) => {
                  dispatch(
                    new UpdateTransitionCommand(transition.id, {
                      params: { intensity: parseInt(e.target.value, 10) },
                    })
                  )
                }}
                title={`Intensity: ${intensityVal}%`}
              />
              <ScrubbableNumberInput
                value={intensityVal}
                step={1}
                decimals={0}
                min={0}
                max={100}
                suffix="%"
                title="Transition Intensity"
                onChange={(val) => {
                  dispatch(
                    new UpdateTransitionCommand(transition.id, {
                      params: { intensity: val },
                    })
                  )
                }}
              />
              <button
                type="button"
                className="inspector-reset-icon-btn"
                onClick={() => {
                  dispatch(new UpdateTransitionCommand(transition.id, { params: { intensity: 100 } }))
                }}
                title="Reset intensity to 100%"
              >
                ↺
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
