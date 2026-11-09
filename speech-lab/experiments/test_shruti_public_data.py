"""Static metadata/split checks; no network, public audio, ASR or training."""
import unittest
from shruti_public_data import candidate, distributed_offsets, normalized_text, validate_disjoint
import random


class PublicPilotMetadataTests(unittest.TestCase):
    def test_candidate_preserves_mixed_script_and_source_identity(self):
        row = {'row_idx':1, 'row':{'transcript':'यह एक keychain है','speaker_id':'speaker',
            'segment_id':'speaker_recording_0001','audio':[{'src':'https://example.invalid/temporary'}]}}
        item = candidate(row,'train')
        self.assertEqual(item['text'],row['row']['transcript'])
        self.assertEqual(item['recording_id'],'speaker_recording')
        self.assertEqual(item['source_split'],'train')
        row['row']['transcript']='all english words'
        self.assertIsNone(candidate(row,'train'))

    def test_sampling_is_deterministic_and_distributed(self):
        a = distributed_offsets(1000,10,random.Random(7))
        self.assertEqual(a,distributed_offsets(1000,10,random.Random(7)))
        self.assertEqual(len({n//100 for n in a}),10)

    def test_normalization_preserves_hindi_combining_marks(self):
        self.assertEqual(normalized_text('यह Keychain! है'), 'यह keychain है')

    def test_rejects_speaker_or_pcm_or_transcript_leakage(self):
        def row(speaker,pcm,text):
            return {'text':text,'metadata':{'speaker_id':speaker,'recording_id':speaker+'_recording','pcmSha256':pcm}}
        good = {'train':[row('a','x','यह keychain है')],'test':[row('b','y','यह frog है')]}
        validate_disjoint(good)
        for bad in [row('a','z','कुछ other text'),row('b','x','कुछ other text'),row('b','z','यह keychain है')]:
            with self.assertRaises(ValueError):validate_disjoint({'train':good['train'],'test':[bad]})


if __name__ == '__main__':unittest.main()
