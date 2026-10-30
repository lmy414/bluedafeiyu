"""Read local derivative dimensions without reading or changing originals."""
from __future__ import annotations

import json
import sys
from pathlib import Path
from urllib.parse import unquote

from PIL import Image


def dimensions(root: Path, names: list[str]) -> dict[str, list[int]]:
    root = root.resolve()
    result = {}
    for name in dict.fromkeys(names):
        source = (root / unquote(name).lstrip("/")).resolve()
        if not source.is_relative_to(root):
            raise ValueError(f"image path escapes staged assets: {name}")
        if not source.is_file() or source.suffix.lower() == ".svg":
            continue
        with Image.open(source) as image:
            result[name] = [image.width, image.height]
    return result


if __name__ == "__main__":
    print(json.dumps(dimensions(Path(sys.argv[1]), json.load(sys.stdin)), separators=(",", ":")))
