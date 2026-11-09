"""Bounded public MUCS pilot preparation; no ASR, training or production imports.

Usage: python speech-lab/experiments/shruti_public_data.py --output EXPERIMENT_DIR
The signed dataset-viewer audio URLs are used transiently and never persisted.
"""
import argparse
from collections import Counter
import hashlib
import io
import json
from pathlib import Path
import random
import re
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import wave

DATASET = 'dianavdavidson/MUCS-Hinglish'
ROWS = {'train': 52825, 'test': 3136}
LICENSE = 'CC-BY-SA-4.0'
ORIGINAL = 'https://www.openslr.org/104/'


def normalized_text(text):
    text = unicodedata.normalize('NFKC', text).casefold()
    return ' '.join(''.join(c if unicodedata.category(c)[0] in 'LMN' else ' ' for c in text).split())


def candidate(row, split):
    value = row['row']
    text = value.get('transcript', '').strip()
    speaker = str(value.get('speaker_id', '')).strip()
    segment = str(value.get('segment_id', '')).strip()
    if not (speaker and segment and re.search('[a-zA-Z]', text) and re.search('[\u0900-\u097f]', text)):
        return None
    if not 3 <= len(text.split()) <= 120:
        return None
    audio = value.get('audio') or []
    if not isinstance(audio, list) or not audio or not audio[0].get('src'):
        return None
    return {'text': text, 'speaker_id': speaker, 'segment_id': segment,
            'recording_id': segment.rsplit('_', 1)[0], 'source_split': split,
            'row_idx': row['row_idx'], '_url': audio[0]['src']}


class Requests:
    def __init__(self, max_api=100, max_bytes=100*1024*1024, max_http=500):
        self.max_api, self.max_bytes, self.max_http = max_api, max_bytes, max_http
        self.api_count = self.http_count = self.download_bytes = 0
        self.errors = []
        self.last_api_request = 0.0

    def request(self, url, method='GET', api=False):
        if self.http_count >= self.max_http or api and self.api_count >= self.max_api:
            raise RuntimeError('Bounded request budget exhausted')
        if api:
            delay = 4.0-(time.monotonic()-self.last_api_request)
            if delay > 0: time.sleep(delay)
            self.last_api_request = time.monotonic()
        self.http_count += 1
        if api:
            self.api_count += 1
        return urllib.request.urlopen(urllib.request.Request(url, method=method,
            headers={'User-Agent': 'aiditor-shruti-public-pilot/1'}), timeout=30)

    def rows(self, split, offset, length=100):
        query = urllib.parse.urlencode({'dataset': DATASET, 'config': 'default',
                                       'split': split, 'offset': offset, 'length': length})
        url = 'https://datasets-server.huggingface.co/rows?' + query
        for attempt in range(2):
            try:
                with self.request(url, api=True) as response:
                    return json.load(response)['rows']
            except (OSError, ValueError, KeyError, RuntimeError) as exc:
                # Persist only source coordinates and status, never signed audio URLs.
                self.errors.append({'stage': 'rows', 'split': split, 'offset': offset,
                                    'attempt': attempt+1, 'error': type(exc).__name__,
                                    'status': getattr(exc, 'code', None)})
                if self.api_count >= self.max_api:
                    break
                if getattr(exc, 'code', None) == 429:
                    retry = getattr(exc, 'headers', {}).get('Retry-After', '60')
                    try: delay = max(60.0, float(retry))
                    except ValueError: delay = 60.0
                    if delay > 300: raise RuntimeError('Dataset provider rate limit requires a later retry')
                    time.sleep(delay)
                else: time.sleep(.5*(attempt+1))
        return []

    def audio(self, item):
        with self.request(item['_url'], method='HEAD') as response:
            size = int(response.headers.get('Content-Length', '0'))
        # Viewer WAVs are 16 kHz PCM16 mono. Final decoded duration is verified below.
        if not 2*32000+44 <= size <= 8*32000+4096:
            return None
        if self.download_bytes+size > self.max_bytes:
            raise RuntimeError('Audio download budget exhausted')
        with self.request(item['_url']) as response:
            payload = response.read(8*32000+4097)
        self.download_bytes += len(payload)
        if self.download_bytes > self.max_bytes or len(payload) > 8*32000+4096:
            raise RuntimeError('Audio download budget exceeded')
        with wave.open(io.BytesIO(payload), 'rb') as wav:
            if (wav.getframerate(), wav.getnchannels(), wav.getsampwidth(), wav.getcomptype()) != (16000,1,2,'NONE'):
                return None
            duration = wav.getnframes()/16000
            pcm = wav.readframes(wav.getnframes())
        if not 2 <= duration <= 8:
            return None
        return payload, duration, hashlib.sha256(payload).hexdigest(), hashlib.sha256(pcm).hexdigest()


