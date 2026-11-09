"""Read saved targeted-Shruti evaluations and write a scope-separated report. No ASR."""
import argparse
import hashlib
import json
from pathlib import Path
import re

from shruti_adapt import distance, english, normalize


SCOPES = {
    'full': ('verified-full', 'Full verified recording — overlaps training',
             'Reconstruction/training-example recovery diagnostic. It includes trained phrases and is not an independent accuracy test.'),
    'target-test': ('verified-heldout', 'Two held-out fragments — same recording and speaker',
                    'Nonoverlapping audio fragments from the same recording/speaker. This does not demonstrate new-video or new-speaker generalization.'),
    'public-regression': ('public', 'Previously inspected public regression clips',
                          'Previously evaluated MUCS tutorial clips, not a fresh untouched test. Shruti already trained on the MUCS training domain.'),
}

TERMS = [
    ('keychain', ['keychain', 'key chain'], ['कीच', 'कीचेन', 'कीचैन']),
    ('frog', ['frog'], ['frock']),
    ('Gems', ['gems'], ['gym', 'gems', 'gem']),
    ("M&Ms", ['m&ms', "m&m's", 'm&m’s'], ['mnm', 'mnms', 'm n m', "m n m's", 'm and ms', "m and m's", 'eminence']),
    ('classy', ['classy'], ['class']),
    ('nutties', ['nutties'], ['notice']),
    ('Blinkit', ['blinkit'], ['blinket', 'blinking']),
    ('wand pen', ['wand pen'], ['bond pen', 'bond पहन']),
    ('licensed products', ['licensed products'], ['license products']),
    ('Harry Potter lover', ['harry potter lover'], ['harry potter lower', 'harry potter लगा']),
    ('edition', ['edition'], ['addition']),
]


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def sha(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def identity(row):
    metadata = row.get('metadata') or {}
    return metadata.get('segment_id') or metadata.get('id') or row['audio']


def scores(reference, hypothesis):
    ref, hyp = normalize(reference), normalize(hypothesis)
    if not ref: raise ValueError('Evaluation reference is empty after normalization')
    return {'overall': {'errors': distance(ref,hyp), 'referenceWords':len(ref)},
            'englishSubsequence': {'errors':distance(english(ref),english(hyp)), 'referenceWords':len(english(ref))}}


def aggregate(pairs, side):
    result = {}
    for metric in ['overall','englishSubsequence']:
        errors = sum(pair[side][metric]['errors'] for pair in pairs)
        count = sum(pair[side][metric]['referenceWords'] for pair in pairs)
        result[metric] = {'errors':errors,'referenceWords':count,'wer':errors/count if count else None}
    return result


def timing(evaluation):
    rows = evaluation['results']; duration = sum(float((row.get('metadata') or {}).get('duration') or 0) for row in rows)
    inference = sum(float(row.get('inferenceSec') or 0) for row in rows)
    timed_words = []; timed_clips = 0
    for row in rows:
        returned = ((row.get('raw') or {}).get('words') or [])
        timed = [w for w in returned if w.get('start') is not None and w.get('end') is not None]
        timed_words.extend(timed); timed_clips += bool(timed)
    path = Path(evaluation['model'])
    return {'model':str(path),'recordedSha256':evaluation['modelSha256'],
            'currentSha256':sha(path) if path.is_file() else None,
            'modelBytes':path.stat().st_size if path.is_file() else None,
            'clips':len(rows),'audioDurationSec':duration or None,'modelLoadSec':evaluation.get('modelLoadSec'),
            'inferenceSec':inference,'elapsedSec':evaluation.get('elapsedSec'),
            'inferenceRealTimeFactor':inference/duration if duration else None,
            'peakRamBytes':evaluation.get('peakRamBytes'),'runtimeVersions':evaluation.get('runtimeVersions'),
            'clipsWithNativeWordTimes':timed_clips,'nativeTimedWords':len(timed_words)}


def paired_scope(folder, suffix, expected):
    before = read(folder/f'baseline-{suffix}.json'); after = read(folder/f'candidate-{suffix}.json')
    for evaluation in [before,after]:
        if evaluation.get('evaluationScope') != expected:
            raise ValueError(f'Unexpected evaluation scope for {suffix}: {evaluation.get("evaluationScope")}')
        if not evaluation.get('results'): raise ValueError(f'Empty {suffix} evaluation')
    b = {identity(r):r for r in before['results']}; a = {identity(r):r for r in after['results']}
    if len(b) != len(before['results']) or len(a) != len(after['results']) or set(b) != set(a):
        raise ValueError(f'Clip identities differ or repeat in {suffix}')
    pairs = []
    for key,left in b.items():
        right = a[key]
        if left['reference'] != right['reference']: raise ValueError(f'References differ: {key}')
        lm, rm = left.get('metadata') or {}, right.get('metadata') or {}
        for field in ['audioSha256','pcmSha256','sourceAudioSha256']:
            if lm.get(field) and rm.get(field) and lm[field] != rm[field]: raise ValueError(f'Audio fingerprint differs: {key}')
        pairs.append({'id':key,'metadata':lm,'reference':left['reference'],
                      'baselineHypothesis':left['hypothesis'],'candidateHypothesis':right['hypothesis'],
                      'changed':left['hypothesis'] != right['hypothesis'],
                      'baseline':scores(left['reference'],left['hypothesis']),
                      'candidate':scores(right['reference'],right['hypothesis'])})
    bm, am = aggregate(pairs,'baseline'), aggregate(pairs,'candidate')
    return {'evaluationScope':expected,'clips':len(pairs),'pairs':pairs,
            'baseline':{'metrics':bm,'runtime':timing(before)},'candidate':{'metrics':am,'runtime':timing(after)},
            'delta':{m:am[m]['wer']-bm[m]['wer'] if bm[m]['wer'] is not None else None for m in bm}}


def literal_mentions(text, variants):
    """Case-insensitive exact spellings; no phonetic or fuzzy credit."""
    folded = text.casefold()
    pattern = r'(?<![a-z0-9])(?:'+ '|'.join(re.escape(v.casefold()) for v in sorted(set(variants),key=len,reverse=True)) + r')(?![a-z0-9])'
    # Case-folding can expand characters, so retain the folded match/context rather
    # than falsely claiming offsets into the original transcript. Raw text is kept separately.
    return [{'literal':match.group(0),'context':folded[max(0,match.start()-40):min(len(folded),match.end()+40)]}
            for match in re.finditer(pattern,folded)]


def term_diagnostics(full):
    text = {'reference':' '.join(p['reference'] for p in full['pairs']),
            'baseline':' '.join(p['baselineHypothesis'] for p in full['pairs']),
            'candidate':' '.join(p['candidateHypothesis'] for p in full['pairs'])}
    diagnostics = []
    for name, accepted, alternatives in TERMS:
        variants = {key:{'exactTargetMentions':literal_mentions(value,accepted),
                        'otherLiteralObservations':{variant:literal_mentions(value,[variant]) for variant in alternatives if variant.casefold() not in {v.casefold() for v in accepted}}}
                    for key,value in text.items()}
        diagnostics.append({'term':name,'targetSpellings':accepted,'observations':variants})
    return {'scope':'verified-full; includes training phrases',
            'policy':'Literal case-folded spellings only. Counts are unaligned presence diagnostics, not correctness or term-level accuracy. M&Ms aliases do not credit mnm, mnms or phonetic substitutes.',
            'rawFullTexts':text,'terms':diagnostics}


def compare(folder, production_model=None):
    training = read(folder/'training-metrics.json'); plan = read(folder/'plan.json')
    source = read(folder/'source.json'); provenance = read(folder/'target-data/provenance.json')
    if 'candidateValidationLoss' not in training: raise ValueError('Training/export is not complete')
    scopes = {suffix:paired_scope(folder,suffix,definition[0]) for suffix,definition in SCOPES.items()}
    baseline_hashes = {scope['baseline']['runtime']['recordedSha256'] for scope in scopes.values()}
    candidate_hashes = {scope['candidate']['runtime']['recordedSha256'] for scope in scopes.values()}
    if len(baseline_hashes) != 1 or len(candidate_hashes) != 1:
        raise ValueError('Evaluations mix different checkpoint versions across scopes')
    baseline_hash = next(iter(baseline_hashes)); candidate_hash = next(iter(candidate_hashes))
    canonical = Path(production_model) if production_model else Path(scopes['full']['baseline']['runtime']['model'])
    current = sha(canonical) if canonical.is_file() else None
    original_audio = Path(source['sourcePath']); current_audio = sha(original_audio) if original_audio.is_file() else None
    return {'schemaVersion':1,'experimentOnly':True,'promotionPerformed':False,
            'candidateSha256':candidate_hash,'baselineSha256':baseline_hash,'weightHashesDiffer':candidate_hash != baseline_hash,
            'productionModel':str(canonical),'productionModelSha256':current,
            'productionUnchanged':current == baseline_hash if current else None,
            'sourcePath':str(original_audio),'sourceExpectedSha256':source['sourceSha256'],'sourceCurrentSha256':current_audio,
            'sourceAudioUnchanged':current_audio == source['sourceSha256'] if current_audio else None,
            'scopes':scopes,'terms':term_diagnostics(scopes['full']),'training':training,'plan':plan,'source':source,'targetData':provenance,
            'timingAudit':read(folder/'timing-audit.json') if (folder/'timing-audit.json').exists() else None,
            'limitations':[
                'The full-recording score includes training examples and is a reconstruction diagnostic, not a generalization score.',
                'Two target held-out fragments share the training speaker and recording; they are not independent new-video evidence.',
                'The public regression set was inspected previously and is not a fresh untouched test.',
                'The supplied complete transcript was user-verified; crop boundaries were derived from ASR agreement anchors and were not manually verified word alignments.',
                'Literal target-word presence is not aligned accuracy. In particular, mnm is reported literally and is not credited as M&Ms.',
                'English-subsequence WER is a proxy that strips other-script words before alignment; it is not phrase, brand or timestamp accuracy.',
                'No general improvement claim or automatic production promotion follows from this small pilot.',
                'Public replay/regression material is MUCS CC BY-SA 4.0, a domain already included in Shruti training.'
            ]}


def pct(value): return 'unavailable' if value is None else f'{value*100:.2f}%'


def num(value,unit=''): return 'unavailable' if value is None else f'{value:.3f}{unit}'


def observations(values):
    found = [f'`{variant}` × {len(matches)}' for variant,matches in values.items() if matches]
    return ', '.join(found) or 'none of the listed variants'


def markdown(report):
    lines=['# Verified-recording Shruti adaptation experiment','',
           '**Experimental candidate only. Production promotion was not performed.**','',
           'The three evaluation scopes below are deliberately separate. They must not be combined into a single accuracy number.','']
    if report.get('timingAudit',{}).get('timingUnstable'):
        lines += ['**Timing was unstable across repetitions. The runtime observations below do not establish a speed improvement or regression.**','']
        for observation in report['timingAudit']['observations']:
            lines.append(f"- {observation['model']} {observation['run']}: {observation['elapsedSec']:.3f} s wall time.")
        lines.append('')
    for suffix,(_,title,caveat) in SCOPES.items():
        scope=report['scopes'][suffix]
        lines += ['## '+title,'',caveat,'',f"Clips: **{scope['clips']}**.",'',
                  '| Measure | Baseline | Candidate | Candidate minus baseline |','|---|---:|---:|---:|']
        for metric,label in [('overall','Overall WER'),('englishSubsequence','English-subsequence WER (proxy)')]:
            b=scope['baseline']['metrics'][metric];a=scope['candidate']['metrics'][metric];delta=scope['delta'][metric]
            lines.append(f"| {label} | {pct(b['wer'])} ({b['errors']}/{b['referenceWords']}) | {pct(a['wer'])} ({a['errors']}/{a['referenceWords']}) | {'unavailable' if delta is None else f'{delta*100:+.2f} pp'} |")
        lines += ['', 'Counts are edit errors / normalized reference words. Case and punctuation normalization can split a brand or contraction into multiple scoring tokens.','',
                  '| Runtime measure | Baseline | Candidate |','|---|---:|---:|']
        for field,label,unit,scale in [('modelBytes','Model file size',' MB',1e6),('modelLoadSec','Model loading',' s',1),('inferenceSec','Total inference',' s',1),('audioDurationSec','Audio duration',' s',1),('inferenceRealTimeFactor','Inference / audio time','×',1),('peakRamBytes','Peak process RAM',' MB',1e6)]:
            b=scope['baseline']['runtime'].get(field);a=scope['candidate']['runtime'].get(field)
            lines.append(f"| {label} | {num(None if b is None else b/scale,unit)} | {num(None if a is None else a/scale,unit)} |")
        b=scope['baseline']['runtime'];a=scope['candidate']['runtime']
        lines += ['',f"Native word times returned: baseline {b['clipsWithNativeWordTimes']}/{scope['clips']} clips ({b['nativeTimedWords']} timed words); candidate {a['clipsWithNativeWordTimes']}/{scope['clips']} clips ({a['nativeTimedWords']} timed words). Availability does not establish timestamp accuracy.",
                  f"Runtime versions: baseline `{json.dumps(b['runtimeVersions'],ensure_ascii=False)}`; candidate `{json.dumps(a['runtimeVersions'],ensure_ascii=False)}`.",'']
    training=report['training']
    lines += ['## Training and validation selection','',f"Selection: **{training.get('selection','not recorded')}**.",
              f"Initial validation loss: {num(training.get('initialValidationLoss'))}; exported candidate: {num(training.get('candidateValidationLoss'))}.",
              f"Initial per-domain validation losses: `{json.dumps(training.get('initialValidationDomains',{}))}`.",
              f"Candidate per-domain validation losses: `{json.dumps(training.get('candidateValidationDomains',{}))}`.",
              f"Public validation relative-loss tolerance: {pct(training.get('publicValidationRegressionTolerance'))}.",
              f"Optimization updates: {training.get('totalUpdates','not recorded')}; selected epoch: {training.get('selectedEpoch','not recorded')} ({training.get('selectedCheckpointUpdates','not recorded')} updates); rank: {training.get('rank','not recorded')}; learning rate: {training.get('learningRate','not recorded')}; timed optimization/export: {num(training.get('elapsedSec'),' s')} (excludes initial loading and encoder precomputation).",
              f"Training-label normalization: {training.get('trainingTextNormalization','not recorded')}. Exact supplied references are retained below.",'',
              '## Target-word observations on the full recording','',report['terms']['policy'],'',
              '**This full-recording diagnostic includes trained contexts; recovery here is training-example recovery, not generalization.**','',
              '| Target spelling(s) | Verified reference count | Baseline literal count | Candidate literal count | Baseline other observed variants | Candidate other observed variants |',
              '|---|---:|---:|---:|---|---|']
    for term in report['terms']['terms']:
        o=term['observations']
        lines.append(f"| {' / '.join(term['targetSpellings'])} | {len(o['reference']['exactTargetMentions'])} | {len(o['baseline']['exactTargetMentions'])} | {len(o['candidate']['exactTargetMentions'])} | {observations(o['baseline']['otherLiteralObservations'])} | {observations(o['candidate']['otherLiteralObservations'])} |")
    lines += ['', '## File integrity and production isolation','',
              f"Baseline checkpoint SHA-256: `{report['baselineSha256']}`.",
              f"Candidate checkpoint SHA-256: `{report['candidateSha256']}`.",
              f"Weight-file hashes differ: **{report['weightHashesDiffer']}**. A changed file is not itself evidence of improved recognition.",
              f"Canonical production checkpoint hash unchanged since baseline evaluation: **{report['productionUnchanged']}**.",
              f"Canonical checkpoint: `{report['productionModel']}`.",
              f"Original source M4A unchanged: **{report['sourceAudioUnchanged']}**.",
              f"Source: `{report['sourcePath']}`.",
              f"Expected source SHA-256: `{report['sourceExpectedSha256']}`.",
              f"Current source SHA-256: `{report['sourceCurrentSha256']}`.",'',
              '## Exact verified reference and raw full-recording outputs','',
              '### Verified reference','',report['terms']['rawFullTexts']['reference'],'',
              '### Raw baseline transcript','',report['terms']['rawFullTexts']['baseline'],'',
              '### Raw candidate transcript','',report['terms']['rawFullTexts']['candidate'],'',
              'No spelling replacements, keyword corrections, transliteration or automatic merging were applied to these raw observations.','',
              '## Held-out fragment and public regression transcripts','']
    for suffix in ['target-test','public-regression']:
        lines += ['### '+SCOPES[suffix][1],'']
        for pair in report['scopes'][suffix]['pairs']:
            lines += [f"**{pair['id']}** — overall edit errors {pair['baseline']['overall']['errors']} → {pair['candidate']['overall']['errors']}.",'',
                      '**Reference:** '+pair['reference'],'','**Baseline:** '+pair['baselineHypothesis'],'','**Candidate:** '+pair['candidateHypothesis'],'']
    lines += ['## Limitations','']+['- '+item for item in report['limitations']]
    lines += ['', 'Input plan, training history, provenance, exact term contexts and paired counts are retained in `comparison.json`. Original native responses and word times remain in the six evaluation JSON files.','']
    return '\n'.join(lines)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--folder',type=Path,required=True)
    parser.add_argument('--production-model',type=Path)
    args=parser.parse_args();report=compare(args.folder,args.production_model)
    (args.folder/'comparison.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    (args.folder/'REPORT.md').write_text(markdown(report),encoding='utf-8')
    print(json.dumps({'report':str(args.folder/'REPORT.md'),'productionUnchanged':report['productionUnchanged'],
                      'sourceAudioUnchanged':report['sourceAudioUnchanged'],'promotionPerformed':False}))


if __name__=='__main__':main()
