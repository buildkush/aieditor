"""Explicit Audio Lab profiles reusing verified CPU-study artifacts. No conversion/download."""
import json
import os
from pathlib import Path
import sys
import time
import uuid

IDS = ('shunya-int8',)


def profiles():
    return json.loads(Path(__file__).with_name('tested-cpu-assets.json').read_text(encoding='utf-8'))


def catalog(root):
    from shruti_runtime import verified
    rows = []
    for model, profile in profiles().items():
        installed = all(verified(Path(root)/f['path'], {'size': f['size'], 'sha256': f['sha256']}) for f in profile['files'])
        runtime = True
        rows.append({'id': model, 'name': profile['name'], 'repo': 'Verified local CPU study', 'installed': installed,
                     'runtimeInstalled': runtime, 'totalBytes': profile['bytes'], 'partialBytes': 0,
                     'error': None if installed and runtime else 'Verified CPU-study artifacts/runtime unavailable. Existing models remain available.'})
    return rows


def transcribe(root, request, emit):
    import os
    from audio import prepare
    from worker_process import relay
    status = next(row for row in catalog(root) if row['id'] == request['model'])
    if not status['installed'] or not status['runtimeInstalled']: raise ValueError(status['error'])
    started = time.perf_counter()
    audio = prepare(root, request['path'], emit)
    payload = {**request, 'prepared': audio, 'preparationSec': time.perf_counter()-started}
    env = dict(os.environ, HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', HF_HUB_DISABLE_TELEMETRY='1', PYTHONIOENCODING='utf-8')
    python = sys.executable
    relay(python, Path(__file__), root, payload, emit, env)


def recognize(root, request, emit):
    from importlib.metadata import version
    from audio import read_prepared
    from hardware import Metrics
    model_id = request['model']
    folder = Path(root)/profiles()[model_id]['folder']
    audio = request['prepared']; samples = read_prepared(audio['audioPath'])
    if abs(len(samples)/16000-audio['duration']) > 1/16000: raise ValueError('Prepared duration mismatch')
    metrics, started = Metrics(), time.perf_counter()
    try:
        emit('progress', {'stage':'loading','message':f'Loading {model_id} on CPU'})
        chunks, words = [], []
        import ctranslate2
        from faster_whisper import WhisperModel
        if version('faster-whisper') != '1.2.1' or ctranslate2.__version__ != '4.8.4': raise RuntimeError('Tested Shunya runtime versions do not match')
        if 'int8_float32' not in ctranslate2.get_supported_compute_types('cpu'): raise RuntimeError('CPU int8_float32 unavailable')
        model = WhisperModel(str(folder),device='cpu',compute_type='int8_float32',cpu_threads=4,local_files_only=True)
        loaded = time.perf_counter()
        segments, info = model.transcribe(samples,language=None,task='transcribe',beam_size=1,condition_on_previous_text=False,word_timestamps=True,vad_filter=False)
        texts = []
        for segment in segments:
            texts.append(segment.text)
            words.extend({'text':w.word,'startTime':w.start,'endTime':w.end,'confidence':w.probability} for w in segment.words or [])
            emit('progress',{'stage':'transcribing','message':segment.text,'completed':min(segment.end,audio['duration']),'total':audio['duration']})
        text = ''.join(texts); compute, threads = model.model.compute_type, 4
        versions = {'fasterWhisper':version('faster-whisper'),'ctranslate2':ctranslate2.__version__}
        finished = time.perf_counter(); measurements = metrics.finish(); preparation = request.get('preparationSec',0)
        measurements.update({'processingSec':finished-started+preparation,'modelLoadSec':loaded-started,'inferenceSec':finished-loaded,
            'audioPreparationSec':preparation,'audioDurationSec':audio['duration'],'realTimeFactor':(finished-started+preparation)/audio['duration'],
            'model':model_id,'requestedDevice':'cpu','device':'cpu','computeType':compute,'cpuThreads':threads,'fallback':None,
            'languageHint':'auto','vad':False,'vadSilenceMs':None,'wordTimestamps':model_id=='shunya-int8','wordTimestampsAvailable':bool(words),
            'coldWorker':True,'processedAudioSec':len(samples)/16000,'warnings':[]})
        measurements.update({'runtimeVersions':versions,'decodeWindowSec':30,
            'modelArtifact':profiles()[model_id]['folder']})
        return {'id':str(uuid.uuid4()),'model':model_id,'source':audio,'language':None,'languageProbability':None,
            'text':text,'words':words,'segments':[],'processingMetadata':measurements,'rawResponse':{'inputChunks':chunks}}
    finally:
        if not metrics.stop_event.is_set(): metrics.finish()


if __name__ == '__main__':
    import contextlib
    from worker import emit
    try:
        request = json.load(sys.stdin)
        with contextlib.redirect_stdout(sys.stderr):
            result = recognize(Path(sys.argv[1]), request, lambda kind,data: print(json.dumps({'type':kind,'data':data},ensure_ascii=False),file=sys.__stdout__,flush=True))
        emit('result', result)
    except Exception as error:
        import traceback
        traceback.print_exc(file=sys.stderr); emit('error',{'message':str(error)}); sys.exit(1)
