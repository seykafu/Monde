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
    "The attached image is a building or object from our game. Draw EXACTLY the same thing from exactly the same angle, "
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
INDOOR = ("indoor furniture for a cozy room, seen at the same 3/4 top-down angle STRAIGHT FROM THE FRONT (its front face "
          "square to the viewer, its top visible receding behind it, no side faces): ")

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
    # ---- Riddle details (town fixes): the Marks themselves and the objects the Spring riddles name. Anything
    # that must be read (a year, a welcome line, a boat's name) is drawn BLANK here and lettered in code
    # (render/town/lettering.ts), so it is exact.
    "mark_plaque": prop("a tiny rectangular brass plaque with rounded corners and a small rivet in each corner, a "
                        "lantern stamped in relief in its centre, polished so it gleams, seen straight from the front",
                        0.35),
    "watch_sign": prop("a giant gilded pocket-watch shop sign hanging from a black wrought-iron wall bracket: a round "
                       "gold watch case with its winding crown and ring at the top, a cream dial with hour ticks and "
                       "two black hands (no numerals), hung by a short chain from the end of the bracket arm, which "
                       "comes in from the left; seen straight from the front", 1.0),
    "herring_vane": prop("a copper weathervane in the shape of a herring, green verdigris patches, the fish seen in "
                         "full side profile on top of a thin black iron spindle, with a small ball and four plain "
                         "compass arms (no letters) below it", 0.9),
    "welcome_sign": prop("a large painted wooden town welcome sign standing on two stout wooden posts: one wide "
                         "cream signboard with a carved and painted blue border, a little carved lantern on a crest "
                         "at the top, small flower boxes at the foot of each post. The signboard's face is "
                         "completely BLANK and empty (no letters, no numbers, no pictures)", 2.0),
    "brass_stone": prop("a single square-cut granite breakwater block, weathered grey with barnacles and a little "
                        "seaweed at its foot; its front face is set with a polished square brass plate that catches "
                        "the light (the plate is plain)", 0.9),
    "datestone": prop("a small carved sandstone datestone tablet of the kind set into a wall over a front door: "
                      "rectangular, a moulded frame, a tiny lantern carved at the top centre of the frame, a smooth "
                      "BLANK recessed panel (no numbers, no letters); seen straight from the front", 0.7),
    "gannet": prop("a small old harbour passenger ferry seen exactly from the side with its bow to the right: a "
                   "navy-blue hull with a white band, a small white wheelhouse, a covered passenger deck with round "
                   "portholes, a short black funnel, rope fenders hung over the side, a little mast. The hull is "
                   "plain: no name, no numbers", 5.0),
    "foundation_stone": prop("a square carved foundation stone block set at ground level, pale weathered stone with "
                             "moss in its joints, a lantern carved in relief on its face (no letters or numbers)", 0.8),
    "clock_window": prop("a small shop window seen straight from the front: a white-painted wooden sash frame with a "
                         "few panes, the window packed with many little clock and pocket-watch faces of different "
                         "sizes, every one showing a different time (no numerals), warm light behind them", 0.5),
    "lantern_pane": prop("a single glasshouse window pane with a round-arched top, about one and a half times as tall "
                         "as it is wide, in a white-painted iron frame; the glass is frosted milky white with a "
                         "little lantern etched clear into the frost in its middle; seen straight from the front",
                         0.4),
    # ---- Interiors (MVP W-03): furniture and fixtures for the walk-in rooms. The rooms' floors and walls are drawn
    # in code (render/town/interiorArt.ts); these stand on them like the town's props, front-facing 3/4.
    # The cottage
    "bed": prop(INDOOR + "a single wooden bed with a carved headboard, a patchwork quilt in blues and creams, one plump "
                "white pillow, seen from its foot end so the quilt runs back to the headboard", 1.4),
    "stove": prop(INDOOR + "a small black cast-iron kitchen range on little legs, a brass rail, a copper kettle on the hob, "
                  "a stovepipe rising from its back, a warm orange glow behind the little firebox door", 1.2),
    "kitchen_table": prop(INDOOR + "a small square scrubbed-pine kitchen table with two plain wooden chairs, a brown teapot, "
                          "two cups and a jam jar of wildflowers on it", 1.6),
    "chest": prop(INDOOR + "a wooden storage chest with iron bands and a hasp, the lid closed", 1.0),
    "armchair": prop(INDOOR + "a cosy wing-backed armchair in faded green fabric with a knitted blanket over one arm", 1.1),
    "dresser": prop(INDOOR + "a tall painted Welsh dresser: plates standing on its open shelves above, two cupboard doors "
                    "and drawers below, a jug and a bowl on the counter", 1.6),
    "wall_shelf": prop(INDOOR + "a short wooden wall shelf on two iron brackets holding three jars, a few books and a small "
                       "trailing plant (only the shelf and what is on it, no wall)", 1.3),
    "potted_plant": prop(INDOOR + "a tall leafy house plant with big glossy leaves in a terracotta pot", 0.8),
    "oil_lamp": prop(INDOOR + "a brass oil lamp with a glass chimney and a warm glowing flame, standing on a small round "
                     "wooden side table", 0.8),
    "wall_lamp": prop(INDOOR + "a small brass wall lantern on a curled bracket with a glowing candle behind its glass (only "
                      "the lantern and bracket, no wall)", 0.4),
    "workbench": prop(INDOOR + "a sturdy wooden workbench with a vice at one end, hand tools hung on a rack along its back, "
                      "a few brass gears and a coil of wire on its top", 2.0),
    # Fournier & Fille
    "bread_oven": prop(INDOOR + "a big old brick bread oven built into a wall: a round-arched oven mouth with a pale stone "
                       "keystone at the top of the arch, a fire glowing deep inside, loaves on the hearth, a stack of "
                       "split logs below, a wooden peel leaning beside it, a brick chimney breast rising above", 2.6),
    "bakery_counter": prop(INDOOR + "a long wooden bakery shop counter with a glass-fronted display of croissants, tarts and "
                           "round loaves, a little brass bell and a stack of paper bags on top", 3.0),
    "bread_rack": prop(INDOOR + "a tall wooden shelf rack crowded with round crusty loaves, with baguettes standing in a "
                       "basket on the bottom shelf", 1.5),
    "flour_sacks": prop(INDOOR + "three plump burlap flour sacks slumped together, one with a wheat-sheaf pictogram", 1.0),
    "kneading_table": prop(INDOOR + "a sturdy wooden baker's work table dusted with flour, a round of dough, a wooden "
                           "rolling pin and a big mixing bowl on top, baskets underneath", 2.0),
    # Café Liss
    "espresso_counter": prop(INDOOR + "a cafe counter in pale wood with a gleaming brass espresso machine, stacked white "
                             "cups, a cake stand with a glass dome over a lemon cake", 3.0),
    "cafe_table": prop(INDOOR + "a small round marble-topped cafe table on a black iron stand with two bentwood chairs, a "
                       "cup and saucer on it", 1.4),
    # The Gull & Anchor
    "bar_counter": prop(INDOOR + "a long dark-wood pub bar counter with three brass beer pumps, a few pint glasses and a brass "
                        "foot rail along the bottom", 4.0),
    "bar_stool": prop(INDOOR + "a single round wooden bar stool", 0.5),
    "pub_table": prop(INDOOR + "a heavy round dark-wood pub table with two wooden stools and two pewter tankards on it", 1.6),
    "beer_barrels": prop(INDOOR + "three wooden beer barrels lying on their sides on a low wooden rack, brass taps in their "
                         "ends", 1.6),
    "fireplace": prop(INDOOR + "a stone fireplace with a cheerful log fire, a heavy wooden mantel with a ship in a bottle and "
                      "two candlesticks on it, a brass fender", 2.2),
    # Dunmore's General Store
    "store_shelves": prop(INDOOR + "a tall wooden shop shelving unit packed with glass jars, tins, packets, bottles and rolls "
                          "of string (no labels or text)", 2.0),
    "store_counter": prop(INDOOR + "a wooden shop counter with a brass cash register (no numbers), a kitchen weighing scale, "
                          "a big glass jar of sweets and a stack of brown paper bags", 3.0),
    "produce_crates": prop(INDOOR + "a low wooden stand holding open crates of apples, potatoes, carrots and cabbages", 1.5),
    # The Monde Free Library
    "bookshelf": prop(INDOOR + "a tall dark-wood bookcase full of colourful books, a few lying flat, a small brass plant pot "
                      "on top", 2.0),
    "reading_table": prop(INDOOR + "a long polished library reading table with two green-shaded brass lamps, open books and "
                          "four wooden chairs tucked in", 2.6),
    "card_catalogue": prop(INDOOR + "a wooden library card catalogue cabinet with many little drawers, each with a brass "
                           "handle and a blank label holder", 1.2),
    "librarian_desk": prop(INDOOR + "a curved wooden library desk with a rubber stamp and ink pad, two stacks of books, a "
                           "small brass bell and a reading lamp", 2.4),
    # The Lantern
    "printing_press": prop(INDOOR + "an old black cast-iron hand-operated printing press (an Albion press) with a long curved "
                           "pulling bar, a flat bed and a brass eagle finial on top", 1.9,
                           "the same press dusty and forgotten: grey with dust, cobwebs between its frame and the bar, a "
                           "torn dust sheet half slipped off it."),
    "type_cases": prop(INDOOR + "a printer's wooden type cabinet: sloping trays of tiny metal type on top and many shallow "
                       "drawers below", 2.0),
    # Town Hall
    "office_desk": prop(INDOOR + "a big polished mahogany desk with a green leather top, an inkwell, a black rotary telephone, "
                        "a stack of papers and a small brass desk lamp", 2.4),
    "pigeonholes": prop(INDOOR + "a tall wooden pigeonhole cabinet, every pigeonhole full of rolled documents, folded papers "
                        "and ledgers", 2.0),
    "registry_counter": prop(INDOOR + "a long panelled wooden public counter with a brass service bell and a big open ledger "
                             "on top", 3.0),
    # Achterberg Horlogerie
    "clock_wall": prop(INDOOR + "a tall wooden display panel hung with a dozen clocks of every shape: round, square, a "
                       "cuckoo clock, a sunburst, little pendulums, every one showing a different time (no numerals)", 2.4),
    "grandfather_clock": prop(INDOOR + "a tall longcase grandfather clock in dark wood with a brass pendulum behind a glass "
                              "door (no numerals)", 0.6),
    "watch_counter": prop(INDOOR + "a glass-topped watchmaker's shop counter, pocket watches laid on blue velvet inside it, "
                          "a jeweller's loupe and tiny tools on top", 2.4),
    # The boathouse
    "pilot_gig": prop(INDOOR + "a long slim wooden six-oared rowing gig lying UPSIDE DOWN on two wooden trestles, seen from "
                      "the side, its keel along the top, varnished planks, no name or letters", 5.0),
    "oars_rack": prop(INDOOR + "a wooden rack of long oars standing upright, a red-and-white lifebuoy hanging from it", 1.2),
    # The flats over the shops (§9.5 bakery_flat, margo_flat, pub_rooms...): the stairs up, against a back wall
    "staircase": prop(INDOOR + "a narrow wooden staircase with a turned banister, climbing from left to right up along a "
                      "back wall to a small landing and a closed door at the top (only the stairs, banister, landing and "
                      "door, no wall)", 2.0),
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
