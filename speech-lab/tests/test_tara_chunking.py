import sys
from pathlib import Path
import unittest
from unittest.mock import patch,MagicMock
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from tara_chunking import plan_chunks,validate_plan,stitch_chunks,STRATEGY
import tara_int8

def word(text,start,end):return {'text':text,'startTime':start,'endTime':end,'confidence':.9}
def chunk(words,start,end,core=0):return {'words':words,'inputStartSec':start,'inputEndSec':end,'coreStartSec':core}

class SpeechAwareChunks(unittest.TestCase):
    def test_catalog_exposes_only_parallel_tara(self):
        import tempfile
        from models import catalog
        with tempfile.TemporaryDirectory() as root:
            rows=catalog(root)
        self.assertNotIn('tara',[r['id'] for r in rows])
        self.assertNotIn('tara-int8',[r['id'] for r in rows])
        self.assertNotIn('tara-int8-speech-aware',[r['id'] for r in rows])
        self.assertIn('tara-int8-speech-aware-parallel',[r['id'] for r in rows])

    def test_speech_card_dispatch_forces_mode_and_returns_distinct_profile(self):
        import io,json,tempfile
        import worker
        events=[]
        def transcribe(root,request,emit):
            self.assertEqual(request['model'],'tara-int8')
            self.assertEqual(request['taraChunking'],'speech-aware')
            self.assertTrue(request['wordTimestamps'])
            emit('result',{'model':'tara-int8','processingMetadata':{'model':'tara-int8'}})
        with tempfile.TemporaryDirectory() as root,patch.object(sys,'argv',['worker.py',root]),patch.object(sys,'stdin',io.StringIO('{"action":"transcribe","model":"tara-int8-speech-aware-parallel"}')),patch.object(worker,'emit',side_effect=lambda *args:events.append(args)),patch.object(tara_int8,'transcribe',side_effect=transcribe):
            worker.main()
        self.assertEqual(events[0][1]['model'],'tara-int8-speech-aware-parallel')
    def test_short_audio_stays_whole(self):
        p=plan_chunks(27*16000,[{'start':0,'end':27*16000}])
        self.assertEqual(len(p),1);self.assertEqual(p[0]['inputEnd'],27*16000)

    def test_full_audio_pauses_produce_variable_chunks_without_overlap(self):
        speech=[{'start':0,'end':19*16000},{'start':21*16000,'end':39*16000},{'start':41*16000,'end':70*16000}]
        p=plan_chunks(70*16000,speech)
        self.assertEqual([c['coreEnd']/16000 for c in p],[20,40,70])
        self.assertTrue(all(c['coreStart']==c['inputStart'] and c['coreEnd']==c['inputEnd'] for c in p))
        validate_plan({'strategy':STRATEGY,'sampleRate':16000,'chunks':p},70*16000)

    def test_continuous_speech_has_selective_context_but_complete_nonoverlapping_cores(self):
        n=83*16000;p=plan_chunks(n,[{'start':0,'end':n}])
        self.assertTrue(all(c['inputEnd']-c['inputStart']<=30*16000 for c in p))
        self.assertEqual(p[0]['boundaryReason'],'limit-no-reliable-pause')
        self.assertLess(p[1]['inputStart'],p[0]['inputEnd'])
        self.assertEqual(sum(c['coreEnd']-c['coreStart'] for c in p),n)
        validate_plan({'strategy':STRATEGY,'sampleRate':16000,'chunks':p},n)

    def test_empty_vad_does_not_remove_silence_or_audio(self):
        p=plan_chunks(80*16000,[])
        self.assertEqual(sum(c['coreEnd']-c['coreStart'] for c in p),80*16000)

    def test_malformed_vad_and_chunk_plan_are_rejected(self):
        with self.assertRaises(ValueError):plan_chunks(16000,[{'start':1,'end':17000}])
        with self.assertRaises(ValueError):validate_plan({'strategy':STRATEGY,'sampleRate':16000,'chunks':[]},16000)

    def test_timed_exact_overlap_is_removed_once_and_new_boundary_words_remain(self):
        a=chunk([word('share',26.8,27.0),word(' करो',27,27.2)],0,28)
        b=chunk([word('share',26.82,27.02),word(' करो',27.02,27.22),word(' next',27.3,27.5),word(' है',27.5,27.7)],26.5,55,27.2)
        text,words,diagnostics=stitch_chunks([a,b])
        self.assertEqual(text,'share करो next है');self.assertEqual(len(words),4)
        self.assertEqual(diagnostics[0]['duplicateWordsRemoved'],2)

    def test_same_words_at_different_times_and_repetitions_are_not_deleted(self):
        for a,b in [([word('yes',26,26.2),word(' yes',26.2,26.4)],[word('yes',26,26.2),word(' yes',26.2,26.4)]),
                    ([word('and',25,25.2),word(' then',25.2,25.4)],[word('and',27,27.2),word(' then',27.2,27.4)])]:
            text,words,d=stitch_chunks([chunk(a,0,28),chunk(b,24,50,27)])
            self.assertEqual(len(words),4);self.assertEqual(d[0]['status'],'ambiguous')

    def test_pause_boundary_needs_no_overlap_matching(self):
        text,words,d=stitch_chunks([chunk([word('hello',1,2)],0,20),chunk([word('world',21,22)],20,40,20)])
        self.assertEqual(text,'hello world');self.assertEqual(d[0]['status'],'pause-boundary')

    def test_saved_standard_mode_does_not_trigger_vad_prepass(self):
        with patch.object(tara_int8,'installed',return_value=True),patch.object(tara_int8,'native_ready',return_value=True),patch('audio.prepare',return_value={'duration':2}),patch('worker_process.relay') as relay,patch('tara_chunking.prepare_plan') as planner:
            tara_int8.transcribe(Path('cache'),{'model':'tara-int8','path':'audio','taraChunking':'standard'},lambda *_:None)
        planner.assert_not_called();self.assertIsNone(relay.call_args.args[3]['chunkPlan'])

    def test_speech_mode_prepass_uses_same_prepared_audio(self):
        import numpy as np
        samples=np.ones(16000,dtype='float32');plan={'strategy':STRATEGY}
        with patch.object(tara_int8,'installed',return_value=True),patch.object(tara_int8,'native_ready',return_value=True),patch('audio.prepare',return_value={'duration':1,'audioPath':'prepared.wav','audioSha256':'same'}),patch('audio.read_prepared',return_value=samples),patch('worker_process.relay') as relay,patch('tara_chunking.prepare_plan',return_value=plan) as planner:
            tara_int8.transcribe(Path('cache'),{'model':'tara-int8','path':'audio','taraChunking':'speech-aware'},lambda *_:None)
        self.assertIs(planner.call_args.args[0],samples)
        self.assertEqual(relay.call_args.args[3]['prepared']['audioSha256'],'same')
        self.assertEqual(relay.call_args.args[3]['chunkPlan'],plan)

    def test_recognize_assembles_context_windows_and_retains_raw_hypotheses(self):
        import numpy as np
        from types import SimpleNamespace
        n=40*16000;plan={'strategy':STRATEGY,'sampleRate':16000,'chunks':plan_chunks(n,[{'start':0,'end':n}]),'speechIntervals':[{'start':0,'end':n}]}
        meter=MagicMock();meter.stop_event.is_set.return_value=True;meter.finish.return_value={}
        hypotheses=[('share करो',[1,2],[word('share',28.4,28.6),word(' करो',28.6,28.8)]),
                    ('share करो next है',[1,2,3,4],[word('share',28.4,28.6),word(' करो',28.6,28.8),word(' next',28.9,29.1),word(' है',29.1,29.3)])]
        def generate(model,processor,samples,ct2,aligned):
            text,ids,words=hypotheses.pop(0)
            aligned.update({'words':words,'raw':{},'warnings':[],'seconds':.2})
            return text,ids,False
        with patch.dict(sys.modules,{'torch':MagicMock()}),patch.object(tara_int8,'native_ready',return_value=True),patch.object(tara_int8,'activate_runtime',return_value=(MagicMock(),[])),patch.object(tara_int8,'validate',return_value=(MagicMock(),SimpleNamespace(compute_type='int8_float32'))),patch('audio.read_prepared',return_value=np.ones(n,dtype='float32')),patch('hardware.Metrics',return_value=meter),patch.object(tara_int8,'generate_chunk',side_effect=generate):
            result=tara_int8.recognize(Path('cache'),{'prepared':{'audioPath':'same.wav','duration':40},'taraChunking':'speech-aware','chunkPlan':plan},lambda *_:None)
        self.assertEqual(result['text'],'share करो next है')
        self.assertEqual(result['rawResponse']['inputChunks'][1]['text'],'share करो next है')
        self.assertEqual(result['processingMetadata']['chunkingStrategy'],STRATEGY)
        self.assertGreater(result['processingMetadata']['processedInputSec'],40)
        self.assertTrue(result['processingMetadata']['wordTimestamps'])

if __name__=='__main__':unittest.main()
