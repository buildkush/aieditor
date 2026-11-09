import unittest
from shruti_verified_data import anchor_boundaries,choose_cuts,lexical,split_clips


class VerifiedClipPreparation(unittest.TestCase):
    def test_anchor_cuts_require_matching_context_and_preserve_hindi_marks(self):
        words='भाई इसकी quality काफी अच्छी है ये एक और chocolate है इसको खोल के देखते हैं'.split()
        native=[{'text':word,'startTime':i*.5,'endTime':(i+1)*.5,'confidence':.9} for i,word in enumerate(words)]
        boundaries=anchor_boundaries(words,native,len(words)*.5)
        cuts=choose_cuts(boundaries,maximum=4,preferred=3)
        self.assertEqual(cuts[0]['referenceWordIndex'],0)
        self.assertEqual(cuts[-1]['referenceWordIndex'],len(words))
        self.assertTrue(all(b['time']-a['time'] <= 4 for a,b in zip(cuts,cuts[1:])))
        self.assertEqual(lexical('अच्छी'),['अच्छी'])
        self.assertNotEqual(lexical('की'),lexical('के'))
        self.assertTrue(all(c['kind']=='exact lexical agreement' for c in cuts[1:-1]))

    def test_unmatched_long_span_fails_instead_of_inventing_word_timing(self):
        words=['correct']*30
        native=[{'text':'wrong','startTime':i,'endTime':i+1} for i in range(30)]
        with self.assertRaisesRegex(ValueError,'Review needed'):
            choose_cuts(anchor_boundaries(words,native,30),maximum=8)

    def test_invalid_native_times_are_rejected(self):
        with self.assertRaisesRegex(ValueError,'unordered'):
            anchor_boundaries(['one','two'],[{'text':'one','startTime':1,'endTime':2},{'text':'two','startTime':0,'endTime':1}],2)

    def test_unique_error_terms_are_kept_out_of_holdout(self):
        clips=[{'text':text} for text in ['ordinary opening','key chain की quality अच्छी है','ये gems और M&Ms हैं','और काफी classy है','ordinary middle','frog वाली chocolate','ordinary later','ये frog वाला shape है','blinkit पे check करो','ordinary ending']]
        groups,protected=split_clips(clips)
        training=' '.join(r['text'] for r in groups['train'])
        self.assertIn('key chain',training);self.assertIn('gems',training);self.assertIn('classy',training);self.assertIn('blinkit',training)
        self.assertIn(clips[7],groups['test'])
        self.assertTrue(all(clips[i] in groups['train'] for i in protected))
        self.assertEqual(sum(map(len,groups.values())),len(clips))


if __name__=='__main__':unittest.main()
