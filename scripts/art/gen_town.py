"""Town art (MVP A-03, the town lift): buildings and props for the four Spring districts, in the approved
pixel-art world style (D15: the world is Stardew-style chunky pixel art on the ¾ diorama board).

Every job references the approved gameplay mockup (art_sources/style_bible_v2/gameplay_mockup.png) for style
and camera angle, and draws ONE object on flat magenta for keying. Buildings that change as the town is
restored get a second, faded/neglected version drawn against the restored one, so both states line up.

  art_sources/town/<kind>/<id>.png           kind = buildings | props
  art_sources/town/<kind>/<id>__faded.png    the Day-1 state of a restorable building or landmark

`TOWN` (below) is also the export contract: footprint in tiles (w, d) for buildings, display width in tiles
for props. scripts/art/export_town.py reads it.

Usage: python3 scripts/art/gen_town.py [id,id,...] [--workers 6]
"""
import argparse
import concurrent.futures as cf
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from gen_style_bible_v2 import ERA, HEAD, run_job  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
STYLE_REF = os.path.join(ROOT, "art_sources", "style_bible_v2", "gameplay_mockup.png")
OUT = os.path.join(ROOT, "art_sources", "town")

STYLE = (
    "Match the attached reference image's pixel-art style EXACTLY: Stardew Valley-like chunky, clearly visible "
    "square pixels, a warm bright limited palette, soft dark outlines, the same cozy look, and the SAME camera: "
    "a 3/4 top-down view seen STRAIGHT FROM THE FRONT, not from a corner: a building shows only its front wall "
    "(square to the viewer, no side walls visible) and the top of its roof receding upward behind it. "
    "Draw ONE isolated object only, centred, filling most of the image. No ground, no grass, no paving, no cast "
    "shadow, no other objects, no people or animals unless asked, no text, letters or numbers anywhere (signs "
    "use pictograms only). The ENTIRE background is one flat, solid, pure magenta (#FF00FF): no gradient, no "
    "glow, no vignette.")
FADED = (
    "The attached image is a building from our game. Draw EXACTLY the same building from exactly the same angle, "
    "same size, shape, outline, roof, windows and doors, in the same pixel-art style, on the same flat pure "
    "magenta (#FF00FF) background, but in its neglected Day-1 state: {state} Keep it cozy-sad rather than grim. "
    "No text.")


def building(desc: str, w: int, d: int, faded: str | None = None) -> dict:
    return {"kind": "buildings", "desc": desc, "foot": [w, d], "faded": faded}


def prop(desc: str, width: float, faded: str | None = None) -> dict:
    return {"kind": "props", "desc": desc, "width": width, "faded": faded}


HOUSE = ("a narrow two-storey seaside townhouse, {colour} painted render, a grey slate roof with one chimney, a "
         "white-framed sash window upstairs and one down, a {door} front door with a step, a small window box")
SHUTTERED = "shutters closed, peeling paint, a few slates missing, an empty window box, a faded door, weeds at the step."
SHOP = ("a narrow two-storey shopfront on a market street, {colour} paint, a big shop window with a {awning} striped "
        "awning, a hanging pictogram sign (no letters), a glazed door, a flat above with one window, slate roof")
SHOP_SHUT = "the awning rolled up and torn, the shop window boarded with planks, the sign gone, paint peeling."

