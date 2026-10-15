"""Style bible v2 (MVP A-01, revised 2026-10-14): cartoon direction, Fire Emblem x Stardew Valley.

Kasey's direction: less like Ravage's painterly art, more cartoon; a mix of Fire Emblem and Stardew Valley.
Interpretation (GDD §16.1):
  - Portraits: Fire Emblem character-art construction (clean line art, cel shading, expressive faces) with
    Stardew Valley warmth (rounder, friendlier proportions, warm saturated palette).
  - Backdrops: clean cozy cartoon illustration (crisp shapes, flat colour + soft cel shading, bright palette).
  - The world (tiles, sprites): Stardew-style chunky pixel art on the 3/4 diorama board.
Style keys are generated first with no reference; everything else references a key so the set stays coherent.

Usage:
  python3 scripts/art/gen_style_bible_v2.py art_sources/style_bible_v2 [id,id,...] [--workers 4]
"""
import argparse
import concurrent.futures as cf
import os
import re
import shutil
import subprocess
import sys

MODEL = os.environ.get("MONDE_IMAGE_MODEL", "gpt-6-astra")
RULES = ("Do not write code, do not run commands, do not try to copy or save files: just generate the image, "
         "then reply with the full path of the generated image.")
HEAD = "You are generating game art. Use your built-in image generation tool to create ONE image. " + RULES + "\n\n"

ERA = ("World: a small seaside town in a timeless 'storybook modern' era: bicycles, hand carts, enamel signs, "
       "knitwear, aprons, wool caps. No modern technology, no cars, no logos or brand names, no readable text.")

PORTRAIT_STYLE = (
    "Art style: a cozy cartoon game character portrait that blends Fire Emblem character art with Stardew Valley. "
    "From Fire Emblem: clean, confident line art, cel shading with soft gradients, crisp highlights in the eyes and "
    "hair, an expressive anime-influenced face drawn with care. From Stardew Valley: warmth and charm, slightly "
    "rounder and friendlier proportions, a warm saturated palette, a little gentle humour in the character. "
    "Clean cartoon rendering: NOT painterly, NOT photorealistic, no visible brush strokes, no heavy texture.")
BACKDROP_STYLE = (
    "Art style: a cozy cartoon illustration for a visual-novel background, blending Stardew Valley's world with "
    "Fire Emblem's environment art: clean shapes, crisp dark-brown outlines, flat colour with soft cel shading, a "
    "bright warm saturated palette, simple readable forms, a little whimsical. NOT painterly, NOT photorealistic, "
    "no visible brush strokes, no heavy texture. Wide 16:9 frame.")
PIXEL_BACKDROP_STYLE = (
    "Art style: high-resolution pixel art in the style of Stardew Valley: chunky, clearly visible square pixels, a "
    "limited warm palette, clean dithering, cozy and bright. Wide 16:9 frame.")
PIXEL_PORTRAIT_STYLE = (
    "Art style: a pixel-art character portrait in the style of Stardew Valley's dialogue portraits, with the "
    "expressive face of a classic Fire Emblem (GBA era) portrait: chunky visible pixels, a limited palette, a dark "
    "outline, warm and charming.")

MATCH_PORTRAIT = ("Match the attached reference portrait's art style EXACTLY (line weight, cel shading, colouring, "
                  "eye style, level of detail, framing, background treatment). It is a different person.\n\n")
MATCH_BACKDROP = ("Match the attached reference image's art style EXACTLY (outlines, flat colour, shading, palette "
                  "handling, level of detail). It is a different place.\n\n")
NO_PEOPLE = "\n\nIMPORTANT: no people, no figures, no text, no border, no frame."
FRAMING = ("Framing: head and shoulders, the shoulders reaching the bottom edge, the face in the upper half of the "
           "picture, a three-quarter view turned slightly to the right. Portrait orientation, 2:3 (1024x1536).\n\n"
           "Background: the ENTIRE background is one flat, solid, pure magenta (#FF00FF): no gradient, no vignette, no "
           "shadow, no glow, no scenery. No text, no border, no frame.")


