/**
 * Timecode formatting and parsing utilities.
 * Standard format: HH:MM:SS:FF where FF is the frame index (0-indexed) within the second,
 * determined by the project frame rate (FPS).
 */

function pad(num: number, digits = 2): string {
  return Math.floor(Math.abs(num)).toString().padStart(digits, '0')
}

/**
 * Formats a time in seconds to HH:MM:SS:FF based on FPS.
 * Example: 8.5 seconds at 30 fps -> "00:00:08:15"
 */
export function formatTimecode(seconds: number, fps: number): string {
  if (isNaN(seconds) || seconds < 0) {
    seconds = 0
  }
  const safeFps = fps > 0 ? fps : 30
  // Round to nearest frame to avoid floating point inaccuracies (e.g. 0.999999s)
  const totalFrames = Math.round(seconds * safeFps)
  const frameIndex = totalFrames % safeFps
  const totalSeconds = Math.floor(totalFrames / safeFps)

  const s = totalSeconds % 60
  const m = Math.floor(totalSeconds / 60) % 60
  const h = Math.floor(totalSeconds / 3600)

  return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(frameIndex)}`
}

/**
 * Parses a timecode string into numeric seconds.
 * Accepts formats:
 * - "HH:MM:SS:FF"
 * - "MM:SS:FF"
 * - "SS:FF"
 * - Raw numeric seconds string (e.g. "8.5")
 *
 * Returns null if the format is invalid.
 */
export function parseTimecode(input: string, fps: number): number | null {
  if (!input || typeof input !== 'string') return null
  const trimmed = input.trim()
  if (!trimmed) return null

  const safeFps = fps > 0 ? fps : 30

  // If it's a simple number (e.g. "8.5" or "10")
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const val = parseFloat(trimmed)
    return isNaN(val) ? null : Math.max(0, val)
  }

  // Colon-separated parts
  const parts = trimmed.split(':').map((p) => p.trim())
  if (parts.some((p) => !/^\d+$/.test(p))) {
    return null
  }

  const nums = parts.map((p) => parseInt(p, 10))

  let h = 0
  let m = 0
  let s = 0
  let ff = 0

  if (nums.length === 4) {
    // HH:MM:SS:FF
    ;[h, m, s, ff] = nums
  } else if (nums.length === 3) {
    // MM:SS:FF
    ;[m, s, ff] = nums
  } else if (nums.length === 2) {
    // SS:FF
    ;[s, ff] = nums
  } else {
    return null
  }

  // Validate ranges
  if (ff >= safeFps || s >= 60 || m >= 60) {
    // Allow lenient frames or overflow calculation
  }

  const totalFrames = ((h * 3600 + m * 60 + s) * safeFps) + ff
  return totalFrames / safeFps
}

/**
 * Formats time for ruler tick marks.
 * Compact timecode or MM:SS:FF
 */
export function formatRulerTick(seconds: number, fps: number): string {
  return formatTimecode(seconds, fps)
}
