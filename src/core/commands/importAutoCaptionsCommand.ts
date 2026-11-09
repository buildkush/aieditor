import type { EditorCommand } from './editorCommand'
import type { ProjectState } from '../project/projectState'
import type { CaptionTranscript } from '../captions/types'
import { isCaptionTranscript } from '../captions/types'
import { reviewedCaptionCues } from '../captions/transcriptReview'
import { projectAudioPlan } from '../captions/projectAudioPlan'
import { importSubtitles } from './projectCommands'
import { captionReviewProperties } from '../captions/reviewEditing'

/** One undoable command for human/UI or agent clients; ASR never edits the timeline. */
export class ImportAutoCaptionsCommand implements EditorCommand<'IMPORT_AUTO_CAPTIONS', { transcript: CaptionTranscript }> {
  readonly type = 'IMPORT_AUTO_CAPTIONS' as const
  readonly payload: { transcript: CaptionTranscript }
  constructor(transcript: CaptionTranscript) { this.payload = { transcript: structuredClone(transcript) } }
  execute(state: ProjectState): ProjectState {
    const transcript = this.payload.transcript
    if (!isCaptionTranscript(transcript)) throw new Error('Invalid caption transcript or word timings.')
    if (!state.id || state.id !== transcript.audioPlan.projectId) throw new Error('The captions belong to a different project.')
    if (JSON.stringify(projectAudioPlan(state)) !== JSON.stringify(transcript.audioPlan)) throw new Error('Project audio changed during review. Generate captions again for the current timeline.')
    if (state.captionTranscripts?.[transcript.id]) throw new Error('This transcript has already been imported.')
    const existing = state.tracks.find(track => track.type === 'caption' && !track.locked)
    const trackId = existing?.id ?? `${transcript.id}-track`
    if (!existing && state.tracks.some(track => track.id === trackId)) throw new Error('The caption track already exists.')
    const cues = reviewedCaptionCues(transcript)
    if (!cues.length) throw new Error('There are no captions to import.')
    if (cues.some(cue => cue.id && state.items[cue.id])) throw new Error('A generated caption ID is already in use.')
    if (Object.values(state.items).some(item => item.trackId === trackId && cues.some(cue => cue.startTime < item.startTime + item.duration && cue.endTime > item.startTime))) throw new Error('These captions overlap captions already on the subtitle track. Remove or move those captions before importing.')
    const withTrack = { ...state, tracks: existing ? state.tracks : [{ id: trackId, name: 'Auto Captions', type: 'caption' as const, visible: true, locked: false }, ...state.tracks] }
    const next = importSubtitles(withTrack, cues, trackId, 0, { preserveCueTiming: true })
    const items = { ...next.items }
    for (const cue of cues) items[cue.id!] = { ...items[cue.id!], caption: captionReviewProperties(transcript, cue.text, cue.words!) }
    return { ...next, items, captionTranscripts: { ...state.captionTranscripts, [transcript.id]: structuredClone(transcript) } }
  }
}
