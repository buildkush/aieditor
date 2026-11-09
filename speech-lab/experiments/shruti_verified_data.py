"""Prepare short verified-reference clips using conservative ASR agreement anchors.

ASR words supply candidate *input clip boundaries* only. Training labels always
come from the supplied verified transcript. No word timestamps are fabricated.
The same-recording holdout is a limited within-recording check, not independent
speaker/video generalization evidence.
"""
import argparse
import difflib
import hashlib
import json
import math
from pathlib import Path
import re
import unicodedata
import wave
import sys


def digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def lexical(text):
    text = unicodedata.normalize('NFKC', text).casefold()
    return ''.join(c if unicodedata.category(c)[0] in 'LMN' else ' ' for c in text).split()


def flatten_words(words):
    tokens, owners = [], []
    for index, word in enumerate(words):
        for token in lexical(word):
            tokens.append(token); owners.append(index)
    return tokens, owners


def validate_native(words, duration):
    if not words:
        raise ValueError('Native word timestamps are required for boundary anchors')
    last_start = last_end = 0.0
    for word in words:
        start, end = word.get('startTime'), word.get('endTime')
        if not isinstance(word.get('text'), str) or any(isinstance(t, bool) or not isinstance(t, (int,float)) or not math.isfinite(t) for t in (start,end)):
            raise ValueError('Invalid native word text or timestamps')
        if not 0 <= start <= end <= duration+1e-6 or start < last_start or end < last_end:
            raise ValueError('Native word times are outside the recording or unordered')
        probability = word.get('confidence')
        if probability is not None and (isinstance(probability,bool) or not isinstance(probability,(int,float)) or not math.isfinite(probability) or not 0 <= probability <= 1):
            raise ValueError('Invalid native word confidence')
        last_start, last_end = start, end


def anchor_boundaries(reference_words, native, duration, context=3):
    validate_native(native, duration)
    ref, ref_owner = flatten_words(reference_words)
    hyp, hyp_owner = flatten_words([word['text'] for word in native])
    boundaries = {0: {'referenceWordIndex':0, 'time':0.0, 'kind':'source start'}}
    matcher = difflib.SequenceMatcher(a=ref, b=hyp, autojunk=False)
    for block in matcher.get_matching_blocks():
        for offset in range(context, block.size-context+1):
            ri, hi = block.a+offset, block.b+offset
            # Do not cut inside an original whitespace word or native word.
            if ref_owner[ri] != ref_owner[ri-1]+1 or hyp_owner[hi] != hyp_owner[hi-1]+1:
                continue
            left, right = native[hyp_owner[hi-1]], native[hyp_owner[hi]]
            if right['startTime'] < left['endTime']:
                continue
            confidences = [left.get('confidence'),right.get('confidence')]
            if any(p is not None and (not isinstance(p,(int,float)) or p < .5) for p in confidences):
                continue
            position = ref_owner[ri]
            entry = {'referenceWordIndex':position, 'time':(left['endTime']+right['startTime'])/2,
                'kind':'exact lexical agreement', 'leftAnchor':ref[ri-context:ri], 'rightAnchor':ref[ri:ri+context],
                'nativeLeftIndex':hyp_owner[hi-1], 'nativeRightIndex':hyp_owner[hi],
                'nativeLeftEnd':left['endTime'], 'nativeRightStart':right['startTime'],
                'adjacentNativeConfidences':confidences}
            if position not in boundaries or entry['time'] < boundaries[position]['time']:
                boundaries[position] = entry
    boundaries[len(reference_words)] = {'referenceWordIndex':len(reference_words), 'time':duration, 'kind':'source end'}
    return sorted(boundaries.values(), key=lambda b:b['referenceWordIndex'])


def choose_cuts(boundaries, maximum=8.0, preferred=6.0, minimum=1.0):
    # Small shortest-path search over lexical agreement anchors. It never cuts
    # through an unmatched/misrecognized stretch just to meet a duration limit.
    costs = [float('inf')]*len(boundaries); previous = [None]*len(boundaries); costs[0] = 0.0
    for right in range(1,len(boundaries)):
        for left in range(right-1,-1,-1):
            duration = boundaries[right]['time']-boundaries[left]['time']
            if not minimum <= duration <= maximum:
                continue
            score = costs[left]+(duration-preferred)**2+.1
            if score < costs[right]: costs[right],previous[right] = score,left
    if not math.isfinite(costs[-1]):
        raise ValueError('Review needed: no safe sequence of agreement-anchor cuts covers the verified transcript within the maximum clip duration')
    result = []; cursor = len(boundaries)-1
    while cursor is not None:
        result.append(boundaries[cursor]); cursor = previous[cursor]
    return list(reversed(result))


PROTECTED = ('key chain','keychain','classy','gems','m&ms','blinkit','nutties','licensed products','wand pen','lover')


def split_clips(clips):
    protected = {i for i,row in enumerate(clips) if any(term in row['text'].casefold() for term in PROTECTED)}
    eligible = [i for i in range(len(clips)) if i not in protected]
    if len(eligible) < 3:
        raise ValueError('Review needed: too few non-target clips remain for same-recording holdout')
    frogs = [i for i in eligible if 'frog' in clips[i]['text'].casefold()]
    test = [frogs[-1]] if frogs else [eligible[-1]]
    # A separate, untrained ordinary phrase provides a second diagnostic test.
    extra = [i for i in eligible if i not in test]
    if len(extra) >= 4: test.append(extra[-1])
    validation = [i for i in eligible if i not in test][:2]
    if not validation: raise ValueError('Review needed: no validation clip available')
    groups = {'train':[], 'validation':[], 'test':[]}
    for i,row in enumerate(clips):
        group = 'test' if i in test else 'validation' if i in validation else 'train'
        groups[group].append(row)
    if not groups['train']: raise ValueError('No training clips after protected holdout selection')
    return groups, sorted(protected)


