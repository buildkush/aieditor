"""Local Tara INT8 experiment; explicit native mixed-code support, no automatic inference."""
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import sys
import time
import uuid

import tara

VERSION = '4.8.4'
PROFILE = {'sourceRevision': tara.ASSETS['revision'], 'ctranslate2': VERSION,
           'quantization': 'int8_float32', 'nativePatch': 'tara-mixedcode-v1',
           'decoderPrefix': list(tara.TOKENS.values())}


def digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def native_ready(root):
    try:
        folder = tara.runtime_dir(root)
        marker = json.loads((folder/'tara-int8-native.json').read_text(encoding='utf-8'))
        return tara.runtime_ready(root) and marker['profile'] == PROFILE and all(
            (folder/f['path']).is_file() and (folder/f['path']).stat().st_size == f['size']
            and (not f['path'].endswith('ctranslate2.dll') or digest(folder/f['path']) == f['sha256'])
            for f in marker['files'])
    except (OSError, ValueError, KeyError):
        return False


def native_optimization(root):
    try:
        marker = json.loads((tara.runtime_dir(root)/'tara-int8-native.json').read_text(encoding='utf-8'))
        return marker.get('compilerReleaseFlags', 'not recorded')
    except (OSError, ValueError):
        return 'not recorded'


def installed(root, verify=False):
    from models import model_dir
    folder = model_dir(root, 'tara-int8')
    try:
        marker = json.loads((folder/'installed.json').read_text(encoding='utf-8'))
        return marker['profile'] == PROFILE and all(
            (folder/f['name']).is_file() and (folder/f['name']).stat().st_size == f['size']
            and (not verify or digest(folder/f['name']) == f['sha256']) for f in marker['files'])
    except (OSError, ValueError, KeyError):
        return False


def status(root):
    from models import model_dir
    folder = model_dir(root, 'tara-int8')
    size = sum(p.stat().st_size for p in folder.glob('*') if p.is_file()) if folder.exists() else 0
    return {'id':'tara-int8', 'name':'Tara – CTranslate2 INT8', 'repo':'Trelis/tara · local conversion',
            'installed':installed(root), 'runtimeInstalled':native_ready(root),
            'totalBytes':size or None, 'partialBytes':0 if installed(root) else size, 'error':None}


def install(root, emit):
    from models import download, installed as original_installed
    if installed(root, verify=True) and native_ready(root):
        emit('progress', {'stage':'installing','message':'Reusing verified Tara INT8 conversion'})
        return
    if not original_installed(root, 'tara'):
        download(root, 'tara', emit)
    if not native_ready(root):
        raise RuntimeError('Tara INT8 requires its isolated mixed-code runtime. Run scripts/setup-tara-int8.ps1 first.')
    tara.command([tara.python_path(root), Path(__file__), root, 'convert'], emit)


def activate_runtime():
    # Only this owned child sees the custom CTranslate2/MKL runtime. Shunya is untouched.
    folder = Path(sys.prefix)
    # Torch and CT2 must share one Intel OpenMP DLL on Windows. The setup script
    # disables CT2's duplicate preload; never use KMP_DUPLICATE_LIB_OK.
    import torch
    if os.name == 'nt':
        handles = [os.add_dll_directory(str(p)) for p in [folder/'Library/bin', folder/'Lib/site-packages/ctranslate2'] if p.is_dir()]
        os.environ['PATH'] = str(folder/'Library/bin') + os.pathsep + os.environ.get('PATH','')
    else:
        handles = []
    import ctranslate2
    if os.name == 'nt':
        import ctypes
        native = ctypes.CDLL(str(folder/'Lib/site-packages/ctranslate2/ctranslate2.dll'))
        probe = native.aiditor_tara_prompt_length
        probe.restype = ctypes.c_size_t
        if probe() != len(tara.TOKENS):
            raise RuntimeError('Native Tara mixed-code prefix check failed')
    if ctranslate2.__version__ != VERSION:
        raise RuntimeError('Tara INT8 CTranslate2 version mismatch')
    if 'int8_float32' not in ctranslate2.get_supported_compute_types('cpu'):
        raise RuntimeError('CPU int8_float32 is unavailable')
    return ctranslate2, handles


