"""Synthetic PCM plus mocked VAD/ASR only; no recording or model benchmark."""
from fractions import Fraction
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch
import wave

import av
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from audio import prepare, read_prepared
import caption_audio
import shruti_transcription as adapter


class CaptionAudioClock(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.path = self.root / 'timeline.wav'
        self.samples = np.zeros(16000 * 10, dtype=np.int16)
        self.samples[16000:32000] = 1000
        self.samples[112000:128000] = 2000
        with wave.open(str(self.path), 'wb') as output:
            output.setnchannels(1); output.setsampwidth(2); output.setframerate(16000)
            output.writeframes(self.samples.tobytes())

    def tearDown(self):
        self.temp.cleanup()

    def test_sparse_packet_timestamps_preserve_four_seconds_of_silence_in_prepared_audio(self):
        path = self.root / 'sparse.mka'
        with av.open(str(path), 'w') as output:
            stream = output.add_stream('pcm_s16le', rate=16000); stream.layout = 'mono'
            for second in (0, 5):
                frame = av.AudioFrame.from_ndarray(np.full((1, 16000), 1000, dtype=np.int16), format='s16', layout='mono')
                frame.sample_rate = 16000; frame.time_base = Fraction(1, 16000); frame.pts = second * 16000
                for packet in stream.encode(frame): output.mux(packet)
            for packet in stream.encode(None): output.mux(packet)
        original = path.read_bytes()
        cache = self.root / 'cache'
        audio_cache = cache / 'audio'; audio_cache.mkdir(parents=True)
        old_key = hashlib.sha256(f'{path.resolve()}|{path.stat().st_size}|{path.stat().st_mtime_ns}'.encode()).hexdigest()
        (audio_cache / f'{old_key}.wav').write_bytes(b'old collapsed WAV')
        (audio_cache / f'{old_key}.json').write_text(json.dumps({'duration': 2, 'audioPath': 'obsolete'}))
        result = prepare(cache, path, lambda *_: None)
        samples = read_prepared(result['audioPath'])
        self.assertEqual(result['duration'], 6)
        self.assertTrue(np.all(samples[16000:80000] == 0))
        self.assertGreater(float(samples[80000]), 0)
        from project_audio import prepare_project_audio
        plan = {'projectId': 'clock-test', 'duration': 6, 'clips': [{'id': 'audio', 'path': str(path), 'startTime': 0, 'duration': 6,
                'sourceIn': 0, 'sourceOut': 6, 'speed': 1, 'reversed': False, 'gain': [[0, 1], [6, 1]]}]}
        mixed = read_prepared(prepare_project_audio(cache, plan, lambda *_: None)['audioPath'])
        self.assertTrue(np.all(mixed[16000:80000] == 0))
        self.assertGreater(float(mixed[80000]), 0)
        self.assertEqual(path.read_bytes(), original)
        with patch('av.open', side_effect=AssertionError('reuse verified preparation')):
            self.assertEqual(prepare(self.root / 'cache', path, lambda *_: None), result)

    def test_detector_preserves_sample_offsets_and_uses_existing_local_vad(self):
        with patch('faster_whisper.vad.get_speech_timestamps', return_value=[{'start': 16000, 'end': 32000}, {'start': 112000, 'end': 128000}]) as detect:
            self.assertEqual(caption_audio.speech_regions(self.path), [(16000, 32000), (112000, 128000)])
        np.testing.assert_array_equal(detect.call_args.args[0], self.samples.astype(np.float32) / 32768)
        options = detect.call_args.kwargs['vad_options']
        self.assertEqual(options.min_silence_duration_ms, 600)
        self.assertEqual(options.max_speech_duration_s, 28)

    def test_resampling_keeps_the_source_clock_in_seconds_not_input_sample_units(self):
        path = self.root / 'resampled.mka'
        with av.open(str(path), 'w') as output:
            stream = output.add_stream('pcm_s16le', rate=44100); stream.layout = 'stereo'
            for second in (0, 5):
                frame = av.AudioFrame.from_ndarray(np.full((1, 88200), 1000, dtype=np.int16), format='s16', layout='stereo')
                frame.sample_rate = 44100; frame.time_base = Fraction(1, 44100); frame.pts = second * 44100
                for packet in stream.encode(frame): output.mux(packet)
            for packet in stream.encode(None): output.mux(packet)
        result = prepare(self.root / 'cache', path, lambda *_: None)
        self.assertAlmostEqual(result['duration'], 6, delta=.005)
        samples = read_prepared(result['audioPath'])
        self.assertTrue(np.all(samples[17600:78400] == 0))
        self.assertGreater(float(samples[81600]), 0)

    def test_later_speech_is_offset_after_silence_not_appended_to_previous_speech(self):
        first = {'text': 'Coke है।', 'language': 'hi', 'words': [{'word': 'Coke', 'start': .1, 'end': .3}, {'word': 'है', 'start': .3, 'end': .6}]}
        second = {'text': 'फिर Coke', 'language': 'hi', 'words': [{'word': 'फिर', 'start': .1, 'end': .1}, {'word': 'Coke', 'start': .2, 'end': .5}]}
        model = MagicMock(); model.transcribe.side_effect = [first, second]
        with patch.object(caption_audio, 'speech_regions', return_value=[(16000, 32000), (112000, 128000)]):
            raw = caption_audio.transcribe_timeline(model, self.path, ['Coke'], lambda *_: None)
        result = adapter.normalize_response(raw)
        self.assertEqual(result['text'], 'Coke है। फिर Coke')
        self.assertEqual(result['words'][0]['startTime'], 1.1)
        self.assertEqual(result['words'][2]['startTime'], 7.1)
        self.assertEqual(result['words'][2]['endTime'], 7.1)
        self.assertEqual(result['words'][3]['endTime'], 7.5)
        self.assertIs(raw['chunks'][1]['response'], second)
        self.assertEqual(second['words'][0]['start'], .1)
        np.testing.assert_array_equal(model.transcribe.call_args_list[1].args[0], self.samples[112000:128000].astype(np.float32) / 32768)
        self.assertEqual(model.transcribe.call_args_list[1].kwargs, {'word_timestamps': True, 'keywords': ['Coke']})

    def test_silence_does_not_invoke_asr_or_invent_words(self):
        model = MagicMock()
        with patch.object(caption_audio, 'speech_regions', return_value=[]):
            result = adapter.normalize_response(caption_audio.transcribe_timeline(model, self.path, [], lambda *_: None))
        model.transcribe.assert_not_called()
        self.assertEqual(result['text'], '')
        self.assertEqual(result['words'], [])

    def test_caption_adapter_uses_section_recognition_but_lab_keeps_whole_file_call(self):
        model = MagicMock()
        native = {'text': 'Coke', 'language': 'hi', 'words': [{'word': 'Coke', 'start': .1, 'end': .5}]}
        model.transcribe.return_value = native
        metrics = MagicMock(); metrics.stop_event.is_set.return_value = False; metrics.finish.return_value = {}
        audio = {'audioPath': str(self.path), 'duration': 10, 'audioSha256': 'synthetic'}
        with patch.object(adapter, 'installed', return_value=True), patch.object(adapter, 'initialize', return_value=model), patch.object(adapter, 'Metrics', return_value=metrics), patch.object(caption_audio, 'speech_regions', return_value=[(112000, 128000)]):
            result = adapter.transcribe(self.root, {}, lambda *_: None, prepared_audio=audio, preserve_timeline_silence=True)
        self.assertEqual(result['words'][0]['startTime'], 7.1)
        self.assertEqual(result['processingMetadata']['silenceSegmentation'], 'silero-source-offsets')
        self.assertEqual(result['processingMetadata']['audioSections'], 1)
        self.assertTrue(result['processingMetadata']['vad'])
        self.assertIs(result['rawResponse']['chunks'][0]['response'], native)

    def test_invalid_detector_or_local_word_bounds_are_not_silently_accepted(self):
        with patch('faster_whisper.vad.get_speech_timestamps', return_value=[{'start': 16000, 'end': 32000}, {'start': 30000, 'end': 50000}]), self.assertRaisesRegex(ValueError, 'section bounds'):
            caption_audio.speech_regions(self.path)
        model = MagicMock(); model.transcribe.return_value = {'text': 'late', 'words': [{'word': 'late', 'start': 5, 'end': 6}]}
        with patch.object(caption_audio, 'speech_regions', return_value=[(16000, 32000)]), self.assertRaisesRegex(ValueError, 'outside'):
            caption_audio.transcribe_timeline(model, self.path, [], lambda *_: None)


if __name__ == '__main__': unittest.main()
