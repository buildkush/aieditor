"""Explicit, local Audio Lab experiment. Never imported by production workers.

Writes results only beneath the caller's experiment output directory. Uses the
existing verified reference PCM and original checkpoints read-only.
"""
import argparse
import csv
import hashlib
import json
import os
from pathlib import Path
import sys
import time
import traceback
import wave

PROJECT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT / 'speech-lab/backend'))
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
os.environ['NEEDLE_TELEMETRY'] = '0'
REFERENCE_SHA = '37ab9889d875f832dd80f99423db2ecabc65d1262d9a71f29e698214c150c595'


def save(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
    os.replace(temporary, path)


def reference(root):
    from audio import read_prepared
    for file in (root / 'audio').glob('*.json'):
        meta = json.loads(file.read_text(encoding='utf-8'))
        if meta.get('audioSha256') == REFERENCE_SHA:
            path = Path(meta['audioPath'])
            with path.open('rb') as source:
                if hashlib.file_digest(source, 'sha256').hexdigest() != REFERENCE_SHA:
                    raise ValueError('Reference PCM checksum mismatch')
            samples = read_prepared(path)
            if len(samples) != 1338956:
                raise ValueError('Unexpected reference audio length')
            return meta, samples
    raise ValueError('Verified reference PCM unavailable; no audio is regenerated')


def audit_generation(generate, tokenizer, records, limit):
    """Observe actual generated IDs; never edit generation arguments or output."""
    def observed(*args, **kwargs):
        start = time.perf_counter()
        result = generate(*args, **kwargs)
        sequences = result.sequences if hasattr(result, 'sequences') else result
        inputs = kwargs.get('input_ids')
        prompt_length = inputs.shape[1] if inputs is not None else 0
        ids = sequences[0, prompt_length:].detach().cpu().tolist()
        eos = kwargs.get('eos_token_id', tokenizer.eos_token_id)
        eos = set(eos if isinstance(eos, (list, tuple)) else [eos])
        ended = bool(ids and ids[-1] in eos)
        records.append({'generatedTokenCount': len(ids), 'generatedTokenIds': ids,
            'reachedTokenLimit': len(ids) >= limit, 'endedWithEos': ended,
            'stoppingReason': 'eos' if ended else 'token-limit' if len(ids) >= limit else 'other',
            'rawTextBeforeParsing': tokenizer.decode(ids, skip_special_tokens=True, clean_up_tokenization_spaces=False),
            'rawTextWithSpecialTokens': tokenizer.decode(ids, skip_special_tokens=False, clean_up_tokenization_spaces=False),
            'generationSec': time.perf_counter() - start})
        return result
    return observed


def srota(args, root, output):
    import torch
    from hardware import Metrics
    from experimental_chunks import audio_chunks
    torch.set_num_threads(args.threads)
    torch.set_num_interop_threads(1)
    if args.dtype == 'bf16' and not getattr(torch.cpu, '_is_avx512_bf16_supported', lambda: False)():
        raise RuntimeError('Native CPU BF16 is unsupported; refusing emulated BF16')
    dtype = torch.bfloat16 if args.dtype == 'bf16' else torch.float32
    metadata, samples = reference(root)
    checkpoint = output.parent/args.native_model_name if args.native_converted else root / 'models/srota'
    timings = {'runtimeImportSec': time.perf_counter() - PROCESS_START}
    start = time.perf_counter()
    metrics = Metrics()
    kwargs = {'dtype': dtype, 'device_map': 'cpu', 'local_files_only': True}
    if args.attention != 'auto': kwargs['attn_implementation'] = args.attention
    if args.integration == 'sdk':
        from qwen_asr import Qwen3ASRModel
        wrapper = Qwen3ASRModel.from_pretrained(str(checkpoint), max_inference_batch_size=1, max_new_tokens=1024, **kwargs)
        model, processor = wrapper.model, wrapper.processor
    else:
        if args.integration == 'direct-hf':
            from transformers import AutoProcessor, AutoModelForMultimodalLM, AutoConfig
            native_config = AutoConfig.from_pretrained(str(checkpoint), local_files_only=True)
            original_config = json.loads((checkpoint/'config.json').read_text(encoding='utf-8'))
            legacy_text = original_config.get('thinker_config', {}).get('text_config', {})
            native_text = getattr(native_config, 'text_config', None)
            if legacy_text and getattr(native_text, 'hidden_size', None) != legacy_text.get('hidden_size'):
                raise RuntimeError('Direct native HF checkpoint schema mismatch: original thinker_config.text_config.hidden_size='
                    + str(legacy_text.get('hidden_size')) + '; native AutoConfig text_config.hidden_size='
                    + str(getattr(native_text, 'hidden_size', None))
                    + '. A documented weight/config conversion is required; refusing randomly initialized or mismatched weights.')
            processor = AutoProcessor.from_pretrained(str(checkpoint), local_files_only=True)
            model, loading = AutoModelForMultimodalLM.from_pretrained(str(checkpoint), output_loading_info=True, **kwargs)
            if loading.get('missing_keys') or loading.get('unexpected_keys') or loading.get('mismatched_keys'):
                raise RuntimeError('Direct HF checkpoint compatibility mismatch: ' + json.dumps(loading, default=str))
        else:
            # Same registered Qwen core/processor, bypass only the SDK inference/parser.
            from qwen_asr import Qwen3ASRModel
            from transformers import AutoModel, AutoProcessor
            model = AutoModel.from_pretrained(str(checkpoint), **kwargs)
            processor = AutoProcessor.from_pretrained(str(checkpoint), local_files_only=True, fix_mistral_regex=True)
        model.eval()
    timings['modelLoadSec'] = time.perf_counter() - start
    quantized = 0
    if args.quantization in ('int8','decoder-int8'):
        quant_start = time.perf_counter()
        targets = {torch.nn.Linear}
        if args.quantization == 'decoder-int8':
            targets = {name: torch.ao.quantization.default_dynamic_qconfig for name, module in model.named_modules()
                       if name.startswith('thinker.model.layers.') and isinstance(module,torch.nn.Linear)}
            if not targets: raise RuntimeError('Expected decoder Linear modules not found; refusing broad quantization')
        model = torch.ao.quantization.quantize_dynamic(model, targets, dtype=torch.qint8, inplace=True)
        quantized = sum(1 for module in model.modules() if isinstance(module, torch.ao.nn.quantized.dynamic.Linear))
        if not quantized: raise RuntimeError('No compatible Linear modules quantized')
        if args.integration == 'sdk': wrapper.model = model
        timings['quantizationSec'] = time.perf_counter() - quant_start
    captured = []
    original_generate = model.generate
    model.generate = audit_generation(original_generate, processor.tokenizer, captured, 1024)
    data = {'configuration': vars(args), 'source': metadata, 'runtime': {'torch': torch.__version__,
        'nativeBf16': getattr(torch.cpu, '_is_avx512_bf16_supported', lambda: False)(),
        'actualAttention': getattr(model.config, '_attn_implementation', None), 'quantizedLinearModules': quantized,
        'cpuThreads': torch.get_num_threads(), 'interopThreads': torch.get_num_interop_threads(),
        'generationConfig': model.generation_config.to_dict()},
        'timings': timings, 'chunks': [], 'status': 'running'}
    print('Model loaded; starting reference recording:', args.integration, args.threads, args.attention, args.quantization, flush=True)
    infer_start = time.perf_counter()
    for index, (offset, end, chunk) in enumerate(audio_chunks(samples, maximum_seconds=args.chunk_seconds, search_seconds=min(5,args.chunk_seconds/3))):
        chunk_start = time.perf_counter()
        before = len(captured)
        with torch.inference_mode():
            if args.integration == 'sdk':
                result = wrapper.transcribe(audio=(chunk, 16000), language=None, return_time_stamps=False)[0]
                text = result.text
            else:
                messages = [{'role': 'system', 'content': ''}, {'role': 'user', 'content': [{'type': 'audio', 'audio': ''}]}]
                prompt = processor.apply_chat_template(messages, add_generation_prompt=True, tokenize=False)
                # language=None: no forced language or translation prefix.
                inputs = processor(text=[prompt], audio=[chunk], return_tensors='pt', padding=True, sampling_rate=16000)
                inputs = inputs.to('cpu').to(dtype)
                generation_options = {'return_dict_in_generate': True} if args.integration == 'direct-hf' else {}
                generated = model.generate(**inputs, max_new_tokens=1024, **generation_options)
                ids = generated.sequences[:, inputs['input_ids'].shape[1]:]
                raw = processor.batch_decode(ids, skip_special_tokens=True, clean_up_tokenization_spaces=False)[0]
                # Strip metadata only. No repetition cleanup or lexical rewriting.
                text = raw.split('<asr_text>', 1)[1].strip() if '<asr_text>' in raw else raw.strip()
        record = {'index': index, 'inputStartSec': offset / 16000, 'inputEndSec': end / 16000,
            'durationSec': (end - offset) / 16000, 'inferenceSec': time.perf_counter() - chunk_start,
            'textAfterParsing': text, 'generation': captured[before:]}
        data['chunks'].append(record)
        data['finalTranscript'] = ' '.join(c['textAfterParsing'] for c in data['chunks'])
        save(output, data)
        print('CHUNK', index + 1, 'through', round(end / 16000, 3), 'seconds;', len(text), 'characters;',
              [(g['generatedTokenCount'], g['stoppingReason']) for g in captured[before:]], flush=True)
    timings['inferenceSec'] = time.perf_counter() - infer_start
    timings['processingSec'] = time.perf_counter() - start
    data['metrics'] = metrics.finish()
    data['status'] = 'complete'
    data['processedAudioSec'] = len(samples) / 16000
    save(output, data)
    print('COMPLETE', output, timings, data['metrics'], flush=True)


def convert_shunya(args, root, output):
    # Converter reuses already installed libraries read-only; no environment upgrades.
    sys.path.append(str(PROJECT / '.speech-lab-venv/Lib/site-packages'))
    import torch
    import ctranslate2
    from ctranslate2.converters import TransformersConverter
    from hardware import Metrics
    torch.set_num_threads(args.threads)
    supported = sorted(ctranslate2.get_supported_compute_types('cpu'))
    if 'int8' not in supported: raise RuntimeError('INT8 CPU computation unsupported: ' + repr(supported))
    destination = output.parent / 'shunya-ct2-int8'
    if destination.exists(): raise FileExistsError('Refusing to overwrite experiment model: ' + str(destination))
    metrics, start = Metrics(), time.perf_counter()
    source = root / 'models/shunya'
    model = TransformersConverter(str(source), copy_files=['tokenizer.json', 'preprocessor_config.json'], low_cpu_mem_usage=True)
    model.convert(str(destination), quantization='int8')
    save(output, {'status': 'complete', 'conversionSec': time.perf_counter() - start, 'metrics': metrics.finish(),
        'source': str(source), 'destination': str(destination), 'cpuComputeTypes': supported,
        'ctranslate2Version': ctranslate2.__version__, 'bytes': sum(p.stat().st_size for p in destination.rglob('*') if p.is_file())})
    print('CONVERSION COMPLETE', destination, flush=True)


def convert_srota(args, root, output):
    import importlib.util
    import shutil
    import torch
    from hardware import Metrics
    torch.set_num_threads(args.threads)
    destination = output.parent/args.native_model_name
    if destination.exists(): raise FileExistsError('Refusing to overwrite experimental conversion')
    source_file = output.parent/'convert_qwen3_asr_to_hf.py'
    provenance = json.loads((output.parent/'native-converter-provenance.json').read_text())
    if hashlib.sha256(source_file.read_bytes()).hexdigest() != provenance['sha256']:
        raise ValueError('Official converter source checksum mismatch')
    spec = importlib.util.spec_from_file_location('official_qwen_converter',source_file)
    converter = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(converter)
    metrics, start = Metrics(), time.perf_counter()
    original = root/'models/srota'
    converter.write_processor(original,destination,'asr')
    restored_alias = False
    if args.restore_tied_alias:
        from transformers import Qwen3ASRConfig, Qwen3ASRForConditionalGeneration
        config_dict = converter.clean_config(original,'asr')
        source_config = json.loads((original/'config.json').read_text(encoding='utf-8'))
        if source_config['thinker_config']['text_config'].get('tie_word_embeddings') is not True:
            raise ValueError('Original checkpoint does not declare tied embeddings')
        model = Qwen3ASRForConditionalGeneration(Qwen3ASRConfig(**config_dict)).to(torch.bfloat16)
        state = converter.convert_state_dict(converter.load_state_dict(original),converter.STATE_DICT_MAPPING_ASR)
        if 'lm_head.weight' in state or 'model.language_model.embed_tokens.weight' not in state:
            raise ValueError('Unexpected state: this compatibility branch only restores an omitted declared alias')
        state['lm_head.weight'] = state['model.language_model.embed_tokens.weight']
        model.load_state_dict(state,strict=True)
        model.tie_weights()
        model.save_pretrained(str(destination))
        restored_alias = True
    else:
        model = converter.write_asr_model(original,destination)
    # Retain original EOS/pad settings. The benchmark itself still requests 1024
    # tokens; never adopt the converter's different 512-token generation default.
    shutil.copy2(original/'generation_config.json',destination/'generation_config.json')
    save(output,{'status':'complete','conversionSec':time.perf_counter()-start,'metrics':metrics.finish(),
        'source':str(original),'destination':str(destination),'officialConverter':provenance,
        'weightLoading':'strict=True; no missing/unexpected keys allowed','declaredTiedEmbeddingAliasRestored':restored_alias,
        'bytes':sum(p.stat().st_size for p in destination.rglob('*') if p.is_file())})
    print('NATIVE HF CONVERSION COMPLETE',destination,flush=True)


def shunya(args, root, output):
    from hardware import Metrics
    metadata, samples = reference(root)
    start, metrics = time.perf_counter(), Metrics()
    words, chunks = [], []
    if args.integration == 'ct2':
        import ctranslate2
        from faster_whisper import WhisperModel
        if 'int8' not in ctranslate2.get_supported_compute_types('cpu'): raise RuntimeError('INT8 unsupported')
        model = WhisperModel(str(output.parent/'shunya-ct2-int8'), device='cpu', compute_type='int8',
                             cpu_threads=args.threads, local_files_only=True)
        runtime = {'ctranslate2':ctranslate2.__version__, 'computeType':model.model.compute_type,
                   'device':model.model.device, 'cpuThreads':args.threads}
        loaded = time.perf_counter()
        segments, info = model.transcribe(samples, language=None, task='transcribe', beam_size=1,
            word_timestamps=args.word_timestamps, vad_filter=False, condition_on_previous_text=False)
        for segment in segments:
            chunks.append({'start': segment.start, 'end': segment.end, 'text': segment.text})
            words.extend([{'word': w.word, 'start': w.start, 'end': w.end, 'probability': w.probability} for w in segment.words or []])
            print('SEGMENT', segment.end, segment.text.encode('ascii', 'backslashreplace').decode()[:100], flush=True)
        text = ''.join(c['text'] for c in chunks)
    else:
        import torch
        import shunya_adapter
        model = shunya_adapter.load(root/'models/shunya', torch, 'cpu', torch.float32, word_timestamps=args.word_timestamps)
        runtime = {'torch':torch.__version__, 'computeType':'float32', 'device':'cpu', 'cpuThreads':torch.get_num_threads()}
        loaded = time.perf_counter()
        with torch.inference_mode():
            result = shunya_adapter.recognize(model, samples, lambda completed, message: print('PROGRESS', completed, message, flush=True), word_timestamps=args.word_timestamps)
        text, words = result['text'], result['words']
    end = time.perf_counter()
    save(output, {'status': 'complete', 'configuration': vars(args), 'source': metadata, 'finalTranscript': text,
        'chunks': chunks, 'words': words, 'modelLoadSec': loaded-start, 'inferenceSec': end-loaded,
        'processingSec': end-start, 'metrics': metrics.finish(),'runtime':runtime})
    print('SHUNYA COMPLETE', output, end-start, flush=True)


def shruti(args, root, output):
    from shruti_transcription import transcribe
    metadata, _ = reference(root)
    result = transcribe(root, {'model':'shruti','path':metadata['path']},
                        lambda kind,data:print(kind,data,flush=True))
    save(output, {'status':'complete','configuration':vars(args),'finalTranscript':result['text'],
        'source':result['source'],'words':result['words'],'rawResponse':result['rawResponse'],
        'timings':{key:result['processingMetadata'][key] for key in ['modelLoadSec','inferenceSec','processingSec']},
        'metrics':result['processingMetadata']})
    print('SHRUTI BASELINE COMPLETE',output,flush=True)


PROCESS_START = time.perf_counter()
if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['srota','convert-shunya','convert-srota','shunya','shruti'])
    parser.add_argument('--output', required=True)
    parser.add_argument('--threads', type=int, default=4)
    parser.add_argument('--attention', choices=['auto','sdpa'], default='sdpa')
    parser.add_argument('--dtype', choices=['fp32','bf16'], default='fp32')
    parser.add_argument('--integration', default='sdk', choices=['sdk','direct-registered','direct-hf','ct2','pytorch'])
    parser.add_argument('--quantization', choices=['none','int8','decoder-int8'], default='none')
    parser.add_argument('--word-timestamps', action='store_true')
    parser.add_argument('--chunk-seconds', type=int, choices=[10,15,30], default=30)
    parser.add_argument('--native-converted', action='store_true')
    parser.add_argument('--native-model-name', choices=['srota-native-hf','srota-native-hf-tied-alias'], default='srota-native-hf')
    parser.add_argument('--restore-tied-alias', action='store_true')
    args = parser.parse_args()
    args.output = str(Path(args.output).resolve())
    output = Path(args.output)
    root = Path(os.environ['LOCALAPPDATA'])/'com.aiditor.app/speech-lab'
    if not output.is_relative_to(root/'experiments'):
        raise ValueError('Experiment outputs must stay in managed Audio Lab experiments storage')
    if not 1 <= args.threads <= (os.cpu_count() or 1): raise ValueError('Unavailable CPU thread count')
    try:
        {'srota': srota, 'convert-shunya': convert_shunya, 'convert-srota': convert_srota, 'shunya': shunya,'shruti':shruti}[args.action](args, root, output)
    except Exception as error:
        save(output, {'status':'failed', 'configuration': vars(args), 'error': str(error), 'traceback': traceback.format_exc()})
        traceback.print_exc()
        sys.exit(1)