def validate(folder, ct2, load=True, intra_threads=4, inter_threads=1):
    from transformers import WhisperProcessor
    vocabulary = json.loads((folder/'vocabulary.json').read_text(encoding='utf-8'))
    for token, token_id in tara.TOKENS.items():
        if vocabulary[token_id] != token:
            raise ValueError(f'Converted Tara vocabulary mismatch: {token}')
    processor = WhisperProcessor.from_pretrained(str(folder), local_files_only=True)
    if any(processor.tokenizer.convert_tokens_to_ids(t) != i for t,i in tara.TOKENS.items()):
        raise ValueError('Converted tokenizer does not preserve Tara token IDs')
    generation = json.loads((folder/'generation_config.json').read_text(encoding='utf-8'))
    processor.tara_suppress_tokens = sorted(set(generation['suppress_tokens']) | set(range(50365, 51904)))
    config = json.loads((folder/'config.json').read_text(encoding='utf-8'))
    if config.get('alignment_heads') != generation['alignment_heads']:
        raise ValueError('Native alignment heads were not preserved')
    model = ct2.models.Whisper(str(folder), device='cpu', compute_type='int8_float32', intra_threads=intra_threads, inter_threads=inter_threads) if load else None
    if model and (model.n_mels != 128 or model.compute_type != 'int8_float32'):
        raise ValueError('Converted Tara architecture/compute mismatch')
    return processor, model


def convert(root):
    from models import model_dir, write_json
    ct2, handles = activate_runtime()
    original = model_dir(root, 'tara')
    # Hash all source assets before conversion; never modify them.
    for f in tara.ASSETS['files']:
        if digest(original/f['name']) != f['sha256']:
            raise ValueError('Original Tara asset verification failed: '+f['name'])
    tara.validate_assets(original)
    output = model_dir(root, 'tara-int8')
    output.mkdir(parents=True, exist_ok=True)
    (output/'installed.json').unlink(missing_ok=True)
    from ctranslate2.converters import TransformersConverter
    class TaraConverter(TransformersConverter):
        def load_model(self, model_class, model_name_or_path, **kwargs):
            # CT2 4.8.4 uses Transformers 5's spelling; original Tara pins 4.46.3.
            if 'dtype' in kwargs:
                kwargs['torch_dtype'] = kwargs.pop('dtype')
            return model_class.from_pretrained(model_name_or_path, local_files_only=True, **kwargs)
    # Smaller intermediate avoids loading a full 6 GB FP32 model during conversion.
    # INT8 is a lossy experimental derivative; the original BF16 checkpoint stays intact.
    copied = [f['name'] for f in tara.ASSETS['files'] if f['name'] not in ('model.safetensors','config.json')]
    converter = TaraConverter(str(original), copy_files=copied, load_as_float16=True)
    converter.convert(str(output), quantization='int8_float32', force=True)
    processor, model = validate(output, ct2)
    del model, processor
    files = [{'name':p.name,'size':p.stat().st_size,'sha256':digest(p)} for p in sorted(output.iterdir()) if p.is_file()]
    write_json(output/'installed.json', {'profile':PROFILE,'conversionIntermediate':'float16', 'files':files})
    print('Converted and load-checked Tara INT8; no inference performed', flush=True)


