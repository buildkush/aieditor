import type { ProjectState } from '../project/projectState'
import type { MediaAsset } from '../media/types'
import type { TimelineItem, Track, TimelineTransition } from '../timeline/types'

export interface ActiveVideoClip {
  item: TimelineItem
  asset: MediaAsset
  sourceTime: number
  isMissing: boolean
  track: Track
  isSourceHeld?: boolean
}

export interface ActiveAudioClip {
  item: TimelineItem
  asset: MediaAsset
  sourceTime: number
  isMissing: boolean
  isMuted: boolean
  track: Track
}

export interface ActiveTransition {
  transition: TimelineTransition
  progress: number // 0.0 to 1.0
}

export interface PlaybackFrameInfo {
  playheadTime: number
  activeVideo: ActiveVideoClip | null // Topmost active video for backwards compatibility
  activeVideos: ActiveVideoClip[] // All active video clips ordered from bottom (V1) to top (V2, V3...)
  activeAudio: ActiveAudioClip[] // All active audio clips for simultaneous mixing
  activeTransitions?: ActiveTransition[]
  preloadVideos?: ActiveVideoClip[]
  isEmpty: boolean
}

/**
 * Deterministically computes the active video and audio clips at any given timeline playhead position.
 * Respects:
 * - Track visibility and ordering (topmost visible video track takes visual precedence)
 * - Track mute flags
 * - Clip startTime, duration, sourceIn, and sourceOut
 * - Offline / missing media status
 */
