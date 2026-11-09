import hashlib
import io
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
import models
import whistle_runtime as runtime
import whistle_transcription as adapter


class WhistleTests(unittest.TestCase):
    def test_install_checksum_offline_reuse_corruption_and_remove_preserves_shruti(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); weights = b'whistle fixture'
            manifest = {'repo': 'Cactus-Compute/whistle', 'revision': 'pinned', 'files': [{'name': 'whistle.cact', 'size': len(weights), 'sha256': hashlib.sha256(weights).hexdigest()}], 'totalBytes': len(weights)}
            with patch.object(runtime, 'ASSETS', manifest), patch.object(runtime, 'ready', return_value=True), patch.object(runtime, 'package_error', return_value=None), patch.object(runtime, 'engine'), patch.object(runtime, 'initialize') as load:
                with patch('urllib.request.urlopen', return_value=io.BytesIO(weights)):
                    models.download(root, 'whistle', lambda *_: None)
                self.assertTrue(models.installed(root, 'whistle')); load.assert_called_once()
                with patch('urllib.request.urlopen', side_effect=AssertionError('offline')):
                    self.assertTrue(models.installed(root, 'whistle'))
                    models.download(root, 'whistle', lambda *_: None)
                    load.side_effect = RuntimeError('failed load')
                    with self.assertRaisesRegex(RuntimeError, 'failed load'):
                        models.download(root, 'whistle', lambda *_: None)
                    self.assertFalse(models.installed(root, 'whistle'))
                    load.side_effect = None
                    models.download(root, 'whistle', lambda *_: None)
                (root / 'models/whistle/whistle.cact').write_bytes(b'x' * len(weights))
                self.assertFalse(models.installed(root, 'whistle'))
                sentinel = root / 'models/shruti'; sentinel.mkdir(); (sentinel / 'keep').write_text('untouched')
                models.remove(root, 'whistle')
                self.assertTrue((sentinel / 'keep').exists())

    def test_public_constructor_uses_explicit_weights_and_verified_engine_offline(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); constructor = MagicMock()
            with patch.object(runtime, 'package_error', return_value=None), patch.object(runtime, 'verified', return_value=True), patch.object(runtime, 'engine', return_value=root / 'engine.dll'), patch.dict('sys.modules', {'needle': SimpleNamespace(Whistle=constructor)}), patch('urllib.request.urlopen', side_effect=AssertionError('offline')):
                runtime.initialize(root, lambda *_: None)
            constructor.assert_called_once_with(str(root / 'models/whistle/whistle.cact'))

    def test_adapter_calls_english_keywords_and_preserves_native_response(self):
        raw = {'text': 'Keychain', 'language': 'en', 'words': [{'word': 'Keychain', 'start': .2, 'end': .7, 'probability': .9}]}
        model = MagicMock(); model.transcribe.return_value = raw
        source = {'audioPath': 'same-prepared.wav', 'duration': 2, 'audioSha256': 'same'}
        metrics = MagicMock(); metrics.finish.return_value = {}; metrics.stop_event.is_set.return_value = False
        with patch.object(adapter, 'installed', return_value=True), patch.object(adapter, 'prepare', return_value=source), patch.object(adapter, 'initialize', return_value=model), patch.object(adapter, 'Metrics', return_value=metrics), patch('urllib.request.urlopen', side_effect=AssertionError('no download during inference')):
            result = adapter.transcribe('cache', {'path': 'source', 'keywords': ['Keychain'], 'language': 'hi'}, lambda *_: None)
        model.transcribe.assert_called_once_with('same-prepared.wav', language='en', word_timestamps=True, keywords=['Keychain'])
        self.assertIs(result['rawResponse'], raw)
        self.assertEqual(result['words'][0]['startTime'], .2)
        self.assertEqual(result['processingMetadata']['languageHint'], 'en')

    def test_worker_routes_whistle_and_propagates_failures(self):
        import worker
        with tempfile.TemporaryDirectory() as directory, patch.object(adapter, 'transcribe', return_value={'text': 'fixture'}) as call, patch('sys.argv', ['worker.py', directory]), patch('sys.stdin', io.StringIO(json.dumps({'action': 'transcribe', 'model': 'whistle', 'path': 'fixture.wav'}))), patch('sys.stdout', new_callable=io.StringIO) as output:
            worker.main()
            self.assertEqual(json.loads(output.getvalue())['data']['text'], 'fixture')
            call.assert_called_once()
        with patch.object(adapter, 'installed', return_value=False), self.assertRaisesRegex(ValueError, 'Download'):
            adapter.transcribe('cache', {}, lambda *_: None)


if __name__ == '__main__': unittest.main()
