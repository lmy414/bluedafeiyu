import importlib.util
import io
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "patch_qqbot_adapter.py"
SPEC = importlib.util.spec_from_file_location("patch_qqbot_adapter", MODULE_PATH)
patch = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(patch)


ORIGINAL = r'''import re


def dispatch(t):
    if t == "other":
        return "other"
    elif t in {
                    "GROUP_AT_MESSAGE_CREATE",
                    "C2C_MESSAGE_CREATE",
    }:
        return "group"
    return "none"


def handle(event_type, content):
    if event_type == "other":
        return content
    else:
        if event_type == "nested":
            return content
        elif event_type in {"GROUP_AT_MESSAGE_CREATE",}:
            return content
    return content


def strip_at(content):
    if content:
        stripped = re.sub(r"^@\S+\s*", "", content.strip())
        return stripped
    return content
'''


class PatchQQBotAdapterTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def write_adapter(self, text):
        path = self.root / "adapter.py"
        path.write_bytes(text.encode("utf-8"))
        return path

    def run_patch(self, *args):
        output = io.StringIO()
        with redirect_stdout(output), redirect_stderr(output):
            rc = patch.main([str(self.root / "adapter.py"), *args])
        return rc, output.getvalue()

    def backups(self):
        return sorted(self.root.glob("adapter.py.orig-*"))

    def test_first_run_applies_all_patches_and_creates_backup(self):
        path = self.write_adapter(ORIGINAL)
        original_bytes = path.read_bytes()

        rc, output = self.run_patch()

        self.assertEqual(10, rc)
        text = path.read_text(encoding="utf-8")
        self.assertIn(patch.DISPATCH_INSERT + "\n", text)
        self.assertIn(patch.EVENT_PATCHED + "\n", text)
        self.assertIn(patch.MENTION_PATCHED + "\n", text)
        self.assertIn("已打补丁", output)

        backups = self.backups()
        self.assertEqual(1, len(backups))
        self.assertEqual(original_bytes, backups[0].read_bytes())

    def test_repeat_run_is_clean_and_does_not_create_another_backup(self):
        self.write_adapter(ORIGINAL)
        rc, _ = self.run_patch()
        self.assertEqual(10, rc)
        first_backups = self.backups()
        patched_bytes = (self.root / "adapter.py").read_bytes()

        rc, _ = self.run_patch()

        self.assertEqual(0, rc)
        self.assertEqual(first_backups, self.backups())
        self.assertEqual(patched_bytes, (self.root / "adapter.py").read_bytes())

    def test_missing_anchor_returns_2_without_writing(self):
        broken = ORIGINAL.replace(
            patch.MENTION_ANCHOR + "\n",
            "        raise RuntimeError(\"missing anchor\")\n",
            1,
        )
        path = self.write_adapter(broken)
        before = path.read_bytes()

        rc, output = self.run_patch()

        self.assertEqual(2, rc)
        self.assertIn("第3处", output)
        self.assertEqual(before, path.read_bytes())
        self.assertEqual([], self.backups())

    def test_check_reports_missing_then_clean_without_writing(self):
        path = self.write_adapter(ORIGINAL)
        original_bytes = path.read_bytes()

        rc, output = self.run_patch("--check")

        self.assertEqual(1, rc)
        self.assertIn("--check", output)
        self.assertEqual(original_bytes, path.read_bytes())
        self.assertEqual([], self.backups())

        rc, _ = self.run_patch()
        self.assertEqual(10, rc)

        rc, _ = self.run_patch("--check")
        self.assertEqual(0, rc)

    def test_upstream_group_message_makes_first_patch_unnecessary(self):
        upstream = ORIGINAL.replace(
            patch.DISPATCH_ANCHOR + "\n",
            patch.DISPATCH_ANCHOR
            + "\n                    \"GROUP_MESSAGE_CREATE\",\n",
            1,
        )
        path = self.write_adapter(upstream)

        rc, _ = self.run_patch()

        self.assertEqual(10, rc)
        text = path.read_text(encoding="utf-8")
        self.assertEqual(2, text.count('"GROUP_MESSAGE_CREATE"'))
        self.assertNotIn(patch.DISPATCH_INSERT, text)
        self.assertIn(patch.EVENT_PATCHED + "\n", text)
        self.assertIn(patch.MENTION_PATCHED + "\n", text)


if __name__ == "__main__":
    unittest.main()