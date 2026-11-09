import type { MediaType, MediaMetadata, MediaAsset } from './types'
import { resolveMediaUrl } from './mediaUrlResolver'
import { generateId } from '../utils'
import { extractAudioWaveformPeaks, generateAudioWaveformThumbnail } from './waveformCache'
import { parseSubtitleContent } from '../subtitles/subtitleParser'

export interface ExtractedMediaInfo {
  type: MediaType
  name: string
  path: string
  duration?: number
  metadata: MediaMetadata
  thumbnailUrl?: string
  fileSize?: number
}

const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v', 'flv', 'wmv'])
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'aac', 'm4a', 'flac', 'ogg', 'wma', 'aiff'])
const IMAGE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'svg',
  'bmp',
  'tiff',
  'wbmp',
  'wbpm',
  'avif',
  'ico',
])
const SUBTITLE_EXTENSIONS = new Set(['srt', 'vtt'])

export function getMediaTypeFromFilename(filename: string): MediaType {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  if (VIDEO_EXTENSIONS.has(ext)) return 'video'
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio'
  if (IMAGE_EXTENSIONS.has(ext)) return 'image'
  if (SUBTITLE_EXTENSIONS.has(ext)) return 'caption'
  return 'video' // default
}

export function getFilenameFromPath(filePath: string): string {
  const sep = filePath.includes('/') ? '/' : '\\'
  const parts = filePath.split(sep)
  return parts[parts.length - 1] || filePath
}

/**
 * Extracts metadata and generates a thumbnail for a video element.
 */
function extractVideoInfo(
  url: string,
  name: string,
  path: string,
  fileSize?: number
): Promise<ExtractedMediaInfo> {
  return new Promise((resolve) => {
    // If not in a browser environment (e.g. Node tests), return default metadata immediately
    if (typeof document === 'undefined') {
      resolve({
        type: 'video',
        name,
        path,
        duration: 10,
        metadata: { width: 1920, height: 1080, fps: 30, duration: 10 },
        fileSize,
      })
      return
    }

    const video = document.createElement('video')
    video.preload = 'metadata'
    video.crossOrigin = 'anonymous'
    video.muted = true
    video.playsInline = true

    let timeoutId: number | null = null

    const finish = (result: ExtractedMediaInfo) => {
      if (timeoutId !== null) clearTimeout(timeoutId)
      video.removeAttribute('src')
      video.load()
      resolve(result)
    }

    // Fallback if media decoding fails or hangs
    timeoutId = window.setTimeout(() => {
      finish({
        type: 'video',
        name,
        path,
        duration: 10,
        metadata: { width: 1920, height: 1080, fps: 30, duration: 10 },
        fileSize,
      })
    }, 4000)

    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 10
      const width = video.videoWidth || 1920
      const height = video.videoHeight || 1080
      const fps = 30

      // Seek to capture first frame of the clip (approx 1st frame at 0.04s, fallback to 0.5s/1.0s if black)
      let candidateTimes = [0.04, 0.5, 1.0, 0.1]
      let timeIdx = 0
      video.currentTime = Math.min(candidateTimes[timeIdx], Math.max(0.01, duration - 0.05))

      video.onseeked = () => {
        let thumbnailUrl: string | undefined
        try {
          if (video.readyState >= 2) {
            const canvas = document.createElement('canvas')
            canvas.width = 160
            canvas.height = Math.round((160 * height) / width)
            const ctx = canvas.getContext('2d', { willReadFrequently: true })
            if (ctx) {
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
              
              // Validate that the drawn frame is not completely black
              const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height)
              const data = imgData.data
              let isPureBlack = true
              for (let i = 0; i < data.length; i += 16) {
                if (data[i] > 8 || data[i + 1] > 8 || data[i + 2] > 8) {
                  isPureBlack = false
                  break
                }
              }

              if (!isPureBlack) {
                thumbnailUrl = canvas.toDataURL('image/jpeg', 0.75)
              } else if (timeIdx < candidateTimes.length - 1 && duration > candidateTimes[timeIdx + 1]) {
                // Try next candidate timestamp if first frame was black
                timeIdx++
                video.currentTime = Math.min(candidateTimes[timeIdx], duration - 0.05)
                return
              }
            }
          }
        } catch {
          // ignore
        }

        finish({
          type: 'video',
          name,
          path,
          duration,
          metadata: { width, height, fps, duration },
          thumbnailUrl,
          fileSize,
        })
      }

      video.onerror = () => {
        finish({
          type: 'video',
          name,
          path,
          duration,
          metadata: { width, height, fps, duration },
          fileSize,
        })
      }
    }

    video.onerror = () => {
      finish({
        type: 'video',
        name,
        path,
        duration: 10,
        metadata: { width: 1920, height: 1080, fps: 30, duration: 10 },
        fileSize,
      })
    }

    video.src = url
  })
}