def portrait(desc: str, expr: str, style: str = PORTRAIT_STYLE, match: bool = True) -> str:
    return HEAD + (MATCH_PORTRAIT if match else "") + style + "\n\n" + ERA + "\n\nThe character: " + desc + \
        "\n\nExpression: " + expr + "\n\n" + FRAMING


def backdrop(scene: str, style: str = BACKDROP_STYLE, match: bool = True, extra: str = "") -> str:
    return HEAD + (MATCH_BACKDROP if match else "") + style + "\n\n" + scene + "\n\n" + ERA + NO_PEOPLE + extra


ODILE = ("Odile Fournier, 64, the town baker. Broad-shouldered and strong, forearms dusted with flour, grey hair pinned "
         "up in a bun with a pencil stuck through it, a small burn scar on her left forearm, a white baker's apron over a "
         "dark striped shirt with rolled sleeves. Gruff on the outside, soft underneath.")
PELL = ("Edwina Pell, 71, the town's mayor. Small and upright, a neat silver bob, half-moon reading glasses on a beaded "
        "chain, a soft wool cardigan buttoned one hole off, an ink smudge on her right cuff. Kind, tired eyes.")
TIB = ("Tobias 'Tib' Okafor, 11, a Black boy who is small for his age, with a cowlick that will not lie flat, big curious "
       "eyes, a scuffed knitted jumper, a canvas satchel strap across his chest, a magnifying glass with a cracked rim on a "
       "cord round his neck. Scrappy and clever.")
ROOK = ("Roland 'Rook' Mercer, 33, a former mill worker who now leads a small gang of toughs. An ordinary, tired face, not "
        "glamorous: stubble, a small scar through one eyebrow, a grey wool flat cap pulled low, a worn canvas work jacket, a "
        "brass whistle on a bootlace round his neck. Prickly, guarded, a bit sad.")

MARKET_ROW = ("Market Row in Monde: a narrow cobbled shopping street of two-storey buildings with striped awnings, seen at "
              "street level looking down the row on a sunny late afternoon. Restored and thriving: shutters up, fresh "
              "paint in warm colours, flower boxes overflowing, bunting across the street, café tables outside, a bakery "
              "window full of bread, clean cobbles, the sea glinting at the end of the street.")

