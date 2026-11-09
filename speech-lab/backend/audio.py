"""Read-only input, streaming FFmpeg/PyAV decode to a reusable mono 16 kHz PCM cache."""
import hashlib
import json
import os
from pathlib import Path
import time
import wave


def read_prepared(path):
    import numpy as np
    with wave.open(str(path), 'rb') as audio:
        if (audio.getnchannels(), audio.getsampwidth(), audio.getframerate()) != (1, 2, 16000):
            raise ValueError('Expected prepared mono 16 kHz PCM audio')
        return np.frombuffer(audio.readframes(audio.getnframes()), dtype='<i2').astype(np.float32) / 32768.0


def prepare(root, source_path, emit):
    import av
    source = Path(source_path).resolve(strict=True)
    if not source.is_file():
        raise ValueError('Select an audio or video file')
    # v2 preserves presentation-time gaps. Never reuse a v1 WAV that may have
    # concatenated sparse packets and pulled later speech forward in time.
    fingerprint = hashlib.sha256(f'pcm-timeline-v2|{source}|{source.stat().st_size}|{source.stat().st_mtime_ns}'.encode()).hexdigest()
    cache = Path(root) / 'audio'
    cache.mkdir(parents=True, exist_ok=True)
    audio_path, metadata_path = cache / f'{fingerprint}.wav', cache / f'{fingerprint}.json'
    if audio_path.exists() and metadata_path.exists():
        return json.loads(metadata_path.read_text(encoding='utf-8'))
    temp = cache / f'{fingerprint}.{os.getpid()}.part'
    frames_written, last_emit = 0, 0
    try:
        with av.open(str(source)) as media:
            if not media.streams.audio:
                raise ValueError('This media has no audio stream')
            stream = media.streams.audio[0]
            origin = float(media.start_time / av.time_base) if media.start_time is not None else 0
            estimate = float(stream.duration * stream.time_base) if stream.duration is not None else (media.duration / av.time_base if media.duration else None)
            resampler = av.AudioResampler(format='s16', layout='mono', rate=16000)
            with wave.open(str(temp), 'wb') as output:
                output.setnchannels(1)
                output.setsampwidth(2)
                output.setframerate(16000)
                def write_mono(mono):
                    nonlocal frames_written
                    at = round((float(mono.pts * mono.time_base) - origin) * 16000) if mono.pts is not None and mono.time_base is not None else frames_written
                    # Media timestamps, not the number of decoded samples, own
                    # the source clock. Sparse audio packets can hide seconds of
                    # silence; represent those seconds as PCM zeros in the cache.
                    missing = max(0, at - frames_written)
                    while missing:
                        block = min(missing, 16000)
                        output.writeframesraw(b'\0\0' * block)
                        frames_written += block
                        missing -= block
                    skip = max(0, frames_written - at)
                    if skip < mono.samples:
                        output.writeframesraw(mono.to_ndarray().reshape(-1)[skip:].tobytes())
                        frames_written += mono.samples - skip
                for frame in media.decode(stream):
                    for mono in resampler.resample(frame):
                        write_mono(mono)
                    if time.monotonic() - last_emit > 0.2:
                        last_emit = time.monotonic()
                        emit('progress', {'stage': 'audio', 'completed': frames_written / 16000,
                                          'total': estimate, 'message': 'Preparing mono 16 kHz audio'})
                for mono in resampler.resample(None):
                    write_mono(mono)
        if not frames_written:
            raise ValueError('No decodable audio samples found')
        os.replace(temp, audio_path)
        with audio_path.open('rb') as audio:
            digest = hashlib.file_digest(audio, 'sha256').hexdigest()
        result = {'path': str(source), 'name': source.name, 'duration': frames_written / 16000,
                  'audioPath': str(audio_path), 'audioSha256': digest, 'sampleRate': 16000}
        from models import write_json
        write_json(metadata_path, result)
        return result
    finally:
        if temp.exists():
            temp.unlink()
