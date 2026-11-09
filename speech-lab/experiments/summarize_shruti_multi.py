"""Scope-separated report from saved multi-recording Shruti evaluations only."""
import argparse
import hashlib
import json
from pathlib import Path

from summarize_shruti_verified import TERMS, literal_mentions, num, paired_scope, pct


SCOPES = {
    'training-recordings': ('verified-full', 'Training-recording reconstruction',
        'Harry Potter 25 and Kinder Joy were used for fitting. These full-recording scores include trained examples and are not generalization evidence.'),
    'validation': ('verified-validation', 'Checkpoint-selection recording: Lego',
        'The complete Lego recording was used for checkpoint selection, including its ASMR gap. It is validation, not an unseen final test.'),
    'final-test': ('verified-unseen', 'Locked final test: Golden Can',
        'This whole recording was withheld from fitting and checkpoint selection until final evaluation. It is still only one recording, with speaker independence not established.'),
    'public-regression': ('public', 'Previously inspected public regression',
        'These MUCS clips were evaluated in earlier pilots. They are regression checks, not a fresh untouched benchmark; Shruti already trained on MUCS training material.'),
}

EXTRA_TERMS = [
    ('Kinder Joy', ['kinder joy'], []),
    ('golden can', ['golden can'], []),
    ('Champions Edition', ['champions edition'], ['champion edition', 'champions addition', 'champion sedition']),
    ('Coke', ['coke'], []),
    ('FIFA', ['fifa'], []),
    ('Spain', ['spain'], []),
    ('2026', ['2026'], ['twenty twenty six', 'two thousand twenty six']),
    ('Zepto', ['zepto'], []),
]


def read(path): return json.loads(Path(path).read_text(encoding='utf-8'))


def sha(path):
    with Path(path).open('rb') as handle: return hashlib.file_digest(handle,'sha256').hexdigest()


def recording_id(pair, sources):
    metadata = pair.get('metadata') or {}
    for key in ['recording_id','id']:
        if metadata.get(key) in sources: return metadata[key]
    return pair['id']


def integrity(folder, sources, plan, baseline_hash, production_model):
    checked = []
    for source in sources:
        path = Path(source['sourcePath']); current = sha(path) if path.is_file() else None
        reference = folder/(source['id']+'.txt')
        checked.append({'id':source['id'],'sourcePath':str(path),'expectedSha256':source['sourceSha256'],
                        'currentSha256':current,'unchanged':current == source['sourceSha256'] if current else None,
                        'preparedAudioSha256':source['prepared'].get('audioSha256'),
                        'referenceFile':str(reference),'referenceFileCurrentSha256':sha(reference) if reference.is_file() else None})
    production = Path(production_model); current = sha(production) if production.is_file() else None
    manifests = {}
    for name, expected in plan.get('manifestSha256',{}).items():
        path = folder/name; actual = sha(path) if path.is_file() else None
        manifests[name]={'expectedSha256':expected,'currentSha256':actual,'unchanged':actual == expected if actual else None}
    return {'sourceFiles':checked,'allSourcesUnchanged':all(item['unchanged'] is True for item in checked),
            'productionModel':str(production),'productionSha256':current,
            'productionUnchanged':current == baseline_hash if current else None,'manifestChecks':manifests,
            'referenceIntegrityNote':'Exact .txt reference files are retained. Current hashes are recorded; no independent pre-run .txt hashes were supplied in sources.json.'}


def word_observations(pairs, source_map, train_ids, test_id):
    output = []
    for pair in pairs:
        recording = recording_id(pair,source_map)
        role = 'trained recording' if recording in train_ids else 'withheld final test recording' if recording == test_id else 'other'
        texts={'reference':pair['reference'],'baseline':pair['baselineHypothesis'],'candidate':pair['candidateHypothesis']}
        terms=[]
        for name, accepted, alternatives in TERMS+EXTRA_TERMS:
            found={side:{'exactTargetMentions':literal_mentions(text,accepted),
                         'otherLiteralObservations':{variant:literal_mentions(text,[variant]) for variant in alternatives if variant.casefold() not in {x.casefold() for x in accepted}}}
                   for side,text in texts.items()}
            terms.append({'term':name,'targetSpellings':accepted,'observations':found})
        output.append({'recording':recording,'role':role,'terms':terms})
    return output


