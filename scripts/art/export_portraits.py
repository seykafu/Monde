"""Export generated portraits to the game's portrait contract (GDD §16.2.1).

  art_sources/portraits/<id>/<expr>.png  (1024x1536, flat magenta background)
    -> client/public/assets/portraits/<id>.webp     (one sheet per resident: 460x540 frames left to right, transparent,
                                                      identical framing, in the manifest's order)
    -> client/public/assets/portraits/manifest.json   ({id: [expr, ...]}: frame i is expression i)

One sheet per resident, not one file per expression: itch.io's browser games allow at most 1,000 files, and the 144
portrait identities alone were 864 (and one request per conversation instead of six).

Keying: alpha from the distance to pure magenta, a soft edge between KEY_IN and KEY_OUT, and magenta spill
removed from the edge pixels. Framing: one crop per resident, measured on their neutral, so an expression
change never jumps: the top of the hair sits HAIR_TOP down the frame, the head is centred, and the crop is
CROP_H source pixels tall (23:27). Rows above the source image are transparent.

Usage: python3 scripts/art/export_portraits.py [id,id,...] [--sheet out.jpg]
"""
import argparse
import json
import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SRC = os.path.join(ROOT, "art_sources", "portraits")
DST = os.path.join(ROOT, "client", "public", "assets", "portraits")
SIX = ["neutral", "warm", "sad", "angry", "surprised", "worried"]
OUT_W, OUT_H = 460, 540
CROP_H = 1180                      # source pixels; width follows from 23:27
HAIR_TOP = 0.08                    # top of the hair, as a fraction of the frame height
KEY_IN, KEY_OUT = 90.0, 190.0      # RGB distance from magenta: <= KEY_IN is background, >= KEY_OUT is opaque


def key(img: Image.Image) -> Image.Image:
    """Magenta -> transparent with a soft edge and spill suppression. A render that came back already transparent
    keeps its own alpha (its hidden pixels can be any colour, often black)."""
    rgba = np.asarray(img.convert("RGBA"), dtype=np.float32)
    px = rgba[..., :3]
    r, g, b = px[..., 0], px[..., 1], px[..., 2]
    d = np.sqrt((255 - r) ** 2 + g ** 2 + (255 - b) ** 2)
    t = np.minimum(np.clip((d - KEY_IN) / (KEY_OUT - KEY_IN), 0.0, 1.0), rgba[..., 3] / 255.0)
    # Edge pixels keep their colour minus the magenta that bled into them.
    spill = np.clip(np.minimum(r, b) - g, 0, None) * (t < 1.0) * (1.0 - t * 0.5)
    has = spill > 0
    out = np.stack([np.where(has, np.maximum(g, r - spill), r), g, np.where(has, np.maximum(g, b - spill), b), t * 255], axis=-1)
    return Image.fromarray(np.round(out).astype(np.uint8), "RGBA")


