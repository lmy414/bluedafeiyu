"""Generate root Apple touch icons from the content repository's staged favicon."""
import sys
from pathlib import Path

from PIL import Image, ImageOps


def write_icons(source: Path, output: Path) -> None:
    with Image.open(source) as image:
        art = ImageOps.contain(image.convert("RGBA"), (180, 180), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (180, 180), "white")
    canvas.paste(art, ((180 - art.width) // 2, (180 - art.height) // 2), art)
    output.mkdir(parents=True, exist_ok=True)
    for name in ("apple-touch-icon.png", "apple-touch-icon-precomposed.png"):
        canvas.save(output / name, format="PNG", optimize=True)


if __name__ == "__main__":
    write_icons(Path(sys.argv[1]), Path(sys.argv[2]))