def distributed_offsets(total, windows, rng, length=8):
    """Sample the corpus throughout its ordering rather than neighbouring one tutorial."""
    result = []
    for i in range(windows):
        low, high = total*i//windows, total*(i+1)//windows
        result.append(min(total-length, rng.randrange(low, max(low+1, high))))
    rng.shuffle(result)
    return result


def select_group(name, pool, target, requests, output, claimed_speakers, used_text, used_audio, rng):
    rows = list(pool); rng.shuffle(rows)
    selected, counts = [], Counter()
    for per_speaker in (1, 2):
        for item in rows:
            if len(selected) >= target:
                return selected
            speaker = item['speaker_id']
            if speaker in claimed_speakers and claimed_speakers[speaker] != name:
                continue
            if counts[speaker] >= per_speaker or normalized_text(item['text']) in used_text:
                continue
            try:
                audio = requests.audio(item)
            except (OSError, ValueError, EOFError, wave.Error, RuntimeError) as exc:
                requests.errors.append({'stage': 'audio', 'split': item['source_split'],
                    'row_idx': item['row_idx'], 'error': type(exc).__name__, 'status': getattr(exc, 'code', None)})
                if requests.download_bytes >= requests.max_bytes or requests.http_count >= requests.max_http:
                    return selected
                continue
            if audio is None:
                continue
            payload, duration, audio_hash, pcm_hash = audio
            if pcm_hash in used_audio:
                continue
            filename = hashlib.sha256((item['source_split']+':'+item['segment_id']).encode()).hexdigest()[:24]+'.wav'
            path = output/'audio'/filename; path.write_bytes(payload)
            metadata = {key:value for key,value in item.items() if key not in ('_url', 'text')}
            metadata.update({'dataset': DATASET, 'license': LICENSE, 'audioSha256': audio_hash,
                             'pcmSha256': pcm_hash, 'duration': duration, 'filename': filename})
            selected.append({'audio': str(path.resolve()), 'text': item['text'], 'language': 'hi', 'metadata': metadata})
            claimed_speakers[speaker] = name; counts[speaker] += 1
            used_text.add(normalized_text(item['text'])); used_audio.add(pcm_hash)
            print(f'{name}: {len(selected)}/{target} speaker={speaker} {duration:.2f}s', flush=True)
    return selected


def validate_disjoint(groups):
    for key in ('speaker_id', 'recording_id', 'pcmSha256'):
        seen = {}
        for group, rows in groups.items():
            for row in rows:
                value = row['metadata'][key]
                if value in seen and seen[value] != group:
                    raise ValueError(f'{key} leakage between {seen[value]} and {group}')
                seen[value] = group
    seen = {}
    for group, rows in groups.items():
        for row in rows:
            text = normalized_text(row['text'])
            if text in seen and seen[text] != group:
                raise ValueError('Transcript leakage between pilot splits')
            seen[text] = group


