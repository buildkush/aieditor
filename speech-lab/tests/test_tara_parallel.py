"""Concurrency tests use inert tasks; no ASR inference or recording benchmarks."""
import io
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch,MagicMock
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
import tara_int8


class TaraParallelTests(unittest.TestCase):
    def run_fake(self,duration,workers):
        import numpy as np
        from types import SimpleNamespace
        from tara_chunking import STRATEGY,plan_chunks
        n=duration*16000
        speech=[{'start':0,'end':19*16000},{'start':21*16000,'end':39*16000},{'start':41*16000,'end':n}] if duration==60 else [{'start':0,'end':n}]
        plan={'strategy':STRATEGY,'sampleRate':16000,'chunks':plan_chunks(n,speech),'speechIntervals':speech}
        meter=MagicMock();meter.stop_event.is_set.return_value=True;meter.finish.return_value={}
        def generate(model,processor,samples,ct2,aligned):
            offset=aligned['offset'];text=f'word{int(offset)}'
            aligned.update({'words':[{'text':text,'startTime':offset+.1,'endTime':offset+.5}],'raw':{},'warnings':[],'seconds':.2})
            return text,[1],False
        with patch.dict(sys.modules,{'torch':MagicMock()}),patch.object(tara_int8,'native_ready',return_value=True),patch.object(tara_int8,'activate_runtime',return_value=(MagicMock(),[])),patch.object(tara_int8,'validate',return_value=(MagicMock(),SimpleNamespace(compute_type='int8_float32'))) as load,patch('audio.read_prepared',return_value=np.ones(n,dtype='float32')),patch('hardware.Metrics',return_value=meter),patch.object(tara_int8,'generate_chunk',side_effect=generate):
            result=tara_int8.recognize(Path('cache'),{'prepared':{'audioPath':'same.wav','audioSha256':'same','duration':duration},'taraChunking':'speech-aware','chunkPlan':plan,'chunkWorkers':workers},lambda *_:None)
        return result,load.call_args.kwargs

    def test_parallel_pipeline_preserves_plan_text_words_and_stitch_order(self):
        serial,_=self.run_fake(60,1);parallel,load=self.run_fake(60,2)
        for key in ('text','words','rawResponse','source'):self.assertEqual(serial[key],parallel[key])
        self.assertEqual(parallel['processingMetadata']['chunkWorkers'],2)
        self.assertEqual(parallel['processingMetadata']['threadsPerWorker'],2)
        self.assertEqual(load,{'intra_threads':2,'inter_threads':2})

    def test_single_chunk_parallel_request_uses_baseline_thread_budget(self):
        result,load=self.run_fake(1,2)
        self.assertEqual(result['processingMetadata']['chunkWorkers'],1)
        self.assertEqual(load,{'intra_threads':4,'inter_threads':1})
        self.assertIsNotNone(result['processingMetadata']['fallback'])

    def test_out_of_order_completion_is_reassembled_in_source_order(self):
        barrier=threading.Barrier(2);second=threading.Event();completed=[];lock=threading.Lock()
        def process(item):
            index,value=item
            if index<2:
                barrier.wait(timeout=3)
                if index==0:self.assertTrue(second.wait(timeout=3))
                else:second.set()
            with lock:completed.append(index)
            return value
        result=list(tara_int8.ordered_chunk_results(['first','second','third'],process,2))
        self.assertEqual(result,['first','second','third'])
        self.assertEqual(completed[0],1)

    def test_in_flight_work_is_bounded_to_two_chunks(self):
        lock=threading.Lock();active=0;peak=0;barrier=threading.Barrier(2)
        def process(item):
            nonlocal active,peak
            with lock:active+=1;peak=max(peak,active)
            if item[0]<2:barrier.wait(timeout=3)
            with lock:active-=1
            return item[0]
        self.assertEqual(list(tara_int8.ordered_chunk_results(range(10),process,2)),list(range(10)))
        self.assertEqual(peak,2)

    def test_worker_error_is_propagated_without_stitching_partial_results(self):
        def process(item):
            if item[0]==1:raise RuntimeError('native failure')
            return item[0]
        with self.assertRaisesRegex(RuntimeError,'native failure'):
            list(tara_int8.ordered_chunk_results(range(4),process,2))

    def test_closing_iterator_does_not_schedule_rest_of_recording(self):
        started=[]
        def process(item):started.append(item[0]);return item[0]
        iterator=tara_int8.ordered_chunk_results(range(100),process,2)
        self.assertEqual(next(iterator),0)
        iterator.close()
        self.assertLessEqual(len(started),2)

    def test_parallel_profile_dispatches_two_workers_and_keeps_distinct_result_id(self):
        import worker
        events=[]
        def transcribe(root,request,emit):
            self.assertEqual(request['chunkWorkers'],2)
            self.assertEqual(request['taraChunking'],'speech-aware')
            emit('result',{'id':'run','model':'tara-int8','processingMetadata':{'model':'tara-int8'}})
        with tempfile.TemporaryDirectory() as root,patch.object(sys,'argv',['worker.py',root]),patch.object(sys,'stdin',io.StringIO('{"action":"transcribe","model":"tara-int8-speech-aware-parallel"}')),patch.object(worker,'emit',side_effect=lambda *args:events.append(args)),patch.object(tara_int8,'transcribe',side_effect=transcribe):
            worker.main()
        self.assertEqual(events[0][1]['model'],'tara-int8-speech-aware-parallel')

    def test_two_replica_load_receives_two_threads_each(self):
        from types import SimpleNamespace
        import json
        ct2=MagicMock();ct2.models.Whisper.return_value=SimpleNamespace(n_mels=128,compute_type='int8_float32')
        processor=MagicMock();processor.tokenizer.convert_tokens_to_ids.side_effect=lambda t:tara_int8.tara.TOKENS[t]
        transformer=MagicMock();transformer.WhisperProcessor.from_pretrained.return_value=processor
        vocab=['']*51904
        for token,index in tara_int8.tara.TOKENS.items():vocab[index]=token
        with tempfile.TemporaryDirectory() as directory,patch.dict(sys.modules,{'transformers':transformer}):
            folder=Path(directory)
            for name,value in [('vocabulary.json',vocab),('generation_config.json',{'alignment_heads':[[7,0]],'suppress_tokens':[]}),('config.json',{'alignment_heads':[[7,0]]})]:
                (folder/name).write_text(json.dumps(value))
            tara_int8.validate(folder,ct2,intra_threads=2,inter_threads=2)
        self.assertEqual(ct2.models.Whisper.call_args.kwargs['intra_threads'],2)
        self.assertEqual(ct2.models.Whisper.call_args.kwargs['inter_threads'],2)

if __name__=='__main__':unittest.main()
