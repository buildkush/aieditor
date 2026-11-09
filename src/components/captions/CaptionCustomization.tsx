import type { CaptionPresentation, TextProperties } from '../../core/timeline/types'
import { formatHexColor } from '../inspector/TextStyleControls'

interface Props {
  style: Partial<TextProperties>
  presentation?: CaptionPresentation
  activeColor?: string
  appearance?: boolean
  onStyle: (patch: Partial<TextProperties>) => void
  onPresentation: (value: CaptionPresentation) => void
  onActiveColor: (color: string) => void
}

/** Reusable authoring controls; presets populate these same editable values. */
export function CaptionCustomization({style,presentation,activeColor='#FFE600',appearance=true,onStyle,onPresentation,onActiveColor}: Props) {
  const p=presentation ?? {timing:'active',underline:true}
  const change=(patch: Partial<CaptionPresentation>)=>onPresentation({...p,...patch})
  const emphasis=(patch: NonNullable<CaptionPresentation['emphasis']>)=>change({emphasis:{...p.emphasis,...patch}})
  const number=(label:string,value:number,min:number,max:number,step:number,update:(v:number)=>void)=><label>{label}<input aria-label={label} type="number" value={value} min={min} max={max} step={step} onChange={e=>{const n=Number(e.target.value);if(e.target.value && Number.isFinite(n)&&n>=min&&n<=max)update(n)}}/></label>
  const color=(label:string,value:string,update:(v:string)=>void)=><label>{label}<input aria-label={label} type="color" value={formatHexColor(value)} onChange={e=>update(e.target.value)}/></label>
  return <div className="caption-customization">
    <fieldset><legend>Behavior</legend><div className="caption-custom-grid">
      <label>Word appearance<select aria-label="Word appearance" value={p.reveal??'all'} onChange={e=>change({reveal:e.target.value as CaptionPresentation['reveal']})}><option value="all">All at once</option><option value="progressive">One word after another</option><option value="single">One word at a time</option></select></label>
      <label>Timed highlight<select aria-label="Timed highlight" value={p.timing} onChange={e=>change({timing:e.target.value as CaptionPresentation['timing']})}><option value="none">Off</option><option value="active">Current word</option><option value="progress">Spoken words</option></select></label>
      {p.timing!=='none' && <><label>Highlight style<select aria-label="Highlight style" value={p.highlightStyle??(p.underline?'underline':'color')} onChange={e=>change({highlightStyle:e.target.value as CaptionPresentation['highlightStyle'],underline:false})}><option value="color">Text color</option><option value="box">Background box</option><option value="underline">Underline</option></select></label>{color('Highlight text',activeColor,onActiveColor)}{p.timing==='progress'&&color('Upcoming words',p.futureWordColor??style.color??'#ffffff',v=>change({futureWordColor:v}))}{p.highlightStyle==='box'&&<>{color('Highlight background',p.highlightBackground??'#385b23',v=>change({highlightBackground:v}))}{number('Highlight radius',p.highlightRadius??4,0,100,1,v=>change({highlightRadius:v}))}</>}</>}
      <label>Fixed emphasis<input aria-label="Fixed emphasis" type="checkbox" checked={!!p.emphasis} onChange={e=>change({emphasis:e.target.checked?{color:'#FFE600',size:1.3}:undefined})}/></label>
    </div></fieldset>
    {p.emphasis&&<fieldset><legend>Emphasis font</legend><div className="caption-custom-grid">
      <label>Emphasis family<input aria-label="Emphasis family" value={p.emphasis.fontFamily??style.fontFamily??'Arial, sans-serif'} onChange={e=>emphasis({fontFamily:e.target.value})}/></label>
      {color('Emphasis color',p.emphasis.color??'#FFE600',v=>emphasis({color:v}))}
      {number('Emphasis size',p.emphasis.size??1,0.5,3,.05,v=>emphasis({size:v}))}
      {number('Emphasis width',p.emphasis.width??1,1,2,.05,v=>emphasis({width:v}))}
      {number('Emphasis spacing',p.emphasis.letterSpacing??0,0,.5,.01,v=>emphasis({letterSpacing:v}))}
      <label>Emphasis weight<select aria-label="Emphasis weight" value={p.emphasis.fontWeight??'700'} onChange={e=>emphasis({fontWeight:e.target.value})}>{['400','500','600','700','800','900'].map(w=><option key={w}>{w}</option>)}</select></label>
      <label>Emphasis italic<input type="checkbox" checked={p.emphasis.fontStyle==='italic'} onChange={e=>emphasis({fontStyle:e.target.checked?'italic':'normal'})}/></label>
      <label>Emphasis uppercase<input type="checkbox" checked={p.emphasis.textCase==='uppercase'} onChange={e=>emphasis({textCase:e.target.checked?'uppercase':'none'})}/></label>
    </div></fieldset>}
    {appearance&&<fieldset><legend>Appearance</legend><div className="caption-custom-grid">
      <label>Font family<input aria-label="Font family" value={style.fontFamily??'Inter, sans-serif'} onChange={e=>onStyle({fontFamily:e.target.value})}/></label>
      {number('Font size',style.fontSize??48,12,200,1,v=>onStyle({fontSize:v}))}
      <label>Font weight<select value={style.fontWeight??'600'} onChange={e=>onStyle({fontWeight:e.target.value})}>{['400','500','600','700','800','900'].map(w=><option key={w}>{w}</option>)}</select></label>
      <label>Italic<input type="checkbox" checked={style.fontStyle==='italic'} onChange={e=>onStyle({fontStyle:e.target.checked?'italic':'normal'})}/></label>
      <label>Underline<input type="checkbox" checked={!!style.underline} onChange={e=>onStyle({underline:e.target.checked})}/></label>
      <label>Text case<select value={style.textCase??'none'} onChange={e=>onStyle({textCase:e.target.value as TextProperties['textCase']})}>{['none','uppercase','lowercase','capitalize'].map(v=><option key={v}>{v}</option>)}</select></label>
      <label>Alignment<select value={style.align??'center'} onChange={e=>onStyle({align:e.target.value as TextProperties['align']})}>{['left','center','right'].map(v=><option key={v}>{v}</option>)}</select></label>
      {number('Letter spacing',style.letterSpacing??0,-5,30,.5,v=>onStyle({letterSpacing:v}))}
      {number('Line height',style.lineHeight??1.2,.8,2.5,.05,v=>onStyle({lineHeight:v}))}
      {color('Text color',style.color??'#ffffff',v=>onStyle({color:v}))}
      <label>Background<input type="checkbox" checked={!!style.backgroundEnabled} onChange={e=>onStyle({backgroundEnabled:e.target.checked})}/></label>
      {color('Background color',style.backgroundColor??'#000000',v=>onStyle({backgroundColor:v}))}
      {number('Background opacity',style.backgroundOpacity??.7,0,1,.05,v=>onStyle({backgroundOpacity:v}))}
      {number('Background radius',style.cornerRadius??6,0,100,1,v=>onStyle({cornerRadius:v}))}
      {number('Padding X',style.paddingX??style.padding??16,0,100,1,v=>onStyle({paddingX:v}))}
      {number('Padding Y',style.paddingY??style.padding??10,0,100,1,v=>onStyle({paddingY:v}))}
      {color('Border color',style.bgStrokeColor??'#ffffff',v=>onStyle({bgStrokeColor:v}))}
      {number('Border width',style.bgStrokeWidth??0,0,20,1,v=>onStyle({bgStrokeWidth:v}))}
      {number('Background offset X',style.bgOffsetX??0,-100,100,1,v=>onStyle({bgOffsetX:v}))}
      {number('Background offset Y',style.bgOffsetY??0,-100,100,1,v=>onStyle({bgOffsetY:v}))}
      {color('Outline color',style.strokeColor??'#000000',v=>onStyle({strokeColor:v}))}
      {number('Outline width',style.strokeWidth??0,0,15,.5,v=>onStyle({strokeWidth:v}))}
      <label>Shadow<input type="checkbox" checked={!!style.shadowEnabled} onChange={e=>onStyle({shadowEnabled:e.target.checked})}/></label>
      {color('Shadow color',style.shadowColor??'#000000',v=>onStyle({shadowColor:v}))}
      {number('Shadow blur',style.shadowBlur??5,0,60,1,v=>onStyle({shadowBlur:v}))}
      {number('Shadow opacity',style.shadowOpacity??.8,0,1,.05,v=>onStyle({shadowOpacity:v}))}
      {number('Shadow offset X',style.shadowOffsetX??0,-50,50,1,v=>onStyle({shadowOffsetX:v}))}
      {number('Shadow offset Y',style.shadowOffsetY??2,-50,50,1,v=>onStyle({shadowOffsetY:v}))}
    </div></fieldset>}
  </div>
}
