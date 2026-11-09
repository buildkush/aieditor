import { resolveTransitionDrop } from '../../core/timeline/transitionPlacement'
import { useState, useMemo, useCallback } from 'react'
import type { ProjectState } from '../../core/project/projectState'
import type { EditorCommand } from '../../core/commands/editorCommand'
import {
  AddTextLayerCommand,
  AddCaptionCommand,
  AddSolidLayerCommand,
  AddAdjustmentLayerCommand,
  ApplyEffectCommand,
  AddTransitionCommand,
  SelectTransitionCommand,
  SelectItemCommand,
} from '../../core/commands/editorCommand'
import type { ItemEffect, TimelineTransition } from '../../core/timeline/types'
import { generateId } from '../../core/utils'
import { EFFECT_DEFINITIONS, type EffectDefinition } from './effectDefinitions'
import { TEXT_TOOL_PRESETS, type TextToolPreset } from './toolPresets'
import { setActiveDraggedTool, type ActiveToolDrag } from './activeDragTool'
import {
  TextPresetIcon,
  OverlayIcon,
  LayerIcon,
  TransitionIcon,
  EffectGlyph,
} from './ToolPreviewIcons'
import { TRANSITION_DEFINITIONS, type TransitionDefinition } from '../../core/timeline/transitionDefinitions'
import './ToolsPanel.css'

export interface ToolsPanelProps {
  state: ProjectState
  dispatch: (command: EditorCommand) => void
  onEffectApplied?: () => void
}

type TransitionEntry = TransitionDefinition
const BUILTIN_TRANSITIONS = TRANSITION_DEFINITIONS

