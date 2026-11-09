import type { ProjectState } from '../project/projectState'
import type { SubtitleCue } from './subtitleParser'

/** Export current timeline edits, never the archived recognition transcript. */
export function projectCaptionCues(state: ProjectState): SubtitleCue[] {
  const tracks = new Set(state.tracks.filter(track => track.visible !== false).map(track => track.id))
  return Object.values(state.items).filter(item => tracks.has(item.trackId) && item.caption && item.caption.text.trim())
    .sort((a, b) => a.startTime - b.startTime || a.trackId.localeCompare(b.trackId) || a.id.localeCompare(b.id))
    .map(item => {
      if (!Number.isFinite(item.startTime) || item.startTime < 0 || !Number.isFinite(item.duration) || item.duration <= 0) throw new Error('A caption has invalid timing. Correct it before exporting.')
      return { startTime: item.startTime, endTime: item.startTime + item.duration, duration: item.duration, text: item.caption!.text }
    })
}