def transcribe(root, request, emit, prepared_audio=None, preparation_sec=0):
    from audio import prepare
    from worker_process import relay
    if not installed(root) or not native_ready(root):
        raise ValueError('Install / verify Tara INT8 before running it')
    started = time.perf_counter()
    audio = prepared_audio if prepared_audio is not None else prepare(root, request['path'], emit)
    plan=None; planning_sec=0
    if request.get('action') != 'tara_align' and request.get('taraChunking') == 'speech-aware':
        from audio import read_prepared
        from tara_chunking import prepare_plan
        planning_started=time.perf_counter()
        plan=prepare_plan(read_prepared(audio['audioPath']),emit)
        planning_sec=time.perf_counter()-planning_started
    env = dict(os.environ, HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', PYTHONIOENCODING='utf-8', HF_HUB_DISABLE_TELEMETRY='1')
    env.pop('PYTHONPATH', None)
    relay(tara.python_path(root), Path(__file__), root, {**request,'prepared':audio,'chunkPlan':plan,'chunkPlanningSec':planning_sec,'preparationSec':preparation_sec+time.perf_counter()-started}, emit, env)


def generate_chunk(model, processor, samples, ct2, alignment=None):
    import numpy as np
    prefix = list(tara.TOKENS.values())
    features = processor(samples, sampling_rate=16000, return_tensors='np').input_features
    features = ct2.StorageView.from_array(np.ascontiguousarray(features, dtype=np.float32))
    encoded = model.encode(features) if alignment is not None else features
    result = model.generate(encoded,
        [prefix], beam_size=1, max_length=448, suppress_tokens=processor.tara_suppress_tokens, suppress_blank=True)[0]
    ids = list(result.sequences_ids[0])
    text = processor.tokenizer.decode(ids, skip_special_tokens=True)
    if alignment is not None:
        from tara_alignment import align_words
        started = time.perf_counter()
        def reencode(cropped):
            features = processor(cropped, sampling_rate=16000, return_tensors='np').input_features
            return model.encode(ct2.StorageView.from_array(np.ascontiguousarray(features,dtype=np.float32)))
        try:
            words,raw,warnings = align_words(model,processor,encoded,samples,ids,alignment.get('offset',0),
                                           reencode=reencode,
                                           **({'speech':alignment['speech']} if 'speech' in alignment else {}))
            alignment.update({'words':words,'raw':raw,'warnings':warnings})
        except (ValueError,RuntimeError,IndexError,MemoryError) as error:
            import re
            alignment.update({'words':[{'text':w,'startTime':None,'endTime':None,'confidence':None} for w in re.findall(r'\s*\S+',text)],
                'raw':{'error':str(error)},'warnings':[f'Word alignment unavailable on input starting {alignment.get("offset",0):.2f} s: {error}']})
        alignment['seconds'] = time.perf_counter()-started
    return text, ids, len(ids) >= 443


def ordered_chunk_results(windows, process, workers):
    """Bound in-flight work and restore source order before any reconciliation."""
    if workers == 1:
        for item in enumerate(windows): yield process(item)
        return
    from concurrent.futures import ThreadPoolExecutor
    iterator=iter(enumerate(windows))
    with ThreadPoolExecutor(max_workers=workers,thread_name_prefix='tara-chunk') as pool:
        pending=[]
        for _ in range(workers):
            item=next(iterator,None)
            if item is not None:pending.append(pool.submit(process,item))
        try:
            while pending:
                result=pending.pop(0).result()
                yield result
                item=next(iterator,None)
                if item is not None:pending.append(pool.submit(process,item))
        finally:
            for future in pending:future.cancel()


def recognize(root, request, emit):
    from audio import read_prepared
    from hardware import Metrics
    from experimental_chunks import audio_chunks
    from models import model_dir
    metrics, started = Metrics(), time.perf_counter()
    try:
        if not native_ready(root):
            raise ValueError('Tara mixed-code native runtime is missing')
        audio = request['prepared']; samples = read_prepared(audio['audioPath'])
        if not len(samples) or abs(len(samples)/16000-audio['duration']) > 1/16000:
            raise ValueError('Prepared audio duration mismatch')
        speech_aware=request.get('taraChunking') == 'speech-aware'
        if request.get('taraChunking') not in (None,'standard','speech-aware'):
            raise ValueError('Unsupported Tara chunking mode')
        from tara_chunking import validate_plan, stitch_chunks, STRATEGY
        plan=validate_plan(request.get('chunkPlan') or {},len(samples)) if speech_aware else None
        if speech_aware:
            speech=request['chunkPlan'].get('speechIntervals')
            if not isinstance(speech,list):
                raise ValueError('Speech-aware word timing requires detected speech intervals')
            previous=0
            for s in speech:
                a,b=s.get('start'),s.get('end')
                if type(a) is not int or type(b) is not int or not previous<=a<b<=len(samples):
                    raise ValueError('Invalid speech-aware alignment intervals')
                previous=b
        requested_workers=request.get('chunkWorkers',1)
        if type(requested_workers) is not int or requested_workers not in (1,2) or (requested_workers==2 and not speech_aware):
            raise ValueError('Parallel chunks require speech-aware mode and one or two workers')
        workers=min(requested_workers,len(plan)) if plan else 1
        threads=2 if workers==2 else 4
        ct2, handles = activate_runtime()
        import torch
        torch.set_num_threads(threads)
        torch.set_num_interop_threads(1)
        emit('progress', {'stage':'loading','message':f'Loading Tara CPU: {workers} chunk worker(s), {threads} threads each'})
        processor, model = validate(model_dir(root, 'tara-int8'), ct2,intra_threads=threads,inter_threads=workers)
        loaded = time.perf_counter()
        timing = request.get('wordTimestamps') is True or speech_aware
        chunks, words, warnings, alignment_sec = [], [], [], 0
        warnings.append('Experimental Tara attention/DTW word timing; uncertain native intervals are retained for review. Input ranges are not speech timestamps.' if timing else 'Experimental Tara INT8; no word or subtitle timestamps requested. Input ranges are not speech timestamps.')
        windows=[(c['inputStart'],c['inputEnd'],samples[c['inputStart']:c['inputEnd']]) for c in plan] if plan else audio_chunks(samples,maximum_seconds=30)
        def process_window(item):
            index,(start,end,chunk)=item
            aligned = {'offset':start/16000} if timing else None
            if timing and speech_aware:
                aligned['speech'] = [{'start':max(start,s['start'])-start,'end':min(end,s['end'])-start}
                    for s in request['chunkPlan']['speechIntervals'] if min(end,s['end'])>max(start,s['start'])]
            if timing:
                text,ids,capped = generate_chunk(model,processor,chunk,ct2,aligned)
            else:
                text, ids, capped = generate_chunk(model, processor, chunk, ct2)
            return index,start,end,text,ids,capped,aligned
        emit('progress', {'stage':'transcribing','message':f'Recognizing and aligning with {workers} chunk worker(s)'})
        for index,start,end,text,ids,capped,aligned in ordered_chunk_results(windows,process_window,workers):
            if timing:
                words.extend(aligned['words']); warnings.extend(aligned['warnings']); alignment_sec+=aligned['seconds']
            chunks.append({'inputStartSec':start/16000,'inputEndSec':end/16000,'text':text,'tokenIds':ids})
            if timing: chunks[-1]['wordAlignment'] = aligned['raw']
            if speech_aware:
                c=plan[index]
                chunks[-1].update({'coreStartSec':c['coreStart']/16000,'coreEndSec':c['coreEnd']/16000,
                    'boundaryReason':c['boundaryReason'],'words':aligned['words']})
            if capped: warnings.append(f'Decoder token limit on input {start/16000:.2f}–{end/16000:.2f} s; text may be incomplete.')
            emit('progress', {'stage':'transcribing','completed':end/16000,'total':audio['duration'],'message':text or 'No text returned'})
        text=' '.join(c['text'].strip() for c in chunks if c['text'].strip())
        reconciliation=[]
        if speech_aware:
            text,words,reconciliation=stitch_chunks(chunks)
            warnings.append('Experimental speech-aware chunking and word timing use VAD speech boundaries; no recognition audio or pauses are removed. Ambiguous native word times are retained for manual adjustment. Raw chunk outputs and alignment adjustments are preserved.')
            warnings.extend(f"Boundary at {d['atSec']:.2f} s: {d['message']}" for d in reconciliation if d['status']=='ambiguous')
        finished = time.perf_counter(); preparation = request.get('preparationSec',0)
        metadata = metrics.finish()
        metadata.update({'processingSec':finished-started+preparation,'inferenceSec':finished-loaded,'modelLoadSec':loaded-started,
            'audioPreparationSec':preparation,'audioDurationSec':audio['duration'],'realTimeFactor':(finished-started+preparation)/audio['duration'],
            'device':'cpu','requestedDevice':'cpu','computeType':model.compute_type,'cpuThreads':threads*workers,
            'fallback':'Only one input chunk; using one worker with four threads.' if requested_workers==2 and workers==1 else None,'model':'tara-int8',
            'chunkWorkers':workers,'requestedChunkWorkers':requested_workers,'threadsPerWorker':threads,
            'chunkScheduling':'parallel-2x2' if workers==2 else 'sequential-1x4',
            'alignmentTiming':'sum-of-chunk-wall-times',
            'languageHint':'hi+mixedcode','vad':False,'vadSilenceMs':None,'wordTimestamps':timing,
            'wordTimestampsAvailable':any(w['startTime'] is not None and w['endTime'] is not None for w in words),'coldWorker':True,
            'alignmentSec':alignment_sec,'wordTimingSource':'tara-attention-dtw' if timing else None,
            'chunkingStrategy':STRATEGY if speech_aware else 'standard',
            'chunkPlanningSec':request.get('chunkPlanningSec',0),
            'processedInputSec':sum(c['inputEndSec']-c['inputStartSec'] for c in chunks),
            'runtimeVersions':{**tara.VERSIONS,'ctranslate2':VERSION,'taraNativePatch':PROFILE['nativePatch'],
                               'taraNativeOptimization':native_optimization(root)},
            'modelRepository':tara.ASSETS['repo'],'modelRevision':tara.ASSETS['revision'],'decodeWindowSec':30,'processedAudioSec':len(samples)/16000,
            'inputChunkCount':len(chunks),'conditionOnPreviousText':False,'warnings':warnings})
        return {'id':str(uuid.uuid4()),'model':'tara-int8','source':audio,'language':'hi','languageProbability':None,
            'text':text,'words':words,'segments':[],
            'processingMetadata':metadata,'rawResponse':{'inputChunks':chunks,'decoderPrefix':list(tara.TOKENS.values()),
                'chunkPlan':request.get('chunkPlan') if speech_aware else None,'boundaryReconciliation':reconciliation}}
    finally:
        if not metrics.stop_event.is_set(): metrics.finish()


def align_saved(root, request, emit):
    """Align saved token IDs without calling generate() or altering its text."""
    import copy
    from audio import read_prepared
    from hardware import Metrics
    from models import model_dir
    from tara_alignment import align_words
    prior = request.get('priorResult',{})
    audio = request['prepared']
    if prior.get('model') != 'tara-int8' or prior.get('source',{}).get('audioSha256') != audio['audioSha256']:
        raise ValueError('Saved Tara result does not match the prepared audio')
    if prior.get('processingMetadata',{}).get('modelRevision',tara.ASSETS['revision']) != tara.ASSETS['revision']:
        raise ValueError('Saved Tara result uses a different checkpoint revision')
    chunks = prior.get('rawResponse',{}).get('inputChunks',[])
    if not chunks or prior.get('text') != ' '.join(c['text'].strip() for c in chunks if c['text'].strip()):
        raise ValueError('Saved Tara chunk text is incomplete or was edited')
    cursor=0
    for c in chunks:
        start,end=c.get('inputStartSec'),c.get('inputEndSec')
        ids=c.get('tokenIds')
        if not isinstance(start,(int,float)) or not isinstance(end,(int,float)) or not math.isfinite(start) or not math.isfinite(end):
            raise ValueError('Invalid saved chunk boundaries')
        if abs(start-cursor)>1/16000 or not start<end<=audio['duration']+1/16000 or end-start>30+1/16000:
            raise ValueError('Saved input chunks must cover the original audio contiguously')
        if not isinstance(ids,list) or len(ids)>448 or any(type(t) is not int or not 0<=t<51904 for t in ids):
            raise ValueError('Saved Tara token IDs are unavailable or invalid')
        cursor=end
    if abs(cursor-audio['duration'])>1/16000:
        raise ValueError('Saved chunks do not cover the full prepared audio')
    metrics,started=Metrics(),time.perf_counter()
    try:
        ct2,handles=activate_runtime()
        import torch
        import numpy as np
        torch.set_num_threads(4);torch.set_num_interop_threads(1)
        processor,model=validate(model_dir(root,'tara-int8'),ct2)
        samples=read_prepared(audio['audioPath'])
        if abs(len(samples)/16000-audio['duration'])>1/16000:
            raise ValueError('Prepared audio duration mismatch')
        # Validate every chunk before doing any alignment.
        for c in chunks:
            if processor.tokenizer.decode(c['tokenIds'],skip_special_tokens=True) != c['text']:
                raise ValueError('Saved token IDs do not reproduce the original chunk text')
        loaded=time.perf_counter()
        result=copy.deepcopy(prior);words=[];warnings=[]
        for c in result['rawResponse']['inputChunks']:
            start,end=c['inputStartSec'],c['inputEndSec']
            emit('progress',{'stage':'aligning','completed':start,'total':audio['duration'],'message':f'Aligning saved Tara words: {start:.1f}–{end:.1f} s'})
            chunk=samples[round(start*16000):round(end*16000)]
            features=processor(chunk,sampling_rate=16000,return_tensors='np').input_features
            encoded=model.encode(ct2.StorageView.from_array(np.ascontiguousarray(features,dtype=np.float32)))
            try:
                aligned,raw,notes=align_words(model,processor,encoded,chunk,c['tokenIds'],start)
            except (ValueError,RuntimeError,IndexError,MemoryError) as error:
                import re
                aligned=[{'text':w,'startTime':None,'endTime':None,'confidence':None} for w in re.findall(r'\s*\S+',c['text'])]
                raw={'error':str(error)};notes=[f'Alignment unavailable at {start:.2f} s: {error}']
            words.extend(aligned);warnings.extend(notes);c['wordAlignment']=raw
        finished=time.perf_counter();measurements=metrics.finish()
        result.update({'id':str(uuid.uuid4()),'words':words})
        result['processingMetadata'].update({'wordTimestamps':True,'wordTimestampsAvailable':any(w['startTime'] is not None for w in words),
            'wordTimingSource':'tara-attention-dtw','alignmentSec':finished-loaded,'alignmentJobSec':finished-started+request.get('preparationSec',0),
            'alignmentModelLoadSec':loaded-started,'alignmentPeakRamBytes':measurements['peakRamBytes'],'alignedFromRunId':prior['id'],
            'warnings':warnings+['Saved transcript aligned without rerunning recognition. Original recognition metrics are retained; alignment cost is reported separately.']})
        return result
    finally:
        if not metrics.stop_event.is_set():metrics.finish()


if __name__ == '__main__':
    from worker import emit
    try:
        root = Path(sys.argv[1])
        os.environ['HF_HUB_OFFLINE'] = '1'; os.environ['TRANSFORMERS_OFFLINE'] = '1'
        if len(sys.argv)>2 and sys.argv[2]=='convert':
            convert(root)
        else:
            import contextlib
            request = json.load(sys.stdin)
            with contextlib.redirect_stdout(sys.stderr):
                recognize_request = align_saved if request.get('action') == 'tara_align' else recognize
                result = recognize_request(root, request, lambda kind,data: print(json.dumps({'type':kind,'data':data},ensure_ascii=False),file=sys.__stdout__,flush=True))
            emit('result',result)
    except Exception as error:
        import traceback
        traceback.print_exc(file=sys.stderr); emit('error',{'message':f'Tara INT8: {type(error).__name__}: {error}'}); sys.exit(1)
