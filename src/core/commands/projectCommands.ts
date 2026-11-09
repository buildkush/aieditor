import { resolveTransitionDrop } from '../timeline/transitionPlacement'
import { captionPropertiesForPreset } from '../captions/captionStyles'
import { alignedTransitionTiming, transitionBeforeCut } from '../timeline/transitionAlignment'
import type { ProjectState } from '../project/projectState'
import type { MediaAsset } from '../media/types'
import {
  isTrackCompatible,
  getItemEffectiveType,
  DEFAULT_TRANSFORM,
  DEFAULT_CROP,
  DEFAULT_AUDIO_PROPERTIES,
  DEFAULT_SPEED_PROPERTIES,
  DEFAULT_SOLID_PROPERTIES,
  DEFAULT_TEXT_PROPERTIES,
  CAPTION_PRESETS,
  type TimelineItem,
  type Track,
  type Transform,
  type Crop,
  type AudioProperties,
  type SpeedProperties,
  type BlendMode,
  type SolidProperties,
  type TextProperties,
  type CaptionProperties,
  type CaptionWord,
  type ItemEffect,
  type TimelineTransition,
} from '../timeline/types'
import { generateId } from '../utils'
import type { Keyframe, KeyframeInterpolation, PropertyKeyframeMap } from '../timeline/keyframeTypes'
import {
  normalizePropertyKey,
  evaluateItemProperty,
  hasKeyframeAtPlayhead,
  isPropertyKeyframed,
} from '../timeline/keyframeEvaluation'
import { generateWordTiming, parseSubtitleContent, type SubtitleCue } from '../subtitles/subtitleParser'

/**
 * Pure state reducer functions for ProjectState manipulation.
 * These uphold the core architecture rule: ProjectState is the single source of truth.
 */

export function getLinkedItemIdsForState(state: ProjectState, itemId: string): string[] {
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
}

/**
 * Removes any transitions attached to the specified clips (or their linked partners).
 * Called whenever a clip is moved, trimmed, deleted, split, or has its speed/timing altered.
 */
export function removeTransitionsForClips(
  state: ProjectState,
  clipIds: Iterable<string>,
  includeLinked = true
): ProjectState {
  if (!state.transitions || Object.keys(state.transitions).length === 0) {
    return state
  }

  const targetClipIds = new Set<string>()
  for (const id of clipIds) {
    if (!id) continue
    targetClipIds.add(id)
    if (includeLinked) {
      for (const lid of getLinkedItemIdsForState(state, id)) {
        targetClipIds.add(lid)
      }
    }
  }

  if (targetClipIds.size === 0) {
    return state
  }

  let hasChanged = false
  const nextTransitions = { ...state.transitions }
  let selectedTransitionId = state.selectedTransitionId

  for (const [trId, tr] of Object.entries(nextTransitions)) {
    if (
      (tr.leftClipId && targetClipIds.has(tr.leftClipId)) ||
      (tr.rightClipId && targetClipIds.has(tr.rightClipId))
    ) {
      delete nextTransitions[trId]
      hasChanged = true
      if (selectedTransitionId === trId) {
        selectedTransitionId = null
      }
    }
  }

  if (!hasChanged) {
    return state
  }

  return {
    ...state,
    transitions: nextTransitions,
    selectedTransitionId,
  }
}

/**
 * Removes any transitions that are no longer valid (e.g. missing clips or orphaned).
 */
export function cleanupInvalidTransitions(state: ProjectState): ProjectState {
  if (!state.transitions || Object.keys(state.transitions).length === 0) {
    return state
  }
  let hasChanged = false
  const nextTransitions = { ...state.transitions }
  let selectedTransitionId = state.selectedTransitionId

  for (const [trId, tr] of Object.entries(nextTransitions)) {
    const hasLeft = tr.leftClipId ? !!state.items[tr.leftClipId] : false
    const hasRight = tr.rightClipId ? !!state.items[tr.rightClipId] : false

    // Must have at least one valid clip attached
    if (!hasLeft && !hasRight) {
      delete nextTransitions[trId]
      hasChanged = true
      if (selectedTransitionId === trId) selectedTransitionId = null
      continue
    }

    // If it was a two-clip transition, both clips must still exist and be on the same track
    if (tr.leftClipId && tr.rightClipId) {
      if (!hasLeft || !hasRight) {
        delete nextTransitions[trId]
        hasChanged = true
        if (selectedTransitionId === trId) selectedTransitionId = null
        continue
      }
      const leftClip = state.items[tr.leftClipId]
      const rightClip = state.items[tr.rightClipId]
      if (leftClip.trackId !== rightClip.trackId) {
        delete nextTransitions[trId]
        hasChanged = true
        if (selectedTransitionId === trId) selectedTransitionId = null
        continue
      }
    }
  }

  if (!hasChanged) return state
  return {
    ...state,
    transitions: nextTransitions,
    selectedTransitionId,
  }
}

export function addMediaAsset(state: ProjectState, asset: MediaAsset): ProjectState {
  return {
    ...state,
    assets: {
      ...state.assets,
      [asset.id]: asset,
    },
  }
}

export function removeMediaAsset(state: ProjectState, assetId: string): ProjectState {
  const nextAssets = { ...state.assets }
  delete nextAssets[assetId]

  // Clean up any timeline items that reference this asset and track affected layers
  const affectedTrackIds = new Set<string>()
  const removedItemIds = new Set<string>()
  const nextItems: Record<string, TimelineItem> = {}
  for (const [id, item] of Object.entries(state.items)) {
    if (item.assetId === assetId) {
      affectedTrackIds.add(item.trackId)
      removedItemIds.add(id)
    } else {
      nextItems[id] = item
    }
  }

  const stateWithoutTransitions = removeTransitionsForClips(state, removedItemIds, true)
  const selectedItemId = stateWithoutTransitions.selectedItemId && nextItems[stateWithoutTransitions.selectedItemId]
    ? stateWithoutTransitions.selectedItemId
    : null

  let nextState: ProjectState = {
    ...stateWithoutTransitions,
    assets: nextAssets,
    items: nextItems,
    selectedItemId,
  }

  // Targeted check: check only the affected tracks
  for (const trackId of affectedTrackIds) {
    nextState = cleanupTrackIfEmpty(nextState, trackId)
  }

  return nextState
}

/**
 * Targeted check for an affected track:
 * Checks if the specific affected track has any items left.
 * If empty and NOT the base layer (first layer), removes it and normalizes display names.
 *
 * Rules:
 * 1. Base video track (track-v1 / first layer) is NEVER removed, even if completely empty.
 * 2. Base audio track (track-a1 / first layer) is NEVER removed, even if completely empty.
 * 3. Any secondary track that becomes empty is removed.
 * 4. Display names of remaining tracks of that type are normalized sequentially.
 */
export function normalizeTrackNames(tracks: Track[]): Track[] {
  const videoTracks = tracks.filter((t) => t.type === 'video')
  const audioTracks = tracks.filter((t) => t.type === 'audio')
  const captionTracks = tracks.filter((t) => t.type === 'caption')
  const graphicsTracks = tracks.filter((t) => t.type === 'graphics')

  const videoCount = videoTracks.length
  const videoNames = new Map<string, string>()
  videoTracks.forEach((vt, index) => {
    const layerNum = videoCount - index
    if (!vt.name || /^Video\s*\d*$/i.test(vt.name)) {
      videoNames.set(vt.id, `Video ${layerNum}`)
    }
  })

  const audioNames = new Map<string, string>()
  audioTracks.forEach((at, index) => {
    if (!at.name || /^Audio\s*\d*$/i.test(at.name)) {
      audioNames.set(at.id, `Audio ${index + 1}`)
    }
  })

  const captionCount = captionTracks.length
  const captionNames = new Map<string, string>()
  captionTracks.forEach((ct, index) => {
    const layerNum = captionCount - index
    if (!ct.name || /^Caption\s*\d*$/i.test(ct.name)) {
      captionNames.set(ct.id, `Caption ${layerNum}`)
    }
  })

  const graphicsNames = new Map<string, string>()
  graphicsTracks.forEach((gt, index) => {
    if (!gt.name || /^Graphics\s*\d*$/i.test(gt.name)) {
      graphicsNames.set(gt.id, `Graphics ${index + 1}`)
    }
  })

  return tracks.map((t) => {
    const newName =
      videoNames.get(t.id) ??
      audioNames.get(t.id) ??
      captionNames.get(t.id) ??
      graphicsNames.get(t.id) ??
      t.name
    if (newName !== t.name) {
      return { ...t, name: newName }
    }
    return t
  })
}

/**
 * Empty track cleanup handler.
 * Preserves tracks during normal editing operations (tracks stay until explicitly deleted),
 * unless cleanupEmptyTracks is explicitly invoked.
 */
export function cleanupTrackIfEmpty(state: ProjectState, _trackId: string): ProjectState {
  // No auto-deleting on empty: once created, tracks stay on the timeline until explicitly deleted
  return state
}

/**
 * Removes secondary tracks that are completely empty across the entire project state.
 * Preserves the base layer for each track type.
 */
export function cleanupEmptyTracks(state: ProjectState): ProjectState {
  const videoTracks = state.tracks.filter((t) => t.type === 'video')
  const audioTracks = state.tracks.filter((t) => t.type === 'audio')
  const activeTrackIds = new Set(Object.values(state.items).map((it) => it.trackId))

  // Preserves base layer for video (bottom) and audio (top)
  const baseVideoId = videoTracks.length > 0 ? videoTracks[videoTracks.length - 1].id : null
  const baseAudioId = audioTracks.length > 0 ? audioTracks[0].id : null

  const nextTracks = state.tracks.filter((t) => {
    if (t.id === baseVideoId || t.id === baseAudioId) return true
    return activeTrackIds.has(t.id)
  })

  if (nextTracks.length === state.tracks.length) {
    return state
  }

  return {
    ...state,
    tracks: normalizeTrackNames(nextTracks),
  }
}

export function addTrack(state: ProjectState, track: Track): ProjectState {
  return {
    ...state,
    tracks: [...state.tracks, track],
  }
}

export function removeTrack(state: ProjectState, trackId: string): ProjectState {
  const target = state.tracks.find((t) => t.id === trackId)
  if (!target) return state

  const nextTracks = normalizeTrackNames(state.tracks.filter((t) => t.id !== trackId))

  // Remove items residing on the removed track
  const nextItems: Record<string, TimelineItem> = {}
  const removedItemIds = new Set<string>()
  for (const [id, item] of Object.entries(state.items)) {
    if (item.trackId !== trackId) {
      nextItems[id] = item
    } else {
      removedItemIds.add(id)
    }
  }

  // Clear linked partner references pointing to removed items
  for (const [id, item] of Object.entries(nextItems)) {
    if (item.linkedItemId && removedItemIds.has(item.linkedItemId)) {
      const copy = { ...item }
      delete copy.linkedItemId
      nextItems[id] = copy
    }
  }

  const removedTransitionsState = removeTransitionsForClips(state, removedItemIds, true)
  const nextTransitions = { ...(removedTransitionsState.transitions || {}) }
  let selectedTransitionId = removedTransitionsState.selectedTransitionId
  for (const [trId, tr] of Object.entries(nextTransitions)) {
    if (tr.trackId === trackId) {
      delete nextTransitions[trId]
      if (selectedTransitionId === trId) selectedTransitionId = null
    }
  }

  const selectedItemId = state.selectedItemId && nextItems[state.selectedItemId] ? state.selectedItemId : null
  const selectedItemIds = (state.selectedItemIds ?? []).filter((id) => !!nextItems[id])

  return {
    ...removedTransitionsState,
    tracks: nextTracks,
    items: nextItems,
    transitions: nextTransitions,
    selectedTransitionId,
    selectedItemId,
    selectedItemIds,
  }
}

