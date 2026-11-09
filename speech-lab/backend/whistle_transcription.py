"""Speech Lab only. No production-caption entry point calls this adapter."""
import contextlib
import sys
import time
import uuid
from audio import prepare
from hardware import Metrics
from models import installed
from shruti_transcription import normalize_response, keywords_from_request
from whistle_runtime import initialize, ASSETS


def transcribe(root, request, emit):
    if not installed(root, 'whistle'):
        raise ValueError('Download or repair Whistle before transcription')
    keywords = keywords_from_request(request)
    metrics = Metrics()
    try:
        started = time.perf_counter()
        audio = prepare(root, request['path'], emit)
        prepared = time.perf_counter()
        model = initialize(root, emit)
        loaded = time.perf_counter()
        emit('progress', {'stage': 'transcribing', 'message': 'Whistle English recognition locally'})
        with contextlib.redirect_stdout(sys.stderr):
            raw = model.transcribe(audio['audioPath'], language='en', word_timestamps=True, keywords=keywords or None)
        ended = time.perf_counter()
        result = normalize_response(raw)
        measurements = metrics.finish()
        measurements.update(processingSec=ended-started, audioPreparationSec=prepared-started, modelLoadSec=loaded-prepared,
            inferenceSec=ended-loaded, audioDurationSec=audio['duration'], realTimeFactor=(ended-started)/audio['duration'],
            model='whistle', modelRepository=ASSETS['repo'], modelRevision=ASSETS['revision'], device='cpu', requestedDevice='auto',
            computeType='Quantized Needle CPU', fallback=None, languageHint='en', vad=False, vadSilenceMs=None,
            wordTimestamps=True, wordTimestampsAvailable=any(w['startTime'] is not None for w in result['words']), coldWorker=True, keywords=keywords)
        return {**result, 'id': str(uuid.uuid4()), 'model': 'whistle', 'source': audio, 'processingMetadata': measurements}
    finally:
        if not metrics.stop_event.is_set(): metrics.finish()
