"""Conservative word boundaries from Tara's attention/DTW path. Never interpolate times."""
import math
from numbers import Integral


def word_groups(tokenizer, tokens):
    """Keep UTF-8 byte pieces, Hindi vowel marks and English contractions together."""
    groups, pending, start = [], [], 0
    full = tokenizer.decode(tokens, skip_special_tokens=True)
    for index, token in enumerate(tokens):
        pending.append(token)
        text = tokenizer.decode(pending, skip_special_tokens=True)
        if '\ufffd' in text:
            continue
        if text:
            if not groups or text[0].isspace():
                groups.append({'text':text, 'first':start, 'last':index+1})
            else:
                groups[-1]['text'] += text
                groups[-1]['last'] = index+1
        pending, start = [], index+1
    if pending or ''.join(g['text'] for g in groups) != full:
        raise ValueError('Token-to-word grouping did not preserve the recognized text')
    return groups


def silence_ranges(samples, sample_rate=16000):
    """Detect only sustained near-zero PCM, used to reject timings across silence."""
    import numpy as np
    frame = sample_rate//50
    count = len(samples)//frame
    if not count: return []
    rms = np.sqrt(np.mean(np.square(samples[:count*frame].reshape(count,frame),dtype=np.float64),axis=1))
    quiet = rms < 0.0001
    ranges, start = [], None
    for i, silent in enumerate([*quiet,False]):
        if silent and start is None: start=i
        elif not silent and start is not None:
            if (i-start)/50 >= .4: ranges.append((start/50,i/50))
            start=None
    return ranges


def normalize_alignment(tokenizer, tokens, result, duration, offset, silence=()):
    groups = word_groups(tokenizer,tokens)
    if any(not isinstance(t,Integral) or not isinstance(f,Integral) for t,f in result.alignments):
        raise ValueError('Alignment indices must be integer audio frames and token indices')
    pairs = [(int(t),int(f)) for t,f in result.alignments]
    previous = (-1,-1)
    jumps = {}
    for text_index, frame in pairs:
        if text_index < previous[0] or frame < previous[1] or not 0 <= text_index <= len(tokens) or frame < 0 or frame*.02 > duration+.02:
            raise ValueError('Invalid or non-monotonic Tara alignment path')
        jumps.setdefault(text_index,frame*.02)
        previous=(text_index,frame)
    probabilities = list(result.text_token_probs)
    if len(probabilities) != len(tokens) or any(not math.isfinite(float(p)) or not 0 <= p <= 1 for p in probabilities):
        raise ValueError('Invalid Tara alignment token probabilities')
    words, rejected = [], 0
    for group in groups:
        begin,end = jumps.get(group['first']),jumps.get(group['last'])
        valid = begin is not None and end is not None and 0 <= begin < end <= duration+.02
        if valid:
            # Do not let a word absorb a speech pause. Retain it without a time
            # instead of guessing a shorter boundary from the surrounding words.
            valid = not any(min(end,b)-max(begin,a) >= .35 for a,b in silence)
        confidence = sum(probabilities[group['first']:group['last']])/(group['last']-group['first'])
        if not valid: rejected+=1
        words.append({'text':group['text'], 'startTime':offset+min(begin,duration) if valid else None,
                      'endTime':offset+min(end,duration) if valid else None, 'confidence':confidence})
    return words,rejected


