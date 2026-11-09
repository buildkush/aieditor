"""Isolated, bounded Shruti decoder-LoRA pilot. Never edits the production model.

Run in an isolated JAX/Flax environment. Dataset preparation is separate. This
preserves Shruti's existing Hindi tokenizer rather than rebuilding base Whistle.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import time
import unicodedata
import subprocess
import sys

os.environ.update(JAX_PLATFORMS='cpu', NEEDLE_TELEMETRY='0', HF_HUB_OFFLINE='1')


def rows(path):
    values = [json.loads(line) for line in Path(path).read_text(encoding='utf-8').splitlines() if line.strip()]
    if not values: raise ValueError(f'Empty manifest: {path}')
    return values


def write(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')


def normalize(text):
    text = unicodedata.normalize('NFKC', text).lower()
    return ''.join(c if unicodedata.category(c)[0] in 'LMN' else ' ' for c in text).split()


def distance(reference, hypothesis):
    row = list(range(len(hypothesis)+1))
    for i, expected in enumerate(reference, 1):
        prev, row[0] = row[0], i
        for j, actual in enumerate(hypothesis, 1):
            prev, row[j] = row[j], min(row[j]+1, row[j-1]+1, prev+(expected != actual))
    return row[-1]


def english(words):
    return [w for w in words if any('a' <= c <= 'z' for c in w)]


def load_original(folder):
    import numpy as np
    from dataclasses import replace
    from safetensors import safe_open
    import sentencepiece as spm
    from sentencepiece import sentencepiece_model_pb2
    from needle.model.whistle import Whistle, load_whistle
    from needle.model.export import whistle_tokenizer_blob
    checkpoint = folder/'shruti.safetensors'
    if hashlib.sha256(checkpoint.read_bytes()).hexdigest() != '5c43105db153a47d02c47131d37d066343f04f1c3ff82315ff5da1ce264fbfa7':
        raise ValueError('Unexpected original FP32 checkpoint')
    with safe_open(str(checkpoint), framework='np') as handle:
        meta = handle.metadata(); saved = json.loads(meta['config']); run = json.loads(meta['run'])
        if any(handle.get_slice(k).get_dtype() != 'F32' for k in handle.keys()):
            raise ValueError('All original weights must be FP32')
    params, cfg = load_whistle(str(checkpoint))
    cfg = replace(cfg, dtype='float32', flash=False, remat=False)
    if cfg.text != 8906 or cfg.vocab != 8914 or len(run['pieces']) != 714 or tuple(run['languages']) != cfg.languages:
        raise ValueError('Shruti vocabulary/config mismatch')
    proto = sentencepiece_model_pb2.ModelProto()
    tokenizer_path = folder/'tokenizer.model'
    if hashlib.sha256(tokenizer_path.read_bytes()).hexdigest() != '97dfd5666620b19875deba9e55953d312364e7763bd08bee428b94f1b9491b25':
        raise ValueError('Unexpected base tokenizer')
    proto.ParseFromString(tokenizer_path.read_bytes())
    if len(proto.pieces) != 8192: raise ValueError('Unexpected base token count')
    low = min(p.score for p in proto.pieces)
    for i, piece in enumerate(run['pieces']): proto.pieces.add(piece=piece, score=low-1-i)

    class Tokenizer:
        text = cfg.text
        languages = cfg.languages
        sp = spm.SentencePieceProcessor(model_proto=proto.SerializeToString())

        def blob(self): return whistle_tokenizer_blob(proto, self.languages)

    tokenizer = Tokenizer()
    if tokenizer.sp.get_piece_size() != cfg.text: raise ValueError('Hindi pieces were not preserved')
    if params['embedding']['embedding'].shape != (cfg.vocab, cfg.dim): raise ValueError('Embedding rows mismatch')
    return Whistle(cfg), params, cfg, tokenizer


def export(folder, out, params=None):
    from needle.model.whistle_finetune import build
    model, original, cfg, tokenizer = load_original(folder)
    info = build(original if params is None else params, cfg, tokenizer, str(out))
    print('EXPORTED', json.dumps(info), flush=True)


def train(args):
    import numpy as np
    import jax
    import jax.numpy as jnp
    import optax
    from needle.model.whistle import Whistle
    from needle.model.finetune import lora_target_paths, init_lora, merge_lora
    from needle.model.quantize import configure_deploy, cq_ste_params
    from needle.model.checkpoints import write_adapter
    from needle.model.whistle_finetune import build
    from needle.agent.whistle import _read_wav
    folder = Path(args.folder); folder.mkdir(parents=True, exist_ok=True)
    asset_folder = Path(args.base_folder or folder)
    model, base, cfg, tokenizer = load_original(asset_folder)
    configure_deploy(act_bits=8, kv_bits=8)
    base = jax.tree_util.tree_map(jnp.asarray, base)
    paths = [p for p in lora_target_paths(base) if p[0] == 'stack']
    if not paths: raise ValueError('No decoder attention adapter targets found')
    adapters = init_lora(base, paths, args.rank, jax.random.PRNGKey(20261106))
    scale = 2.0
    update_count = args.epochs*len(rows(args.train))
    learning_rate = optax.warmup_cosine_decay_schedule(0.0,args.lr,args.warmup_steps,update_count,
        end_value=args.lr*.1) if args.warmup_steps else args.lr
    optimizer = optax.chain(optax.clip_by_global_norm(1), optax.adamw(learning_rate))
    state = optimizer.init(adapters)
    quantized = cq_ste_params(base, 4)
    encode = jax.jit(lambda p,w,n: model.apply({'params':p}, w, n, True, method=Whistle.encode))

    def prepare(manifest):
        prepared, domains = [], []
        for row in rows(manifest):
            audio = np.asarray(_read_wav(row['audio']), np.float32)
            max_samples = round(args.max_audio_seconds*16000)
            if not 0 < len(audio) <= max_samples: raise ValueError('Clip exceeds configured training audio window')
            training_text = row['text'].lower() if args.lowercase_labels else row['text']
            ids = [cfg.bos, cfg.tag('hi'), *tokenizer.sp.encode(training_text), cfg.eos]
            if len(ids) > 128: raise ValueError(f'Transcript exceeds 128-token training window: {row.get("metadata",{}).get("id",row["audio"])} ({len(ids)} tokens)')
            wav = np.zeros((1,max_samples),np.float32); wav[0,:len(audio)] = audio
            enc, frames = encode(quantized, wav, np.array([len(audio)],np.int32))
            enc.block_until_ready()
            tokens = np.full((1,128),cfg.pad,np.int32); tokens[0,:len(ids)] = ids
            prepared.append((enc, frames, tokens))
            domains.append(row.get('metadata',{}).get('domain','default'))
        return prepared, domains

    print('PRECOMPUTING frozen encoder features', flush=True)
    training, train_domains = prepare(args.train); validation, validation_domains = prepare(args.validation)

    def loss(lora, enc, frames, tokens, original):
        merged = cq_ste_params(merge_lora(original,lora,scale),4)
        logits = model.apply({'params':merged},tokens[:,:-1],enc,frames,True,method=Whistle.logits)
        targets = tokens[:,1:]; mask = targets != cfg.pad
        ce = optax.softmax_cross_entropy_with_integer_labels(logits,targets)
        return (ce*mask).sum()/jnp.maximum(mask.sum(),1)

    @jax.jit
    def step(lora, state, enc, frames, tokens, original):
        value, grads = jax.value_and_grad(loss)(lora,enc,frames,tokens,original)
        updates, state = optimizer.update(grads,state,lora)
        return optax.apply_updates(lora,updates), state, value

    score = jax.jit(loss)
    def val(lora):
        values = [float(score(lora,*item,base)) for item in validation]
        groups = {domain:float(np.mean([v for v,d in zip(values,validation_domains) if d==domain]))
                  for domain in set(validation_domains)}
        return float(np.mean(list(groups.values()))), groups
    initial, initial_domains = val(adapters); best_loss = initial; best_target = initial_domains.get('target',initial)
    best = None; best_domains = initial_domains; history = []
    native_baseline = json.loads(Path(args.native_baseline_evaluation).read_text(encoding='utf-8')) if args.native_validation else None
    native_best = (native_baseline['englishSubsequenceErrors'],native_baseline['wordErrors']) if native_baseline else None
    selected_native = None; selected_epoch = None
    if not np.isfinite(initial): raise ValueError('Non-finite initial loss; no candidate will be exported')
    print('INITIAL_VALIDATION_LOSS',initial,'DOMAINS',json.dumps(initial_domains),flush=True)
    start = time.perf_counter(); rng = np.random.default_rng(20261106)
    for epoch in range(args.epochs):
        losses = []
        for i in rng.permutation(len(training)):
            adapters,state,value = step(adapters,state,*training[i],base)
            losses.append(float(value))
            if not np.isfinite(losses[-1]): raise ValueError('Non-finite training loss; no candidate will be exported')
            print('STEP',epoch+1,len(losses),'LOSS',losses[-1],flush=True)
        current, current_domains = val(adapters)
        if not np.isfinite(current): raise ValueError('Non-finite validation loss; no candidate will be exported')
        native_current = None
        if args.native_validation:
            epoch_model = folder/f'epoch-{epoch+1}.cact'
            merged_epoch = merge_lora(base,adapters,scale)
            if not all(np.isfinite(np.asarray(v)).all() for v in jax.tree_util.tree_leaves(merged_epoch)):
                raise ValueError('Non-finite epoch weights')
            build(merged_epoch,cfg,tokenizer,str(epoch_model))
            epoch_output = folder/f'epoch-{epoch+1}-native-validation.json'
            subprocess.run([sys.executable,'-u',str(Path(__file__).resolve()),'evaluate','--model',str(epoch_model),
                '--engine',str(args.native_engine),'--manifest',str(args.native_validation),'--output',str(epoch_output),
                '--scope','verified-validation'],check=True,timeout=120)
            evaluated = json.loads(epoch_output.read_text(encoding='utf-8'))
            native_current = {'englishSubsequenceErrors':evaluated['englishSubsequenceErrors'],
                'wordErrors':evaluated['wordErrors'],'referenceEnglishWords':evaluated['referenceEnglishWords'],
                'referenceWords':evaluated['referenceWords']}
        history.append({'epoch':epoch+1,'trainingLoss':float(np.mean(losses)),'validationLoss':current,
                        'validationDomains':current_domains,'nativeValidation':native_current})
        print('EPOCH',json.dumps(history[-1]),flush=True)
        regression_ok = all(current_domains[d] <= initial_domains[d]*(1+args.public_regression_tolerance)
                            for d in current_domains if d != 'target') if 'target' in current_domains else True
        target_loss = current_domains.get('target',current)
        if args.native_validation:
            regression_ok = all(current_domains[d] <= initial_domains[d]*(1+args.public_regression_tolerance) for d in current_domains)
            objective = (native_current['englishSubsequenceErrors'],native_current['wordErrors'])
            improved = objective < native_best and native_current['wordErrors'] <= native_baseline['wordErrors']
        else:
            improved = target_loss < best_target
        if improved and regression_ok:
            best_loss = current; best_target = target_loss; best_domains = current_domains
            best = jax.tree_util.tree_map(lambda x:np.array(x),adapters)
            selected_epoch = epoch+1
            if native_current: native_best = objective; selected_native = native_current
        write(folder/'training-metrics.json', {'initialValidationLoss':initial,'history':history,'elapsedSec':time.perf_counter()-start})
    selected = best if best is not None else adapters
    modified = merge_lora(base,selected,scale)
    if not all(np.isfinite(np.asarray(value)).all() for value in jax.tree_util.tree_leaves(modified)):
        raise ValueError('Non-finite merged weights; no candidate will be exported')
    # Keep the candidate as an experiment even if validation did not improve.
    selected = jax.tree_util.tree_map(np.asarray,selected)
    write_adapter(str(folder/'pilot-adapter.safetensors'), {'lora':{'/'.join(p):v for p,v in selected.items()},
        'rows':np.zeros((0,cfg.dim),np.float32),'scale':scale,'base':str(asset_folder/'shruti.safetensors'),
        'rank':args.rank,'seed':20261106,'pieces':[],'languages':list(cfg.languages)})
    write(folder/'pilot-adapter.provenance.json', {'requiresShrutiAwareExporter':True,
        'warning':'Do not use stock needle whistle build; its tokenizer reconstruction omits the original 714 Hindi pieces.',
        'baseCheckpointSha256':hashlib.sha256((asset_folder/'shruti.safetensors').read_bytes()).hexdigest(),
        'trainingManifestSha256':hashlib.sha256(Path(args.train).read_bytes()).hexdigest(),
        'validationManifestSha256':hashlib.sha256(Path(args.validation).read_bytes()).hexdigest(),
        'trainingScriptSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'languages':list(cfg.languages),'existingHindiPieces':714,'architectureChanged':False})
    info = build(modified,cfg,tokenizer,str(folder/'pilot-candidate.cact'))
    write(folder/'training-metrics.json', {'initialValidationLoss':initial,'bestValidationLoss':best_loss,
        'validationImproved':best is not None,'candidateValidationLoss':best_loss if best is not None else current,
        'selection':('best target validation epoch under public guard' if 'target' in initial_domains else 'best validation epoch') if best is not None else 'last diagnostic epoch; no candidate passed validation selection',
        'initialValidationDomains':initial_domains,'candidateValidationDomains':best_domains if best is not None else current_domains,
        'publicValidationRegressionTolerance':args.public_regression_tolerance,'warmupSteps':args.warmup_steps,
        'totalUpdates':update_count,'trainingDomainCounts':{d:train_domains.count(d) for d in set(train_domains)},
        'maxAudioSeconds':args.max_audio_seconds,
        'selectedEpoch':selected_epoch,'selectedCheckpointUpdates':selected_epoch*len(training) if selected_epoch else None,
        'nativeValidationBaseline':{k:native_baseline[k] for k in ['wordErrors','referenceWords','englishSubsequenceErrors','referenceEnglishWords']} if native_baseline else None,
        'selectedNativeValidation':selected_native,
        'selectionPolicy':'lowest native validation English edit count, then total edits; total cannot exceed baseline; public validation loss within tolerance' if args.native_validation else 'teacher-forced validation loss',
        'trainingTextNormalization':'lowercase only; exact original references retained' if args.lowercase_labels else 'none',
        'history':history,'elapsedSec':time.perf_counter()-start,
        'decoderOnly':True,'rank':args.rank,'learningRate':args.lr,'quantizationAware':True,
        'existingHindiPiecesPreserved':714,'newVocabularyRows':0,'output':info})
    print('CANDIDATE_EXPORTED',json.dumps(info),flush=True)


def evaluate(args):
    from needle import Whistle
    from importlib.metadata import version
    import psutil
    import wave
    os.environ['NEEDLE3_LIB_PATH'] = str(Path(args.engine).resolve())
    process = psutil.Process(); peak_ram = process.memory_info().rss
    started = time.perf_counter(); model = Whistle(str(Path(args.model).resolve()))
    loaded = time.perf_counter()-started
    result = []; errors = total = english_errors = english_total = 0
    for row in rows(args.manifest):
        before = time.perf_counter(); raw = model.transcribe(row['audio'],language=None,keywords=None,word_timestamps=True)
        ref = normalize(row['text']); hyp = normalize(raw['text'])
        err = distance(ref,hyp); eng_err = distance(english(ref),english(hyp))
        errors+=err; total+=len(ref); english_errors+=eng_err; english_total+=len(english(ref))
        result.append({'reference':row['text'],'hypothesis':raw['text'],'metadata':row.get('metadata',{}),
                       'audio':row['audio'],'raw':raw,'wordErrors':err,'referenceWords':len(ref),
                       'englishSubsequenceErrors':eng_err,'referenceEnglishWords':len(english(ref)),
                       'inferenceSec':time.perf_counter()-before})
        memory = process.memory_info(); peak_ram = max(peak_ram,memory.rss,getattr(memory,'peak_wset',0))
        print('EVALUATED',len(result),'ERRORS',err,'ENGLISH_ERRORS',eng_err,flush=True)
    write(args.output,{'model':str(args.model),'modelSha256':hashlib.sha256(Path(args.model).read_bytes()).hexdigest(),
        'manifest':str(args.manifest),'modelLoadSec':loaded,'elapsedSec':time.perf_counter()-started,
        'peakRamBytes':peak_ram,'runtimeVersions':{'cactusNeedle':version('cactus-needle'),'needleEngine':'3.3.3'},
        'wordErrors':errors,'referenceWords':total,'wer':errors/max(1,total),
        'englishSubsequenceErrors':english_errors,'referenceEnglishWords':english_total,
        'englishSubsequenceWer':english_errors/max(1,english_total),'results':result,
        'evaluationScope':args.scope,
        'caveat':{'public':'Previously inspected public CC BY-SA 4.0 regression set; not new held-out evidence.',
                  'verified-heldout':'Nonoverlapping held-out phrases from the same recording/speaker; not new-video generalization.',
                  'verified-full':'Full verified recording includes training phrases; reconstruction diagnostic, not an independent test.',
                  'verified-validation':'Whole separate recording used for checkpoint selection, not final test evidence.',
                  'verified-unseen':'Whole recording withheld from fitting and checkpoint selection; a small single-recording test.'}[args.scope]})


def main():
    parser = argparse.ArgumentParser(); sub = parser.add_subparsers(dest='action',required=True)
    p=sub.add_parser('export-original');p.add_argument('--folder',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    p=sub.add_parser('train');p.add_argument('--folder',type=Path,required=True);p.add_argument('--train',type=Path,required=True);p.add_argument('--validation',type=Path,required=True)
    p.add_argument('--epochs',type=int,default=3);p.add_argument('--rank',type=int,default=4);p.add_argument('--lr',type=float,default=1e-4)
    p.add_argument('--base-folder',type=Path);p.add_argument('--warmup-steps',type=int,default=0)
    p.add_argument('--public-regression-tolerance',type=float,default=.05)
    p.add_argument('--max-audio-seconds',type=float,default=8.0)
    p.add_argument('--lowercase-labels',action='store_true')
    p.add_argument('--native-validation',type=Path);p.add_argument('--native-baseline-evaluation',type=Path);p.add_argument('--native-engine',type=Path)
    p=sub.add_parser('evaluate');p.add_argument('--model',type=Path,required=True);p.add_argument('--engine',type=Path,required=True);p.add_argument('--manifest',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    p.add_argument('--scope',choices=['public','verified-heldout','verified-full','verified-validation','verified-unseen'],default='public')
    args=parser.parse_args()
    if args.action=='train':train(args)
    elif args.action=='evaluate':evaluate(args)
    else:export(args.folder,args.output)


if __name__=='__main__':main()
