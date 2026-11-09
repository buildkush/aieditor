import hashlib
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'backend'))
import tested_cpu


class TestedCpuProfiles(unittest.TestCase):
    def test_missing_or_corrupt_study_assets_are_not_advertised_ready(self):
        payload = b'verified'
        profile = {'name':'test','bytes':len(payload),'files':[{'path':'experiments/model.bin','size':len(payload),'sha256':hashlib.sha256(payload).hexdigest()}]}
        with tempfile.TemporaryDirectory() as folder, patch.object(tested_cpu,'profiles',return_value={'shunya-int8':profile}):
            root=Path(folder)
            self.assertFalse(tested_cpu.catalog(root)[0]['installed'])
            file=root/'experiments/model.bin';file.parent.mkdir();file.write_bytes(payload)
            self.assertTrue(tested_cpu.catalog(root)[0]['installed'])
            file.write_bytes(b'x'*len(payload))
            self.assertFalse(tested_cpu.catalog(root)[0]['installed'])

    def test_native_profile_reuses_prepared_audio_in_isolated_offline_child(self):
        audio={'audioPath':'same.wav','audioSha256':'same','duration':4}
        with patch.object(tested_cpu,'catalog',return_value=[{'id':'shunya-int8','installed':True,'runtimeInstalled':True}]), patch('audio.prepare',return_value=audio), patch('worker_process.relay') as relay:
            tested_cpu.transcribe(Path('cache'),{'model':'shunya-int8','path':'original'},lambda *_:None)
        args=relay.call_args.args
        self.assertEqual(args[3]['prepared'],audio)
        self.assertEqual(args[5]['HF_HUB_OFFLINE'],'1')
        self.assertNotIn('PYTHONPATH', {k:v for k,v in args[5].items() if 'direct-hf-overlay' in v})


if __name__=='__main__':unittest.main()
