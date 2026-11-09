import type { TimelineItem, TimelineTransition } from './types'
import { alignedTransitionTiming } from './transitionAlignment'

type Attachment = Pick<TimelineTransition, 'trackId' | 'startTime' | 'duration' | 'leftClipId' | 'rightClipId' | 'alignment'>
const isVisual = (item: TimelineItem) => item.itemType !== 'audio' && item.streamType !== 'audio'

/** The chosen edge belongs to this clip; alignment only positions the effect around that cut. */
export function resolveTransitionAttachment(
  items: Record<string, TimelineItem>, clipId: string, edge: 'start' | 'end', duration: number,
  alignment: TimelineTransition['alignment'] = 'center',
): Attachment | null {
  const clip = items[clipId]
  if (!clip || !isVisual(clip)) return null
  const cut = edge === 'start' ? clip.startTime : clip.startTime + clip.duration
  const adjacent = Object.values(items)
    .filter(item => item.id !== clip.id && item.trackId === clip.trackId && isVisual(item))
    .map(item => ({ item, distance: Math.abs((edge === 'start' ? item.startTime + item.duration : item.startTime) - cut) }))
    .filter(candidate => candidate.distance <= 0.15)
    .sort((a, b) => a.distance - b.distance || a.item.id.localeCompare(b.item.id))[0]?.item
  if (adjacent) {
    const left = edge === 'start' ? adjacent : clip
    const right = edge === 'start' ? clip : adjacent
    return { trackId: clip.trackId, leftClipId: left.id, rightClipId: right.id, alignment,
      ...alignedTransitionTiming(left, right, duration, alignment) }
  }
  const clamped = Math.min(clip.duration, Math.max(0.05, duration))
  return { trackId: clip.trackId, leftClipId: edge === 'end' ? clip.id : undefined,
    rightClipId: edge === 'start' ? clip.id : undefined, alignment: edge, duration: clamped,
    startTime: edge === 'start' ? cut : cut - clamped }
}

/** Choose the nearest cut, then snap before/across/after it from the pointer position.
 * The center zone is a quarter of the transition's duration, limited by both clips.
 */
export function resolveTransitionDrop(
  items: Record<string, TimelineItem>, trackId: string, time: number, duration: number, hoveredClipId?: string,
): Attachment | null {
  const hovered = hoveredClipId ? items[hoveredClipId] : undefined
  const clip = hovered?.trackId === trackId ? hovered : Object.values(items)
    .filter(item => item.trackId === trackId && time >= item.startTime && time <= item.startTime + item.duration)
    .sort((a, b) => b.startTime - a.startTime || a.id.localeCompare(b.id))[0]
  if (!clip || !isVisual(clip)) return null
  const edge = time < clip.startTime + clip.duration / 2 ? 'start' : 'end'
  const centered = resolveTransitionAttachment(items, clip.id, edge, duration)
  if (!centered?.leftClipId || !centered.rightClipId) return centered
  const left = items[centered.leftClipId]
  const right = items[centered.rightClipId]
  const cut = left.startTime + left.duration
  const centerZone = Math.min(centered.duration, left.duration, right.duration) / 4
  const alignment = time < cut - centerZone ? 'end' : time > cut + centerZone ? 'start' : 'center'
  return resolveTransitionAttachment(items, clip.id, edge, duration, alignment)
}
