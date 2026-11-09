/**
 * Lightweight local audio waveform peak extractor and cache.
 * Computes normalised audio peak amplitudes across time segments.
 * Strictly decoupled from ProjectState: peaks are generated cache, not persistent state.
 */

class WaveformCache {
  private cache = new Map<string, number[]>() // key: assetId -> array of normalised peaks [0..1]
  private inFlight = new Set<string>()

  get(assetId: string): number[] | undefined {
    return this.cache.get(assetId)
  }

  set(assetId: string, peaks: number[]): void {
    this.cache.set(assetId, peaks)
  }

  has(assetId: string): boolean {
    return this.cache.has(assetId)
  }

  isInFlight(assetId: string): boolean {
    return this.inFlight.has(assetId)
  }

  setInFlight(assetId: string, inFlight: boolean): void {
    if (inFlight) {
      this.inFlight.add(assetId)
    } else {
      this.inFlight.delete(assetId)
    }
  }

  clear(): void {
    this.cache.clear()
    this.inFlight.clear()
  }
}

export const waveformCache = new WaveformCache()

/**
 * Asynchronously extracts waveform peak data from an audio/video URL using Web Audio API AudioContext.
 * Returns an array of normalized peak values (0 to 1).
 */
export async function extractAudioWaveformPeaks(
  audioUrl: string,
  samplesCount = 600
): Promise<number[]> {
  if (typeof window === 'undefined' || typeof AudioContext === 'undefined') {
    // Return synthetic placeholder peaks for testing / SSR
    return generatePlaceholderPeaks(samplesCount)
  }

  try {
    const response = await fetch(audioUrl)
    const arrayBuffer = await response.arrayBuffer()

    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext
    const audioContext = new AudioContextClass()
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)

    const channelData = audioBuffer.getChannelData(0)
    const totalSamples = channelData.length
    const blockSize = Math.floor(totalSamples / samplesCount)
    const rawPeaks: number[] = []

    let globalMax = 0.001
    for (let i = 0; i < samplesCount; i++) {
      const start = i * blockSize
      const end = Math.min(start + blockSize, totalSamples)
      let sumSquares = 0
      let maxVal = 0

      for (let j = start; j < end; j++) {
        const val = Math.abs(channelData[j])
        if (val > maxVal) maxVal = val
        sumSquares += val * val
      }

      const count = Math.max(1, end - start)
      const rms = Math.sqrt(sumSquares / count)
      // Blend RMS and Peak (60% Peak, 40% RMS) for clear perception of volume and transient spikes
      const blended = maxVal * 0.65 + rms * 0.35
      if (blended > globalMax) globalMax = blended
      rawPeaks.push(blended)
    }

    await audioContext.close()

    // Normalize against globalMax so quiet sections are visibly quiet and loud sections hit near peak
    return rawPeaks.map((p) => Math.min(1, Math.max(0.04, p / globalMax)))
  } catch (err) {
    // If Web Audio decode fails or CORS prevents buffer reading, return fallback pattern
    return generatePlaceholderPeaks(samplesCount)
  }
}

/**
 * Generates a DaVinci Resolve style audio waveform thumbnail data URL.
 * Renders centered green/mint audio amplitude oscillations on a sleek dark canvas.
 */
export function generateAudioWaveformThumbnail(
  peaks: number[],
  width = 160,
  height = 90
): string | undefined {
  if (typeof document === 'undefined') return undefined

  try {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return undefined

    // Dark sleek background
    ctx.fillStyle = '#0f1412'
    ctx.fillRect(0, 0, width, height)

    // Center baseline
    const midY = height / 2
    ctx.strokeStyle = 'rgba(52, 211, 153, 0.25)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, midY)
    ctx.lineTo(width, midY)
    ctx.stroke()

    // Draw symmetrical green/mint waveform bars
    const count = peaks.length
    const barWidth = Math.max(1, width / count)
    ctx.fillStyle = '#34d399'

    for (let i = 0; i < count; i++) {
      const peak = peaks[i]
      const halfHeight = Math.max(1, peak * (height * 0.42))
      const x = i * barWidth
      ctx.fillRect(x, midY - halfHeight, Math.max(1, barWidth - 0.5), halfHeight * 2)
    }

    return canvas.toDataURL('image/png')
  } catch {
    return undefined
  }
}

function generatePlaceholderPeaks(count: number): number[] {
  const peaks: number[] = []
  for (let i = 0; i < count; i++) {
    // Dynamic waveform pattern reflecting speech/audio cadence
    const envelope = Math.sin((i / count) * Math.PI) * 0.5 + 0.5
    const cadence = Math.abs(Math.sin(i * 0.15) * 0.55 + Math.cos(i * 0.38) * 0.35)
    peaks.push(Math.min(1, Math.max(0.05, cadence * envelope)))
  }
  return peaks
}
