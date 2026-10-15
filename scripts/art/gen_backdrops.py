"""VN backdrops for the scripted scenes (GDD §16.3), in the approved painted-cartoon style (D15).

Every job references the approved Market Row backdrop (art_sources/style_bible_v2/market_row_restored.png) so the
set stays coherent. Composition (§16.3): horizon around y = 420 of 720, no people, no UI, no readable text.

  art_sources/backdrops/<id>.png  ->  client/public/assets/backdrops/<id>.jpg  (1280×720)
                                   ->  client/public/assets/backdrops/manifest.json  ({id: "<id>.jpg"})

Usage:
  python3 scripts/art/gen_backdrops.py [id,id,...] [--workers 6]   # generate
  python3 scripts/art/gen_backdrops.py --export                     # export everything generated
"""
import argparse
import concurrent.futures as cf
import json
import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(__file__))
from gen_style_bible_v2 import BACKDROP_STYLE, ERA, HEAD, MATCH_BACKDROP, NO_PEOPLE, run_job  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
STYLE_REF = os.path.join(ROOT, "art_sources", "style_bible_v2", "market_row_restored.png")
SRC = os.path.join(ROOT, "art_sources", "backdrops")
DST = os.path.join(ROOT, "client", "public", "assets", "backdrops")
COMPOSE = ("Composition: a VN background, 16:9, the horizon or the main floor line about 58% of the way down; leave "
           "the lower third calm (a dialogue box sits there).")
FADED = " The town is tired on this day: a little neglect, some peeling paint, but cozy and full of potential."

BACKDROPS: dict[str, str] = {
    # ---- Spring (S01–S10)
    "bg_ferry_slip_morning": "The Monde ferry slip on a calm spring morning: a timber jetty running out into a grey-green "
        "bay, iron bollards and coiled rope, a little white ticket kiosk, a string of homemade bunting between two black "
        "lamp posts, the stone quay behind with rusting cranes and a shuttered red-brick cannery, gulls, soft gold light." + FADED,
    "bg_fountain_square_dry": "Fountain Square in the Old Quarter: a cobbled square with a DRY two-tier stone fountain "
        "topped by a bronze heron standing on one leg, dead leaves in the basin, benches, slightly overgrown flowerbeds, "
        "pastel townhouses with a few shutters closed, a slender stone clocktower behind whose clock reads seventeen "
        "past four, gas lamps, a bright overcast morning." + FADED,
    "bg_fountain_square_work": "Fountain Square during a community clean-up morning: the same dry heron fountain with a "
        "ladder against it, buckets, brooms, paint pots and drop cloths, a half-repainted bench, bunting half hung, "
        "pastel townhouses, the clocktower behind, cheerful morning sun.",
    "bg_cottage_door": "The front of the Lamplighter's Cottage up close: a small stone cottage in rough shape with a "
        "steep slate roof patched with tarpaulin, a green door with flaking paint, a lamp bracket by the door, a cracked "
        "window, weeds and a rusty bucket by the step, a little lane beside it, late morning.",
    "bg_library_reading_room": "Inside the Monde Free Library: a tall thin reading room under a skylight, a long reading "
        "table scarred by a century of elbows, a librarian's desk with a pair of white cotton gloves, a card catalogue, "
        "shelves to the ceiling with a rolling ladder, dust floating in a shaft of light.",
    "bg_clocktower_square": "The foot of the Old Quarter's slender stone clocktower on a bright day: its round white "
        "clock face, a copper-green roof with a weathervane, an arched wooden door, the square's cobbles, pigeons lifting "
        "off, a sense of something just started again.",
    "bg_lantern_office": "Inside The Lantern, a tiny hand-set newspaper office in the evening: an old iron printing press, "
        "wooden type cases, proofs pegged on a line to dry, a desk with galleys and an oil lamp, ink-stained aprons on a "
        "hook, a window onto a lamplit street.",
    "bg_pell_kitchen_night": "The mayor's small kitchen at night: a scrubbed table with a ledger, two cups and a teapot, a "
        "single lamp, an old range, a dresser with plates, rain on the window, quiet and tender.",
    "bg_commons_fair_noon": "The Commons park on Bloom Fair day at noon: bunting between the trees, flower stalls and "
        "trestle tables with jars and plants, a patched octagonal bandstand, the duck pond with a little arched footbridge, "
        "a huge old elm with a rope swing, sunshine, festive and hopeful (empty of people).",
    "bg_commons_fair_dusk": "The same Commons fair at dusk: lanterns glowing along the bunting, stalls being packed up, "
        "the bandstand lit with a string of lights, the pond reflecting a peach sky, warm and tender (empty of people).",
    # ---- Later acts (generated now so the set is coherent)
    "bg_cafe_liss": "Inside Café Liss on a morning: a small corner café with black-and-white floor tiles, a counter with "
        "a chrome coffee machine and a cake stand, little round marble tables, a window onto the river with willows.",
    "bg_constabulary_night": "Inside the tiny village police station at night: a wooden desk with a lamp and a ledger, a "
        "notice board, a coat stand with a constable's cape, a barred cell door ajar, a kettle on a stove.",
    "bg_dawn_report_front_page": "A hand-set village newspaper lying open on a wooden breakfast table in morning light, "
        "beside a cup of tea and a slice of toast; the columns are unreadable grey lines and a picture block (no readable "
        "letters at all).",
    "bg_folly_exterior_fog": "Founder's Folly: a ruined round stone observatory on a wooded hill in fog, ferns and "
        "brambles, a broken dome, a stone stair, pale morning light through the mist.",
    "bg_harbor_steps_dusk": "Stone harbour steps leading down to the water at dusk, moored rowing boats with numbered "
        "flags (no readable numbers), regatta pennants along the quay, lamps coming on, a peach and lilac sky.",
    "bg_lookout_bench_afternoon": "A weathered wooden bench at a lookout on Station Hill in the afternoon, long grass, "
        "the little town and its bay far below, a lighthouse on a breakwater, clouds moving.",
    "bg_market_hall_debate": "Inside the restored covered market hall arranged for a town debate in the evening: "
        "cast-iron columns painted green, a glass roof, rows of folding chairs, a lectern on a little stage, bunting, "
        "warm lamps.",
    "bg_market_hall_supper": "Inside the restored covered market hall set for a harvest supper: long trestle tables with "
        "white cloths, lanterns, pumpkins, apples and sheaves, cast-iron columns and a glass roof with dusk beyond.",
    "bg_mercer_front_room": "A small worn front room in a workers' terrace: a sagging armchair with a crochet blanket, a "
        "coal stove, a mantel clock, framed photos turned to the wall (no faces), net curtains, a pot of tea.",
    "bg_quarry_floor": "The floor of an old overgrown stone quarry in fog: ferns, puddles, cut stone walls, a makeshift "
        "hideout of tarps and crates with a cold fire pit.",
    "bg_station_platform_dawn": "A small derelict branch-line station at dawn: a wooden canopy with peeling paint, grass "
        "between rusty rails, a water tower, a signal box, a single bench, mist over the fields.",
    "bg_station_platform_noon": "The same little station restored at noon for the first train: fresh paint on the canopy, "
        "polished rails, bunting and flower tubs, a clock over the platform, bright sky.",
    "bg_town_hall_registry": "Inside a small town hall registry office: a counter with a brass bell, pigeonholes of "
        "papers, big bound ledgers, a wall clock, a tall window with sunlight.",
    "bg_vane_trailer_interior": "Inside a slick modern site-office trailer: a glossy dark desk, a leather chair, filing "
        "cabinets, venetian blinds, a scale model of a waterfront development under a plastic cover (no text).",
    "bg_wharf_night": "The wharf at night: lamp posts along a stone quay, bollards, the dark bulk of a shuttered cannery, "
        "cranes against the stars, moored boats, moonlight on the water, a lighthouse on the breakwater.",
    "bg_fountain_square_dusk": "Fountain Square at dusk with the heron fountain running again: lanterns hung across the "
        "square, warm windows in the pastel townhouses, the clocktower lit, flowers in full bloom, festive and tender.",
    "bg_fountain_square_night": "Fountain Square at night, lantern-lit for a town celebration: the heron fountain running "
        "and lit from below, strings of paper lanterns, a small stage with bunting, the clocktower glowing.",
}
# The approved style key already shows the bakery before dawn.
REUSE = {"bg_bakery_interior": os.path.join(ROOT, "art_sources", "style_bible_v2", "bakery_interior.png")}


