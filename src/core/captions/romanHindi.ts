/** Shared local Roman Hindi conversion; never changes recognition, timing or WER. */
const consonants: Record<string, string> = { 'क':'k', 'ख':'kh', 'ग':'g', 'घ':'gh', 'ङ':'ng', 'च':'ch', 'छ':'chh', 'ज':'j', 'झ':'jh', 'ञ':'ny', 'ट':'t', 'ठ':'th', 'ड':'d', 'ढ':'dh', 'ण':'n', 'त':'t', 'थ':'th', 'द':'d', 'ध':'dh', 'न':'n', 'प':'p', 'फ':'ph', 'ब':'b', 'भ':'bh', 'म':'m', 'य':'y', 'र':'r', 'ल':'l', 'व':'v', 'श':'sh', 'ष':'sh', 'स':'s', 'ह':'h', 'ळ':'l', 'क़':'q', 'ख़':'kh', 'ग़':'gh', 'ज़':'z', 'ड़':'d', 'ढ़':'dh', 'फ़':'f' }
const vowels: Record<string, string> = { 'अ':'a', 'आ':'aa', 'इ':'i', 'ई':'ee', 'उ':'u', 'ऊ':'oo', 'ऋ':'ri', 'ए':'e', 'ऐ':'ai', 'ओ':'o', 'औ':'au' }
const marks: Record<string, string> = { 'ा':'aa', 'ि':'i', 'ी':'ee', 'ु':'u', 'ू':'oo', 'ृ':'ri', 'े':'e', 'ै':'ai', 'ो':'o', 'ौ':'au', 'ॅ':'e', 'ॉ':'o' }
const nukta: Record<string, string> = { 'क':'q', 'ख':'kh', 'ग':'gh', 'ज':'z', 'ड':'d', 'ढ':'dh', 'फ':'f' }

// Conventional spoken spellings and unambiguous English loans. Unknown names
// and recognition mistakes remain editable; this is not an automatic spell checker.
const spellings: Record<string, string> = {
  'मैं':'main', 'में':'mein', 'है':'hai', 'हैं':'hain', 'हूँ':'hoon', 'हूं':'hoon', 'हिंदी':'hindi', 'हिन्दी':'hindi',
  'यह':'yeh', 'वह':'woh', 'ये':'ye', 'वो':'wo', 'यहाँ':'yahan', 'यहां':'yahan', 'वहाँ':'wahan', 'वहां':'wahan',
  'नहीं':'nahi', 'कहीं':'kahin', 'यहीं':'yahin', 'क्यों':'kyun', 'क्योंकि':'kyunki', 'भी':'bhi', 'ही':'hi', 'जी':'ji',
  'का':'ka', 'के':'ke', 'की':'ki', 'कि':'ki', 'को':'ko', 'से':'se', 'ने':'ne', 'पर':'par', 'पे':'pe', 'ना':'na',
  'जो':'jo', 'इस':'is', 'उस':'us', 'एक':'ek', 'दो':'do', 'तीन':'teen',
  'कोई':'koi', 'कुछ':'kuch', 'सब':'sab', 'अब':'ab', 'जब':'jab', 'तब':'tab', 'कब':'kab',
  'और':'aur', 'तो':'to', 'तुम':'tum', 'तुमने':'tumne', 'तुम्हें':'tumhein', 'मुझे':'mujhe', 'हम':'hum',
  'आप':'aap', 'आपको':'aapko', 'अपना':'apna', 'अपने':'apne', 'अपनी':'apni', 'उसने':'usne', 'इसने':'isne',
  'उसका':'uska', 'इसका':'iska', 'इसके':'iske', 'उसके':'uske', 'इसकी':'iski', 'उसकी':'uski',
  'मेरा':'mera', 'मेरे':'mere', 'मेरी':'meri', 'तेरा':'tera', 'तेरे':'tere', 'तेरी':'teri', 'क्या':'kya',
  'किया':'kiya', 'किये':'kiye', 'किए':'kiye', 'कर':'kar', 'करना':'karna', 'करने':'karne',
  'करता':'karta', 'करते':'karte', 'करती':'karti', 'करो':'karo', 'करके':'karke', 'करेंगे':'karenge',
  'था':'tha', 'थी':'thi', 'थे':'the', 'होगा':'hoga', 'होगी':'hogi', 'होता':'hota', 'होती':'hoti', 'होते':'hote',
  'होना':'hona', 'गया':'gaya', 'गई':'gayi', 'गये':'gaye', 'गए':'gaye', 'गयी':'gayi', 'जाओ':'jao',
  'चाहिए':'chahiye', 'चाहिये':'chahiye', 'रहा':'raha', 'रहे':'rahe', 'रही':'rahi', 'लिए':'liye', 'लिये':'liye',
  'देखा':'dekha', 'देखने':'dekhne', 'देखके':'dekhke', 'देखकर':'dekhkar', 'देखो':'dekho', 'देता':'deta',
  'लगता':'lagta', 'लगती':'lagti', 'लगते':'lagte', 'लगा':'laga', 'बनाया':'banaya', 'बनाए':'banaye',
  'सकता':'sakta', 'सकती':'sakti', 'सकते':'sakte', 'बताओ':'batao', 'बताना':'batana', 'बोलो':'bolo',
  'अच्छा':'achha', 'अच्छी':'achhi', 'अच्छे':'achhe', 'बहुत':'bahut', 'ज्यादा':'zyada', 'ज़्यादा':'zyada',
  'ज़रा':'zara', 'जरा':'zara', 'सही':'sahi', 'अभी':'abhi', 'कभी':'kabhi', 'सभी':'sabhi',
  'इतना':'itna', 'इतनी':'itni', 'इतने':'itne', 'कितना':'kitna', 'कितनी':'kitni', 'कितने':'kitne',
  'पहले':'pehle', 'पहली':'pehli', 'पहला':'pehla', 'दूसरा':'doosra', 'पानी':'paani', 'भाई':'bhai',
  'बात':'baat', 'बाद':'baad', 'साथ':'saath', 'आज':'aaj', 'कल':'kal', 'नाम':'naam', 'काम':'kaam',
  'दुनिया':'duniya', 'नमस्ते':'namaste', 'भारत':'bharat', 'धन्यवाद':'dhanyavaad',
  'गारंटी':'guarantee', 'गोल्डन':'golden', 'कैन':'can', 'कोक':'Coke', 'फीफा':'FIFA', 'वर्ल्ड':'world',
  'कप':'cup', 'चैंपियंस':'champions', 'एडिशन':'edition', 'स्पेसिफिकली':'specifically',
  'विनर':'winner', 'विनर्स':'winners', 'स्पेन':'Spain', 'एक्सक्लूसिव':'exclusive', 'एक्सक्लूजिव':'exclusive',
  'वीडियो':'video', 'ऑडियो':'audio', 'एडिटर':'editor', 'मॉडल':'model',
  'पीस':'piece', 'हिस्ट्री':'history', 'कमेंट':'comment', 'कमेंट्स':'comments', 'चेक':'check',
  'अवेलेबल':'available', 'ऑनलाइन':'online', 'ऐप':'app', 'फोन':'phone', 'फ़ोन':'phone', 'फुटबॉल':'football',
}