# id -> (reference id or None, prompt)
JOBS = {
    # ---- style keys (no reference)
    "portrait_odile": (None, portrait(ODILE, "neutral and a little gruff: level gaze, mouth set, one eyebrow slightly raised.", match=False)),
    "market_row_restored": (None, backdrop(MARKET_ROW, match=False)),
    "gameplay_mockup": (None, HEAD + """A mockup screenshot of a cozy town-life game, 16:9. The game world is shown from a 3/4 top-down angle as a slightly tilted diorama board, drawn in Stardew Valley-style pixel art (chunky visible pixels, warm bright palette): a small cobbled town square with a stone fountain topped by a bronze heron, shopfronts with striped awnings, lamp posts, flower boxes, a bench, an orange cat. Four small chunky pixel-art townsfolk, about two tiles tall, stand about the square, and the player character walks near the fountain. At the bottom, a visual-novel dialogue box with a warm parchment panel; on its left, a Fire Emblem-style cel-shaded cartoon portrait of a gruff older woman baker with flour on her arms and a pencil in her grey bun; the name plate reads "Odile". The dialogue text reads: "Oven's been hot since four. Sit or don't." A small clock and day counter sit in the top corner reading "Day 3 · 9:40".

""" + ERA.replace("no readable text.", "only the name plate, dialogue line and clock text described above.")),
    # ---- alternates for Kasey to compare (pixel-art leaning)
    "alt_pixel_portrait_odile": (None, portrait(ODILE, "neutral and a little gruff.", style=PIXEL_PORTRAIT_STYLE, match=False)),
    "alt_pixel_market_row": (None, backdrop(MARKET_ROW, style=PIXEL_BACKDROP_STYLE, match=False)),
    # ---- referenced against the keys
    "portrait_pell": ("portrait_odile", portrait(PELL, "calm and neutral, attentive, the faintest warmth around the eyes.")),
    "portrait_tib": ("portrait_odile", portrait(TIB, "curious, eyes bright, the corner of the mouth about to grin.")),
    "portrait_rook": ("portrait_odile", portrait(ROOK, "guarded: jaw set, eyes watchful, no smile.")),
    "market_row_faded": ("market_row_restored", HEAD + """The attached image is a background from our game. Create ONE new image of EXACTLY the same street from exactly the same viewpoint, with the same buildings, the same composition and the same cartoon art style, but faded and struggling: an overcast grey afternoon, half the shops shuttered with peeling paint and boarded windows, empty flower boxes, no bunting, no café tables, litter in the gutter, desaturated cool colours. Only the bakery's window is still lit and warm. Quiet and a little sad, still cozy rather than grim. Same 16:9 framing.""" + NO_PEOPLE),
    "monde_dawn_breakwater": ("market_row_restored", backdrop("Monde at dawn, seen from the far end of a long stone breakwater looking back at the town: a small seaside town on a gentle hill where a river meets a bay, pastel houses with slate roofs, a four-faced clocktower in the old quarter, a covered market hall, rusting cranes and a shuttered cannery on the waterfront, a tall stone lighthouse (dark) on the breakwater in the left foreground, gulls. Soft peach and gold first light, a little mist on the water.", extra=" (gulls are fine)")),
    "fountain_lantern_night": ("market_row_restored", backdrop("Fountain Square on Lantern Night: a small cobbled square at night, a round stone fountain with a bronze heron standing on one leg, water running; a four-faced clocktower lit warm behind it; strings of paper lanterns criss-crossing the square and lanterns on every window sill and doorstep; a deep blue sky with stars. Festive and tender.")),
    "bakery_interior": ("market_row_restored", backdrop("Inside Fournier & Fille, a small old bakery before dawn: a big brick bread oven with an arched mouth glowing orange, flour-dusted wooden counters, racks of round loaves and long baguettes, copper pans on hooks, a blank chalkboard, sacks of flour, and an orange cat with a notched ear asleep on a flour sack. Warm firelight against blue pre-dawn light from the window.", extra=" (the cat is required)")),
    "station_hill_dusk": ("market_row_restored", backdrop("Station Hill above Monde at dusk: a small derelict railway station with a wooden canopy, grass growing between the rails, a rusty water tower, a little signal box with tall windows, a weathered bench at a lookout; far below, the town and the bay with a few windows lighting up. Golden-hour light, wind in the grass. No trains.")),
}

# The six dialogue portraits every character gets (GDD §16.2), drawn against their neutral key so only the face moves.
EXPRESSIONS = {
    "warm": "warm and pleased: a genuine smile, softened eyes, a little colour in the cheeks.",
    "sad": "sad: brows drawn up in the middle, eyes lowered, mouth turned down, shoulders a touch lower.",
    "angry": "angry: brows down and angled, eyes narrowed, jaw set, nostrils flared, lips pressed thin.",
    "surprised": "surprised: eyebrows high, eyes wide, mouth open in a small round O.",
    "worried": "worried: brows tilted up and pinched together, a wavering mouth, eyes glancing aside.",
}


def expression_variant(name: str, expr: str) -> str:
    return HEAD + ("The attached image is " + name + "'s neutral portrait from our game. Create ONE new image of EXACTLY "
                   "the same character: same face, hair, clothes, colours, pose, framing, line art and cel shading, and "
                   "the same flat pure magenta (#FF00FF) background. Change ONLY the facial expression (and the smallest "
                   "natural shift of head and shoulders that goes with it).\n\nNew expression: " + expr +
                   "\n\nNo text, no border, no frame.")


for _expr, _desc in EXPRESSIONS.items():
    JOBS[f"odile_{_expr}"] = ("portrait_odile", expression_variant("Odile", _desc))

