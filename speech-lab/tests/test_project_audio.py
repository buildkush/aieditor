import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import wave
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from project_audio import prepare_project_audio, validate_plan
from audio import read_prepared


class ProjectAudio(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.source = self.root / 'synthetic.wav'
        self.write(np.full(32000, .2))

    def tearDown(self): self.temp.cleanup()

    def write(self, samples):
        with wave.open(str(self.source), 'wb') as output:
            output.setnchannels(1); output.setsampwidth(2); output.setframerate(16000)
            output.writeframes((samples * 32767).astype('<i2').tobytes())

    def clip(self, **changes):
        return {'id': 'clip', 'path': str(self.source), 'startTime': 1, 'duration': 1, 'sourceIn': .5, 'sourceOut': 1.5, 'speed': 1, 'reversed': False, 'gain': [[0, .5], [1, .5]], **changes}

    def plan(self, clips, duration=3): return {'projectId': 'active-project', 'duration': duration, 'clips': clips}

    def test_mix_respects_trim_offsets_overlap_gain_silence_and_readonly_sources(self):
        original = self.source.read_bytes()
        plan = self.plan([self.clip(), self.clip(id='second', startTime=1.5)])
        audio = prepare_project_audio(self.root / 'cache', plan, lambda *_: None)
        samples = read_prepared(audio['audioPath'])
        self.assertEqual(len(samples), 48000)
        self.assertAlmostEqual(float(samples[8000]), 0, places=4)
        self.assertAlmostEqual(float(samples[18000]), .1, places=3)
        self.assertAlmostEqual(float(samples[26000]), .2, places=3)
        self.assertAlmostEqual(float(samples[35000]), .1, places=3)
        self.assertAlmostEqual(float(samples[45000]), 0, places=4)
        self.assertEqual(self.source.read_bytes(), original)
        with patch('av.open', side_effect=AssertionError('cached mix must not decode again')):
            self.assertEqual(prepare_project_audio(self.root / 'cache', plan, lambda *_: None), audio)

    def test_reverse_and_speed_remain_on_the_original_project_clock(self):
        self.write(np.linspace(0, .8, 32000, endpoint=False))
        clip = self.clip(startTime=.5, duration=.2, sourceIn=.2, sourceOut=.6, speed=2, reversed=True, gain=[[0, 1], [.2, 1]])
        audio = prepare_project_audio(self.root / 'cache', self.plan([clip], 1), lambda *_: None)
        samples = read_prepared(audio['audioPath'])
        self.assertAlmostEqual(float(samples[8000]), .6 * .4, places=3)
        self.assertAlmostEqual(float(samples[11198]), .2 * .4, places=3)
        self.assertAlmostEqual(float(samples[12000]), 0, places=4)

    def test_forward_tempo_uses_pyav_without_pitch_shift(self):
        # Only a synthetic tone for audio preparation; no ASR model is invoked.
        self.write(.2 * np.sin(2 * np.pi * 440 * np.arange(32000) / 16000))
        clip = self.clip(startTime=0, duration=1, sourceIn=0, sourceOut=2, speed=2, gain=[[0, 1], [1, 1]])
        audio = prepare_project_audio(self.root / 'cache', self.plan([clip], 1), lambda *_: None)
        samples = read_prepared(audio['audioPath'])
        frequencies = np.fft.rfftfreq(len(samples), 1 / 16000)
        peak = float(frequencies[np.abs(np.fft.rfft(samples)).argmax()])
        self.assertAlmostEqual(peak, 440, delta=3)
        self.assertEqual(len(samples), 16000)

    def test_volume_envelope_and_changed_source_invalidate_the_cached_mix(self):
        plan = self.plan([self.clip(startTime=0, gain=[[0, 0], [1, 1]])], 1)
        first = prepare_project_audio(self.root / 'cache', plan, lambda *_: None)
        samples = read_prepared(first['audioPath'])
        self.assertGreater(float(samples[12000]), float(samples[4000]) * 2)
        self.write(np.full(32000, .4))
        second = prepare_project_audio(self.root / 'cache', plan, lambda *_: None)
        self.assertNotEqual(first['audioSha256'], second['audioSha256'])

    def test_invalid_or_empty_project_plan_is_not_transcribed(self):
        for plan in (None, {}, self.plan([]), self.plan([self.clip(path='missing.wav')]), self.plan([self.clip(speed=0)])):
            with self.subTest(plan=plan), self.assertRaises(ValueError): validate_plan(plan)

    def test_quick_caption_worker_reuses_shruti_on_prepared_timeline_audio(self):
        import project_audio, shruti_transcription, worker
        audio = {'audioPath': 'prepared.wav', 'duration': 3}
        response = {'text': 'native text', 'processingMetadata': {'audioPreparationSec': 0, 'processingSec': 1}}
        with (patch('auto_captions.status', return_value={'installed':True}), patch.object(project_audio, 'prepare_project_audio', return_value=audio) as mix, patch.object(shruti_transcription, 'transcribe', return_value=response) as recognize,
             patch('sys.argv', ['worker.py', str(self.root)]), patch('sys.stdin', io.StringIO(json.dumps({'action': 'auto_captions', 'quickMode':True, 'plan': self.plan([self.clip()])}))), patch('sys.stdout', new_callable=io.StringIO) as output):
            worker.main()
            result = json.loads(output.getvalue())
        mix.assert_called_once()
        self.assertEqual(recognize.call_args.args[1], {'model': 'shruti', 'keywords': []})
        self.assertIs(recognize.call_args.kwargs['prepared_audio'], audio)
        self.assertTrue(recognize.call_args.kwargs['preserve_timeline_silence'])
        self.assertEqual(result['data']['text'], 'native text')


if __name__ == '__main__': unittest.main()