def compare(folder, production_model=None):
    sources=read(folder/'sources.json');plan=read(folder/'plan.json');training=read(folder/'training-metrics.json')
    if not isinstance(sources,list) or not sources: raise ValueError('sources.json must contain the supplied recordings')
    if 'candidateValidationLoss' not in training: raise ValueError('Training/export is not complete')
    scopes={suffix:paired_scope(folder,suffix,spec[0]) for suffix,spec in SCOPES.items()}
    bh={scope['baseline']['runtime']['recordedSha256'] for scope in scopes.values()}
    ch={scope['candidate']['runtime']['recordedSha256'] for scope in scopes.values()}
    if len(bh)!=1 or len(ch)!=1: raise ValueError('Saved evaluations mix checkpoint versions across scopes')
    baseline_hash=next(iter(bh));candidate_hash=next(iter(ch))
    source_map={source['id']:source for source in sources}
    train_ids=plan.get('trainRecordings',[]);test_id=plan.get('unseenTestRecording')
    observed_pairs=scopes['training-recordings']['pairs']+scopes['final-test']['pairs']
    production=production_model or scopes['training-recordings']['baseline']['runtime']['model']
    return {'schemaVersion':1,'experimentOnly':True,'promotionPerformed':False,'scopes':scopes,
            'baselineSha256':baseline_hash,'candidateSha256':candidate_hash,'weightHashesDiffer':baseline_hash!=candidate_hash,
            'integrity':integrity(folder,sources,plan,baseline_hash,production),
            'training':training,'plan':plan,'sources':sources,
            'termObservationPolicy':'Case-folded literal presence only, not aligned phrase accuracy. keychain/key chain are listed aliases; mnm is not credited as M&Ms. Spoken-number variants are shown literally, not silently equated with digits.',
            'termObservations':word_observations(observed_pairs,source_map,train_ids,test_id),
            'limitations':[
                'Training-recording improvements are reconstruction of fitted examples, not generalization.',
                'Lego was used to select checkpoints; its score is validation, not final-test evidence.',
                'Golden Can is a separate withheld recording, but a single recording cannot establish broad unseen-video accuracy and speaker independence was not verified.',
                'The 83.68475-second Harry Potter 25 audio duplicates the prior supplied recording; it is not additional independent coverage.',
                'Public MUCS examples are previously inspected regression data in an already-trained domain and retain CC BY-SA 4.0 provenance.',
                'References remain as supplied. Spoken-content assertions such as Spain and 2026 are not fact-corrected.',
                'Raw WER ignores case/punctuation but does not equate digits with spoken-number sequences, M&Ms with phonetic spellings, I\'m with I am, or key chain with keychain.',
                'English-subsequence WER strips other-script tokens before alignment and is a proxy, not aligned English phrase or product-name accuracy.',
                'Key-term counts describe literal output spellings, not correctness at every occurrence; raw outputs are preserved without replacements.',
                'Native timestamp availability is reported without claiming alignment quality; cropped target labels were anchored from ASR agreement, not manually verified word boundaries.',
                'Single-run timing can vary with CPU load and thermals; these measurements alone do not establish a general speed change.',
                'No automatic production promotion follows from this small experiment.'
            ]}


