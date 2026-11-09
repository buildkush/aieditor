/**
 * Service for decoding and playing reversed audio via Web Audio API.
 * Standard HTML5 <audio> elements do not support negative playback rates.
 * This service decodes the media asset into an AudioBuffer, reverses the PCM samples,
 * caches the reversed buffer in memory, and plays it in lockstep with the timeline.
 */

let sharedAudioContext: AudioContext | null = null

export function getSharedAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext
  if (!AudioContextClass) return null

  if (!sharedAudioContext || sharedAudioContext.state === 'closed') {
    sharedAudioContext = new AudioContextClass()
  }

  if (sharedAudioContext.state === 'suspended') {
    sharedAudioContext.resume().catch(() => {})
  }

  return sharedAudioContext
}

// In-memory cache of reversed AudioBuffers keyed by assetId
const reversedBufferCache = new Map<string, AudioBuffer>()
const pendingDecodePromises = new Map<string, Promise<AudioBuffer | null>>()

/**
 * Pre-fetches and decodes the audio asset, storing the reversed AudioBuffer in cache.
 */
export async function preloadReversedAudio(
  assetId: string,
  audioUrl: string
): Promise<AudioBuffer | null> {
  if (typeof window === 'undefined') return null
  if (!assetId || !audioUrl) return null

  if (reversedBufferCache.has(assetId)) {
    return reversedBufferCache.get(assetId)!
  }

  if (pendingDecodePromises.has(assetId)) {
    return pendingDecodePromises.get(assetId)!
  }

  const decodePromise = (async () => {
    try {
      const response = await fetch(audioUrl)
      const arrayBuffer = await response.arrayBuffer()

      const ctx = getSharedAudioContext()
      if (!ctx) return null

      const decodedBuffer = await ctx.decodeAudioData(arrayBuffer)
      const numChannels = decodedBuffer.numberOfChannels
      const length = decodedBuffer.length
      const sampleRate = decodedBuffer.sampleRate

      const reversedBuffer = ctx.createBuffer(numChannels, length, sampleRate)

      for (let ch = 0; ch < numChannels; ch++) {
        const srcChannel = decodedBuffer.getChannelData(ch)
        const dstChannel = reversedBuffer.getChannelData(ch)
        for (let i = 0; i < length; i++) {
          dstChannel[i] = srcChannel[length - 1 - i]
        }
      }

      reversedBufferCache.set(assetId, reversedBuffer)
      return reversedBuffer
    } catch (err) {
      console.warn('Failed to decode and reverse audio for asset:', assetId, err)
      return null
    } finally {
      pendingDecodePromises.delete(assetId)
    }
  })()

  pendingDecodePromises.set(assetId, decodePromise)
  return decodePromise
}

interface ActiveReversedSession {
  sourceNode: AudioBufferSourceNode
  gainNode: GainNode
  pannerNode: StereoPannerNode | null
  startedAtContextTime: number
  startRevOffset: number
  speed: number
  assetDuration: number
}

const activeSessions = new Map<string, ActiveReversedSession>()

export interface PlayReversedAudioParams {
  itemId: string
  assetId: string
  audioUrl: string
  sourceTime: number
  speed: number
  volume: number
  pan?: number
  isMuted: boolean
}

/**
 * Plays the reversed audio in lockstep with the timeline playhead.
 * `sourceTime` is in original media seconds (e.g., counting down from 10.0 to 0.0).
 * In the reversed buffer, offset = buffer.duration - sourceTime.
 */