export function resolveTrackOrNew(
  tracks: Track[],
  targetTrackId: string,
  assetType?: string,
  streamType?: string
): { nextTracks: Track[]; resolvedTrackId: string | null } {
  const effectiveType = (assetType === 'caption' || streamType === 'caption') ? 'caption' : (streamType || assetType)
  const existingTrack = tracks.find((t) => t.id === targetTrackId)
  if (existingTrack) {
    if (effectiveType && !isTrackCompatible(existingTrack.type, assetType, streamType)) {
      return { nextTracks: tracks, resolvedTrackId: null }
    }
    return { nextTracks: tracks, resolvedTrackId: existingTrack.id }
  }

  // Handle new track creation
  const nextTracks = [...tracks]
  if (
    targetTrackId === 'NEW_VIDEO_TRACK' ||
    targetTrackId.startsWith('new-video') ||
    targetTrackId.startsWith('track-v')
  ) {
    if (effectiveType && !isTrackCompatible('video', assetType, streamType)) {
      return { nextTracks: tracks, resolvedTrackId: null }
    }
    const vTracks = tracks.filter((t) => t.type === 'video')
    let maxNum = 0
    for (const t of tracks) {
      const match = t.id.match(/^track-v(\d+)$/)
      if (match) {
        const num = parseInt(match[1], 10)
        if (num > maxNum) maxNum = num
      }
    }
    const nextNum = maxNum + 1
    const nextIndex = vTracks.length + 1
    const createdTrackId = targetTrackId.startsWith('track-v') ? targetTrackId : `track-v${nextNum}`
    const createdTrack: Track = {
      id: createdTrackId,
      name: `Video ${nextIndex}`,
      type: 'video',
      visible: true,
      locked: false,
    }
    let firstVideoIndex = tracks.findIndex((t) => t.type === 'video')
    if (firstVideoIndex < 0) firstVideoIndex = 0
    nextTracks.splice(firstVideoIndex, 0, createdTrack)
    return { nextTracks, resolvedTrackId: createdTrack.id }
  }

  if (
    targetTrackId === 'NEW_AUDIO_TRACK' ||
    targetTrackId.startsWith('new-audio') ||
    targetTrackId.startsWith('track-a')
  ) {
    if (effectiveType && !isTrackCompatible('audio', assetType, streamType)) {
      return { nextTracks: tracks, resolvedTrackId: null }
    }
    const aTracks = tracks.filter((t) => t.type === 'audio')
    let maxNum = 0
    for (const t of tracks) {
      const match = t.id.match(/^track-a(\d+)$/)
      if (match) {
        const num = parseInt(match[1], 10)
        if (num > maxNum) maxNum = num
      }
    }
    const nextNum = maxNum + 1
    const nextIndex = aTracks.length + 1
    const createdTrackId = targetTrackId.startsWith('track-a') ? targetTrackId : `track-a${nextNum}`
    const createdTrack: Track = {
      id: createdTrackId,
      name: `Audio ${nextIndex}`,
      type: 'audio',
      muted: false,
      locked: false,
    }
    nextTracks.push(createdTrack)
    return { nextTracks, resolvedTrackId: createdTrack.id }
  }

  if (
    targetTrackId === 'NEW_CAPTION_TRACK' ||
    targetTrackId.startsWith('new-caption') ||
    targetTrackId.startsWith('track-c')
  ) {
    if (assetType && !isTrackCompatible('caption', assetType)) {
      return { nextTracks: tracks, resolvedTrackId: null }
    }
    let maxNum = 0
    for (const t of tracks) {
      const match = t.id.match(/^track-c(\d+)$/)
      if (match) {
        const num = parseInt(match[1], 10)
        if (num > maxNum) maxNum = num
      }
    }
    const nextNum = maxNum + 1
    const createdTrackId = targetTrackId.startsWith('track-c') ? targetTrackId : `track-c${nextNum}`
    const createdTrack: Track = {
      id: createdTrackId,
      name: `Caption ${tracks.filter((t) => t.type === 'caption').length + 1}`,
      type: 'caption',
      visible: true,
      locked: false,
    }
    // Caption tracks are positioned at the very top of the timeline
    nextTracks.unshift(createdTrack)
    return { nextTracks, resolvedTrackId: createdTrack.id }
  }

  if (
    targetTrackId === 'NEW_GRAPHICS_TRACK' ||
    targetTrackId.startsWith('new-graphics') ||
    targetTrackId.startsWith('track-g')
  ) {
    if (assetType && !isTrackCompatible('graphics', assetType)) {
      return { nextTracks: tracks, resolvedTrackId: null }
    }
    let maxNum = 0
    for (const t of tracks) {
      const match = t.id.match(/^track-g(\d+)$/)
      if (match) {
        const num = parseInt(match[1], 10)
        if (num > maxNum) maxNum = num
      }
    }
    const nextNum = maxNum + 1
    const createdTrackId = targetTrackId.startsWith('track-g') ? targetTrackId : `track-g${nextNum}`
    const createdTrack: Track = {
      id: createdTrackId,
      name: `Graphics ${tracks.filter((t) => t.type === 'graphics').length + 1}`,
      type: 'graphics',
      visible: true,
      locked: false,
    }
    nextTracks.push(createdTrack)
    return { nextTracks, resolvedTrackId: createdTrack.id }
  }

  return { nextTracks: tracks, resolvedTrackId: null }
}

export function addTimelineItem(state: ProjectState, item: TimelineItem): ProjectState {
  const asset = state.assets[item.assetId]
  const effectiveType = getItemEffectiveType(item, asset)
  const { nextTracks, resolvedTrackId } = resolveTrackOrNew(
    state.tracks,
    item.trackId,
    effectiveType,
    effectiveType === 'caption' ? 'caption' : item.streamType
  )
  if (!resolvedTrackId) {
    return state // Incompatible track or track does not exist
  }

  const updatedItem: TimelineItem = {
    ...item,
    trackId: resolvedTrackId,
  }

  const nextState: ProjectState = {
    ...state,
    tracks: nextTracks,
    items: {
      ...state.items,
      [updatedItem.id]: updatedItem,
    },
  }

  return resolveTrackOverwrites(nextState, updatedItem.id)
}

export function removeTimelineItem(state: ProjectState, itemId: string): ProjectState {
  const existing = state.items[itemId]
  if (!existing) {
    return state
  }

  const affectedTrackId = existing.trackId
  // Remove transitions for this clip and any linked partners
  const stateWithoutTransitions = removeTransitionsForClips(state, [itemId], true)

  const nextItems = { ...stateWithoutTransitions.items }
  delete nextItems[itemId]

  const nextState: ProjectState = {
    ...stateWithoutTransitions,
    items: nextItems,
    selectedItemId: stateWithoutTransitions.selectedItemId === itemId ? null : stateWithoutTransitions.selectedItemId,
  }

  // Targeted check: check only whether the affected track became empty
  return cleanupTrackIfEmpty(nextState, affectedTrackId)
}

export function updateTimelineItem(
  state: ProjectState,
  itemId: string,
  updates: Partial<Omit<TimelineItem, 'id'>>
): ProjectState {
  const existing = state.items[itemId]
  if (!existing) {
    return state
  }

  const timingChanged =
    (updates.startTime !== undefined && updates.startTime !== existing.startTime) ||
    (updates.duration !== undefined && updates.duration !== existing.duration) ||
    (updates.sourceIn !== undefined && updates.sourceIn !== existing.sourceIn) ||
    (updates.sourceOut !== undefined && updates.sourceOut !== existing.sourceOut) ||
    (updates.trackId !== undefined && updates.trackId !== existing.trackId) ||
    updates.speed !== undefined

  const baseState = timingChanged ? removeTransitionsForClips(state, [itemId], true) : state

  return {
    ...baseState,
    items: {
      ...baseState.items,
      [itemId]: {
        ...existing,
        ...updates,
        transform: updates.transform
          ? {
              ...existing.transform,
              ...updates.transform,
            }
          : existing.transform,
        crop: updates.crop
          ? {
              ...(existing.crop ?? DEFAULT_CROP),
              ...updates.crop,
            }
          : existing.crop,
        audio: updates.audio
          ? {
              ...(existing.audio ?? DEFAULT_AUDIO_PROPERTIES),
              ...updates.audio,
            }
          : existing.audio,
        speed: updates.speed
          ? {
              ...(existing.speed ?? DEFAULT_SPEED_PROPERTIES),
              ...updates.speed,
            }
          : existing.speed,
        keyframeEnabled: updates.keyframeEnabled
          ? {
              ...(existing.keyframeEnabled ?? {}),
              ...updates.keyframeEnabled,
            }
          : existing.keyframeEnabled,
      },
    },
  }
}

export function updateItemTransform(
  state: ProjectState,
  itemId: string,
  transformUpdates: Partial<Transform>
): ProjectState {
  const existing = state.items[itemId]
  if (!existing) return state

  const prev = existing.transform || DEFAULT_TRANSFORM
  let nextScale = transformUpdates.scale !== undefined ? transformUpdates.scale : prev.scale
  if (typeof nextScale === 'number' && Number.isFinite(nextScale)) {
    nextScale = Math.max(0.05, Math.min(20, nextScale))
  } else {
    nextScale = prev.scale
  }

  let nextScaleX = transformUpdates.scaleX !== undefined ? transformUpdates.scaleX : (prev.scaleX ?? nextScale)
  if (typeof nextScaleX === 'number' && Number.isFinite(nextScaleX)) {
    nextScaleX = Math.max(0.05, Math.min(20, nextScaleX))
  }

  let nextScaleY = transformUpdates.scaleY !== undefined ? transformUpdates.scaleY : (prev.scaleY ?? nextScale)
  if (typeof nextScaleY === 'number' && Number.isFinite(nextScaleY)) {
    nextScaleY = Math.max(0.05, Math.min(20, nextScaleY))
  }

  let nextOpacity = transformUpdates.opacity !== undefined ? transformUpdates.opacity : prev.opacity
  if (typeof nextOpacity === 'number' && Number.isFinite(nextOpacity)) {
    nextOpacity = Math.max(0, Math.min(1, nextOpacity))
  } else {
    nextOpacity = prev.opacity
  }

  let nextRotation = transformUpdates.rotation !== undefined ? transformUpdates.rotation : prev.rotation
  if (typeof nextRotation === 'number' && Number.isFinite(nextRotation)) {
    nextRotation = Math.round(nextRotation * 1000) / 1000
  } else {
    nextRotation = prev.rotation
  }

  const nextTransform: Transform = {
    x: transformUpdates.x !== undefined ? Math.round(transformUpdates.x * 1000) / 1000 : prev.x,
    y: transformUpdates.y !== undefined ? Math.round(transformUpdates.y * 1000) / 1000 : prev.y,
    scale: Math.round(nextScale * 1000) / 1000,
    rotation: nextRotation,
    opacity: Math.round(nextOpacity * 100) / 100,
  }

  if (transformUpdates.scaleX !== undefined || prev.scaleX !== undefined) {
    nextTransform.scaleX = nextScaleX !== undefined ? Math.round(nextScaleX * 1000) / 1000 : undefined
  }
  if (transformUpdates.scaleY !== undefined || prev.scaleY !== undefined) {
    nextTransform.scaleY = nextScaleY !== undefined ? Math.round(nextScaleY * 1000) / 1000 : undefined
  }
  if (transformUpdates.anchorX !== undefined || prev.anchorX !== undefined) {
    nextTransform.anchorX = transformUpdates.anchorX !== undefined ? Math.round(transformUpdates.anchorX * 1000) / 1000 : prev.anchorX
  }
  if (transformUpdates.anchorY !== undefined || prev.anchorY !== undefined) {
    nextTransform.anchorY = transformUpdates.anchorY !== undefined ? Math.round(transformUpdates.anchorY * 1000) / 1000 : prev.anchorY
  }
  if (transformUpdates.pitch !== undefined || prev.pitch !== undefined) {
    nextTransform.pitch = transformUpdates.pitch !== undefined ? Math.round(transformUpdates.pitch * 1000) / 1000 : prev.pitch
  }
  if (transformUpdates.yaw !== undefined || prev.yaw !== undefined) {
    nextTransform.yaw = transformUpdates.yaw !== undefined ? Math.round(transformUpdates.yaw * 1000) / 1000 : prev.yaw
  }
  if (transformUpdates.flipH !== undefined || prev.flipH !== undefined) {
    nextTransform.flipH = transformUpdates.flipH !== undefined ? !!transformUpdates.flipH : prev.flipH
  }
  if (transformUpdates.flipV !== undefined || prev.flipV !== undefined) {
    nextTransform.flipV = transformUpdates.flipV !== undefined ? !!transformUpdates.flipV : prev.flipV
  }
  if (transformUpdates.blendMode !== undefined || prev.blendMode !== undefined) {
    nextTransform.blendMode = transformUpdates.blendMode !== undefined ? transformUpdates.blendMode : prev.blendMode
  }

  return {
    ...state,
    items: {
      ...state.items,
      [itemId]: {
        ...existing,
        transform: nextTransform,
      },
    },
  }
}

/** Apply a live transform atomically, writing animated properties at the playhead. */
export function updateItemTransformAtPlayhead(
  state: ProjectState,
  itemId: string,
  time: number,
  updates: Partial<Transform>,
): ProjectState {
  const item = state.items[itemId]
  if (!item) return state
  let next = state
  const staticUpdates: Partial<Transform> = {}
  for (const [key, value] of Object.entries(updates)) {
    const axis = key === 'scaleX' || key === 'scaleY'
    const inheritsScale = axis && isPropertyKeyframed(item, 'scale')
    const animatedPosition = (key === 'x' || key === 'y') && isPropertyKeyframed(item, 'position')
    if (typeof value === 'number' && (isPropertyKeyframed(item, key) || inheritsScale || animatedPosition)) {
      // An axis may inherit the uniform zoom animation. Preserve its other
      // keyframes before introducing an independently edited axis value.
      if (inheritsScale && !item.keyframes?.[key]?.length) {
        for (const kf of item.keyframes?.scale ?? item.keyframes?.zoom ?? []) {
          next = addKeyframe(next, itemId, key, kf.time, kf.value, kf.interpolation)
        }
      }
      next = setKeyframeValue(next, itemId, key, time, value)
    } else {
      Object.assign(staticUpdates, { [key]: value })
    }
  }
  return Object.keys(staticUpdates).length ? updateItemTransform(next, itemId, staticUpdates) : next
}

export function resetItemTransform(state: ProjectState, itemId: string): ProjectState {
  const existing = state.items[itemId]
  if (!existing) return state
  return {
    ...state,
    items: {
      ...state.items,
      [itemId]: {
        ...existing,
        transform: { ...DEFAULT_TRANSFORM },
      },
    },
  }
}

