import type { CaptionPresentation, CaptionWord } from '../../core/timeline/types'
import { activeCaptionWord } from '../../core/captions/transcriptReview'

/** Fixed word emphasis and timed highlighting are independent rendering layers. */
export function CaptionWords({ words, playheadTime, scale = 1, activeColor = '#FFE600', presentation }: { words: CaptionWord[]; playheadTime: number; scale?: number; activeColor?: string; presentation?: CaptionPresentation }) {
  const active = presentation?.timing === 'none' ? -1 : activeCaptionWord(words, playheadTime)
  const speaking = activeCaptionWord(words, playheadTime)
  return words.map((word, index) => {
    const focus = word.highlight ? presentation?.emphasis : undefined
    const spoken = presentation?.timing === 'progress' ? playheadTime >= word.startTime : index === active
    const timedColor = spoken ? activeColor : presentation?.timing === 'progress' ? presentation.futureWordColor : undefined
    const visible = presentation?.reveal === 'single' ? index === speaking : presentation?.reveal === 'progressive' ? playheadTime >= word.startTime : true
    const width = focus?.width ?? 1
    const highlight = spoken && presentation?.highlightStyle === 'box'
    return <span key={word.id ?? index} data-active={index === active || undefined} data-emphasis={focus ? true : undefined}
    className={`caption-word ${index === active ? 'active' : ''} ${word.highlight ? 'highlight' : ''}`}
    aria-hidden={!visible || undefined}
    style={{ display: 'inline-block', whiteSpace: 'nowrap', wordBreak: 'normal', overflowWrap: 'normal', hyphens: 'none', visibility: visible ? undefined : 'hidden', margin: `0 ${3 * scale}px`, paddingInline: width > 1 ? `${(width-1)*Array.from(word.word).length*.32}em` : undefined, color: timedColor ?? word.color ?? focus?.color,
      fontSize: word.fontSize ? word.fontSize * scale : focus?.size ? `${focus.size}em` : undefined,
      fontFamily: word.fontFamily ?? focus?.fontFamily, fontWeight: word.fontWeight ?? focus?.fontWeight, fontStyle: word.fontStyle ?? focus?.fontStyle,
      textTransform: focus?.textCase === 'uppercase' ? 'uppercase' : undefined,
      letterSpacing: focus?.letterSpacing ? `${focus.letterSpacing}em` : undefined,
      borderRadius: highlight ? (presentation.highlightRadius ?? 4)*scale : undefined,
      backgroundColor: highlight ? presentation.highlightBackground ?? '#385b23' : word.backgroundColor, boxShadow: spoken && (presentation?.highlightStyle === 'underline' || (presentation?.underline ?? !presentation)) ? `inset 0 -${2 * scale}px ${activeColor}` : undefined,
      transform: word.scale ? `scale(${word.scale})` : undefined }}>{width !== 1 ? <span style={{display:'inline-block',transform:`scaleX(${width})`}}>{word.word}</span> : word.word}</span>
  })
}