TOWN: dict[str, dict] = {
    # ---- Old Quarter
    "town_hall": building("a stately small-town town hall: pale stone, two storeys, a central pediment, tall arched "
                          "windows, a flight of three steps to double doors, a flagpole with a plain blue flag", 6, 4),
    "clocktower": building("a slender square stone clocktower, four storeys, a round white clock face near the top "
                           "showing seventeen minutes past four, a small copper-green pyramid roof with a weathervane, "
                           "an arched wooden door at the base", 3, 3),
    "library": building("a small public library: honey-coloured brick, two storeys, tall many-paned windows, a "
                        "round window above a green double door, a book pictogram on a hanging sign", 6, 4),
    "lantern_office": building("a tiny newspaper print shop: dark green painted wood front, a wide window showing a "
                               "printing press inside, a lantern pictogram sign, an apartment window above", 5, 4),
    "founders_house": building("an old clockmaker's house turned museum: tall and narrow, timber-framed upper storey, "
                               "a bay window, a brass plaque by the locked door, ivy on one side", 4, 4),
    "st_brigids": building("a small whitewashed village chapel with a slate roof, a little bell gable on the front "
                           "with one bell, a round-arched wooden door, two narrow arched windows", 5, 4),
    "constabulary": building("a tiny village police station: blue-painted brick, one storey and an attic, a blue "
                             "lamp over the door, a bench outside, a notice board", 5, 4),
    "lamplighter_cottage": building("a small one-and-a-half-storey stone cottage with a steep slate roof, a crooked "
                                    "chimney, a green door, a lamp bracket by the door", 5, 3,
                                    "the roof patched with tarpaulin, a cracked window pane, the door's paint "
                                    "flaking, weeds and a rusty bucket by the step."),
    "pell_house": building(HOUSE.format(colour="soft lavender", door="navy"), 4, 3),
    "bertrand_house": building(HOUSE.format(colour="pale stone-grey", door="dark red") +
                               ", a tidy clock-shaped door knocker", 5, 3),
    "okafor_house": building(HOUSE.format(colour="warm yellow", door="green") + ", a child's kite caught on the gutter", 4, 3),
    "augusta_house": building(HOUSE.format(colour="deep teal", door="white"), 4, 3),
    "townhouse_a": building(HOUSE.format(colour="pastel pink", door="blue"), 3, 3, SHUTTERED),
    "townhouse_b": building(HOUSE.format(colour="pale mint green", door="red"), 3, 3, SHUTTERED),
    "townhouse_c": building(HOUSE.format(colour="cream", door="black"), 3, 3, SHUTTERED),
    "townhouse_d": building(HOUSE.format(colour="sky blue", door="yellow"), 3, 3, SHUTTERED),
    # ---- Market Row
    "market_hall": building("a covered Victorian market hall: an open front with cast-iron columns painted green, a "
                            "long glass-and-iron roof, market stalls visible inside, a big round clock-free gable", 6, 5,
                            "half the roof glass broken or missing, rust on the columns, empty stalls, a padlocked "
                            "chain across the opening, pigeons on the gutter."),
    "bakery": building("a cozy bakery: cream render, a big window full of round loaves and baguettes, a red-and-white "
                       "striped awning, a wheat-sheaf pictogram sign, warm light inside, a chimney with a wisp of smoke", 5, 4),
    "general_store": building("a village general store: brown painted wood front, a wide window with jars and "
                              "tins, crates of vegetables outside on a bench, a green striped awning", 5, 4),
    "gull_and_anchor": building("a cozy harbour-town pub: dark blue painted front, small-paned bow windows, a "
                                "hanging sign with a gull and an anchor pictogram, a lantern over the door", 5, 4),
    "cafe_liss": building("a small corner cafe: pale yellow render, a blue-and-white striped awning, two little round "
                          "tables with chairs outside, a coffee-cup pictogram sign", 4, 4),
    "storefront_a": building(SHOP.format(colour="sage green", awning="green-and-white"), 3, 3, SHOP_SHUT),
    "storefront_b": building(SHOP.format(colour="terracotta", awning="orange-and-cream"), 3, 3, SHOP_SHUT),
    "storefront_c": building(SHOP.format(colour="dusty blue", awning="blue-and-white"), 3, 3, SHOP_SHUT),
    # ---- The Wharf
    "cannery": building("a large old brick fish cannery on a harbour: long two-storey red-brick building, a row of "
                        "tall arched windows, a big sliding loading door, a tall brick chimney", 9, 6,
                        "every window boarded or broken, the loading door chained shut, rust streaks, weeds on the "
                        "roof, a faded painted fish pictogram on the wall."),
    "boathouse": building("a weathered wooden boathouse on a harbour: grey-blue clapboard, a wide boat door at the "
                          "front, a small loft window, oars and a lifebuoy on the wall", 5, 5),
    "ticket_booth": building("a tiny ferry ticket kiosk: white painted wood with a little pitched roof, a ticket "
                             "window, a timetable board (no readable text), a ship pictogram", 2, 2),
    "nell_cottage": building("a squat fisher's cottage: white limewash, thick walls, a low slate roof, a blue door, "
                             "lobster pots stacked by the wall", 3, 3),
    "vane_office": building("a slick modern site-office trailer, out of place in an old harbour: glossy charcoal "
                            "panels, tinted windows, metal steps, a sharp angular logo shape (no letters)", 4, 2),
    "harbormaster_house": building("a harbourmaster's house: tall, white with a black-painted lower storey, a little "
                                   "lookout cupola on the roof with windows all round, a ship's bell by the door", 4, 3),
    "bunkhouse": building("a long low wooden bunkhouse for fishing crews: tarred black timber, a row of small "
                          "windows, a tin roof, a stovepipe", 4, 3, SHUTTERED),
    "wharf_cottage": building("a small harbour cottage: whitewashed stone, a red door, a tiny window, a slate roof, "
                              "a net hung by the door", 3, 3, SHUTTERED),
    "lighthouse": building("a tall round lighthouse on a stone base: white tower with one broad red band, a black "
                           "lantern room with glass all round at the top, a little iron balcony, a wooden door", 3, 3,
                           "the lantern glass dark and grimy, paint peeling off the tower, the red band faded, rust "
                           "on the balcony rail."),
    "fish_market": building("an open-sided fish market shed on a harbour: a long slate roof on timber posts, marble "
                            "counters with crushed ice, scales hanging, fish crates", 6, 3,
                            "the counters empty and bare, a few crates stacked and unused, a padlocked chain, gulls "
                            "on the roof."),
    # ---- The Commons
    "glasshouse": building("a Victorian glasshouse: white-painted iron frame, many glass panes, a curved roof, a "
                           "central door, green plants and palms visible inside", 8, 4,
                           "many panes broken or missing, the frame flaking, ivy climbing in, dead plants inside."),
    "teo_cottage": building("a gardener's cottage: stone walls with climbing roses, a thatched roof, a round green "
                            "door, herb pots on the sill", 3, 3),
    "bandstand": building("an octagonal Victorian bandstand: a raised stone base with steps, slender painted iron "
                          "columns, an ornate green roof with a little finial", 4, 4,
                          "collapsed on one side: the roof caved in and slumped, two columns snapped, the steps "
                          "cracked, weeds and a fallen music stand."),
    "garden_shed": building("a small wooden potting shed: green planks, a corrugated roof, a window with "
                            "seedlings, tools leaning by the door", 2, 2),
    # ---- Landmarks and big props
    "fountain": prop("a round stone fountain with two basins and a bronze heron standing on one leg on the top, "
                     "water flowing from the heron's beak", 3.0,
                     "the same fountain dry: no water at all, dead leaves in the basin, a crack in the rim."),
    "old_elm": prop("a huge ancient elm tree with a broad spreading crown and a thick gnarled trunk, a rope "
                    "swing on one branch", 5.0),
    "sundial": prop("a stone sundial on a short fluted pedestal, a bronze dial", 1.0),
    "footbridge": prop("a small arched wooden footbridge with railings, seen from the side as it crosses a stream "
                       "left to right (only the bridge)", 4.0),
    "crane": prop("a tall old harbour crane: riveted iron lattice jib, a cab, a hook on a chain", 3.0,
                  "the same crane rusted orange-brown, a broken cab window, the hook hanging still."),
    # ---- Trees and plants
    "oak": prop("a round leafy oak tree with a sturdy trunk", 2.6),
    "birch": prop("a slender silver birch tree with light leaves", 1.8),
    "pine": prop("a tall dark-green pine tree", 2.0),
    "willow": prop("a weeping willow tree with long drooping branches, for a riverbank", 3.0),
    "apple_tree": prop("a small apple tree with red apples and blossom", 2.0),
    "bush_round": prop("a round green bush", 1.0),
    "bush_flowering": prop("a round bush covered in pink flowers", 1.0),
    "hedge": prop("a straight trimmed box hedge segment, one tile long, seen from the front", 1.0),
    "flowerbed": prop("a small rectangular raised flowerbed with red, yellow and purple flowers", 1.5),
    "tall_grass": prop("a clump of tall wild grass with a few daisies", 0.8),
    "reeds": prop("a clump of riverbank reeds and bulrushes", 0.9),
    "lilypads": prop("three lily pads with one pink water lily, flat on water, seen from above", 1.0),
    "rock": prop("a mossy grey boulder", 0.9),
    "planter": prop("a stone planter box overflowing with flowers", 1.0),
    "flower_pots": prop("a cluster of three terracotta flower pots with geraniums", 0.8),
    "veg_bed": prop("a raised wooden vegetable bed with cabbages, carrots and lettuces", 2.0,
                    "the same bed overgrown with weeds and nettles, nothing growing, a broken board."),
    # ---- Street furniture
    "lamp_post": prop("a black cast-iron gas street lamp post with a glass lantern", 0.6),
    "bench": prop("a wooden park bench with cast-iron ends, facing the viewer", 1.5),
    "barrel": prop("a wooden barrel with iron hoops", 0.6),
    "crates": prop("two stacked wooden crates", 0.8),
    "handcart": prop("a wooden hand cart with two wheels", 1.5),
    "signpost": prop("a wooden fingerpost signpost with three blank arrow boards", 0.8),
    "postbox": prop("a red cast-iron pillar postbox", 0.5),
    "well": prop("a round stone well with a little wooden roof and a bucket", 1.5),
    "notice_board": prop("a small wooden notice board on two posts with pinned papers (no readable text)", 1.2),
    "bicycle": prop("an old black bicycle with a basket, leaning on its stand, seen from the side", 1.2),
    "fence": prop("a white picket fence segment, one tile long, seen from the front", 1.0),
    "stone_wall": prop("a low drystone wall segment, one tile long, seen from the front", 1.0),
    "market_stall": prop("a wooden market stall with a red-and-white striped canopy and produce on the counter", 2.0,
                         "the same stall bare, the canopy torn and rolled, an empty counter."),
    "bunting": prop("a string of colourful triangular bunting flags hanging in a gentle curve", 3.0),
    "picnic_table": prop("a wooden picnic table with benches", 1.6),
    # ---- Wharf
    "rowboat": prop("a small wooden rowboat with oars, seen from slightly above, on its own", 2.0),
    "fishing_boat": prop("a small blue-and-white wooden fishing boat with a little wheelhouse, seen from the side", 3.5),
    "bollard": prop("an iron mooring bollard with a coil of rope around it", 0.5),
    "net_rack": prop("a wooden rack with fishing nets hung to dry and floats", 2.0),
    "lobster_pots": prop("a stack of wicker lobster pots", 0.9),
    "fish_crates": prop("stacked fish crates with ice and silver fish", 1.0),
    "buoy": prop("a red-and-white striped buoy lying on its side", 0.6),
    "anchor": prop("an old rusty ship's anchor leaning upright", 0.8),
    # ---- Riddle objects the trail names (GDD §14): part 2 of the town lift
    "old_bell": prop("an old bronze church bell, green with patina, resting mouth-down on a low square stone "
                     "plinth, its iron clapper visible under the rim, moss on the plinth", 0.9),
    "public_scale": prop("an old cast-iron public beam balance on a short iron post: a crossbeam with two round iron "
                         "pans hanging from chains, the left pan stuck lower than the right, rust patches", 1.0),
    "gate_pillar": prop("a square stone gate pillar with a round stone ball on top, a little moss, an iron hinge pin "
                        "on one side", 0.6),
    # ---- Life
    "duck": prop("a single white farmyard duck, standing", 0.4),
    "gull": prop("a single seagull standing", 0.4),
    "cat_sleeping": prop("an orange tabby cat curled up asleep", 0.5),
}


