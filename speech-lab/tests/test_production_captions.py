"""Production routing tests; never load a model or transcribe recordings."""
import sys
from pathlib import Path
import unittest
from unittest.mock import MagicMock, patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
import auto_captions
import tara_int8


class ProductionCaptions(unittest.TestCase):
    def test_status_defaults_to_tara_and_quick_mode_is_explicit(self):
        rows=[{'id':'shruti'},{'id':'tara-int8-speech-aware-parallel'}]
        with patch('models.catalog',return_value=rows):
            self.assertEqual(auto_captions.status('root',{})['id'],rows[1]['id'])
            self.assertEqual(auto_captions.status('root',{'quickMode':True})['id'],'shruti')
        for invalid in ('true',1,None):
            with self.assertRaises(ValueError):auto_captions.quick_mode({'quickMode':invalid})

    def test_default_tara_reuses_timeline_mix_and_emits_one_result(self):
        audio={'audioPath':'timeline.wav','duration':10,'audioSha256':'same'}
        events=[];plan={'projectId':'active-project'}
        def transcribe(root,request,emit,**kwargs):
            self.assertIs(kwargs['prepared_audio'],audio)
            self.assertGreaterEqual(kwargs['preparation_sec'],0)
            self.assertEqual(request,{'model':'tara-int8','taraChunking':'speech-aware','chunkWorkers':2,'wordTimestamps':True})
            emit('result',{'model':'tara-int8','text':'Coke का can','words':[], 'processingMetadata':{'model':'tara-int8'}})
        with patch.object(auto_captions,'status',return_value={'installed':True,'runtimeInstalled':True}),patch('project_audio.prepare_project_audio',return_value=audio) as mix,patch.object(tara_int8,'transcribe',side_effect=transcribe),patch('shruti_transcription.transcribe') as shruti:
            auto_captions.generate('root',{'plan':plan},lambda *args:events.append(args))
        mix.assert_called_once_with('root',plan,unittest.mock.ANY)
        shruti.assert_not_called()
        self.assertEqual(len(events),1);self.assertEqual(events[0][1]['model'],'tara-int8-speech-aware-parallel')

    def test_missing_model_or_runtime_fails_before_audio_and_never_falls_back(self):
        for model in ({'installed':False},{'installed':True,'runtimeInstalled':False}):
            with patch.object(auto_captions,'status',return_value=model),patch('project_audio.prepare_project_audio') as mix,patch('shruti_transcription.transcribe') as shruti:
                with self.assertRaisesRegex(ValueError,'Set up Tara'):
                    auto_captions.generate('root',{},MagicMock())
                mix.assert_not_called();shruti.assert_not_called()

    def test_tara_adapter_does_not_prepare_the_mix_again(self):
        import numpy as np
        audio={'audioPath':'timeline.wav','duration':1}
        with patch.object(tara_int8,'installed',return_value=True),patch.object(tara_int8,'native_ready',return_value=True),patch('audio.prepare') as prepare,patch('audio.read_prepared',return_value=np.ones(16000)),patch('tara_chunking.prepare_plan',return_value={'strategy':'plan'}),patch('worker_process.relay') as relay:
            tara_int8.transcribe('root',{'taraChunking':'speech-aware'},MagicMock(),prepared_audio=audio,preparation_sec=2)
        prepare.assert_not_called()
        request=relay.call_args.args[3]
        self.assertIs(request['prepared'],audio)
        self.assertEqual(request['chunkPlan'],{'strategy':'plan'})
        self.assertGreaterEqual(request['preparationSec'],2)

    def test_worker_propagates_tara_errors_without_sending_a_result(self):
        import io,json,tempfile,worker
        with tempfile.TemporaryDirectory() as root,patch.object(sys,'argv',['worker.py',root]),patch.object(sys,'stdin',io.StringIO(json.dumps({'action':'auto_captions','plan':{}}))),patch.object(auto_captions,'generate',side_effect=RuntimeError('alignment error')),patch.object(worker,'emit') as emit:
            with self.assertRaisesRegex(RuntimeError,'alignment error'):worker.main()
        emit.assert_not_called()


if __name__=='__main__':unittest.main()
