import { describe, expect, it } from 'vitest'
// @ts-ignore -- Server rendering follows the existing caption UI tests.
import { renderToStaticMarkup } from 'react-dom/server'
import { CaptionWords } from '../../components/captions/CaptionWords'
import { CaptionStylePicker } from '../../components/captions/CaptionStylePicker'
import { captionPresetPresentation, captionPresetStyle, withCaptionFocus } from './captionStyles'
import { editCaptionReview, initializeCaptionReview, captionPreviewItems, regroupCaptionReview } from './reviewEditing'
import { isCaptionTranscript, type CaptionTranscript } from './types'
import { createEmptyProjectState } from '../project/projectState'
import { ApplyCaptionPresetCommand, ImportSubtitlesCommand, UpdateCaptionCommand } from '../commands/editorCommand'
import { CommandHistory } from '../commands/commandHistory'
import { deserializeProject, serializeProject } from '../persistence/projectSerializer'

const words = [{ word: 'your', startTime: 1, endTime: 1.5 }, { word: 'story', startTime: 2, endTime: 2.5, highlight: true }]
function draw(preset: string, time: number) {
  return renderToStaticMarkup(<CaptionWords words={words} playheadTime={time} presentation={captionPresetPresentation(preset)} activeColor="#102017" />)
}
const source: CaptionTranscript = { id:'styles', nativeText:'your story is amazing', nativeWords: [
  { text:'your', startTime:1, endTime:1.5 }, { text:'story', startTime:1.5, endTime:2 },
  { text:'is', startTime:2, endTime:2.3 }, { text:'amazing', startTime:2.3, endTime:3 },
], language:'en', audioSha256:'hash', audioPlan:{projectId:'project',clips:[],duration:4}, outputFormat:'hinglish', nativeEdits:{},romanEdits:{},pacing:{wordsPerCaption:2,aspectRatio:9/16} }

describe('Caption style presentation', () => {
  it.each(['Script Focus','Yellow Focus'])('%s emphasis remains fixed when another word is spoken', preset => {
    const first=draw(preset,1.2), second=draw(preset,2.2)
    expect(first).toContain('visibility:hidden')
    expect(second).not.toContain('visibility:hidden')
    expect(first.match(/data-emphasis="true"/g)).toHaveLength(1)
    expect(first).not.toContain('data-active')
    expect(first).toContain('>story</span>')
  })
  it('green pill advances the text colour using word timestamps, retaining spoken words across pauses', () => {
    const before=draw('Green Pill',0), first=draw('Green Pill',1.2), gap=draw('Green Pill',1.8), last=draw('Green Pill',2.2)
    expect(before.match(/color:#2B773D/g)).toHaveLength(2)
    expect(first.match(/color:#102017/g)).toHaveLength(1)
    expect(gap.match(/color:#102017/g)).toHaveLength(1)
    expect(last.match(/color:#102017/g)).toHaveLength(2)
    expect(last).not.toContain('data-emphasis');expect(last).not.toContain('box-shadow')
  })
  it('classic styles have no automatic speaking highlight and legacy captions retain their old behaviour', () => {
    expect(draw('Clean',1.2)).toBe(draw('Clean',2.2))
    expect(draw('Clean',1.2)).not.toContain('data-active')
    const legacy=renderToStaticMarkup(<CaptionWords words={words} playheadTime={1.2} />)
    expect(legacy).toContain('data-active="true"');expect(legacy).toContain('#FFE600')
  })
  it('selects one content word and preserves explicit emphasis and original word times', () => {
    const original=[{word:'the',startTime:1,endTime:1.2},{word:'keychain',startTime:1.2,endTime:1.6},{word:'is',startTime:1.6,endTime:2}]
    const presentation=captionPresetPresentation('Yellow Focus')
    const focused=withCaptionFocus(original,presentation)
    expect(focused.map(w=>w.highlight)).toEqual([false,true,false])
    expect(withCaptionFocus(focused.map((w,i)=>({...w,highlight:i===2})),presentation).map(w=>w.highlight)).toEqual([false,false,true])
    expect(original.every(w=>!('highlight' in w))).toBe(true)
    expect(focused.map(w=>[w.startTime,w.endTime])).toEqual(original.map(w=>[w.startTime,w.endTime]))
  })
  it('groups the shared picker into Classic and Dynamic and resets incompatible style features', () => {
    const html=renderToStaticMarkup(<CaptionStylePicker value="Green Pill" onChange={()=>{}} />)
    expect(html).toContain('Classic caption styles');expect(html).toContain('Dynamic caption styles')
    expect(html).toContain('Script Focus');expect(html).toContain('Yellow Focus');expect(html).toContain('Green Pill')
    expect(captionPresetStyle('Green Pill').backgroundEnabled).toBe(true)
    expect(captionPresetStyle('Script Focus').backgroundEnabled).toBe(false)
    expect(captionPresetStyle('Script Focus').shadowEnabled).toBe(true)
  })
  it('keeps emphasis editable in review across script switches, regrouping and undoable draft changes', () => {
    const initial=initializeCaptionReview(source)
    const focused=editCaptionReview(initial,{type:'preset',preset:'Yellow Focus'})
    expect(focused.review!.segments.every(s=>s.words.filter(w=>w.highlight).length===1)).toBe(true)
    const segment=focused.review!.segments[0], target=segment.words[0]
    const changed=editCaptionReview(focused,{type:'focus-word',id:segment.id,wordId:target.id})
    expect(changed.review!.segments[0].words.filter(w=>w.highlight).map(w=>w.id)).toEqual([target.id])
    expect(changed.nativeWords).toEqual(source.nativeWords);expect(source.review).toBeUndefined()
    const regrouped=regroupCaptionReview({...changed,outputFormat:'hindi'},{wordsPerCaption:1,aspectRatio:9/16})
    expect(regrouped.review!.segments.every(s=>s.words.filter(w=>w.highlight).length===1)).toBe(true)
    expect(captionPreviewItems(regrouped).every(item=>item.caption!.words!.filter(w=>w.highlight).length===1)).toBe(true)
    expect(isCaptionTranscript(regrouped)).toBe(true)
    expect(isCaptionTranscript({...regrouped,review:{...regrouped.review!,presentation:{timing:'nonsense'}}})).toBe(false)
  })
  it('uses the Editor Command layer for timeline styles and retains presentation on save/reopen and undo/redo', () => {
    const project=new ImportSubtitlesCommand('1\n00:00:01,000 --> 00:00:02,500\nyour story\n').execute(createEmptyProjectState())
    const item=Object.values(project.items).find(item=>item.caption)!
    const history=new CommandHistory(project)
    const applied=history.execute(new ApplyCaptionPresetCommand(item.id,'Script Focus'))
    expect(applied.items[item.id].caption!.presentation?.emphasis).toBeDefined()
    const oldWords=applied.items[item.id].caption!.words!
    expect(oldWords.filter(w=>w.highlight)).toHaveLength(1)
    const selected=history.execute(new UpdateCaptionCommand(item.id,{words:oldWords.map((w,i)=>({...w,highlight:i===0}))}))
    const loaded=deserializeProject(serializeProject(selected)).state
    expect(loaded.items[item.id].caption).toEqual(selected.items[item.id].caption)
    expect(selected.items[item.id].caption!.words!.map(w=>[w.startTime,w.endTime])).toEqual(item.caption!.words!.map(w=>[w.startTime,w.endTime]))
    expect(history.undo()).toEqual(applied);expect(history.redo()).toEqual(selected)
    expect(project.items[item.id].caption!.presentation).toBeUndefined()
  })
})