def prepare(output, seed=20261106, counts=None, max_api=100, max_bytes=100*1024*1024):
    counts = counts or {'train':24, 'validation':8, 'test':16}
    output = Path(output).resolve(); output.mkdir(parents=True, exist_ok=True)
    if any((output/(split+'.jsonl')).exists() for split in counts):
        raise ValueError('Use a new output directory; existing split manifests are never overwritten')
    (output/'audio').mkdir(exist_ok=True)
    rng = random.Random(seed); requests = Requests(max_api=max_api, max_bytes=max_bytes)
    pools = {}
    # Reserve some request allowance for transient retries. Every metadata request is counted.
    for split, windows in [('test',4), ('train',20)]:
        pool = []
        for offset in distributed_offsets(ROWS[split], windows, rng, length=100):
            pool.extend(item for row in requests.rows(split, offset) if (item := candidate(row, split)))
            if requests.api_count >= max_api:
                break
        pools[split] = pool
        print(f'{split}: inspected {len(pool)} eligible mixed-script metadata rows; {len(set(item["speaker_id"] for item in pool))} speakers', flush=True)
    claimed, texts, hashes, groups = {}, set(), set(), {}
    # Test speaker identities are reserved first; validation also uses different speakers.
    for group, source in [('test','test'), ('validation','train'), ('train','train')]:
        groups[group] = select_group(group, pools[source], counts[group], requests, output, claimed, texts, hashes, rng)
    validate_disjoint(groups)
    complete = all(len(groups[group]) == count for group,count in counts.items())
    for group, rows in groups.items():
        (output/(group+'.jsonl')).write_text(''.join(json.dumps(row,ensure_ascii=False)+'\n' for row in rows), encoding='utf-8')
    provenance = {'dataset': DATASET, 'originalSource': ORIGINAL, 'license': LICENSE,
        'mirrorLicenseDiscrepancy': 'Mirror says CC BY 4.0; retain original OpenSLR CC BY-SA 4.0 obligations.',
        'domainWarning': 'Technical tutorials, not curated product-video vocabulary. Public labels are not independently audited.',
        'priorExposure': 'Shruti already trained on MUCS training data; this pilot is domain reweighting, not novel-domain evidence.',
        'selection': 'Deterministic distributed metadata windows; 2–8s; mixed-script; max two clips per speaker; groups speaker/recording/transcript/PCM-hash disjoint.',
        'seed': seed, 'targets': counts, 'counts': {k:len(v) for k,v in groups.items()}, 'complete': complete,
        'apiRequests': requests.api_count, 'httpRequests': requests.http_count,
        'downloadedAudioBytes': requests.download_bytes, 'errors': requests.errors,
        'sources': ['https://www.openslr.org/104/', 'https://huggingface.co/datasets/'+DATASET,
                    'https://huggingface.co/udgamlabs/Shruti#how-it-was-trained']}
    (output/'provenance.json').write_text(json.dumps(provenance,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
    if not complete:
        raise RuntimeError(f'Pilot targets not met within bounded requests: {provenance["counts"]}. See provenance.json; no leakage rules were relaxed.')
    return provenance


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--seed', type=int, default=20261106)
    parser.add_argument('--train', type=int, default=24)
    parser.add_argument('--validation', type=int, default=8)
    parser.add_argument('--test', type=int, default=16)
    parser.add_argument('--max-api-requests', type=int, default=100)
    parser.add_argument('--max-audio-mb', type=int, default=100)
    args = parser.parse_args()
    if not all(n>0 for n in (args.train,args.validation,args.test)) or not 20 <= args.max_api_requests <= 100 or not 1 <= args.max_audio_mb <= 100:
        parser.error('Positive split targets required; metadata request budget 20–100, audio budget 1–100 MB.')
    print(json.dumps(prepare(args.output,args.seed,{'train':args.train,'validation':args.validation,'test':args.test},
                             args.max_api_requests,args.max_audio_mb*1024*1024),ensure_ascii=False),flush=True)


if __name__ == '__main__':
    main()
