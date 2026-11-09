"""Opt-in real inference test: python speech-lab/tests/integration.py AUDIO --storage APP_DATA --language hi.
Requires installed dependencies and already downloaded models; never downloads recognition weights.
"""
import argparse
import json
from pathlib import Path
import subprocess
import sys
import time


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('audio', type=Path)
    parser.add_argument('--storage', type=Path, required=True)
    parser.add_argument('--language', default='auto', choices=['auto', 'en', 'hi'])
    parser.add_argument('--device', default='cpu', choices=['auto', 'cpu', 'cuda'])
    parser.add_argument('--output', type=Path, default=Path('speech-lab/test-output'))
    parser.add_argument('--expect-text', action='append', default=[], help='Known phrase that every model must recover, including tail speech in regression recordings')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    worker = Path(__file__).resolve().parents[1] / 'backend' / 'worker.py'
    for model in ('shruti', 'shunya-int8', 'whistle'):
        request = {'action': 'transcribe', 'path': str(args.audio.resolve()), 'model': model,
                   'language': args.language, 'device': args.device, 'vad': True}
        completed = subprocess.run([sys.executable, '-u', str(worker), str(args.storage)], input=json.dumps(request),
                                   text=True, encoding='utf-8', capture_output=True, timeout=900)
        events = [json.loads(line) for line in completed.stdout.splitlines()]
        assert completed.returncode == 0, (completed.stdout, completed.stderr)
        result = next(event['data'] for event in events if event['type'] == 'result')
        assert result['processingMetadata']['processingSec'] > 0
        assert result['source']['duration'] > 0
        text = result['text']
        for phrase in args.expect_text:
            assert phrase in text, f'{model} did not recover expected phrase: {phrase}'
        for segment in result['segments']:
            assert 0 <= segment['startTime'] <= segment['endTime'] <= result['source']['duration'] + .1
            for word in segment['words']:
                assert segment['startTime'] <= word['startTime'] <= word['endTime'] <= segment['endTime'] + .01
                assert 0 <= word['confidence'] <= 1
        path = args.output / f'{args.audio.stem}-{args.language}-{model}.json'
        path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps({'output': str(path), 'language': result['language'], 'metrics': result['processingMetadata']}, ensure_ascii=False), flush=True)
    # Cancellation must interrupt native model loading/decoding, not wait for the next segment.
    process = subprocess.Popen([sys.executable, '-u', str(worker), str(args.storage)], stdin=subprocess.PIPE,
                               stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, encoding='utf-8')
    process.stdin.write(json.dumps({**request, 'model': 'large-v3-turbo'})); process.stdin.close()
    interrupted = False
    for line in process.stdout:
        if json.loads(line).get('data', {}).get('stage') == 'loading':
            started = time.perf_counter()
            process.kill(); process.wait(timeout=3)
            assert time.perf_counter() - started < 3
            print('Native worker cancellation verified', flush=True)
            interrupted = True
            break
    process.stdout.close()
    assert interrupted, 'Worker did not reach a cancellable model-loading stage'


if __name__ == '__main__': main()
