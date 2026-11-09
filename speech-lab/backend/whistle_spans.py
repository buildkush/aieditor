"""Lab-only English-phrase crops; retain raw context responses and source offsets."""
import contextlib
import math
import sys
import time
import uuid
import wave
from audio import prepare
from models import installed
from hardware import Metrics
from whistle_runtime import initialize, ASSETS
from shruti_transcription import normalize_response, keywords_from_request


def validate_spans(request, duration):
    context = request.get('contextSec', .12)
    if isinstance(context, bool) or not isinstance(context, (int, float)) or not math.isfinite(context) or not 0 <= context <= .5:
        raise ValueError('Audio context must be between 0 and 0.5 seconds')
    spans = request.get('spans')
    if not isinstance(spans, list) or not 0 < len(spans) <= 5000:
        raise ValueError('Select between 1 and 5000 timed English spans')
    ids, previous = set(), 0
    for span in spans:
        if not isinstance(span, dict) or span.get('language') != 'english' or not isinstance(span.get('id'), str) or not span['id'] or span['id'] in ids:
            raise ValueError('Only distinct English spans can be sent to Whistle')
        start, end = span.get('startTime'), span.get('endTime')
        if any(isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) for value in (start, end)) or not 0 <= previous <= start < end <= duration:
            raise ValueError('English spans must be ordered, nonoverlapping and inside the audio')
        ids.add(span['id']); previous = end
    return spans, context


def transcribe(root, request, emit):
    import numpy as np
    started = time.perf_counter()
    keywords = keywords_from_request(request)
    audio = prepare(root, request['path'], emit)
    if audio['audioSha256'] != request.get('audioSha256'):
        raise ValueError('Prepared audio changed; recognize it again before span processing')
    spans, context = validate_spans(request, audio['duration'])
    if not installed(root, 'whistle'):
        raise ValueError('Download or repair Whistle first')
    prepared = time.perf_counter()
    metrics = Metrics()
    try:
        model = initialize(root, emit)
        loaded = time.perf_counter()
        hypotheses = []
        with wave.open(audio['audioPath'], 'rb') as source:
            if (source.getnchannels(), source.getsampwidth(), source.getframerate()) != (1, 2, 16000):
                raise ValueError('Expected prepared mono 16 kHz PCM audio')
            for index, span in enumerate(spans):
                emit('progress', {'stage': 'transcribing', 'message': f"Whistle English phrase {index + 1} of {len(spans)}", 'completed': index, 'total': len(spans)})
                first = max(0, math.floor((span['startTime'] - context) * 16000))
                last = min(source.getnframes(), math.ceil((span['endTime'] + context) * 16000))
                source.setpos(first)
                samples = np.frombuffer(source.readframes(last - first), dtype='<i2').astype(np.float32) / 32768
                before = time.perf_counter()
                entry = {'spanId': span['id'], 'cropStart': first / 16000, 'cropEnd': last / 16000, 'text': '', 'words': [], 'rawResponse': {}}
                try:
                    with contextlib.redirect_stdout(sys.stderr):
                        raw = model.transcribe(samples, language='en', word_timestamps=True, keywords=keywords or None)
                    entry['rawResponse'] = raw
                    result = normalize_response(raw)
                    shifted = []
                    for word in result['words']:
                        if word['endTime'] is not None and word['endTime'] > len(samples) / 16000 + .1:
                            raise ValueError('Whistle word exceeds its audio crop')
                        shifted.append({**word, 'startTime': word['startTime'] + first / 16000 if word['startTime'] is not None else None,
                                        'endTime': word['endTime'] + first / 16000 if word['endTime'] is not None else None})
                    entry.update(text=result['text'], words=shifted)
                except (ValueError, RuntimeError) as error:
                    entry['error'] = str(error)
                entry['inferenceSec'] = time.perf_counter() - before
                hypotheses.append(entry)
        ended = time.perf_counter()
        measurements = metrics.finish()
        measurements.update(model='whistle', modelRepository=ASSETS['repo'], modelRevision=ASSETS['revision'], processingSec=ended-started,
            modelLoadSec=loaded-prepared, inferenceSec=ended-loaded, audioPreparationSec=prepared-started, audioDurationSec=audio['duration'],
            realTimeFactor=(ended-started)/audio['duration'], device='cpu', computeType='Quantized Needle CPU', requestedDevice='auto', fallback=None,
            languageHint='en', vad=False, vadSilenceMs=None, wordTimestamps=True, coldWorker=True, keywords=keywords)
        return {'id': str(uuid.uuid4()), 'source': audio, 'hypotheses': hypotheses, 'contextSec': context, 'processingMetadata': measurements}
    finally:
        if not metrics.stop_event.is_set(): metrics.finish()
