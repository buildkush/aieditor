import type { TranscriptResult, TranscriptWord } from '../types'

export interface EnglishSuggestion { original: string; proposed: string; startTime: number; endTime: number; sourceIndices: number[]; alternativeIndices: number[] }
const vocabulary = new Set('keychain younger champions champion edition golden can coke football collection product brand exclusive guarantee winner winners world cup history video audio phone available online specifically'.split(' '))
const protectedWords = new Set('hai hain hoon main mein nahi ka ki ke ko se par aur tum tumne mujhe hum aap yeh woh ho tha thi the a an and if it is of to for in on'.split(' '))
const clean = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '')
const tokens = (text: string) => text.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim().replace(/\s+/g, ' ')
const sound = (text: string) => clean(text).replace(/ph/g, 'f').replace(/ck/g, 'k').replace(/ch/g, 'c').replace(/[aeiouy]/g, '')
function similarity(a: string, b: string) {
  if (!a || !b) return 0
  let row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) { const next = [i]; for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); row = next }
  return 1 - row[b.length] / Math.max(a.length, b.length)
}
function timed(words: TranscriptWord[]) { return words.every((word, i) => word.startTime != null && word.endTime != null && Number.isFinite(word.startTime) && Number.isFinite(word.endTime) && word.startTime >= 0 && word.endTime > word.startTime && (i === 0 || word.startTime >= words[i - 1].startTime!)) }
function ordered(words: TranscriptWord[]) {
  let previous = -1
  return words.every(word => {
    if (word.startTime == null) return true
    if (!Number.isFinite(word.startTime) || word.startTime < previous || word.startTime < 0) return false
    previous = word.startTime; return true
  })
}

/** Suggestions only. No transcript or timing is ever changed by this experiment. */
export function suggestEnglishCorrections(primary: TranscriptResult, alternative: TranscriptResult, keywords: string[] = []): EnglishSuggestion[] {
  if (primary.model !== 'shruti' || alternative.model !== 'whistle' || primary.source.audioSha256 !== alternative.source.audioSha256) return []
  const a = primary.words ?? [], b = alternative.words ?? []
  if (!a.length || !b.length || !ordered(a) || !ordered(b)) return []
  const phrases = new Map(keywords.filter(word => /^[a-z0-9][a-z0-9 &’'\-]+$/iu.test(word)).map(word => [clean(word), word]))
  const allowed = new Set([...vocabulary, ...keywords.flatMap(phrase => phrase.split(/\s+/).map(clean))])
  const candidates: (EnglishSuggestion & { score: number; endA: number; endB: number })[] = []
  for (let i = 0; i < a.length; i++) for (let count = 1; count <= 3 && i + count <= a.length; count++) {
    const span = a.slice(i, i + count), original = span.map(word => word.text).join(' ')
    if (!timed(span)) continue
    // Devanagari and Roman Hindi function words are never rewritten by English ASR.
    if (!span.every(word => /^[a-z0-9][a-z0-9 &’'\-.,!?]*$/iu.test(word.text.trim()) && !protectedWords.has(clean(word.text)))) continue
    const start = span[0].startTime!, end = span.at(-1)!.endTime!
    for (let j = 0; j < b.length; j++) {
      if (b[j].startTime == null || b[j].endTime == null) continue
      if (b[j].startTime! > end + .3) break
      if (Math.abs(start - b[j].startTime!) > .25) continue
      for (let length = 1; length <= 3 && j + length <= b.length; length++) {
        const other = b.slice(j, j + length), raw = other.map(word => word.text).join(' ')
        if (!timed(other)) continue
        if (!other.every(word => /^[a-z0-9][a-z0-9 &’'\-.,!?]*$/iu.test(word.text.trim()) && allowed.has(clean(word.text)))) continue
        const proposed = phrases.get(clean(raw)) ?? raw
        if (tokens(original) === tokens(proposed) || Math.abs(end - other.at(-1)!.endTime!) > .3) continue
        const overlap = Math.max(0, Math.min(end, other.at(-1)!.endTime!) - Math.max(start, other[0].startTime!)) / (Math.max(end, other.at(-1)!.endTime!) - Math.min(start, other[0].startTime!))
        const lexical = Math.max(similarity(clean(original), clean(proposed)), similarity(sound(original), sound(proposed)))
        if (overlap < .65 || lexical < .5) continue
        const phraseBonus = length > 1 && phrases.has(clean(raw)) ? .15 : 0
        const neighbours = [[a[i - 1], b[j - 1]], [a[i + count], b[j + length]]]
        const contextBonus = neighbours.some(([left, right]) => left && right && timed([left]) && timed([right]) && tokens(left.text) === tokens(right.text) && Math.abs(left.startTime! - right.startTime!) <= .25) ? .03 : 0
        candidates.push({ original, proposed, startTime: start, endTime: end, sourceIndices: span.map((_, k) => i + k), alternativeIndices: other.map((_, k) => j + k), score: overlap * .7 + lexical * .3 + phraseBonus + contextBonus, endA: i + count, endB: j + length })
      }
    }
  }
  const chosen: typeof candidates = []
  for (const candidate of candidates.sort((x, y) => y.score - x.score)) {
    const conflicts = (other: typeof candidate) => candidate.sourceIndices.some(i => other.sourceIndices.includes(i)) || candidate.alternativeIndices.some(i => other.alternativeIndices.includes(i))
    if (chosen.some(conflicts)) continue
    if (candidates.some(other => other !== candidate && conflicts(other) && clean(other.proposed) !== clean(candidate.proposed) && Math.abs(other.score - candidate.score) < .08)) continue
    chosen.push(candidate)
  }
  // Reject crossing sequence alignments rather than guessing their correspondence.
  return chosen.sort((x, y) => x.startTime - y.startTime).filter((candidate, i, all) => i === 0 || candidate.alternativeIndices[0] >= all[i - 1].endB)
    .map(({ score: _score, endA: _a, endB: _b, ...suggestion }) => suggestion)
}
