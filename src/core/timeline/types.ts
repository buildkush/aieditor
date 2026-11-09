import type { PropertyKeyframeMap } from './keyframeTypes'

export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'soft-light'
  | 'hard-light'
  | 'darken'
  | 'lighten'
  | 'difference'
  | 'add'
  | 'color-dodge'
  | 'color-burn'
  | 'exclusion'
  | 'luminosity'

export interface Transform {
  x: number
  y: number
  scale: number
  scaleX?: number
  scaleY?: number
  rotation: number
  opacity: number
  anchorX?: number
  anchorY?: number
  pitch?: number
  yaw?: number
  flipH?: boolean
  flipV?: boolean
  blendMode?: BlendMode | string
}

export const DEFAULT_TRANSFORM: Readonly<Transform> = Object.freeze({
  x: 0,
  y: 0,
  scale: 1,
  rotation: 0,
  opacity: 1,
})

export interface Crop {
  left: number
  right: number
  top: number
  bottom: number
}

export const DEFAULT_CROP: Readonly<Crop> = Object.freeze({
  left: 0,
  right: 0,
  top: 0,
  bottom: 0,
})

export interface AudioProperties {
  volume: number
  pan: number
  muted?: boolean
}

export const DEFAULT_AUDIO_PROPERTIES: Readonly<AudioProperties> = Object.freeze({
  volume: 1,
  pan: 0,
  muted: false,
})

export interface SpeedProperties {
  speed: number // 1.0 = 100%
  fps?: number
  reversed?: boolean
}

export const DEFAULT_SPEED_PROPERTIES: Readonly<SpeedProperties> = Object.freeze({
  speed: 1,
  reversed: false,
})

export interface SolidProperties {
  color: string
}

export const DEFAULT_SOLID_PROPERTIES: Readonly<SolidProperties> = Object.freeze({
  color: '#3b82f6',
})

export interface TextProperties {
  text: string
  fontFamily: string
  fontSize: number
  fontWeight?: string | number
  fontStyle?: 'normal' | 'italic'
  underline?: boolean
  textCase?: 'none' | 'uppercase' | 'lowercase' | 'capitalize'
  color: string
  align?: 'left' | 'center' | 'right'
  lineHeight?: number
  letterSpacing?: number
  strokeColor?: string
  strokeWidth?: number
  // Drop Shadow
  shadowEnabled?: boolean
  shadowColor?: string
  shadowBlur?: number
  shadowOffsetX?: number
  shadowOffsetY?: number
  shadowOpacity?: number
  // Background Box
  backgroundEnabled?: boolean
  backgroundColor?: string
  backgroundOpacity?: number
  bgStrokeColor?: string
  bgStrokeWidth?: number
  padding?: number
  paddingX?: number
  paddingY?: number
  cornerRadius?: number
  bgOffsetX?: number
  bgOffsetY?: number
}

export const DEFAULT_TEXT_PROPERTIES: Readonly<TextProperties> = Object.freeze({
  text: 'Text Layer',
  fontFamily: 'Inter, sans-serif',
  fontSize: 64,
  fontWeight: '700',
  fontStyle: 'normal',
  underline: false,
  textCase: 'none',
  color: '#FFFFFF',
  align: 'center',
  lineHeight: 1.2,
  letterSpacing: 0,
  strokeColor: '#000000',
  strokeWidth: 0,
  shadowEnabled: false,
  shadowColor: '#000000',
  shadowBlur: 10,
  shadowOffsetX: 2,
  shadowOffsetY: 4,
  shadowOpacity: 0.8,
  backgroundEnabled: false,
  backgroundColor: '#000000',
  backgroundOpacity: 0.7,
  bgStrokeColor: '#ffffff',
  bgStrokeWidth: 0,
  padding: 12,
  paddingX: 16,
  paddingY: 10,
  cornerRadius: 6,
  bgOffsetX: 0,
  bgOffsetY: 0,
})

export interface CaptionWord {
  id?: string
  word: string
  startTime: number
  endTime: number
  start?: number
  end?: number
  color?: string
  fontSize?: number
  fontWeight?: string | number
  fontFamily?: string
  fontStyle?: 'normal' | 'italic'
  backgroundColor?: string
  scale?: number
  highlight?: boolean
}

export interface CaptionProperties {
  text: string
  style?: Partial<TextProperties>
  words?: CaptionWord[]
  preset?: 'Clean' | 'Bold' | 'Meme' | 'Highlight' | 'Minimal' | string
  activeWordColor?: string
  presentation?: CaptionPresentation
}

/** Fixed emphasis is independent of the playhead-based speaking highlight. */
export interface CaptionPresentation {
  timing: 'none' | 'active' | 'progress'
  reveal?: 'all' | 'progressive' | 'single'
  highlightStyle?: 'color' | 'box' | 'underline'
  highlightBackground?: string
  highlightRadius?: number
  underline?: boolean
  futureWordColor?: string
  emphasis?: { fontFamily?: string; fontWeight?: string; fontStyle?: 'normal' | 'italic'; color?: string; textCase?: 'none' | 'uppercase'; size?: number; width?: number; letterSpacing?: number }
}

