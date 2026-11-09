"""Anchor caption recognition sections to the original PCM clock across silence.

Reuse the already installed Silero VAD; Shruti remains the only ASR model.
Never concatenate audio across a gap or infer word timing from text length.
"""
import math
import wave

RATE = 16000


def speech_regions(path):
    """Return original sample positions, never positions in concatenated speech."""
    import onnxruntime
    onnxruntime.disable_telemetry_events()
    from faster_whisper.vad import VadOptions, get_speech_timestamps
    from audio import read_prepared
    samples = read_prepared(path)
    regions = get_speech_timestamps(samples, vad_options=VadOptions(
        threshold=.35, neg_threshold=.2, min_speech_duration_ms=0,
        min_silence_duration_ms=600, speech_pad_ms=80, max_speech_duration_s=28), sampling_rate=RATE)
    # Validate detector bounds before any model call. No silent fallback to
    # whole-file decoding: that would hide a failure and reintroduce compressed gaps.
    previous_end = 0
    result = []
    for region in regions:
        start, end = region['start'], region['end']
        if not 0 <= previous_end <= start < end <= len(samples):
            raise ValueError('Speech detection returned invalid audio section bounds')
        result.append((int(start), int(end)))
        previous_end = end
    return result


def transcribe_timeline(model, path, keywords, emit):
    """Keep each native response; offset local word times by its source start."""
    import numpy as np
    emit('progress', {'stage': 'transcribing', 'message': 'Detecting speech sections and preserving timeline gaps'})
    regions = speech_regions(path)
    chunks, texts, words, language = [], [], [], None
    with wave.open(str(path), 'rb') as source:
        for index, (start, end) in enumerate(regions):
            emit('progress', {'stage': 'transcribing', 'completed': index, 'total': len(regions),
                              'message': f'Recognizing audio section {index + 1} of {len(regions)}'})
            source.setpos(start)
            samples = np.frombuffer(source.readframes(end - start), dtype='<i2').astype(np.float32) / 32768
            response = model.transcribe(samples, word_timestamps=True, keywords=keywords or None)
            if not isinstance(response, dict) or not isinstance(response.get('text'), str):
                raise ValueError('Shruti returned an invalid transcript response')
            chunks.append({'startTime': start / RATE, 'endTime': end / RATE, 'response': response})
            texts.append(response['text'])
            language = language or response.get('language')
            native_words = response.get('words')
            if native_words is None:
                native_words = []
            if not isinstance(native_words, list):
                raise ValueError('Shruti returned invalid word timestamps')
            for word in native_words:
                if not isinstance(word, dict):
                    raise ValueError('Shruti returned an invalid word')
                shifted = dict(word)
                for key in ('start', 'end'):
                    value = word.get(key)
                    if value is not None:
                        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 <= value <= len(samples) / RATE + .1:
                            raise ValueError('Shruti returned word times outside the recognized audio section')
                        shifted[key] = value + start / RATE
                words.append(shifted)
    return {'text': ' '.join(texts), 'language': language, 'words': words,
            'timing': 'source-audio-sections', 'chunks': chunks}
