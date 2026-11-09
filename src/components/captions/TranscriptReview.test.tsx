import { describe, expect, it } from 'vitest'
// @ts-ignore -- Same server renderer setup as existing UI tests.
import { renderToStaticMarkup } from 'react-dom/server'
import { CaptionFormatSelect, TranscriptReview, WordsPerCaptionSelect } from './TranscriptReview'
import { AutoCaptionsDialog } from './AutoCaptionsDialog'
import { createEmptyProjectState } from '../../core/project/projectState'
import type { CaptionTranscript } from '../../core/captions/types'
import { CaptionWords } from './CaptionWords'

const draft: CaptionTranscript = { id: 'draft', nativeText: 'Coke का can है।', nativeWords: [{ text: 'Coke', startTime: 1.1, endTime: 1.4 }, { text: 'का', startTime: 1.4, endTime: 1.5 }, { text: 'can', startTime: 1.5, endTime: 1.7 }, { text: 'है।', startTime: 1.7, endTime: 1.9 }],
  language: 'hi', audioSha256: 'hash', audioPlan: { projectId: 'project', clips: [], duration: 2 }, outputFormat: 'hinglish', nativeEdits: {}, romanEdits: {} }

describe('Auto caption setup and transcript review', () => {
  it('offers Auto and all five manual pacing options with collapsed styling', () => {
    const select = renderToStaticMarkup(<WordsPerCaptionSelect value="auto" onChange={() => {}} />)
    expect(select).toContain('value="auto" selected')
    expect(select.match(/<option/g)).toHaveLength(6)
    const html = renderToStaticMarkup(<TranscriptReview transcript={draft} onChange={() => {}} onSeek={() => {}} />)
    expect(html).toContain('<details class="caption-style-section"><summary>Caption styling</summary>')
  })
  it('offers the two output formats separately from ASR model selection', () => {
    const html = renderToStaticMarkup(<CaptionFormatSelect value="hinglish" onChange={() => {}} />)
    expect(html).toContain('>Hinglish</option>')
    expect(html).toContain('>Hindi</option>')
    expect(html).toContain('value="hinglish" selected')
  })
  it('switches presentation while retaining every editable word and time', () => {
    const roman = renderToStaticMarkup(<TranscriptReview transcript={draft} onChange={() => {}} onSeek={() => {}} />)
    const native = renderToStaticMarkup(<TranscriptReview transcript={{ ...draft, outputFormat: 'hindi' }} onChange={() => {}} onSeek={() => {}} />)
    expect(roman).toContain('Coke ka can hai.</textarea>')
    expect(native).toContain('Coke का can है।</textarea>')
    expect(roman).toContain('1.100 → 1.900')
    expect(native).toContain('1.100 → 1.900')
    expect(roman.match(/<textarea/g)).toHaveLength(1)
    expect(roman).toContain('Word timing &amp; emphasis')
  })
  it('shows a compact setup and blocks generation when the project has no audible audio', () => {
    const html = renderToStaticMarkup(<AutoCaptionsDialog state={createEmptyProjectState()} onClose={() => {}} onImport={() => {}} />)
    expect(html).toContain('Generate Auto Captions')
    expect(html).toContain('Quick mode')
    expect(html).toContain('may be less accurate')
    expect(html).not.toMatch(/Shruti|Tara/)
    expect(html).not.toContain('Caption keywords')
    expect(html).not.toContain('Remember keywords')
    expect(html).not.toContain('checked=')
    expect(html).toContain('Add an unmuted audio clip')
    expect(html).not.toContain('Subtitle File')
    expect(html).toContain('disabled=""')
  })
  it('uses project playhead bounds for one active word and retains separate emphasis', () => {
    const words = [{ id: 'a', word: 'Coke', startTime: 1, endTime: 1.4, fontStyle: 'italic' as const, color: '#ff0000', backgroundColor: '#333333' }, { id: 'b', word: 'can', startTime: 1.4, endTime: 1.8 }]
    const html = renderToStaticMarkup(<CaptionWords words={words} playheadTime={1.4} />)
    expect(html.match(/data-active="true"/g)).toHaveLength(1)
    expect(html).toContain('font-style:italic')
    expect(html).toContain('background-color:#333333')
    expect(renderToStaticMarkup(<CaptionWords words={words} playheadTime={2} />)).not.toContain('data-active')
  })
})