export const CAPTION_PRESETS: Record<string, Partial<TextProperties>> = Object.freeze({
  Custom: { fontFamily: 'Inter, sans-serif', fontSize: 48, fontWeight: '600', fontStyle: 'normal', color: '#FFFFFF', align: 'center', lineHeight: 1.2, strokeWidth: 0, shadowEnabled: false, backgroundEnabled: false },
  Clean: {
    fontFamily: 'Inter, sans-serif',
    fontSize: 48,
    fontWeight: '600',
    fontStyle: 'normal',
    color: '#FFFFFF',
    align: 'center',
    strokeWidth: 0,
    shadowColor: 'rgba(0, 0, 0, 0.7)',
    shadowBlur: 6,
    shadowOffsetX: 0,
    shadowOffsetY: 2,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    backgroundOpacity: 0.6,
    padding: 10,
  },
  Bold: {
    fontFamily: 'Impact, Arial Black, sans-serif',
    fontSize: 64,
    fontWeight: '900',
    fontStyle: 'normal',
    color: '#FFEE00',
    align: 'center',
    strokeColor: '#000000',
    strokeWidth: 4,
    shadowColor: 'rgba(0, 0, 0, 0.9)',
    shadowBlur: 4,
    shadowOffsetX: 2,
    shadowOffsetY: 2,
    backgroundColor: '#000000',
    backgroundOpacity: 0,
    padding: 6,
  },
  Meme: {
    fontFamily: 'Impact, sans-serif',
    fontSize: 60,
    fontWeight: '900',
    fontStyle: 'normal',
    color: '#FFFFFF',
    align: 'center',
    strokeColor: '#000000',
    strokeWidth: 5,
    shadowColor: '#000000',
    shadowBlur: 0,
    shadowOffsetX: 2,
    shadowOffsetY: 2,
    backgroundColor: '#000000',
    backgroundOpacity: 0,
    padding: 4,
  },
  Highlight: {
    fontFamily: 'Montserrat, Inter, sans-serif',
    fontSize: 52,
    fontWeight: '800',
    fontStyle: 'normal',
    color: '#000000',
    align: 'center',
    strokeWidth: 0,
    shadowBlur: 0,
    backgroundColor: '#00F0FF',
    backgroundOpacity: 1,
    padding: 12,
  },
  Minimal: {
    fontFamily: 'Inter, sans-serif',
    fontSize: 42,
    fontWeight: '400',
    fontStyle: 'normal',
    color: '#E5E5E5',
    align: 'center',
    strokeWidth: 0,
    shadowColor: 'rgba(0, 0, 0, 0.5)',
    shadowBlur: 3,
    shadowOffsetX: 0,
    shadowOffsetY: 1,
    backgroundColor: '#000000',
    backgroundOpacity: 0,
    padding: 6,
  },
  'Script Focus': {
    fontFamily: 'Arial, sans-serif', fontSize: 52, fontWeight: '700', color: '#FFFFFF',
    align: 'center', lineHeight: 1.5, strokeWidth: 0, backgroundEnabled: false,
    shadowEnabled: true, shadowColor: '#000000', shadowBlur: 5, shadowOpacity: .6,
    shadowOffsetX: 0, shadowOffsetY: 2, textCase: 'none',
  },
  'Yellow Focus': {
    fontFamily: '"Segoe Print", cursive', fontSize: 40, fontWeight: '400', color: '#FFFFFF',
    align: 'center', lineHeight: 1.4, strokeWidth: 0, backgroundEnabled: false,
    shadowEnabled: true, shadowColor: '#000000', shadowBlur: 3, shadowOpacity: .75,
    shadowOffsetX: 0, shadowOffsetY: 2, textCase: 'none',
  },
  'Green Pill': {
    fontFamily: 'Inter, Arial, sans-serif', fontSize: 52, fontWeight: '700', color: '#102017',
    align: 'center', lineHeight: 1.15, strokeWidth: 0, shadowEnabled: false,
    backgroundEnabled: true, backgroundColor: '#59B86C', backgroundOpacity: 1,
    cornerRadius: 20, paddingX: 24, paddingY: 12, textCase: 'none',
  },
})

export type TrackType = 'video' | 'audio' | 'caption' | 'graphics' | 'overlay'

export interface Track {
  id: string
  name: string
  type: TrackType
  muted?: boolean
  locked?: boolean
  visible?: boolean
}

export type TimelineItemType = 'video' | 'audio' | 'image' | 'solid' | 'text' | 'caption' | 'adjustment'

export interface TimelineItem {
  id: string
  trackId: string
  assetId: string
  itemType?: TimelineItemType
  startTime: number
  duration: number
  sourceIn: number
  sourceOut: number
  transform: Transform
  crop?: Crop
  audio?: AudioProperties
  speed?: SpeedProperties
  streamType?: 'video' | 'audio' | 'caption'
  solid?: SolidProperties
  text?: TextProperties
  caption?: CaptionProperties
  linkedItemId?: string
  keyframeEnabled?: Record<string, boolean>
  keyframes?: PropertyKeyframeMap
  effects?: ItemEffect[]
}

