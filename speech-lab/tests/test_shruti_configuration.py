"""Static default-configuration regression checks; no model loading or inference."""
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'backend'))


class ShrutiConfiguration(unittest.TestCase):
    def test_canonical_shruti_pins_the_approved_python_package_and_existing_engine(self):
        from shruti_runtime import ASSETS, package_error
        from models import MODELS
        self.assertEqual(ASSETS['packageVersion'], '3.2.10')
        self.assertEqual(ASSETS['engineVersion'], '3.3.3')
        self.assertIn('shruti', MODELS)
        self.assertNotIn('shruti-needle-3210', MODELS)
        self.assertNotIn('shruti-fp32', MODELS)
        root = Path(__file__).resolve().parents[1]
        for filename in ['requirements.txt', 'requirements-lock.txt']:
            self.assertIn('cactus-needle==3.2.10', (root/filename).read_text())
        self.assertFalse((root/'backend/shruti_variants.py').exists())
        self.assertFalse((root/'backend/shruti_variant_inference.py').exists())


if __name__ == '__main__': unittest.main()
