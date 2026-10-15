"""Export generated portraits to the game's portrait contract (GDD §16.2.1).

  art_sources/portraits/<id>/<expr>.png  (1024x1536, flat magenta background)
    -> client/public/assets/portraits/<id>/<expr>.png  (460x540, transparent, identical framing per resident)
    -> client/public/assets/portraits/manifest.json   ({id: [expr, ...]})

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
    """Magenta -> transparent with a soft edge and spill suppression."""
    px = np.asarray(img.convert("RGB"), dtype=np.float32)
    r, g, b = px[..., 0], px[..., 1], px[..., 2]
    d = np.sqrt((255 - r) ** 2 + g ** 2 + (255 - b) ** 2)
    t = np.clip((d - KEY_IN) / (KEY_OUT - KEY_IN), 0.0, 1.0)
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
    os.makedirs(os.path.join(DST, rid), exist_ok=True)
    for e, im in keyed.items():
        canvas = Image.new("RGBA", (crop_w, CROP_H), (0, 0, 0, 0))
        canvas.paste(im.crop((left, max(0, top), left + crop_w, top + CROP_H)), (0, max(0, -top)))
        canvas.resize((OUT_W, OUT_H), Image.LANCZOS).save(os.path.join(DST, rid, f"{e}.png"), optimize=True)
    return exprs


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
            for x, e in enumerate(manifest[rid][:6]):
                im = Image.open(os.path.join(DST, rid, f"{e}.png")).resize(cell, Image.LANCZOS)
                sheet.paste(im, (x * cell[0], y * cell[1]), im)
        sheet.save(a.sheet, quality=85)
    return 0


if __name__ == "__main__":
    sys.exit(main())