export function ToolsPanel({ state, dispatch, onEffectApplied }: ToolsPanelProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null)

  // Expand / collapse states for categories
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    text: true,
    overlays: true,
    layers: true,
    transitions: true,
    videoTransitions: true,
    effects: true,
    fx_video: true,
    fx_color: true,
    fx_stylize: true,
    fx_distortion: true,
    fx_keying: true,
    fx_audio: true,
  })

  const toggleCategory = useCallback((key: string) => {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }))
  }, [])

  const playhead = state.playheadTime ?? 0
  const selectedItemId = state.selectedItemId ?? (state.selectedItemIds && state.selectedItemIds[0]) ?? null
  const selectedItem = selectedItemId ? state.items[selectedItemId] : null

  const showFeedback = useCallback((msg: string) => {
    setFeedbackMessage(msg)
    setTimeout(() => {
      setFeedbackMessage((current) => (current === msg ? null : current))
    }, 3200)
  }, [])

  // ──── Creation Actions (Click on Card) ────
  const handleAddTextPreset = useCallback(
    (preset: TextToolPreset) => {
      if (preset.itemKind === 'caption') {
        dispatch(
          new AddCaptionCommand({
            startTime: playhead,
            text: preset.text,
            duration: preset.duration,
            preset: preset.captionPreset,
            style: preset.captionStyle,
            transform: preset.transform,
          })
        )
        showFeedback(`Added ${preset.name} layer at playhead`)
      } else {
        dispatch(
          new AddTextLayerCommand({
            startTime: playhead,
            text: preset.text,
            duration: preset.duration,
            properties: preset.properties,
            transform: preset.transform,
          })
        )
        showFeedback(`Added ${preset.name} layer at playhead`)
      }
    },
    [dispatch, playhead, showFeedback]
  )

  const handleAddSolid = useCallback(() => {
    dispatch(new AddSolidLayerCommand({ startTime: playhead, color: '#3b82f6', duration: 5 }))
    showFeedback('Added Solid Color layer at playhead')
  }, [dispatch, playhead, showFeedback])

  const handleAddAdjustment = useCallback(() => {
    dispatch(new AddAdjustmentLayerCommand({ startTime: playhead, duration: 5 }))
    showFeedback('Added Adjustment Layer at playhead')
  }, [dispatch, playhead, showFeedback])

  // ──── Effect Application (Click on Card) ────
  const handleApplyEffect = useCallback(
    (def: EffectDefinition) => {
      if (!selectedItemId || !selectedItem) {
        showFeedback('Select a clip on the timeline first, or drag this effect onto a clip')
        return
      }

      const defaultParams: Record<string, number | string | boolean> = {}
      for (const p of def.params) {
        defaultParams[p.key] = p.defaultVal
      }

      const clipDur = selectedItem.duration || 5
      const newEffect: ItemEffect = {
        id: generateId('fx'),
        effectId: def.id,
        name: def.name,
        category: def.category,
        enabled: true,
        params: defaultParams,
        rangeMode: 'fullClip',
        startOffset: 0,
        endOffset: clipDur,
      }

      dispatch(new ApplyEffectCommand(selectedItemId, newEffect))
      showFeedback(`Applied "${def.name}" to selected clip`)
      if (onEffectApplied) {
        onEffectApplied()
      }
    },
    [selectedItemId, selectedItem, dispatch, showFeedback, onEffectApplied]
  )

  const handleApplyTransition = useCallback(
    (tr: TransitionEntry) => {
      const candidateId = selectedItemId || (state.selectedItemIds && state.selectedItemIds[0]) || null
      const item = candidateId ? state.items[candidateId] : null
      if (!item) {
        showFeedback('Select a clip on the timeline first, or drag this transition onto a clip')
        return
      }

      const track = state.tracks.find((t) => t.id === item.trackId)
      if (!track || track.type === 'audio' || item.streamType === 'audio') {
        showFeedback('Transitions cannot be applied to audio clips')
        return
      }

      const trDuration = tr.defaultDurationSec ?? 1.0
      const attachment = resolveTransitionDrop(state.items, item.trackId, state.playheadTime ?? item.startTime,
        trDuration, item.id)
      if (!attachment) return
      const newTr: TimelineTransition = {
        id: generateId('tr'), transitionId: tr.id, name: tr.name, ...attachment,
      }

      dispatch(new AddTransitionCommand(newTr))
      dispatch(new SelectItemCommand(item.id))
      dispatch(new SelectTransitionCommand(newTr.id))
      showFeedback(`Applied "${tr.name}" transition`)
    },
    [selectedItemId, state.selectedItemIds, state.items, state.tracks, state.playheadTime, dispatch, showFeedback]
  )

  // ──── Drag-and-Drop Start Handlers ────
  const handleDragStartLayerPreset = (e: React.DragEvent, preset: TextToolPreset) => {
    const dragPayload: ActiveToolDrag = {
      type: 'layer',
      dragType: 'layer',
      toolId: preset.id,
      name: preset.name,
      itemKind: preset.itemKind,
      duration: preset.duration,
      preset,
    }
    setActiveDraggedTool(dragPayload)
    e.dataTransfer.setData('application/aiditor-tool', JSON.stringify(dragPayload))
    e.dataTransfer.effectAllowed = 'copy'
  }

  const handleDragStartSolid = (e: React.DragEvent) => {
    const dragPayload: ActiveToolDrag = {
      type: 'layer',
      dragType: 'layer',
      toolId: 'solid',
      name: 'Solid Color',
      itemKind: 'solid',
      duration: 5,
      solidColor: '#3b82f6',
    }
    setActiveDraggedTool(dragPayload)
    e.dataTransfer.setData('application/aiditor-tool', JSON.stringify(dragPayload))
    e.dataTransfer.effectAllowed = 'copy'
  }

  const handleDragStartAdjustment = (e: React.DragEvent) => {
    const dragPayload: ActiveToolDrag = {
      type: 'layer',
      dragType: 'layer',
      toolId: 'adjustment',
      name: 'Adjustment Layer',
      itemKind: 'adjustment',
      duration: 5,
    }
    setActiveDraggedTool(dragPayload)
    e.dataTransfer.setData('application/aiditor-tool', JSON.stringify(dragPayload))
    e.dataTransfer.effectAllowed = 'copy'
  }

  const handleDragStartEffect = (e: React.DragEvent, eff: EffectDefinition) => {
    const dragPayload: ActiveToolDrag = {
      type: 'effect',
      dragType: 'effect',
      effect: eff,
    }
    setActiveDraggedTool(dragPayload)
    e.dataTransfer.setData('application/aiditor-tool', JSON.stringify(dragPayload))
    e.dataTransfer.effectAllowed = 'copy'
  }

  const handleDragStartTransition = (e: React.DragEvent, tr: TransitionEntry) => {
    const dragPayload: ActiveToolDrag = {
      type: 'transition',
      dragType: 'transition',
      transitionId: tr.id,
      name: tr.name,
      category: tr.category,
      duration: tr.defaultDurationSec ?? 1.0,
    }
    setActiveDraggedTool(dragPayload)
    e.dataTransfer.setData('application/aiditor-tool', JSON.stringify(dragPayload))
    e.dataTransfer.effectAllowed = 'copy'
  }

  const handleDragEnd = () => {
    setActiveDraggedTool(null)
  }

  // ──── Filtering ────
  const query = searchQuery.trim().toLowerCase()
  const isSearching = query.length > 0

  const textFiltered = useMemo(() => {
    if (!query) return TEXT_TOOL_PRESETS
    return TEXT_TOOL_PRESETS.filter(
      (p) =>
        p.name.toLowerCase().includes(query) ||
        (p.subtitle && p.subtitle.toLowerCase().includes(query))
    )
  }, [query])

  const overlaysFiltered = useMemo(() => {
    const items = [
      { id: 'solid', name: 'Solid Color', subtitle: 'Color Matte Swatch', action: handleAddSolid },
    ]
    if (!query) return items
    return items.filter(
      (it) =>
        it.name.toLowerCase().includes(query) ||
        it.subtitle.toLowerCase().includes(query)
    )
  }, [query, handleAddSolid])

  const layersFiltered = useMemo(() => {
    const items = [
      { id: 'adjustment', name: 'Adjustment Layer', subtitle: 'Global Grade & FX', action: handleAddAdjustment },
    ]
    if (!query) return items
    return items.filter(
      (it) =>
        it.name.toLowerCase().includes(query) ||
        it.subtitle.toLowerCase().includes(query)
    )
  }, [query, handleAddAdjustment])

  const transitionsFiltered = useMemo(() => {
    if (!query) return BUILTIN_TRANSITIONS
    return BUILTIN_TRANSITIONS.filter(
      (tr) =>
        tr.name.toLowerCase().includes(query) ||
        tr.description.toLowerCase().includes(query)
    )
  }, [query])

  const effectsByCategory = useMemo(() => {
    const map: Record<string, EffectDefinition[]> = {
      video: [],
      color: [],
      stylize: [],
      distortion: [],
      keying: [],
      audio: [],
    }

    const filtered = !query
      ? EFFECT_DEFINITIONS
      : EFFECT_DEFINITIONS.filter(
          (e) =>
            e.name.toLowerCase().includes(query) ||
            e.category.toLowerCase().includes(query) ||
            e.description.toLowerCase().includes(query)
        )

    for (const eff of filtered) {
      if (map[eff.category]) {
        map[eff.category].push(eff)
      }
    }
    return map
  }, [query])

  const hasAnyEffects = Object.values(effectsByCategory).some((list) => list.length > 0)

  return (
    <div className="tools-panel-container">
      {/* Search Header (Fixed) */}
      <div className="tools-panel-header">
        <div className="tools-search-wrapper">
          <input
            type="text"
            className="tools-search-input"
            placeholder="Search tools & effects..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              className="tools-search-clear"
              onClick={() => setSearchQuery('')}
              title="Clear search"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Feedback Banner */}
      {feedbackMessage && (
        <div className="tools-feedback-banner">
          <span>{feedbackMessage}</span>
        </div>
      )}

      {/* Scrollable Categories View */}
      <div className="tools-tree-scroll">
        {/* TEXT */}
        {(textFiltered.length > 0 || !isSearching) && (
          <div className="tools-category">
            <div className="tools-category-header" onClick={() => toggleCategory('text')}>
              <span className="tools-chevron">{expanded.text || isSearching ? '▼' : '▶'}</span>
              <span className="tools-category-title">TEXT</span>
            </div>

            {(expanded.text || isSearching) && (
              <div className="tools-category-items">
                {textFiltered.map((preset) => (
                  <div
                    key={preset.id}
                    className="tools-card"
                    draggable={true}
                    onDragStart={(e) => handleDragStartLayerPreset(e, preset)}
                    onDragEnd={handleDragEnd}
                    onClick={() => handleAddTextPreset(preset)}
                    title={`Click to add at playhead, or drag directly into a layer track`}
                  >
                    <div className="tools-card-preview">
                      <TextPresetIcon id={preset.id} />
                    </div>
                    <div className="tools-card-info">
                      <span className="tools-card-title">{preset.name}</span>
                      <span className="tools-card-sub">{preset.subtitle || 'Layer Item'}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* OVERLAYS */}
        {(overlaysFiltered.length > 0 || !isSearching) && (
          <div className="tools-category">
            <div className="tools-category-header" onClick={() => toggleCategory('overlays')}>
              <span className="tools-chevron">{expanded.overlays || isSearching ? '▼' : '▶'}</span>
              <span className="tools-category-title">OVERLAYS</span>
            </div>

            {(expanded.overlays || isSearching) && (
              <div className="tools-category-items">
                {overlaysFiltered.map((tool) => (
                  <div
                    key={tool.id}
                    className="tools-card"
                    draggable={true}
                    onDragStart={handleDragStartSolid}
                    onDragEnd={handleDragEnd}
                    onClick={tool.action}
                    title="Click to add at playhead, or drag directly into a video track"
                  >
                    <div className="tools-card-preview">
                      <OverlayIcon />
                    </div>
                    <div className="tools-card-info">
                      <span className="tools-card-title">{tool.name}</span>
                      <span className="tools-card-sub">{tool.subtitle}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* LAYERS */}
        {(layersFiltered.length > 0 || !isSearching) && (
          <div className="tools-category">
            <div className="tools-category-header" onClick={() => toggleCategory('layers')}>
              <span className="tools-chevron">{expanded.layers || isSearching ? '▼' : '▶'}</span>
              <span className="tools-category-title">LAYERS</span>
            </div>

            {(expanded.layers || isSearching) && (
              <div className="tools-category-items">
                {layersFiltered.map((tool) => (
                  <div
                    key={tool.id}
                    className="tools-card"
                    draggable={true}
                    onDragStart={handleDragStartAdjustment}
                    onDragEnd={handleDragEnd}
                    onClick={tool.action}
                    title="Click to add at playhead, or drag directly into an adjustment track"
                  >
                    <div className="tools-card-preview">
                      <LayerIcon />
                    </div>
                    <div className="tools-card-info">
                      <span className="tools-card-title">{tool.name}</span>
                      <span className="tools-card-sub">{tool.subtitle}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TRANSITIONS */}
        {(transitionsFiltered.length > 0 || !isSearching) && (
          <div className="tools-category">
            <div className="tools-category-header" onClick={() => toggleCategory('transitions')}>
              <span className="tools-chevron">{expanded.transitions || isSearching ? '▼' : '▶'}</span>
              <span className="tools-category-title">TRANSITIONS</span>
            </div>

            {(expanded.transitions || isSearching) && (
              <div className="tools-category-items">
                <div className="tools-subcategory-block">
                  <div
                    className="tools-subcategory-header"
                    onClick={() => toggleCategory('videoTransitions')}
                  >
                    <span className="tools-subchevron">
                      {expanded.videoTransitions || isSearching ? '▼' : '▶'}
                    </span>
                    <span className="tools-subcategory-title">Video Transitions</span>
                    <span className="tools-subcategory-count">{transitionsFiltered.length}</span>
                  </div>

                  {(expanded.videoTransitions || isSearching) && (
                    <div className="tools-subcategory-items">
                      {transitionsFiltered.map((tr) => (
                        <div
                          key={tr.id}
                          className="tools-card"
                          draggable={true}
                          onDragStart={(e) => handleDragStartTransition(e, tr)}
                          onDragEnd={handleDragEnd}
                          onClick={() => handleApplyTransition(tr)}
                          title={`${tr.name} — click to apply to selected clip, or drag onto any clip on the timeline`}
                        >
                          <div className="tools-card-preview">
                            <TransitionIcon id={tr.id} />
                          </div>
                          <div className="tools-card-info">
                            <span className="tools-card-title">{tr.name}</span>
                            <span className="tools-card-sub">{tr.description}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* EFFECTS */}
        {(hasAnyEffects || !isSearching) && (
          <div className="tools-category">
            <div className="tools-category-header" onClick={() => toggleCategory('effects')}>
              <span className="tools-chevron">{expanded.effects || isSearching ? '▼' : '▶'}</span>
              <span className="tools-category-title">EFFECTS</span>
            </div>

            {(expanded.effects || isSearching) && (
              <div className="tools-category-items">
                {renderEffectSubCategory(
                  'Video',
                  'fx_video',
                  effectsByCategory.video,
                  expanded.fx_video || isSearching,
                  toggleCategory,
                  handleApplyEffect,
                  handleDragStartEffect,
                  handleDragEnd
                )}
                {renderEffectSubCategory(
                  'Color',
                  'fx_color',
                  effectsByCategory.color,
                  expanded.fx_color || isSearching,
                  toggleCategory,
                  handleApplyEffect,
                  handleDragStartEffect,
                  handleDragEnd
                )}
                {renderEffectSubCategory(
                  'Stylize',
                  'fx_stylize',
                  effectsByCategory.stylize,
                  expanded.fx_stylize || isSearching,
                  toggleCategory,
                  handleApplyEffect,
                  handleDragStartEffect,
                  handleDragEnd
                )}
                {renderEffectSubCategory(
                  'Distortion',
                  'fx_distortion',
                  effectsByCategory.distortion,
                  expanded.fx_distortion || isSearching,
                  toggleCategory,
                  handleApplyEffect,
                  handleDragStartEffect,
                  handleDragEnd
                )}
                {renderEffectSubCategory(
                  'Keying',
                  'fx_keying',
                  effectsByCategory.keying,
                  expanded.fx_keying || isSearching,
                  toggleCategory,
                  handleApplyEffect,
                  handleDragStartEffect,
                  handleDragEnd
                )}
                {renderEffectSubCategory(
                  'Audio',
                  'fx_audio',
                  effectsByCategory.audio,
                  expanded.fx_audio || isSearching,
                  toggleCategory,
                  handleApplyEffect,
                  handleDragStartEffect,
                  handleDragEnd
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function renderEffectSubCategory(
  title: string,
  stateKey: string,
  effects: EffectDefinition[],
  isExpanded: boolean,
  toggle: (key: string) => void,
  onApply: (def: EffectDefinition) => void,
  onDragStart: (e: React.DragEvent, eff: EffectDefinition) => void,
  onDragEnd: () => void
) {
  if (effects.length === 0) return null

  return (
    <div className="tools-subcategory-block" key={stateKey}>
      <div className="tools-subcategory-header" onClick={() => toggle(stateKey)}>
        <span className="tools-subchevron">{isExpanded ? '▼' : '▶'}</span>
        <span className="tools-subcategory-title">{title}</span>
        <span className="tools-subcategory-count">{effects.length}</span>
      </div>

      {isExpanded && (
        <div className="tools-subcategory-items">
          {effects.map((eff) => (
            <div
              key={eff.id}
              className="tools-card"
              draggable={true}
              onDragStart={(e) => onDragStart(e, eff)}
              onDragEnd={onDragEnd}
              onClick={() => onApply(eff)}
              title={`Click to apply to selected clip, or drag onto any clip on the timeline`}
            >
              <div className="tools-card-preview">
                <EffectGlyph category={eff.category} id={eff.id} />
              </div>
              <div className="tools-card-info">
                <span className="tools-card-title">{eff.name}</span>
                <span className="tools-card-sub">{eff.description}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