export function fitItemToCanvas(state: ProjectState, itemId: string): ProjectState {
  const existing = state.items[itemId]
  if (!existing) return state
  const asset = state.assets[existing.assetId]
  const projWidth = state.settings.width || 1920
  const projHeight = state.settings.height || 1080
  const assetWidth = asset?.metadata?.width || projWidth
  const assetHeight = asset?.metadata?.height || projHeight

  const scale = Math.min(projWidth / assetWidth, projHeight / assetHeight)
  return updateItemTransform(state, itemId, {
    x: 0,
    y: 0,
    scale: Math.round(scale * 1000) / 1000,
    rotation: 0,
  })
}

export function fillItemCanvas(state: ProjectState, itemId: string): ProjectState {
  const existing = state.items[itemId]
  if (!existing) return state
  const asset = state.assets[existing.assetId]
  const projWidth = state.settings.width || 1920
  const projHeight = state.settings.height || 1080
  const assetWidth = asset?.metadata?.width || projWidth
  const assetHeight = asset?.metadata?.height || projHeight

  const scale = Math.max(projWidth / assetWidth, projHeight / assetHeight)
  return updateItemTransform(state, itemId, {
    x: 0,
    y: 0,
    scale: Math.round(scale * 1000) / 1000,
    rotation: 0,
  })
}

export function updateItemCrop(
  state: ProjectState,
  itemId: string,
  cropUpdates: Partial<Crop>
): ProjectState {
  const existing = state.items[itemId]
  if (!existing) return state
  const prevCrop = existing.crop || DEFAULT_CROP

  let left = cropUpdates.left !== undefined ? Math.max(0, Math.min(100, cropUpdates.left)) : prevCrop.left
  let right = cropUpdates.right !== undefined ? Math.max(0, Math.min(100, cropUpdates.right)) : prevCrop.right
  let top = cropUpdates.top !== undefined ? Math.max(0, Math.min(100, cropUpdates.top)) : prevCrop.top
  let bottom = cropUpdates.bottom !== undefined ? Math.max(0, Math.min(100, cropUpdates.bottom)) : prevCrop.bottom

  // Clamp sum so edges do not cross completely
  if (left + right > 99.9) {
    const excess = left + right - 99.9
    if (cropUpdates.left !== undefined) {
      left = Math.max(0, left - excess)
    } else {
      right = Math.max(0, right - excess)
    }
  }
  if (top + bottom > 99.9) {
    const excess = top + bottom - 99.9
    if (cropUpdates.top !== undefined) {
      top = Math.max(0, top - excess)
    } else {
      bottom = Math.max(0, bottom - excess)
    }
  }

  const nextCrop: Crop = {
    left: Math.round(left * 10) / 10,
    right: Math.round(right * 10) / 10,
    top: Math.round(top * 10) / 10,
    bottom: Math.round(bottom * 10) / 10,
  }

  return {
    ...state,
    items: {
      ...state.items,
      [itemId]: {
        ...existing,
        crop: nextCrop,
      },
    },
  }
}

export function resetItemCrop(state: ProjectState, itemId: string): ProjectState {
  const existing = state.items[itemId]
  if (!existing) return state
  return {
    ...state,
    items: {
      ...state.items,
      [itemId]: {
        ...existing,
        crop: { ...DEFAULT_CROP },
      },
    },
  }
}

export function updateItemAudio(
  state: ProjectState,
  itemId: string,
  audioUpdates: Partial<AudioProperties>
): ProjectState {
  const existing = state.items[itemId]
  if (!existing) return state

  const prev = existing.audio || DEFAULT_AUDIO_PROPERTIES
  let vol = audioUpdates.volume !== undefined ? Math.max(0, Math.min(4, audioUpdates.volume)) : prev.volume
  let pan = audioUpdates.pan !== undefined ? Math.max(-1, Math.min(1, audioUpdates.pan)) : prev.pan
  let muted = audioUpdates.muted !== undefined ? !!audioUpdates.muted : (prev.muted ?? false)

  return {
    ...state,
    items: {
      ...state.items,
      [itemId]: {
        ...existing,
        audio: {
          volume: Math.round(vol * 1000) / 1000,
          pan: Math.round(pan * 1000) / 1000,
          muted,
        },
      },
    },
  }
}

export function resetItemAudio(state: ProjectState, itemId: string): ProjectState {
  const existing = state.items[itemId]
  if (!existing) return state
  return {
    ...state,
    items: {
      ...state.items,
      [itemId]: {
        ...existing,
        audio: { ...DEFAULT_AUDIO_PROPERTIES },
      },
    },
  }
}

export function updateItemSpeed(
  state: ProjectState,
  itemId: string,
  speedUpdates: Partial<SpeedProperties>
): ProjectState {
  const existing = state.items[itemId]
  if (!existing) return state

  // Altering speed changes clip duration and timeline positioning -> remove transitions
  state = removeTransitionsForClips(state, [itemId], true)

  const projectFps = state.settings?.fps > 0 ? state.settings.fps : 30
  const prev = existing.speed || DEFAULT_SPEED_PROPERTIES

  let reversed = speedUpdates.reversed !== undefined ? !!speedUpdates.reversed : (prev.reversed ?? false)

  let speed: number
  if (speedUpdates.speed !== undefined) {
    speed = Math.max(0.01, Math.min(100, Math.abs(speedUpdates.speed)))
  } else if (speedUpdates.fps !== undefined) {
    speed = Math.max(0.01, Math.min(100, Math.abs(speedUpdates.fps) / projectFps))
    if (speedUpdates.reversed === undefined) {
      reversed = speedUpdates.fps < 0
    }
  } else {
    speed = prev.speed
  }

  let fps: number
  if (speedUpdates.fps !== undefined) {
    fps = (reversed ? -1 : 1) * Math.abs(speedUpdates.fps)
  } else {
    fps = (reversed ? -1 : 1) * (Math.round(speed * projectFps * 1000) / 1000)
  }

  const roundedSpeed = Math.round(speed * 1000) / 1000

  // Calculate new timeline duration based on source length and speed:
  // Duration on timeline = (sourceOut - sourceIn) / speed
  const rawSourceSpan = Math.max(0.01, existing.sourceOut - existing.sourceIn)
  const newDuration = Math.max(0.01, Math.round((rawSourceSpan / roundedSpeed) * 1000) / 1000)

  const updatedItems: Record<string, TimelineItem> = {
    ...state.items,
    [itemId]: {
      ...existing,
      duration: newDuration,
      speed: {
        speed: roundedSpeed,
        reversed,
        fps,
      },
    },
  }

  // If this item is linked to another item (e.g. video + audio pair), keep the partner in sync
  if (existing.linkedItemId && state.items[existing.linkedItemId]) {
    const partner = state.items[existing.linkedItemId]
    const partnerSourceSpan = Math.max(0.01, partner.sourceOut - partner.sourceIn)
    const partnerDuration = Math.max(0.01, Math.round((partnerSourceSpan / roundedSpeed) * 1000) / 1000)
    updatedItems[existing.linkedItemId] = {
      ...partner,
      duration: partnerDuration,
      speed: {
        speed: roundedSpeed,
        reversed,
        fps,
      },
    }
  }

  let nextState: ProjectState = {
    ...state,
    items: updatedItems,
  }

  nextState = resolveTrackOverwrites(nextState, itemId)
  if (existing.linkedItemId && state.items[existing.linkedItemId]) {
    nextState = resolveTrackOverwrites(nextState, existing.linkedItemId)
  }

  return nextState
}

export function resetItemSpeed(state: ProjectState, itemId: string): ProjectState {
  const existing = state.items[itemId]
  if (!existing) return state

  // Resetting speed changes clip duration and timeline positioning -> remove transitions
  state = removeTransitionsForClips(state, [itemId], true)

  const projectFps = state.settings?.fps > 0 ? state.settings.fps : 30
  const defaultDuration = Math.max(0.01, Math.round((existing.sourceOut - existing.sourceIn) * 1000) / 1000)
  const defaultSpeed: SpeedProperties = {
    ...DEFAULT_SPEED_PROPERTIES,
    fps: projectFps,
  }

  const updatedItems: Record<string, TimelineItem> = {
    ...state.items,
    [itemId]: {
      ...existing,
      duration: defaultDuration,
      speed: defaultSpeed,
    },
  }

  if (existing.linkedItemId && state.items[existing.linkedItemId]) {
    const partner = state.items[existing.linkedItemId]
    const partnerDefaultDuration = Math.max(0.01, Math.round((partner.sourceOut - partner.sourceIn) * 1000) / 1000)
    updatedItems[existing.linkedItemId] = {
      ...partner,
      duration: partnerDefaultDuration,
      speed: defaultSpeed,
    }
  }

  let nextState: ProjectState = {
    ...state,
    items: updatedItems,
  }

  nextState = resolveTrackOverwrites(nextState, itemId)
  if (existing.linkedItemId && state.items[existing.linkedItemId]) {
    nextState = resolveTrackOverwrites(nextState, existing.linkedItemId)
  }

  return nextState
}

export function addKeyframe(
  state: ProjectState,
  itemId: string,
  property: string,
  time: number,
  value: number,
  interpolation?: KeyframeInterpolation
): ProjectState {
  const existing = state.items[itemId]
  if (!existing) return state

  const safeFps = state.settings?.fps > 0 ? state.settings.fps : 30
  const frameTime = Math.round(time * safeFps) / safeFps
  const roundedTime = Math.round(frameTime * 10000) / 10000

  const normKey = normalizePropertyKey(property)
  const existingMap = existing.keyframes ?? {}
  const list = [...(existingMap[normKey] ?? [])]

  const existingIdx = list.findIndex((kf) => {
    const kfFrame = Math.round(kf.time * safeFps)
    const targetFrame = Math.round(roundedTime * safeFps)
    return kfFrame === targetFrame || Math.abs(kf.time - roundedTime) < (0.45 / safeFps)
  })

  if (existingIdx >= 0) {
    list[existingIdx] = {
      ...list[existingIdx],
      time: roundedTime,
      value: Math.round(value * 10000) / 10000,
      interpolation: interpolation ?? list[existingIdx].interpolation ?? 'linear',
    }
  } else {
    list.push({
      id: generateId('kf'),
      time: roundedTime,
      value: Math.round(value * 10000) / 10000,
      interpolation: interpolation ?? 'linear',
    })
  }

  list.sort((a, b) => a.time - b.time)

  return {
    ...state,
    items: {
      ...state.items,
      [itemId]: {
        ...existing,
        keyframes: {
          ...existingMap,
          [normKey]: list,
        },
        keyframeEnabled: {
          ...(existing.keyframeEnabled ?? {}),
          [normKey]: true,
          [property]: true,
        },
      },
    },
  }
}

export function removeKeyframe(
  state: ProjectState,
  itemId: string,
  property: string,
  keyframeIdOrTime: string | number
): ProjectState {
  const existing = state.items[itemId]
  if (!existing || !existing.keyframes) return state

  const normKey = normalizePropertyKey(property)
  const list = (existing.keyframes[normKey] || existing.keyframes[property]) as Keyframe<number>[] | undefined
  if (!list || list.length === 0) return state

  let nextList: Keyframe<number>[]
  if (typeof keyframeIdOrTime === 'string') {
    nextList = list.filter((kf: Keyframe<number>) => kf.id !== keyframeIdOrTime)
  } else {
    const safeFps = state.settings?.fps > 0 ? state.settings.fps : 30
    const frameTime = Math.round(keyframeIdOrTime * safeFps) / safeFps
    const targetFrame = Math.round(frameTime * safeFps)
    nextList = list.filter((kf: Keyframe<number>) => {
      const kfFrame = Math.round(kf.time * safeFps)
      return kfFrame !== targetFrame && Math.abs(kf.time - frameTime) >= (0.45 / safeFps)
    })
  }

  const nextKeyframes: PropertyKeyframeMap = { ...existing.keyframes }
  const nextEnabled = { ...(existing.keyframeEnabled ?? {}) }

  if (nextList.length === 0) {
    delete nextKeyframes[normKey]
    delete nextKeyframes[property]
    nextEnabled[normKey] = false
    nextEnabled[property] = false
  } else {
    nextKeyframes[normKey] = nextList
    if (property !== normKey) {
      delete nextKeyframes[property]
    }
  }

  return {
    ...state,
    items: {
      ...state.items,
      [itemId]: {
        ...existing,
        keyframes: nextKeyframes,
        keyframeEnabled: nextEnabled,
      },
    },
  }
}

export function updateKeyframe(
  state: ProjectState,
  itemId: string,
  property: string,
  keyframeId: string,
  updates: Partial<Keyframe<number>>
): ProjectState {
  const existing = state.items[itemId]
  if (!existing || !existing.keyframes) return state

  const normKey = normalizePropertyKey(property)
  const list = (existing.keyframes[normKey] || existing.keyframes[property]) as Keyframe<number>[] | undefined
  if (!list) return state

  const idx = list.findIndex((kf: Keyframe<number>) => kf.id === keyframeId)
  if (idx < 0) return state

  const nextList = [...list]
  nextList[idx] = {
    ...nextList[idx],
    ...updates,
    time: updates.time !== undefined ? Math.round(updates.time * 10000) / 10000 : nextList[idx].time,
  }
  nextList.sort((a, b) => a.time - b.time)

  return {
    ...state,
    items: {
      ...state.items,
      [itemId]: {
        ...existing,
        keyframes: {
          ...existing.keyframes,
          [normKey]: nextList,
        },
      },
    },
  }
}

export function setKeyframeValue(
  state: ProjectState,
  itemId: string,
  property: string,
  time: number,
  value: number
): ProjectState {
  return addKeyframe(state, itemId, property, time, value)
}

