import copy
import json
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from tara_alignment import normalize_alignment, align_words, word_groups, constrain_to_speech, compact_speech, source_time, refine_missing
import tara_int8


class Tokenizer:
    pieces={1:'भाई',2:' Harry',3:' Potter',4:' का',5:' key',6:'chain',7:' M',8:'&',9:'Ms',10:" I",11:"'m",12:' हूँ'}
    def decode(self,ids,skip_special_tokens=True):
        return ''.join(self.pieces.get(t,'') for t in ids)


class TaraWordAlignmentTests(unittest.TestCase):
    def test_boundary_padding_is_not_counted_as_additional_speech_evidence(self):
        words=[{'text':' बार','startTime':5.58,'endTime':5.86},
               {'text':' चलो','startTime':5.86,'endTime':7.76},
               {'text':' देखते','startTime':7.76,'endTime':8.08}]
        speech=[{'start':29184,'end':96256},{'start':121856,'end':159232}]
        result,_=constrain_to_speech(words,speech,0,21.136)
        self.assertAlmostEqual(result[1]['startTime'],7.556)
        self.assertEqual(result[1]['endTime'],7.76)
        self.assertEqual(result[0],words[0]);self.assertEqual(result[2],words[2])

    def test_short_split_word_recovers_when_two_native_paths_agree(self):
        import numpy as np
        speech=[{'start':0,'end':24000},{'start':36800,'end':96000}]
        native=[{'text':'भाई','startTime':0.,'endTime':1.2},
                {'text':' Harry','startTime':1.2,'endTime':2.6},
                {'text':' Potter','startTime':2.6,'endTime':3.}]
        first,_=constrain_to_speech(native,speech,0,6)
        self.assertIsNone(first[1]['startTime'])
        model=MagicMock()
        model.align.return_value=[SimpleNamespace(alignments=[(0,0),(1,60),(2,95),(3,100)],text_token_probs=[.9]*3)]
        output,raw=refine_missing(model,SimpleNamespace(tokenizer=Tokenizer()),np.ones(96000),[1,2,3],speech,0,first,MagicMock(),native)
        self.assertEqual((output[1]['startTime'],output[1]['endTime']),(1.2,2.6))
        self.assertEqual(raw['shortWordConsensusIndices'],[1])
        self.assertEqual(raw['recoveredWordIndices'],[1])
        # Disagreement is not resolved by this fallback.
        model.align.return_value=[SimpleNamespace(alignments=[(0,0),(1,40),(2,95),(3,100)],text_token_probs=[.9]*3)]
        output,raw=refine_missing(model,SimpleNamespace(tokenizer=Tokenizer()),np.ones(96000),[1,2,3],speech,0,first,MagicMock(),native)
        self.assertIsNone(output[1]['startTime'])
        self.assertEqual(raw['shortWordConsensusIndices'],[])

    def test_alignment_compaction_keeps_source_clock_and_asymmetric_cut_mapping(self):
        import numpy as np
        samples=np.arange(10*16000,dtype='float32')
        compact,mapping=compact_speech(samples,[{'start':0,'end':16000},{'start':9*16000,'end':10*16000}])
        join=mapping[0]['compactEnd']/16000
        self.assertAlmostEqual(source_time(join,mapping,end=True),1.06)
        self.assertAlmostEqual(source_time(join,mapping),8.94)
        self.assertEqual(compact[0],samples[0]);self.assertEqual(compact[-1],samples[-1])
        self.assertEqual(len(samples),160000)

    def test_retry_recovers_word_from_audio_without_rewriting_good_neighbours(self):
        import numpy as np
        model=MagicMock();processor=SimpleNamespace(tokenizer=Tokenizer());encode=MagicMock()
        # Two words, a long pause, and the third word. The first pass had
        # stretched the middle word across the pause, so its timing was rejected.
        speech=[{'start':0,'end':32000},{'start':8*16000,'end':10*16000}]
        original=[{'text':'भाई','startTime':30.,'endTime':30.2,'confidence':.8},
            {'text':' Harry','startTime':None,'endTime':None,'confidence':.7},
            {'text':' Potter','startTime':38.2,'endTime':38.8,'confidence':.9}]
        model.align.return_value=[SimpleNamespace(alignments=[(0,0),(1,10),(2,30),(3,50)],text_token_probs=[.8,.7,.9])]
        recovered,raw=refine_missing(model,processor,np.ones(160000,dtype='float32'),[1,2,3],speech,30,original,encode)
        self.assertAlmostEqual(recovered[1]['startTime'],30.2)
        self.assertAlmostEqual(recovered[1]['endTime'],30.6)
        self.assertEqual(recovered[0],original[0]);self.assertEqual(recovered[2],original[2])
        self.assertIsNone(original[1]['startTime']);self.assertEqual(raw['recoveredWordIndices'],[1])
        model.generate.assert_not_called();encode.assert_called_once()
        self.assertEqual(model.align.call_args.args[2],[[1,2,3]])

    def test_retry_cannot_overlap_good_word_or_return_a_multi_second_word(self):
        import numpy as np
        original=[{'text':'भाई','startTime':0.,'endTime':1.,'confidence':.8},
            {'text':' Harry','startTime':None,'endTime':None,'confidence':.9}]
        model=MagicMock();speech=[{'start':0,'end':32000},{'start':128000,'end':160000}]
        for path in ([(0,0),(1,10),(2,20)],[(0,0),(1,50),(2,150)]):
            model.align.return_value=[SimpleNamespace(alignments=path,text_token_probs=[.8,.9])]
            output,raw=refine_missing(model,SimpleNamespace(tokenizer=Tokenizer()),np.ones(160000),[1,2],speech,0,original,MagicMock())
            self.assertEqual(output,original)
            self.assertEqual(raw['recoveredWordIndices'],[])

    def test_failed_retry_retains_original_interval_for_manual_adjustment(self):
        import numpy as np
        model=MagicMock();processor=SimpleNamespace(tokenizer=Tokenizer())
        model.align.return_value=[SimpleNamespace(alignments=[(0,0),(1,500)],text_token_probs=[.9])]
        words,raw,warnings=align_words(model,processor,object(),np.ones(160000,dtype='float32'),[1],
            speech=[{'start':0,'end':16000},{'start':144000,'end':160000}],reencode=MagicMock(side_effect=MemoryError('retry memory')))
        self.assertEqual(words[0]['text'],'भाई')
        self.assertEqual((words[0]['startTime'],words[0]['endTime']),(0,10))
        self.assertTrue(words[0]['timingNeedsReview'])
        self.assertEqual(raw['retainedNativeTimingIndices'],[0])
        self.assertIn('retry memory',raw['refinement']['error']);self.assertIn('needs review',warnings[0])
        model.generate.assert_not_called()

    def test_native_zero_length_interval_is_not_fabricated(self):
        import numpy as np
        model=MagicMock();processor=SimpleNamespace(tokenizer=Tokenizer())
        model.align.return_value=[SimpleNamespace(alignments=[(0,5),(1,5)],text_token_probs=[.9])]
        words,raw,_=align_words(model,processor,object(),np.ones(16000,dtype='float32'),[1],speech=[{'start':0,'end':16000}])
        self.assertIsNone(words[0]['startTime']);self.assertEqual(raw['retainedNativeTimingIndices'],[])

    def test_pause_with_background_noise_moves_entry_without_moving_exit(self):
        import numpy as np
        # Native path incorrectly attaches the whole pause to the second word.
        model=MagicMock();processor=SimpleNamespace(tokenizer=Tokenizer())
        model.align.return_value=[SimpleNamespace(alignments=[(0,0),(1,50),(2,785)],text_token_probs=[.9,.9])]
        words,raw,_=align_words(model,processor,object(),np.ones(16*16000,dtype='float32')*.02,[1,2],27,
            speech=[{'start':0,'end':16000},{'start':15*16000,'end':16*16000}])
        self.assertAlmostEqual(words[1]['startTime'],41.94)
        self.assertAlmostEqual(words[1]['endTime'],42.7)
        self.assertEqual(words[0]['endTime'],28)
        self.assertEqual(raw['timingAdjustments'][0]['originalStartTime'],28)
        self.assertEqual(''.join(w['text'] for w in words),'भाई Harry')

    def test_trailing_pause_is_trimmed_and_continuous_speech_is_unchanged(self):
        original=[{'text':'word','startTime':.2,'endTime':8.,'confidence':.9}]
        words,_=constrain_to_speech(original,[{'start':0,'end':16000}],0,10)
        self.assertAlmostEqual(words[0]['endTime'],1.06)
        self.assertEqual(original[0]['endTime'],8)
        words,changes=constrain_to_speech(original,[{'start':0,'end':160000}],0,10)
        self.assertEqual(words,original);self.assertEqual(changes,[])

    def test_short_word_after_pause_excludes_previous_words_vad_padding(self):
        words=[{'text':'हैं','startTime':28.864,'endTime':29.044},
               {'text':' ये','startTime':29.044,'endTime':43.704}]
        constrained,_=constrain_to_speech(words,[{'start':450048,'end':465920},
            {'start':698368,'end':746496}],0,50)
        self.assertAlmostEqual(constrained[1]['startTime'],43.588)
        self.assertEqual(constrained[1]['endTime'],43.704)
        self.assertEqual(constrained[0],words[0])

    def test_ambiguous_multiple_speech_regions_and_no_speech_are_not_guessed(self):
        word={'text':'word','startTime':0.,'endTime':10.,'confidence':.9}
        for speech in ([],[{'start':0,'end':16000},{'start':9*16000,'end':10*16000}]):
            words,_=constrain_to_speech([word],speech,0,10)
            self.assertIsNone(words[0]['startTime']);self.assertIsNone(words[0]['endTime'])

    def test_mixed_script_and_connected_english_tokens_are_grouped_without_rewriting(self):
        tokens=list(range(1,13));groups=word_groups(Tokenizer(),tokens)
        self.assertEqual([g['text'] for g in groups],['भाई',' Harry',' Potter',' का',' keychain',' M&Ms'," I'm",' हूँ'])
        self.assertEqual(''.join(g['text'] for g in groups),Tokenizer().decode(tokens))

    def test_unicode_byte_pieces_are_not_split_into_separate_words(self):
        tokenizer=MagicMock()
        tokenizer.decode.side_effect=lambda ids,**_: {(1,2):'भाई',(1,):'�',(2,):'�'}[tuple(ids)]
        self.assertEqual(word_groups(tokenizer,[1,2]),[{'text':'भाई','first':0,'last':2}])

    def test_times_come_from_native_frames_and_keep_chunk_offset(self):
        result=SimpleNamespace(alignments=[(0,10),(0,11),(1,25),(2,40)],text_token_probs=[.8,.9])
        words,rejected=normalize_alignment(Tokenizer(),[1,2],result,2,30)
        self.assertEqual(rejected,0)
        self.assertEqual([(w['startTime'],w['endTime']) for w in words],[(30.2,30.5),(30.5,30.8)])

    def test_missing_or_zero_length_boundaries_are_unavailable_without_interpolation(self):
        result=SimpleNamespace(alignments=[(0,10),(1,10)],text_token_probs=[.8,.9])
        words,rejected=normalize_alignment(Tokenizer(),[1,2],result,2,0)
        self.assertEqual(rejected,2)
        self.assertTrue(all(w['startTime'] is None and w['endTime'] is None for w in words))

    def test_word_absorbing_a_pause_is_rejected_and_later_word_stays_on_original_clock(self):
        result=SimpleNamespace(alignments=[(0,5),(1,70),(2,90)],text_token_probs=[.8,.9])
        words,rejected=normalize_alignment(Tokenizer(),[1,2],result,2,20,[(.4,1.2)])
        self.assertEqual(rejected,1)
        self.assertIsNone(words[0]['endTime'])
        self.assertEqual(words[1]['startTime'],21.4)

    def test_non_monotonic_out_of_bounds_and_nonfinite_values_fail(self):
        for path,probs in [([(0,5),(1,2),(2,20)],[.8,.9]), ([(0,0),(1,10),(2,200)],[.8,.9]), ([(0,0),(1,10),(2,20)],[float('nan'),.9]), ([(0,0),(1,10.5),(2,20)],[.8,.9])]:
            with self.assertRaises(ValueError):
                normalize_alignment(Tokenizer(),[1,2],SimpleNamespace(alignments=path,text_token_probs=probs),1,0)

    def test_native_alignment_uses_mixedcode_prefix_without_duplicating_notimestamps(self):
        import numpy as np
        model=MagicMock();encoded=object();processor=SimpleNamespace(tokenizer=Tokenizer())
        model.align.return_value=[SimpleNamespace(alignments=[(0,0),(1,10),(2,20)],text_token_probs=[.8,.9])]
        words,raw,warnings=align_words(model,processor,encoded,np.ones(16000,dtype='float32')*.1,[1,2],3)
        args=model.align.call_args.args
        self.assertIs(args[0],encoded)
        self.assertEqual(args[1],[50258,50276,51866,50360])
        self.assertEqual(args[2],[[1,2]])
        self.assertEqual(args[3],[100])
        self.assertEqual(words[0]['startTime'],3)

    def test_generation_reuses_encoder_output_for_alignment_and_preserves_text(self):
        import numpy as np
        model,processor,ct2=MagicMock(),MagicMock(),MagicMock()
        processor.return_value.input_features=np.zeros((1,128,3000),dtype='float32')
        processor.tokenizer=Tokenizer();processor.tara_suppress_tokens=[]
        model.generate.return_value=[SimpleNamespace(sequences_ids=[[1,2]])]
        context={'offset':12}
        with patch('tara_alignment.align_words',return_value=([{'text':'भाई','startTime':12,'endTime':12.3}],{},[])) as align:
            text,ids,_=tara_int8.generate_chunk(model,processor,np.ones(16000),ct2,context)
        self.assertEqual(text,'भाई Harry')
        model.encode.assert_called_once()
        self.assertIs(model.generate.call_args.args[0],model.encode.return_value)
        self.assertIs(align.call_args.args[2],model.encode.return_value)
        self.assertEqual(context['words'][0]['startTime'],12)

    def test_alignment_failure_keeps_recognition_and_marks_missing_times(self):
        import numpy as np
        model,processor,ct2=MagicMock(),MagicMock(),MagicMock()
        processor.return_value.input_features=np.zeros((1,128,3000),dtype='float32')
        processor.tokenizer=Tokenizer();processor.tara_suppress_tokens=[]
        model.generate.return_value=[SimpleNamespace(sequences_ids=[[1,2]])];context={'offset':0}
        with patch('tara_alignment.align_words',side_effect=ValueError('bad path')):
            text,_,_=tara_int8.generate_chunk(model,processor,np.ones(16000),ct2,context)
        self.assertEqual(text,'भाई Harry')
        self.assertTrue(all(w['startTime'] is None for w in context['words']))
        self.assertIn('bad path',context['warnings'][0])

    def test_saved_result_is_aligned_without_generation_and_original_is_immutable(self):
        import numpy as np
        audio={'audioSha256':'same','audioPath':'cache.wav','duration':1}
        prior={'id':'original','model':'tara-int8','source':audio,'text':'भाई Harry','words':[],
               'processingMetadata':{'processingSec':10},'rawResponse':{'inputChunks':[{'inputStartSec':0,'inputEndSec':1,'text':'भाई Harry','tokenIds':[1,2]}]}}
        before=copy.deepcopy(prior)
        meter=MagicMock();meter.stop_event.is_set.return_value=True;meter.finish.return_value={'peakRamBytes':123}
        processor=MagicMock();processor.tokenizer=Tokenizer();processor.return_value.input_features=np.zeros((1,128,3000),dtype='float32')
        model=MagicMock()
        with patch.dict(sys.modules,{'torch':MagicMock()}),patch.object(tara_int8,'activate_runtime',return_value=(MagicMock(),[])),patch.object(tara_int8,'validate',return_value=(processor,model)),patch('audio.read_prepared',return_value=np.ones(16000)),patch('hardware.Metrics',return_value=meter),patch('tara_alignment.align_words',return_value=([{'text':'भाई','startTime':0,'endTime':.2}],{},[])):
            result=tara_int8.align_saved(Path('cache'),{'prepared':audio,'priorResult':prior},lambda *_:None)
        model.generate.assert_not_called();self.assertEqual(prior,before)
        self.assertEqual(result['text'],prior['text']);self.assertNotEqual(result['id'],prior['id'])
        self.assertEqual(result['processingMetadata']['alignedFromRunId'],'original')

    def test_saved_audio_hash_and_chunk_gaps_are_rejected_before_loading(self):
        with self.assertRaisesRegex(ValueError,'prepared audio'):
            tara_int8.align_saved('cache',{'prepared':{'audioSha256':'new'},'priorResult':{'model':'tara-int8','source':{'audioSha256':'old'}}},lambda *_:None)
        prior={'model':'tara-int8','source':{'audioSha256':'same'},'text':'भाई','rawResponse':{'inputChunks':[{'inputStartSec':.5,'inputEndSec':1,'text':'भाई','tokenIds':[1]}]}}
        with self.assertRaisesRegex(ValueError,'contiguously'):
            tara_int8.align_saved('cache',{'prepared':{'audioSha256':'same','duration':1},'priorResult':prior},lambda *_:None)


if __name__=='__main__':unittest.main()
