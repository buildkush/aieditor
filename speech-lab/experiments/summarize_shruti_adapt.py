"""Summarize an isolated Shruti pilot using saved outputs only (stdlib, no ASR)."""
import argparse
from collections import defaultdict
import hashlib
import json
from pathlib import Path
import random

from shruti_adapt import distance, english, normalize


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def sha256(path):
    with Path(path).open('rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest()


def identity(row):
    metadata = row.get('metadata') or {}
    return metadata.get('segment_id') or metadata.get('segmentId') or row['audio']


def hindi(words):
    return [word for word in words if any('\u0900' <= char <= '\u097f' for char in word)]


def row_counts(reference, hypothesis):
    ref, hyp = normalize(reference), normalize(hypothesis)
    if not ref:
        raise ValueError('Evaluation references must not normalize to empty text')
    return {
        'overall': {'errors': distance(ref, hyp), 'referenceWords': len(ref)},
        'englishSubsequence': {'errors': distance(english(ref), english(hyp)), 'referenceWords': len(english(ref))},
        'hindiScriptSubsequence': {'errors': distance(hindi(ref), hindi(hyp)), 'referenceWords': len(hindi(ref))},
    }


def add_rate(counts):
    return {**counts, 'wer': counts['errors']/counts['referenceWords'] if counts['referenceWords'] else None}


def aggregate(pairs, side):
    result = {}
    for metric in ['overall', 'englishSubsequence', 'hindiScriptSubsequence']:
        errors = sum(pair[side][metric]['errors'] for pair in pairs)
        words = sum(pair[side][metric]['referenceWords'] for pair in pairs)
        result[metric] = add_rate({'errors': errors, 'referenceWords': words})
    return result


def percentile(values, probability):
    ordered = sorted(values)
    index = (len(ordered)-1)*probability
    lo = int(index); hi = min(lo+1, len(ordered)-1)
    return ordered[lo]+(ordered[hi]-ordered[lo])*(index-lo)


def paired_intervals(pairs, samples=2000):
    groups = defaultdict(list)
    for pair in pairs:
        groups[pair['speakerId'] or pair['id']].append(pair)
    keys = sorted(groups)
    if len(keys) < 2:
        return {'method': 'Paired speaker-cluster bootstrap', 'available': False, 'reason': 'Fewer than two speaker groups'}
    rng = random.Random(20261106)
    deltas = defaultdict(list)
    for _ in range(samples):
        selected = [pair for key in rng.choices(keys, k=len(keys)) for pair in groups[key]]
        before = aggregate(selected, 'baseline'); after = aggregate(selected, 'candidate')
        for metric in before:
            if before[metric]['wer'] is not None and after[metric]['wer'] is not None:
                deltas[metric].append(after[metric]['wer']-before[metric]['wer'])
    return {'method': 'Paired speaker-cluster bootstrap; candidate minus baseline; negative favours candidate',
            'available': True, 'samples': samples, 'seed': 20261106, 'speakerGroups': len(keys),
            'interval95': {metric: [percentile(values,.025), percentile(values,.975)] for metric,values in deltas.items() if values},
            'caveat': 'Exploratory interval from a tiny selected sample; not proof of generalization or product-word accuracy.'}


def runtime_summary(evaluation):
    rows = evaluation['results']
    model = Path(evaluation['model'])
    duration = sum(float((row.get('metadata') or {}).get('duration') or 0) for row in rows)
    inference = sum(float(row.get('inferenceSec') or 0) for row in rows)
    timed = sum(any(word.get('start') is not None and word.get('end') is not None for word in ((row.get('raw') or {}).get('words') or [])) for row in rows)
    return {'modelPath': str(model), 'modelSha256': evaluation['modelSha256'],
            'currentModelSha256': sha256(model) if model.is_file() else None,
            'modelBytes': model.stat().st_size if model.is_file() else None,
            'audioDurationSec': duration or None, 'modelLoadSec': evaluation.get('modelLoadSec'),
            'inferenceSec': inference, 'elapsedSec': evaluation.get('elapsedSec'),
            'inferenceRealTimeFactor': inference/duration if duration else None,
            'peakRamBytes': evaluation.get('peakRamBytes'), 'runtimeVersions': evaluation.get('runtimeVersions'),
            'clipsWithReturnedWordTimes': timed, 'clips': len(rows)}


def compare(folder, production_model=None):
    baseline = read(folder/'baseline-test.json'); candidate = read(folder/'candidate-test.json')
    training = read(folder/'training-metrics.json'); provenance = read(folder/'data-v2/provenance.json')
    if not baseline.get('results') or not candidate.get('results'):
        raise ValueError('Both saved evaluations must contain nonempty results')
    before = {identity(row): row for row in baseline['results']}
    after = {identity(row): row for row in candidate['results']}
    if len(before) != len(baseline['results']) or len(after) != len(candidate['results']):
        raise ValueError('Duplicate clip identities in an evaluation')
    if set(before) != set(after):
        raise ValueError('Baseline and candidate evaluations contain different clips')
    pairs = []
    for key, left in before.items():
        right = after[key]
        if left['reference'] != right['reference']:
            raise ValueError(f'Reference differs between evaluations: {key}')
        meta = left.get('metadata') or {}; right_meta = right.get('metadata') or {}
        for field in ['audioSha256', 'pcmSha256']:
            if meta.get(field) and right_meta.get(field) and meta[field] != right_meta[field]:
                raise ValueError(f'Audio fingerprint differs between evaluations: {key}')
        pairs.append({'id':key, 'speakerId':meta.get('speaker_id'), 'recordingId':meta.get('recording_id'),
                      'reference':left['reference'], 'baselineHypothesis':left['hypothesis'], 'candidateHypothesis':right['hypothesis'],
                      'changed':left['hypothesis'] != right['hypothesis'],
                      'baseline':row_counts(left['reference'],left['hypothesis']),
                      'candidate':row_counts(right['reference'],right['hypothesis'])})
    baseline_metrics = aggregate(pairs,'baseline'); candidate_metrics = aggregate(pairs,'candidate')
    rejection_reasons = []
    if training.get('validationImproved') is False:
        rejection_reasons.append('No training epoch improved the initial validation loss.')
    if candidate_metrics['overall']['wer'] > baseline_metrics['overall']['wer']:
        rejection_reasons.append('The modified candidate made more overall word errors on this held-out sample.')
    production = Path(production_model) if production_model else Path(baseline['model'])
    production_hash = sha256(production) if production.is_file() else None
    return {'schemaVersion':1, 'experimentOnly':True, 'testClips':len(pairs),
            'candidateStatus':'rejected for promotion' if rejection_reasons else 'experimental; not promoted',
            'rejectionReasons':rejection_reasons,
            'baseline':{'metrics':baseline_metrics,'runtime':runtime_summary(baseline)},
            'candidate':{'metrics':candidate_metrics,'runtime':runtime_summary(candidate)},
            'deltas':{metric:(candidate_metrics[metric]['wer']-baseline_metrics[metric]['wer']) if baseline_metrics[metric]['wer'] is not None else None for metric in baseline_metrics},
            'pairedBootstrap':paired_intervals(pairs), 'pairedClips':pairs,
            'modelHashesDiffer':baseline['modelSha256'] != candidate['modelSha256'],
            'productionModelPath':str(production), 'productionModelSha256':production_hash,
            'productionUnchanged':production_hash == baseline['modelSha256'] if production_hash else None,
            'training':training,'dataset':provenance,
            'limitations':[
                'Public MUCS technical tutorial labels are not independently verified references for the user recordings.',
                'Shruti was already trained on MUCS train; this pilot reweights an existing training domain.',
                'English-subsequence and Hindi-script-subsequence WER are proxies, not aligned language-span or product-name accuracy.',
                'The tiny selected held-out test cannot establish broad generalization or stability.',
                'No evidence here establishes that frog, keychain, Gems, M&M\'s or Blinkit errors improved.',
                'No production promotion is performed by this report writer; a pilot alone is insufficient for that decision.',
                'Dataset provenance is CC BY-SA 4.0, not public domain. The mirror license badge differs from the original source.'
            ]}


def percent(value):
    return 'unavailable' if value is None else f'{value*100:.2f}%'


def number(value, suffix=''):
    return 'unavailable' if value is None else f'{value:.3f}{suffix}'


def render(report):
    before=report['baseline']; after=report['candidate']; training=report['training']
    lines=['# Shruti weight-adaptation pilot', '',
           f"Compared **{report['testClips']} paired held-out public clips**. This is a small isolated experiment, not a production accuracy claim.", '',
           f"Candidate disposition: **{report['candidateStatus']}**.",
           *['- '+reason for reason in report['rejectionReasons']], '',
           '## Recognition results', '',
           '| Measure | Canonical baseline | Modified candidate | Candidate minus baseline |',
           '|---|---:|---:|---:|']
    labels={'overall':'Overall WER','englishSubsequence':'English-subsequence WER (proxy)','hindiScriptSubsequence':'Hindi-script-subsequence WER (proxy)'}
    for metric,label in labels.items():
        b=before['metrics'][metric];a=after['metrics'][metric];delta=report['deltas'][metric]
        lines.append(f"| {label} | {percent(b['wer'])} ({b['errors']}/{b['referenceWords']}) | {percent(a['wer'])} ({a['errors']}/{a['referenceWords']}) | {'unavailable' if delta is None else f'{delta*100:+.2f} percentage points'} |")
    lines += ['', 'Counts are edit errors / reference-word counts. Subsequence metrics discard the other script before alignment; they do not measure correctly timed English spans or individual brand recognition.', '',
              '## Validation and checkpoint selection','',
              f"Initial validation loss: **{number(training.get('initialValidationLoss'))}**. Exported candidate validation loss: **{number(training.get('candidateValidationLoss'))}**.",
              f"Validation improved: **{training.get('validationImproved', 'not recorded')}**. Selection: {training.get('selection','not recorded')}.",
              f"Timed optimization/export (excludes initial loading and encoder precomputation): {number(training.get('elapsedSec'),' s')}. Decoder-only LoRA rank: {training.get('rank','not recorded')}; learning rate: {training.get('learningRate','not recorded')}.", '',
              '## Runtime and deployment evidence','',
              '| Measure | Canonical baseline | Modified candidate |','|---|---:|---:|']
    for key,label,unit,scale in [('modelBytes','Model file size',' MB',1e6),('modelLoadSec','Model loading',' s',1),('inferenceSec','Total measured inference',' s',1),('elapsedSec','Evaluation wall time',' s',1),('audioDurationSec','Audio duration',' s',1),('peakRamBytes','Peak process RAM',' MB',1e6)]:
        b=before['runtime'].get(key);a=after['runtime'].get(key)
        lines.append(f"| {label} | {number(None if b is None else b/scale,unit)} | {number(None if a is None else a/scale,unit)} |")
    lines += ['',f"Native word times were returned for {before['runtime']['clipsWithReturnedWordTimes']}/{report['testClips']} baseline clips and {after['runtime']['clipsWithReturnedWordTimes']}/{report['testClips']} candidate clips. Availability does not prove timestamp accuracy.",
              f"Baseline runtime versions: `{json.dumps(before['runtime'].get('runtimeVersions'),ensure_ascii=False)}`.",
              f"Candidate runtime versions: `{json.dumps(after['runtime'].get('runtimeVersions'),ensure_ascii=False)}`.", '',
              f"Baseline SHA-256: `{before['runtime']['modelSha256']}`.",
              f"Candidate SHA-256: `{after['runtime']['modelSha256']}`.",
              f"Distinct exported model hashes: **{report['modelHashesDiffer']}**. Hash differences establish a different file, not improved recognition.",
              f"Production checkpoint hash unchanged since baseline evaluation: **{report['productionUnchanged']}**.",
              f"Production checkpoint checked: `{report['productionModelPath']}`.", '',
              '## Sampling uncertainty','']
    bootstrap=report['pairedBootstrap']
    if bootstrap.get('available'):
        lines += [f"Exploratory 95% paired speaker-cluster bootstrap intervals, {bootstrap['samples']} resamples over {bootstrap['speakerGroups']} speaker groups. Values are candidate-minus-baseline percentage points; negative favours candidate.",'']
        for metric,bounds in bootstrap['interval95'].items():lines.append(f"- {labels[metric]}: {bounds[0]*100:+.2f} to {bounds[1]*100:+.2f} percentage points.")
        lines += ['',bootstrap['caveat']]
    else:lines.append(bootstrap.get('reason','Unavailable.'))
    lines += ['', '## Scope and limitations','']+['- '+item for item in report['limitations']]
    provenance=report['dataset']
    lines += ['',f"Dataset: `{provenance.get('dataset','not recorded')}`. Selected splits: `{json.dumps(provenance.get('counts',{}))}`. License: `{provenance.get('license','not recorded')}`.",
              '[Original OpenSLR source](https://www.openslr.org/104/) · [Dataset mirror](https://huggingface.co/datasets/dianavdavidson/MUCS-Hinglish) · [Shruti training description](https://huggingface.co/udgamlabs/Shruti#how-it-was-trained)', '',
              '## Paired transcript differences','',
              'Every evaluated clip is listed below, including unchanged outputs. Raw native word times and responses remain in the original evaluation JSON files.','']
    for i,pair in enumerate(report['pairedClips'],1):
        lines += [f"### {i}. {pair['id']}", '',f"Speaker: `{pair['speakerId']}`. Output changed: **{pair['changed']}**. Overall edit errors: {pair['baseline']['overall']['errors']} → {pair['candidate']['overall']['errors']}.", '',
                  '**Reference**','',pair['reference'],'','**Baseline**','',pair['baselineHypothesis'],'','**Candidate**','',pair['candidateHypothesis'],'']
    return '\n'.join(lines)+'\n'


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--folder',type=Path,required=True)
    parser.add_argument('--production-model',type=Path)
    args=parser.parse_args();report=compare(args.folder,args.production_model)
    (args.folder/'comparison.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    (args.folder/'REPORT.md').write_text(render(report),encoding='utf-8')
    print(json.dumps({'report':str(args.folder/'REPORT.md'),'testClips':report['testClips'],'productionUnchanged':report['productionUnchanged']},ensure_ascii=True))


if __name__=='__main__':main()
