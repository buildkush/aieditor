import { describe, expect, it } from 'vitest'
// @ts-ignore -- Local React DOM types omit server.d.ts, as in the existing UI tests.
import { renderToStaticMarkup } from 'react-dom/server'
import SpeechLab, { ModelCard, resultLabel, ComparisonResults, OriginalOutput, RomanOutput, WordOutput } from './SpeechLab'
import type { TranscriptResult } from '../types'
import { DualExperimentPanel } from './DualExperimentPanel'
import { LanguageSpanPanel } from './LanguageSpanPanel'
import { segmentLanguageSpans } from '../services/languageSpans'

const small: TranscriptResult = {
  id: 'small-run', model: 'small', language: 'hi', languageProbability: .9,
  source: { path: 'source.mp4', name: 'source.mp4', audioPath: 'cache.wav', audioSha256: 'same', duration: 27, sampleRate: 16000 },
  segments: [{ id: 0, text: 'मुझे पानी चाहिए', startTime: 0, endTime: 2, words: [] }],
  processingMetadata: { processingSec: 3, inferenceSec: 2, audioPreparationSec: .1, modelLoadSec: .9, audioDurationSec: 27,
    realTimeFactor: 3 / 27, peakRamBytes: 100, cpuPercentMachine: 20, gpuPercentDevice: null, peakVramMiBDevice: null,
    device: 'cpu', computeType: 'int8', requestedDevice: 'auto', fallback: null, model: 'small', languageHint: 'hi',
    vad: true, vadSilenceMs: 500, wordTimestamps: true, coldWorker: true },
}
const turbo: TranscriptResult = { ...small, id: 'turbo-run', model: 'large-v3-turbo', segments: [{ ...small.segments[0], text: 'तुमने नहीं देखा' }] }
const shruti: TranscriptResult = { ...small, id: 'shruti-run', model: 'shruti', languageProbability: null, text: '  मेरा order\nकब आएगा?  ', segments: [],
  words: [{ text: 'order', startTime: .123, endTime: .789, confidence: .9 }, { text: 'कब', startTime: null, endTime: null }] }

