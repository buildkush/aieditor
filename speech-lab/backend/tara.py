"""Experimental original Tara, CPU FP32. No production caption imports or inference on install."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import uuid

ASSETS = json.loads(Path(__file__).with_name('tara-assets.json').read_text(encoding='utf-8'))
VERSIONS = {'torch': '2.10.0+cpu', 'transformers': '4.46.3', 'tokenizers': '0.20.3',
            'huggingface-hub': '0.36.0', 'safetensors': '0.7.0', 'numpy': '2.3.5', 'psutil': '7.2.2'}
TOKENS = {'<|startoftranscript|>': 50258, '<|hi|>': 50276, '<|mixedcode|>': 51866,
          '<|transcribe|>': 50360, '<|notimestamps|>': 50364}


def runtime_dir(root):
    root = Path(root).resolve()
    folder = root / 'experimental-runtimes' / 'tara'
    if not folder.resolve().is_relative_to(root) or folder.is_symlink():
        raise ValueError('Tara runtime must remain inside Speech Lab storage')
    return folder


def python_path(root):
    return runtime_dir(root) / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')


def runtime_ready(root):
    try:
        return python_path(root).is_file() and json.loads((runtime_dir(root)/'ready.json').read_text(encoding='utf-8')) == VERSIONS
    except (OSError, ValueError):
        return False


def command(args, emit):
    flags = {'creationflags': subprocess.CREATE_NO_WINDOW} if os.name == 'nt' else {}
    # Stream pip output as progress; stdout remains a valid worker protocol.
    with subprocess.Popen([str(a) for a in args], stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                          text=True, encoding='utf-8', errors='replace', **flags) as process:
        tail = []
        for line in process.stdout:
            tail = (tail + [line.strip()])[-12:]
            emit('progress', {'stage': 'installing', 'message': line.strip()})
        if process.wait():
            raise RuntimeError('Tara runtime installation failed: ' + '\n'.join(tail))


def install_runtime(root, emit):
    if runtime_ready(root):
        return
    folder = runtime_dir(root)
    folder.mkdir(parents=True, exist_ok=True)
    (folder/'ready.json').unlink(missing_ok=True)
    if not python_path(root).is_file():
        command([sys.executable, '-m', 'venv', folder], emit)
    command([python_path(root), '-m', 'pip', 'install', '--disable-pip-version-check',
             '--index-url', 'https://download.pytorch.org/whl/cpu', 'torch==' + VERSIONS['torch']], emit)
    command([python_path(root), '-m', 'pip', 'install', '--disable-pip-version-check',
             *[f'{name}=={version}' for name, version in VERSIONS.items() if name != 'torch']], emit)
    command([python_path(root), '-m', 'pip', 'check'], emit)
    command([python_path(root), Path(__file__), root, 'check-runtime'], emit)
    from models import write_json
    write_json(folder/'ready.json', VERSIONS)


def check_runtime():
    from importlib.metadata import version
    for name, expected in VERSIONS.items():
        if version(name) != expected:
            raise RuntimeError(f'Tara requires {name} {expected}; found {version(name)}. Verify / repair Tara.')
    import torch
    from transformers import WhisperForConditionalGeneration, WhisperProcessor
    if torch.version.cuda is not None:
        raise RuntimeError('Tara requires the isolated CPU-only PyTorch build')


def validate_assets(folder):
    """Validate original architecture, tokenizer and safetensors header without loading weights."""
    from safetensors import safe_open
    from transformers import WhisperProcessor
    config = json.loads((folder/'config.json').read_text(encoding='utf-8'))
    expected = {'model_type': 'whisper', 'd_model': 1280, 'encoder_layers': 32,
                'decoder_layers': 32, 'num_mel_bins': 128, 'vocab_size': 51904, 'max_target_positions': 448}
    if any(config.get(k) != v for k, v in expected.items()):
        raise ValueError('Tara architecture does not match the pinned original checkpoint')
    processor = WhisperProcessor.from_pretrained(str(folder), local_files_only=True)
    for token, expected_id in TOKENS.items():
        if processor.tokenizer.convert_tokens_to_ids(token) != expected_id:
            raise ValueError(f'Tara token mismatch: {token}')
    with safe_open(folder/'model.safetensors', framework='pt', device='cpu') as weights:
        embedding = weights.get_slice('model.decoder.embed_tokens.weight')
        if embedding.get_shape() != [51904, 1280] or embedding.get_dtype() != 'BF16':
            raise ValueError('Tara vocabulary or original weight precision mismatch')
    return processor


def transcribe(root, request, emit):
    from audio import prepare
    from models import installed
    from worker_process import relay
    if not installed(root, 'tara') or not runtime_ready(root):
        raise ValueError('Download or Verify / repair Tara before running it')
    started = time.perf_counter()
    audio = prepare(root, request['path'], emit)
    env = dict(os.environ, HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1',
               HF_HUB_DISABLE_TELEMETRY='1', PYTHONIOENCODING='utf-8')
    env.pop('PYTHONPATH', None)
    relay(python_path(root), Path(__file__), root,
          {**request, 'prepared': audio, 'preparationSec': time.perf_counter()-started}, emit, env)


def generate_chunk(model, processor, samples):
    import torch
    # Official Tara evaluation prefix, including the additional mixed-code token.
    prefix = list(TOKENS.values())
    features = processor(samples, sampling_rate=16000, return_tensors='pt').input_features.to('cpu', torch.float32)
    with torch.inference_mode():
        output = model.generate(input_features=features,
            decoder_input_ids=torch.tensor([prefix], dtype=torch.long, device='cpu'),
            max_new_tokens=448-len(prefix), do_sample=False, num_beams=1, return_timestamps=False)
    ids = output[0].tolist()
    text = processor.tokenizer.decode(ids, skip_special_tokens=True)
    generated_count = len(ids) - len(prefix) if ids[:len(prefix)] == prefix else len(ids)
    capped = generated_count >= 448-len(prefix) and ids[-1] != model.config.eos_token_id
    return text, ids, capped


def recognize(root, request, emit):
    from hardware import Metrics
    from audio import read_prepared
    from experimental_chunks import audio_chunks
    from models import model_dir
    metrics, started = Metrics(), time.perf_counter()
    try:
        check_runtime()
        import torch
        from transformers import WhisperForConditionalGeneration
        torch.set_num_threads(4)
        torch.set_num_interop_threads(1)
        folder = model_dir(root, 'tara')
        audio = request['prepared']
        samples = read_prepared(audio['audioPath'])
        if abs(len(samples)/16000-audio['duration']) > 1/16000 or not len(samples):
            raise ValueError('Prepared audio duration mismatch')
        emit('progress', {'stage': 'loading', 'message': 'Loading original Tara on CPU (FP32); this can use several GB of RAM'})
        processor = validate_assets(folder)
        model = WhisperForConditionalGeneration.from_pretrained(str(folder), local_files_only=True,
                    torch_dtype=torch.float32, attn_implementation='sdpa').to('cpu').eval()
        # Match the official reference evaluator. Do not let language/task defaults replace the custom prefix.
        model.generation_config.forced_decoder_ids = None
        model.generation_config.task = None
        model.generation_config.language = None
        loaded = time.perf_counter()
        chunks, warnings = [], ['Experimental original Tara CPU FP32; no word or subtitle timestamps are requested. Input chunk ranges are not speech timestamps.']
        if request.get('keywords'):
            warnings.append('Keyword hints are not applied in this Tara accuracy profile.')
        for start, end, chunk in audio_chunks(samples, maximum_seconds=30):
            emit('progress', {'stage': 'transcribing', 'completed': start/16000, 'total': audio['duration'],
                              'message': f'Tara: input {start/16000:.1f}–{end/16000:.1f} s'})
            text, ids, capped = generate_chunk(model, processor, chunk)
            if capped:
                warnings.append(f'Tara reached its decoder token limit on input {start/16000:.2f}–{end/16000:.2f} s; text may be incomplete.')
            chunks.append({'inputStartSec': start/16000, 'inputEndSec': end/16000, 'text': text, 'tokenIds': ids})
            emit('progress', {'stage': 'transcribing', 'completed': end/16000, 'total': audio['duration'], 'message': text or 'No text returned'})
        finished = time.perf_counter()
        metadata = metrics.finish()
        preparation = request.get('preparationSec', 0)
        metadata.update({'processingSec': finished-started+preparation, 'inferenceSec': finished-loaded,
            'audioPreparationSec': preparation, 'modelLoadSec': loaded-started, 'audioDurationSec': audio['duration'],
            'realTimeFactor': (finished-started+preparation)/audio['duration'], 'device': 'cpu', 'requestedDevice': 'cpu',
            'computeType': 'float32', 'fallback': None, 'model': 'tara', 'languageHint': 'hi+mixedcode',
            'vad': False, 'vadSilenceMs': None, 'wordTimestamps': False, 'wordTimestampsAvailable': False,
            'coldWorker': True, 'cpuThreads': 4, 'runtimeVersions': VERSIONS, 'modelRepository': ASSETS['repo'],
            'modelRevision': ASSETS['revision'], 'decodeWindowSec': 30, 'processedAudioSec': len(samples)/16000,
            'inputChunkCount': len(chunks), 'attentionImplementation': 'sdpa', 'conditionOnPreviousText': False,
            'warnings': warnings})
        return {'id': str(uuid.uuid4()), 'model': 'tara', 'source': audio, 'language': 'hi', 'languageProbability': None,
                'text': ' '.join(c['text'].strip() for c in chunks if c['text'].strip()), 'words': [], 'segments': [],
                'processingMetadata': metadata, 'rawResponse': {'inputChunks': chunks, 'decoderPrefix': list(TOKENS.values())}}
    finally:
        if not metrics.stop_event.is_set():
            metrics.finish()


if __name__ == '__main__':
    from worker import emit
    try:
        root = Path(sys.argv[1])
        if len(sys.argv) > 2:
            check_runtime()
            if sys.argv[2] == 'check-assets':
                from models import model_dir
                validate_assets(model_dir(root, 'tara'))
            print('Tara runtime/assets verified; no inference performed', flush=True)
        else:
            import contextlib
            request = json.load(sys.stdin)
            # Third-party diagnostics cannot corrupt NDJSON stdout.
            with contextlib.redirect_stdout(sys.stderr):
                result = recognize(root, request, lambda kind, data: print(json.dumps({'type': kind, 'data': data}, ensure_ascii=False), file=sys.__stdout__, flush=True))
            emit('result', result)
    except Exception as error:
        import traceback
        traceback.print_exc(file=sys.stderr)
        emit('error', {'message': f'Tara: {type(error).__name__}: {error}'})
        sys.exit(1)
