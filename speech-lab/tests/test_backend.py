import hashlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import wave

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from audio import prepare, read_prepared
from models import download, installed, catalog, model_dir, remove, write_json


class Response(io.BytesIO):
    def __init__(self, data, status=200, headers=None):
        super().__init__(data)
        self.status, self.headers = status, headers or {}


class ModelLifecycle(unittest.TestCase):
    def setUp(self):
        self.registry = patch('models.MODELS', {'fixture': ('Test fixture', 'test/model')})
        self.registry.start()
        self.addCleanup(self.registry.stop)
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.folder = model_dir(self.root, 'fixture')
        self.folder.mkdir(parents=True)
        self.payload = b'actual-download-fixture-bytes'
        self.manifest = {'repo': 'test/model', 'revision': 'pinned', 'totalBytes': len(self.payload),
            'files': [{'name': 'model.bin', 'size': len(self.payload), 'sha256': hashlib.sha256(self.payload).hexdigest()}]}
        write_json(self.folder / 'manifest.json', self.manifest)

    def tearDown(self):
        self.temp.cleanup()

    def test_resume_reuse_restart_and_remove(self):
        (self.folder / 'model.bin.part').write_bytes(self.payload[:8])
        seen = []
        def open_request(request, **_):
            seen.append(request.get_header('Range'))
            return Response(self.payload[8:], 206, {'Content-Range': f'bytes 8-{len(self.payload)-1}/{len(self.payload)}'})
        with patch('urllib.request.urlopen', open_request):
            download(self.root, 'fixture', lambda *_: None)
        self.assertEqual(seen, ['bytes=8-'])
        self.assertTrue(installed(self.root, 'fixture'))
        with patch('urllib.request.urlopen', side_effect=AssertionError('offline means no network')):
            self.assertTrue(catalog(self.root)[0]['installed'])
            download(self.root, 'fixture', lambda *_: None)
        sentinel = self.root / 'keep.wav'
        sentinel.write_bytes(b'original')
        remove(self.root, 'fixture')
        self.assertFalse(self.folder.exists())
        self.assertEqual(sentinel.read_bytes(), b'original')

    def test_server_ignoring_range_restarts_cleanly(self):
        (self.folder / 'model.bin.part').write_bytes(b'old')
        with patch('urllib.request.urlopen', return_value=Response(self.payload)):
            download(self.root, 'fixture', lambda *_: None)
        self.assertEqual((self.folder / 'model.bin').read_bytes(), self.payload)

    def test_incomplete_download_never_becomes_installed(self):
        with patch('urllib.request.urlopen', return_value=Response(self.payload[:5])):
            with self.assertRaisesRegex(ValueError, 'Incomplete'):
                download(self.root, 'fixture', lambda *_: None)
        self.assertFalse(installed(self.root, 'fixture'))
        self.assertEqual((self.folder / 'model.bin.part').stat().st_size, 5)

    def test_checksum_failure_is_not_reused(self):
        with patch('urllib.request.urlopen', return_value=Response(b'x' * len(self.payload))):
            with self.assertRaisesRegex(ValueError, 'checksum'):
                download(self.root, 'fixture', lambda *_: None)
        self.assertFalse(installed(self.root, 'fixture'))
        self.assertFalse((self.folder / 'model.bin.part').exists())

    def test_corrupted_installed_model_is_invalidated_even_if_repair_is_interrupted(self):
        with patch('urllib.request.urlopen', return_value=Response(self.payload)):
            download(self.root, 'fixture', lambda *_: None)
        self.assertTrue(installed(self.root, 'fixture'))
        (self.folder / 'model.bin').write_bytes(b'x' * len(self.payload))
        with patch('urllib.request.urlopen', side_effect=OSError('interrupted repair')):
            with self.assertRaises(OSError): download(self.root, 'fixture', lambda *_: None)
        self.assertFalse(installed(self.root, 'fixture'))

    def test_model_ids_cannot_escape_storage(self):
        for model in ('..', '../small', 'tiny', 'small.en'):
            with self.assertRaises(ValueError): model_dir(self.root, model)


class RetainedModels(unittest.TestCase):
    def test_only_retained_models_can_be_installed_or_resolved(self):
        import models
        import tested_cpu
        self.assertEqual(set(models.MODELS), {'shruti', 'whistle', 'tara', 'tara-int8'})
        self.assertEqual(set(tested_cpu.profiles()), {'shunya-int8'})
        with tempfile.TemporaryDirectory() as root:
            for model in ('small', 'large-v3-turbo', 'tiny-hinglish', 'srota', 'srota-cpu', 'shunya'):
                with self.assertRaises(ValueError): models.model_dir(root, model)


class AudioPreparation(unittest.TestCase):
    def test_wav_pcm_duration_identity_and_cache_without_touching_original(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'input.wav'
            with wave.open(str(source), 'wb') as output:
                output.setnchannels(2); output.setsampwidth(2); output.setframerate(8000)
                output.writeframes(b'\x00\x00\x00\x00' * 8000)
            before = source.read_bytes()
            result = prepare(root / 'cache', source, lambda *_: None)
            self.assertEqual(result['duration'], 1)
            self.assertEqual(read_prepared(result['audioPath']).shape, (16000,))
            with patch('av.open', side_effect=AssertionError('cache must be reused')):
                self.assertEqual(prepare(root / 'cache', source, lambda *_: None), result)
            self.assertEqual(source.read_bytes(), before)

    def test_missing_or_non_audio_input_is_an_error(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(FileNotFoundError): prepare(directory, Path(directory) / 'missing.wav', lambda *_: None)


if __name__ == '__main__': unittest.main()