describe('Speech Lab model comparison', () => {
  it('offers Shruti, Shunya INT8, Whistle and experimental Tara and retains native transcript-only output', () => {
    const setup = renderToStaticMarkup(<SpeechLab onClose={() => {}} />)
    expect(setup).not.toContain('Shunya - PyTorch FP32')
    for (const name of ['Srota', 'Whisper Small', 'Whisper Large', 'Tiny Hinglish']) expect(setup).not.toContain(name)
    expect(setup).not.toContain('Install runtime')
    const native: TranscriptResult = { ...shruti, id: 'srota', model: 'srota', text: 'native mixed script', words: [], processingMetadata: { ...shruti.processingMetadata, wordTimestamps: false } }
    const html = renderToStaticMarkup(<ComparisonResults results={[shruti, native]} reference="" roman={false} corrections={{}} romanEdits={{}} onRomanChange={() => {}} />)
    expect(html).toContain(native.text)
    expect(renderToStaticMarkup(<OriginalOutput result={native} />)).toContain('Native Srota output')
    expect(renderToStaticMarkup(<WordOutput result={native} onSeek={() => {}} />)).toContain('No word timestamps were returned')
  })

  it('shows span classifications and retention reasons without manufacturing a whole-file Whistle result', () => {
    const primary: TranscriptResult = { ...shruti, text: 'भाई Harry Potter को', words: ['भाई', 'Harry', 'Potter', 'को'].map((text, i) => ({ text, startTime: i, endTime: i + .8, confidence: .8 })) }
    const html = renderToStaticMarkup(<LanguageSpanPanel primary={primary} experiment={{ primaryId: primary.id, spans: segmentLanguageSpans(primary), recognition: null, vocabulary: [] }} busy={false} onSeek={() => {}} onExport={async () => {}} />)
    expect(html).toContain('Harry Potter')
    expect(html).toContain('hindi')
    expect(html).toContain('english')
    expect(html).toContain('Suggest English Corrections')
    expect(html).toContain('Export span experiment JSON')
  })
  it('exposes timed differences, separate hypothesis labels and experimental exports', () => {
    const primary = { ...shruti, text: 'keeche', words: [{ text: 'keeche', startTime: 1, endTime: 1.8 }] }
    const alternative: TranscriptResult = { ...primary, id: 'whistle', model: 'whistle', text: 'keychain', words: [{ text: 'keychain', startTime: 1, endTime: 1.8 }] }
    const html = renderToStaticMarkup(<DualExperimentPanel primary={primary} alternative={alternative} keywords={['Keychain']} onSeek={() => {}} onExport={async () => {}} />)
    expect(html).toContain('Word-level differences')
    expect(html).toContain('Whistle · English hypothesis')
    expect(html).toContain('Suggest English Corrections')
    expect(html).toContain('Export comparison JSON')
    expect(html).toContain('Export comparison SRT')
    expect(html).toContain('Export reviewed SRT')
  })
  it('offers highlighted model selection and one Run action and shows separate native words and metrics', () => {
    const setup = renderToStaticMarkup(<SpeechLab onClose={() => {}} />)
    expect(setup).toContain('Whistle (English)')
    expect(setup).toContain('Shunya - CTranslate2 INT8')
    expect(setup).toContain('aria-label="Models to run"')
    expect(setup).toContain('Cactus Needle 3.2.10')
    expect(setup).not.toContain('Shruti – Cactus Needle 3.2.10')
    expect(setup).not.toContain('Shruti – FP32')
    expect(setup).not.toContain('aria-label="First model"')
    expect(setup).not.toContain('aria-label="Second model"')
    expect(setup).not.toContain('Run all three CPU models sequentially')
    expect(setup).toContain('>Run</button>')
    expect(setup).not.toContain('Compare Tiny Hinglish + Shruti')
    expect(setup).not.toContain('Run both Whisper models')
    expect(setup).not.toContain('Both (Experimental)')
    const whistle: TranscriptResult = { ...shruti, id: 'whistle', model: 'whistle', text: 'Keychain', words: [{ text: 'Keychain', startTime: .123, endTime: .789 }] }
    const html = renderToStaticMarkup(<ComparisonResults results={[shruti, whistle]} reference="" roman={false} corrections={{}} romanEdits={{}} onRomanChange={() => {}} />)
    expect(html).toContain('Keychain')
    expect(html).toContain('0.123 – 0.789 s')
    expect(html.match(/Peak RAM/g)).toHaveLength(2)
    expect(renderToStaticMarkup(<OriginalOutput result={whistle} />)).toContain('Native Whistle output')
  })
  it('shows separate Roman Hindi text for both models when enabled', () => {
    const html = renderToStaticMarkup(<ComparisonResults results={[small, turbo]} reference="" roman corrections={{}} romanEdits={{}} onRomanChange={() => {}} />)
    expect(html).toContain('small Roman Hindi text')
    expect(html).toContain('large-v3-turbo Roman Hindi text')
    expect(html).toContain('mujhe paani chahiye')
    expect(html).toContain('tumne nahi dekha')
    expect(html.match(/<textarea/g)).toHaveLength(2)
  })
  it('applies each run’s segment corrections and Roman overrides independently', () => {
    const html = renderToStaticMarkup(<ComparisonResults results={[small, turbo]} reference="" roman
      corrections={{ [small.id]: { 0: 'मुझे नहीं चाहिए' } }}
      romanEdits={{ [turbo.id]: { sourceText: turbo.segments[0].text, text: 'tumne nahin dekha' } }} onRomanChange={() => {}} />)
    expect(html).toContain('mujhe nahi chahiye')
    expect(html).toContain('tumne nahin dekha')
    expect(small.segments[0].text).toBe('मुझे पानी चाहिए')
    expect(turbo.segments[0].startTime).toBe(0)
  })
  it('keeps both original outputs available when Roman Hindi is off', () => {
    const html = renderToStaticMarkup(<ComparisonResults results={[small, turbo]} reference="" roman={false} corrections={{}} romanEdits={{}} onRomanChange={() => {}} />)
    expect(html).toContain(small.segments[0].text)
    expect(html).toContain(turbo.segments[0].text)
    expect(html).not.toContain('<textarea')
  })
  it('keeps native Shruti output while optionally showing a separate editable Roman view', () => {
    const original = renderToStaticMarkup(<OriginalOutput result={shruti} />)
    expect(original).toContain(`<pre>${shruti.text}</pre>`)
    expect(original).toContain('Native Shruti output')
    expect(original).not.toContain('0.0%')
    const html = renderToStaticMarkup(<ComparisonResults results={[small, shruti]} reference="" roman corrections={{}} romanEdits={{ [shruti.id]: { sourceText: shruti.text!, text: 'mera order kab aayega?' } }} onRomanChange={() => {}} />)
    expect(html.match(/<textarea/g)).toHaveLength(2)
    expect(html).toContain('mera order kab aayega?')
    expect(html).toContain(shruti.text)
    const automatic = renderToStaticMarkup(<RomanOutput result={{ ...shruti, text: 'Coke का golden can नहीं देखा होगा।' }} corrections={{}} onChange={() => {}} />)
    expect(automatic).toContain('Coke ka golden can nahi dekha hoga.')
    expect(automatic).toContain('existing English words stay unchanged')
    const nativeOnly = renderToStaticMarkup(<ComparisonResults results={[shruti]} reference="" roman={false} corrections={{}} romanEdits={{}} onRomanChange={() => {}} />)
    expect(nativeOnly).toContain(shruti.text)
    expect(nativeOnly).not.toContain('<textarea')
  })
  it('shows returned word times and explicitly marks missing times without inventing them', () => {
    const html = renderToStaticMarkup(<WordOutput result={shruti} onSeek={() => {}} />)
    expect(html).toContain('0.123 – 0.789 s')
    expect(html).toContain('Time unavailable')
    expect(html).toContain('disabled=""')
    expect(html).not.toContain('0.000')
    expect(renderToStaticMarkup(<WordOutput result={{ ...shruti, words: [] }} onSeek={() => {}} />)).toContain('No word timestamps were returned')
  })
  it('keeps uncertain original intervals clickable and marks them for review', () => {
    const html=renderToStaticMarkup(<WordOutput result={{...shruti,words:[{text:'हैं',startTime:8,endTime:8.12,timingNeedsReview:true}]}} onSeek={() => {}} />)
    expect(html).toContain('8.000 – 8.120 s')
    expect(html).toContain('Needs review')
    expect(html).not.toContain('disabled=""')
  })
})


