import hashlib
import io
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
import models
import shruti_runtime as runtime
import shruti_transcription as adapter


class Response(io.BytesIO):
    def __init__(self, data, status=200, headers=None):
        super().__init__(data)
        self.status, self.headers = status, headers or {}


class ShrutiInstallation(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.folder = models.model_dir(self.root, 'shruti')
        self.folder.mkdir(parents=True)
        self.model = b'test-shruti-weights'
        self.library = b'test-native-library'
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, 'w') as wheel:
            wheel.writestr('needle/libneedle3.dll', self.library)
        self.archive = archive.getvalue()
        def file(name, data, **extra):
            return {'name': name, 'size': len(data), 'sha256': hashlib.sha256(data).hexdigest(), **extra}
        self.manifest = {'repo': 'udgamlabs/Shruti', 'revision': 'pinned-model', 'engineRevision': 'pinned-engine', 'platform': 'test',
            'files': [file('shruti.cact', self.model), file('needle-engine.whl', self.archive, repo='Cactus-Compute/needle3', revision='pinned-engine', path='python/engine.whl')],
            'library': file('libneedle3.dll', self.library), 'totalBytes': len(self.model) + len(self.archive)}
        self.patches = [patch.object(runtime, 'manifest', return_value=self.manifest), patch.object(runtime, 'package_error', return_value=None), patch.object(runtime, 'initialize', return_value=object())]
        self.mocks = [p.start() for p in self.patches]

    def tearDown(self):
        for p in reversed(self.patches): p.stop()
        self.temp.cleanup()

    def fetch(self, request, **_):
        data = self.model if request.full_url.endswith('shruti.cact') else self.archive
        self.assertIn('/resolve/pinned-', request.full_url)
        offset = int(request.get_header('Range', 'bytes=0-').split('=')[1].split('-')[0])
        return Response(data[offset:], 206 if offset else 200, {'Content-Range': f'bytes {offset}-{len(data)-1}/{len(data)}'})

    def test_resume_load_and_reuse_verified_model_and_engine_without_network(self):
        (self.folder / 'shruti.cact.part').write_bytes(self.model[:5])
        events = []
        with patch('urllib.request.urlopen', side_effect=self.fetch):
            models.download(self.root, 'shruti', lambda *event: events.append(event))
        self.assertTrue(models.installed(self.root, 'shruti'))
        self.assertEqual((self.folder / 'libneedle3.dll').read_bytes(), self.library)
        self.assertTrue(any(e[1]['stage'] == 'installing' for e in events))
        self.mocks[-1].assert_called_once()
        with patch('urllib.request.urlopen', side_effect=AssertionError('must reuse offline')):
            models.download(self.root, 'shruti', lambda *_: None)
        self.assertTrue(models.installed(self.root, 'shruti'))

    def test_failed_initialization_is_retryable_and_never_marked_installed(self):
        self.mocks[-1].side_effect = RuntimeError('engine initialization failed')
        with patch('urllib.request.urlopen', side_effect=self.fetch), self.assertRaisesRegex(RuntimeError, 'initialization'):
            models.download(self.root, 'shruti', lambda *_: None)
        self.assertFalse(models.installed(self.root, 'shruti'))
        self.mocks[-1].side_effect = None
        with patch('urllib.request.urlopen', side_effect=AssertionError('assets already cached')):
            models.download(self.root, 'shruti', lambda *_: None)
        self.assertTrue(models.installed(self.root, 'shruti'))

    def test_same_size_corruption_is_not_reused_and_dll_is_repaired_offline(self):
        with patch('urllib.request.urlopen', side_effect=self.fetch):
            models.download(self.root, 'shruti', lambda *_: None)
        (self.folder / 'shruti.cact').write_bytes(b'x' * len(self.model))
        self.assertFalse(models.installed(self.root, 'shruti'))
        with patch('urllib.request.urlopen', side_effect=self.fetch):
            models.download(self.root, 'shruti', lambda *_: None)
        (self.folder / 'libneedle3.dll').write_bytes(b'x' * len(self.library))
        self.assertFalse(models.installed(self.root, 'shruti'))
        with patch('urllib.request.urlopen', side_effect=AssertionError('verified archive is cached')):
            models.download(self.root, 'shruti', lambda *_: None)
        self.assertTrue(models.installed(self.root, 'shruti'))

    def test_checksum_failure_does_not_load_model(self):
        with patch('urllib.request.urlopen', return_value=Response(b'x' * len(self.model))), self.assertRaisesRegex(ValueError, 'checksum'):
            models.download(self.root, 'shruti', lambda *_: None)
        self.mocks[-1].assert_not_called()
        self.assertFalse(models.installed(self.root, 'shruti'))

    def test_remove_preserves_whistle_and_source_files(self):
        source = self.root / 'original.wav'; source.write_bytes(b'original')
        whisper = models.model_dir(self.root, 'whistle'); whisper.mkdir()
        sentinel = whisper / 'model.bin'; sentinel.write_bytes(b'whisper')
        models.remove(self.root, 'shruti')
        self.assertFalse(self.folder.exists())
        self.assertEqual(source.read_bytes(), b'original')
        self.assertEqual(sentinel.read_bytes(), b'whisper')


