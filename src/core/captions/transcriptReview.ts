import { romanText } from './romanHindi'
import { isCaptionReview, type CaptionOutputFormat, type CaptionTranscript, type NativeCaptionWord, type ReviewCaptionWord } from './types'
import type { SubtitleCue } from '../subtitles/subtitleParser'
import type { CaptionPacing } from './types'

export function captionWordTarget(pacing?: CaptionPacing): number {
  if (!pacing) return 4
  if (pacing.wordsPerCaption !== 'auto') return pacing.wordsPerCaption
  return pacing.aspectRatio < .85 ? 2 : pacing.aspectRatio < 1.2 ? 3 : 4
}

/** Align punctuation from native text to real timed words; never synthesize times. */
export function alignCaptionWords(text: string, words: NativeCaptionWord[]): NativeCaptionWord[] {
  if (!words.length) throw new Error('Transcription returned no timed words. There are no captions to import.')
  let cursor = 0
  const positions = words.map(word => {
    // Native word contract is start <= end: two boundaries can share an
    // alignment point. Keep those native anchors instead of padding/dropping words.
    if (!Number.isFinite(word.startTime) || !Number.isFinite(word.endTime) || word.startTime < 0 || word.endTime < word.startTime) throw new Error('Transcription returned missing or invalid word times. Captions cannot be imported without real timestamps.')
    const token = word.text.trim()
    if (!token) throw new Error('Transcription returned an empty word.')
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const matcher = new RegExp(escaped, 'giu'); matcher.lastIndex = cursor
    const match = matcher.exec(text)
    if (!match || /[\p{L}\p{N}]/u.test(text.slice(cursor, match.index))) throw new Error('The native transcript and timed words do not align. Review the model output before importing.')
    cursor = match.index + match[0].length
    return match.index
  })
  if (words.some((word, index) => index > 0 && word.startTime < words[index - 1].startTime)) throw new Error('Transcription returned unordered word timestamps. Please generate captions again.')
  if (/[\p{L}\p{N}]/u.test(text.slice(cursor))) throw new Error('The native transcript contains speech without word timestamps. Please transcribe again before importing.')
  return words.map((word, index) => ({ ...word, text: text.slice(index === 0 ? 0 : positions[index], positions[index + 1] ?? text.length).trim() }))
}

export function reviewedWord(transcript: CaptionTranscript, index: number, format: CaptionOutputFormat): string {
  const source = transcript.nativeEdits[index] ?? transcript.nativeWords[index].text
  return format === 'hindi' ? source : romanText(source, transcript.romanEdits[index])
}

export function reviewWordText(word: ReviewCaptionWord, format: CaptionOutputFormat): string {
  return format === 'hindi' ? word.text : romanText(word.text, word.romanOverride)
}

/** Exactly one active word from the shared project clock; end bounds are exclusive. */
export function activeCaptionWord(words: { startTime: number; endTime: number }[], time: number): number {
  for (let index = words.length - 1; index >= 0; index--) {
    if (time >= words[index].startTime && (time < words[index].endTime || (words[index].startTime === words[index].endTime && time === words[index].startTime))) return index
  }
  return -1
}