def render(report):
    lines=['# Multi-recording Shruti weight-adaptation pilot','',
           '**Experimental candidate only; no production promotion was performed.**','',
           'Training reconstruction, checkpoint-selection validation, locked final test, and public regression are reported separately. Do not combine them into one accuracy figure.','']
    for suffix,(_,title,caveat) in SCOPES.items():
        scope=report['scopes'][suffix]
        lines += ['## '+title,'',caveat,'',f"Samples: **{scope['clips']} recording(s)/clip(s)**.",'',
                  '| Metric | Canonical baseline | Modified candidate | Change |','|---|---:|---:|---:|']
        for key,label in [('overall','Overall WER'),('englishSubsequence','English-subsequence WER (proxy)')]:
            b=scope['baseline']['metrics'][key];a=scope['candidate']['metrics'][key];delta=scope['delta'][key]
            lines.append(f"| {label} | {pct(b['wer'])} ({b['errors']}/{b['referenceWords']}) | {pct(a['wer'])} ({a['errors']}/{a['referenceWords']}) | {'unavailable' if delta is None else f'{delta*100:+.2f} pp'} |")
        lines += ['', 'Counts are edit errors / normalized reference words. Negative changes favour the candidate on that scope only.','',
                  '| Runtime measure | Baseline | Candidate |','|---|---:|---:|']
        for key,label,unit,scale in [('modelBytes','Model size',' MB',1e6),('modelLoadSec','Loading',' s',1),('inferenceSec','Inference',' s',1),('audioDurationSec','Audio duration',' s',1),('peakRamBytes','Peak process RAM',' MB',1e6)]:
            b=scope['baseline']['runtime'].get(key);a=scope['candidate']['runtime'].get(key)
            lines.append(f"| {label} | {num(None if b is None else b/scale,unit)} | {num(None if a is None else a/scale,unit)} |")
        b=scope['baseline']['runtime'];a=scope['candidate']['runtime']
        lines += ['',f"Native word-time availability: baseline {b['clipsWithNativeWordTimes']}/{scope['clips']} samples, candidate {a['clipsWithNativeWordTimes']}/{scope['clips']} samples. This is availability, not verified timing accuracy.",
                  f"Runtime versions: baseline `{json.dumps(b['runtimeVersions'],ensure_ascii=False)}`; candidate `{json.dumps(a['runtimeVersions'],ensure_ascii=False)}`.",'']
    training=report['training'];plan=report['plan']
    lines += ['## Training and checkpoint selection','',
              f"Training recordings: `{', '.join(plan.get('trainRecordings',[]))}`; unique target clips: {plan.get('targetUniqueClips','not recorded')}. Balanced per epoch: {plan.get('balancedTargetClipsPerEpoch','not recorded')} target + {plan.get('publicReplayClipsPerEpoch','not recorded')} public replay clips.",
              f"Updates: {training.get('totalUpdates','not recorded')}; rank: {training.get('rank','not recorded')}; learning rate: {training.get('learningRate','not recorded')}; training time: {num(training.get('elapsedSec'),' s')}.",
              f"Selection policy: {training.get('selectionPolicy',plan.get('nativeValidationSelection','not recorded'))}.",
              f"Selected epoch: {training.get('selectedEpoch','not recorded')}; selected-checkpoint updates: {training.get('selectedCheckpointUpdates','not recorded')}.",
              f"Public validation loss guard: {pct(training.get('publicValidationRegressionTolerance'))} relative increase permitted.",
              f"Initial validation losses by domain: `{json.dumps(training.get('initialValidationDomains',{}))}`.",
              f"Selected candidate losses by domain: `{json.dumps(training.get('candidateValidationDomains',{}))}`.",
              f"Training-label normalization: {training.get('trainingTextNormalization','not recorded')}; exact references remain in the saved evaluation outputs and .txt files.",'',
              '## Literal target-word observations','',report['termObservationPolicy'],'',
              'These are presence counts, not per-occurrence correctness or an alternative accuracy metric. Training-recording recovery is labelled explicitly.','',
              '| Recording / role | Literal target spelling(s) | Reference | Baseline | Candidate |','|---|---|---:|---:|---:|']
    for recording in report['termObservations']:
        for term in recording['terms']:
            obs=term['observations'];counts=[len(obs[key]['exactTargetMentions']) for key in ['reference','baseline','candidate']]
            if not any(counts): continue
            lines.append(f"| {recording['recording']} — {recording['role']} | {' / '.join(term['targetSpellings'])} | {counts[0]} | {counts[1]} | {counts[2]} |")
    lines += ['', 'Literal alternative spellings and their exact contexts, including `mnm`, remain separately recorded in `comparison.json`; they are not silently credited or substituted.','',
              '## Checkpoint and source integrity','',f"Baseline SHA-256: `{report['baselineSha256']}`.",
              f"Candidate SHA-256: `{report['candidateSha256']}`.",f"Weight-file hashes differ: **{report['weightHashesDiffer']}**. Hash differences prove a different file, not an accuracy improvement.",
              f"Production checkpoint unchanged: **{report['integrity']['productionUnchanged']}**.",
              f"Production checkpoint: `{report['integrity']['productionModel']}`.",
              f"All supplied source audio files unchanged: **{report['integrity']['allSourcesUnchanged']}**.",'',
              '| Source | Audio SHA-256 unchanged | Exact reference file |','|---|---|---|']
    for item in report['integrity']['sourceFiles']:
        lines.append(f"| {item['id']} | {item['unchanged']} | `{item['referenceFile']}` |")
    lines += ['',report['integrity']['referenceIntegrityNote'],'',
              '## Raw references and outputs by scope','',
              'The following text is uncorrected native output. Number spellings, contractions, brand variants and the supplied Spain/2026 statements are preserved rather than rewritten.','']
    for suffix,(_,title,_) in SCOPES.items():
        lines += ['### '+title,'']
        for pair in report['scopes'][suffix]['pairs']:
            lines += [f"**{pair['id']}** — overall edit errors {pair['baseline']['overall']['errors']} → {pair['candidate']['overall']['errors']}.",'',
                      '**Reference:** '+pair['reference'],'','**Baseline:** '+pair['baselineHypothesis'],'','**Candidate:** '+pair['candidateHypothesis'],'']
    lines += ['## Limits','']+['- '+item for item in report['limitations']]
    lines += ['', 'The complete training history, plan, per-source integrity hashes, term observations, scope-specific metrics and paired outputs are saved in `comparison.json`. Original native word times and responses remain in the eight evaluation JSON files.','']
    return '\n'.join(lines)


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--folder',type=Path,required=True);parser.add_argument('--production-model',type=Path)
    args=parser.parse_args();report=compare(args.folder,args.production_model)
    (args.folder/'comparison.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    (args.folder/'REPORT.md').write_text(render(report),encoding='utf-8')
    print(json.dumps({'report':str(args.folder/'REPORT.md'),'promotionPerformed':False,'productionUnchanged':report['integrity']['productionUnchanged'],'sourcesUnchanged':report['integrity']['allSourcesUnchanged']}))


if __name__=='__main__':main()