export function getPlaybackFrameInfo(state: ProjectState, playheadTime: number): PlaybackFrameInfo {
  const visualTracks = state.tracks.filter(
    (t) => (t.type === 'video' || t.type === 'graphics' || t.type === 'overlay' || t.type === 'caption') && t.visible !== false
  )
  const audioTracks = state.tracks.filter((t) => t.type === 'audio')

  // Active transitions at this playhead time
  const activeTransitions: ActiveTransition[] = []
  for (const tr of Object.values(state.transitions || {})) {
    if (playheadTime >= tr.startTime && playheadTime <= tr.startTime + tr.duration) {
      const dur = Math.max(0.01, tr.duration)
      const progress = Math.max(0, Math.min(1, (playheadTime - tr.startTime) / dur))
      activeTransitions.push({
        transition: tr,
        progress,
      })
    }
  }

  const resolveClip = (
    item: TimelineItem,
    targetPlayheadTime: number,
    track: Track
  ): ActiveVideoClip | null => {
    const isGenerated =
      item.itemType === 'solid' ||
      item.itemType === 'text' ||
      item.itemType === 'caption' ||
      item.itemType === 'adjustment' ||
      !!item.solid ||
      !!item.text ||
      !!item.caption

    const asset = state.assets[item.assetId]
    if (!asset && !isGenerated) return null

    const speed = item.speed?.speed ?? 1
    const isReversed = !!item.speed?.reversed
    const elapsed = targetPlayheadTime - item.startTime
    const rawSourceTime = isReversed
      ? item.sourceOut - elapsed * speed
      : item.sourceIn + elapsed * speed

    const inTransition = activeTransitions.some(
      (at) =>
        at.transition.leftClipId === item.id ||
        at.transition.rightClipId === item.id
    )

    let sourceTime: number
    let isSourceHeld = false
    if (inTransition) {
      // In transition: utilize available source handles (frames before in-point or after out-point).
      // If the asset doesn't have extra handles (full media used), freeze frame at boundary (0 or asset.duration)
      const assetMin = 0
      const assetMax = asset?.duration ? Math.max(0, asset.duration - 0.01) : item.sourceOut
      sourceTime = Math.max(assetMin, Math.min(assetMax, rawSourceTime))
      isSourceHeld = rawSourceTime < assetMin || rawSourceTime >= assetMax
    } else {
      const maxSourceTime = asset?.duration
        ? Math.min(item.sourceOut, Math.max(item.sourceIn, asset.duration - 0.01))
        : item.sourceOut
      sourceTime = Math.max(item.sourceIn, Math.min(maxSourceTime, rawSourceTime))
    }
    const isMissing = !!asset?.isMissing

    const resolvedAsset: MediaAsset = asset ?? {
      id: item.id,
      name:
        item.itemType === 'adjustment'
          ? 'Adjustment Layer'
          : item.text?.text
          ? `Text: ${item.text.text}`
          : item.solid
          ? 'Solid Color'
          : item.caption
          ? 'Caption'
          : 'Generated Layer',
      type:
        item.itemType === 'caption' || item.caption
          ? 'caption'
          : item.itemType === 'adjustment'
          ? 'video'
          : 'image',
      path: '',
    }

    return {
      item,
      asset: resolvedAsset,
      sourceTime,
      isMissing,
      track,
      isSourceHeld,
    }
  }

  const activeVideosMap: { trackIndex: number; clip: ActiveVideoClip }[] = []

  visualTracks.forEach((track, trackIndex) => {
    // Check if there is an active two-clip transition on this track
    const activeTr = activeTransitions.find(
      (at) =>
        at.transition.trackId === track.id &&
        at.transition.leftClipId &&
        at.transition.rightClipId &&
        state.items[at.transition.leftClipId] &&
        state.items[at.transition.rightClipId]
    )

    if (activeTr && activeTr.transition.leftClipId && activeTr.transition.rightClipId) {
      const leftItem = state.items[activeTr.transition.leftClipId]
      const rightItem = state.items[activeTr.transition.rightClipId]
      if (leftItem && rightItem) {
        const leftClip = resolveClip(leftItem, playheadTime, track)
        const rightClip = resolveClip(rightItem, playheadTime, track)
        if (leftClip) {
          activeVideosMap.push({ trackIndex, clip: leftClip })
        }
        if (rightClip) {
          // Place incoming clip right after outgoing clip so it composites on top
          activeVideosMap.push({ trackIndex: trackIndex + 0.1, clip: rightClip })
        }
        return
      }
    }

    for (const item of Object.values(state.items)) {
      if (item.trackId !== track.id) continue

      const itemEnd = item.startTime + item.duration
      if (playheadTime >= item.startTime && playheadTime < itemEnd) {
        const clip = resolveClip(item, playheadTime, track)
        if (clip) {
          activeVideosMap.push({ trackIndex, clip })
        }
        break
      }
    }
  })

  // Natural track ordering: V1 (bottom) is at the end of videoTracks array if inverted, or index-based.
  // We sort by track level:
  // Video tracks: track-v1 < track-v2 < track-v3 (1, 2, 3...)
  // Graphics tracks: 100 + index
  // Caption tracks: 200 + index (rendered on top of video)
  const getTrackLevel = (t: Track): number => {
    if (t.type === 'video') {
      const match = t.id.match(/track-v(\d+)/i) || t.name.match(/video\s*(\d+)/i)
      if (match) return parseInt(match[1], 10)
      const vTracks = visualTracks.filter((vt) => vt.type === 'video')
      const idx = vTracks.findIndex((vt) => vt.id === t.id)
      if (idx !== -1) {
        return vTracks.length - idx
      }
      return 1
    }
    if (t.type === 'graphics' || t.type === 'overlay') {
      const gTracks = visualTracks.filter((vt) => vt.type === 'graphics' || vt.type === 'overlay')
      return 100 + gTracks.findIndex((gt) => gt.id === t.id)
    }
    if (t.type === 'caption') {
      const cTracks = visualTracks.filter((vt) => vt.type === 'caption')
      return 200 + cTracks.findIndex((ct) => ct.id === t.id)
    }
    return 1
  }

  activeVideosMap.sort((a, b) => {
    const levelDiff = getTrackLevel(a.clip.track) - getTrackLevel(b.clip.track)
    if (levelDiff !== 0) return levelDiff
    return a.trackIndex - b.trackIndex
  })
  const activeVideos: ActiveVideoClip[] = activeVideosMap.map((entry) => entry.clip)
  // Mount upcoming transition participants early. Keep their keyed media elements
  // alive when they become visible, so decoding does not start at the first frame.
  const preloadVideos: ActiveVideoClip[] = []
  const mountedIds = new Set(activeVideos.map(clip => clip.item.id))
  for (const tr of Object.values(state.transitions || {})) {
    if (tr.startTime <= playheadTime || tr.startTime - playheadTime > 1) continue
    const track = visualTracks.find(t => t.id === tr.trackId)
    if (!track) continue
    for (const id of [tr.leftClipId, tr.rightClipId]) {
      if (!id || mountedIds.has(id)) continue
      const item = state.items[id]
      if (!item || item.trackId !== track.id) continue
      const clip = resolveClip(item, item.startTime, track)
      if (!clip) continue
      preloadVideos.push(clip)
      mountedIds.add(id)
    }
  }
  // Topmost visual layer is the highest level (last in sorted array)
  const activeVideo: ActiveVideoClip | null = activeVideos.length > 0 ? activeVideos[activeVideos.length - 1] : null

  // Active audio items
  const activeAudio: ActiveAudioClip[] = []
  for (const track of audioTracks) {
    for (const item of Object.values(state.items)) {
      if (item.trackId !== track.id) continue

      const itemEnd = item.startTime + item.duration
      if (playheadTime >= item.startTime && playheadTime < itemEnd) {
        const asset = state.assets[item.assetId]
        if (!asset) continue

        const speed = item.speed?.speed ?? 1
        const isReversed = !!item.speed?.reversed
        const elapsed = playheadTime - item.startTime
        const rawSourceTime = isReversed
          ? item.sourceOut - elapsed * speed
          : item.sourceIn + elapsed * speed
        const sourceTime = Math.max(item.sourceIn, Math.min(item.sourceOut, rawSourceTime))

        activeAudio.push({
          item,
          asset,
          sourceTime,
          isMissing: !!asset.isMissing,
          isMuted: !!track.muted,
          track,
        })
      }
    }
  }


  return {
    playheadTime,
    activeVideo,
    activeVideos,
    activeAudio,
    activeTransitions,
    preloadVideos,
    isEmpty: activeVideos.length === 0 && activeAudio.length === 0,
  }
}

/**
 * Calculates the next significant playhead boundary (item start or end) after the given time.
 * Useful for jumping between edit cuts.
 */
export function getNextTimelineCut(state: ProjectState, playheadTime: number): number | null {
  let nextCut: number | null = null

  for (const item of Object.values(state.items)) {
    const start = item.startTime
    const end = item.startTime + item.duration

    if (start > playheadTime + 0.001) {
      if (nextCut === null || start < nextCut) {
        nextCut = start
      }
    }
    if (end > playheadTime + 0.001) {
      if (nextCut === null || end < nextCut) {
        nextCut = end
      }
    }
  }

  return nextCut
}

/**
 * Calculates the previous significant playhead boundary before the given time.
 */
export function getPreviousTimelineCut(state: ProjectState, playheadTime: number): number | null {
  let prevCut: number | null = null

  for (const item of Object.values(state.items)) {
    const start = item.startTime
    const end = item.startTime + item.duration

    if (start < playheadTime - 0.001) {
      if (prevCut === null || start > prevCut) {
        prevCut = start
      }
    }
    if (end < playheadTime - 0.001) {
      if (prevCut === null || end > prevCut) {
        prevCut = end
      }
    }
  }

  return prevCut
}
