import { CAPTION_PRESETS, type CaptionPresentation, type CaptionProperties, type TimelineItem, type TextProperties } from '../timeline/types'
import { DEFAULT_TRANSFORM } from '../timeline/types'
import { captionWordGroups, captionGroupTiming, reviewedCaptionCues, reviewedWord, reviewWordText } from './transcriptReview'
import type { CaptionPacing } from './types'
import { isCaptionReview, type CaptionEmphasis, type CaptionTranscript, type ReviewCaptionWord } from './types'
import { captionPresetPresentation, captionPresetStyle, defaultEmphasisIndex, withCaptionFocus } from './captionStyles'

function focusWords(words: ReviewCaptionWord[], enabled: boolean): ReviewCaptionWord[] {
  if (!enabled || !words.length) return words
  const selected = words.findIndex(word => word.highlight)
  const index = selected >= 0 ? selected : defaultEmphasisIndex(words.map(word => word.text))
  return words.map((word, i) => ({ ...word, highlight: i === index }))
}

export function initializeCaptionReview(transcript: CaptionTranscript): CaptionTranscript {
  if (transcript.review) return transcript
  let index = 0
  const segments = reviewedCaptionCues(transcript).map(cue => ({ id: cue.id!, startTime: cue.startTime, endTime: cue.endTime,
    words: cue.words!.map(word => {
      const nativeIndex = index++
      const text = transcript.nativeEdits[nativeIndex] ?? transcript.nativeWords[nativeIndex].text
      return { id: word.id!, text, nativeIndex, startTime: word.startTime, endTime: word.endTime,
        ...(transcript.nativeWords[nativeIndex].timingNeedsReview ? { timingNeedsReview: true } : {}),
        romanOverride: { sourceText: text, text: reviewedWord(transcript, nativeIndex, 'hinglish') } }
    }) }))
  return { ...transcript, review: { segments, style: captionPresetStyle('Clean'), preset: 'Clean', activeWordColor: '#FFE600', presentation: captionPresetPresentation('Clean') } }
}

/** Regroup the edited draft, retaining every word, correction, emphasis and timestamp. */
export function regroupCaptionReview(input: CaptionTranscript, pacing: CaptionPacing): CaptionTranscript {
  const transcript = initializeCaptionReview(input)
  const review = transcript.review!
  const runs: typeof review.segments[] = []
  for (const segment of review.segments) {
    const run = runs.at(-1)
    if (!run || segment.startTime - run.at(-1)!.endTime >= .25 - 1e-9) runs.push([segment])
    else run.push(segment)
  }
  const segments = runs.flatMap(run => {
    const words = run.flatMap(segment => segment.words)
    const groups = captionWordGroups(words, pacing)
    return groups.map((indices, index) => {
      const bounds = captionGroupTiming(words, groups, index, run.at(-1)!.endTime)
      return { id: `${transcript.id}-group-${words[indices[0]].id}`, startTime: index === 0 ? run[0].startTime : bounds.startTime,
        endTime: index === groups.length - 1 ? run.at(-1)!.endTime : bounds.endTime, words: focusWords(indices.map(i => words[i]), !!review.presentation?.emphasis) }
    })
  })
  const next = { ...transcript, pacing, review: { ...review, segments } }
  if (!isCaptionReview(next.review, transcript.audioPlan.duration)) throw new Error('Adjust word timing before regrouping these captions.')
  return next
}

export type CaptionReviewEdit =
  | { type: 'text'; id: string; text: string }
  | { type: 'insert'; id: string; time: number }
  | { type: 'delete'; id: string }
  | { type: 'split'; id: string; at: number; newId: string }
  | { type: 'merge'; id: string }
  | { type: 'time'; id: string; startTime: number; endTime: number; shiftWords?: boolean }
  | { type: 'word-time'; id: string; wordId: string; startTime: number; endTime: number }
  | { type: 'emphasis'; id: string; wordIds: string[]; style: CaptionEmphasis | null }
  | { type: 'focus-word'; id: string; wordId: string }
  | { type: 'preset'; preset: string }
  | { type: 'style'; style: Partial<TextProperties>; activeWordColor?: string; presentation?: CaptionPresentation }

