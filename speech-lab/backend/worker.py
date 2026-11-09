"""One request per process; stdout is NDJSON, stderr is diagnostic text. Kill cancels any native call."""
import json
import os
from pathlib import Path
import sys
import traceback

for stream in (sys.stdin, sys.stdout, sys.stderr):
    if hasattr(stream, 'reconfigure'):
        stream.reconfigure(encoding='utf-8')


def emit(kind, data):
    print(json.dumps({'type': kind, 'data': data}, ensure_ascii=False, allow_nan=False), flush=True)


def main():
    root = Path(sys.argv[1]).resolve()
    root.mkdir(parents=True, exist_ok=True)
    os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
    os.environ['NEEDLE_TELEMETRY'] = '0'
    request = json.load(sys.stdin)
    from models import catalog, download, remove
    action = request.get('action')
    if action == 'catalog':
        from tested_cpu import catalog as cpu_catalog
        result = catalog(root, bool(request.get('online', False))) + cpu_catalog(root)
    elif action == 'hardware':
        from hardware import detect
        result = detect()
    elif action == 'download':
        result = download(root, request['model'], emit)
    elif action == 'remove':
        result = remove(root, request['model'])
    elif action == 'prepare':
        from audio import prepare
        result = prepare(root, request['path'], emit)
    elif action == 'caption_status':
        from auto_captions import status
        result = status(root,request)
    elif action == 'auto_captions':
        from auto_captions import generate
        generate(root,request,emit)
        return
    elif action == 'whistle_spans':
        from whistle_spans import transcribe
        os.environ['HF_HUB_OFFLINE'] = '1'
        result = transcribe(root, request, emit)
    elif action == 'tara_align':
        from tara_int8 import transcribe
        if request.get('model') != 'tara-int8':
            raise ValueError('Only Tara INT8 saved results support this alignment action')
        transcribe(root, request, emit)
        return
    elif action == 'transcribe':
        if request.get('model') == 'tara-int8-speech-aware-parallel':
            from tara_int8 import transcribe
            profile=request['model']
            def emit_variant(kind, data):
                if kind == 'result':
                    data['model'] = profile
                    data['processingMetadata']['model'] = profile
                emit(kind,data)
            transcribe(root, {**request,'model':'tara-int8','taraChunking':'speech-aware','wordTimestamps':True,
                'chunkWorkers':2}, emit_variant)
            return
        if request.get('model') in ('shunya-int8',):
            from tested_cpu import transcribe
            transcribe(root, request, emit)
            return
        if request.get('model') == 'whistle':
            from whistle_transcription import transcribe
        elif request.get('model') == 'shruti':
            from shruti_transcription import transcribe
        else:
            raise ValueError('Unsupported Speech Lab model')
        # All runtime assets must be present locally. Transcription never initiates downloads.
        os.environ['HF_HUB_OFFLINE'] = '1'
        result = transcribe(root, request, emit)
    elif action == 'initialize' and request.get('model') == 'shruti':
        from shruti_runtime import initialize, ASSETS
        initialize(root, emit)
        result = {'model': 'shruti', 'initialized': True, 'modelRevision': ASSETS['modelRevision'],
                  'engineRevision': ASSETS['engineRevision'], 'packageVersion': ASSETS['packageVersion']}
    else:
        raise ValueError('Unsupported Speech Lab action')
    emit('result', result)


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        traceback.print_exc(file=sys.stderr)
        message = f'{type(exc).__name__}: {exc}'
        if isinstance(exc, MemoryError) or any(term in str(exc).lower() for term in ('out of memory', 'bad_alloc', 'failed to allocate')):
            message += ' — Not enough memory. Close other applications and retry.'
        if isinstance(exc, ImportError):
            message += ' — Run scripts/setup-speech-lab.ps1 to install the local runtime dependencies.'
        emit('error', {'message': message})
        sys.exit(1)