interface Sound { text: string; kind: 'vowel' | 'consonant' | 'other'; schwa?: boolean }
function wordToRoman(word: string): string {
  const normalized = word.normalize('NFC')
  if (spellings[normalized]) return spellings[normalized]
  const chars = Array.from(normalized)
  const sounds: Sound[] = []
  const add = (text: string, kind: Sound['kind'], schwa = false) => sounds.push({ text, kind, schwa })
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i]
    if (consonants[char]) {
      let sound = consonants[char]
      if (chars[i + 1] === '़') { sound = nukta[char] ?? sound; i++ }
      add(sound, 'consonant')
      const next = chars[i + 1]
      if (next === '्') i++
      else if (marks[next]) { add(marks[next], 'vowel'); i++ }
      else add('a', 'vowel', true)
    } else if (vowels[char]) add(vowels[char], 'vowel')
    else if (char === 'ं' || char === 'ँ') add(/[पफबभम]/u.test(chars[i + 1] ?? '') ? 'm' : 'n', 'consonant')
    else if (char === 'ः') add('h', 'consonant')
    else if (char === 'ॐ') add('om', 'other')
    else if (char >= '०' && char <= '९') add(String(char.charCodeAt(0) - '०'.charCodeAt(0)), 'other')
    else if (char !== '\u200c' && char !== '\u200d') add(char, 'other')
  }
  // Drop a final inherent vowel, then medial V-C-ə-C-V schwas right to left.
  // Explicit vowel matras are never removed.
  if (sounds.at(-1)?.schwa && sounds.length > 2) sounds.pop()
  for (let i = sounds.length - 3; i >= 2; i--) {
    if (sounds[i].schwa && sounds[i - 1].kind === 'consonant' && sounds[i - 2].kind === 'vowel'
      && sounds[i + 1]?.kind === 'consonant' && sounds[i + 2]?.kind === 'vowel') sounds.splice(i, 1)
  }
  return sounds.map(sound => sound.text).join('')
}

export function romanHindi(text: string): string {
  return text.replace(/[\u0900-\u0963\u0971-\u097f\u200c\u200d]+/gu, wordToRoman)
    .replace(/[०-९]/gu, digit => String(digit.charCodeAt(0) - '०'.charCodeAt(0)))
    .replace(/[।॥]/gu, '.')
}

/** Overrides belong to one run and the exact corrected source they were made from. */
export interface RomanEdit { sourceText: string; text: string }
export function romanText(sourceText: string, edit?: RomanEdit): string {
  return edit?.sourceText === sourceText ? edit.text : romanHindi(sourceText)
}
