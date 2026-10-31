"""Prepare faithful, transparent hero portraits without changing gallery artwork.

Install the small CPU dependency set with:
    python -m pip install Pillow numpy onnxruntime
Run with explicit image and site repositories:
    python tools/prepare_character_portraits.py --content-dir ../ai-girl-stickers --site-dir .

Official rembg weights are downloaded into .build/character-cutouts/models and
checksum-verified. isnet-anime handles character art; BiRefNet-general-lite handles
the two illustrated scenes (other/minimax) after comparison of residual backgrounds.
Inference only estimates alpha; RGB is never generated or
recolored. After alpha estimation, delivery images are trimmed and downsampled to
1600px longest edge with Lanczos. Use --max-edge 0 to retain native RGB pixels.
Existing source transparency is retained, including intentionally translucent art.
The manifest freezes cover work IDs/slugs, source paths/hashes, crop, and output hashes.
A subsequent run reuses the frozen source bindings; --force re-estimates their alpha.
Review sheets, source evidence, and masks stay under .build/character-cutouts.
Review sheets composite each portrait on navy, charcoal, and a checkerboard; the
checkerboard is never written into the transparent output. Output is lossless RGBA
WebP, named by its encoded content SHA-256. Changing --max-edge invalidates reuse.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import re
from urllib.parse import unquote, urlsplit
from urllib.request import urlretrieve

import numpy as np
from PIL import Image, ImageDraw, ImageOps

ROOT = Path(__file__).resolve().parents[1]
CHARACTERS = "deepseek doubao kimi qwen claude gemini grok stepfun glm gpt mimo other owner-picks minimax mistral llama perplexity rwkv hunyuan git novelai huggingface zcode opencode".split()
MODEL = "isnet-anime"
MODEL_URL = "https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-anime.onnx"
MODEL_MD5 = "6f184e756bb3bd901c8849220a83e38e"
MODELS = {
    MODEL: {"url": MODEL_URL, "md5": MODEL_MD5},
    "birefnet-general-lite": {
        "url": "https://github.com/danielgatis/rembg/releases/download/v0.0.0/BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx",
        "md5": "4fab47adc4ff364be1713e97b7e66334",
    },
}
# Visual review: these scenes need general foreground extraction to exclude the
# dark browser backdrop and floating projection; anime masks retain scene lines.
SCENE_MODELS = {"other": "birefnet-general-lite", "minimax": "birefnet-general-lite"}
PIPELINE = "original-rgb-alpha-v2"


def sha256(path: Path) -> str:
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def save_json(path: Path, value: object) -> None:
    text = json.dumps(value, ensure_ascii=False, indent=2) + "\n"
    if path.exists() and path.read_text("utf-8") == text:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(text, "utf-8")
    os.replace(temporary, path)


def freeze_sources(site: Path, content: Path, preview: Path) -> dict:
    site_works = json.loads((site / "dist/site-data.json").read_text("utf-8"))["works"]
    authoritative = json.loads((site / "data/works.json").read_text("utf-8"))
    owner = site / "data/owner-picks.json"
    if owner.exists():
        authoritative += json.loads(owner.read_text("utf-8"))
    by_slug = {work["slug"]: work for work in authoritative}
    rendered = {work["slug"]: work for work in site_works}
    sources = {}
    for character in CHARACTERS:
        html = (preview / f"{character}.html").read_text("utf-8")
        match = re.search(r'class="live-character-portrait"[^>]*><img[^>]*src="([^"]+)".*?<a href="/works/([^"]+)\.html"', html)
        if not match:
            raise ValueError(f"No linked hero artwork in {character}.html")
        thumbnail, slug = match.groups()
        work = by_slug[slug]
        if rendered[slug]["id"] != work["id"]:
            raise ValueError(f"Site/authoritative artwork ID mismatch: {slug}")
        raw = unquote(urlsplit(work["path"]).path)
        relative = raw.split("/main/", 1)[-1] if "/main/" in raw else raw.lstrip("/")
        candidates = [content / relative, content / "dist" / relative.removeprefix("dist/"), content / "dist" / work["fullPath"]]
        source = next((path for path in candidates if path.is_file()), None)
        if source is None:
            raise FileNotFoundError(f"No local source for {character}: {slug}")
        sources[character] = {"workId": work["id"], "workSlug": slug, "source": source.relative_to(content).as_posix(), "sourceSha256": sha256(source), "preview": thumbnail, "workUrl": f"/works/{slug}.html"}
    return sources


class ForegroundAlpha:
    def __init__(self, model_path: Path, name: str):
        import onnxruntime as ort
        self.name = name
        specification = MODELS[name]
        model_path.parent.mkdir(parents=True, exist_ok=True)
        if not model_path.exists():
            temporary = model_path.with_suffix(".download")
            urlretrieve(specification["url"], temporary)
            os.replace(temporary, model_path)
        with model_path.open("rb") as handle:
            digest = hashlib.file_digest(handle, "md5").hexdigest()
        if digest != specification["md5"]:
            raise ValueError(f"Official model checksum mismatch: {model_path}")
        options = ort.SessionOptions()
        options.intra_op_num_threads = min(4, os.cpu_count() or 1)
        options.inter_op_num_threads = 1
        options.enable_cpu_mem_arena = False
        self.session = ort.InferenceSession(str(model_path), sess_options=options, providers=["CPUExecutionProvider"])

    def predict(self, image: Image.Image) -> Image.Image:
        # Matches the corresponding official rembg session preprocessing.
        pixels = np.asarray(image.convert("RGB").resize((1024, 1024), Image.Resampling.LANCZOS), dtype=np.float32)
        pixels /= max(float(pixels.max()), 1e-6)
        pixels -= np.array([0.485, 0.456, 0.406], dtype=np.float32)
        if self.name == "birefnet-general-lite":
            pixels /= np.array([0.229, 0.224, 0.225], dtype=np.float32)
        tensor = np.transpose(pixels, (2, 0, 1))[None]
        prediction = self.session.run(None, {self.session.get_inputs()[0].name: tensor})[0][0, 0]
        if self.name == "birefnet-general-lite":
            prediction = 1 / (1 + np.exp(-np.clip(prediction, -80, 80)))
        low, high = float(prediction.min()), float(prediction.max())
        if high <= low:
            raise ValueError("Segmentation returned a constant mask")
        mask = Image.fromarray(np.clip((prediction - low) * (255 / (high - low)), 0, 255).astype(np.uint8))
        return mask.resize(image.size, Image.Resampling.LANCZOS)


def checker(size: tuple[int, int]) -> Image.Image:
    y, x = np.indices((size[1], size[0]))
    values = np.where(((x // 16 + y // 16) % 2)[..., None], np.array([215, 219, 225], dtype=np.uint8), np.array([245, 247, 250], dtype=np.uint8))
    return Image.fromarray(values.astype(np.uint8), "RGB")


def review_sheets(entries: dict, content: Path, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    items = list(entries.items())
    for offset in range(0, len(items), 3):
        group = items[offset:offset + 3]
        sheet = Image.new("RGB", (1800, 660 * len(group)), "#121923")
        draw = ImageDraw.Draw(sheet)
        for row, (character, entry) in enumerate(group):
            with Image.open(content / "dist" / entry["path"].lstrip("/")) as opened:
                portrait = opened.convert("RGBA")
            portrait.thumbnail((570, 610), Image.Resampling.LANCZOS)
            for column, background in enumerate(["#071a39", "#292c32", None]):
                tile = Image.new("RGB", (600, 630), background) if background else checker((600, 630))
                tile.paste(portrait, ((600 - portrait.width) // 2, (630 - portrait.height) // 2), portrait)
                sheet.paste(tile, (column * 600, row * 660 + 30))
            draw.text((12, row * 660 + 9), f"{character} | {entry['workSlug']} | {entry['width']}x{entry['height']} | navy / charcoal / checker", fill="white")
        sheet.save(destination / f"contact-{offset // 3 + 1:02}.jpg", quality=94, subsampling=0)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--content-dir", required=True, type=Path)
    parser.add_argument("--site-dir", type=Path, default=ROOT)
    parser.add_argument("--preview-dir", type=Path)
    parser.add_argument("--model-path", type=Path)
    parser.add_argument("--review-dir", type=Path)
    parser.add_argument("--max-edge", type=int, default=1600, help="Delivery longest edge; 0 retains native source pixels")
    parser.add_argument("--ids", nargs="+", choices=CHARACTERS)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    if args.max_edge < 0:
        parser.error("--max-edge must be zero or positive")
    site, content = args.site_dir.resolve(), args.content_dir.resolve()
    review = args.review_dir or site / ".build/character-cutouts"
    manifest_path = site / "data/character-portraits.json"
    previous = json.loads(manifest_path.read_text("utf-8")) if manifest_path.exists() else {}
    entries = previous.get("portraits", {})
    if len(entries) == len(CHARACTERS):
        sources = {key: {field: value for field, value in entry.items() if field in {"workId", "workSlug", "source", "sourceSha256", "preview", "workUrl"}} for key, entry in entries.items()}
    else:
        sources = freeze_sources(site, content, args.preview_dir or site / ".build/role-brand-preview/characters")
    save_json(review / "sources.json", sources)
    selected = args.ids or CHARACTERS
    engine = None
    # Keep one inference model resident, processing the reviewed scenes together.
    for character in sorted(selected, key=lambda key: key in SCENE_MODELS):
        binding = sources[character]
        source = content / binding["source"]
        if sha256(source) != binding["sourceSha256"]:
            raise ValueError(f"Frozen source changed: {character}: {source}")
        old = entries.get(character, {})
        selected_model = SCENE_MODELS.get(character, MODEL)
        existing = content / "dist" / old.get("path", "").lstrip("/")
        if not args.force and old.get("pipeline") == PIPELINE and old.get("alphaMethod") in {"source-alpha", selected_model} and old.get("maxEdge") == args.max_edge and old.get("sourceSha256") == binding["sourceSha256"] and existing.is_file() and sha256(existing) == old.get("outputSha256"):
            print(f"{character}: reused {old['path']}", flush=True)
            continue
        with Image.open(source) as opened:
            image = ImageOps.exif_transpose(opened).convert("RGBA")
        original_size = image.size
        alpha = image.getchannel("A")
        retained_alpha = alpha.getextrema()[0] < 255
        if not retained_alpha:
            if engine is None or engine.name != selected_model:
                engine = None
                model_path = args.model_path if selected_model == MODEL and args.model_path else review / "models" / f"{selected_model}.onnx"
                engine = ForegroundAlpha(model_path, selected_model)
            alpha = engine.predict(image)
            image.putalpha(alpha)
        box = alpha.getbbox()
        if box is None or alpha.getextrema()[1] < 128:
            raise ValueError(f"No visible foreground: {character}")
        # Include a small transparent safety margin; never crop visible alpha.
        box = (max(0, box[0] - 4), max(0, box[1] - 4), min(image.width, box[2] + 4), min(image.height, box[3] + 4))
        image = image.crop(box)
        if args.max_edge:
            image.thumbnail((args.max_edge, args.max_edge), Image.Resampling.LANCZOS)
        buffer = io.BytesIO()
        image.save(buffer, format="WEBP", lossless=True, exact=True, method=6)
        payload = buffer.getvalue()
        output_hash = hashlib.sha256(payload).hexdigest()
        public = f"/character-portraits/{character}-{output_hash[:16]}.webp"
        target = content / "dist" / public.lstrip("/")
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists():
            temporary = target.with_suffix(".tmp")
            temporary.write_bytes(payload)
            os.replace(temporary, target)
        entry = {**binding, "path": public, "width": image.width, "height": image.height, "sourceWidth": original_size[0], "sourceHeight": original_size[1], "crop": list(box), "maxEdge": args.max_edge, "alphaMethod": "source-alpha" if retained_alpha else selected_model, "pipeline": PIPELINE, "outputSha256": output_hash, "bytes": len(payload)}
        entries[character] = entry
        (review / "masks").mkdir(parents=True, exist_ok=True)
        alpha.save(review / "masks" / f"{character}.png")
        print(f"{character}: {entry['alphaMethod']} -> {public} ({image.width}x{image.height}, {len(payload)} bytes)", flush=True)
    entries = {key: entries[key] for key in CHARACTERS if key in entries}
    manifest = {"version": 1, "model": MODEL, "modelUrl": MODEL_URL, "modelMd5": MODEL_MD5, "models": MODELS, "pipeline": PIPELINE, "portraits": entries}
    save_json(manifest_path, manifest)
    review_sheets({key: entries[key] for key in selected if key in entries}, content, review)
    print(f"Manifest: {manifest_path}; review: {review}; {len(entries)}/{len(CHARACTERS)} portraits", flush=True)


if __name__ == "__main__":
    main()
