import { expect, it } from 'vitest'
import { benchmarkCsv, transcriptJson, transcriptText, transcriptWords, wordErrorRate } from './evaluation'
import { fixture } from './nativeFixture'

it('computes WER without changing scripts or capping errors', () => {
 expect(wordErrorRate('Hello world!', 'hello WORLD')?.rate).toBe(0)
 expect(wordErrorRate('a b c', 'a x c d')).toMatchObject({ substitutions: 1, insertions: 1 })
 expect(wordErrorRate('a', 'b c d')?.rate).toBe(3)
 expect(wordErrorRate('नमस्ते', 'namaste')?.rate).toBe(1)
 expect(wordErrorRate('', 'hello')).toBeNull()
})
it('preserves native text and timing in exports and keeps roman edits separate', () => {
 const output = JSON.parse(transcriptJson(fixture, {}, 'Hello, namaste'))
 expect(output.original.words).toEqual(fixture.words)
 expect(output.original.text).toBe(fixture.text)
 expect(output.romanHindiExperiment).toBe('Hello, namaste')
 expect(transcriptText(fixture)).toBe(fixture.text)
 expect(transcriptWords(fixture)).toEqual(fixture.words)
 const csv = benchmarkCsv([fixture], 'Hello नमस्ते')
 expect(csv).toContain('"same"'); expect(csv).toContain('"Hello, नमस्ते"'); expect(csv).not.toContain('[object Object]')
})
