"""Experimental speech-aware input windows and conservative overlap reconciliation."""
import math
import unicodedata

STRATEGY = 'speech-aware-overlap-v1'


def plan_chunks(length, speech, rate=16000):
    padding=round(.6*rate); core_limit=30*rate-2*padding
    # VAD supplies hints only. No samples, including silence, are removed.
    previous=0;gaps=[]
    for item in speech:
        a,b=item['start'],item['end']
        if type(a) is not int or type(b) is not int or not previous<=a<b<=length:
            raise ValueError('Invalid or overlapping VAD speech intervals')
        if a-previous>=round(.15*rate):gaps.append((previous,a))
        previous=b
    if length-previous>=round(.15*rate):gaps.append((previous,length))
    plan=[];start=0;previous_forced=False
    while start<length:
        incoming=padding if previous_forced else 0
        end=length if length-start+incoming<=30*rate else start+core_limit
        reason='end-of-input'
        if end<length:
            left=start+15*rate
            candidates=[]
            for a,b in gaps:
                center=(max(a,left)+min(b,end))//2
                if min(b,end)-max(a,left)>=round(.15*rate) and left<=center<=end:
                    candidates.append(center)
            if candidates:end=min(candidates,key=lambda x:(abs(x-start-26*rate),-x));reason='vad-pause'
            else:reason='limit-no-reliable-pause'
        forced=reason=='limit-no-reliable-pause'
        plan.append({'coreStart':start,'coreEnd':end,'inputStart':max(0,start-incoming),
                     'inputEnd':min(length,end+(padding if forced else 0)),'boundaryReason':reason})
        previous_forced=forced
        start=end
    return plan


def prepare_plan(samples, emit):
    # The existing Speech Lab environment already includes Silero's local ONNX
    # asset via faster-whisper. It is never installed in Tara's inference child.
    from faster_whisper.vad import get_speech_timestamps, VadOptions
    emit('progress',{'stage':'chunking','message':'Finding speech pauses for experimental Tara chunk boundaries'})
    speech=get_speech_timestamps(samples,VadOptions(min_silence_duration_ms=150,speech_pad_ms=0,min_speech_duration_ms=0))
    return {'strategy':STRATEGY,'chunks':plan_chunks(len(samples),speech),'speechIntervals':speech,
            'sampleRate':16000,'contextSec':.6,'vadUsedForBoundariesOnly':False,'vadUsedForWordTiming':True}


def validate_plan(plan,length):
    if plan.get('strategy')!=STRATEGY or plan.get('sampleRate')!=16000:
        raise ValueError('Unsupported Tara chunk plan')
    chunks=plan.get('chunks',[]);cursor=0
    for c in chunks:
        values=[c.get(k) for k in ('coreStart','coreEnd','inputStart','inputEnd')]
        if any(type(v) is not int for v in values):raise ValueError('Chunk positions must be integer samples')
        a,b,x,y=values
        if a!=cursor or not 0<=x<=a<b<=y<=length or y-x>30*16000 or a-x>9600 or y-b>9600:
            raise ValueError('Chunk plan lost audio coverage or exceeded the context budget')
        cursor=b
    if not chunks or cursor!=length:raise ValueError('Chunk plan does not cover the complete recording')
    return chunks


def normalized(text):
    return ''.join(c for c in unicodedata.normalize('NFKC',text).casefold() if unicodedata.category(c)[0] in 'LMN')


def matching_time(a,b,left,right):
    for w in (a,b):
        x,y=w.get('startTime'),w.get('endTime')
        if not isinstance(x,(int,float)) or not isinstance(y,(int,float)) or not math.isfinite(x) or not math.isfinite(y) or not x<y:
            return False
        if min(y,right)-max(x,left)<=0:return False
    return abs((a['startTime']+a['endTime'])/2-(b['startTime']+b['endTime'])/2)<=.2


def stitch_chunks(chunks):
    """Remove only a complete exact suffix/prefix match with matching audio times."""
    if not chunks:return '',[],[]
    words=list(chunks[0]['words']);diagnostics=[]
    for previous,current in zip(chunks,chunks[1:]):
        incoming=current['words'];left=current['inputStartSec'];right=previous['inputEndSec']
        if right<=left or not words or not incoming:
            words.extend(incoming)
            diagnostics.append({'atSec':current['coreStartSec'],'status':'pause-boundary','duplicateWordsRemoved':0})
            continue
        matches=[]
        for n in range(2,min(16,len(words),len(incoming))+1):
            a,b=words[-n:],incoming[:n]
            texts=[normalized(w['text']) for w in a]
            if not all(texts) or len(set(texts))==1:continue
            if texts!=[normalized(w['text']) for w in b]:continue
            if not all(matching_time(x,y,left,right) for x,y in zip(a,b)):continue
            if n<len(incoming) and incoming[n].get('startTime') is not None and incoming[n]['startTime']<a[-1]['endTime']-.02:
                continue
            matches.append(n)
        if matches:
            n=max(matches)
            diagnostics.append({'atSec':current['coreStartSec'],'status':'matched','duplicateWordsRemoved':n})
            words.extend(incoming[n:])
        else:
            # Never erase a potential spoken word on a text-only guess. Both
            # hypotheses remain reviewable, including their original chunk text.
            diagnostics.append({'atSec':current['coreStartSec'],'status':'ambiguous','duplicateWordsRemoved':0,
                                'message':'No reliable timed suffix/prefix match. Both boundary hypotheses retained; review possible repetitions.'})
            words.extend(incoming)
    text=' '.join(w['text'].strip() for w in words if w['text'].strip())
    return text,words,diagnostics