def frame_for(neutral: Image.Image) -> tuple[int, int]:
    """(left, top) of the crop in source pixels, from the keyed neutral's silhouette."""
    alpha = neutral.split()[3]
    bbox = alpha.point(lambda v: 255 if v > 128 else 0).getbbox()
    if not bbox:
        return (0, 0)
    w, h = neutral.size
    crop_w = round(CROP_H * OUT_W / OUT_H)
    top = bbox[1] - round(HAIR_TOP * CROP_H)
    # Centre on the head: the silhouette's middle across its top quarter.
    head = alpha.crop((0, bbox[1], w, min(h, bbox[1] + (bbox[3] - bbox[1]) // 4)))
    hb = head.point(lambda v: 255 if v > 128 else 0).getbbox() or (0, 0, w, 0)
    cx = (hb[0] + hb[2]) // 2
    left = max(0, min(w - crop_w, cx - crop_w // 2))
    return (left, top)


def save_webp(image: Image.Image, path: str) -> int | str:
    """Lossy RGB, exact alpha. Target 38 dB on black/grey composites, up to quality 100; else lossless (returns 0).

    Compare rounded sRGB pixels at the shipped resolution, including transparent areas.
    Keep keying/despilling upstream of compression so re-exports use the same policy.
    """
    image = image.convert("RGBA")
    source = np.asarray(image, dtype=np.float64)
    alpha = source[..., 3:4] / 255.0
    references = [np.round(source[..., :3] * alpha + bg * (1 - alpha)) for bg in (0, 128)]
    for quality in (96, 98, 100):
        image.save(path, format="WEBP", lossless=False, quality=quality, alpha_quality=100, method=6)
        with Image.open(path) as decoded:
            actual = np.asarray(decoded.convert("RGBA"), dtype=np.float64)
        if not np.array_equal(source[..., 3], actual[..., 3]):
            raise ValueError(f"WebP alpha changed: {path}")
        errors = [np.mean((reference - np.round(actual[..., :3] * alpha + bg * (1 - alpha))) ** 2)
                  for reference, bg in zip(references, (0, 128))]
        if max(errors) <= 255 ** 2 / 10 ** (38 / 10):
            return quality
    # Lossy WebP's chroma subsampling caps a few fine-lined portraits near 37 dB even at quality 100: those ship lossless.
    image.save(path, format="WEBP", lossless=True, quality=100, method=6)
    return 0


def export(rid: str) -> list[str]:
    folder = os.path.join(SRC, rid)
    exprs = [e for e in SIX if os.path.exists(os.path.join(folder, f"{e}.png"))]
    extra = sorted(f[:-4] for f in os.listdir(folder) if f.endswith(".png") and f[:-4] not in SIX)
    exprs += extra
    if "neutral" not in exprs:
        return []
    keyed = {e: key(Image.open(os.path.join(folder, f"{e}.png"))) for e in exprs}
    left, top = frame_for(keyed["neutral"])
    crop_w = round(CROP_H * OUT_W / OUT_H)
    frames = []
    for e, im in keyed.items():
        canvas = Image.new("RGBA", (crop_w, CROP_H), (0, 0, 0, 0))
        canvas.paste(im.crop((left, max(0, top), left + crop_w, top + CROP_H)), (0, max(0, -top)))
        frames.append(canvas.resize((OUT_W, OUT_H), Image.LANCZOS))
    save_sheet(frames, os.path.join(DST, f"{rid}.webp"))
    return exprs


def save_sheet(frames: list[Image.Image], path: str) -> int | str:
    """The resident's frames side by side, in manifest order, as one WebP (save_webp's quality policy)."""
    sheet = Image.new("RGBA", (OUT_W * len(frames), OUT_H), (0, 0, 0, 0))
    for i, frame in enumerate(frames):
        sheet.paste(frame.convert("RGBA"), (i * OUT_W, 0))
    return save_webp(sheet, path)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("ids", nargs="?", default="")
    ap.add_argument("--sheet", default="")
    a = ap.parse_args()
    ids = [i for i in a.ids.split(",") if i] or sorted(d for d in os.listdir(SRC) if os.path.isdir(os.path.join(SRC, d)))
    manifest_path = os.path.join(DST, "manifest.json")
    manifest = json.load(open(manifest_path)) if os.path.exists(manifest_path) else {}
    for rid in ids:
        exprs = export(rid)
        if exprs:
            manifest[rid] = exprs
        print(f"{rid}: {', '.join(exprs) or 'skipped (no neutral)'}", flush=True)
    with open(manifest_path, "w") as f:
        json.dump(dict(sorted(manifest.items())), f, indent=1)
        f.write("\n")
    if a.sheet:
        rows = [r for r in sorted(manifest) if r in ids]
        cell = (230, 270)
        sheet = Image.new("RGB", (cell[0] * 6, cell[1] * len(rows)), (60, 52, 70))
        for y, rid in enumerate(rows):
            strip = Image.open(os.path.join(DST, f"{rid}.webp")).convert("RGBA")
            for x in range(min(6, len(manifest[rid]))):
                im = strip.crop((x * OUT_W, 0, (x + 1) * OUT_W, OUT_H)).resize(cell, Image.LANCZOS)
                sheet.paste(im, (x * cell[0], y * cell[1]), im)
        sheet.save(a.sheet, quality=85)
    return 0


if __name__ == "__main__":
    sys.exit(main())