def constrain_to_speech(words, speech, offset, duration):
    """Constrain DTW to detected speech, retaining ambiguous words without times.

    VAD supplies acoustic bounds, never evenly distributed word timestamps.
    A small boundary tail may belong to the preceding word; substantial speech
    on both sides of a pause is ambiguous and must not be silently discarded.
    """
    regions, evidence = [], []
    previous = 0
    for item in speech:
        a, b = item['start'], item['end']
        if type(a) is not int or type(b) is not int or not previous <= a < b <= round(duration*16000):
            raise ValueError('Invalid alignment speech intervals')
        previous = b
        actual=(a/16000+offset,b/16000+offset)
        a, b = max(0, a/16000-.06)+offset, min(duration, b/16000+.06)+offset
        if regions and a-regions[-1][1] < .35:
            regions[-1] = (regions[-1][0], b)
            evidence[-1].append(actual)
        else:
            regions.append((a,b))
            evidence.append([actual])
    output, changes = [], []
    for index, original in enumerate(words):
        word = dict(original)
        begin, end = word['startTime'], word['endTime']
        if begin is not None and end is not None:
            intersections = [(max(begin,a),min(end,b)) for a,b in regions if min(end,b)>max(begin,a)]
            # A single speech interval is unambiguous. If there are several,
            # permit only tiny (<200 ms) edge leakage, never multiple phrases.
            # Padding is boundary tolerance, not evidence that speech exists.
            # Counting it twice can turn two tiny edge leaks into two apparently
            # substantial phrases and incorrectly reject a short onset.
            substantial = [(max(begin,a),min(end,b)) for (a,b),parts in zip(regions,evidence)
                if sum(max(0,min(end,y)-max(begin,x)) for x,y in parts)>.2]
            chosen = intersections[0] if len(intersections)==1 else substantial[0] if len(substantial)==1 else None
            if chosen is None and len(intersections)>1 and not substantial and index>0:
                # A short word after a long pause can have two tiny overlaps:
                # the previous word's trailing VAD padding and its own onset.
                # Trust its native end only when the earlier overlap is already
                # covered by a timed previous word. Otherwise remain uncertain.
                prior=words[index-1]
                a,b=intersections[0]
                evidence_end=max((y for parts in evidence for x,y in parts if x<b and y>a),default=b)
                if (prior['startTime'] is not None and prior['endTime'] is not None
                        and abs(prior['endTime']-begin)<.001
                        and prior['startTime']<a and min(end,evidence_end)-prior['endTime']<=.2
                        and abs(intersections[-1][1]-end)<.001
                        and intersections[-1][0]-b>=.35):
                    chosen=intersections[-1]
            if chosen is None:
                word.update(startTime=None,endTime=None)
            else:
                a,b = chosen
                word['startTime'] = a if a-begin >= .35 else begin
                word['endTime'] = b if end-b >= .35 else end
            if (begin,end) != (word['startTime'],word['endTime']):
                changes.append({'wordIndex':index,'originalStartTime':begin,'originalEndTime':end,
                                'startTime':word['startTime'],'endTime':word['endTime']})
        output.append(word)
    return output, changes


def compact_speech(samples, speech):
    """Alignment-only audio; retain a reversible sample map to the source clock."""
    import numpy as np
    windows=[]
    for s in speech:
        a,b=max(0,s['start']-960),min(len(samples),s['end']+960)
        if windows and a-windows[-1][1]<5600:
            windows[-1]=(windows[-1][0],b)
        else:
            windows.append((a,b))
    mapping=[];cursor=0
    for a,b in windows:
        mapping.append({'compactStart':cursor,'compactEnd':cursor+b-a,'sourceStart':a,'sourceEnd':b})
        cursor+=b-a
    return (np.concatenate([samples[a:b] for a,b in windows]) if windows else samples[:0]),mapping


def source_time(t, mapping, end=False):
    # At a cut, starts belong to the following speech; ends to the preceding
    # speech. Using a single interpolation would reintroduce the removed pause.
    sample=round(t*16000)
    for m in (mapping if end else reversed(mapping)):
        if m['compactStart']<=sample<=m['compactEnd']:
            return (m['sourceStart']+sample-m['compactStart'])/16000
    raise ValueError('Refined alignment lies outside the compact audio')


def refine_missing(model, processor, samples, tokens, speech, offset, words, reencode, native_words=None):
    """One forced-alignment retry on speech-only context, never another ASR pass."""
    import tara
    compact,mapping=compact_speech(samples,speech)
    raw={'strategy':'speech-compacted-dtw-v1','sampleMap':mapping,'recoveredWordIndices':[]}
    if not len(compact) or len(compact)>=len(samples):
        raw['skipped']='No removable non-speech context'
        return words,raw
    result=model.align(reencode(compact),list(tara.TOKENS.values())[:-1],[tokens],
        [math.ceil(len(compact)/160)],median_filter_width=7)[0]
    candidates,_=normalize_alignment(processor.tokenizer,tokens,result,len(compact)/16000,0)
    raw['alignments']=[[int(t),int(f)] for t,f in result.alignments]
    raw['textTokenProbabilities']=[float(p) for p in result.text_token_probs]
    for w in candidates:
        if w['startTime'] is not None:
            w['startTime']=offset+source_time(w['startTime'],mapping)
            w['endTime']=offset+source_time(w['endTime'],mapping,end=True)
            if w['endTime']<=w['startTime']:
                w.update(startTime=None,endTime=None)
    mapped=[dict(w) for w in candidates]
    candidates,_=constrain_to_speech(candidates,speech,offset,len(samples)/16000)
    raw['shortWordConsensusIndices']=[]
    if native_words is not None:
        for i,(native,retry) in enumerate(zip(native_words,mapped)):
            if candidates[i]['startTime'] is not None or words[i]['startTime'] is not None:
                continue
            a,b=native['startTime'],native['endTime']
            if (a is None or retry['startTime'] is None or not 0<b-a<=1.5
                    or abs(a-retry['startTime'])>.08 or abs(b-retry['endTime'])>.08):
                continue
            # VAD can split a slowly spoken word. Agreement between original
            # and compacted DTW is evidence for retaining its native interval,
            # but never permits a long speech pause to become a word duration.
            spans=[(max(a,offset+s['start']/16000),min(b,offset+s['end']/16000))
                   for s in speech if min(b,offset+s['end']/16000)>max(a,offset+s['start']/16000)]
            if len(spans)<2 or spans[0][0]-a>.1 or b-spans[-1][1]>.1:
                continue
            if max(y[0]-x[1] for x,y in zip(spans,spans[1:]))>.9:
                continue
            candidates[i]=dict(native)
            raw['shortWordConsensusIndices'].append(i)
    output=[dict(w) for w in words]
    for i,candidate in enumerate(candidates):
        if words[i]['startTime'] is not None or candidate['startTime'] is None:
            continue
        a,b=candidate['startTime'],candidate['endTime']
        # A retry cannot displace a good neighbour or accept a stretched word.
        # Long words can be legitimate, but require manual review in this path.
        if b-a>2 or any(min(b,q['endTime'])-max(a,q['startTime'])>.001
            for k,q in enumerate(output) if k!=i and q['startTime'] is not None):
            continue
        output[i].update(startTime=a,endTime=b)
        raw['recoveredWordIndices'].append(i)
    return output,raw


