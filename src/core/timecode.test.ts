import { describe, it, expect } from 'vitest'
import { formatTimecode, parseTimecode } from './timecode'

describe('timecode', () => {
  it('formats seconds to HH:MM:SS:FF accurately at 30 fps', () => {
    expect(formatTimecode(0, 30)).toBe('00:00:00:00')
    expect(formatTimecode(1, 30)).toBe('00:00:01:00')
    expect(formatTimecode(8.5, 30)).toBe('00:00:08:15')
    expect(formatTimecode(65.1, 30)).toBe('00:01:05:03')
    expect(formatTimecode(3661.0, 30)).toBe('01:01:01:00')
  })

  it('formats accurately with 24, 25, and 60 fps', () => {
    // At 24 fps, 0.5s is 12 frames
    expect(formatTimecode(0.5, 24)).toBe('00:00:00:12')
    // At 60 fps, 0.5s is 30 frames
    expect(formatTimecode(0.5, 60)).toBe('00:00:00:30')
    // At 25 fps, 1 frame is 0.04s
    expect(formatTimecode(0.04, 25)).toBe('00:00:00:01')
  })

  it('handles negative or invalid seconds gracefully', () => {
    expect(formatTimecode(-5, 30)).toBe('00:00:00:00')
    expect(formatTimecode(NaN, 30)).toBe('00:00:00:00')
  })

  it('parses HH:MM:SS:FF accurately', () => {
    expect(parseTimecode('00:00:08:15', 30)).toBeCloseTo(8.5, 4)
    expect(parseTimecode('00:01:00:00', 30)).toBe(60)
    expect(parseTimecode('01:00:00:00', 30)).toBe(3600)
    expect(parseTimecode('00:00:00:15', 30)).toBeCloseTo(0.5, 4)
  })

  it('parses shorter forms and plain numbers', () => {
    expect(parseTimecode('08:15', 30)).toBeCloseTo(8.5, 4)
    expect(parseTimecode('01:08:15', 30)).toBeCloseTo(68.5, 4)
    expect(parseTimecode('12.5', 30)).toBe(12.5)
    expect(parseTimecode('invalid', 30)).toBeNull()
  })
})
