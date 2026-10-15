#!/usr/bin/env python3
"""Placeholder app icon for the desktop build: desktop/build/icon.png (1024x1024).

Crops the clock tower and heron fountain out of the style bible's night-square painting
(art_sources/style_bible_v2/fountain_lantern_night.png) and lays it on Apple's icon grid: an 824-px rounded
square centred on a 1024-px transparent canvas, with a soft shadow. electron-builder turns this one PNG into
the Mac .icns and the Windows .ico at package time.

    npm run icon -w @monde/desktop        # needs Pillow: python3 -m pip install pillow

To use real icon art instead, replace desktop/build/icon.png with any 1024x1024 PNG (or add build/icon.icns
and build/icon.ico for hand-tuned per-platform files); see desktop/README.md.
"""
import pathlib

from PIL import Image, ImageDraw, ImageFilter

ROOT = pathlib.Path(__file__).resolve().parents[2]
SOURCE = ROOT / "art_sources" / "style_bible_v2" / "fountain_lantern_night.png"
OUT = ROOT / "desktop" / "build" / "icon.png"

SIZE, BODY, RADIUS = 1024, 824, 185  # macOS icon grid
MARGIN = (SIZE - BODY) // 2
# The clock tower and heron sit around x=985 in the 1672x941 painting.
CROP = (985 - 330, 30, 985 + 330, 690)


def rounded_mask(size: int, radius: int) -> Image.Image:
    scale = 4  # draw large and shrink, for smooth corners
    mask = Image.new("L", (size * scale, size * scale), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size * scale - 1, size * scale - 1), radius=radius * scale, fill=255)
    return mask.resize((size, size), Image.LANCZOS)


def main() -> None:
    art = Image.open(SOURCE).convert("RGB").crop(CROP).resize((BODY, BODY), Image.LANCZOS).convert("RGBA")
    mask = rounded_mask(BODY, RADIUS)
    art.putalpha(mask)

    shadow_alpha = Image.new("L", (SIZE, SIZE), 0)
    shadow_alpha.paste(mask.point(lambda a: int(a * 0.45)), (MARGIN, MARGIN + 14))
    shadow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 255))
    shadow.putalpha(shadow_alpha.filter(ImageFilter.GaussianBlur(16)))

    icon = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    icon.alpha_composite(shadow)
    icon.alpha_composite(art, (MARGIN, MARGIN))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    icon.save(OUT, optimize=True)
    print(f"wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
