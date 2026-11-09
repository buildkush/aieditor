import { describe, expect, it } from 'vitest'
import { romanHindi, romanText } from './romanHindi'

describe('Roman Hindi display', () => {
  it('uses spoken spellings instead of inserting an a after every consonant', () => {
    expect(romanHindi('मैं हूँ, तुमने मुझे नहीं देखा होगा।')).toBe('main hoon, tumne mujhe nahi dekha hoga.')
    expect(romanHindi('यह देखने में बहुत अच्छा लगता है और मुझे पानी चाहिए।')).toBe('yeh dekhne mein bahut achha lagta hai aur mujhe paani chahiye.')
  })
  it('drops internal inherent vowels without dropping explicit vowels', () => {
    expect(romanHindi('नमकीन सपना धड़कन नमक कमल')).toBe('namkeen sapnaa dhadkan namak kamal')
    expect(romanHindi('मीना सूरज किताब')).toBe('meenaa sooraj kitaab')
  })
  it('recognizes common English loan spellings and preserves literal English', () => {
    expect(romanHindi('गोल्डन कैन फीफा वर्ल्ड कप एडिशन video Editor!')).toBe('golden can FIFA world cup edition video Editor!')
    expect(romanHindi('हिंदी २०२६॥ English, punctuation!')).toBe('hindi 2026. English, punctuation!')
  })
  it('handles nukta normalization and invisible conjunct joiners', () => {
    expect(romanHindi('फ़ोन फोन')).toBe('phone phone')
    expect(romanHindi('शक्\u200dति')).toBe(romanHindi('शक्ति'))
  })
  it('keeps per-run edits separate and invalidates them after changing source text', () => {
    const sourceText = 'मुझे पानी चाहिए'
    const first = { sourceText, text: 'mujhe pani chahiye' }
    expect(romanText(sourceText, first)).toBe('mujhe pani chahiye')
    expect(romanText(sourceText)).toBe('mujhe paani chahiye')
    expect(romanText('मुझे नहीं चाहिए', first)).toBe('mujhe nahi chahiye')
    expect(romanText(sourceText, { sourceText, text: '' })).toBe('')
  })
})
