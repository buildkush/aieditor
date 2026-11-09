"""Public needle.Whistle adapter. Native text and the entire response are preserved."""
import contextlib
from importlib.metadata import version
import math
import sys
import time
import uuid
from audio import prepare
from hardware import Metrics
from models import installed
from shruti_runtime import ASSETS, initialize


def keywords_from_request(request):
    values = request.get('keywords') or []
    if not isinstance(values, list) or len(values) > 100 or any(not isinstance(value, str) or len(value) > 200 for value in values):
        raise ValueError('Shruti keywords must be a list of up to 100 words or phrases (200 characters each)')
    return [value.strip() for value in values if value.strip()]


def normalize_response(response):
    # Verified against cactus-needle 3.2.10's public Whistle.transcribe docstring
    # and show_transcript: {text, language, ttft_ms, decode_tps, words?}; each
    # word has {word, start, end, probability}. It supplies no segment bounds.
    if not isinstance(response, dict) or not isinstance(response.get('text'), str):
        raise ValueError('Shruti returned an invalid transcript response')
    words = response.get('words')
    if words is None:
        words = []
    if not isinstance(words, list):
        raise ValueError('Shruti returned invalid word timestamps')
    normalized = []
    for word in words:
        if not isinstance(word, dict) or not isinstance(word.get('word'), str):
            raise ValueError('Shruti returned an invalid word')
        start, end = word.get('start'), word.get('end')
        if start is not None or end is not None:
            if not all(isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) for value in (start, end)) or not 0 <= start <= end:
                raise ValueError('Shruti returned invalid word times; no timestamps have been synthesized')
        probability = word.get('probability')
        if probability is not None and (not isinstance(probability, (int, float)) or not math.isfinite(probability) or not 0 <= probability <= 1):
            raise ValueError('Shruti returned an invalid word probability')
        normalized.append({'text': word['word'], 'startTime': start, 'endTime': end, 'confidence': probability})
    language = response.get('language')
    if language is not None and not isinstance(language, str):
        raise ValueError('Shruti returned an invalid detected language')
    return {'text': response['text'], 'language': language, 'languageProbability': None,
            'segments': [], 'words': normalized, 'rawResponse': response}


def transcribe(root, request, emit, prepared_audio=None, preserve_timeline_silence=False):
    if not installed(root, 'shruti'):
        raise ValueError('Download or Verify / repair Shruti before transcription')
    keywords = keywords_from_request(request)
    metrics = Metrics()
    try:
        started = time.perf_counter()
        audio = prepared_audio if prepared_audio is not None else prepare(root, request['path'], emit)
        prepared = time.perf_counter()
        model = initialize(root, emit)
        loaded = time.perf_counter()
        emit('progress', {'stage': 'transcribing', 'message': 'Shruti is recognizing speech locally; cancel to stop'})
        # No language hint, romanization, punctuation or rewriting. Caption jobs
        # use the existing local VAD to anchor sections before calling Shruti.
        # The already prepared mono 16 kHz WAV needs no extra decoder/resampler.
        with contextlib.redirect_stdout(sys.stderr):
            if preserve_timeline_silence:
                from caption_audio import transcribe_timeline
                raw = transcribe_timeline(model, audio['audioPath'], keywords, emit)
            else:
                raw = model.transcribe(audio['audioPath'], word_timestamps=True, keywords=keywords or None)
        finished = time.perf_counter()
        result = normalize_response(raw)
        measurements = metrics.finish()
        measurements.update({'processingSec': finished - started, 'audioPreparationSec': prepared - started,
            'modelLoadSec': loaded - prepared, 'inferenceSec': finished - loaded,
            'realTimeFactor': (finished - started) / audio['duration'], 'audioDurationSec': audio['duration'],
            'device': 'cpu', 'computeType': 'INT4 weights / INT8 activations', 'requestedDevice': 'auto', 'fallback': None,
            'model': 'shruti', 'modelRepository': ASSETS['modelRepo'], 'modelRevision': ASSETS['modelRevision'],
            'engineRepository': ASSETS['engineRepo'], 'engineRevision': ASSETS['engineRevision'],
            'runtimeVersions': {'python': sys.version.split()[0], 'cactusNeedle': version('cactus-needle'), 'needleEngine': ASSETS['engineVersion']},
            'languageHint': 'auto', 'vad': preserve_timeline_silence,
            'vadSilenceMs': 600 if preserve_timeline_silence else None, 'wordTimestamps': True,
            'wordTimestampsAvailable': any(word['startTime'] is not None for word in result['words']),
            'coldWorker': True, 'keywords': keywords,
            'silenceSegmentation': 'silero-source-offsets' if preserve_timeline_silence else None,
            'audioSections': len(raw['chunks']) if preserve_timeline_silence else None})
        return {**result, 'id': str(uuid.uuid4()), 'model': 'shruti', 'source': audio, 'processingMetadata': measurements}
    finally:
        if not metrics.stop_event.is_set():
            metrics.finish()
