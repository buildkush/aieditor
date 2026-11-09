import type { ProjectState } from '../project/projectState'
import { isTrackCompatible, getItemEffectiveType, type TimelineItem, type Track, DEFAULT_TRANSFORM } from './types'
import { resolveTrackOverwrites } from '../commands/projectCommands'

export type DragPreview =
  | {
      type: 'move'
      itemId: string
      targetStartTime: number
      targetTrackId: string
      additionalMoves?: {
        itemId: string
        targetStartTime: number
        targetTrackId: string
      }[]
    }
  | {
      type: 'trim'
      itemId: string
      edge: 'left' | 'right'
      targetTime: number
      additionalTrims?: {
        itemId: string
        edge: 'left' | 'right'
        targetTime: number
      }[]
    }
  | {
      type: 'media-drop'
      assetId: string
      assetType: string
      assetName: string
      duration: number
      targetStartTime: number
      targetTrackId: string
      hasAudio?: boolean
      audioTrackId?: string
      itemType?: TimelineItem['itemType']
      text?: TimelineItem['text']
      caption?: TimelineItem['caption']
      solid?: TimelineItem['solid']
    }

export interface PreviewStateResult {
  tracks: Track[]
  items: Record<string, TimelineItem>
  targetTrackId?: string
  isCompatible: boolean
  isNewTrack: boolean
  previewItemId?: string
}

/**
 * Computes a transient preview of the timeline state during a drag, trim, or drop operation.
 *
 * CRITICAL ARCHITECTURAL RULE:
 * This function NEVER mutates the real ProjectState and NEVER dispatches commands.
 * It produces a purely transient visual projection showing:
 * - Live clip position following the cursor
 * - Live overwrite/split/trimming of colliding clips on the same track
 * - Ghost lanes for auto-created new tracks
 * - Incompatibility detection (preventing cross-type video<->audio drops)
 */