export function playReversedAudio({
  itemId,
  assetId,
  audioUrl,
  sourceTime,
  speed,
  volume,
  pan,
  isMuted,
}: PlayReversedAudioParams): void {
  const ctx = getSharedAudioContext()
  if (!ctx) return

  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {})
  }

  const cachedBuffer = reversedBufferCache.get(assetId)
  if (!cachedBuffer) {
    // Start asynchronous preload if not already cached
    preloadReversedAudio(assetId, audioUrl).then((buf) => {
      if (buf) {
        // Trigger playback once buffer is ready
        playReversedAudio({
          itemId,
          assetId,
          audioUrl,
          sourceTime,
          speed,
          volume,
          pan,
          isMuted,
        })
      }
    })
    return
  }

  const bufferDuration = cachedBuffer.duration
  // In the reversed buffer, the position corresponding to original `sourceTime` is:
  const targetRevOffset = Math.max(0, Math.min(bufferDuration, bufferDuration - sourceTime))
  const clampedSpeed = Math.max(0.25, Math.min(4, speed))
  const effectiveVolume = isMuted ? 0 : Math.max(0, Math.min(4, volume))
  const clampedPan = Math.max(-1, Math.min(1, pan ?? 0))

  const current = activeSessions.get(itemId)
  if (current) {
    // Check if the current playing node is still in sync with the requested playhead
    const elapsedCtx = ctx.currentTime - current.startedAtContextTime
    const expectedRevOffset = current.startRevOffset + elapsedCtx * current.speed

    if (Math.abs(expectedRevOffset - targetRevOffset) < 0.2 && current.speed === clampedSpeed) {
      // In sync: seamlessly update gain and pan without interrupting audio
      current.gainNode.gain.setValueAtTime(effectiveVolume, ctx.currentTime)
      if (current.pannerNode) {
        current.pannerNode.pan.setValueAtTime(clampedPan, ctx.currentTime)
      }
      return
    }

    // Out of sync (seeked or scrubbed or speed changed): stop old node
    stopReversedAudio(itemId)
  }

  try {
    const sourceNode = ctx.createBufferSource()
    sourceNode.buffer = cachedBuffer
    sourceNode.playbackRate.value = clampedSpeed

    const gainNode = ctx.createGain()
    gainNode.gain.setValueAtTime(effectiveVolume, ctx.currentTime)

    let pannerNode: StereoPannerNode | null = null
    if (typeof ctx.createStereoPanner === 'function') {
      pannerNode = ctx.createStereoPanner()
      pannerNode.pan.setValueAtTime(clampedPan, ctx.currentTime)
    }

    sourceNode.connect(gainNode)
    if (pannerNode) {
      gainNode.connect(pannerNode)
      pannerNode.connect(ctx.destination)
    } else {
      gainNode.connect(ctx.destination)
    }

    sourceNode.start(0, targetRevOffset)

    sourceNode.onended = () => {
      if (activeSessions.get(itemId)?.sourceNode === sourceNode) {
        activeSessions.delete(itemId)
      }
    }

    activeSessions.set(itemId, {
      sourceNode,
      gainNode,
      pannerNode,
      startedAtContextTime: ctx.currentTime,
      startRevOffset: targetRevOffset,
      speed: clampedSpeed,
      assetDuration: bufferDuration,
    })
  } catch (err) {
    console.warn('Error starting reversed audio playback for item:', itemId, err)
  }
}

/**
 * Stops reversed audio playback for the given item.
 */
export function stopReversedAudio(itemId: string): void {
  const current = activeSessions.get(itemId)
  if (!current) return

  try {
    current.sourceNode.stop()
  } catch {
    // Ignore already stopped
  }

  try {
    current.sourceNode.disconnect()
    current.gainNode.disconnect()
    current.pannerNode?.disconnect()
  } catch {
    // Ignore disconnect errors
  }

  activeSessions.delete(itemId)
}

/**
 * Stops all active reversed audio playbacks.
 */
export function stopAllReversedAudio(): void {
  for (const itemId of Array.from(activeSessions.keys())) {
    stopReversedAudio(itemId)
  }
}

/**
 * Clears the reversed buffer cache (e.g. on project change).
 */
export function clearReversedAudioCache(): void {
  stopAllReversedAudio()
  reversedBufferCache.clear()
  pendingDecodePromises.clear()
}