/** Group caption cues at returned word boundaries, never proportional timing. */
export function captionWordGroups(words: NativeCaptionWord[], pacing?: CaptionPacing): number[][] {
  const target = captionWordTarget(pacing)
  const legacy = !pacing || (pacing.wordsPerCaption === 'auto' && pacing.aspectRatio >= 1.2)
  const pause = .25
  const groups: number[][] = []
  for (let index = 0; index < words.length; index++) {
    const last = groups.at(-1)
    const previous = words[index - 1]
    const canSplit = last && words[index].startTime > words[last[0]].startTime
    const speechBreak = previous && (words[index].startTime - previous.endTime >= pause - 1e-9 || /[.!?।॥]$/u.test(previous.text) || (last && last.length >= 2 && /[,;:]$/u.test(previous.text)))
    const connected = previous && /^(का|की|के|में|से|पर|और|the|a|an|of|to|and|for)$/iu.test(previous.text)
    if (!legacy) {
      const modifier = previous && /^(golden|new|old|big|small|red|blue|black|white|first|last|next|same)$/iu.test(previous.text)
      if (last && canSplit && !speechBreak && modifier && last.length >= target && last.length > 1 && !/^(a|an|the)$/iu.test(words[last[0]].text)) {
        groups.push([last.pop()!, index])
        continue
      }
      const pair = previous && /^(if it|and then|to be|of the|in the|it is|as well|का है|के लिए)$/iu.test(`${previous.text} ${words[index].text}`)
      const postposition = /^(का|की|के|में|से|पर)$/u.test(words[index].text)
      const shortTriple = pacing?.wordsPerCaption === 'auto' && target === 2 && last?.length === 2 && [...last, index].every(i => words[i].text.length <= 4) && [...last, index].reduce((sum, i) => sum + words[i].text.length, 0) <= 9
      const finishesPhrase = target > 1 && /[,;:.!?।॥]$/u.test(words[index].text) && words[index].text.length <= 6
      const keepPhrase = last && last.length < target + 1 && (pair || connected || modifier || postposition || shortTriple || finishesPhrase)
      if (!last || (canSplit && (speechBreak || (last.length >= target && !keepPhrase) || words[index].endTime - words[last[0]].startTime > 3))) groups.push([index])
      else last.push(index)
      continue
    }
    if (last && canSplit && !speechBreak && last.length >= 4 && connected) {
      // Make room before a connected phrase instead of creating five-word cues:
      // “tumne kabhi | Coke ka golden can”, or “look at this | the golden can”.
      const carry = last.splice(-(/^(का|की|के|में|से|पर)$/u.test(previous.text) ? 2 : 1))
      groups.push([...carry, index])
      continue
    }
    const sizeLimit = last && ((last.length >= 4 && !connected) || last.length >= 6 || words[index].endTime - words[last[0]].startTime > 3)
    if (!last || (canSplit && (sizeLimit || speechBreak))) groups.push([index])
    else last.push(index)
  }
  // A word may be a point; a timeline caption still needs a real display span.
  // Join point-only groups only within the same speech run. A distant neighbour
  // must never make a caption cover the silence between them.
  const endOf = (group: number[]) => group.reduce((end, index) => Math.max(end, words[index].endTime), 0)
  for (let index = 0; index < groups.length;) {
    const group = groups[index]
    if (endOf(group) > words[group[0]].startTime || groups.length === 1) { index++; continue }
    const previous = groups[index - 1], next = groups[index + 1]
    const at = words[group[0]].startTime
    const previousGap = previous ? Math.max(0, at - endOf(previous)) : Infinity
    const nextGap = next ? Math.max(0, words[next[0]].startTime - at) : Infinity
    if (Math.min(previousGap, nextGap) >= pause - 1e-9) { index++; continue }
    const joinPrevious = previousGap <= nextGap
    if (joinPrevious) {
      groups.splice(index - 1, 2, [...previous, ...group])
      index--
    } else groups.splice(index, 2, [...group, ...next])
  }
  // Avoid a stranded final word when a count boundary can become 3 + 2.
  for (let index = 1; index < groups.length; index++) {
    const group = groups[index], previous = groups[index - 1]
    const lastWord = words[previous.at(-1)!]
    if (group.length === 1 && previous.length >= 3 && words[group[0]].startTime - lastWord.endTime < pause - 1e-9 && !/[.!?,;:।॥]$/u.test(lastWord.text)) group.unshift(previous.pop()!)
  }
  return groups
}

/** Container bounds are separate from immutable model word timestamps. */
export function captionGroupTiming(words: NativeCaptionWord[], groups: number[][], index: number, audioEnd: number) {
  const indices = groups[index]
  const startTime = words[indices[0]].startTime
  const wordEnd = Math.max(...indices.map(index => words[index].endTime))
  // An isolated point gets a brief display container, never a span to the next
  // utterance. Keep its actual word timestamps unchanged, including start == end.
  const displayEnd = wordEnd > startTime ? wordEnd : startTime + .1
  const nextStart = groups[index + 1] ? words[groups[index + 1][0]].startTime : audioEnd
  return { startTime, endTime: Math.min(displayEnd, nextStart, audioEnd) }
}

export function reviewedCaptionCues(transcript: CaptionTranscript): SubtitleCue[] {
  if (transcript.review) {
    if (!isCaptionReview(transcript.review, transcript.audioPlan.duration)) throw new Error('Check caption times, text and overlapping captions before importing.')
    return transcript.review.segments.map(segment => {
      const words = segment.words.map(word => ({ id: word.id, word: reviewWordText(word, transcript.outputFormat), startTime: word.startTime, endTime: word.endTime, highlight: word.highlight, ...word.emphasis }))
      return { id: segment.id, startTime: segment.startTime, endTime: segment.endTime, duration: segment.endTime - segment.startTime, text: words.map(word => word.word).join(' '), words }
    })
  }
  const groups = captionWordGroups(transcript.nativeWords, transcript.pacing)
  if (transcript.nativeWords.every(word => word.startTime === transcript.nativeWords[0].startTime && word.endTime === word.startTime)) throw new Error('Transcription returned only a single time point for this caption. There is no timed interval to import; generate captions again.')
  return groups.map((indices, group) => {
    const words = indices.map(index => ({ id: `${transcript.id}-word-${index}`, word: reviewedWord(transcript, index, transcript.outputFormat).trim(), startTime: transcript.nativeWords[index].startTime, endTime: transcript.nativeWords[index].endTime }))
    if (words.some(word => !word.word)) throw new Error('Caption words cannot be empty. Correct the word before importing.')
    const { startTime, endTime } = captionGroupTiming(transcript.nativeWords, groups, group, transcript.audioPlan.duration)
    if (endTime <= startTime) throw new Error('Transcription returned only a single time point for this caption. There is no timed interval to import; generate captions again.')
    return { id: `${transcript.id}-caption-${group}`, startTime, endTime, duration: endTime - startTime, text: words.map(word => word.word).join(' '), words }
  })
}