def prepare(audio, reference_path, benchmark, output, maximum=8.0):
    audio, reference_path, benchmark, output = map(Path,(audio,reference_path,benchmark,output))
    output = output.resolve()
    if any((output/name).exists() for name in ('all.jsonl','train.jsonl','validation.jsonl','test.jsonl')):
        raise ValueError('Use a new output directory; existing manifests are not overwritten')
    reference = reference_path.read_text(encoding='utf-8').strip()
    matches = list(re.finditer(r'\S+',reference)); words = [m.group() for m in matches]
    if not words: raise ValueError('Verified transcript is empty')
    sha = digest(audio)
    with wave.open(str(audio),'rb') as source:
        if (source.getnchannels(),source.getsampwidth(),source.getframerate(),source.getcomptype()) != (1,2,16000,'NONE'):
            raise ValueError('Expected prepared mono 16 kHz PCM16 WAV')
        frames = source.getnframes(); pcm = source.readframes(frames)
    duration = frames/16000
    exported = json.loads(benchmark.read_text(encoding='utf-8'))
    candidates = [run for run in exported.get('runs',[]) if run.get('audioSha256') == sha and run.get('nativeWords') and run.get('model') in ('shruti','shruti-needle-3210')]
    if not candidates: raise ValueError('No Shruti native timestamps match the exact prepared audio SHA-256')
    baseline = next((run for run in candidates if run['model']=='shruti'),candidates[0])
    if abs(baseline.get('audioDurationSec',0)-duration) > 1/16000:
        raise ValueError('Native timing duration does not match prepared source')
    anchors = anchor_boundaries(words,baseline['nativeWords'],duration)
    cuts = choose_cuts(anchors,maximum=maximum)
    sample_cuts = [round(cut['time']*16000) for cut in cuts]
    if sample_cuts[0] != 0 or sample_cuts[-1] != frames or any(b-a > round(maximum*16000) for a,b in zip(sample_cuts,sample_cuts[1:])):
        raise ValueError('Clip sample bounds do not exactly cover source within the duration limit')
    output.mkdir(parents=True,exist_ok=True); (output/'audio').mkdir(exist_ok=True)
    clips = []
    for i,(left,right) in enumerate(zip(cuts,cuts[1:])):
        lo,hi = left['referenceWordIndex'],right['referenceWordIndex']
        text = reference[matches[lo].start():matches[hi-1].end()]
        path = output/'audio'/f'clip-{i:02d}.wav'; a,b = sample_cuts[i:i+2]
        with wave.open(str(path),'wb') as target:
            target.setnchannels(1); target.setsampwidth(2); target.setframerate(16000); target.writeframes(pcm[a*2:b*2])
        clips.append({'audio':str(path),'text':text,'language':'hi','metadata':{
            'id':f'verified-harry-potter-{i:02d}','recording_id':'verified-harry-potter-83s','speaker_id':'user-verified-recording-speaker',
            'referenceWordStart':lo,'referenceWordEnd':hi,'inputStartSec':a/16000,'inputEndSec':b/16000,
            'sourceAudioSha256':sha,'audioSha256':digest(path),'duration':(b-a)/16000,
            'labelSource':'user-verified complete transcript','boundarySource':'ASR exact-agreement anchor gaps; not verified word alignments'}})
    if [w for clip in clips for w in clip['text'].split()] != words:
        raise AssertionError('Some verified reference words were lost or duplicated')
    groups,protected = split_clips(clips)
    for name,values in {'all':clips,**groups}.items():
        (output/(name+'.jsonl')).write_text(''.join(json.dumps(v,ensure_ascii=False)+'\n' for v in values),encoding='utf-8')
    report = {'sourceAudio':str(audio.resolve()),'sourceAudioSha256':sha,'referenceSha256':digest(reference_path),
        'referenceWords':len(words),'durationSec':duration,'maximumClipSec':maximum,'clips':len(clips),
        'groups':{name:len(values) for name,values in groups.items()},'protectedTrainingClipIndices':protected,
        'baselineRunId':baseline['id'],'anchorContextWordsPerSide':3,'candidateAnchorCount':len(anchors),'selectedCuts':cuts,
        'coverage':'All source samples and verified reference words are covered contiguously exactly once.',
        'limitations':['Only the complete transcript was verified by the user. Input crop boundaries are derived from matching ASR words, not manually verified alignment.',
            'Training, validation and test are from one recording and speaker; held-out fragments are not independent video/speaker generalization evidence.',
            'Unique target terms remain in training. Full-recording scores include trained phrases and must be reported separately from held-out fragment scores.']}
    (output/'provenance.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    return report


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--audio',type=Path,required=True);parser.add_argument('--reference',type=Path,required=True)
    parser.add_argument('--benchmark',type=Path,required=True);parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--maximum-seconds',type=float,default=8.0)
    args=parser.parse_args()
    print(json.dumps(prepare(args.audio,args.reference,args.benchmark,args.output,args.maximum_seconds),ensure_ascii=False,indent=2))


if __name__=='__main__':
    if hasattr(sys.stdout, 'reconfigure'): sys.stdout.reconfigure(encoding='utf-8')
    main()
