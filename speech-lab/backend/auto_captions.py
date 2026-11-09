"""Production captions: Tara by default, Shruti only for explicit Quick mode."""
import os
import time


def quick_mode(request):
    quick=request.get('quickMode',False)
    if type(quick) is not bool:
        raise ValueError('Quick mode must be a boolean')
    return quick


def status(root, request):
    from models import catalog
    model='shruti' if quick_mode(request) else 'tara-int8-speech-aware-parallel'
    return next(row for row in catalog(root) if row['id']==model)


def generate(root, request, emit):
    from project_audio import prepare_project_audio
    quick=quick_mode(request)
    model=status(root,request)
    if not model['installed'] or model.get('runtimeInstalled') is False:
        raise ValueError('Set up '+('Quick mode' if quick else 'Tara')+' before generating captions')
    started=time.perf_counter()
    os.environ['HF_HUB_OFFLINE']='1'
    audio=prepare_project_audio(root,request.get('plan'),emit)
    preparation=time.perf_counter()-started
    if quick:
        from shruti_transcription import transcribe
        result=transcribe(root,{'model':'shruti','keywords':[]},emit,
                          prepared_audio=audio,preserve_timeline_silence=True)
        result['processingMetadata']['audioPreparationSec']+=preparation
        result['processingMetadata']['processingSec']+=preparation
        result['processingMetadata']['realTimeFactor']=result['processingMetadata']['processingSec']/audio['duration']
        emit('result',result)
    else:
        from tara_int8 import transcribe
        def forward(kind,data):
            if kind=='result':
                data['model']='tara-int8-speech-aware-parallel'
                data['processingMetadata']['model']=data['model']
            emit(kind,data)
        transcribe(root,{'model':'tara-int8','taraChunking':'speech-aware','chunkWorkers':2,
                         'wordTimestamps':True},forward,prepared_audio=audio,preparation_sec=preparation)
