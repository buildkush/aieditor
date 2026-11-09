import type { Track } from './types'
import { isTrackCompatible } from './types'

export interface TrackLaneBounds {
  trackId: string
  top: number
  bottom: number
}

export interface TargetTrackResult {
  targetTrackId: string
  isCompatible: boolean
}

/**
 * Determines the target track and compatibility based on vertical pointer position (clientY).
 *
 * Core Rules:
 * 1. Video Layer: A new track is ONLY added when dragged UPWARDS (above topmost video track / top edge threshold).
 *    Video clips dragged downwards into audio or below are strictly forbidden/incompatible.
 * 2. Audio Layer: A new track is ONLY added when dragged DOWNWARDS (below bottommost audio track / bottom edge threshold).
 *    Audio clips dragged upwards into video or above are strictly forbidden/incompatible.
 */
export function resolveTargetTrackFromY(
  clientY: number,
  assetType: string,
  tracks: Track[],
  laneBounds: TrackLaneBounds[],
  allowNewTrack: boolean = true
): TargetTrackResult {
  const isVideoAsset = isTrackCompatible('video', assetType)
  const isAudioAsset = isTrackCompatible('audio', assetType)

  if (laneBounds.length === 0) {
    const existing = tracks.find((t) => isTrackCompatible(t.type, assetType))
    const defaultTrack =
      assetType === 'caption'
        ? 'NEW_CAPTION_TRACK'
        : isAudioAsset
        ? 'NEW_AUDIO_TRACK'
        : 'NEW_VIDEO_TRACK'
    return {
      targetTrackId: existing ? existing.id : defaultTrack,
      isCompatible: true,
    }
  }

  const captionBounds = laneBounds.filter((b) => {
    const trk = tracks.find((t) => t.id === b.trackId)
    return trk?.type === 'caption'
  })

  const videoBounds = laneBounds.filter((b) => {
    const trk = tracks.find((t) => t.id === b.trackId)
    return trk?.type === 'video'
  })

  const audioBounds = laneBounds.filter((b) => {
    const trk = tracks.find((t) => t.id === b.trackId)
    return trk?.type === 'audio'
  })

  // 0. CAPTION ASSET RULES
  if (assetType === 'caption') {
    const firstCaption = captionBounds[0]
    for (const b of captionBounds) {
      if (clientY >= b.top && clientY <= b.bottom) {
        return { targetTrackId: b.trackId, isCompatible: true }
      }
    }

    const topBound = firstCaption || videoBounds[0] || laneBounds[0]
    if (topBound && clientY < topBound.top) {
      return { targetTrackId: 'NEW_CAPTION_TRACK', isCompatible: true }
    }

    // Captions dragged onto video or audio tracks are STRICTLY INCOMPATIBLE
    for (const b of videoBounds) {
      if (clientY >= b.top && clientY <= b.bottom) {
        return { targetTrackId: b.trackId, isCompatible: false }
      }
    }

    for (const b of audioBounds) {
      if (clientY >= b.top && clientY <= b.bottom) {
        return { targetTrackId: b.trackId, isCompatible: false }
      }
    }

    const existingCaption = tracks.find((t) => t.type === 'caption')
    return {
      targetTrackId: existingCaption ? existingCaption.id : 'NEW_CAPTION_TRACK',
      isCompatible: false,
    }
  }

  // 1. VIDEO ASSET RULES
  if (isVideoAsset) {
    const firstVideo = videoBounds[0]
    if (!firstVideo) {
      // No video tracks currently visible in laneBounds
      for (const b of audioBounds) {
        if (clientY >= b.top && clientY <= b.bottom) {
          const defaultVideoTrackId = tracks.find((t) => t.type === 'video')?.id ?? 'NEW_VIDEO_TRACK'
          return { targetTrackId: defaultVideoTrackId, isCompatible: false }
        }
      }
      const existingVideo = tracks.find((t) => t.type === 'video')
      return { targetTrackId: existingVideo ? existingVideo.id : 'NEW_VIDEO_TRACK', isCompatible: true }
    }

    // Inside an existing video lane (checked first so dragging within a lane never triggers a new track)
    for (const b of videoBounds) {
      if (clientY >= b.top && clientY <= b.bottom) {
        return { targetTrackId: b.trackId, isCompatible: true }
      }
    }

    // Dragged upwards strictly above topmost video track
    if (clientY < firstVideo.top) {
      if (!allowNewTrack) {
        return { targetTrackId: firstVideo.trackId, isCompatible: true }
      }
      return { targetTrackId: 'NEW_VIDEO_TRACK', isCompatible: true }
    }

    // Dragged downwards into audio or below all video lanes -> Incompatible (no new track!)
    const lastVideo = videoBounds[videoBounds.length - 1]
    if (clientY > lastVideo.bottom) {
      for (const b of audioBounds) {
        if (clientY >= b.top && clientY <= b.bottom) {
          return { targetTrackId: b.trackId, isCompatible: false }
        }
      }
      const defaultAudioTrackId = audioBounds[0]?.trackId ?? 'track-a1'
      return { targetTrackId: defaultAudioTrackId, isCompatible: false }
    }

    return { targetTrackId: firstVideo.trackId, isCompatible: true }
  }

  // 2. AUDIO ASSET RULES
  if (isAudioAsset) {
    const lastAudio = audioBounds[audioBounds.length - 1]
    if (!lastAudio) {
      // No audio tracks currently visible in laneBounds
      for (const b of videoBounds) {
        if (clientY >= b.top && clientY <= b.bottom) {
          const defaultAudioTrackId = tracks.find((t) => t.type === 'audio')?.id ?? 'NEW_AUDIO_TRACK'
          return { targetTrackId: defaultAudioTrackId, isCompatible: false }
        }
      }
      const existingAudio = tracks.find((t) => t.type === 'audio')
      return { targetTrackId: existingAudio ? existingAudio.id : 'NEW_AUDIO_TRACK', isCompatible: true }
    }

    // Inside an existing audio lane (checked first so dragging within a lane never triggers a new track)
    for (const b of audioBounds) {
      if (clientY >= b.top && clientY <= b.bottom) {
        return { targetTrackId: b.trackId, isCompatible: true }
      }
    }

    // Dragged downwards strictly below bottommost audio track
    if (clientY > lastAudio.bottom) {
      if (!allowNewTrack) {
        return { targetTrackId: lastAudio.trackId, isCompatible: true }
      }
      return { targetTrackId: 'NEW_AUDIO_TRACK', isCompatible: true }
    }

    // Dragged upwards into video or above all audio lanes -> Incompatible (no new track!)
    const firstAudio = audioBounds[0]
    if (firstAudio && clientY < firstAudio.top) {
      for (const b of videoBounds) {
        if (clientY >= b.top && clientY <= b.bottom) {
          return { targetTrackId: b.trackId, isCompatible: false }
        }
      }
      const defaultVideoTrackId = videoBounds[videoBounds.length - 1]?.trackId ?? 'track-v1'
      return { targetTrackId: defaultVideoTrackId, isCompatible: false }
    }

    return { targetTrackId: lastAudio.trackId, isCompatible: true }
  }

  // 3. OTHER ASSETS (e.g. caption, graphics)
  for (const b of laneBounds) {
    if (clientY >= b.top && clientY <= b.bottom) {
      const trk = tracks.find((t) => t.id === b.trackId)
      const compatible = trk ? isTrackCompatible(trk.type, assetType) : false
      return { targetTrackId: b.trackId, isCompatible: compatible }
    }
  }

  return {
    targetTrackId: laneBounds[0]?.trackId ?? '',
    isCompatible: false,
  }
}