export interface ItemEffect {
  id: string
  effectId: string
  name: string
  category: 'video' | 'color' | 'stylize' | 'distortion' | 'keying' | 'audio'
  enabled: boolean
  params: Record<string, number | string | boolean>
  rangeMode?: 'fullClip' | 'custom'
  startOffset?: number // in seconds, relative to clip start (>= 0)
  endOffset?: number   // in seconds, relative to clip start (<= clip duration)
}

export interface TimelineTransition {
  id: string
  transitionId: string // e.g. 'tr-crash-zoom', 'tr-dissolve', 'tr-wipe', 'tr-zoom'
  name: string         // e.g. 'Crash Zoom', 'Dissolve', 'Wipe', 'Zoom'
  trackId: string
  startTime: number    // Project time in seconds where transition starts
  duration: number     // Duration in seconds (e.g. 0.5, 1.0)
  leftClipId?: string  // Outgoing clip if on an edit point
  rightClipId?: string // Incoming clip if on an edit point
  // At a cut: end = before (left), center = straddling, start = after (right).
  alignment?: 'center' | 'start' | 'end' | 'custom'
  params?: Record<string, number | string | boolean>
}

/**
 * Calculates the active [startOffset, endOffset] in seconds relative to the clip.
 * Full-clip effects automatically cover [0, clipDuration].
 */
export function getEffectActiveRange(
  effect: ItemEffect,
  clipDuration: number
): { startOffset: number; endOffset: number; duration: number } {
  const safeClipDur = Math.max(0.01, clipDuration)
  if (effect.rangeMode === 'custom' && typeof effect.startOffset === 'number' && typeof effect.endOffset === 'number') {
    const start = Math.max(0, Math.min(safeClipDur, effect.startOffset))
    const end = Math.max(start, Math.min(safeClipDur, effect.endOffset))
    return { startOffset: start, endOffset: end, duration: Math.max(0, end - start) }
  }
  return { startOffset: 0, endOffset: safeClipDur, duration: safeClipDur }
}

/**
 * Determines whether an effect is active at a given clip-local time (in seconds).
 */
export function isEffectActiveAtLocalTime(
  effect: ItemEffect,
  clipLocalTime: number,
  clipDuration: number
): boolean {
  if (effect.enabled === false) return false
  if (clipLocalTime < 0 || clipLocalTime > clipDuration) return false
  const range = getEffectActiveRange(effect, clipDuration)
  return clipLocalTime >= range.startOffset && clipLocalTime <= range.endOffset
}

export type { Keyframe, KeyframeInterpolation, PropertyKeyframeMap, AnimatableProperty } from './keyframeTypes'

export function getItemEffectiveType(item?: Partial<TimelineItem>, asset?: { type?: string } | null): string {
  if (!item) return asset?.type || 'video'
  if (item.itemType === 'caption' || item.caption) return 'caption'
  if (item.itemType === 'audio' || item.audio || item.streamType === 'audio') return 'audio'
  if (item.itemType === 'text' || item.text) return 'text'
  if (item.itemType === 'solid' || item.solid) return 'solid'
  if (item.itemType) return item.itemType
  if (item.streamType) return item.streamType
  if (asset?.type) return asset.type
  if (item.trackId && (item.trackId.startsWith('track-c') || item.trackId.startsWith('new-caption'))) return 'caption'
  if (item.trackId && (item.trackId.startsWith('track-a') || item.trackId.startsWith('new-audio'))) return 'audio'
  return 'video'
}

/**
 * Checks if a media asset or item type is compatible with a given track type.
 * Enforces track-item compatibility at the architectural level:
 * - video / image / solid / text -> video track
 * - audio -> audio track
 * - caption -> caption track
 * - graphics / overlay / solid / text -> graphics track
 */
export function isTrackCompatible(trackType: TrackType, assetType?: string, streamType?: string): boolean {
  const effectiveType = (assetType === 'caption' || streamType === 'caption') ? 'caption' : (streamType || assetType)
  if (!effectiveType) return true
  if (trackType === 'video') {
    return (
      effectiveType === 'video' ||
      effectiveType === 'image' ||
      effectiveType === 'solid' ||
      effectiveType === 'text' ||
      effectiveType === 'adjustment'
    )
  }
  if (trackType === 'audio') {
    return effectiveType === 'audio'
  }
  if (trackType === 'caption') {
    return effectiveType === 'caption'
  }
  if (trackType === 'graphics' || trackType === 'overlay') {
    return (
      effectiveType === 'graphics' ||
      effectiveType === 'image' ||
      effectiveType === 'solid' ||
      effectiveType === 'text' ||
      effectiveType === 'adjustment'
    )
  }
  return trackType === effectiveType
}