/** Transcript draft edits do not mutate the project or the immutable ASR archive. */
export function editCaptionReview(input: CaptionTranscript, edit: CaptionReviewEdit): CaptionTranscript {
  const transcript = structuredClone(initializeCaptionReview(input))
  const review = transcript.review!
  const index = 'id' in edit ? review.segments.findIndex(segment => segment.id === edit.id) : -1
  const segment = review.segments[index]
  if (edit.type === 'preset') {
    if (!CAPTION_PRESETS[edit.preset]) throw new Error('Unknown caption preset.')
    review.preset = edit.preset
    review.style = captionPresetStyle(edit.preset)
    review.presentation = captionPresetPresentation(edit.preset)
    review.activeWordColor = edit.preset === 'Green Pill' ? '#102017' : '#FFE600'
  } else if (edit.type === 'style') {
    review.style = { ...review.style, ...edit.style }
    if (edit.activeWordColor) review.activeWordColor = edit.activeWordColor
    if (edit.presentation) review.presentation = structuredClone(edit.presentation)
  } else if (edit.type === 'insert') {
    let start = Math.max(0, edit.time)
    for (const existing of review.segments) {
      if (start >= existing.startTime && start < existing.endTime) start = existing.endTime
    }
    const next = review.segments.find(existing => existing.startTime >= start)
    const end = Math.min(start + 1.2, next?.startTime ?? transcript.audioPlan.duration, transcript.audioPlan.duration)
    if (end - start < .05) throw new Error('Move the playhead into a gap with room for a caption.')
    review.segments.push({ id: edit.id, startTime: start, endTime: end, words: [
      { id: `${edit.id}-word-0`, text: 'New', startTime: start, endTime: (start + end) / 2 },
      { id: `${edit.id}-word-1`, text: 'caption', startTime: (start + end) / 2, endTime: end },
    ] })
    review.segments.sort((a, b) => a.startTime - b.startTime)
  } else {
    if (!segment) throw new Error('Select a caption first.')
    if (edit.type === 'delete') review.segments.splice(index, 1)
    if (edit.type === 'merge') {
      const next = review.segments[index + 1]
      if (!next) throw new Error('There is no following caption to merge.')
      segment.endTime = next.endTime; segment.words.push(...next.words); review.segments.splice(index + 1, 1)
    }
    if (edit.type === 'split') {
      if (edit.at < 1 || edit.at >= segment.words.length) throw new Error('Place the text cursor between words to split.')
      const boundary = segment.words[edit.at].startTime
      if (boundary <= segment.startTime || boundary >= segment.endTime) throw new Error('This split needs a distinct word boundary. Adjust word timing first.')
      const end = segment.endTime
      const following = segment.words.splice(edit.at)
      segment.endTime = boundary
      review.segments.splice(index + 1, 0, { id: edit.newId, startTime: boundary, endTime: end, words: following })
    }
    if (edit.type === 'time') {
      const delta = edit.shiftWords ? edit.startTime - segment.startTime : 0
      segment.startTime = edit.startTime; segment.endTime = edit.endTime
      segment.words = segment.words.map(word => ({ ...word,
        startTime: Math.max(edit.startTime, Math.min(edit.endTime, word.startTime + delta)),
        endTime: Math.max(edit.startTime, Math.min(edit.endTime, word.endTime + delta)) }))
    }
    if (edit.type === 'word-time') {
      const word = segment.words.find(word => word.id === edit.wordId)
      if (!word || edit.startTime < segment.startTime || edit.endTime > segment.endTime) throw new Error('Word times must stay inside their caption.')
      word.startTime = edit.startTime; word.endTime = edit.endTime
      delete word.timingNeedsReview
    }
    if (edit.type === 'emphasis') segment.words = segment.words.map(word => edit.wordIds.includes(word.id) ? { ...word, emphasis: edit.style === null ? undefined : { ...word.emphasis, ...edit.style } } : word)
    if (edit.type === 'focus-word') {
      if (!segment.words.some(word => word.id === edit.wordId)) throw new Error('Select a word from this caption.')
      segment.words = segment.words.map(word => ({ ...word, highlight: word.id === edit.wordId }))
    }
    if (edit.type === 'text') segment.words = editText(segment.words, edit.text, transcript.outputFormat, segment.startTime, segment.endTime, edit.id)
  }
  review.segments = review.segments.map(segment => ({ ...segment, words: focusWords(segment.words, !!review.presentation?.emphasis) }))
  if (!isCaptionReview(review, transcript.audioPlan.duration)) throw new Error('Caption times must be ordered, inside the audio, and must not overlap. Text cannot be empty.')
  return transcript
}

