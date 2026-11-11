import { expect, it } from 'vitest'
// @ts-ignore -- Project's React DOM types omit the server entry point.
import { renderToStaticMarkup } from 'react-dom/server'
import SpeechLab, { ComparisonResults } from './SpeechLab'
import { fixture } from '../services/nativeFixture'
it('offers only native Shruti and Tara with actual supported controls', () => {
 const html = renderToStaticMarkup(<SpeechLab onClose={() => {}} />)
 for (const label of ['Shruti Native', 'Tara Native · Automatic', 'Tara Native · Q5_0', 'vulkan', 'Browse files…', 'sl-layout', 'sl-workspace', 'Clear results', 'Optional reference transcript']) expect(html).toContain(label)
 for (const retired of ['Whistle', 'Shunya', 'Srota', 'CTranslate2', 'Python', 'Speech-aware', 'VAD silence', 'Keywords']) expect(html).not.toContain(retired)
 expect(html.match(/class="sl-model-choice"/g)).toHaveLength(3)
})
it('labels overlapping CT2 worker timings as sums and renders available alignment metrics', () => {
 const result = { ...fixture, processingMetadata: { ...fixture.processingMetadata, computeType: 'int8_float32', inferenceEngine: 'ctranslate2', nativeProfile: {
  encoderSec: 20, generationDecoderSec: 30, alignmentSec: 4, threads: 4, decodeRetries: 0,
  timingBasis: 'sum-of-chunk-wall-times; stages overlap across workers', schedule: { workers: 2, threadsPerWorker: 2, memoryLimited: false },
 } } }
 const html = renderToStaticMarkup(<ComparisonResults results={[result]} reference="" roman={false} romanEdits={{}} onRomanChange={() => {}} onSeek={() => {}} onExport={() => {}} />)
 expect(html).toContain('CT2 INT8')
 expect(html).toContain('sum across workers')
 expect(html).toContain('2 workers × 2 threads')
 expect(html).toContain('4.00 s')
 expect(html).not.toContain('NaN')
})
