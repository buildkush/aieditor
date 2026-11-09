"""Mocked Tara integration checks. Never run real inference or recordings."""
import hashlib
import io
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'backend'))
import tara
import models


class TaraTests(unittest.TestCase):
    def test_pinned_original_model_and_special_prefix(self):
        self.assertEqual(tara.ASSETS['repo'], 'Trelis/tara')
        self.assertEqual(tara.ASSETS['revision'], '4dd4782d65ed8c9690b52478e4419d577fff40be')
        self.assertEqual(list(tara.TOKENS.values()), [50258, 50276, 51866, 50360, 50364])
        self.assertTrue(all(len(f['sha256']) == 64 for f in tara.ASSETS['files']))
        self.assertEqual(next(f for f in tara.ASSETS['files'] if f['name']=='model.safetensors')['size'], 3087229512)

    def test_install_requires_complete_assets_and_runtime_separately(self):
        asset = {'repo':'test', 'revision':'pin', 'files':[{'name':'model.safetensors','size':4,'sha256':hashlib.sha256(b'good').hexdigest()}], 'totalBytes':4}
        with tempfile.TemporaryDirectory() as directory, patch.object(tara, 'ASSETS', asset):
            root = Path(directory)
            folder = models.model_dir(root, 'tara')
            models.load_manifest(root, 'tara')
            self.assertFalse(models.installed(root, 'tara'))
            (folder/'model.safetensors').write_bytes(b'good')
            self.assertFalse(models.installed(root, 'tara'))
            models.write_json(folder/'installed.json', {'revision':'pin'})
            self.assertTrue(models.installed(root, 'tara'))
            self.assertFalse(tara.runtime_ready(root))
            runtime = tara.runtime_dir(root)
            tara.python_path(root).parent.mkdir(parents=True)
            tara.python_path(root).touch()
            models.write_json(runtime/'ready.json', tara.VERSIONS)
            self.assertTrue(tara.runtime_ready(root))
            models.write_json(runtime/'ready.json', {})
            self.assertFalse(tara.runtime_ready(root))

    def test_runtime_install_failure_never_writes_ready_marker(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(tara, 'command', side_effect=RuntimeError('pip failed')):
            with self.assertRaisesRegex(RuntimeError, 'pip failed'):
                tara.install_runtime(Path(directory), lambda *_:None)
            self.assertFalse(tara.runtime_ready(directory))

    def test_completed_download_retries_transient_windows_lock(self):
        locked = PermissionError('File scanner lock')
        locked.winerror = 32
        with patch('models.os.replace', side_effect=[locked, None]) as replace, patch('models.time.sleep'):
            models.finalize_download('cached.part', 'final')
        self.assertEqual(replace.call_count, 2)

    def test_download_rejects_corrupt_weights_without_installed_marker(self):
        asset = {'repo':'test', 'revision':'pin', 'files':[{'name':'model.safetensors','size':4,'sha256':hashlib.sha256(b'good').hexdigest()}], 'totalBytes':4}
        response = MagicMock()
        response.__enter__.return_value = response
        response.read.side_effect = [b'evil', b'']
        with tempfile.TemporaryDirectory() as directory, patch.object(tara, 'ASSETS', asset), patch.object(tara, 'install_runtime'), patch('urllib.request.urlopen', return_value=response):
            with self.assertRaisesRegex(ValueError, 'checksum'):
                models.download(Path(directory), 'tara', lambda *_:None)
            self.assertFalse(models.installed(directory, 'tara'))

    def test_offline_worker_uses_prepared_audio_and_isolated_interpreter(self):
        audio = {'audioPath':'same.wav', 'audioSha256':'same', 'duration':60}
        with patch('audio.prepare', return_value=audio), patch('models.installed', return_value=True), patch.object(tara,'runtime_ready',return_value=True), patch('worker_process.relay') as relay:
            tara.transcribe(Path('cache'), {'model':'tara','path':'original'}, lambda *_:None)
        args = relay.call_args.args
        self.assertEqual(args[0], tara.python_path(Path('cache')))
        self.assertEqual(args[3]['prepared'], audio)
        self.assertEqual(args[5]['HF_HUB_OFFLINE'], '1')
        self.assertEqual(args[5]['TRANSFORMERS_OFFLINE'], '1')
        self.assertNotIn('PYTHONPATH', args[5])

    def test_uninstalled_model_fails_before_audio_preparation_or_child_spawn(self):
        with patch('models.installed',return_value=False), patch('audio.prepare') as prepare, patch('worker_process.relay') as relay:
            with self.assertRaisesRegex(ValueError, 'Verify / repair'):
                tara.transcribe(Path('cache'), {'model':'tara'}, lambda *_:None)
        prepare.assert_not_called(); relay.assert_not_called()

    def test_decoder_receives_mixedcode_prefix_and_preserves_raw_text(self):
        torch = MagicMock()
        model, processor = MagicMock(), MagicMock()
        model.generate.return_value = [SimpleNamespace(tolist=lambda:[*tara.TOKENS.values(), 123, 50257])]
        processor.tokenizer.decode.return_value = '  Harry Potter का key chain  '
        with patch.dict(sys.modules, {'torch':torch}):
            text, ids, capped = tara.generate_chunk(model, processor, [0.1])
        self.assertEqual(text,'  Harry Potter का key chain  ')
        self.assertFalse(capped)
        self.assertEqual(torch.tensor.call_args.args[0], [[50258,50276,51866,50360,50364]])
        self.assertEqual(model.generate.call_args.kwargs['max_new_tokens'],443)
        self.assertFalse(model.generate.call_args.kwargs['return_timestamps'])
        model.generate.return_value = [SimpleNamespace(tolist=lambda:[123]*443)]
        with patch.dict(sys.modules, {'torch':torch}):
            self.assertTrue(tara.generate_chunk(model, processor, [0.1])[2])

    def test_entire_audio_is_processed_and_input_ranges_never_become_word_times(self):
        import numpy as np
        torch, transformer = MagicMock(), MagicMock()
        processor, model = MagicMock(), MagicMock()
        transformer.WhisperForConditionalGeneration.from_pretrained.return_value.to.return_value.eval.return_value = model
        audio = {'audioPath':'test.wav','audioSha256':'hash','duration':65.25}
        samples = np.zeros(int(65.25*16000),dtype=np.float32)
        meter = MagicMock()
        meter.stop_event.is_set.return_value = True
        meter.finish.return_value = {'peakRamBytes':123}
        texts = iter([('first', [1], False), ('second', [2], True), ('last', [3], False)])
        with patch.dict(sys.modules,{'torch':torch,'transformers':transformer}), patch.object(tara,'check_runtime'), patch.object(tara,'validate_assets',return_value=processor), patch('audio.read_prepared',return_value=samples), patch('hardware.Metrics',return_value=meter), patch.object(tara,'generate_chunk',side_effect=lambda *_:next(texts)):
            result = tara.recognize(Path('cache'), {'prepared':audio,'keywords':['Coke']},lambda *_:None)
        self.assertEqual(result['text'],'first second last')
        self.assertEqual(result['words'],[]); self.assertEqual(result['segments'],[])
        chunks=result['rawResponse']['inputChunks']
        self.assertEqual(chunks[0]['inputStartSec'],0)
        self.assertEqual(chunks[-1]['inputEndSec'],65.25)
        self.assertTrue(all(a['inputEndSec']==b['inputStartSec'] for a,b in zip(chunks,chunks[1:])))
        self.assertFalse(result['processingMetadata']['wordTimestampsAvailable'])
        self.assertTrue(any('token limit' in w for w in result['processingMetadata']['warnings']))
        self.assertTrue(any('Keyword hints' in w for w in result['processingMetadata']['warnings']))
        self.assertEqual(model.generation_config.language,None)

    def test_retired_fp32_profile_cannot_be_dispatched(self):
        import worker
        with tempfile.TemporaryDirectory() as directory, patch.object(sys,'argv',['worker.py',directory]), patch.object(sys,'stdin',io.StringIO('{"action":"transcribe","model":"tara","path":"original"}')):
            with self.assertRaisesRegex(ValueError,'Unsupported Speech Lab model'):
                worker.main()


if __name__ == '__main__':
    unittest.main()
