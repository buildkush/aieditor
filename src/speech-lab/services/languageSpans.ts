import type { AudioSource, ProcessingMetadata, TranscriptResult, TranscriptWord } from '../types'
import type { EnglishSuggestion } from './englishCorrections'

export type SpanLanguage = 'hindi' | 'english' | 'uncertain' | 'mixed'
export interface LanguageSpan { id: string; language: SpanLanguage; text: string; canonical: string; sourceIndices: number[]; startTime: number | null; endTime: number | null; confidence: number | null; reason: string }
export interface SpanHypothesis { spanId: string; cropStart: number; cropEnd: number; text: string; words: TranscriptWord[]; rawResponse: Record<string, unknown>; inferenceSec: number; error?: string }
export interface SpanRecognition { id: string; source: AudioSource; hypotheses: SpanHypothesis[]; processingMetadata: ProcessingMetadata; contextSec: number }
export interface SpanExperiment { primaryId: string; spans: LanguageSpan[]; recognition: SpanRecognition | null; vocabulary: string[] }
const normalize = (text: string) => text.normalize('NFC').toLowerCase().replace(/[\p{P}\p{S}]/gu, '').trim().replace(/\s+/g, ' ')
const hindi = new Set('bhai ko ka ki ke pachees saal ho gaye hai hain hoon main mein nahi aur tum tumne mujhe hum aap yeh woh ye vo kya kyun bhi toh to se par ne ek do teen mera meri mere is us ab kab kabhi bahut dekha hoga deta raha rahi liye lekin phir achha tha thi the kar karta karna gaya gayi nahi mujhe apna apne jo sab tak tumhara hamara aaj kal'.split(' '))
const protectedHindiScript = new Set('भाई को का की के पच्चीस साल हो गए है हैं हूँ मैं में नहीं और तुम तुमने मुझे हम आप यह वह क्या क्यों भी तो से पर ने एक दो मेरा मेरी मेरे इस उस अब कब कभी बहुत देखा होगा देता रहा रही लिए लेकिन फिर था थी थे कर करना गया गई अपना अपने जो सब तक आज कल'.split(' '))
const english = new Set('harry potter champions champion edition kinder joy batman batwheels gems keychain younger blinkit lego coke golden can wand pen product collection exclusive football world cup winner winners history guarantee new old special original available video audio phone brand name series toy toys chocolate buy bought online limited marvel disney hot wheels surprise super hero'.split(' '))
export const globalEnglishPhrases = ['Harry Potter', 'Champions Edition', 'Kinder Joy', 'Hot Wheels', 'M&M\'s', 'Batwheels', 'Keychain', 'Blinkit', 'LEGO']
const aliases: Record<string, string> = { 'हैरी पॉटर': 'Harry Potter', 'हैरी पोटर': 'Harry Potter', 'किंडर जॉय': 'Kinder Joy', 'चैंपियंस एडिशन': 'Champions Edition', 'हैरी': 'Harry', 'पॉटर': 'Potter', 'किंडर': 'Kinder', 'जॉय': 'Joy', 'बैटमैन': 'Batman', 'बैटव्हील्स': 'Batwheels', 'ब्लिंकिट': 'Blinkit', 'लेगो': 'LEGO', 'कीचेन': 'keychain', 'गोल्डन': 'golden', 'कैन': 'can', 'कोक': 'Coke', 'वांड': 'wand', 'पेन': 'pen', 'एडिशन': 'edition', 'चैंपियंस': 'champions', 'चॉकलेट': 'chocolate' }

