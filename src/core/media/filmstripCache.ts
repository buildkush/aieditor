/**
 * Filmstrip and Thumbnail Cache for Timeline Clips.
 * Maintains client-side extracted frame thumbnails for video assets without
 * storing large image data blobs in ProjectState.
 */

interface ExtractorJob {
  videoUrl: string
  timestamp: number
  targetWidth: number
  resolve: (dataUrl: string | null) => void
}

class FrameExtractorQueue {
  private queue: ExtractorJob[] = []
  private activeCount = 0
  private readonly maxConcurrent = 2

  enqueue(videoUrl: string, timestamp: number, targetWidth: number): Promise<string | null> {
    return new Promise((resolve) => {
      this.queue.push({ videoUrl, timestamp, targetWidth, resolve })
      this.processNext()
    })
  }

  private processNext() {
    if (this.activeCount >= this.maxConcurrent || this.queue.length === 0) {
      return
    }

    const job = this.queue.shift()
    if (!job) return

    this.activeCount++

    extractVideoFrameAtTime(job.videoUrl, job.timestamp, job.targetWidth)
      .then((result) => {
        job.resolve(result)
      })
      .catch(() => {
        job.resolve(null)
      })
      .finally(() => {
        this.activeCount--
        this.processNext()
      })
  }
}

const extractorQueue = new FrameExtractorQueue()

class FilmstripCache {
  private cache = new Map<string, string>() // key: `${assetId}_${timestamp}` -> dataUrl
  private inFlight = new Map<string, Promise<string | null>>()
  private readonly maxCacheSize = 800

  private makeKey(assetId: string, timestamp: number): string {
    return `${assetId}_${timestamp.toFixed(1)}`
  }

  get(assetId: string, timestamp: number): string | undefined {
    return this.cache.get(this.makeKey(assetId, timestamp))
  }

  set(assetId: string, timestamp: number, url: string): void {
    const key = this.makeKey(assetId, timestamp)
    if (this.cache.size >= this.maxCacheSize && !this.cache.has(key)) {
      const firstKey = this.cache.keys().next().value
      if (firstKey) this.cache.delete(firstKey)
    }
    this.cache.set(key, url)
  }

  has(assetId: string, timestamp: number): boolean {
    return this.cache.has(this.makeKey(assetId, timestamp))
  }

  clear(): void {
    this.cache.clear()
    this.inFlight.clear()
  }

  requestFrame(
    assetId: string,
    videoUrl: string,
    timestamp: number,
    targetWidth = 80
  ): Promise<string | null> {
    const key = this.makeKey(assetId, timestamp)

    const cached = this.cache.get(key)
    if (cached) return Promise.resolve(cached)

    const pending = this.inFlight.get(key)
    if (pending) return pending

    const promise = extractorQueue
      .enqueue(videoUrl, timestamp, targetWidth)
      .then((dataUrl) => {
        if (dataUrl) {
          this.set(assetId, timestamp, dataUrl)
        }
        return dataUrl
      })
      .finally(() => {
        this.inFlight.delete(key)
      })

    this.inFlight.set(key, promise)
    return promise
  }
}

export const filmstripCache = new FilmstripCache()

/**
 * Extracts a frame from a video URL at a specific timestamp.
 */
export async function extractVideoFrameAtTime(
  videoUrl: string,
  timestamp: number,
  targetWidth = 80
): Promise<string | null> {
  if (typeof document === 'undefined') return null

  return new Promise((resolve) => {
    let resolved = false
    let timeoutId: number | null = null

    const video = document.createElement('video')
    video.preload = 'auto'
    video.crossOrigin = 'anonymous'
    video.muted = true
    video.playsInline = true

    const cleanup = () => {
      if (timeoutId !== null) clearTimeout(timeoutId)
      video.onloadedmetadata = null
      video.onseeked = null
      video.onerror = null
      try {
        video.removeAttribute('src')
        video.load()
      } catch {
        // ignore
      }
    }

    const finish = (result: string | null) => {
      if (resolved) return
      resolved = true
      cleanup()
      resolve(result)
    }

    timeoutId = window.setTimeout(() => {
      finish(null)
    }, 2500)

    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 10
      const seekTime = Math.max(0, Math.min(duration - 0.05, timestamp))
      video.currentTime = seekTime
    }

    video.onseeked = () => {
      try {
        const width = video.videoWidth || 1920
        const height = video.videoHeight || 1080
        const canvas = document.createElement('canvas')
        canvas.width = targetWidth
        canvas.height = Math.max(1, Math.round((targetWidth * height) / width))
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
          const dataUrl = canvas.toDataURL('image/jpeg', 0.65)
          finish(dataUrl)
          return
        }
      } catch {
        // ignore
      }
      finish(null)
    }

    video.onerror = () => finish(null)
    video.src = videoUrl
  })
}
