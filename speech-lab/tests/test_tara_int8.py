"""Mock-only integration tests. No recording transcription or benchmark."""
import io
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
import tara_int8 as runtime
import tara


class TaraInt8Tests(unittest.TestCase):
    def test_exact_custom_prefix_is_passed_to_native_decoder(self):
        ct2, model, processor = MagicMock(), MagicMock(), MagicMock()
        processor.tara_suppress_tokens = [1,50365,51866]
        processor.tokenizer.decode.return_value = '  Harry Potter का keychain  '
        processor.return_value.input_features = __import__('numpy').zeros((1,128,3000),dtype='float32')
        model.generate.return_value = [SimpleNamespace(sequences_ids=[[123,456]])]
        text, ids, capped = runtime.generate_chunk(model, processor, [0.1], ct2)
        self.assertEqual(text,'  Harry Potter का keychain  ')
        self.assertEqual(ids,[123,456]);self.assertFalse(capped)
        self.assertEqual(model.generate.call_args.args[1],[[50258,50276,51866,50360,50364]])
        self.assertEqual(model.generate.call_args.kwargs['max_length'],448)
        self.assertEqual(model.generate.call_args.kwargs['suppress_tokens'],processor.tara_suppress_tokens)
        self.assertEqual(model.generate.call_args.kwargs['beam_size'],1)

    def test_native_profile_does_not_accept_stock_runtime(self):
        with tempfile.TemporaryDirectory() as root:
            self.assertFalse(runtime.native_ready(root))

    def test_benchmark_identifies_optimized_and_old_native_builds(self):
        from models import write_json
        with tempfile.TemporaryDirectory() as root:
            folder=tara.runtime_dir(root);folder.mkdir(parents=True)
            self.assertEqual(runtime.native_optimization(root),'not recorded')
            write_json(folder/'tara-int8-native.json',{'compilerReleaseFlags':'/O2 /DNDEBUG'})
            self.assertEqual(runtime.native_optimization(root),'/O2 /DNDEBUG')

    def test_release_check_rejects_unoptimized_compiler_commands_and_ignores_resources(self):
        import importlib.util
        script=Path(__file__).resolve().parents[2]/'scripts/build_tara_int8.py'
        spec=importlib.util.spec_from_file_location('tara_builder',script)
        builder=importlib.util.module_from_spec(spec);spec.loader.exec_module(builder)
        optimized='build a.obj: CXX_COMPILER__Release a.cc\n  FLAGS = /O2 /DNDEBUG\n'
        resource='build a.res: RC_COMPILER__Release a.rc\n  FLAGS = -DWIN32\n'
        builder.verify_release_flags(optimized+resource)
        with self.assertRaisesRegex(RuntimeError,'optimization'):
            builder.verify_release_flags(optimized.replace('/O2',''))

    def test_verified_conversion_is_reused_without_reconversion_or_source_download(self):
        with patch.object(runtime,'installed',return_value=True),patch.object(runtime,'native_ready',return_value=True),patch('models.download') as download,patch('tara.command') as command:
            runtime.install('cache',lambda *_:None)
        download.assert_not_called();command.assert_not_called()

    def test_corrupt_conversion_is_not_reported_installed(self):
        from models import model_dir, write_json
        with tempfile.TemporaryDirectory() as root:
            folder=model_dir(root,'tara-int8');folder.mkdir(parents=True)
            path=folder/'model.bin';path.write_bytes(b'good')
            write_json(folder/'installed.json',{'profile':runtime.PROFILE,'files':[{'name':'model.bin','size':4,'sha256':runtime.digest(path)}]})
            self.assertTrue(runtime.installed(root,verify=True))
            path.write_bytes(b'evil')
            self.assertFalse(runtime.installed(root,verify=True))

    def test_conversion_preserves_original_tara_and_uses_explicit_quantization(self):
        source=Path(runtime.__file__).read_text(encoding='utf-8')
        self.assertIn("quantization='int8_float32'",source)
        self.assertIn("copy_files=copied",source)
        self.assertEqual(runtime.PROFILE['decoderPrefix'],list(tara.TOKENS.values()))
        self.assertEqual(runtime.PROFILE['sourceRevision'],tara.ASSETS['revision'])

    def test_offline_relay_preserves_audio_hash_and_does_not_use_shunya_interpreter(self):
        audio={'audioPath':'same.wav','audioSha256':'same','duration':3}
        with patch.object(runtime,'installed',return_value=True),patch.object(runtime,'native_ready',return_value=True),patch('audio.prepare',return_value=audio),patch('worker_process.relay') as relay:
            runtime.transcribe(Path('cache'),{'model':'tara-int8','path':'source'},lambda *_:None)
        args=relay.call_args.args
        self.assertEqual(args[0],tara.python_path('cache'))
        self.assertEqual(args[3]['prepared'],audio)
        self.assertEqual(args[5]['HF_HUB_OFFLINE'],'1')

    def test_standard_profile_is_not_exposed_by_worker(self):
        import worker
        with tempfile.TemporaryDirectory() as root,patch.object(sys,'argv',['worker.py',root]),patch.object(sys,'stdin',io.StringIO('{"action":"transcribe","model":"tara-int8"}')):
            with self.assertRaisesRegex(ValueError,'Unsupported Speech Lab model'):worker.main()

    def test_full_input_coverage_and_no_fabricated_word_times(self):
        import numpy as np
        audio={'audioPath':'same.wav','audioSha256':'same','duration':65.25}
        meter=MagicMock();meter.stop_event.is_set.return_value=True;meter.finish.return_value={}
        model=SimpleNamespace(compute_type='int8_float32')
        texts=iter([('first',[1],False),('middle',[2],False),('last',[3],False)])
        with patch.dict(sys.modules,{'torch':MagicMock()}),patch.object(runtime,'native_ready',return_value=True),patch.object(runtime,'activate_runtime',return_value=(MagicMock(),[])),patch.object(runtime,'validate',return_value=(MagicMock(),model)),patch('audio.read_prepared',return_value=np.zeros(int(65.25*16000),dtype='float32')),patch('hardware.Metrics',return_value=meter),patch.object(runtime,'generate_chunk',side_effect=lambda *_:next(texts)):
            result=runtime.recognize(Path('cache'),{'prepared':audio},lambda *_:None)
        self.assertEqual(result['text'],'first middle last')
        self.assertEqual(result['words'],[]);self.assertEqual(result['segments'],[])
        self.assertFalse(result['processingMetadata']['wordTimestampsAvailable'])
        chunks=result['rawResponse']['inputChunks']
        self.assertEqual(chunks[-1]['inputEndSec'],65.25)
        self.assertTrue(all(a['inputEndSec']==b['inputStartSec'] for a,b in zip(chunks,chunks[1:])))


if __name__=='__main__':unittest.main()
