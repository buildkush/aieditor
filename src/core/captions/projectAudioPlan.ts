import type { ProjectState } from '../project/projectState'
import { evaluateItemAudio } from '../timeline/keyframeEvaluation'
import { evaluateItemEffects } from '../timeline/effectEvaluation'
import type { ProjectAudioPlan } from './types'

/** Same audible audio tracks as preview; a linked video's stream is not mixed twice. */
export function projectAudioPlan(state: ProjectState): ProjectAudioPlan {
  if (!state?.id) throw new Error('Open a project before generating captions.')
  const tracks = new Set(state.tracks.filter(track => track.type === 'audio' && !track.muted).map(track => track.id))
  const clips: ProjectAudioPlan['clips'] = []
  for (const item of Object.values(state.items).sort((a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id))) {
    if (!tracks.has(item.trackId) || item.audio?.muted || item.duration <= 0) continue
    const asset = state.assets[item.assetId]
    if (!asset || !['audio', 'video'].includes(asset.type)) continue
    if (asset.isMissing || !asset.path || /^(blob:|https?:|data:)/i.test(asset.path)) throw new Error(`Relink local audio for “${asset.name}” before generating captions.`)
    const rate = item.speed?.speed ?? 1
    if (!Number.isFinite(rate) || rate < .25 || rate > 4) throw new Error('Auto captions support audio speeds from 0.25× to 4×.')
    const animated = Object.values(item.keyframes ?? {}).some(keys => keys?.length) || !!item.effects?.some(effect => effect.enabled !== false && effect.effectId === 'gain')
    const count = animated ? Math.ceil(item.duration * 30) : 1
    if (count > 1_000_000) throw new Error('This audio clip is too long to prepare for auto captions.')
    const gain: [number, number][] = []
    for (let i = 0; i <= count; i++) {
      const local = item.duration * i / count
      const audio = evaluateItemAudio(item, item.startTime + local)
      const value = audio.muted ? 0 : Math.max(0, audio.volume) * Math.pow(10, evaluateItemEffects(item, item.startTime + local).gainDb / 20)
      if (!Number.isFinite(value)) throw new Error('An audio clip has an invalid volume.')
      gain.push([local, value])
    }
    if (!gain.some(([, value]) => value > 0)) continue
    clips.push({ id: item.id, path: asset.path, startTime: item.startTime, duration: item.duration, sourceIn: item.sourceIn, sourceOut: item.sourceOut, speed: rate, reversed: !!item.speed?.reversed, gain })
  }
  return { projectId: state.id, clips, duration: clips.reduce((end, clip) => Math.max(end, clip.startTime + clip.duration), 0) }
}
