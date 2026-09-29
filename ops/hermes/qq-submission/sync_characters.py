#!/usr/bin/env python3
"""Refresh the plugin's characters.json from the repository canonical copy."""

from __future__ import annotations

import json
from pathlib import Path


PLUGIN_DIR = Path(__file__).resolve().parent
REPO_ROOT = PLUGIN_DIR.parents[2]
SOURCE = REPO_ROOT / "data" / "characters.json"
TARGET = PLUGIN_DIR / "characters.json"


def main() -> None:
    data = json.loads(SOURCE.read_text(encoding="utf-8"))
    TARGET.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"updated {TARGET} from {SOURCE}")


if __name__ == "__main__":
    main()