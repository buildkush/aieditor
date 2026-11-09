import type { CaptionWord } from '../timeline/types'

export interface SubtitleCue {
  id?: string
  index?: number
  startTime: number // in seconds
  endTime: number // in seconds
  duration: number // in seconds
  text: string
  words?: CaptionWord[]
}

/**
 * Parses an SRT or VTT timestamp string into seconds.
 * Supports:
 * - "00:01:23,456" (SRT comma format)
 * - "00:01:23.456" (VTT period format)
 * - "01:23.456" (VTT short format)
 */
export function parseTimestamp(ts: string): number {
  if (!ts) return 0

  // Strip trailing settings if any (e.g. "00:01:23.456 line:0 position:50%")
  const cleanTs = ts.trim().split(/\s+/)[0].replace(',', '.')
  const parts = cleanTs.split(':')

  if (parts.length === 3) {
    const hours = parseFloat(parts[0]) || 0
    const minutes = parseFloat(parts[1]) || 0
    const seconds = parseFloat(parts[2]) || 0
    return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000) / 1000
  } else if (parts.length === 2) {
    const minutes = parseFloat(parts[0]) || 0
    const seconds = parseFloat(parts[1]) || 0
    return Math.round((minutes * 60 + seconds) * 1000) / 1000
  }

  const sec = parseFloat(cleanTs)
  return isNaN(sec) ? 0 : sec
}

/**
 * Formats seconds into an SRT timestamp ("HH:MM:SS,mmm").
 */
export function formatSrtTimestamp(seconds: number): string {
  const safeSec = Math.max(0, seconds)
  const hrs = Math.floor(safeSec / 3600)
  const mins = Math.floor((safeSec % 3600) / 60)
  const secs = Math.floor(safeSec % 60)
  const ms = Math.floor((safeSec % 1) * 1000)

  const pad = (n: number, z = 2) => String(n).padStart(z, '0')
  return `${pad(hrs)}:${pad(mins)}:${pad(secs)},${pad(ms, 3)}`
}

/**
 * Formats seconds into a WebVTT timestamp ("HH:MM:SS.mmm").
 */
export function formatVttTimestamp(seconds: number): string {
  return formatSrtTimestamp(seconds).replace(',', '.')
}

/**
 * Generates initial word-level timing foundation evenly distributed over duration.
 */
export function generateWordTiming(text: string, startTime: number, endTime: number): CaptionWord[] {
  const words = (text || '').trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return []

  const totalDuration = Math.max(0.1, endTime - startTime)
  const timePerWord = totalDuration / words.length

  return words.map((word, i) => {
    const wordStart = Math.round((startTime + i * timePerWord) * 1000) / 1000
    const wordEnd = Math.round((startTime + (i + 1) * timePerWord) * 1000) / 1000
    return {
      id: `w-${i}-${wordStart}`,
      word,
      start: wordStart,
      end: wordEnd,
      startTime: wordStart,
      endTime: wordEnd,
    }
  })
}

/**
 * Parses SubRip (.srt) subtitle string into cues.
 */
export function parseSrt(content: string): SubtitleCue[] {
  if (!content || !content.trim()) return []

  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const blocks = normalized.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean)
  const cues: SubtitleCue[] = []

  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean)
    if (lines.length < 2) continue

    let timeLineIndex = 0
    let index: number | undefined

    // First line may be an integer cue index
    if (/^\d+$/.test(lines[0]) && lines.length >= 2) {
      index = parseInt(lines[0], 10)
      timeLineIndex = 1
    }

    const timeLine = lines[timeLineIndex]
    if (!timeLine || !timeLine.includes('-->')) continue

    const [startRaw, endRaw] = timeLine.split('-->').map((s) => s.trim())
    const startTime = parseTimestamp(startRaw)
    const endTime = parseTimestamp(endRaw)

    if (isNaN(startTime) || isNaN(endTime) || endTime <= startTime) continue

    const textLines = lines.slice(timeLineIndex + 1)
    const text = textLines.join('\n')

    cues.push({
      index: index ?? cues.length + 1,
      startTime,
      endTime,
      duration: Math.round((endTime - startTime) * 1000) / 1000,
      text,
      words: generateWordTiming(text, startTime, endTime),
    })
  }

  return cues
}

/**
 * Parses WebVTT (.vtt) subtitle string into cues.
 */
export function parseVtt(content: string): SubtitleCue[] {
  if (!content || !content.trim()) return []

  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const blocks = normalized.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean)
  const cues: SubtitleCue[] = []

  for (const block of blocks) {
    // Ignore WEBVTT header and NOTE blocks
    if (/^WEBVTT/i.test(block) || /^NOTE/i.test(block) || /^STYLE/i.test(block)) {
      continue
    }

    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean)
    if (lines.length === 0) continue

    let timeLineIndex = 0
    let index: number | undefined

    if (lines[0].includes('-->')) {
      timeLineIndex = 0
    } else if (lines.length > 1 && lines[1].includes('-->')) {
      index = /^\d+$/.test(lines[0]) ? parseInt(lines[0], 10) : undefined
      timeLineIndex = 1
    } else {
      continue
    }

    const timeLine = lines[timeLineIndex]
    const [startRaw, endRaw] = timeLine.split('-->').map((s) => s.trim())
    const startTime = parseTimestamp(startRaw)
    const endTime = parseTimestamp(endRaw)

    if (isNaN(startTime) || isNaN(endTime) || endTime <= startTime) continue

    // Extract text, stripping HTML formatting tags (<b>, <i>, <c.color>, etc.) if any
    const rawText = lines.slice(timeLineIndex + 1).join('\n')
    const cleanText = rawText.replace(/<\/?[^>]+(>|$)/g, '').trim()

    cues.push({
      index: index ?? cues.length + 1,
      startTime,
      endTime,
      duration: Math.round((endTime - startTime) * 1000) / 1000,
      text: cleanText,
      words: generateWordTiming(cleanText, startTime, endTime),
    })
  }

  return cues
}

/**
 * Automatically detects whether content is SRT or WebVTT and parses accordingly.
 */
export function parseSubtitleContent(content: string, filename?: string): SubtitleCue[] {
  const isVtt = (filename && filename.toLowerCase().endsWith('.vtt')) || content.trim().startsWith('WEBVTT')
  return isVtt ? parseVtt(content) : parseSrt(content)
}

/**
 * Serializes cues to an SRT formatted string.
 */
export function serializeToSrt(cues: SubtitleCue[]): string {
  return cues
    .map((cue, i) => {
      const idx = cue.index ?? i + 1
      const start = formatSrtTimestamp(cue.startTime)
      const end = formatSrtTimestamp(cue.endTime)
      return `${idx}\n${start} --> ${end}\n${cue.text}\n`
    })
    .join('\n')
}

/**
 * Serializes cues to a WebVTT formatted string.
 */
export function serializeToVtt(cues: SubtitleCue[]): string {
  const body = cues
    .map((cue, i) => {
      const start = formatVttTimestamp(cue.startTime)
      const end = formatVttTimestamp(cue.endTime)
      return `${i + 1}\n${start} --> ${end}\n${cue.text}\n`
    })
    .join('\n')
  return `WEBVTT\n\n${body}`
}