export function toggleKeyframeAtPlayhead(
  state: ProjectState,
  itemId: string,
  property: string,
  playheadTime: number
): ProjectState {
  const existing = state.items[itemId]
  if (!existing) return state

  const safeFps = state.settings?.fps > 0 ? state.settings.fps : 30
  const frameTime = Math.round(playheadTime * safeFps) / safeFps

  const compositeMap: Record<string, string[]> = {
    position: ['x', 'y'],
    zoom: ['scale', 'scaleX', 'scaleY'],
    anchor: ['anchorX', 'anchorY'],
    crop: ['cropLeft', 'cropRight', 'cropTop', 'cropBottom'],
  }

  const norm = normalizePropertyKey(property)
  const propertiesToToggle = compositeMap[norm] || compositeMap[property.toLowerCase()] || [norm]

  // Check if ANY of the properties currently has a keyframe at frameTime
  const hasAnyAtPlayhead = propertiesToToggle.some((p) =>
    hasKeyframeAtPlayhead(existing, p, frameTime, 0.005, safeFps)
  )

  let currentState = state
  if (hasAnyAtPlayhead) {
    // Remove keyframe at playhead for all target properties
    for (const p of propertiesToToggle) {
      currentState = removeKeyframe(currentState, itemId, p, frameTime)
    }
  } else {
    // Add keyframe at playhead for all target properties using current evaluated value at exact frame time
    for (const p of propertiesToToggle) {
      const val = evaluateItemProperty(existing, p, frameTime)
      currentState = addKeyframe(currentState, itemId, p, frameTime, val)
    }
  }

  return currentState
}

export function moveKeyframe(
  state: ProjectState,
  itemId: string,
  property: string,
  keyframeId: string,
  newTime: number
): ProjectState {
  return updateKeyframe(state, itemId, property, keyframeId, { time: newTime })
}

export function setKeyframeInterpolation(
  state: ProjectState,
  itemId: string,
  property: string,
  keyframeId: string,
  interpolation: KeyframeInterpolation
): ProjectState {
  return updateKeyframe(state, itemId, property, keyframeId, { interpolation })
}

export function toggleItemKeyframe(
  state: ProjectState,
  itemId: string,
  key: string,
  enabled?: boolean
): ProjectState {
  const existing = state.items[itemId]
  if (!existing) return state
  const prevKeyframes = existing.keyframeEnabled || {}
  const nextVal = enabled !== undefined ? enabled : !prevKeyframes[key]

  const normKey = normalizePropertyKey(key)
  let nextState: ProjectState = {
    ...state,
    items: {
      ...state.items,
      [itemId]: {
        ...existing,
        keyframeEnabled: {
          ...prevKeyframes,
          [key]: nextVal,
          [normKey]: nextVal,
        },
      },
    },
  }

  // If enabling keyframing and no keyframes exist on this property yet, add initial keyframe at current playhead
  if (nextVal) {
    const hasKf = (existing.keyframes?.[normKey]?.length ?? 0) > 0
    if (!hasKf) {
      const val = evaluateItemProperty(existing, normKey, state.playheadTime)
      nextState = addKeyframe(nextState, itemId, normKey, state.playheadTime, val)
    }
  }

  return nextState
}

export function toggleAllItemKeyframes(
  state: ProjectState,
  itemId: string,
  keys: string[],
  enabled: boolean
): ProjectState {
  const existing = state.items[itemId]
  if (!existing) return state
  const prevKeyframes = { ...(existing.keyframeEnabled || {}) }
  for (const k of keys) {
    prevKeyframes[k] = enabled
    prevKeyframes[normalizePropertyKey(k)] = enabled
  }

  let nextState: ProjectState = {
    ...state,
    items: {
      ...state.items,
      [itemId]: {
        ...existing,
        keyframeEnabled: prevKeyframes,
      },
    },
  }

  if (enabled) {
    for (const k of keys) {
      const normKey = normalizePropertyKey(k)
      const hasKf = (existing.keyframes?.[normKey]?.length ?? 0) > 0
      if (!hasKf) {
        const val = evaluateItemProperty(existing, normKey, state.playheadTime)
        nextState = addKeyframe(nextState, itemId, normKey, state.playheadTime, val)
      }
    }
  }

  return nextState
}

/**
 * Resolves clip overlaps on the same track using overwrite semantics:
 * - Partial overlap at end: trims existing clip's end.
 * - Partial overlap at start: trims existing clip's start.
 * - Moved clip completely covers existing clip: existing clip is removed.
 * - Moved clip placed completely inside existing clip: existing clip is split into left/right parts.
 * - Exact edge contact: untouched.
 */
export function resolveTrackOverwrites(
  state: ProjectState,
  movedItemId: string,
  idGenerator: (prefix?: string) => string = generateId
): ProjectState {
  const moving = state.items[movedItemId]
  if (!moving) return state

  const bStart = moving.startTime
  const bEnd = moving.startTime + moving.duration
  const targetTrackId = moving.trackId

  const nextItems: Record<string, TimelineItem> = { ...state.items }
  const alteredItemIds = new Set<string>()

  // Check all other items on the same track
  for (const [id, a] of Object.entries(state.items)) {
    if (id === movedItemId || a.trackId !== targetTrackId) {
      continue
    }

    const aStart = a.startTime
    const aEnd = a.startTime + a.duration

    // Exact edge contact or no overlap:
    // [aStart, aEnd] and [bStart, bEnd] overlap iff max(aStart, bStart) < min(aEnd, bEnd)
    const overlapStart = Math.max(aStart, bStart)
    const overlapEnd = Math.min(aEnd, bEnd)

    if (overlapStart >= overlapEnd) {
      // No overlap or exact edge contact
      continue
    }

    const speedRatio = a.duration > 0 ? (a.sourceOut - a.sourceIn) / a.duration : 1

    // Case 1: B completely covers A -> remove A
    if (bStart <= aStart && bEnd >= aEnd) {
      delete nextItems[id]
      alteredItemIds.add(id)
      continue
    }

    // Case 2: B is placed completely inside A -> split A into left and right around B
    if (bStart > aStart && bEnd < aEnd) {
      delete nextItems[id]
      alteredItemIds.add(id)

      const leftDuration = bStart - aStart
      const rightDuration = aEnd - bEnd

      const leftItem: TimelineItem = {
        ...a,
        id: idGenerator('item'),
        startTime: aStart,
        duration: leftDuration,
        sourceIn: a.sourceIn,
        sourceOut: a.sourceIn + leftDuration * speedRatio,
        transform: { ...a.transform },
      }

      const rightItem: TimelineItem = {
        ...a,
        id: idGenerator('item'),
        startTime: bEnd,
        duration: rightDuration,
        sourceIn: a.sourceIn + (bEnd - aStart) * speedRatio,
        sourceOut: a.sourceOut,
        transform: { ...a.transform },
      }

      nextItems[leftItem.id] = leftItem
      nextItems[rightItem.id] = rightItem
      continue
    }

    // Case 3: B overlaps the end of A (A starts before B, but ends inside B)
    if (aStart < bStart && aEnd > bStart && aEnd <= bEnd) {
      const newDuration = bStart - aStart
      nextItems[id] = {
        ...a,
        duration: newDuration,
        sourceOut: a.sourceIn + newDuration * speedRatio,
      }
      alteredItemIds.add(id)
      continue
    }

    // Case 4: B overlaps the start of A (A starts inside B, but ends after B)
    if (aStart >= bStart && aStart < bEnd && aEnd > bEnd) {
      const trimmedTimeline = bEnd - aStart
      const newDuration = aEnd - bEnd
      nextItems[id] = {
        ...a,
        startTime: bEnd,
        duration: newDuration,
        sourceIn: a.sourceIn + trimmedTimeline * speedRatio,
      }
      alteredItemIds.add(id)
      continue
    }
  }

  let intermediateState: ProjectState = {
    ...state,
    items: nextItems,
  }
  if (alteredItemIds.size > 0) {
    intermediateState = removeTransitionsForClips(intermediateState, alteredItemIds, true)
  }
  return intermediateState
}

export function moveTimelineItem(
  state: ProjectState,
  itemId: string,
  newStartTime: number,
  newTrackId?: string
): ProjectState {
  const existing = state.items[itemId]
  if (!existing) {
    return state
  }

  const sourceTrackId = existing.trackId
  const asset = state.assets[existing.assetId]
  let nextTracks = state.tracks
  let targetTrackId = sourceTrackId

  if (newTrackId) {
    const effectiveType = getItemEffectiveType(existing, asset)
    const res = resolveTrackOrNew(
      state.tracks,
      newTrackId,
      effectiveType,
      effectiveType === 'caption' ? 'caption' : existing.streamType
    )
    if (res.resolvedTrackId) {
      nextTracks = res.nextTracks
      targetTrackId = res.resolvedTrackId
    }
  }

  const nextStart = Math.max(0, newStartTime)
  const timeDelta = nextStart - existing.startTime

  // Has the clip actually moved in time or track?
  const hasMoved = Math.abs(timeDelta) > 0.001 || targetTrackId !== sourceTrackId
  if (!hasMoved) {
    // Left at original place! Do not alter the clip or remove transitions!
    return state
  }

  // Finalized move to a new time or track -> remove transitions
  state = removeTransitionsForClips(state, [itemId], true)

  let nextKeyframes = existing.keyframes
  if (timeDelta !== 0 && existing.keyframes) {
    nextKeyframes = {}
    for (const [prop, kfs] of Object.entries(existing.keyframes)) {
      if (Array.isArray(kfs)) {
        nextKeyframes[prop] = (kfs as Keyframe<number>[]).map((kf: Keyframe<number>) => ({
          ...kf,
          time: Math.round((kf.time + timeDelta) * 10000) / 10000,
        }))
      }
    }
  }

  let nextCaption = existing.caption
  if (timeDelta !== 0 && existing.caption?.words) {
    nextCaption = {
      ...existing.caption,
      words: existing.caption.words.map((w) => {
        const start = Math.round(((w.start ?? w.startTime) + timeDelta) * 1000) / 1000
        const end = Math.round(((w.end ?? w.endTime) + timeDelta) * 1000) / 1000
        return {
          ...w,
          start,
          end,
          startTime: start,
          endTime: end,
        }
      }),
    }
  }

  const updatedItem: TimelineItem = {
    ...existing,
    startTime: nextStart,
    trackId: targetTrackId,
    keyframes: nextKeyframes,
    ...(nextCaption ? { caption: nextCaption } : {}),
  }

  const stateWithMovedItem: ProjectState = {
    ...state,
    tracks: nextTracks,
    items: {
      ...state.items,
      [itemId]: updatedItem,
    },
  }

  const stateWithOverwrites = resolveTrackOverwrites(stateWithMovedItem, itemId)

  // Targeted check: if moved to a different track, check only whether the source track became empty
  if (sourceTrackId !== targetTrackId) {
    return cleanupTrackIfEmpty(stateWithOverwrites, sourceTrackId)
  }

  return stateWithOverwrites
}


export interface TrimOptions {
  edge?: 'left' | 'right'
  newTime?: number
  startTime?: number
  duration?: number
  sourceIn?: number
  sourceOut?: number
}

