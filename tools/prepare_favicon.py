"""Regenerate the site favicon assets from the source art.

This script lives in the **site repository** (lmy414/bluedafeiyu), but the source
art and the generated favicon files are **images and stay in the content
repository** (lmy414/ai-girl-stickers):

- reads  <content>/assets/ai-nya-favicon_20260915_140054_1.png
- writes <content>/assets/ai-nya-favicon-transparent.png
- writes <content>/dist/favicon.png and <content>/dist/favicon.ico

Usage:

    python tools/prepare_favicon.py --content-dir /path/to/ai-girl-stickers

Content root defaults to CONTENT_DIR / INTAKE_CONTENT_DIR env, else the sibling
`content/` directory next to this repository.
"""

import argparse
import os
import sys
from collections import deque
from pathlib import Path

from PIL import Image


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--content-dir",
        default=os.environ.get("CONTENT_DIR") or os.environ.get("INTAKE_CONTENT_DIR"),
        help="内容仓库根目录（assets/ 与 dist/ 都在它下面）；也可用 CONTENT_DIR 环境变量",
    )
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[1]
    content_root = Path(
        args.content_dir or (repo_root.parent / "content")
    ).resolve()

    source = content_root / "assets" / "ai-nya-favicon_20260915_140054_1.png"
    transparent = content_root / "assets" / "ai-nya-favicon-transparent.png"
    favicon_png = content_root / "dist" / "favicon.png"
    favicon_ico = content_root / "dist" / "favicon.ico"

    if not source.is_file():
        sys.exit(
            f"[favicon] 在内容仓库里找不到源图：{source}\n"
            f"  用 --content-dir <内容仓库根目录> 或 CONTENT_DIR 指定内容仓库。"
        )
    favicon_png.parent.mkdir(parents=True, exist_ok=True)

    image = Image.open(source).convert("RGBA")
    pixels = image.load()
    width, height = image.size

    def is_background(pixel):
        red, green, blue, _ = pixel
        return min(red, green, blue) > 205 and max(red, green, blue) - min(red, green, blue) < 24

    queue = deque()
    seen = set()
    for x in range(width):
        queue.extend(((x, 0), (x, height - 1)))
    for y in range(height):
        queue.extend(((0, y), (width - 1, y)))

    while queue:
        x, y = queue.popleft()
        if (x, y) in seen or not is_background(pixels[x, y]):
            continue
        seen.add((x, y))
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1),
                       (x - 1, y - 1), (x + 1, y - 1), (x - 1, y + 1), (x + 1, y + 1)):
            if 0 <= nx < width and 0 <= ny < height and (nx, ny) not in seen:
                queue.append((nx, ny))

    for x, y in seen:
        red, green, blue, _ = pixels[x, y]
        pixels[x, y] = (red, green, blue, 0)

    image.save(transparent)
    image.resize((512, 512), Image.Resampling.LANCZOS).save(favicon_png, optimize=True)
    image.save(favicon_ico, format="ICO", sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print(f"transparent pixels: {len(seen)}")
    print(f"saved: {transparent}")
    print(f"saved: {favicon_png}")
    print(f"saved: {favicon_ico}")


if __name__ == "__main__":
    main()
