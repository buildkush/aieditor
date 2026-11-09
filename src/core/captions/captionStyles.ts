import { CAPTION_PRESETS, type CaptionPresentation, type CaptionProperties, type CaptionWord } from '../timeline/types'

export const CAPTION_STYLE_GROUPS = [
  { name: 'Classic', presets: ['Clean', 'Minimal', 'Bold', 'Meme', 'Highlight'] },
  { name: 'Dynamic', presets: ['Script Focus', 'Yellow Focus', 'Green Pill'] },
] as const

const presentations: Record<string, CaptionPresentation> = {
  Clean: { timing: 'none' }, Minimal: { timing: 'none' }, Bold: { timing: 'none' },
  Meme: { timing: 'none' }, Highlight: { timing: 'none' },
  'Script Focus': { timing: 'none', reveal: 'progressive', emphasis: { fontFamily: '"Segoe Script", "Brush Script MT", cursive', fontWeight: '400', fontStyle: 'italic', size: 1.5, color: '#FFFFFF' } },
  'Yellow Focus': { timing: 'none', reveal: 'progressive', emphasis: { fontFamily: '"Arial Black", Impact, sans-serif', fontWeight: '900', size: 1.65, width: 1.28, letterSpacing: .04, color: '#FFE600', textCase: 'uppercase' } },
  'Green Pill': { timing: 'progress', reveal: 'progressive', futureWordColor: '#2B773D' },
}

export function captionPresetPresentation(preset: string): CaptionPresentation {
  return structuredClone(presentations[preset] ?? { timing: 'none' })
}

export function captionPresetStyle(preset: string) {
  if (!CAPTION_PRESETS[preset]) throw new Error('Unknown caption preset.')
  const style = CAPTION_PRESETS[preset]
  // Reset features from the previous style instead of leaking a pill/shadow.
  return { underline: false, textCase: 'none' as const,
    backgroundEnabled: !!style.backgroundColor && (style.backgroundOpacity ?? 0) > 0,
    shadowEnabled: !!style.shadowColor && ((style.shadowBlur ?? 0) > 0 || (style.shadowOffsetX ?? 0) !== 0 || (style.shadowOffsetY ?? 0) !== 0),
    ...style }
}

const functionWords = new Set('a an the is are was were it this that and or but to of in on for with i you we they my your ka ki ke ko hai hain ho aur toh to ye yeh ek se mein me bhi ko ne bhai यह ये है हैं और तो का की के को में से भी एक'.split(' '))

/** A deterministic editable starting choice, not a semantic/LLM judgement. */
export function defaultEmphasisIndex(texts: string[]): number {
  let selected = 0, score = -1
  texts.forEach((text, i) => {
    const token = text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
    const next = functionWords.has(token) ? -1 : Array.from(token).length
    if (next > score) { selected = i; score = next }
  })
  return selected
}

export function withCaptionFocus(words: CaptionWord[], presentation?: CaptionPresentation): CaptionWord[] {
  if (!presentation?.emphasis || !words.length) return words
  const selected = words.findIndex(word => word.highlight)
  const index = selected >= 0 ? selected : defaultEmphasisIndex(words.map(word => word.word))
  return words.map((word, i) => ({ ...word, highlight: i === index }))
}

export function captionPropertiesForPreset(caption: CaptionProperties, preset: string): CaptionProperties {
  const presentation = captionPresetPresentation(preset)
  return { ...caption, preset, style: captionPresetStyle(preset), presentation,
    activeWordColor: preset === 'Green Pill' ? '#102017' : '#FFE600',
    words: withCaptionFocus(caption.words ?? [], presentation) }
}