export function trimTimelineItem(
  state: ProjectState,
  itemId: string,
  trim: TrimOptions
): ProjectState {
  const existing = state.items[itemId]
  if (!existing) {
    return state
  }

  const asset = state.assets[existing.assetId]
  const speedRatio = existing.duration > 0 ? (existing.sourceOut - existing.sourceIn) / existing.duration : 1
  const minDuration = 1 / (state.settings.fps || 30)

  let nextStartTime = existing.startTime
  let nextDuration = existing.duration
  let nextSourceIn = existing.sourceIn
  let nextSourceOut = existing.sourceOut

  if (trim.edge === 'right' && trim.newTime !== undefined) {
    // Right edge drag: changes sourceOut, updates duration, preserves timeline start
    let newDuration = Math.max(minDuration, trim.newTime - existing.startTime)
    let newSourceOut = existing.sourceIn + newDuration * speedRatio

    if (asset?.duration && newSourceOut > asset.duration) {
      newSourceOut = asset.duration
      newDuration = Math.max(minDuration, (newSourceOut - existing.sourceIn) / speedRatio)
    }

    nextStartTime = existing.startTime
    nextDuration = newDuration
    nextSourceIn = existing.sourceIn
    nextSourceOut = newSourceOut
  } else if (trim.edge === 'left' && trim.newTime !== undefined) {
    // Left edge drag: changes timeline start, changes sourceIn, preserves correct content (sourceOut), updates duration
    let newStart = Math.max(0, trim.newTime)
    const existingEnd = existing.startTime + existing.duration
    const maxStart = existingEnd - minDuration

    if (newStart > maxStart) {
      newStart = maxStart
    }

    const delta = newStart - existing.startTime
    let newSourceIn = existing.sourceIn + delta * speedRatio

    if (newSourceIn < 0) {
      newSourceIn = 0
      newStart = existing.startTime - (existing.sourceIn / speedRatio)
    }

    nextStartTime = Math.max(0, newStart)
    nextDuration = Math.max(minDuration, existingEnd - nextStartTime)
    nextSourceIn = newSourceIn
    nextSourceOut = existing.sourceOut
  } else {
    // Direct property overrides if supplied
    if (trim.startTime !== undefined) nextStartTime = Math.max(0, trim.startTime)
    if (trim.duration !== undefined) nextDuration = Math.max(minDuration, trim.duration)
    if (trim.sourceIn !== undefined) nextSourceIn = Math.max(0, trim.sourceIn)
    if (trim.sourceOut !== undefined) nextSourceOut = Math.max(nextSourceIn, trim.sourceOut)
  }

  // Check if clip boundaries were actually altered
  const hasTrimmed =
    Math.abs(nextStartTime - existing.startTime) > 0.001 ||
    Math.abs(nextDuration - existing.duration) > 0.001 ||
    Math.abs(nextSourceIn - existing.sourceIn) > 0.001 ||
    Math.abs(nextSourceOut - existing.sourceOut) > 0.001

  if (!hasTrimmed) {
    // Left at original place! Do not alter clip or remove transitions!
    return state
  }

  // Finalized trim action with actual boundary changes -> remove transitions
  state = removeTransitionsForClips(state, [itemId], true)

  let nextCaption = existing.caption
  if (existing.caption?.words && (nextStartTime !== existing.startTime || nextDuration !== existing.duration)) {
    const origDuration = Math.max(0.01, existing.duration)
    const scale = nextDuration / origDuration
    nextCaption = {
      ...existing.caption,
      words: existing.caption.words.map((w) => {
        const oldStart = w.start ?? w.startTime
        const oldEnd = w.end ?? w.endTime
        const relStart = Math.max(0, oldStart - existing.startTime)
        const relEnd = Math.max(relStart, oldEnd - existing.startTime)
        const start = Math.round((nextStartTime + relStart * scale) * 1000) / 1000
        const end = Math.round((nextStartTime + relEnd * scale) * 1000) / 1000
        return {
          ...w,
          start,
          end,
          startTime: start,
          endTime: end,
        }
      }),
    }
  }

  let nextEffects = existing.effects
  if (existing.effects && (nextStartTime !== existing.startTime || nextDuration !== existing.duration)) {
    const startDelta = nextStartTime - existing.startTime
    nextEffects = existing.effects.map((eff) => {
      if (eff.rangeMode === 'custom') {
        const curStart = eff.startOffset ?? 0
        const curEnd = eff.endOffset ?? existing.duration
        const adjStart = Math.max(0, Math.min(nextDuration, curStart - startDelta))
        const adjEnd = Math.max(adjStart, Math.min(nextDuration, curEnd - startDelta))
        return {
          ...eff,
          startOffset: adjStart,
          endOffset: adjEnd,
        }
      }
      return eff
    })
  }

  const updatedItem: TimelineItem = {
    ...existing,
    startTime: nextStartTime,
    duration: nextDuration,
    sourceIn: nextSourceIn,
    sourceOut: nextSourceOut,
    effects: nextEffects,
    ...(nextCaption ? { caption: nextCaption } : {}),
  }

  const stateWithTrimmedItem: ProjectState = {
    ...state,
    items: {
      ...state.items,
      [itemId]: updatedItem,
    },
  }

  return resolveTrackOverwrites(stateWithTrimmedItem, itemId)
}

export function setPlayheadTime(state: ProjectState, time: number): ProjectState {
  return {
    ...state,
    playheadTime: Math.max(0, time),
  }
}

export function selectItem(state: ProjectState, itemId: string | null, includeLinked = true): ProjectState {
  const validId = itemId && state.items[itemId] ? itemId : null
  if (!validId) {
    return {
      ...state,
      selectedItemId: null,
      selectedItemIds: [],
      selectedTransitionId: null,
    }
  }
  const selectedItemIds = includeLinked ? getLinkedItemIdsForState(state, validId) : [validId]
  return {
    ...state,
    selectedItemId: validId,
    selectedItemIds,
    selectedTransitionId: null,
  }
}

export function selectItems(state: ProjectState, itemIds: string[], includeLinked = true): ProjectState {
  const visited = new Set<string>()
  for (const id of itemIds) {
    if (state.items[id]) {
      if (includeLinked) {
        for (const lid of getLinkedItemIdsForState(state, id)) {
          visited.add(lid)
        }
      } else {
        visited.add(id)
      }
    }
  }
  const validIds = Array.from(visited)
  return {
    ...state,
    selectedItemId: validIds[0] ?? null,
    selectedItemIds: validIds,
    selectedTransitionId: null,
  }
}

export function linkTimelineItems(state: ProjectState, itemIds: string[]): ProjectState {
  const validIds = itemIds.filter((id) => !!state.items[id])
  if (validIds.length < 2) return state

  // Link all items in validIds in a chain/cycle or to each other
  // If exactly 2: a.linkedItemId = b, b.linkedItemId = a
  // If > 2: link cyclically or chain so getLinkedItemIds traverses all of them
  const nextItems = { ...state.items }
  for (let i = 0; i < validIds.length; i++) {
    const currentId = validIds[i]
    const nextId = validIds[(i + 1) % validIds.length]
    nextItems[currentId] = {
      ...nextItems[currentId],
      linkedItemId: nextId,
    }
  }

  return {
    ...state,
    items: nextItems,
  }
}

export function unlinkTimelineItems(state: ProjectState, itemIds: string[]): ProjectState {
  const idsToUnlink = new Set<string>()
  for (const id of itemIds) {
    if (state.items[id]) {
      idsToUnlink.add(id)
      // Also unlink any items pointing to this id or pointed to by this id
      const current = state.items[id]
      if (current.linkedItemId && state.items[current.linkedItemId]) {
        idsToUnlink.add(current.linkedItemId)
      }
    }
  }

  const nextItems = { ...state.items }
  for (const [id, item] of Object.entries(nextItems)) {
    if (idsToUnlink.has(id)) {
      const copy = { ...item }
      delete copy.linkedItemId
      nextItems[id] = copy
    } else if (item.linkedItemId && idsToUnlink.has(item.linkedItemId)) {
      const copy = { ...item }
      delete copy.linkedItemId
      nextItems[id] = copy
    }
  }

  return {
    ...state,
    items: nextItems,
  }
}

/**
 * Splits a timeline item at a given absolute time.
 * Returns the state with the original item removed and two new items created.
 *
 * The split time must fall strictly within the item's time range:
 * (startTime < splitTime < startTime + duration).
 *
 * The two resulting items preserve the asset reference, track, transform,
 * and correctly partition the source range.
 */
export function splitTimelineItemRaw(
  state: ProjectState,
  itemId: string,
  splitTime: number,
  leftItemId: string,
  rightItemId: string
): ProjectState {
  const existing = state.items[itemId]
  if (!existing) {
    return state
  }

  const itemEnd = existing.startTime + existing.duration

  // Do not allow split when playhead is before, after, exactly at start, or exactly at end
  if (splitTime <= existing.startTime || splitTime >= itemEnd) {
    return state
  }

  // Splitting an item removes any transitions on the original item and linked partners
  state = removeTransitionsForClips(state, [itemId], true)

  const leftDuration = splitTime - existing.startTime
  const rightDuration = itemEnd - splitTime

  // Compute source boundaries proportional to duration ratio
  const sourceDuration = existing.sourceOut - existing.sourceIn
  const speedRatio = existing.duration > 0 ? sourceDuration / existing.duration : 1
  const leftSourceOut = existing.sourceIn + leftDuration * speedRatio
  const rightSourceIn = leftSourceOut

  let leftKeyframes: PropertyKeyframeMap | undefined = undefined
  let rightKeyframes: PropertyKeyframeMap | undefined = undefined

  if (existing.keyframes) {
    leftKeyframes = {}
    rightKeyframes = {}
    for (const [prop, list] of Object.entries(existing.keyframes)) {
      if (!Array.isArray(list)) continue
      const kfList = list as Keyframe<number>[]
      const leftList = kfList.filter((kf: Keyframe<number>) => kf.time <= splitTime)
      const rightList = kfList.filter((kf: Keyframe<number>) => kf.time >= splitTime)

      const hasLeft = leftList.length > 0
      const hasRight = rightList.length > 0
      const exactAtSplit = kfList.some((kf: Keyframe<number>) => Math.abs(kf.time - splitTime) < 0.001)

      if (!exactAtSplit && hasLeft && hasRight) {
        const splitVal = evaluateItemProperty(existing, prop, splitTime)
        const splitKf: Keyframe<number> = {
          id: generateId('kf'),
          time: splitTime,
          value: splitVal,
          interpolation: 'linear',
        }
        leftList.push(splitKf)
        rightList.unshift({ ...splitKf, id: generateId('kf') })
      }

      if (leftList.length > 0) leftKeyframes[prop] = leftList
      if (rightList.length > 0) rightKeyframes[prop] = rightList
    }
  }

  let leftCaption = existing.caption
  let rightCaption = existing.caption
  if (existing.caption) {
    const origWords = existing.caption.words
    if (origWords && origWords.length > 0) {
      const leftWords = origWords.filter((w) => w.startTime < splitTime)
      const rightWords = origWords.filter((w) => w.startTime >= splitTime)
      const leftText = leftWords.length > 0 ? leftWords.map((w) => w.word).join(' ') : existing.caption.text
      const rightText = rightWords.length > 0 ? rightWords.map((w) => w.word).join(' ') : existing.caption.text
      leftCaption = { ...existing.caption, text: leftText, words: leftWords }
      rightCaption = { ...existing.caption, text: rightText, words: rightWords }
    } else {
      const words = existing.caption.text.trim().split(/\s+/)
      if (words.length > 1) {
        const mid = Math.max(1, Math.round(words.length * (leftDuration / existing.duration)))
        const leftText = words.slice(0, mid).join(' ')
        const rightText = words.slice(mid).join(' ')
        leftCaption = { ...existing.caption, text: leftText }
        rightCaption = { ...existing.caption, text: rightText }
      }
    }
  }

  let leftEffects: ItemEffect[] | undefined = undefined
  let rightEffects: ItemEffect[] | undefined = undefined

  if (existing.effects && existing.effects.length > 0) {
    leftEffects = []
    rightEffects = []
    const splitLocalOffset = leftDuration // seconds from existing.startTime

    for (const eff of existing.effects) {
      if (eff.rangeMode === 'custom') {
        const effStart = eff.startOffset ?? 0
        const effEnd = eff.endOffset ?? existing.duration

        if (effEnd <= splitLocalOffset) {
          // Effect finishes entirely before or at the cut point -> left item only
          leftEffects.push({
            ...eff,
            startOffset: effStart,
            endOffset: effEnd,
          })
        } else if (effStart >= splitLocalOffset) {
          // Effect begins at or after cut point -> right item only
          rightEffects.push({
            ...eff,
            id: generateId('fx'),
            startOffset: Math.max(0, effStart - splitLocalOffset),
            endOffset: Math.min(rightDuration, effEnd - splitLocalOffset),
          })
        } else {
          // Effect crosses the cut point -> partition into both
          leftEffects.push({
            ...eff,
            startOffset: effStart,
            endOffset: splitLocalOffset,
          })
          rightEffects.push({
            ...eff,
            id: generateId('fx'),
            startOffset: 0,
            endOffset: Math.min(rightDuration, effEnd - splitLocalOffset),
          })
        }
      } else {
        // fullClip effect applies to entire clip -> both items get fullClip
        leftEffects.push({ ...eff })
        rightEffects.push({ ...eff, id: generateId('fx') })
      }
    }
  }

  const leftItem: TimelineItem = {
    ...existing,
    id: leftItemId,
    startTime: existing.startTime,
    duration: leftDuration,
    sourceIn: existing.sourceIn,
    sourceOut: leftSourceOut,
    transform: { ...existing.transform },
    keyframes: leftKeyframes,
    effects: leftEffects,
    ...(leftCaption ? { caption: leftCaption } : {}),
  }

  const rightItem: TimelineItem = {
    ...existing,
    id: rightItemId,
    startTime: splitTime,
    duration: rightDuration,
    sourceIn: rightSourceIn,
    sourceOut: existing.sourceOut,
    transform: { ...existing.transform },
    keyframes: rightKeyframes,
    effects: rightEffects,
    ...(rightCaption ? { caption: rightCaption } : {}),
  }

  // Remove original, add the two new parts
  const nextItems = { ...state.items }
  delete nextItems[itemId]

  // Default: clear linkedItemId to avoid dangling links to unsplit clips
  delete leftItem.linkedItemId
  delete rightItem.linkedItemId
  if (existing.linkedItemId && nextItems[existing.linkedItemId]) {
    const copy = { ...nextItems[existing.linkedItemId] }
    delete copy.linkedItemId
    nextItems[existing.linkedItemId] = copy
  }

  nextItems[leftItemId] = leftItem
  nextItems[rightItemId] = rightItem

  // Select the left half, keeping selectedItemIds synchronized
  const newSelectedId = state.selectedItemId === itemId ? leftItemId : state.selectedItemId
  let nextSelectedIds = state.selectedItemIds ?? []
  if (nextSelectedIds.includes(itemId)) {
    nextSelectedIds = nextSelectedIds.map((id) => (id === itemId ? leftItemId : id))
  } else if (newSelectedId) {
    nextSelectedIds = [newSelectedId]
  }

  return {
    ...state,
    items: nextItems,
    selectedItemId: newSelectedId,
    selectedItemIds: nextSelectedIds,
  }
}

/**
 * Splits a timeline item at a given absolute time.
 * If this item has a linked partner (e.g. video and audio pair) that also crosses the split point,
 * splits both items together in lockstep so audio and video stay synchronized.
 */