export function computeDragPreview(
  state: ProjectState,
  preview: DragPreview | null
): PreviewStateResult {
  if (!preview) {
    return {
      tracks: state.tracks,
      items: state.items,
      isCompatible: true,
      isNewTrack: false,
    }
  }

  // ──── 1. Move Existing Item(s) ────
  if (preview.type === 'move') {
    const existing = state.items[preview.itemId]
    if (!existing) {
      return {
        tracks: state.tracks,
        items: state.items,
        isCompatible: true,
        isNewTrack: false,
      }
    }

    const asset = state.assets[existing.assetId]
    const effectiveType = getItemEffectiveType(existing, asset)
    const isNew = preview.targetTrackId.startsWith('NEW_')

    // Track compatibility check
    let isCompatible = true
    if (isNew) {
      if (preview.targetTrackId === 'NEW_VIDEO_TRACK') {
        isCompatible = isTrackCompatible('video', effectiveType)
      } else if (preview.targetTrackId === 'NEW_AUDIO_TRACK') {
        isCompatible = isTrackCompatible('audio', effectiveType)
      } else if (preview.targetTrackId === 'NEW_CAPTION_TRACK') {
        isCompatible = isTrackCompatible('caption', effectiveType)
      } else if (preview.targetTrackId === 'NEW_GRAPHICS_TRACK') {
        isCompatible = isTrackCompatible('graphics', effectiveType)
      }
    } else {
      const targetTrack = state.tracks.find((t) => t.id === preview.targetTrackId)
      if (!targetTrack || !isTrackCompatible(targetTrack.type, effectiveType)) {
        isCompatible = false
      }
    }

    if (!isCompatible) {
      return {
        tracks: state.tracks,
        items: state.items,
        targetTrackId: preview.targetTrackId,
        isCompatible: false,
        isNewTrack: isNew,
        previewItemId: preview.itemId,
      }
    }

    const allMoves = [
      {
        itemId: preview.itemId,
        targetStartTime: preview.targetStartTime,
        targetTrackId: preview.targetTrackId,
      },
      ...(preview.additionalMoves ?? []),
    ]

    // Build preview tracks (including ghost tracks if new)
    const nextTracks = [...state.tracks]
    const needsGhostVideo = allMoves.some((m) => m.targetTrackId === 'NEW_VIDEO_TRACK')
    const needsGhostAudio = allMoves.some((m) => m.targetTrackId === 'NEW_AUDIO_TRACK')
    const needsGhostCaption = allMoves.some((m) => m.targetTrackId === 'NEW_CAPTION_TRACK')

    if (needsGhostCaption && !nextTracks.some((t) => t.id === 'NEW_CAPTION_TRACK')) {
      const cCount = state.tracks.filter((t) => t.type === 'caption').length
      const ghostTrack: Track = {
        id: 'NEW_CAPTION_TRACK',
        name: `Caption ${cCount + 1}`,
        type: 'caption',
        visible: true,
        locked: false,
      }
      nextTracks.unshift(ghostTrack)
    }

    if (needsGhostVideo && !nextTracks.some((t) => t.id === 'NEW_VIDEO_TRACK')) {
      const vCount = state.tracks.filter((t) => t.type === 'video').length
      const ghostTrack: Track = {
        id: 'NEW_VIDEO_TRACK',
        name: `Video ${vCount + 1}`,
        type: 'video',
        visible: true,
        locked: false,
      }
      let firstVideoIndex = state.tracks.findIndex((t) => t.type === 'video')
      if (firstVideoIndex < 0) firstVideoIndex = 0
      nextTracks.splice(firstVideoIndex, 0, ghostTrack)
    }

    if (needsGhostAudio && !nextTracks.some((t) => t.id === 'NEW_AUDIO_TRACK')) {
      const aCount = state.tracks.filter((t) => t.type === 'audio').length
      const ghostTrack: Track = {
        id: 'NEW_AUDIO_TRACK',
        name: `Audio ${aCount + 1}`,
        type: 'audio',
        visible: true,
        locked: false,
      }
      nextTracks.push(ghostTrack)
    }

    // Place all moved items at target time on target track
    const nextItems = { ...state.items }
    for (const m of allMoves) {
      const it = state.items[m.itemId]
      if (it) {
        nextItems[m.itemId] = {
          ...it,
          startTime: Math.max(0, m.targetStartTime),
          trackId: m.targetTrackId,
        }
      }
    }

    let stateWithMoved: ProjectState = {
      ...state,
      tracks: nextTracks,
      items: nextItems,
    }

    // Resolve track overwrites visually!
    let splitCount = 0
    for (const m of allMoves) {
      if (stateWithMoved.items[m.itemId]) {
        stateWithMoved = resolveTrackOverwrites(stateWithMoved, m.itemId, (p) => `${m.itemId}-${p}-split-${++splitCount}`)
      }
    }

    return {
      tracks: nextTracks,
      items: stateWithMoved.items,
      targetTrackId: preview.targetTrackId,
      isCompatible: true,
      isNewTrack: isNew || needsGhostVideo || needsGhostAudio,
      previewItemId: preview.itemId,
    }
  }

  // ──── 2. Trim Existing Item ────
  if (preview.type === 'trim') {
    const existing = state.items[preview.itemId]
    if (!existing) {
      return {
        tracks: state.tracks,
        items: state.items,
        isCompatible: true,
        isNewTrack: false,
      }
    }

    const allTrims = [
      { itemId: preview.itemId, edge: preview.edge, targetTime: preview.targetTime },
      ...(preview.additionalTrims ?? []),
    ]

    const nextItems = { ...state.items }
    const minDuration = 1 / (state.settings.fps || 30)

    for (const t of allTrims) {
      const item = state.items[t.itemId]
      if (!item) continue

      const asset = state.assets[item.assetId]
      const speedRatio = item.duration > 0 ? (item.sourceOut - item.sourceIn) / item.duration : 1

      let nextStartTime = item.startTime
      let nextDuration = item.duration
      let nextSourceIn = item.sourceIn
      let nextSourceOut = item.sourceOut

      if (t.edge === 'right') {
        let newDuration = Math.max(minDuration, t.targetTime - item.startTime)
        let newSourceOut = item.sourceIn + newDuration * speedRatio

        if (asset?.duration && newSourceOut > asset.duration) {
          newSourceOut = asset.duration
          newDuration = Math.max(minDuration, (newSourceOut - item.sourceIn) / speedRatio)
        }

        nextStartTime = item.startTime
        nextDuration = newDuration
        nextSourceIn = item.sourceIn
        nextSourceOut = newSourceOut
      } else {
        let newStart = Math.max(0, t.targetTime)
        const existingEnd = item.startTime + item.duration
        const maxStart = existingEnd - minDuration

        if (newStart > maxStart) {
          newStart = maxStart
        }

        const delta = newStart - item.startTime
        let newSourceIn = item.sourceIn + delta * speedRatio

        if (newSourceIn < 0) {
          newSourceIn = 0
          newStart = item.startTime - (item.sourceIn / speedRatio)
        }

        nextStartTime = Math.max(0, newStart)
        nextDuration = Math.max(minDuration, existingEnd - nextStartTime)
        nextSourceIn = newSourceIn
        nextSourceOut = item.sourceOut
      }

      nextItems[t.itemId] = {
        ...item,
        startTime: nextStartTime,
        duration: nextDuration,
        sourceIn: nextSourceIn,
        sourceOut: nextSourceOut,
      }
    }

    let stateWithTrimmed: ProjectState = {
      ...state,
      items: nextItems,
    }

    for (const t of allTrims) {
      stateWithTrimmed = resolveTrackOverwrites(stateWithTrimmed, t.itemId, (p) => `${p}-preview-${Math.random()}`)
    }

    return {
      tracks: state.tracks,
      items: stateWithTrimmed.items,
      targetTrackId: existing.trackId,
      isCompatible: true,
      isNewTrack: false,
      previewItemId: preview.itemId,
    }
  }

  // ──── 3. Media Library Drop Preview ────
  if (preview.type === 'media-drop') {
    const isNew = preview.targetTrackId.startsWith('NEW_')
    let isCompatible = true

    if (isNew) {
      if (preview.targetTrackId === 'NEW_VIDEO_TRACK') {
        isCompatible = isTrackCompatible('video', preview.assetType)
      } else if (preview.targetTrackId === 'NEW_AUDIO_TRACK') {
        isCompatible = isTrackCompatible('audio', preview.assetType)
      } else if (preview.targetTrackId === 'NEW_CAPTION_TRACK') {
        isCompatible = isTrackCompatible('caption', preview.assetType)
      } else if (preview.targetTrackId === 'NEW_GRAPHICS_TRACK') {
        isCompatible = isTrackCompatible('graphics', preview.assetType)
      } else {
        isCompatible = false
      }
    } else {
      const targetTrack = state.tracks.find((t) => t.id === preview.targetTrackId)
      if (!targetTrack || !isTrackCompatible(targetTrack.type, preview.assetType)) {
        isCompatible = false
      }
    }

    if (!isCompatible) {
      return {
        tracks: state.tracks,
        items: state.items,
        targetTrackId: preview.targetTrackId,
        isCompatible: false,
        isNewTrack: isNew,
      }
    }

    // Build tracks with ghost track if needed
    const nextTracks = [...state.tracks]
    if (isNew) {
      const isAudio = preview.targetTrackId === 'NEW_AUDIO_TRACK'
      const isCaption = preview.targetTrackId === 'NEW_CAPTION_TRACK'
      const ghostTrack: Track = {
        id: preview.targetTrackId,
        name: isAudio
          ? `Audio ${state.tracks.filter((t) => t.type === 'audio').length + 1}`
          : isCaption
          ? `Caption ${state.tracks.filter((t) => t.type === 'caption').length + 1}`
          : `Video ${state.tracks.filter((t) => t.type === 'video').length + 1}`,
        type: isAudio ? 'audio' : isCaption ? 'caption' : 'video',
        visible: true,
        locked: false,
      }
      if (isCaption) {
        nextTracks.unshift(ghostTrack)
      } else if (!isAudio) {
        // Video tracks stack upwards: insert at top of video tracks
        let firstVideoIndex = state.tracks.findIndex((t) => t.type === 'video')
        if (firstVideoIndex < 0) firstVideoIndex = 0
        nextTracks.splice(firstVideoIndex, 0, ghostTrack)
      } else {
        // Audio tracks stack downwards: append at bottom
        nextTracks.push(ghostTrack)
      }
    }

    const ghostItemId = '__preview_media_drop__'
    const ghostItem: TimelineItem = {
      id: ghostItemId,
      trackId: preview.targetTrackId,
      assetId: preview.assetId,
      itemType: preview.itemType,
      startTime: Math.max(0, preview.targetStartTime),
      duration: preview.duration,
      sourceIn: 0,
      sourceOut: preview.duration,
      transform: { ...DEFAULT_TRANSFORM },
      streamType:
        preview.assetType === 'audio'
          ? 'audio'
          : preview.assetType === 'caption'
          ? 'caption'
          : 'video',
      text: preview.text,
      caption: preview.caption,
      solid: preview.solid,
    }

    const itemsToInsert: Record<string, TimelineItem> = {
      [ghostItemId]: ghostItem,
    }

    // If dragging a video with audio onto a video track, also preview the audio ghost clip on audio track
    const ghostAudioItemId = '__preview_media_drop_audio__'
    const isVideoTrack = preview.targetTrackId === 'NEW_VIDEO_TRACK' || state.tracks.find((t) => t.id === preview.targetTrackId)?.type === 'video'
    if (preview.assetType === 'video' && preview.hasAudio && isVideoTrack) {
      const audioTrack = preview.audioTrackId ?? nextTracks.find((t) => t.type === 'audio')?.id ?? 'NEW_AUDIO_TRACK'
      if (audioTrack === 'NEW_AUDIO_TRACK' && !nextTracks.some((t) => t.id === 'NEW_AUDIO_TRACK')) {
        const aCount = state.tracks.filter((t) => t.type === 'audio').length
        nextTracks.push({
          id: 'NEW_AUDIO_TRACK',
          name: `Audio ${aCount + 1}`,
          type: 'audio',
          visible: true,
          locked: false,
        })
      }
      const ghostAudioItem: TimelineItem = {
        id: ghostAudioItemId,
        trackId: audioTrack,
        assetId: preview.assetId,
        startTime: Math.max(0, preview.targetStartTime),
        duration: preview.duration,
        sourceIn: 0,
        sourceOut: preview.duration,
        transform: { ...DEFAULT_TRANSFORM },
        streamType: 'audio',
        linkedItemId: ghostItemId,
      }
      ghostItem.linkedItemId = ghostAudioItemId
      itemsToInsert[ghostAudioItemId] = ghostAudioItem
    }

    let stateWithGhost: ProjectState = {
      ...state,
      tracks: nextTracks,
      items: {
        ...state.items,
        ...itemsToInsert,
      },
    }

    const isLayerCreation =
      preview.itemType === 'text' ||
      preview.itemType === 'caption' ||
      preview.itemType === 'solid' ||
      preview.itemType === 'adjustment'

    let resolved = stateWithGhost
    if (!isLayerCreation) {
      let ghostSplitCount = 0
      resolved = resolveTrackOverwrites(stateWithGhost, ghostItemId, (p) => `${ghostItemId}-${p}-split-${++ghostSplitCount}`)
      if (itemsToInsert[ghostAudioItemId]) {
        stateWithGhost = {
          ...stateWithGhost,
          items: resolved.items,
        }
        resolved = resolveTrackOverwrites(stateWithGhost, ghostAudioItemId, (p) => `${ghostAudioItemId}-${p}-split-${++ghostSplitCount}`)
      }
    }

    return {
      tracks: nextTracks,
      items: resolved.items,
      targetTrackId: preview.targetTrackId,
      isCompatible: true,
      isNewTrack: isNew,
      previewItemId: ghostItemId,
    }
  }

  return {
    tracks: state.tracks,
    items: state.items,
    isCompatible: true,
    isNewTrack: false,
  }
}