/**
 * Extracts metadata for an audio file.
 */
function extractAudioInfo(
  url: string,
  name: string,
  path: string,
  fileSize?: number
): Promise<ExtractedMediaInfo> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve({
        type: 'audio',
        name,
        path,
        duration: 15,
        metadata: { duration: 15, sampleRate: 48000, audioChannels: 2 },
        fileSize,
      })
      return
    }

    const audio = document.createElement('audio')
    audio.preload = 'metadata'

    let timeoutId: number | null = null

    const finish = (result: ExtractedMediaInfo) => {
      if (timeoutId !== null) clearTimeout(timeoutId)
      audio.removeAttribute('src')
      audio.load()
      resolve(result)
    }

    timeoutId = window.setTimeout(() => {
      finish({
        type: 'audio',
        name,
        path,
        duration: 15,
        metadata: { duration: 15, sampleRate: 48000, audioChannels: 2 },
        fileSize,
      })
    }, 4000)

    audio.onloadedmetadata = async () => {
      const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 15
      let thumbnailUrl: string | undefined

      try {
        const peaks = await extractAudioWaveformPeaks(url, 64)
        if (peaks && peaks.length > 0) {
          thumbnailUrl = generateAudioWaveformThumbnail(peaks, 160, 90)
        }
      } catch {
        // ignore waveform extraction failure
      }

      finish({
        type: 'audio',
        name,
        path,
        duration,
        metadata: { duration, sampleRate: 48000, audioChannels: 2 },
        thumbnailUrl,
        fileSize,
      })
    }

    audio.onerror = () => {
      finish({
        type: 'audio',
        name,
        path,
        duration: 15,
        metadata: { duration: 15, sampleRate: 48000, audioChannels: 2 },
        fileSize,
      })
    }

    audio.src = url
  })
}

/**
 * Extracts metadata for an image file.
 */
function extractImageInfo(
  url: string,
  name: string,
  path: string,
  fileSize?: number
): Promise<ExtractedMediaInfo> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve({
        type: 'image',
        name,
        path,
        duration: 5,
        metadata: { width: 1920, height: 1080 },
        fileSize,
      })
      return
    }

    const img = new Image()
    let timeoutId: number | null = null

    const finish = (result: ExtractedMediaInfo) => {
      if (timeoutId !== null) clearTimeout(timeoutId)
      resolve(result)
    }

    timeoutId = window.setTimeout(() => {
      finish({
        type: 'image',
        name,
        path,
        duration: 5,
        metadata: { width: 1920, height: 1080 },
        thumbnailUrl: url,
        fileSize,
      })
    }, 3000)

    img.onload = () => {
      const width = img.naturalWidth || 1920
      const height = img.naturalHeight || 1080
      let thumbnailUrl = url

      try {
        const canvas = document.createElement('canvas')
        canvas.width = 160
        canvas.height = Math.round((160 * height) / width)
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
          thumbnailUrl = canvas.toDataURL('image/jpeg', 0.8)
        }
      } catch {
        // fallback to url
      }

      finish({
        type: 'image',
        name,
        path,
        duration: 5,
        metadata: { width, height },
        thumbnailUrl,
        fileSize,
      })
    }

    img.onerror = () => {
      finish({
        type: 'image',
        name,
        path,
        duration: 5,
        metadata: { width: 1920, height: 1080 },
        fileSize,
      })
    }

    img.src = url
  })
}