export function splitTimelineItem(
  state: ProjectState,
  itemId: string,
  splitTime: number,
  leftItemId: string,
  rightItemId: string
): ProjectState {
  const existing = state.items[itemId]
  if (!existing) {
    return state
  }

  const itemEnd = existing.startTime + existing.duration
  if (splitTime <= existing.startTime || splitTime >= itemEnd) {
    return state
  }

  // If this item has a linked partner that also crosses splitTime, split both together
  if (existing.linkedItemId && state.items[existing.linkedItemId]) {
    const partner = state.items[existing.linkedItemId]
    const partnerEnd = partner.startTime + partner.duration
    if (splitTime > partner.startTime && splitTime < partnerEnd) {
      return splitTimelineItems(state, [
        { itemId, splitTime, leftItemId, rightItemId },
        { itemId: partner.id, splitTime, leftItemId: generateId('item'), rightItemId: generateId('item') },
      ])
    }
  }

  return splitTimelineItemRaw(state, itemId, splitTime, leftItemId, rightItemId)
}

/**
 * Moves multiple timeline items by delta or absolute positions atomically.
 */
export function moveTimelineItems(
  state: ProjectState,
  moves: { itemId: string; newStartTime: number; newTrackId?: string }[]
): ProjectState {
  let currentState = state
  const resolvedNewTrackMap = new Map<string, string>()

  for (const move of moves) {
    let targetTrackId = move.newTrackId
    if (targetTrackId && targetTrackId.startsWith('NEW_')) {
      if (resolvedNewTrackMap.has(targetTrackId)) {
        targetTrackId = resolvedNewTrackMap.get(targetTrackId)!
      }
    }
    const prevTracks = currentState.tracks
    currentState = moveTimelineItem(currentState, move.itemId, move.newStartTime, targetTrackId)
    if (move.newTrackId && move.newTrackId.startsWith('NEW_') && !resolvedNewTrackMap.has(move.newTrackId)) {
      const addedTrack = currentState.tracks.find((t) => !prevTracks.some((pt) => pt.id === t.id))
      if (addedTrack) {
        resolvedNewTrackMap.set(move.newTrackId, addedTrack.id)
      }
    }
  }
  return currentState
}

/**
 * Trims multiple timeline items atomically (e.g. trimming linked video + audio pairs).
 */
export function trimTimelineItems(
  state: ProjectState,
  trims: { itemId: string; trim: TrimOptions }[]
): ProjectState {
  let currentState = state
  for (const t of trims) {
    currentState = trimTimelineItem(currentState, t.itemId, t.trim)
  }
  return currentState
}

/**
 * Removes multiple timeline items atomically.
 */
export function removeTimelineItems(
  state: ProjectState,
  itemIds: string[]
): ProjectState {
  let currentState = removeTransitionsForClips(state, itemIds, true)
  for (const id of itemIds) {
    currentState = removeTimelineItem(currentState, id)
  }
  return currentState
}

/**
 * Splits multiple timeline items atomically at a given playhead time.
 * Automatically discovers any linked partners crossing the split point that were omitted from splits,
 * splitting them simultaneously so audio and video pairs are never left partially split.
 * Their left halves will be linked to each other, and their right halves will be linked to each other.
 */
export function splitTimelineItems(
  state: ProjectState,
  splits: { itemId: string; splitTime: number; leftItemId: string; rightItemId: string }[]
): ProjectState {
  state = removeTransitionsForClips(state, splits.map((s) => s.itemId), true)
  // Check if any split item has a linked partner crossing the split point that was omitted
  const splitItemIds = new Set(splits.map((s) => s.itemId))
  const splitsToAdd: { itemId: string; splitTime: number; leftItemId: string; rightItemId: string }[] = []

  for (const s of splits) {
    const orig = state.items[s.itemId]
    if (orig) {
      for (const lid of getLinkedItemIdsForState(state, s.itemId)) {
        if (!splitItemIds.has(lid)) {
          const partner = state.items[lid]
          if (partner && s.splitTime > partner.startTime && s.splitTime < partner.startTime + partner.duration) {
            splitItemIds.add(lid)
            splitsToAdd.push({
              itemId: lid,
              splitTime: s.splitTime,
              leftItemId: generateId('item'),
              rightItemId: generateId('item'),
            })
          }
        }
      }
    }
  }

  const allSplits = [...splits, ...splitsToAdd]
  const splitMap = new Map<string, { itemId: string; splitTime: number; leftItemId: string; rightItemId: string }>()
  for (const s of allSplits) {
    splitMap.set(s.itemId, s)
  }

  let currentState = state
  for (const s of allSplits) {
    currentState = splitTimelineItemRaw(currentState, s.itemId, s.splitTime, s.leftItemId, s.rightItemId)
  }

  const nextItems = { ...currentState.items }

  for (const s of allSplits) {
    const originalItem = state.items[s.itemId]
    if (originalItem?.linkedItemId && splitMap.has(originalItem.linkedItemId)) {
      const partnerSplit = splitMap.get(originalItem.linkedItemId)!
      if (nextItems[s.leftItemId]) {
        nextItems[s.leftItemId] = {
          ...nextItems[s.leftItemId],
          linkedItemId: partnerSplit.leftItemId,
        }
      }
      if (nextItems[s.rightItemId]) {
        nextItems[s.rightItemId] = {
          ...nextItems[s.rightItemId],
          linkedItemId: partnerSplit.rightItemId,
        }
      }
    } else {
      if (nextItems[s.leftItemId]?.linkedItemId) {
        const copy = { ...nextItems[s.leftItemId] }
        delete copy.linkedItemId
        nextItems[s.leftItemId] = copy
      }
      if (nextItems[s.rightItemId]?.linkedItemId) {
        const copy = { ...nextItems[s.rightItemId] }
        delete copy.linkedItemId
        nextItems[s.rightItemId] = copy
      }
    }
  }

  const newSelectedIds = allSplits.map((s) => s.leftItemId)
  return {
    ...currentState,
    items: nextItems,
    selectedItemId: newSelectedIds[0] ?? currentState.selectedItemId,
    selectedItemIds: newSelectedIds.length > 0 ? newSelectedIds : (currentState.selectedItemIds ?? []),
  }
}

/**
 * Validates basic invariants for a TimelineItem.
 * Returns an array of error strings (empty = valid).
 */
