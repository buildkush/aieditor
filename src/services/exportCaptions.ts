import { invoke, isTauri } from '@tauri-apps/api/core'
import type { ProjectState } from '../core/project/projectState'
import { projectCaptionCues } from '../core/subtitles/projectCaptionExport'
import { serializeToSrt, serializeToVtt } from '../core/subtitles/subtitleParser'

export async function exportCaptions(state: ProjectState): Promise<void> {
  const cues = projectCaptionCues(state)
  if (!cues.length) throw new Error('Add captions to the timeline before exporting.')
  const name = (state.name || 'Captions').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
  const srt = serializeToSrt(cues)
  if (isTauri()) {
    await invoke('export_caption_file', { defaultName: `${name}.srt`, srt, vtt: serializeToVtt(cues) })
    return
  }
  const url = URL.createObjectURL(new Blob([srt], { type: 'application/x-subrip;charset=utf-8' }))
  const link = document.createElement('a'); link.href = url; link.download = `${name}.srt`
  document.body.appendChild(link); link.click(); link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