def align_words(model, processor, encoded, samples, tokens, offset=0, speech=None, reencode=None):
    # CTranslate2 align() appends <|notimestamps|> itself. Supplying it twice
    # shifts the attention/text index relationship and produces wrong timings.
    import tara
    text_tokens = [int(t) for t in tokens if 0 <= t < 50257]
    if not text_tokens: return [],{},[]
    if len(text_tokens)+len(tara.TOKENS)+1 > 448:
        raise ValueError('Recognized tokens exceed the alignment decoder budget; no text was truncated')
    if processor.tokenizer.decode(text_tokens,skip_special_tokens=True) != processor.tokenizer.decode(tokens,skip_special_tokens=True):
        raise ValueError('Alignment token filtering changed recognized text')
    frames = min(3000,math.ceil(len(samples)/160))
    result = model.align(encoded,list(tara.TOKENS.values())[:-1],[text_tokens],[frames],median_filter_width=7)[0]
    words,rejected = normalize_alignment(processor.tokenizer,text_tokens,result,len(samples)/16000,offset,silence_ranges(samples))
    raw = {'alignments':[[int(t),int(f)] for t,f in result.alignments],
           'textTokenProbabilities':[float(p) for p in result.text_token_probs], 'numFrames':frames}
    warnings = [f'{rejected} word timing(s) unavailable on input starting {offset:.2f} s: missing/zero-length boundaries or a sustained silence overlap.'] if rejected else []
    if speech is not None:
        # Use the native path before the near-zero rejection, so an otherwise
        # sound word with leading/trailing silence can receive acoustic bounds.
        native_words,_ = normalize_alignment(processor.tokenizer,text_tokens,result,len(samples)/16000,offset)
        words,changes = constrain_to_speech(native_words,speech,offset,len(samples)/16000)
        raw.update({'timingConstraint':'silero-speech-bounds-v1','speechIntervals':speech,'timingAdjustments':changes})
        if reencode is not None and any(w['startTime'] is None for w in words):
            try:
                words,refinement=refine_missing(model,processor,samples,text_tokens,speech,offset,words,reencode,native_words)
                raw['refinement']=refinement
            except (ValueError,RuntimeError,IndexError,MemoryError) as error:
                raw['refinement']={'strategy':'speech-compacted-dtw-v1','error':str(error)}
        retained=[]
        for i,(word,native) in enumerate(zip(words,native_words)):
            if word['startTime'] is None and native['startTime'] is not None:
                word.update(startTime=native['startTime'],endTime=native['endTime'],timingNeedsReview=True)
                retained.append(i)
        raw['retainedNativeTimingIndices']=retained
        unavailable = sum(w['startTime'] is None for w in words)
        warnings = ([f'{len(retained)} original word interval(s) retained for manual adjustment on input starting {offset:.2f} s; timing needs review.'] if retained else [])
        if unavailable:
            warnings.append(f'{unavailable} word timing(s) unavailable because native alignment returned no usable interval on input starting {offset:.2f} s.')
    return words,raw,warnings
