"""Export town art to the game's sprite contract (GDD §16.4, the town lift).

  art_sources/town/<kind>/<id>[__faded].png  ->  client/public/assets/town/<id>[__faded].png
                                              ->  client/public/assets/town/manifest.json

Each sprite is keyed (real alpha passes through; flat magenta is keyed with despill), trimmed to its opaque
bounds, scaled to its real-world size against a resident's height (SIZE, below), given a
crisp binary alpha and a limited palette so it reads as pixel art next to the procedural terrain, and saved.

Manifest entry, per id:
  { "kind": "building" | "prop", "w": px, "h": px,
    "foot": [w_tiles, d_tiles] (buildings only), "width": tiles (props only),
    "states": ["restored"] or ["restored", "faded"] }
Anchor contract: a sprite stands with its bottom-centre on the ground point it belongs to: for a building, the
middle of its footprint's FRONT edge; for a prop, the middle of its base tile. A building's footprint width is
its drawn width in whole tiles.

Usage: python3 scripts/art/export_town.py [--sheet preview.jpg]
"""
import argparse
import json
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
from gen_town import TOWN  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SRC = os.path.join(ROOT, "art_sources", "town")
DST = os.path.join(ROOT, "client", "public", "assets", "town")
TILE_PX = 48           # world px per tile (client/src/util/constants.ts TILE_SIZE)
COLOURS = 64           # palette per sprite after scaling
PERSON_PX = 55         # a resident's on-screen height in world px: every size below is measured against it

# Real-world size per sprite: ("h", px) sets the height, ("w", px) the width (for low, wide things). The model
# fills its canvas whatever the object, so the art's own pixel size says nothing about scale; these do.
SIZE: dict[str, tuple[str, int]] = {
    # buildings: a storey is about 1.4 people, a pitched roof about 1
    "town_hall": ("h", 215), "clocktower": ("h", 335), "library": ("h", 205), "lantern_office": ("h", 190),
    "founders_house": ("h", 215), "st_brigids": ("h", 175), "constabulary": ("h", 165), "lamplighter_cottage": ("h", 150),
    "pell_house": ("h", 190), "bertrand_house": ("h", 195), "okafor_house": ("h", 190), "augusta_house": ("h", 195),
    "townhouse_a": ("h", 185), "townhouse_b": ("h", 185), "townhouse_c": ("h", 185), "townhouse_d": ("h", 185),
    "market_hall": ("h", 195), "bakery": ("h", 180), "general_store": ("h", 175), "gull_and_anchor": ("h", 185),
    "cafe_liss": ("h", 165), "storefront_a": ("h", 185), "storefront_b": ("h", 185), "storefront_c": ("h", 185),
    "cannery": ("h", 225), "boathouse": ("h", 170), "ticket_booth": ("h", 110), "nell_cottage": ("h", 130),
    "vane_office": ("h", 80), "harbormaster_house": ("h", 205), "bunkhouse": ("h", 110), "wharf_cottage": ("h", 130),
    "lighthouse": ("h", 360), "fish_market": ("h", 110), "glasshouse": ("h", 150), "teo_cottage": ("h", 135),
    "bandstand": ("h", 155), "garden_shed": ("h", 100),
    # landmarks and trees
    "fountain": ("w", 140), "old_elm": ("h", 270), "sundial": ("h", 55), "footbridge": ("w", 190), "crane": ("h", 270),
    "oak": ("h", 175), "birch": ("h", 175), "pine": ("h", 195), "willow": ("h", 175), "apple_tree": ("h", 125),
    "bush_round": ("h", 44), "bush_flowering": ("h", 44), "hedge": ("w", 48), "flowerbed": ("w", 72),
    "tall_grass": ("h", 30), "reeds": ("h", 46), "lilypads": ("w", 44), "rock": ("h", 38), "planter": ("w", 50),
    "flower_pots": ("h", 34), "veg_bed": ("w", 96),
    # street furniture and wharf gear
    "lamp_post": ("h", 112), "bench": ("w", 72), "barrel": ("h", 34), "crates": ("h", 40), "handcart": ("w", 70),
    "signpost": ("h", 80), "postbox": ("h", 56), "well": ("h", 92), "notice_board": ("h", 70), "bicycle": ("w", 56),
    "fence": ("w", 48), "stone_wall": ("w", 48), "market_stall": ("h", 100), "bunting": ("w", 144), "picnic_table": ("w", 76),
    "rowboat": ("w", 100), "fishing_boat": ("w", 170), "bollard": ("h", 30), "net_rack": ("h", 80), "lobster_pots": ("h", 44),
    "fish_crates": ("h", 38), "buoy": ("w", 30), "anchor": ("h", 50),
    # life
    "duck": ("h", 22), "gull": ("h", 22), "cat_sleeping": ("w", 28),
}