def prompt_for(job: dict) -> str:
    size = (f"Footprint: about {job['foot'][0]} tiles wide and {job['foot'][1]} tiles deep (a tile is a little "
            f"wider than a person), so the building is about {job['foot'][0] / 3:.1f} times as wide as a small "
            "cottage." if job["kind"] == "buildings" else
            f"Size: about {job['width']} tiles wide (a tile is a little wider than a person).")
    return HEAD + STYLE + "\n\n" + ERA + "\n\nThe object: " + job["desc"] + ".\n\n" + size


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("ids", nargs="?", default="")
    ap.add_argument("--workers", type=int, default=6)
    a = ap.parse_args()
    ids = [i for i in a.ids.split(",") if i] or list(TOWN)

    def base(i: str) -> str:
        job = TOWN[i]
        out = os.path.join(OUT, job["kind"], f"{i}.png")
        os.makedirs(os.path.dirname(out), exist_ok=True)
        return f"{i}: exists" if os.path.exists(out) else run_job(i, prompt_for(job), STYLE_REF, out)

    def faded(i: str) -> str:
        job = TOWN[i]
        ref = os.path.join(OUT, job["kind"], f"{i}.png")
        out = os.path.join(OUT, job["kind"], f"{i}__faded.png")
        if os.path.exists(out):
            return f"{i}__faded: exists"
        if not os.path.exists(ref):
            return f"{i}__faded: SKIPPED (no base)"
        return run_job(f"{i}__faded", HEAD + FADED.format(state=job["faded"]), ref, out)

    with cf.ThreadPoolExecutor(max_workers=a.workers) as ex:
        for msg in ex.map(base, ids):
            print(msg, flush=True)
        for msg in ex.map(faded, [i for i in ids if TOWN[i]["faded"]]):
            print(msg, flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
