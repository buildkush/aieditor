import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch
import wave
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
import whistle_spans as adapter


class SpanRecognitionTests(unittest.TestCase):
    def test_only_english_crops_have_context_and_word_offsets_use_original_audio_clock(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'synthetic.wav'
            samples = np.arange(48000, dtype=np.int16)
            with wave.open(str(path), 'wb') as output:
                output.setnchannels(1); output.setsampwidth(2); output.setframerate(16000); output.writeframes(samples.tobytes())
            original = path.read_bytes()
            audio = {'audioPath': str(path), 'audioSha256': 'same', 'duration': 3}
            request = {'path': str(path), 'audioSha256': 'same', 'contextSec': .1, 'keywords': ['Harry Potter'], 'spans': [{'id': 'english', 'language': 'english', 'startTime': 1, 'endTime': 2}]}
            model = MagicMock(); raw = {'text': 'Harry Potter', 'language': 'en', 'words': [{'word': 'Harry', 'start': .1, 'end': .5, 'probability': .9}, {'word': 'Potter', 'start': .5, 'end': .9, 'probability': .95}]}; model.transcribe.return_value = raw
            metrics = MagicMock(); metrics.finish.return_value = {}; metrics.stop_event.is_set.return_value = False
            with patch.object(adapter, 'prepare', return_value=audio), patch.object(adapter, 'installed', return_value=True), patch.object(adapter, 'initialize', return_value=model), patch.object(adapter, 'Metrics', return_value=metrics):
                result = adapter.transcribe(directory, request, lambda *_: None)
            hypothesis = result['hypotheses'][0]
            self.assertEqual(hypothesis['cropStart'], .9)
            self.assertEqual(hypothesis['cropEnd'], 2.1)
            self.assertEqual(hypothesis['words'][0]['startTime'], 1)
            self.assertAlmostEqual(hypothesis['words'][1]['endTime'], 1.8)
            self.assertIs(hypothesis['rawResponse'], raw)
            self.assertEqual(raw['words'][0]['start'], .1)
            np.testing.assert_array_equal(model.transcribe.call_args.args[0], samples[14400:33600].astype(np.float32) / 32768)
            self.assertEqual(model.transcribe.call_args.kwargs, {'language': 'en', 'word_timestamps': True, 'keywords': ['Harry Potter']})
            self.assertEqual(path.read_bytes(), original)

    def test_invalid_hindi_unordered_and_out_of_bounds_spans_are_rejected(self):
        valid = {'id': 'one', 'language': 'english', 'startTime': 1, 'endTime': 2}
        for spans, context in (([{**valid, 'language': 'hindi'}], .1), ([valid, valid], .1), ([{**valid, 'endTime': 5}], .1), ([valid], 1), ([{**valid, 'startTime': float('nan')}], .1)):
            with self.subTest(spans=spans, context=context), self.assertRaises(ValueError): adapter.validate_spans({'spans': spans, 'contextSec': context}, 3)

    def test_worker_routes_only_lab_span_operation(self):
        import worker
        with tempfile.TemporaryDirectory() as directory, patch.object(adapter, 'transcribe', return_value={'hypotheses': []}) as call, patch('sys.argv', ['worker.py', directory]), patch('sys.stdin', io.StringIO(json.dumps({'action': 'whistle_spans'}))), patch('sys.stdout', new_callable=io.StringIO) as output:
            worker.main()
            self.assertEqual(json.loads(output.getvalue())['data'], {'hypotheses': []})
            call.assert_called_once()


if __name__ == '__main__': unittest.main()
