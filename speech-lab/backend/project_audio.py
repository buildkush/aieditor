"""Read-only ProjectState audio plan -> cached timeline-aligned mono 16 kHz WAV."""
from fractions import Fraction
import hashlib
import json
import math
import os
from pathlib import Path
import wave
from audio import prepare

RATE = 16000


def number(value, label, minimum=0, maximum=86400):
    if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value) or not minimum <= value <= maximum:
        raise ValueError(f'Invalid project audio {label}')
    return value


def validate_plan(plan):
    if not isinstance(plan, dict) or not isinstance(plan.get('projectId'), str) or not plan['projectId']:
        raise ValueError('Auto captions require an active project')
    clips = plan.get('clips')
    if not isinstance(clips, list) or not 0 < len(clips) <= 10000:
        raise ValueError('The project has no audible audio clips')
    duration = number(plan.get('duration'), 'duration', .001)
    for clip in clips:
        if not isinstance(clip, dict) or not isinstance(clip.get('path'), str) or not Path(clip['path']).is_file():
            raise ValueError('A project audio source is missing; relink the media before generating captions')
        start = number(clip.get('startTime'), 'clip start')
        length = number(clip.get('duration'), 'clip duration', .001)
        if start + length > duration + .001:
            raise ValueError('Project audio clip exceeds the timeline duration')
        source_in = number(clip.get('sourceIn'), 'source in')
        source_out = number(clip.get('sourceOut'), 'source out')
        if source_out <= source_in: raise ValueError('Invalid project audio source range')
        number(clip.get('speed'), 'speed', .25, 4)
        gain = clip.get('gain')
        if not isinstance(gain, list) or not 1 <= len(gain) <= 1_000_001: raise ValueError('Invalid project audio gain envelope')
        previous = -1
        for point in gain:
            if not isinstance(point, list) or len(point) != 2: raise ValueError('Invalid project audio gain point')
            at = number(point[0], 'gain time', 0, length)
            number(point[1], 'gain', 0, 10000)
            if at < previous: raise ValueError('Unordered project audio gain envelope')
            previous = at
    return clips, duration


def change_tempo(samples, speed):
    """Use existing PyAV/FFmpeg atempo for forward HTML-audio pitch preservation."""
    import av
    import numpy as np
    if speed == 1 or not len(samples): return samples
    graph = av.filter.Graph()
    source = graph.add_abuffer(sample_rate=RATE, format='fltp', layout='mono', time_base=Fraction(1, RATE))
    previous, remaining = source, speed
    factors = []
    while remaining > 2: factors.append(2); remaining /= 2
    while remaining < .5: factors.append(.5); remaining /= .5
    factors.append(remaining)
    for factor in factors:
        node = graph.add('atempo', str(factor)); previous.link_to(node); previous = node
    sink = graph.add('abuffersink'); previous.link_to(sink); graph.configure()
    output = []
    def drain():
        while True:
            try: output.append(sink.pull().to_ndarray().reshape(-1))
            except (av.error.BlockingIOError, av.error.EOFError): break
    for offset in range(0, len(samples), 4096):
        frame = av.AudioFrame.from_ndarray(samples[offset:offset + 4096].reshape(1, -1), format='fltp', layout='mono')
        frame.sample_rate, frame.pts, frame.time_base = RATE, offset, Fraction(1, RATE)
        source.push(frame); drain()
    source.push(None); drain()
    return np.concatenate(output) if output else np.zeros(0, dtype=np.float32)


def prepare_project_audio(root, plan, emit):
    import numpy as np
    clips, duration = validate_plan(plan)
    prepared = []
    for index, clip in enumerate(clips):
        emit('progress', {'stage': 'audio', 'completed': index, 'total': len(clips), 'message': f'Preparing project audio {index + 1} of {len(clips)}'})
        prepared.append(prepare(root, clip['path'], emit))
    identity = json.dumps({'version': 1, 'plan': plan, 'sources': [audio['audioSha256'] for audio in prepared]}, sort_keys=True).encode()
    key = hashlib.sha256(identity).hexdigest()
    cache = Path(root) / 'audio'; cache.mkdir(parents=True, exist_ok=True)
    path, metadata_path = cache / f'project-{key}.wav', cache / f'project-{key}.json'
    if path.exists() and metadata_path.exists(): return json.loads(metadata_path.read_text(encoding='utf-8'))
    pcm_path, temp = cache / f'project-{key}.{os.getpid()}.f32.part', path.with_suffix('.wav.part')
    mix = None
    try:
        count = round(duration * RATE)
        mix = np.memmap(pcm_path, dtype=np.float32, mode='w+', shape=(count,)); mix[:] = 0
        for clip, audio in zip(clips, prepared):
            source_start = clip['sourceIn'] if not clip.get('reversed') else max(clip['sourceIn'], clip['sourceOut'] - clip['duration'] * clip['speed'])
            source_end = min(clip['sourceOut'], clip['sourceIn'] + clip['duration'] * clip['speed']) if not clip.get('reversed') else clip['sourceOut']
            with wave.open(audio['audioPath'], 'rb') as source:
                start = min(source.getnframes(), round(source_start * RATE)); end = min(source.getnframes(), round(source_end * RATE))
                source.setpos(start)
                samples = np.frombuffer(source.readframes(max(0, end - start)), dtype='<i2').astype(np.float32) / 32768
            expected = round(clip['duration'] * RATE)
            if clip.get('reversed'):
                samples = np.interp(np.arange(expected) * clip['speed'], np.arange(len(samples)), samples[::-1], left=0, right=0).astype(np.float32) if len(samples) else np.zeros(expected, dtype=np.float32)
            else:
                samples = change_tempo(samples, clip['speed'])
            offset = round(clip['startTime'] * RATE); length = min(len(samples), expected, count - offset)
            if length > 0:
                times = np.arange(length) / RATE
                points = np.asarray(clip['gain'])
                mix[offset:offset + length] += samples[:length] * np.interp(times, points[:, 0], points[:, 1])
        emit('progress', {'stage': 'audio', 'message': 'Saving the project audio mix'})
        with wave.open(str(temp), 'wb') as output:
            output.setnchannels(1); output.setsampwidth(2); output.setframerate(RATE)
            for offset in range(0, count, RATE * 10):
                block = np.clip(mix[offset:offset + RATE * 10], -1, 1)
                output.writeframesraw((block * 32767).astype('<i2').tobytes())
        os.replace(temp, path)
        with path.open('rb') as handle: digest = hashlib.file_digest(handle, 'sha256').hexdigest()
        result = {'path': str(path), 'audioPath': str(path), 'name': 'Project audio', 'duration': count / RATE, 'sampleRate': RATE, 'audioSha256': digest}
        from models import write_json
        write_json(metadata_path, result)
        return result
    finally:
        if mix is not None: mix.flush(); del mix
        pcm_path.unlink(missing_ok=True); temp.unlink(missing_ok=True)