def prompt_for(desc: str) -> str:
    return HEAD + MATCH_BACKDROP + BACKDROP_STYLE + "\n\n" + desc + "\n\n" + COMPOSE + "\n\n" + ERA + NO_PEOPLE


def export() -> None:
    from PIL import Image
    os.makedirs(DST, exist_ok=True)
    manifest = {}
    sources = {i: os.path.join(SRC, f"{i}.png") for i in BACKDROPS} | REUSE
    for bid, path in sorted(sources.items()):
        if not os.path.exists(path):
            continue
        im = Image.open(path).convert("RGB")
        # Centre-crop to 16:9, then 1280×720.
        w, h = im.size
        if w / h > 16 / 9:
            nw = round(h * 16 / 9); im = im.crop(((w - nw) // 2, 0, (w - nw) // 2 + nw, h))
        else:
            nh = round(w * 9 / 16); im = im.crop((0, (h - nh) // 2, w, (h - nh) // 2 + nh))
        im.resize((1280, 720), Image.LANCZOS).save(os.path.join(DST, f"{bid}.jpg"), quality=86, optimize=True, progressive=True)
        manifest[bid] = f"{bid}.jpg"
        print(f"{bid}: exported", flush=True)
    with open(os.path.join(DST, "manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=1, sort_keys=True)
        fh.write("\n")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("ids", nargs="?", default="")
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--export", action="store_true")
    a = ap.parse_args()
    if a.export:
        export()
        return 0
    os.makedirs(SRC, exist_ok=True)
    ids = [i for i in a.ids.split(",") if i] or list(BACKDROPS)

    def job(bid: str) -> str:
        out = os.path.join(SRC, f"{bid}.png")
        return f"{bid}: exists" if os.path.exists(out) else run_job(bid, prompt_for(BACKDROPS[bid]), STYLE_REF, out)

    with cf.ThreadPoolExecutor(max_workers=a.workers) as ex:
        for msg in ex.map(job, ids):
            print(msg, flush=True)
    for bid, path in REUSE.items():
        if os.path.exists(path):
            shutil.copyfile(path, os.path.join(SRC, f"{bid}.png"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
