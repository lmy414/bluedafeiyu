from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))

import generate_image_derivatives as derivatives  # noqa: E402


class GenerateSubmissionsWithoutOriginalsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.root = Path(self.temp_dir.name)
        self.content = self.root / "content"
        self.manifest = self.root / "works.json"
        self.original_manifest = derivatives.SUBMISSIONS_MANIFEST
        self.addCleanup(self.restore_manifest)
        derivatives.configure_paths(self.content)
        derivatives.SUBMISSIONS_MANIFEST = self.manifest

    def restore_manifest(self) -> None:
        derivatives.SUBMISSIONS_MANIFEST = self.original_manifest

    def write_manifest(self, record: dict[str, str]) -> None:
        self.manifest.write_text(json.dumps([record], ensure_ascii=False), encoding="utf-8")

    def write_derivative(self, relative_path: str, size: tuple[int, int]) -> None:
        path = self.content / "dist" / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        Image.new("RGB", size, "white").save(path, format="WEBP")

    def test_existing_derivatives_succeed_without_original(self) -> None:
        record = {
            "id": "sticker_test",
            "characterId": "deepseek",
            "path": "/submissions/originals/deepseek/source.png",
        }
        self.write_manifest(record)
        self.write_derivative("submissions/previews/deepseek/source.webp", (7, 5))
        self.write_derivative("submissions/large/deepseek/source.webp", (11, 9))

        result = derivatives.generate_submissions()

        self.assertEqual(result, (1, 2, 0))
        self.assertFalse(
            (self.content / "dist/submissions/originals/deepseek/source.png").exists()
        )
        saved = json.loads(self.manifest.read_text(encoding="utf-8"))
        self.assertEqual(
            saved[0]["thumbnailPath"], "submissions/previews/deepseek/source.webp"
        )
        self.assertEqual(saved[0]["fullPath"], "submissions/large/deepseek/source.webp")

    def test_missing_original_fails_when_derivative_is_needed(self) -> None:
        self.write_manifest(
            {
                "id": "sticker_test",
                "characterId": "deepseek",
                "path": "/submissions/originals/deepseek/source.png",
            }
        )

        with self.assertRaisesRegex(FileNotFoundError, "source image not found"):
            derivatives.generate_submissions()


if __name__ == "__main__":
    unittest.main()
