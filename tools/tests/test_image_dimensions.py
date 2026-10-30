import json
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from image_dimensions import dimensions


class DerivativeDimensionsTests(unittest.TestCase):
    def test_dimensions_come_from_derivatives_and_leave_bytes_unchanged(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "预览 图.webp"
            Image.new("RGB", (30, 100), "blue").save(source)
            original = source.read_bytes()
            names = ["/%E9%A2%84%E8%A7%88%20%E5%9B%BE.webp"] * 2
            self.assertEqual(dimensions(root, names), {names[0]: [30, 100]})
            self.assertEqual(source.read_bytes(), original)
            self.assertEqual(dimensions(root, ["/missing.webp"]), {})

    def test_paths_outside_staged_assets_are_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaisesRegex(ValueError, "escapes staged assets"):
                dimensions(Path(temporary), ["/%2E%2E/secret.png"])


if __name__ == "__main__":
    unittest.main()
