import type { CaptionPresentation, TextProperties } from '../timeline/types'
export type CaptionOutputFormat = 'hinglish' | 'hindi'
export type WordsPerCaption = 'auto' | 1 | 2 | 3 | 4 | 5
export interface CaptionPacing { wordsPerCaption: WordsPerCaption; aspectRatio: number }
export type CaptionEmphasis = Partial<Pick<TextProperties, 'fontFamily' | 'fontWeight' | 'fontStyle' | 'color' | 'backgroundColor'>>
export interface ReviewCaptionWord extends NativeCaptionWord {
  id: string
  nativeIndex?: number
  romanOverride?: { sourceText: string; text: string }
  emphasis?: CaptionEmphasis
  highlight?: boolean
}
export interface ReviewCaptionSegment { id: string; startTime: number; endTime: number; words: ReviewCaptionWord[] }
export interface CaptionReviewState { segments: ReviewCaptionSegment[]; style: Partial<TextProperties>; preset: string; activeWordColor: string; presentation?: CaptionPresentation }

export interface ProjectAudioClip {
  id: string
  path: string
  startTime: number
  duration: number
  sourceIn: number
  sourceOut: number
  speed: number
  reversed: boolean
  gain: [number, number][]
}
export interface ProjectAudioPlan { projectId: string; clips: ProjectAudioClip[]; duration: number }

export interface NativeCaptionWord {
  text: string
  startTime: number
  endTime: number
  confidence?: number | null
  timingNeedsReview?: boolean
}
export interface CaptionTranscript {
  id: string
  nativeText: string
  nativeWords: NativeCaptionWord[]
  language: string | null
  rawResponse?: Record<string, unknown>
  engine?: 'tara' | 'shruti'
  modelRevision?: string
  audioSha256: string
  audioPlan: ProjectAudioPlan
  outputFormat: CaptionOutputFormat
  nativeEdits: Record<number, string>
  romanEdits: Record<number, { sourceText: string; text: string }>
  review?: CaptionReviewState
  keywords?: string[]
  pacing?: CaptionPacing
}

export function isCaptionReview(value: unknown, duration: number): value is CaptionReviewState {
  if (!value || typeof value !== 'object') return false
  const review = value as CaptionReviewState
  if (!Array.isArray(review.segments) || !review.style || typeof review.style !== 'object' || typeof review.preset !== 'string' || typeof review.activeWordColor !== 'string') return false
  if (review.presentation !== undefined) {
    const p = review.presentation
    if (!p || !['none', 'active', 'progress'].includes(p.timing) || (p.underline !== undefined && typeof p.underline !== 'boolean') || (p.futureWordColor !== undefined && typeof p.futureWordColor !== 'string')) return false
    if (p.reveal !== undefined && !['all','progressive','single'].includes(p.reveal)) return false
    if (p.highlightStyle !== undefined && !['color','box','underline'].includes(p.highlightStyle)) return false
    if (p.highlightBackground !== undefined && typeof p.highlightBackground !== 'string') return false
    if (p.highlightRadius !== undefined && (!Number.isFinite(p.highlightRadius) || p.highlightRadius < 0)) return false
    if (p.emphasis !== undefined && (!p.emphasis || typeof p.emphasis !== 'object' || Object.entries(p.emphasis).some(([key, value]) => ['size','width','letterSpacing'].includes(key) ? typeof value !== 'number' || !Number.isFinite(value) || (key === 'letterSpacing' ? value < 0 : value <= 0) || value > 4 : !['fontFamily', 'fontWeight', 'fontStyle', 'color', 'textCase'].includes(key) || typeof value !== 'string'))) return false
  }
  const ids = new Set<string>()
  let previousEnd = 0
  for (const segment of review.segments) {
    if (!segment || typeof segment.id !== 'string' || !segment.id || ids.has(segment.id) || !Number.isFinite(segment.startTime) || !Number.isFinite(segment.endTime) || segment.startTime < previousEnd - 1e-9 || segment.endTime <= segment.startTime || segment.endTime > duration + 1e-9 || !Array.isArray(segment.words) || !segment.words.length) return false
    ids.add(segment.id); previousEnd = segment.endTime
    let previousWordStart = -1
    for (const word of segment.words) {
      if (!word || typeof word.id !== 'string' || !word.id || ids.has(word.id) || typeof word.text !== 'string' || !word.text.trim() || !Number.isFinite(word.startTime) || !Number.isFinite(word.endTime) || word.startTime < 0 || word.startTime < previousWordStart || word.endTime < word.startTime || word.endTime > duration + .1) return false
      if (word.romanOverride && (typeof word.romanOverride.sourceText !== 'string' || typeof word.romanOverride.text !== 'string' || !word.romanOverride.text.trim())) return false
      if (word.highlight !== undefined && typeof word.highlight !== 'boolean') return false
      if (word.emphasis && (typeof word.emphasis !== 'object' || Object.entries(word.emphasis).some(([key, value]) => !['fontFamily', 'fontWeight', 'fontStyle', 'color', 'backgroundColor'].includes(key) || !['string', 'number'].includes(typeof value)))) return false
      ids.add(word.id); previousWordStart = word.startTime
    }
  }
  return true
}

export function isCaptionTranscript(value: unknown): value is CaptionTranscript {
  if (!value || typeof value !== 'object') return false
  const t = value as CaptionTranscript
  if (typeof t.id !== 'string' || !t.id || typeof t.nativeText !== 'string' || typeof t.audioSha256 !== 'string' || !['hindi', 'hinglish'].includes(t.outputFormat)) return false
  if (!Array.isArray(t.nativeWords) || !t.nativeWords.length || !t.nativeWords.every(word => word && typeof word.text === 'string' && Number.isFinite(word.startTime) && Number.isFinite(word.endTime) && word.startTime >= 0 && word.endTime >= word.startTime)) return false
  if (!t.audioPlan || typeof t.audioPlan.projectId !== 'string' || !Array.isArray(t.audioPlan.clips) || !Number.isFinite(t.audioPlan.duration)) return false
  if (t.audioPlan.duration <= 0 || t.nativeWords.some((word, index) => word.endTime > t.audioPlan.duration + .1 || !word.text.trim() || (index > 0 && word.startTime < t.nativeWords[index - 1].startTime))) return false
  if (!t.nativeEdits || typeof t.nativeEdits !== 'object' || Array.isArray(t.nativeEdits) || !Object.values(t.nativeEdits).every(text => typeof text === 'string')) return false
  if (!t.romanEdits || typeof t.romanEdits !== 'object' || Array.isArray(t.romanEdits) || !Object.values(t.romanEdits).every(edit => edit && typeof edit.sourceText === 'string' && typeof edit.text === 'string')) return false
  if (t.review !== undefined && !isCaptionReview(t.review, t.audioPlan.duration)) return false
  if (t.pacing !== undefined && (!t.pacing || !['auto', 1, 2, 3, 4, 5].includes(t.pacing.wordsPerCaption) || !Number.isFinite(t.pacing.aspectRatio) || t.pacing.aspectRatio <= 0)) return false
  if (t.review?.segments.some(segment => segment.words.some(word => word.nativeIndex !== undefined && (!Number.isInteger(word.nativeIndex) || word.nativeIndex < 0 || word.nativeIndex >= t.nativeWords.length)))) return false
  if (t.keywords !== undefined && (!Array.isArray(t.keywords) || t.keywords.length > 100 || t.keywords.some(word => typeof word !== 'string' || word.length > 200))) return false
  return t.language === null || typeof t.language === 'string'
}