# The player's walk cycle as a sprite sheet (sheet contract: client/public/assets/sprites/README or GDD §16).
JOBS["walk_sheet_player"] = (None, HEAD + """A pixel-art sprite sheet for a cozy top-down town-life game in the style of Stardew Valley: chunky, clearly visible square pixels, a limited warm palette, a dark soft outline. One character, a friendly young adult townsperson with short brown hair, a teal knitted jumper, brown trousers and boots, about two tiles tall (proportions like Stardew Valley's villagers: big head, small body).

Layout: a precise grid of 4 rows by 4 columns, every cell the same size with the character centred and feet on the same baseline. Row 1: walking towards the viewer (facing down). Row 2: walking left. Row 3: walking right. Row 4: walking away (facing up). The 4 columns in each row are one walk cycle: left foot forward, passing, right foot forward, passing, with arms swinging opposite the legs and a one-pixel bob on the passing frames.

Background: the ENTIRE background is one flat, solid, pure magenta (#FF00FF). No grid lines, no labels, no text, no shadows.""")

PATH_RE = re.compile(r"(/[^`'\"\s]*?generated_images/[^`'\"\s]*?\.png)")


def magenta_background(png: str) -> bool:
    """True when the image's edges are the flat magenta the keyer needs (the model sometimes paints a dark glow)."""
    try:
        from PIL import Image
    except ImportError:
        return True
    im = Image.open(png).convert("RGBA")
    w, h = im.size
    points = [(5, 5), (w - 6, 5), (5, h // 3), (w - 6, h // 3)]
    # Real transparency is even better than magenta: the keyer passes it through.
    keyable = lambda c: c[3] == 0 or (c[0] > 200 and c[1] < 70 and c[2] > 200)  # noqa: E731
    return sum(1 for p in points if keyable(im.getpixel(p))) >= 3


def run_job(label: str, prompt: str, ref_png: str | None, out: str) -> str:
    """One image through Codex; copies the generated file to `out`, or saves a log next to it on failure."""
    cmd = ["codex", "exec", "-m", MODEL, "--skip-git-repo-check", "-s", "read-only", "-C", os.path.dirname(out)]
    if ref_png:
        cmd += ["--image", ref_png]
    cmd.append("-")
    text_out = ""
    for _ in range(2):
        proc = subprocess.run(cmd, input=prompt, capture_output=True, text=True, encoding="utf-8",
                              errors="replace", timeout=900)
        text_out = (proc.stdout or "") + (proc.stderr or "")
        paths = [p for p in PATH_RE.findall(text_out) if os.path.exists(p)]
        if paths and ("#FF00FF" not in prompt or magenta_background(paths[-1])):
            shutil.copyfile(paths[-1], out)
            return f"{label}: ok"
        if "usage limit" in text_out.lower():
            break
    with open(os.path.splitext(out)[0] + ".log", "w", encoding="utf-8") as f:
        f.write(text_out)
    return f"{label}: FAILED (log saved)"


def run(job_id: str, out_dir: str) -> str:
    ref, prompt = JOBS[job_id]
    ref_png = None
    if ref:
        ref_png = os.path.join(out_dir, ref + ".png")
        if not os.path.exists(ref_png):
            return f"{job_id}: SKIPPED (style key {ref} missing)"
    return run_job(job_id, prompt, ref_png, os.path.join(out_dir, f"{job_id}.png"))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("out_dir")
    ap.add_argument("ids", nargs="?", default=",".join(JOBS))
    ap.add_argument("--workers", type=int, default=4)
    a = ap.parse_args()
    out_dir = os.path.abspath(a.out_dir)
    os.makedirs(out_dir, exist_ok=True)
    ids = [i for i in a.ids.split(",") if i]
    keys = [i for i in ids if JOBS[i][0] is None]
    rest = [i for i in ids if JOBS[i][0] is not None]
    for batch in (keys, rest):
        with cf.ThreadPoolExecutor(max_workers=a.workers) as ex:
            for msg in ex.map(lambda i: run(i, out_dir), batch):
                print(msg, flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