it('renders three CPU transcripts with honest timing labels and individual exports', () => {
 const runs: TranscriptResult[] = [shruti, { ...shruti, id: 'native', model: 'whistle', text: 'native complete returned text', words: [], processingMetadata: { ...shruti.processingMetadata, wordTimestamps: false } }, { ...shruti, id: 'int8', model: 'shunya-int8' }]
 const html = renderToStaticMarkup(<ComparisonResults results={runs} reference="" roman={false} corrections={{}} romanEdits={{}} onRomanChange={() => {}} onExport={() => {}} />)
 expect(html).toContain('Whistle (English)')
 expect(html).toContain('Shunya - CTranslate2 INT8')
 expect(html).toContain('No native word timestamps')
 expect(html.match(/Export TXT/g)).toHaveLength(3)
 expect(html.match(/Play audio/g)).toHaveLength(3)
 expect(html).toContain('native complete returned text')
})


it('selects through existing model cards without a duplicate picker', () => {
  const html = renderToStaticMarkup(<SpeechLab onClose={() => {}} />)
  expect(html).not.toContain('sl-model-selection')
  expect(html.match(/class="sl-model-choice"/g)).toHaveLength(4)
  expect(html.match(/>Shruti<\/label>/g)).toHaveLength(1)
  expect(html).toContain('1 / 3 selected')
  const card = renderToStaticMarkup(<ModelCard name="Shruti" selected disabled={false} onToggle={() => {}}><button>Install</button></ModelCard>)
  expect(card).toContain('sl-model selected')
  expect(card).toContain('checked=""')
  expect(card).toContain('>Install</button>')
})
it('displays all three Shruti native outputs, runtime versions, and missing FP32 times honestly', () => {
  const runs: TranscriptResult[] = [shruti, {...shruti, id:'new', model:'shruti-needle-3210', text:'new native', processingMetadata:{...shruti.processingMetadata, runtimeVersions:{cactusNeedle:'3.2.10'}}}, {...shruti, id:'fp', model:'shruti-fp32', text:'original fp32 text', words:[], processingMetadata:{...shruti.processingMetadata, wordTimestamps:false, runtimeVersions:{jax:'0.12.0.1'}}}]
  const html = renderToStaticMarkup(<ComparisonResults results={runs} reference="" roman={false} corrections={{}} romanEdits={{}} onRomanChange={() => {}} />)
  expect(html).toContain('new native'); expect(html).toContain('original fp32 text')
  expect(html).toContain('cactusNeedle 3.2.10'); expect(html).toContain('jax 0.12.0.1')
  expect(html).toContain('No native word timestamps')
  expect(html.match(/Play audio/g)).toHaveLength(3)
})


