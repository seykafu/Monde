"""Generate Monde's style bible (MVP A-01) with Codex image generation (GPT-6).

Six key paintings and four master portraits, each prompted against a Ravage style reference, so Monde
inherits Ravage's painted look, warmer (GDD §16.1, §16.7). Raw renders land in <out_dir>/<id>.png for
Kasey's approval; nothing is processed or shipped from here.

Usage:
  python3 scripts/art/gen_style_bible.py art_sources/style_bible [id,id,...] [--workers 4]

Requires the Codex CLI (logged in) and Ravage references in .ref/ravage-art/ (see MVP_PLAN A-01).
"""
import argparse
import concurrent.futures as cf
import os
import re
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
REF = os.path.join(ROOT, ".ref", "ravage-art")
MODEL = os.environ.get("MONDE_IMAGE_MODEL", "gpt-6-astra")

RULES = ("Do not write code, do not run commands, do not try to copy or save files: just generate the image, "
         "then reply with the full path of the generated image.")
HEAD = "You are generating game art. Use your built-in image generation tool to create ONE image. " + RULES + "\n\n"

ERA = ("Era and world: a small seaside town in a timeless 'storybook modern' era: bicycles, hand carts, enamel "
       "signs, knitwear, aprons, wool caps. No modern technology, no cars, no logos or brand names, no readable text.")

PAINTING = ("A wide 16:9 painted scene in exactly the painterly style of the attached reference: the same brushwork, "
            "the same level of detail and the same handling of light, but with a warmer, gentler palette. ")
NO_PEOPLE = "\n\nIMPORTANT: no people, no figures, no animals except where stated, no text, no border, no frame."

PORTRAIT = (HEAD + "Create ONE new character portrait for our game in exactly the painted art style of the attached "
            "reference portrait: the same brushwork and line work, the same level of detail and finish, and the same "
            "framing: head and shoulders, the shoulders reaching the bottom edge, the face in the upper half of the "
            "picture, a three-quarter view turned slightly to the right. Light: warm, soft late-afternoon light, a "
            "little warmer and gentler than the reference. It is a different person from the reference.\n\n"
            + ERA + "\n\nThe character: {desc}\n\nExpression: {expr}\n\n"
            "Background: one flat, solid, pure magenta (#FF00FF) everywhere behind the character: no gradient, no "
            "shadow, no glow, no scenery. Portrait orientation, 2:3 (1024x1536). No text, no border, no frame.")