/**
 * Resolves the corresponding track of partnerType (video <-> audio) matching the layer number
 * of the target track of sourceItemType.
 *
 * Symmetrical layer alignment:
 * Layer 1 Video <-> Layer 1 Audio
 * Layer 2 Video <-> Layer 2 Audio
 * Layer N Video <-> Layer N Audio
 *
 * If the corresponding layer does not exist yet:
 * Returns 'NEW_AUDIO_TRACK' (if partnerType is audio) or 'NEW_VIDEO_TRACK' (if partnerType is video).
 */
export function getCorrespondingLayerTrack(
  tracks: Track[],
  sourceItemType: 'video' | 'audio',
  sourceTargetTrackId: string,
  partnerType: 'video' | 'audio'
): string {
  if (sourceItemType === partnerType) {
    return sourceTargetTrackId
  }

  // 1. If source target is creating a new track
  if (sourceTargetTrackId === 'NEW_VIDEO_TRACK') {
    const vTracks = tracks.filter((t) => t.type === 'video')
    const targetLayerNum = vTracks.length + 1
    const matchingAudio = tracks.find(
      (t) => t.type === 'audio' && t.name.match(/\d+$/)?.[0] === String(targetLayerNum)
    )
    return matchingAudio ? matchingAudio.id : 'NEW_AUDIO_TRACK'
  }

  if (sourceTargetTrackId === 'NEW_AUDIO_TRACK') {
    const aTracks = tracks.filter((t) => t.type === 'audio')
    const targetLayerNum = aTracks.length + 1
    const matchingVideo = tracks.find(
      (t) => t.type === 'video' && t.name.match(/\d+$/)?.[0] === String(targetLayerNum)
    )
    return matchingVideo ? matchingVideo.id : 'NEW_VIDEO_TRACK'
  }

  // 2. Existing track
  const srcTrack = tracks.find((t) => t.id === sourceTargetTrackId)
  if (!srcTrack) {
    return partnerType === 'audio'
      ? (tracks.find((t) => t.type === 'audio')?.id ?? 'NEW_AUDIO_TRACK')
      : (tracks.find((t) => t.type === 'video')?.id ?? 'NEW_VIDEO_TRACK')
  }

  const match = srcTrack.name.match(/\d+$/)
  const layerNum = match ? parseInt(match[0], 10) : 1

  const matchingPartner = tracks.find(
    (t) => t.type === partnerType && t.name.match(/\d+$/)?.[0] === String(layerNum)
  )
  if (matchingPartner) {
    return matchingPartner.id
  }

  return partnerType === 'audio' ? 'NEW_AUDIO_TRACK' : 'NEW_VIDEO_TRACK'
}