it.each(['tara', 'tara-int8'] as const)('shows %s original output and comparison without fabricated timestamps', (model) => {
  const tara: TranscriptResult = { ...shruti, id: 'tara-run', model, text: 'Harry Potter का key chain', words: [],
    processingMetadata: { ...shruti.processingMetadata, model: 'tara', wordTimestamps: false, wordTimestampsAvailable: false } }
  const setup = renderToStaticMarkup(<SpeechLab onClose={() => {}} />)
  expect(setup).not.toContain('Tara – Original (CPU FP32)'); expect(setup).not.toContain('Tara – INT8 Standard'); expect(setup).toContain('Tara – Speech-aware'); expect(setup).toContain('Tara – Speech-aware · Parallel')
  expect(setup).toContain('Default Tara configuration')
  expect(setup).toContain('1 / 3 selected')
  expect(renderToStaticMarkup(<OriginalOutput result={tara} />)).toContain('Native Tara output')
  const comparison = renderToStaticMarkup(<ComparisonResults results={[shruti, tara]} reference="" roman={false} corrections={{}} romanEdits={{}} onRomanChange={() => {}} onExport={() => {}} />)
  expect(comparison).toContain(tara.text)
  expect(comparison).toContain('No native word timestamps')
  expect(comparison.match(/Export TXT/g)).toHaveLength(2)
})


it('labels Tara aligned estimates honestly and retains missing word boundaries', () => {
  const result: TranscriptResult = { ...shruti, model:'tara-int8', text:'Harry Potter', words:[
    { text:'Harry',startTime:1.2,endTime:1.5 }, { text:' Potter',startTime:null,endTime:null }
  ], processingMetadata:{...shruti.processingMetadata,model:'tara-int8',wordTimingSource:'tara-attention-dtw',alignmentSec:2.5,wordTimestampsAvailable:true} }
  const html=renderToStaticMarkup(<ComparisonResults results={[result]} reference="" roman={false} corrections={{}} romanEdits={{}} onRomanChange={() => {}} />)
  expect(html).toContain('Audio-aligned word timing')
  expect(html).toContain('1.200 – 1.500 s')
  expect(html).toContain('Time unavailable')
  expect(html).toContain('Word alignment · included in inference')
  expect(html).not.toContain('Native word timestamps available')
})

it('distinguishes standard and speech-aware results of the same Tara model', () => {
  const standard={...shruti,model:'tara-int8' as const}
  const speech={...standard,processingMetadata:{...standard.processingMetadata,chunkingStrategy:'speech-aware-overlap-v1'}}
  expect(resultLabel(standard)).toContain('Standard')
  expect(resultLabel(speech)).toContain('Speech-aware')
})
