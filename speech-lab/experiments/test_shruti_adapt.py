import tempfile
from pathlib import Path
import unittest
from shruti_adapt import normalize, distance, english, rows


class AdaptationMetrics(unittest.TestCase):
    def test_hindi_vowel_marks_survive_normalization(self):
        self.assertEqual(normalize('भाई, इसकी quality अच्छी है।'), ['भाई','इसकी','quality','अच्छी','है'])
        self.assertNotEqual(normalize('की'), normalize('के'))

    def test_word_errors_include_missing_and_added_english_words(self):
        reference = normalize('ये Harry Potter का keychain है')
        hypothesis = normalize('ये hairy bottle का कीच है')
        self.assertEqual(distance(reference, hypothesis), 3)
        self.assertEqual(distance(english(reference), english(hypothesis)), 3)

    def test_case_and_punctuation_are_not_scored_as_recognition_errors(self):
        self.assertEqual(distance(normalize('Harry Potter!'), normalize('harry potter')), 0)

    def test_empty_evaluation_manifest_cannot_report_perfect_accuracy(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)/'empty.jsonl'; path.write_text('')
            with self.assertRaisesRegex(ValueError, 'Empty manifest'): rows(path)


if __name__ == '__main__': unittest.main()