class ShrutiResponse(unittest.TestCase):
    def setUp(self):
        # A mocked documented response, never inference on real or synthetic audio.
        self.raw = {'text': '  मेरा order\nकब आएगा?  ', 'language': 'hi', 'ttft_ms': 20, 'decode_tps': 12,
            'words': [{'word': 'मेरा', 'start': .12, 'end': .49, 'probability': .95}, {'word': 'order', 'start': .6, 'end': .9, 'probability': .7}]}

    def test_preserves_native_text_raw_response_and_returned_times_without_segments(self):
        result = adapter.normalize_response(self.raw)
        self.assertEqual(result['text'], self.raw['text'])
        self.assertIs(result['rawResponse'], self.raw)
        self.assertEqual(result['segments'], [])
        self.assertIsNone(result['languageProbability'])
        self.assertEqual(result['words'][1], {'text': 'order', 'startTime': .6, 'endTime': .9, 'confidence': .7})

    def test_missing_timestamps_and_language_are_not_invented(self):
        result = adapter.normalize_response({'text': 'hello', 'words': [{'word': 'hello'}]})
        self.assertIsNone(result['language'])
        self.assertIsNone(result['words'][0]['startTime'])
        self.assertIsNone(result['words'][0]['endTime'])
        self.assertEqual(adapter.normalize_response({'text': ''})['words'], [])

    def test_invalid_times_fail_instead_of_fabricating_alignment(self):
        for start, end in ((-1, 0), (2, 1), (None, 1), (float('nan'), 1)):
            with self.subTest(start=start), self.assertRaisesRegex(ValueError, 'word times'):
                adapter.normalize_response({'text': 'hello', 'words': [{'word': 'hello', 'start': start, 'end': end}]})

    def test_native_point_alignment_is_preserved_without_padding_word_duration(self):
        raw = {'text': 'मेरा order', 'words': [{'word': 'मेरा', 'start': 120.48, 'end': 120.48, 'probability': .8}, {'word': 'order', 'start': 120.48, 'end': 121.12, 'probability': .9}]}
        result = adapter.normalize_response(raw)
        self.assertEqual(result['words'][0]['startTime'], 120.48)
        self.assertEqual(result['words'][0]['endTime'], 120.48)
        self.assertIs(result['rawResponse'], raw)

    def test_documented_call_uses_prepared_wav_auto_language_and_optional_keywords(self):
        source = {'audioPath': 'cached-mono-16k.wav', 'duration': 2, 'name': 'fixture', 'audioSha256': 'same', 'sampleRate': 16000, 'path': 'original.mp4'}
        model = MagicMock(); model.transcribe.return_value = self.raw
        metrics = MagicMock(); metrics.stop_event.is_set.return_value = False; metrics.finish.return_value = {}
        with patch.object(adapter, 'installed', return_value=True), patch.object(adapter, 'prepare', return_value=source), patch.object(adapter, 'initialize', return_value=model), patch.object(adapter, 'Metrics', return_value=metrics):
            result = adapter.transcribe('cache', {'path': 'original.mp4', 'language': 'en', 'device': 'cuda', 'vad': True, 'keywords': [' My Name ', 'product', '']}, lambda *_: None)
        model.transcribe.assert_called_once_with('cached-mono-16k.wav', word_timestamps=True, keywords=['My Name', 'product'])
        self.assertEqual(result['text'], self.raw['text'])
        self.assertEqual(result['processingMetadata']['languageHint'], 'auto')
        self.assertFalse(result['processingMetadata']['vad'])
        self.assertTrue(result['processingMetadata']['wordTimestampsAvailable'])
        json.loads(json.dumps(result, ensure_ascii=False, allow_nan=False))

    def test_keyword_validation_and_worker_request_response_serialization(self):
        for keywords in ('text', [1], ['x' * 201], ['x'] * 101):
            with self.assertRaises(ValueError): adapter.keywords_from_request({'keywords': keywords})
        import worker
        with tempfile.TemporaryDirectory() as directory, patch.object(adapter, 'transcribe', return_value=self.raw) as call, patch('sys.argv', ['worker.py', directory]), patch('sys.stdin', io.StringIO(json.dumps({'action': 'transcribe', 'model': 'shruti', 'path': 'fixture.wav', 'keywords': ['Name']}))), patch('sys.stdout', new_callable=io.StringIO) as output:
            worker.main()
            event = json.loads(output.getvalue())
        self.assertEqual(event, {'type': 'result', 'data': self.raw})
        self.assertEqual(call.call_args.args[1]['keywords'], ['Name'])

    def test_runtime_uses_local_weights_and_telemetry_off_before_public_constructor(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = models.model_dir(directory, 'shruti'); folder.mkdir(parents=True)
            constructor = MagicMock()
            def load(path):
                import os
                self.assertEqual(os.environ['NEEDLE_TELEMETRY'], '0')
                self.assertEqual(os.environ['HF_HUB_OFFLINE'], '1')
                self.assertEqual(os.environ['NEEDLE3_LIB_PATH'], str((folder / 'library.dll').resolve()))
                return 'loaded'
            constructor.side_effect = load
            info = {'files': [], 'library': {'name': 'library.dll'}}
            with patch.dict('os.environ', {'NEEDLE_TELEMETRY': '1'}), patch.dict('sys.modules', {'needle': SimpleNamespace(Whistle=constructor)}), patch.object(runtime, 'manifest', return_value=info), patch.object(runtime, 'verified', return_value=True), patch.object(runtime, 'package_error', return_value=None):
                self.assertEqual(runtime.initialize(directory, lambda *_: None), 'loaded')
            constructor.assert_called_once_with(str(folder / 'shruti.cact'))


if __name__ == '__main__': unittest.main()