export function validateTimelineItem(item: TimelineItem, state: ProjectState): string[] {
  const errors: string[] = []

  if (item.startTime < 0) {
    errors.push('startTime cannot be negative')
  }
  if (item.duration <= 0) {
    errors.push('duration must be positive')
  }
  if (item.sourceIn < 0) {
    errors.push('sourceIn cannot be negative')
  }
  if (item.sourceOut <= item.sourceIn) {
    errors.push('sourceOut must be greater than sourceIn')
  }
  const track = state.tracks.find((t) => t.id === item.trackId)
  if (!track) {
    errors.push(`track '${item.trackId}' does not exist`)
  } else {
    const effectiveItemType = item.itemType || (item.solid ? 'solid' : item.text ? 'text' : item.caption ? 'caption' : undefined)
    const asset = state.assets[item.assetId]
    if (asset && !isTrackCompatible(track.type, asset.type, item.streamType)) {
      errors.push(`asset type '${asset.type}' is incompatible with track type '${track.type}'`)
    } else if (effectiveItemType && !isTrackCompatible(track.type, effectiveItemType, item.streamType)) {
      errors.push(`item type '${effectiveItemType}' is incompatible with track type '${track.type}'`)
    }
  }

  return errors
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 5: SOLID LAYERS, TEXT LAYERS, CAPTIONS, SUBTITLES & BLEND MODES
// ─────────────────────────────────────────────────────────────────────────────

export interface AddSolidLayerOptions {
  id?: string
  trackId?: string
  startTime: number
  duration?: number
  color?: string
  transform?: Partial<Transform>
  blendMode?: BlendMode | string
  crop?: Partial<Crop>
}

export function addSolidLayer(state: ProjectState, options: AddSolidLayerOptions): ProjectState {
  const targetTrackId = options.trackId || (state.tracks.find((t) => t.type === 'video')?.id ?? 'NEW_VIDEO_TRACK')
  const { nextTracks, resolvedTrackId } = resolveTrackOrNew(state.tracks, targetTrackId, 'solid')
  if (!resolvedTrackId) {
    throw new Error(`Incompatible track '${targetTrackId}' for solid layer`)
  }

  const itemId = options.id || generateId('item-solid')
  const duration = options.duration !== undefined && options.duration > 0 ? options.duration : 5
  const solidProps: SolidProperties = {
    color: options.color || DEFAULT_SOLID_PROPERTIES.color,
  }

  const transform: Transform = {
    ...DEFAULT_TRANSFORM,
    ...options.transform,
    blendMode: options.blendMode || options.transform?.blendMode || 'normal',
  }

  const crop: Crop = {
    ...DEFAULT_CROP,
    ...options.crop,
  }

  const newItem: TimelineItem = {
    id: itemId,
    trackId: resolvedTrackId,
    assetId: '',
    itemType: 'solid',
    startTime: options.startTime,
    duration,
    sourceIn: 0,
    sourceOut: duration,
    transform,
    crop,
    solid: solidProps,
  }

  return {
    ...state,
    tracks: nextTracks,
    items: {
      ...state.items,
      [itemId]: newItem,
    },
    selectedItemId: itemId,
    selectedItemIds: [itemId],
  }
}

export function updateSolidLayer(
  state: ProjectState,
  itemId: string,
  solid: Partial<SolidProperties>
): ProjectState {
  const existing = state.items[itemId]
  if (!existing) return state

  const updatedSolid: SolidProperties = {
    color: existing.solid?.color || DEFAULT_SOLID_PROPERTIES.color,
    ...solid,
  }

  return {
    ...state,
    items: {
      ...state.items,
      [itemId]: {
        ...existing,
        solid: updatedSolid,
      },
    },
  }
}

export interface AddAdjustmentLayerOptions {
  id?: string
  trackId?: string
  startTime: number
  duration?: number
  transform?: Partial<Transform>
  blendMode?: BlendMode | string
  crop?: Partial<Crop>
}

export function addAdjustmentLayer(
  state: ProjectState,
  options: AddAdjustmentLayerOptions
): ProjectState {
  const targetTrackId =
    options.trackId || (state.tracks.find((t) => t.type === 'video')?.id ?? 'NEW_VIDEO_TRACK')
  const { nextTracks, resolvedTrackId } = resolveTrackOrNew(state.tracks, targetTrackId, 'adjustment')
  if (!resolvedTrackId) {
    throw new Error(`Incompatible track '${targetTrackId}' for adjustment layer`)
  }

  const itemId = options.id || generateId('item-adj')
  const duration = options.duration !== undefined && options.duration > 0 ? options.duration : 5

  const transform: Transform = {
    ...DEFAULT_TRANSFORM,
    ...options.transform,
    blendMode: options.blendMode || options.transform?.blendMode || 'normal',
  }

  const crop: Crop = {
    ...DEFAULT_CROP,
    ...options.crop,
  }

  const newItem: TimelineItem = {
    id: itemId,
    trackId: resolvedTrackId,
    assetId: '',
    itemType: 'adjustment',
    startTime: options.startTime,
    duration,
    sourceIn: 0,
    sourceOut: duration,
    transform,
    crop,
  }

  return {
    ...state,
    tracks: nextTracks,
    items: {
      ...state.items,
      [itemId]: newItem,
    },
    selectedItemId: itemId,
    selectedItemIds: [itemId],
  }
}

export interface AddTextLayerOptions {
  id?: string
  trackId?: string
  startTime: number
  duration?: number
  text?: string
  properties?: Partial<TextProperties>
  transform?: Partial<Transform>
  blendMode?: BlendMode | string
}

export function addTextLayer(state: ProjectState, options: AddTextLayerOptions): ProjectState {
  const targetTrackId = options.trackId || (state.tracks.find((t) => t.type === 'video')?.id ?? 'NEW_VIDEO_TRACK')
  const { nextTracks, resolvedTrackId } = resolveTrackOrNew(state.tracks, targetTrackId, 'text')
  if (!resolvedTrackId) {
    throw new Error(`Incompatible track '${targetTrackId}' for text layer`)
  }

  const itemId = options.id || generateId('item-text')
  const duration = options.duration !== undefined && options.duration > 0 ? options.duration : 5
  const textProps: TextProperties = {
    ...DEFAULT_TEXT_PROPERTIES,
    ...options.properties,
    ...(options.text !== undefined ? { text: options.text } : {}),
  }

  const transform: Transform = {
    ...DEFAULT_TRANSFORM,
    ...options.transform,
    blendMode: options.blendMode || options.transform?.blendMode || 'normal',
  }

  const newItem: TimelineItem = {
    id: itemId,
    trackId: resolvedTrackId,
    assetId: '',
    itemType: 'text',
    startTime: options.startTime,
    duration,
    sourceIn: 0,
    sourceOut: duration,
    transform,
    text: textProps,
  }

  return {
    ...state,
    tracks: nextTracks,
    items: {
      ...state.items,
      [itemId]: newItem,
    },
    selectedItemId: itemId,
    selectedItemIds: [itemId],
  }
}

export function updateTextLayer(
  state: ProjectState,
  itemId: string,
  properties: Partial<TextProperties>
): ProjectState {
  const existing = state.items[itemId]
  if (!existing) return state

  const updatedText: TextProperties = {
    ...(existing.text || DEFAULT_TEXT_PROPERTIES),
    ...properties,
  }

  return {
    ...state,
    items: {
      ...state.items,
      [itemId]: {
        ...existing,
        text: updatedText,
      },
    },
  }
}

export interface AddCaptionOptions {
  id?: string
  trackId?: string
  startTime: number
  duration?: number
  text: string
  words?: CaptionWord[]
  style?: Partial<TextProperties>
  preset?: string
  transform?: Partial<Transform>
}

export function addCaption(state: ProjectState, options: AddCaptionOptions): ProjectState {
  const targetTrackId = options.trackId || (state.tracks.find((t) => t.type === 'caption')?.id ?? 'NEW_CAPTION_TRACK')
  const { nextTracks, resolvedTrackId } = resolveTrackOrNew(state.tracks, targetTrackId, 'caption')
  if (!resolvedTrackId) {
    throw new Error(`Incompatible track '${targetTrackId}' for caption`)
  }

  const itemId = options.id || generateId('item-caption')
  const duration = options.duration !== undefined && options.duration > 0 ? options.duration : 3
  const words = options.words || generateWordTiming(options.text, options.startTime, options.startTime + duration)

  const captionProps: CaptionProperties = {
    text: options.text,
    words,
    style: options.style,
    preset: options.preset || 'Clean',
  }

  const transform: Transform = {
    ...DEFAULT_TRANSFORM,
    ...options.transform,
  }

  const newItem: TimelineItem = {
    id: itemId,
    trackId: resolvedTrackId,
    assetId: '',
    itemType: 'caption',
    streamType: 'caption',
    startTime: options.startTime,
    duration,
    sourceIn: 0,
    sourceOut: duration,
    transform,
    caption: captionProps,
  }

  return {
    ...state,
    tracks: nextTracks,
    items: {
      ...state.items,
      [itemId]: newItem,
    },
    selectedItemId: itemId,
    selectedItemIds: [itemId],
  }
}

export function updateCaption(
  state: ProjectState,
  itemId: string,
  caption: Partial<CaptionProperties>
): ProjectState {
  const existing = state.items[itemId]
  if (!existing) return state

  let finalWords = caption.words !== undefined ? caption.words : existing.caption?.words
  if (caption.text !== undefined && caption.words === undefined && caption.text !== existing.caption?.text) {
    finalWords = generateWordTiming(caption.text, existing.startTime, existing.startTime + existing.duration)
  }

  const updatedCaption: CaptionProperties = {
    text: existing.caption?.text ?? '',
    ...existing.caption,
    ...caption,
    words: finalWords,
    style: {
      ...(existing.caption?.style || {}),
      ...(caption.style || {}),
    },
  }

  return {
    ...state,
    items: {
      ...state.items,
      [itemId]: {
        ...existing,
        caption: updatedCaption,
      },
    },
  }
}

export function splitCaption(
  state: ProjectState,
  itemId: string,
  splitTime: number,
  leftItemId?: string,
  rightItemId?: string
): ProjectState {
  return splitTimelineItem(
    state,
    itemId,
    splitTime,
    leftItemId || generateId('item-caption-l'),
    rightItemId || generateId('item-caption-r')
  )
}

export function mergeCaptions(
  state: ProjectState,
  firstItemId: string,
  secondItemId: string
): ProjectState {
  const first = state.items[firstItemId]
  const second = state.items[secondItemId]
  if (!first || !second) return state

  state = removeTransitionsForClips(state, [firstItemId, secondItemId], true)

  const [earlier, later] = first.startTime <= second.startTime ? [first, second] : [second, first]
  const newStartTime = earlier.startTime
  const newEndTime = Math.max(earlier.startTime + earlier.duration, later.startTime + later.duration)
  const newDuration = Math.round((newEndTime - newStartTime) * 1000) / 1000

  const firstText = earlier.caption?.text?.trim() || ''
  const secondText = later.caption?.text?.trim() || ''
  const combinedText = firstText && secondText ? `${firstText} ${secondText}` : firstText || secondText

  const combinedWords: CaptionWord[] = [
    ...(earlier.caption?.words || generateWordTiming(firstText, earlier.startTime, earlier.startTime + earlier.duration)),
    ...(later.caption?.words || generateWordTiming(secondText, later.startTime, later.startTime + later.duration)),
  ]

  const mergedCaption: CaptionProperties = {
    ...earlier.caption,
    text: combinedText,
    words: combinedWords,
  }

  const nextItems = { ...state.items }
  delete nextItems[later.id]
  nextItems[earlier.id] = {
    ...earlier,
    startTime: newStartTime,
    duration: newDuration,
    sourceIn: 0,
    sourceOut: newDuration,
    caption: mergedCaption,
  }

  return {
    ...state,
    items: nextItems,
    selectedItemId: earlier.id,
    selectedItemIds: [earlier.id],
  }
}

export function applyCaptionPreset(
  state: ProjectState,
  itemId: string,
  presetName: string
): ProjectState {
  const existing = state.items[itemId]
  if (!existing || !existing.caption) return state

  if (!CAPTION_PRESETS[presetName]) return state
  const updatedCaption = captionPropertiesForPreset(existing.caption, presetName)

  return {
    ...state,
    items: {
      ...state.items,
      [itemId]: {
        ...existing,
        caption: updatedCaption,
      },
    },
  }
}

export function importSubtitles(
  state: ProjectState,
  cuesOrContent: SubtitleCue[] | string,
  targetTrackId?: string,
  startTimeOffset = 0,
  options: { preserveCueTiming?: boolean } = {}
): ProjectState {
  const cues = typeof cuesOrContent === 'string' ? parseSubtitleContent(cuesOrContent) : cuesOrContent
  if (!cues || cues.length === 0) return state

  // Resolve or create caption track
  const trackId = targetTrackId || (state.tracks.find((t) => t.type === 'caption')?.id ?? 'NEW_CAPTION_TRACK')
  const { nextTracks, resolvedTrackId } = resolveTrackOrNew(state.tracks, trackId, 'caption')
  if (!resolvedTrackId) {
    throw new Error('Unable to resolve caption track for subtitle import')
  }

  const nextItems = { ...state.items }
  const createdIds: string[] = []

  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i]
    const itemId = cue.id || generateId(`item-cap-${i + 1}`)
    const startTime = Math.max(0, cue.startTime + startTimeOffset)
    // Generated captions already have validated speech bounds; padding them can
    // cover a pause or overlap the following cue. File imports keep their default.
    const duration = options.preserveCueTiming ? cue.duration : Math.max(0.1, cue.duration)

    const text = cue.text ?? ''
    const captionProps: CaptionProperties = {
      text,
      words: cue.words || generateWordTiming(text, startTime, startTime + duration),
      preset: 'Clean',
      style: { ...CAPTION_PRESETS.Clean },
    }

    const newItem: TimelineItem = {
      id: itemId,
      trackId: resolvedTrackId,
      assetId: '',
      itemType: 'caption',
      streamType: 'caption',
      startTime,
      duration,
      sourceIn: 0,
      sourceOut: duration,
      transform: { ...DEFAULT_TRANSFORM },
      caption: captionProps,
    }

    nextItems[itemId] = newItem
    createdIds.push(itemId)
  }

  return {
    ...state,
    tracks: nextTracks,
    items: nextItems,
    selectedItemId: createdIds[0] ?? state.selectedItemId,
    selectedItemIds: createdIds.length > 0 ? createdIds : state.selectedItemIds,
  }
}

export function setBlendMode(
  state: ProjectState,
  itemId: string,
  blendMode: BlendMode | string
): ProjectState {
  const existing = state.items[itemId]
  if (!existing) return state

  const nextTransform: Transform = {
    ...(existing.transform || DEFAULT_TRANSFORM),
    blendMode,
  }

  return {
    ...state,
    items: {
      ...state.items,
      [itemId]: {
        ...existing,
        transform: nextTransform,
      },
    },
  }
}

export interface UpdateProjectSettingsOptions {
  name?: string
  width?: number
  height?: number
  fps?: number
  sampleRate?: number
}

export function updateProjectSettings(
  state: ProjectState,
  options: UpdateProjectSettingsOptions
): ProjectState {
  return {
    ...state,
    name: options.name !== undefined ? options.name : state.name,
    settings: {
      ...state.settings,
      width: options.width !== undefined ? options.width : state.settings.width,
      height: options.height !== undefined ? options.height : state.settings.height,
      fps: options.fps !== undefined ? options.fps : state.settings.fps,
      sampleRate: options.sampleRate !== undefined ? options.sampleRate : state.settings.sampleRate,
    },
  }
}

export function applyItemEffect(
  state: ProjectState,
  itemId: string,
  effect: ItemEffect
): ProjectState {
  const item = state.items[itemId]
  if (!item) return state

  const existingEffects = item.effects || []
  const nextEffects = [...existingEffects, effect]

  return {
    ...state,
    items: {
      ...state.items,
      [itemId]: {
        ...item,
        effects: nextEffects,
      },
    },
  }
}

export function removeItemEffect(
  state: ProjectState,
  itemId: string,
  effectInstanceId: string
): ProjectState {
  const item = state.items[itemId]
  if (!item || !item.effects) return state

  const nextEffects = item.effects.filter((e) => e.id !== effectInstanceId)

  return {
    ...state,
    items: {
      ...state.items,
      [itemId]: {
        ...item,
        effects: nextEffects,
      },
    },
  }
}

export function toggleItemEffect(
  state: ProjectState,
  itemId: string,
  effectInstanceId: string,
  enabled?: boolean
): ProjectState {
  const item = state.items[itemId]
  if (!item || !item.effects) return state

  const nextEffects = item.effects.map((e) => {
    if (e.id === effectInstanceId) {
      return { ...e, enabled: enabled !== undefined ? enabled : !e.enabled }
    }
    return e
  })

  return {
    ...state,
    items: {
      ...state.items,
      [itemId]: {
        ...item,
        effects: nextEffects,
      },
    },
  }
}

export function updateItemEffectParam(
  state: ProjectState,
  itemId: string,
  effectInstanceId: string,
  paramKey: string,
  value: number | string | boolean
): ProjectState {
  const item = state.items[itemId]
  if (!item || !item.effects) return state

  const nextEffects = item.effects.map((e) => {
    if (e.id === effectInstanceId) {
      return {
        ...e,
        params: {
          ...e.params,
          [paramKey]: value,
        },
      }
    }
    return e
  })

  return {
    ...state,
    items: {
      ...state.items,
      [itemId]: {
        ...item,
        effects: nextEffects,
      },
    },
  }
}

export function reorderItemEffects(
  state: ProjectState,
  itemId: string,
  fromIndex: number,
  toIndex: number
): ProjectState {
  const item = state.items[itemId]
  if (!item || !item.effects) return state
  if (fromIndex < 0 || fromIndex >= item.effects.length) return state
  if (toIndex < 0 || toIndex >= item.effects.length) return state

  const nextEffects = [...item.effects]
  const [moved] = nextEffects.splice(fromIndex, 1)
  nextEffects.splice(toIndex, 0, moved)

  return {
    ...state,
    items: {
      ...state.items,
      [itemId]: {
        ...item,
        effects: nextEffects,
      },
    },
  }
}

export function updateItemEffectTiming(
  state: ProjectState,
  itemId: string,
  effectInstanceId: string,
  timing: {
    rangeMode?: 'fullClip' | 'custom'
    startOffset?: number
    endOffset?: number
  }
): ProjectState {
  const item = state.items[itemId]
  if (!item || !item.effects) return state

  const safeDur = Math.max(0.01, item.duration)
  const nextEffects = item.effects.map((e) => {
    if (e.id === effectInstanceId) {
      const mode =
        timing.rangeMode ??
        (timing.startOffset !== undefined || timing.endOffset !== undefined
          ? 'custom'
          : e.rangeMode ?? 'fullClip')

      let nextStart = timing.startOffset !== undefined ? timing.startOffset : (e.startOffset ?? 0)
      let nextEnd = timing.endOffset !== undefined ? timing.endOffset : (e.endOffset ?? safeDur)

      nextStart = Math.max(0, Math.min(safeDur, nextStart))
      nextEnd = Math.max(nextStart, Math.min(safeDur, nextEnd))

      return {
        ...e,
        rangeMode: mode,
        startOffset: mode === 'fullClip' ? 0 : nextStart,
        endOffset: mode === 'fullClip' ? safeDur : nextEnd,
      }
    }
    return e
  })

  return {
    ...state,
    items: {
      ...state.items,
      [itemId]: {
        ...item,
        effects: nextEffects,
      },
    },
  }
}

export function resetItemEffectParams(
  state: ProjectState,
  itemId: string,
  effectInstanceId: string,
  defaultParams?: Record<string, number | string | boolean>
): ProjectState {
  const item = state.items[itemId]
  if (!item || !item.effects) return state

  const nextEffects = item.effects.map((e) => {
    if (e.id === effectInstanceId) {
      return {
        ...e,
        params: defaultParams ? { ...defaultParams } : {},
      }
    }
    return e
  })

  return {
    ...state,
    items: {
      ...state.items,
      [itemId]: {
        ...item,
        effects: nextEffects,
      },
    },
  }
}

