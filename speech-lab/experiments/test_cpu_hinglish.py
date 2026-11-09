import unittest
from types import SimpleNamespace
from cpu_hinglish import audit_generation


class FakeTokens:
    def __init__(self, ids): self.ids = ids
    def __getitem__(self, key): return FakeTokens(self.ids[key[1]])
    def detach(self): return self
    def cpu(self): return self
    def tolist(self): return self.ids


class GenerationAuditTests(unittest.TestCase):
    def test_prompt_is_excluded_and_native_output_returned_unchanged(self):
        result = SimpleNamespace(sequences=FakeTokens([10, 11, 21, 22, 3]))
        tokenizer = SimpleNamespace(eos_token_id=3, decode=lambda ids, **kwargs: ' '.join(map(str, ids)))
        records = []
        call = audit_generation(lambda **kwargs: result, tokenizer, records, 1024)
        self.assertIs(call(input_ids=SimpleNamespace(shape=(1, 2))), result)
        self.assertEqual(records[0]['generatedTokenIds'], [21, 22, 3])
        self.assertEqual(records[0]['generatedTokenCount'], 3)
        self.assertEqual(records[0]['stoppingReason'], 'eos')
        self.assertFalse(records[0]['reachedTokenLimit'])

    def test_limit_and_eos_are_distinguished(self):
        tokenizer = SimpleNamespace(eos_token_id=3, decode=lambda ids, **kwargs: str(ids))
        for ids, reason in [([1, 2], 'token-limit'), ([1, 3], 'eos')]:
            with self.subTest(ids=ids):
                records = []
                audit_generation(lambda: FakeTokens(ids), tokenizer, records, 2)()
                self.assertTrue(records[0]['reachedTokenLimit'])
                self.assertEqual(records[0]['stoppingReason'], reason)


if __name__ == '__main__': unittest.main()