/**
 * Extracts subtitle/caption file content, duration and cue metadata.
 */
async function extractCaptionInfo(
  source: File | string,
  name: string,
  path: string,
  fileSize?: number
): Promise<ExtractedMediaInfo> {
  let content = ''
  if (typeof source !== 'string') {
    try {
      content = await source.text()
    } catch {
      content = ''
    }
  } else {
    if (typeof window === 'undefined') {
      try {
        const req = (globalThis as any).require
        if (typeof req === 'function') {
          const fs = req('fs')
          content = fs.readFileSync(source, 'utf-8')
        }
      } catch {
        content = ''
      }
    } else if ((window as any).__TAURI_INTERNALS__?.invoke) {
      try {
        const res = await (window as any).__TAURI_INTERNALS__.invoke('read_project_file', { path: source })
        if (typeof res === 'string') content = res
      } catch {
        // fallback
      }
    }
    if (!content) {
      try {
        const res = await fetch(resolveMediaUrl(source))
        if (res.ok) content = await res.text()
      } catch {
        // ignore
      }
    }
  }

  let duration = 10
  let cueCount = 0
  if (content) {
    try {
      const cues = parseSubtitleContent(content, name)
      cueCount = cues.length
      if (cues.length > 0) {
        duration = Math.max(1, cues.reduce((max, c) => Math.max(max, c.endTime), 0))
      }
    } catch {
      // ignore
    }
  }

  return {
    type: 'caption',
    name,
    path,
    duration,
    metadata: {
      duration,
      cueCount,
      subtitleContent: content,
    },
    fileSize,
  }
}

/**
 * Ingests a real local media file path or File object, extracts metadata,
 * generates a thumbnail, and returns a fully formed MediaAsset.
 */
export async function createMediaAssetFromSource(
  source: File | string,
  explicitId?: string
): Promise<MediaAsset> {
  const id = explicitId ?? generateId('asset')

  if (typeof source === 'string') {
    const path = source
    const name = getFilenameFromPath(path)
    const type = getMediaTypeFromFilename(name)
    const url = resolveMediaUrl(path)

    let info: ExtractedMediaInfo
    if (type === 'video') {
      info = await extractVideoInfo(url, name, path)
    } else if (type === 'audio') {
      info = await extractAudioInfo(url, name, path)
    } else if (type === 'caption') {
      info = await extractCaptionInfo(source, name, path)
    } else {
      info = await extractImageInfo(url, name, path)
    }

    return {
      id,
      name: info.name,
      type: info.type,
      path: info.path,
      duration: info.duration,
      metadata: info.metadata,
      thumbnailUrl: info.thumbnailUrl,
      fileSize: info.fileSize,
    }
  } else {
    const file = source
    const name = file.name
    const rawPath = (file as any).path
    const isAbsolutePath = typeof rawPath === 'string' && (rawPath.includes('/') || rawPath.includes('\\'))
    const blobUrl = typeof URL !== 'undefined' && URL.createObjectURL ? URL.createObjectURL(file) : ''
    const path = isAbsolutePath ? rawPath : (blobUrl || file.name)
    const type = getMediaTypeFromFilename(name)
    const mediaSourceUrl = blobUrl || path

    let info: ExtractedMediaInfo
    if (type === 'video') {
      info = await extractVideoInfo(mediaSourceUrl, name, path, file.size)
    } else if (type === 'audio') {
      info = await extractAudioInfo(mediaSourceUrl, name, path, file.size)
    } else if (type === 'caption') {
      info = await extractCaptionInfo(file, name, path, file.size)
    } else {
      info = await extractImageInfo(mediaSourceUrl, name, path, file.size)
    }

    return {
      id,
      name: info.name,
      type: info.type,
      path: info.path,
      duration: info.duration,
      metadata: info.metadata,
      thumbnailUrl: info.thumbnailUrl,
      fileSize: info.fileSize,
    }
  }
}