# id -> (reference image, prompt). A reference of "@<id>" means: use that job's output (it runs first).
JOBS = {
    "monde_dawn_breakwater": ("cliffs.png", HEAD + PAINTING + """Monde at dawn, seen from the far end of a long stone breakwater looking back at the town. A small town climbs a gentle hill where a river meets a grey bay: pastel and grey stone houses with slate roofs, a four-faced clocktower rising from the old quarter, a covered market hall, rusting cranes and a shuttered cannery along the waterfront. A tall stone lighthouse, dark and unlit, stands on the breakwater in the left foreground. Gulls. First light: mist lying on the water, cool greys warming to peach and gold at the horizon. Melancholy and beautiful, a town that has been quiet too long. The lower 40% of the picture is calm water and wet stone.

""" + ERA + NO_PEOPLE + " (gulls are fine)"),
    "market_row_faded": ("thuling.png", HEAD + PAINTING + """Market Row in Monde: a narrow cobbled shopping street of two-storey buildings with striped awnings, seen at street level looking down the row on an overcast afternoon. Half the shops are shuttered, with peeling paint and boarded windows; a bakery with a warm lit window is one of the few still open. Empty flower boxes, a dry stone trough, litter in the gutter, a lone bicycle leaning on a wall. Desaturated, cool, grey sky, quiet, a little sad.

""" + ERA + NO_PEOPLE),
    "market_row_restored": ("@market_row_faded", HEAD + """The attached image is a painted scene from our game. Create ONE new image of EXACTLY the same street from exactly the same viewpoint, with the same buildings, the same composition and the same painted style, but restored and thriving: every shutter rolled up, fresh paint in warm colours, bright awnings, flower boxes overflowing, bunting strung across the street, café tables and chairs outside, a busy bakery window full of bread, clean cobbles, warm golden late-afternoon light. Joyful and cozy. Same 16:9 framing.""" + NO_PEOPLE),
    "fountain_lantern_night": ("thuling.png", HEAD + PAINTING + """Fountain Square in Monde on Lantern Night: a small cobbled square at dusk turning to night. At its centre a round stone fountain with a bronze heron standing on one leg, water running again. Behind it a four-faced clocktower lit warm from within. Strings of paper lanterns criss-cross the square; lanterns glow on every window sill, doorstep and fountain rim. Deep blue sky with the first stars, amber light pooling on the cobbles. Festive, tender, a little emotional.

""" + ERA + NO_PEOPLE),
    "bakery_interior": ("tavern.png", HEAD + PAINTING + """Inside Fournier & Fille, a small old bakery before dawn: a big brick bread oven with an arched mouth glowing orange, flour-dusted wooden counters, racks of round loaves and long baguettes, copper pans on hooks, a blank chalkboard, sacks of flour, and an orange cat with a notched ear asleep on a flour sack by the door. Warm firelight against the blue pre-dawn light from a small window. Cozy and still.

""" + ERA + NO_PEOPLE + " (the cat is required)"),
    "station_hill_dusk": ("farmland.png", HEAD + PAINTING + """Station Hill above Monde at dusk: a small derelict railway station with a wooden canopy and a platform, grass growing between the rails, a rusting water tower and a little signal box with tall windows, a weathered bench at a lookout. Below and far off, the town and the bay with a few windows lighting up. Long golden-hour light, wind moving the grass. Wistful, with a little hope in it. No trains.

""" + ERA + NO_PEOPLE),
    "portrait_pell": ("maya_guarded_neutral.png", PORTRAIT.format(
        desc="Edwina Pell, 71, the town's mayor for 26 years. Small and upright, a neat silver bob, half-moon reading glasses on a beaded chain, a soft wool cardigan buttoned one hole off, a smudge of ink on her right cuff. Kind, tired eyes in a face that has worried for years and smiles anyway.",
        expr="calm and neutral, attentive, mouth closed, the faintest warmth around the eyes.")),
    "portrait_odile": ("lucian_neutral.png", PORTRAIT.format(
        desc="Odile Fournier, 64, the town baker. Broad-shouldered and strong, forearms dusted with flour to the elbows, grey hair pinned up with a pencil stuck through it, a faint pink burn scar across her left forearm, a white baker's apron over a dark striped shirt with rolled sleeves. Gruff, proud and generous.",
        expr="neutral and a little gruff: level gaze, mouth set, one eyebrow very slightly raised.")),
    "portrait_tib": ("amar_neutral.png", PORTRAIT.format(
        desc="Tobias 'Tib' Okafor, 11, a Black boy who is small for his age, with a cowlick that will not lie flat, bright curious eyes, a scuffed knitted jumper, a canvas satchel strap across his chest and a magnifying glass with a cracked rim hanging on a cord around his neck. Scrappy, clever, always one question ahead.",
        expr="neutral but curious: eyes bright and alert, the corner of the mouth about to grin.")),
    "portrait_rook": ("amar_neutral.png", PORTRAIT.format(
        desc="Roland 'Rook' Mercer, 33, a former mill worker who now leads a small gang. A lean face with stubble and a scar through one eyebrow, wary hard eyes, a grey wool flat cap pulled low, a worn canvas work jacket, a small brass whistle on a bootlace around his neck.",
        expr="neutral and guarded: jaw set, eyes watchful, no smile.")),
}

PATH_RE = re.compile(r"(/[^`'\"\s]*?generated_images/[^`'\"\s]*?\.png)")


def run(job_id: str, out_dir: str) -> str:
    ref, prompt = JOBS[job_id]
    ref_png = os.path.join(out_dir, ref[1:] + ".png") if ref.startswith("@") else os.path.join(REF, ref)
    if not os.path.exists(ref_png):
        return f"{job_id}: SKIPPED (reference {ref_png} missing)"
    out = os.path.join(out_dir, f"{job_id}.png")
    text_out = ""
    for _ in range(2):
        proc = subprocess.run(
            ["codex", "exec", "-m", MODEL, "--skip-git-repo-check", "-s", "read-only", "-C", out_dir,
             "--image", ref_png, "-"],
            input=prompt, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=900,
        )
        text_out = (proc.stdout or "") + (proc.stderr or "")
        paths = [p for p in PATH_RE.findall(text_out) if os.path.exists(p)]
        if paths:
            shutil.copyfile(paths[-1], out)
            return f"{job_id}: ok"
        if "usage limit" in text_out.lower():
            break
    with open(os.path.join(out_dir, f"{job_id}.log"), "w", encoding="utf-8") as f:
        f.write(text_out)
    return f"{job_id}: FAILED (log saved)"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("out_dir")
    ap.add_argument("ids", nargs="?", default=",".join(JOBS))
    ap.add_argument("--workers", type=int, default=4)
    a = ap.parse_args()
    os.makedirs(a.out_dir, exist_ok=True)
    ids = [i for i in a.ids.split(",") if i]
    first = [i for i in ids if not JOBS[i][0].startswith("@")]
    second = [i for i in ids if JOBS[i][0].startswith("@")]
    for batch in (first, second):
        with cf.ThreadPoolExecutor(max_workers=a.workers) as ex:
            for msg in ex.map(lambda i: run(i, os.path.abspath(a.out_dir)), batch):
                print(msg, flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