def keyed(path: str) -> Image.Image:
    im = Image.open(path).convert("RGBA")
    a = np.asarray(im, dtype=np.float32)
    if (a[..., 3] < 8).mean() > 0.05:          # real transparency: trust it
        return im
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    d = np.sqrt((255 - r) ** 2 + g ** 2 + (255 - b) ** 2)
    t = np.clip((d - 90.0) / 100.0, 0.0, 1.0)
    spill = np.clip(np.minimum(r, b) - g, 0, None) * (t < 1.0) * (1.0 - t * 0.5)
    has = spill > 0
    out = np.stack([np.where(has, np.maximum(g, r - spill), r), g, np.where(has, np.maximum(g, b - spill), b), t * 255], -1)
    return Image.fromarray(np.round(out).astype(np.uint8), "RGBA")


def trimmed(im: Image.Image) -> Image.Image:
    bbox = im.split()[3].point(lambda v: 255 if v > 24 else 0).getbbox()
    return im.crop(bbox) if bbox else im


def target_size(tid: str, im: Image.Image) -> tuple[int, int]:
    axis, px = SIZE[tid]
    if axis == "h":
        return max(1, round(im.width * px / im.height)), px
    return px, max(1, round(im.height * px / im.width))


def pixelate(im: Image.Image, size: tuple[int, int]) -> Image.Image:
    small = im.resize(size, Image.LANCZOS)
    alpha = small.split()[3].point(lambda v: 255 if v >= 128 else 0)
    rgb = small.convert("RGB").quantize(colors=COLOURS, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).convert("RGB")
    rgb.putalpha(alpha)
    return rgb


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sheet", default="")
    a = ap.parse_args()
    os.makedirs(DST, exist_ok=True)
    manifest: dict[str, dict] = {}
    for tid, job in TOWN.items():
        folder = os.path.join(SRC, job["kind"])
        base = os.path.join(folder, f"{tid}.png")
        if not os.path.exists(base):
            print(f"{tid}: missing", flush=True)
            continue
        art = trimmed(keyed(base))
        size = target_size(tid, art)
        states = ["restored"]
        out = pixelate(art, size)
        out.save(os.path.join(DST, f"{tid}.png"), optimize=True)
        faded = os.path.join(folder, f"{tid}__faded.png")
        if os.path.exists(faded):
            f = pixelate(trimmed(keyed(faded)), size)
            if f.size != out.size:   # keep both states the same size so a swap never jumps
                f = f.resize(out.size, Image.NEAREST)
            f.save(os.path.join(DST, f"{tid}__faded.png"), optimize=True)
            states.append("faded")
        entry = {"kind": "building" if job["kind"] == "buildings" else "prop", "w": out.width, "h": out.height, "states": states}
        # The footprint follows the drawn width (whole tiles); its depth comes from the generator's brief.
        entry.update({"foot": [max(1, round(out.width / TILE_PX)), job["foot"][1]]} if job["kind"] == "buildings"
                     else {"width": round(out.width / TILE_PX, 2)})
        manifest[tid] = entry
        print(f"{tid}: {out.width}x{out.height} {'+faded' if len(states) > 1 else ''}", flush=True)
    with open(os.path.join(DST, "manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=1, sort_keys=True)
        fh.write("\n")
    if a.sheet:
        ids = sorted(manifest, key=lambda i: (manifest[i]["kind"], -manifest[i]["w"]))
        x = y = row_h = 0
        W = 1600
        placed = []
        for i in ids:
            m = manifest[i]
            if x + m["w"] > W:
                x, y, row_h = 0, y + row_h + 8, 0
            placed.append((i, x, y)); x += m["w"] + 8; row_h = max(row_h, m["h"])
        sheet = Image.new("RGB", (W, y + row_h), (118, 168, 88))
        for i, px, py in placed:
            im = Image.open(os.path.join(DST, f"{i}.png"))
            sheet.paste(im, (px, py), im)
        sheet = sheet.resize((sheet.width * 2, sheet.height * 2), Image.NEAREST)
        sheet.save(a.sheet, quality=85)
    return 0


if __name__ == "__main__":
    sys.exit(main())