function editText(old: ReviewCaptionWord[], text: string, format: CaptionTranscript['outputFormat'], start: number, end: number, id: string): ReviewCaptionWord[] {
  const tokens = text.trim().split(/\s+/u).filter(Boolean)
  if (!tokens.length) throw new Error('Use Delete to remove an empty caption.')
  if (tokens.length > 100) throw new Error('Split this caption into shorter groups.')
  const prior = old.map(word => reviewWordText(word, format))
  // LCS retains timestamps/IDs/styles of unchanged words when text is inserted.
  const table = Array.from({ length: prior.length + 1 }, () => Array(tokens.length + 1).fill(0) as number[])
  for (let i = prior.length - 1; i >= 0; i--) for (let j = tokens.length - 1; j >= 0; j--) table[i][j] = prior[i] === tokens[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
  const anchors: [number, number][] = []
  let i = 0, j = 0
  while (i < prior.length && j < tokens.length) {
    if (prior[i] === tokens[j]) { anchors.push([i++, j++]); continue }
    if (table[i + 1][j] >= table[i][j + 1]) i++; else j++
  }
  anchors.push([old.length, tokens.length])
  const result: ReviewCaptionWord[] = []
  let oldAt = 0, newAt = 0, serial = 0
  const used = new Set(old.map(word => word.id))
  for (const [oldEnd, newEnd] of anchors) {
    const pairs = Math.min(oldEnd - oldAt, newEnd - newAt)
    for (let k = 0; k < pairs; k++) {
      const word = { ...old[oldAt + k] }, token = tokens[newAt + k]
      if (format === 'hinglish') word.romanOverride = { sourceText: word.text, text: token }
      else { word.text = token; word.romanOverride = undefined }
      result.push(word)
    }
    const remaining = newEnd - newAt - pairs
    const from = result.at(-1)?.endTime ?? start
    const to = old[oldEnd]?.startTime ?? end
    for (let k = 0; k < remaining; k++) {
      let wordId: string
      do { wordId = `${id}-inserted-${serial++}` } while (used.has(wordId))
      used.add(wordId)
      // New user-authored words get editable timing in the available interval;
      // never redistribute the original ASR words to make room.
      const low = Math.min(from, to), high = Math.max(low, to)
      result.push({ id: wordId, text: tokens[newAt + pairs + k], startTime: low + (high - low) * k / remaining, endTime: low + (high - low) * (k + 1) / remaining })
    }
    if (oldEnd < old.length) result.push(old[oldEnd])
    oldAt = oldEnd + 1; newAt = newEnd + 1
  }
  return result
}

export function captionReviewProperties(transcript: CaptionTranscript, text: string, words: import('../timeline/types').CaptionWord[]): CaptionProperties {
  return { text, words: withCaptionFocus(words, transcript.review?.presentation), style: transcript.review?.style ?? { ...CAPTION_PRESETS.Clean }, preset: transcript.review?.preset ?? 'Clean', activeWordColor: transcript.review?.activeWordColor ?? '#FFE600', presentation: transcript.review?.presentation }
}

/** Rendering projection only; these items are not committed until Import. */
export function captionPreviewItems(transcript: CaptionTranscript): TimelineItem[] {
  return reviewedCaptionCues(transcript).map(cue => ({ id: cue.id!, assetId: '', trackId: 'caption-review-preview', itemType: 'caption', streamType: 'caption', startTime: cue.startTime, duration: cue.duration, sourceIn: 0, sourceOut: cue.duration, transform: { ...DEFAULT_TRANSFORM }, caption: captionReviewProperties(transcript, cue.text, cue.words!) }))
}

export interface CaptionReviewHistory { past: CaptionTranscript[]; present: CaptionTranscript; future: CaptionTranscript[] }
export function commitCaptionReview(history: CaptionReviewHistory, present: CaptionTranscript): CaptionReviewHistory { return { past: [...history.past.slice(-99), history.present], present, future: [] } }
export function travelCaptionReview(history: CaptionReviewHistory, direction: 'undo' | 'redo'): CaptionReviewHistory {
  if (direction === 'undo') { const present = history.past.at(-1); return present ? { past: history.past.slice(0, -1), present, future: [history.present, ...history.future] } : history }
  const present = history.future[0]; return present ? { past: [...history.past, history.present], present, future: history.future.slice(1) } : history
}
