import {it,expect} from 'vitest'
// @ts-ignore -- Existing SSR test setup.
import {renderToStaticMarkup} from 'react-dom/server'
import {CaptionWords} from './CaptionWords'
import {CaptionCustomization} from './CaptionCustomization'
import {initializeCaptionReview,editCaptionReview,captionPreviewItems} from '../../core/captions/reviewEditing'
import {isCaptionTranscript,type CaptionTranscript} from '../../core/captions/types'

const words=[{word:'in',startTime:1,endTime:1.4},{word:'2026',startTime:2,endTime:2.6,highlight:true}]
it('reveals words progressively, supports single-word display, and keeps 2026 unbroken',()=>{
 const draw=(time:number,reveal:'all'|'single'|'progressive')=>renderToStaticMarkup(<CaptionWords words={words} playheadTime={time} presentation={{timing:'none',reveal}}/> )
 expect(draw(0,'progressive').match(/visibility:hidden/g)).toHaveLength(2)
 expect(draw(1.2,'progressive').match(/visibility:hidden/g)).toHaveLength(1)
 expect(draw(2.2,'progressive')).not.toContain('visibility:hidden')
 expect(draw(1.7,'single').match(/visibility:hidden/g)).toHaveLength(2)
 expect(draw(2.2,'single').match(/visibility:hidden/g)).toHaveLength(1)
 expect(draw(0,'all')).not.toContain('visibility:hidden')
 expect(draw(2.2,'progressive')).toContain('white-space:nowrap')
 expect(draw(2.2,'progressive')).toContain('>2026</span>')
})
it('offers editable behavior, fonts, emphasis and background controls',()=>{
 const html=renderToStaticMarkup(<CaptionCustomization style={{}} presentation={{timing:'active',reveal:'progressive',highlightStyle:'box',emphasis:{size:1.5,width:1.28}}} onStyle={()=>{}} onPresentation={()=>{}} onActiveColor={()=>{}} />)
 for(const label of ['Word appearance','Timed highlight','Highlight style','Emphasis width','Emphasis family','Font family','Background radius','Background color','Border width','Padding X'])expect(html).toContain(label)
})
it('renders editable current-word boxes independently of fixed emphasis',()=>{
 const html=renderToStaticMarkup(<CaptionWords words={words} playheadTime={2.1} activeColor="#ffffff" presentation={{timing:'active',highlightStyle:'box',highlightBackground:'#123456',highlightRadius:9,emphasis:{width:1.3,size:1.5}}} />)
 expect(html).toContain('scaleX(1.3)');expect(html).toContain('background-color:#123456');expect(html).toContain('border-radius:9px')
})
it('keeps custom behavior in review and imported caption properties without altering word times',()=>{
 const source:CaptionTranscript={id:'custom',nativeText:'in 2026',nativeWords:words.map(w=>({text:w.word,startTime:w.startTime,endTime:w.endTime})),language:'en',audioSha256:'hash',audioPlan:{projectId:'p',duration:3,clips:[]},outputFormat:'hindi',nativeEdits:{},romanEdits:{}}
 const draft=editCaptionReview(initializeCaptionReview(source),{type:'style',style:{backgroundEnabled:true,backgroundColor:'#123456',cornerRadius:22},presentation:{timing:'active',reveal:'single',highlightStyle:'box',highlightRadius:8,emphasis:{fontFamily:'Arial',size:1.4,width:1.3,letterSpacing:.05}}})
 expect(isCaptionTranscript(draft)).toBe(true)
 const item=captionPreviewItems(draft)[0]
 expect(item.caption!.presentation).toEqual(draft.review!.presentation)
 expect(item.caption!.style!.cornerRadius).toBe(22)
 expect(item.caption!.words!.filter(w=>w.highlight)).toHaveLength(1)
 expect(draft.nativeWords).toEqual(source.nativeWords)
 expect(isCaptionTranscript({...draft,review:{...draft.review!,presentation:{timing:'none',reveal:'invalid'}}})).toBe(false)
 const blank=editCaptionReview(draft,{type:'preset',preset:'Custom'})
 expect(blank.review!.presentation?.timing).toBe('none')
 expect(blank.review!.presentation?.emphasis).toBeUndefined()
 expect(blank.review!.style.backgroundEnabled).toBe(false)
 expect(blank.nativeWords).toEqual(source.nativeWords)
})