/** Explicit aliases use "English phrase | Devanagari phrase", one entry per line. */
export function segmentLanguageSpans(primary: TranscriptResult, vocabulary: string[] = []): LanguageSpan[] {
  const words = primary.words ?? []
  const entries = [...Object.entries(aliases).map(([alias, canonical]) => ({ alias, canonical })), ...[...globalEnglishPhrases, ...vocabulary].filter(Boolean).flatMap(entry => {
    const [canonical, ...forms] = entry.split('|').map(value => value.trim()).filter(Boolean)
    if (!canonical || !/[a-z]/i.test(canonical) || /[\u0900-\u097f]/u.test(canonical)) return []
    return [canonical, ...forms].map(alias => ({ alias, canonical }))
  })].sort((a, b) => b.alias.split(/\s+/).length - a.alias.split(/\s+/).length)
  const tags: { language: SpanLanguage; canonical: string; reason: string }[] = []
  for (let i = 0; i < words.length;) {
    const entry = entries.find(entry => {
      const size = entry.alias.split(/\s+/).length
      const selected = words.slice(i, i + size), text = selected.map(w => w.text).join(' ')
      if (selected.some(word => hindi.has(normalize(word.text)) || protectedHindiScript.has(normalize(word.text)))) return false
      const closeName = size > 1 && selected.every(w => /^[a-z '\-.,!?]+$/iu.test(w.text) && !hindi.has(normalize(w.text))) && similarity(letters(text), letters(entry.alias)) >= .85
      return i + size <= words.length && (normalize(text) === normalize(entry.alias) || closeName) && selected.slice(0, -1).every((w, offset) => w.endTime == null || selected[offset + 1].startTime == null || selected[offset + 1].startTime! - w.endTime < .5)
    })
    if (entry) {
      const size = entry.alias.split(/\s+/).length
      for (let k = 0; k < size; k++) tags.push({ language: 'english', canonical: k === 0 ? entry.canonical : '', reason: 'Explicit English term / proper-name alias' })
      i += size; continue
    }
    const text = normalize(words[i].text), deva = /[\u0900-\u097f]/u.test(text), latin = /[a-z]/i.test(text)
    if (deva && latin) tags.push({ language: 'mixed', canonical: words[i].text, reason: 'Scripts mixed within a word' })
    else if (protectedHindiScript.has(text) || hindi.has(text)) tags.push({ language: 'hindi', canonical: words[i].text, reason: deva ? 'Common Hindi word in Devanagari' : 'Common Roman Hindi word' })
    else if (english.has(text)) tags.push({ language: 'english', canonical: words[i].text, reason: 'English vocabulary' })
    else tags.push({ language: 'uncertain', canonical: words[i].text, reason: deva ? 'Unknown Devanagari term may be Hindi or phonetic English; retained unchanged' : 'Unknown or ambiguous language; retained unchanged' })
    i++
  }
  const groups: number[][] = []
  for (let i = 0; i < words.length; i++) {
    const previous = i > 0 ? words[i - 1] : undefined
    const pause = previous && words[i].startTime != null && previous.endTime != null && words[i].startTime! - previous.endTime >= .5
    if (!groups.length || pause || tags[i].language !== tags[i - 1].language) groups.push([i]); else groups.at(-1)!.push(i)
  }
  return groups.map(indices => {
    const selected = indices.map(i => words[i])
    const valid = selected.every((word, i) => word.startTime != null && word.endTime != null && Number.isFinite(word.startTime) && Number.isFinite(word.endTime) && word.startTime >= 0 && word.endTime >= word.startTime && word.endTime <= primary.source.duration && (i === 0 || word.startTime >= selected[i - 1].startTime!))
    const probabilities = selected.map(w => w.confidence).filter((p): p is number => typeof p === 'number' && Number.isFinite(p))
    return { id: `${primary.id}-span-${indices[0]}`, language: tags[indices[0]].language, text: selected.map(w => w.text).join(' '), canonical: indices.map(i => tags[i].canonical).filter(Boolean).join(' '), sourceIndices: indices,
      startTime: valid ? selected[0].startTime! : null, endTime: valid ? Math.max(...selected.map(w => w.endTime!)) : null,
      confidence: probabilities.length === selected.length ? probabilities.reduce((a, b) => a + b, 0) / probabilities.length : null, reason: [...new Set(indices.map(i => tags[i].reason))].join('; ') }
  })
}
const letters = (text: string) => normalize(text).replace(/\s+/g, '')
function similarity(a: string, b: string) {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) { const next = [i]; for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); row = next }
  return 1 - row[b.length] / Math.max(1, a.length, b.length)
}
export interface PhraseDecision { spanId: string; status: 'retained' | 'agreement' | 'suggestion' | 'uncertain'; alternative: string; reason: string; suggestion?: EnglishSuggestion }
export function reconcileLanguageSpans(primary: TranscriptResult, experiment: SpanExperiment): PhraseDecision[] {
  if (experiment.primaryId !== primary.id || experiment.recognition && experiment.recognition.source.audioSha256 !== primary.source.audioSha256) throw new Error('Span experiment belongs to different audio or recognition.')
  return experiment.spans.map(span => {
    const base = { spanId: span.id, alternative: '' }
    if (span.language !== 'english') return { ...base, status: 'retained', reason: 'Hindi, mixed or uncertain language stays with Shruti.' }
    const hypothesis = experiment.recognition?.hypotheses.find(h => h.spanId === span.id)
    if (!hypothesis || hypothesis.error || span.startTime == null || span.endTime == null) return { ...base, status: 'uncertain', reason: hypothesis?.error ?? 'No reliable timed English hypothesis.' }
    if (hypothesis.words.some(w => w.startTime == null || w.endTime == null || !Number.isFinite(w.startTime) || !Number.isFinite(w.endTime)) || normalize(hypothesis.text) !== normalize(hypothesis.words.map(w => w.text).join(' '))) return { ...base, status: 'uncertain', reason: 'Crop text contains words without reliable alignment.' }
    const position = experiment.spans.indexOf(span)
    // Small ASR boundary differences are allowed only in the silence between
    // spans. Never extend ownership into a neighbouring Hindi/uncertain span.
    const before = position > 0 ? experiment.spans[position - 1] : undefined
    const after = experiment.spans[position + 1]
    const lower = before ? Math.max(span.startTime - .1, before.endTime ?? span.startTime) : span.startTime
    const upper = after ? Math.min(span.endTime + .1, after.startTime ?? span.endTime) : span.endTime
    const inside = hypothesis.words.filter(w => w.startTime! >= lower - 1e-6 && w.endTime! <= upper + 1e-6 && (w.startTime! + w.endTime!) / 2 >= span.startTime! && (w.startTime! + w.endTime!) / 2 <= span.endTime!)
    if (!inside.length || inside.some((w, i) => w.endTime! <= w.startTime! || i > 0 && w.startTime! < inside[i - 1].startTime!)) return { ...base, status: 'uncertain', reason: 'Missing, point-only or ambiguous phrase timing.' }
    const text = inside.map(w => w.text).join(' ')
    const boundaryLeak = hypothesis.words.some(w => w.startTime != null && w.endTime != null && w.startTime < span.endTime! && w.endTime > span.startTime! && (w.startTime < lower - 1e-6 || w.endTime > upper + 1e-6))
    const coverage = (Math.min(span.endTime, inside.at(-1)!.endTime!) - Math.max(span.startTime, inside[0].startTime!)) / (span.endTime - span.startTime)
    if (boundaryLeak || coverage < .65 || /[\u0900-\u097f]/u.test(text)) return { ...base, alternative: text, status: 'uncertain', reason: 'Alternative crosses a language boundary or has weak timing coverage.' }
    if (normalize(text) === normalize(span.text) || /[\u0900-\u097f]/u.test(span.text) && normalize(text) === normalize(span.canonical)) return { ...base, alternative: text, status: 'agreement', reason: 'Phrase agreement; original Shruti script and wording retained.' }
    const phonetic = (text: string) => letters(text).replace(/ph/g, 'f').replace(/ck/g, 'k').replace(/ch/g, 'c').replace(/[aeiouy]/g, '')
    const likeness = Math.max(similarity(letters(text), letters(span.canonical)), similarity(phonetic(text), phonetic(span.canonical)))
    const confidence = inside.every(w => w.confidence != null) ? inside.reduce((sum, w) => sum + w.confidence!, 0) / inside.length : null
    const keyword = [...globalEnglishPhrases, ...experiment.vocabulary].map(entry => normalize(entry.split('|')[0])).includes(normalize(text))
    const stronger = confidence != null && confidence >= .7 && span.confidence != null && confidence >= span.confidence + .1
    if (likeness < .65 || !(stronger || keyword && likeness >= .75 && (confidence == null || confidence >= .65) && (span.confidence == null || confidence == null || confidence >= span.confidence - .05))) return { ...base, alternative: text, status: 'uncertain', reason: 'No clearly stronger complete English phrase; Shruti retained.' }
    return { ...base, alternative: text, status: 'suggestion', reason: keyword ? 'Vocabulary-supported phrase with matching timing and pronunciation.' : 'Higher recognition confidence with matching phrase timing and pronunciation.', suggestion: { original: span.text, proposed: text, sourceIndices: [...span.sourceIndices], alternativeIndices: inside.map(w => hypothesis.words.indexOf(w)), startTime: span.startTime, endTime: span.endTime } }
  })
}
