import { CAPTION_STYLE_GROUPS, captionPresetPresentation, captionPresetStyle } from '../../core/captions/captionStyles'
import { CaptionWords } from './CaptionWords'
import './CaptionStylePicker.css'

/** Shared by transcript review and the timeline inspector. */
export function CaptionStylePicker({ value, onChange }: { value: string; onChange: (preset: string) => void }) {
  return <div className="caption-style-picker">{CAPTION_STYLE_GROUPS.map(group => <section key={group.name} aria-label={`${group.name} caption styles`}>
    <h4>{group.name}</h4>
    <div className="caption-style-grid">{group.presets.map(name => {
      const style = captionPresetStyle(name), presentation = captionPresetPresentation(name)
      return <button type="button" key={name} className={`caption-style-tile ${value === name ? 'selected' : ''}`} aria-pressed={value === name} onClick={() => onChange(name)}>
        <span aria-hidden="true" className="caption-style-sample" style={{ fontFamily: style.fontFamily, fontWeight: style.fontWeight, fontStyle: style.fontStyle,
          color: style.color, backgroundColor: style.backgroundEnabled ? style.backgroundColor : undefined,
          borderRadius: style.cornerRadius ? 8 : 0, textShadow: style.shadowEnabled ? '0 1px 2px #000' : undefined }}>
          <CaptionWords words={[{ word: 'your', startTime: 0, endTime: 1 }, { word: 'story', startTime: 1, endTime: 2, highlight: true }]}
            playheadTime={.5} scale={.4} presentation={{...presentation,reveal:'all'}} activeColor="#102017" />
        </span>
        <span className="caption-style-name">{name}</span>
      </button>
    })}</div>
  </section>)}<button type="button" className="caption-custom-start" aria-pressed={value==='Custom'} onClick={()=>onChange('Custom')}>Start from scratch</button></div>
}