export function getClipTransitions(
  state: ProjectState,
  clipId: string
): {
  startTransition: TimelineTransition | null
  endTransition: TimelineTransition | null
} {
  const clip = state.items[clipId]
  if (!clip) return { startTransition: null, endTransition: null }
  let startTransition: TimelineTransition | null = null
  let endTransition: TimelineTransition | null = null

  const transitions = Object.values(state.transitions || {})
  for (const tr of transitions) {
    if (tr.rightClipId === clipId && tr.leftClipId) {
      // Shared cut transition: incoming clip -> start transition
      startTransition = tr
    } else if (tr.leftClipId === clipId && tr.rightClipId) {
      // Shared cut transition: outgoing clip -> end transition
      endTransition = tr
    } else if (tr.leftClipId === clipId || tr.rightClipId === clipId) {
      // Standalone transition on this clip
      const mid = tr.startTime + tr.duration / 2
      const clipMid = clip.startTime + clip.duration / 2
      if (tr.rightClipId === clipId || tr.alignment === 'start' || (tr.alignment !== 'end' && mid < clipMid)) {
        startTransition = tr
      } else {
        endTransition = tr
      }
    }
  }

  return { startTransition, endTransition }
}

export function addTimelineTransition(state: ProjectState, transition: TimelineTransition): ProjectState {
  let leftClip = transition.leftClipId ? state.items[transition.leftClipId] : null
  let rightClip = transition.rightClipId ? state.items[transition.rightClipId] : null

  const effectiveTrackId = transition.trackId || leftClip?.trackId || rightClip?.trackId
  const track = state.tracks.find((t) => t.id === effectiveTrackId)

  // 1. Transitions cannot be added to audio tracks or audio clips!
  if (!track || track.type === 'audio') {
    return state
  }
  if (leftClip && (leftClip.itemType === 'audio' || leftClip.streamType === 'audio')) {
    return state
  }
  if (rightClip && (rightClip.itemType === 'audio' || rightClip.streamType === 'audio')) {
    return state
  }

  // Command clients without explicit clip IDs use the same placement rule as the UI.
  if (!leftClip && !rightClip) {
    const attachment = resolveTransitionDrop(state.items, track.id, transition.startTime + transition.duration / 2, transition.duration)
    return attachment ? addTimelineTransition(state, { ...transition, ...attachment, alignment: transition.alignment ?? attachment.alignment }) : state
  }

  // Transitions cannot be placed on empty space without any clip
  if (!leftClip && !rightClip) {
    return state
  }

  const nextTransitions = { ...(state.transitions || {}) }

  let finalStart = transition.startTime
  let finalDur = transition.duration

  if (leftClip && rightClip) {
    // Cut point transition: Acts as end-transition for leftClip, and start-transition for rightClip
    const timing = alignedTransitionTiming(leftClip, rightClip, finalDur, transition.alignment)
    finalStart = timing.startTime
    finalDur = timing.duration

    // Remove any previous end-transition on leftClip (max 2 transitions: 1 start, 1 end)
    const leftTrs = getClipTransitions(state, leftClip.id)
    if (leftTrs.endTransition && leftTrs.endTransition.id !== transition.id) {
      delete nextTransitions[leftTrs.endTransition.id]
    }
    // Remove any previous start-transition on rightClip
    const rightTrs = getClipTransitions(state, rightClip.id)
    if (rightTrs.startTransition && rightTrs.startTransition.id !== transition.id) {
      delete nextTransitions[rightTrs.startTransition.id]
    }
  } else if (leftClip) {
    const clipStart = leftClip.startTime
    const clipEnd = leftClip.startTime + leftClip.duration
    finalDur = Math.min(leftClip.duration, finalDur)

    const isStart = transition.alignment === 'start' || (transition.alignment !== 'end'
      && (transition.startTime + transition.duration / 2) < (clipStart + leftClip.duration / 2))
    const leftTrs = getClipTransitions(state, leftClip.id)

    if (isStart) {
      finalStart = clipStart
      if (leftTrs.startTransition && leftTrs.startTransition.id !== transition.id) {
        delete nextTransitions[leftTrs.startTransition.id]
      }
    } else {
      finalStart = Math.max(clipStart, clipEnd - finalDur)
      if (leftTrs.endTransition && leftTrs.endTransition.id !== transition.id) {
        delete nextTransitions[leftTrs.endTransition.id]
      }
    }
  } else if (rightClip) {
    const clipStart = rightClip.startTime
    finalDur = Math.min(rightClip.duration, finalDur)
    finalStart = clipStart

    const rightTrs = getClipTransitions(state, rightClip.id)
    if (rightTrs.startTransition && rightTrs.startTransition.id !== transition.id) {
      delete nextTransitions[rightTrs.startTransition.id]
    }
  }

  const finalTransition: TimelineTransition = {
    ...transition,
    trackId: track.id,
    leftClipId: leftClip?.id,
    rightClipId: rightClip?.id,
    startTime: finalStart,
    duration: finalDur,
  }

  nextTransitions[transition.id] = finalTransition

  return {
    ...state,
    transitions: nextTransitions,
    selectedTransitionId: transition.id,
    selectedItemId: null,
    selectedItemIds: [],
  }
}

export function removeTimelineTransition(state: ProjectState, transitionId: string): ProjectState {
  const nextTransitions = { ...(state.transitions || {}) }
  delete nextTransitions[transitionId]
  return {
    ...state,
    transitions: nextTransitions,
    selectedTransitionId: state.selectedTransitionId === transitionId ? null : state.selectedTransitionId,
  }
}

export const DEFAULT_TRANSITION_DURATION = 1.0

export function updateTimelineTransition(
  state: ProjectState,
  transitionId: string,
  updates: Partial<TimelineTransition>
): ProjectState {
  const tr = state.transitions?.[transitionId]
  if (!tr) return state

  // Reattachment is an atomic editor operation: remove any effect occupying the new edge,
  // preserve parameters and clip selection, and let undo restore both attachments together.
  if ('leftClipId' in updates || 'rightClipId' in updates) {
    const merged = { ...tr, ...updates, params: updates.params ? { ...tr.params, ...updates.params } : tr.params }
    const left = merged.leftClipId ? state.items[merged.leftClipId] : undefined
    const right = merged.rightClipId ? state.items[merged.rightClipId] : undefined
    if ((!left && !right) || (merged.leftClipId && !left) || (merged.rightClipId && !right)
      || (left && left.trackId !== merged.trackId) || (right && right.trackId !== merged.trackId)
      || (left && right && (left.id === right.id || Math.abs(left.startTime + left.duration - right.startTime) > 0.15))) return state
    const next = addTimelineTransition(state, merged)
    if (next === state) return state
    return { ...next, selectedItemId: state.selectedItemId, selectedItemIds: state.selectedItemIds,
      selectedTransitionId: state.selectedTransitionId && next.transitions?.[state.selectedTransitionId] ? state.selectedTransitionId : null }
  }

  const leftClipId = updates.leftClipId !== undefined ? updates.leftClipId : tr.leftClipId
  const rightClipId = updates.rightClipId !== undefined ? updates.rightClipId : tr.rightClipId
  let leftClip = leftClipId ? state.items[leftClipId] : null
  let rightClip = rightClipId ? state.items[rightClipId] : null

  // Fallback to resolve clips if missing
  if (!leftClip && !rightClip) {
    const trackItems = Object.values(state.items).filter((it) => it.trackId === tr.trackId)
    const mid = tr.startTime + tr.duration / 2
    for (let i = 0; i < trackItems.length; i++) {
      const itA = trackItems[i]
      const cutA = itA.startTime + itA.duration
      for (let j = 0; j < trackItems.length; j++) {
        if (i === j) continue
        const itB = trackItems[j]
        if (Math.abs(itB.startTime - cutA) <= 0.15 && Math.abs(mid - cutA) <= tr.duration) {
          leftClip = itA
          rightClip = itB
          break
        }
      }
      if (leftClip && rightClip) break
    }
    if (!leftClip && !rightClip) {
      leftClip = trackItems.find(
        (it) => tr.startTime >= it.startTime - 0.05 && tr.startTime < it.startTime + it.duration
      ) ?? null
    }
  }

  let newStart = updates.startTime !== undefined ? updates.startTime : tr.startTime
  let newDur = updates.duration !== undefined ? Math.max(0.05, updates.duration) : tr.duration

  if (leftClip && rightClip) {
    const timing = alignedTransitionTiming(leftClip, rightClip, newDur, updates.alignment ?? tr.alignment)
    newStart = timing.startTime
    newDur = timing.duration
  } else if (leftClip) {
    // Single-clip transition: anchored to either start (In) or end (Out) of the clip
    const clipStart = leftClip.startTime
    const clipEnd = leftClip.startTime + leftClip.duration
    newDur = Math.min(leftClip.duration, newDur)
    const isStart = getClipTransitions(state, leftClip.id).startTransition?.id === tr.id
    if (isStart) {
      newStart = clipStart
    } else {
      newStart = Math.max(clipStart, clipEnd - newDur)
    }
  } else if (rightClip) {
    newDur = Math.min(rightClip.duration, newDur)
    newStart = rightClip.startTime
  }

  return {
    ...state,
    transitions: {
      ...(state.transitions || {}),
      [transitionId]: {
        ...tr,
        ...updates,
        params: updates.params ? { ...(tr.params || {}), ...updates.params } : tr.params,
        leftClipId: leftClip?.id ?? tr.leftClipId,
        rightClipId: rightClip?.id ?? tr.rightClipId,
        startTime: newStart,
        duration: newDur,
      },
    },
  }
}

export function computeTransitionTrim(
  state: ProjectState,
  transitionId: string,
  mode: 'trim-left' | 'trim-right',
  originalStartTime: number,
  originalDuration: number,
  deltaTime: number
): { startTime: number; duration: number } {
  const tr = state.transitions?.[transitionId]
  if (!tr) {
    return { startTime: originalStartTime, duration: originalDuration }
  }

  let leftClip = tr.leftClipId ? state.items[tr.leftClipId] : null
  let rightClip = tr.rightClipId ? state.items[tr.rightClipId] : null

  // Fallback to resolve clips if missing from IDs
  if (!leftClip && !rightClip) {
    const trackItems = Object.values(state.items).filter((it) => it.trackId === tr.trackId)
    const mid = tr.startTime + tr.duration / 2
    for (let i = 0; i < trackItems.length; i++) {
      const itA = trackItems[i]
      const cutA = itA.startTime + itA.duration
      for (let j = 0; j < trackItems.length; j++) {
        if (i === j) continue
        const itB = trackItems[j]
        if (Math.abs(itB.startTime - cutA) <= 0.15 && Math.abs(mid - cutA) <= tr.duration) {
          leftClip = itA
          rightClip = itB
          break
        }
      }
      if (leftClip && rightClip) break
    }
  }

  const isTwoClip = !!(leftClip && rightClip)

  if (isTwoClip) {
    const before = transitionBeforeCut(tr.alignment)
    const movingPortion = mode === 'trim-left' ? before : 1 - before
    // A handle at the cut stays anchored; the outer handle changes duration.
    const duration = movingPortion === 0 ? originalDuration
      : originalDuration + (mode === 'trim-left' ? -deltaTime : deltaTime) / movingPortion
    return alignedTransitionTiming(leftClip!, rightClip!, Math.max(0.1, duration), tr.alignment)
  }

  if (leftClip) {
    const clipStart = leftClip.startTime
    const clipEnd = leftClip.startTime + leftClip.duration
    const isStart = (originalStartTime + originalDuration / 2) < (clipStart + leftClip.duration / 2)

    if (isStart) {
      const rawDur = mode === 'trim-right' ? originalDuration + deltaTime : originalDuration - deltaTime
      const clampedDur = Math.max(0.1, Math.min(leftClip.duration, rawDur))
      return {
        startTime: clipStart,
        duration: clampedDur,
      }
    } else {
      const rawDur = mode === 'trim-left' ? originalDuration - deltaTime : originalDuration + deltaTime
      const clampedDur = Math.max(0.1, Math.min(leftClip.duration, rawDur))
      return {
        startTime: Math.max(clipStart, clipEnd - clampedDur),
        duration: clampedDur,
      }
    }
  }

  if (rightClip) {
    const rawDur = mode === 'trim-right' ? originalDuration + deltaTime : originalDuration - deltaTime
    return {
      startTime: rightClip.startTime,
      duration: Math.max(0.1, Math.min(rightClip.duration, rawDur)),
    }
  }

  // Fallback if orphan transition without clips
  if (mode === 'trim-left') {
    const endTime = originalStartTime + originalDuration
    const rawStart = originalStartTime + deltaTime
    const newStart = Math.max(0, Math.min(endTime - 0.1, rawStart))
    return {
      startTime: newStart,
      duration: Math.max(0.1, endTime - newStart),
    }
  } else {
    const rawDur = originalDuration + deltaTime
    return {
      startTime: originalStartTime,
      duration: Math.max(0.1, rawDur),
    }
  }
}

export function selectTimelineTransition(state: ProjectState, transitionId: string | null): ProjectState {
  const transition = transitionId ? state.transitions?.[transitionId] : null
  if (!transition) return { ...state, selectedTransitionId: null }
  const owners = [transition.leftClipId, transition.rightClipId]
  const contextId = state.selectedItemId && owners.includes(state.selectedItemId)
    ? state.selectedItemId
    : transition.rightClipId ?? transition.leftClipId
  const context = contextId ? selectItem(state, contextId) : state
  return {
    ...context,
    selectedTransitionId: transitionId,
  }
}

