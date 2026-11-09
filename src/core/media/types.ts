export type MediaType = 'video' | 'audio' | 'image' | 'caption'

export interface MediaMetadata {
  width?: number
  height?: number
  fps?: number
  duration?: number
  audioChannels?: number
  sampleRate?: number
  codec?: string
  format?: string
  cueCount?: number
  subtitleContent?: string
}

export interface MediaAsset {
  id: string
  name: string
  type: MediaType
  path: string
  duration?: number
  metadata?: MediaMetadata
  isMissing?: boolean
  thumbnailUrl?: string
  fileSize?: number
}

