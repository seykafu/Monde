// The 24 archetypes every arrival is built from (GDD Appendix A.2), as data. Pure: no I/O.
//
// Numbers are A.2's table (age range and lean, presentation weights, pull, values, base) and its prose (attire,
// likes, dislikes, voice, dreams, household shape, Requires). Two kinds of field are engine additions for the MVP and
// say so where they're defined: `workplaces` (place ids from content/places/places.yaml for the MVP boards) and the
// template-card material (`reasons`, `samples`) A.3.8's fallback needs.
import type { Pillar } from "../script/types";

export const ARCHETYPE_IDS = [
  "young_family", "school_family", "single_parent", "young_creative", "apprentice", "drifter",
  "remote_craftsperson", "shop_founder", "cook_baker", "builder", "fisher", "market_gardener", "mill_hand",
  "clinician", "schoolteacher", "retired_couple", "widowed_elder", "retired_keeper", "retired_organizer",
  "returnee", "birdwatcher", "retired_magician", "cartographer", "radio_tinkerer",
] as const;
export type ArchetypeId = (typeof ARCHETYPE_IDS)[number];

export type Lean = "Y" | "O" | "M";
export type Presentation = "f" | "m" | "a";
export type PillarVector = Readonly<Record<Pillar, number>>;

/** What the arrival gates read (A.2 "Requires", in the engine's terms). */
export interface ArrivalFacts {
  day: number;
  pillars: PillarVector;
  /** Town and story flags that are on (`project_<id>_done`, `project_<id>_started`, …). */
  flags: ReadonlySet<string>;
  /** Free restored homes and their beds (the hard cap, §6.4). */
  freeHomes: readonly { home: string; beds: number }[];
  /** Vacant homes still to restore. */
  unrestoredHomes: number;
  /** School roll, ages 5–12 (§6.7; 9 on Day 1). */
  pupils: number;
  /** Restored storefronts nobody trades from. */
  storefrontsFree: number;
}

/** A.3.3's shapes, as rules the household drawer follows. */
export type HouseholdShape =
  | { kind: "family"; adults: [number, number]; children: [number, number]; childAge: [number, number]; grandparent?: number }
  | { kind: "single_parent"; adult: [number, number]; children: [number, number]; childAge: [number, number] }
  | { kind: "one_or_two"; two: number }
  | { kind: "fisher" }
  | { kind: "couple"; age: [number, number] }
  | { kind: "widowed" }
  | { kind: "one" };

export interface Dream { id: string; text: string; stages: readonly [string, string, string] }

export interface Archetype {
  id: ArchetypeId;
  label: string;
  /** Adults' age range (A.2 "Age range"); children follow the shape. */
  age: readonly [number, number];
  lean: Lean;
  presentation: Readonly<Record<Presentation, number>>;
  pull: PillarVector;
  values: PillarVector;
  base: number;
  dayOne: number;
  /** Library attire tags the portrait picker prefers (A.3.5 step 4; content/portraits/library.json tags). */
  attire: readonly string[];
  occupations: readonly string[];
  /**
   * Engine addition: where they can work on the MVP boards (§9.5 place ids), or `home` (work from home), or nothing
   * (retired). GDD-GAP: A.2 names workplaces in prose only.
   */
  workplaces: readonly string[];
  likes: readonly string[];
  dislikes: readonly string[];
  voice: string;
  /** The voice note says formal: V10's contraction rule is waived. */
  formal?: boolean;
  dreams: readonly [Dream, Dream, Dream];
  shape: HouseholdShape;
  /** A.2 "Requires", over the engine's facts. */
  requires(f: ArrivalFacts): boolean;
  /** A.3.4 rule 6: the oddballs are capped at Day-1 count + 2 alive. */
  oddball?: boolean;
  /** Engine addition for A.3.8's template card: why they came (a clause after "came to Monde"). */
  reasons: readonly string[];
  /** Engine addition for A.3.8's template card: three style samples in the archetype's voice. */
  samples: readonly [string, string, string];
}

const P = (prosperity: number, safety: number, spirit: number, charm: number): PillarVector => ({ prosperity, safety, spirit, charm });
const W = (f: number, m: number, a: number): Readonly<Record<Presentation, number>> => ({ f, m, a });
const has = (f: ArrivalFacts, flag: string): boolean => f.flags.has(flag);
const started = (f: ArrivalFacts, project: string): boolean => has(f, `project_${project}_started`) || has(f, `project_${project}_done`);
const beds = (f: ArrivalFacts, n: number): boolean => f.freeHomes.some(h => h.beds >= n);
/** §2.3: the Commons opens on Day 6 (S04's Water Again, MVP_PLAN §4.1). */
const commonsOpen = (f: ArrivalFacts): boolean => f.day >= 6 || has(f, "commons_open");
const d = (archetype: string, n: number, text: string, s1: string, s2: string, s3: string): Dream =>
  ({ id: `${archetype}.d${n}`, text, stages: [s1, s2, s3] });

export const ARCHETYPES: readonly Archetype[] = [
  {
    id: "young_family", label: "Young family", age: [24, 36], lean: "Y", presentation: W(50, 46, 4),
    pull: P(0.25, 0.50, 0.15, 0.10), values: P(0.30, 0.35, 0.15, 0.20), base: 1.0, dayOne: 9,
    attire: ["jumper", "oilskin", "boots", "knit_cap", "coat"],
    occupations: ["half-time deckhand", "counter hand at the café", "bookkeeper by post"],
    workplaces: ["market_row.cafe_liss", "market_row.general_store", "wharf.harbor_steps", "home"],
    likes: ["hand-me-downs", "a gate that latches", "being waved at from windows"],
    dislikes: ["damp bedrooms", "steep steps without a rail", "being called brave for moving here"],
    voice: "Warm, tired, interrupted. Sentences start big and get cut off by a small person. Counts the day in naps.",
    dreams: [
      d("young_family", 1, "A toddler hour that isn't just the two of us", "Ask Margo if the library's reading corner can host a Tuesday morning", "Find two other households with a small child or grandchild (Regard ≥ 20 with each)", "Run the first hour with biscuits and one working kettle"),
      d("young_family", 2, "A front door of our own", "Get the house surveyed by Kasimir or a builder", "Gather three helpers for a paint-and-nail weekend", "Hang the new house number and invite the street"),
      d("young_family", 3, "Work within pram-pushing distance", "Ask around Market Row for part-time hours (Regard ≥ 25 with a shop owner)", "Do a trial week", "Get on the rota"),
    ],
    shape: { kind: "family", adults: [24, 36], children: [1, 2], childAge: [0, 4] },
    requires: f => beds(f, 2),
    reasons: ["because the rent in Carrow ate the baby's shoes", "because somebody said the Monde school still had a desk free", "for a house with a garden the length of a pram"],
    samples: ["We're settled. Mostly. The cot's still in the hall.", "She slept. Two hours. I could've cried.", "Is the bakery open on a Sunday, or is that a rumour?"],
  },
  {
    id: "school_family", label: "School-age family", age: [32, 48], lean: "Y", presentation: W(52, 45, 3),
    pull: P(0.20, 0.30, 0.40, 0.10), values: P(0.20, 0.30, 0.30, 0.20), base: 1.0, dayOne: 29,
    attire: ["school_jumper", "coat", "scarf", "boots", "satchel"],
    occupations: ["clerk by post", "joiner", "shop counter hand"],
    workplaces: ["home", "market_row.general_store", "old_quarter.town_hall"],
    likes: ["a lunch box packed right", "a teacher who remembers names", "a bench by the school gate"],
    dislikes: ["a closed school", "walking home in the dark", "being told the children will adapt"],
    voice: "Brisk and organizing. Speaks in lists of three and asks questions like a form. Ends sentences on the schedule.",
    dreams: [
      d("school_family", 1, "A school worth the walk", "Visit Felix's classroom (Regard ≥ 20 with felix)", "Help with a Friday lesson", "Sign the enrollment roll in front of the whole class"),
      d("school_family", 2, "Every child in the right room", "Find a desk at the library for the teenagers with Margo", "Back the Thursday-evening class", "Place the oldest with a Saturday master"),
      d("school_family", 3, "A garden with a gate", "Clear the plot behind the house", "Get seed from Teo or Dunmore's", "Plant it before the next Saturday market"),
    ],
    shape: { kind: "family", adults: [32, 48], children: [2, 3], childAge: [5, 17], grandparent: 0.2 },
    requires: f => beds(f, 3),
    reasons: ["because the Monde school is one room and they wanted that", "for the sea air, which the youngest was promised", "because the city schools had forty to a class"],
    samples: ["Shoes, satchels, sandwiches. Three things. We're out by eight.", "Who runs the Thursday class? Name and time, please.", "They'll settle. I asked them, and they said they'd settle."],
  },
  {
    id: "single_parent", label: "Single parent", age: [26, 45], lean: "Y", presentation: W(70, 28, 2),
    pull: P(0.40, 0.35, 0.15, 0.10), values: P(0.35, 0.30, 0.20, 0.15), base: 0.8, dayOne: 9,
    attire: ["coat", "tote", "scarf"],
    occupations: ["café shift worker", "pub kitchen hand", "Town Hall cleaner"],
    workplaces: ["market_row.cafe_liss", "market_row.gull_and_anchor", "old_quarter.town_hall"],
    likes: ["tea that stays hot long enough to finish", "neighbors who knock before advising", "a back door that locks"],
    dislikes: ["being pitied", "visitors at bedtime", "being asked who watches the children"],
    voice: "Efficient and dry, with one eye on a small person. Clipped sentences and the odd long breath.",
    dreams: [
      d("single_parent", 1, "Hours that fit around the school run", "Ask a shop owner for fixed morning hours (Regard ≥ 25)", "Swap school-run days with a neighbor (Regard ≥ 20)", "Write the timetable on the kitchen wall"),
      d("single_parent", 2, "One whole afternoon with nothing in it", "Meet a sitter they'd trust", "Take the child to the duck pond and leave the chores", "Sit down for an hour"),
      d("single_parent", 3, "A bedroom the child likes", "Buy paint at Dunmore's", "Borrow brushes from Kasimir", "Finish before the child's birthday"),
    ],
    shape: { kind: "single_parent", adult: [26, 45], children: [1, 2], childAge: [0, 14] },
    requires: f => beds(f, 2),
    reasons: ["because a cheaper roof beat a nearer job", "for a town where you can let a child walk to school", "because her sister said the ferry was cheap and the people weren't"],
    samples: ["Two minutes. That's what I've got. Go.", "No, she's fine. She's always fine. I'm the one who's late.", "Sit, if you're sitting. Mind the crayons."],
  },
  {
    id: "young_creative", label: "Young creative", age: [19, 34], lean: "Y", presentation: W(48, 40, 12),
    pull: P(0.10, 0.05, 0.40, 0.45), values: P(0.15, 0.10, 0.35, 0.40), base: 1.0, dayOne: 3,
    attire: ["smock", "coat", "scarf"],
    occupations: ["sign painter", "printmaker", "fiddler and bar hand"],
    workplaces: ["home", "market_row.market_street", "market_row.gull_and_anchor"],
    likes: ["good light through a dirty window", "old signage", "being asked what it's for"],
    dislikes: ["talented said like a diagnosis", "work offered for exposure", "rain on a wet mural"],
    voice: "Quick and funny. Over-explains, then apologizes. Uses art words slightly wrong and knows it.",
    dreams: [
      d("young_creative", 1, "A wall that's finished", "Pick a blank wall with Sable's help", "Get the owner's and the mayor's permission (Regard ≥ 25 with pell)", "Paint it over two weekends and hold the unveiling"),
      d("young_creative", 2, "A show with a real crowd", "Find a room in a restored storefront or the Market Hall", "Collect eight pieces", "Hold the opening on a Saturday"),
      d("young_creative", 3, "Teach the children to draw", "Ask Felix for a Friday slot (Regard ≥ 30)", "Gather paper and charcoal", "Hang the children's pictures along the Market Hall rail"),
    ],
    shape: { kind: "one_or_two", two: 0.4 },
    requires: f => (f.freeHomes.length > 0 || f.storefrontsFree > 0) && f.pillars.charm >= 35,
    reasons: ["because the light in Carrow is all chimneys", "after seeing a hand-painted sign of the Monde bakery in a junk shop", "for cheap walls and nobody minding the smell of turps"],
    samples: ["It's a sort of chiaroscuro. Is that the word? It's the dark bit.", "Sorry. I talk with my hands and they're blue.", "Ha. No. Well, yes, but not on purpose."],
  },
  {
    id: "apprentice", label: "Apprentice", age: [18, 24], lean: "Y", presentation: W(40, 52, 8),
    pull: P(0.50, 0.10, 0.25, 0.15), values: P(0.40, 0.10, 0.25, 0.25), base: 0.8, dayOne: 4,
    attire: ["apron", "boots", "tool_belt"],
    occupations: ["baker's apprentice", "carpentry apprentice", "boat-repair apprentice", "typesetting apprentice"],
    workplaces: ["market_row.bakery", "wharf.boathouse", "old_quarter.lantern_office", "wharf.fish_market"],
    likes: ["tools that fit the hand", "a proper job", "the smell of the workshop"],
    dislikes: ["sweeping as the whole job", "being called kid", "praise for nothing"],
    voice: "Eager and quick to blurt. Counts things: loaves, coins, days. Says sorry, then does it right.",
    dreams: [
      d("apprentice", 1, "Get good at something still needed", "Get a trial day with a master (Regard ≥ 20 with them)", "Finish a first piece", "Hear the master say again"),
      d("apprentice", 2, "Earn my own key", "Save 40 coins by community work", "Rent a room", "Cut a copy of the key and hang it on a nail"),
      d("apprentice", 3, "A ribbon at the fair", "Enter the craft table at Bloom Fair", "Get a straight critique from a rival", "Pin the ribbon above the bench"),
    ],
    // GDD-GAP: A.3.3's under-18 apprentice needs a sponsor household (A.3.4 rule 8); sponsors aren't built, so the MVP
    // draws apprentices 18–24 only.
    shape: { kind: "one" },
    requires: f => f.freeHomes.length > 0,
    reasons: ["because a master here still takes on someone who's never held the tool", "after a letter about a bench going spare", "because the city wanted three years' experience for the first year"],
    samples: ["Forty loaves! Forty. I've counted twice.", "Sorry. Sorry. I'll do it again, right this time.", "Is that how you hold it? Show me once more."],
  },
  {
    id: "drifter", label: "Drifter", age: [18, 29], lean: "Y", presentation: W(38, 50, 12),
    pull: P(0.10, 0.05, 0.35, 0.50), values: P(0.15, 0.10, 0.30, 0.45), base: 0.8, dayOne: 5,
    attire: ["coat", "scarf", "boots"],
    occupations: ["day labourer", "deckhand", "bar shifts"],
    workplaces: ["wharf.harbor_steps", "market_row.gull_and_anchor"],
    likes: ["free breakfast", "high places", "strangers' stories"],
    dislikes: ["being asked their plan", "paperwork", "rain on a borrowed coat"],
    voice: "Easy and ironic. Tells stories that start well and trail off. Answers a question with a question.",
    dreams: [
      d("drifter", 1, "Be good at one thing", "Try three jobs in a week", "Choose the one that stuck", "Tell someone out loud that you're staying"),
      d("drifter", 2, "Walk the whole coast", "Get a map from Margo or a cartographer", "Visit five landmarks on foot", "Write it up for the Lantern before dark"),
      d("drifter", 3, "Pay my own way", "Clear a 20-coin debt for the bunk", "Fix something nobody asked about", "Sign the register at Town Hall as a resident"),
    ],
    shape: { kind: "one_or_two", two: 0.15 },
    requires: f => f.freeHomes.length > 0,
    reasons: ["on a whim and the last of the ferry money", "because the Gannet was the first boat leaving", "to see whether the lighthouse was as tall as the postcard said"],
    samples: ["Plans? Who's been talking about plans.", "There was this fellow in Port Sallow, right, with a goat. Anyway.", "Breakfast's free if you look hungry enough. I look hungry."],
  },
  {
    id: "remote_craftsperson", label: "Remote craftsperson", age: [29, 62], lean: "M", presentation: W(50, 40, 10),
    pull: P(0.15, 0.15, 0.20, 0.50), values: P(0.25, 0.15, 0.25, 0.35), base: 0.8, dayOne: 6,
    attire: ["apron", "scarf", "smock"],
    occupations: ["potter", "weaver", "bookbinder", "model-boat builder"],
    workplaces: ["home"],
    likes: ["parcels arriving unbroken", "steady north light", "people who ask how it's made"],
    dislikes: ["could you do it cheaper", "damp materials", "the ferry missing a day"],
    voice: "Patient and exact. Talks in process words and describes weather by what it does to materials.",
    dreams: [
      d("remote_craftsperson", 1, "A kiln or a loom that isn't in the kitchen", "Find a workspace", "Get venting or power put in by Kasimir", "Make the first piece with an audience"),
      d("remote_craftsperson", 2, "A shelf in the Market Hall", "Show samples to the mayor (Regard ≥ 30 with pell)", "Fill a table at one Saturday market", "Win a standing order from a Market Row shop"),
      d("remote_craftsperson", 3, "Pass it on", "Meet an apprentice", "Teach a three-session class at the library", "Sign the first student's piece next to your own"),
    ],
    shape: { kind: "one_or_two", two: 0.4 },
    requires: f => beds(f, 2) && f.pillars.charm >= 40,
    reasons: ["because all the work goes by post anyway", "for a bench with north light and no landlord", "because the clay on this coast throws better than the clay in Tarn End"],
    samples: ["Damp morning. The glaze won't take till noon.", "Wedge it first. Always. Then you can argue with it.", "It's tension, mostly. Too tight and it puckers."],
  },
  {
    id: "shop_founder", label: "Small-business founder", age: [28, 55], lean: "M", presentation: W(50, 46, 4),
    pull: P(0.70, 0.15, 0.05, 0.10), values: P(0.50, 0.20, 0.10, 0.20), base: 0.7, dayOne: 6,
    attire: ["cardigan", "tape_measure", "glasses"],
    occupations: ["bookseller", "haberdasher", "chandler", "repair-counter keeper"],
    workplaces: ["home"],
    likes: ["a till that rings", "hand-lettered signs", "first customers"],
    dislikes: ["fees nobody explained", "just browsing said twice", "empty windows"],
    voice: "Brisk. A salesperson's warmth with a ledger underneath. Talks in prices and margins.",
    dreams: [
      d("shop_founder", 1, "Open by the end of the month", "Stock the shelves", "Get a sign painted", "Cut the ribbon with the mayor"),
      d("shop_founder", 2, "A first employee", "Post the job on the Lantern's board", "Interview two residents", "Hire one"),
      d("shop_founder", 3, "The shop everyone mentions", "Sell to ten different residents", "Win a standing order from the pub or the bakery", "Put the shop's name on the window glass"),
    ],
    shape: { kind: "one_or_two", two: 0.4 },
    requires: f => f.storefrontsFree >= 1 && f.pillars.prosperity >= 35,
    reasons: ["with savings and a plan in a biscuit tin", "because a shop on Market Row costs a tenth of one in Carrow", "after counting the empty shopfronts from the ferry rail"],
    samples: ["Let me do you a deal. Two for a bit more than one's price.", "Footfall's the thing. Footfall, then the window.", "Margins, mostly. And a good bell on the door."],
  },
  {
    id: "cook_baker", label: "Cook or baker", age: [24, 58], lean: "M", presentation: W(55, 42, 3),
    pull: P(0.40, 0.10, 0.15, 0.35), values: P(0.35, 0.10, 0.20, 0.35), base: 0.6, dayOne: 5,
    attire: ["apron", "checked"],
    occupations: ["baker", "pie-maker", "canteen cook"],
    workplaces: ["market_row.bakery", "market_row.cafe_liss", "market_row.gull_and_anchor"],
    likes: ["a hot oven at dawn", "people who ask for seconds", "rye flour"],
    dislikes: ["skimping", "cold kitchens", "a bit of salt"],
    voice: "Bossy-kind. Kitchen warnings as terms of endearment. Measures in handfuls.",
    dreams: [
      d("cook_baker", 1, "Learn the starter", "Turn up at four in the morning (Regard ≥ 30 with a baker)", "Feed the starter three days running", "Bake a loaf under supervision"),
      d("cook_baker", 2, "Cook for a hundred", "Plan a Harvest Supper menu", "Cook with four volunteers", "Serve it at the Market Hall"),
      d("cook_baker", 3, "Write the recipes down", "Collect ten recipes from residents", "Print them as a booklet at the Lantern press", "Sell it on market day"),
    ],
    shape: { kind: "one_or_two", two: 0.15 },
    requires: f => has(f, "project_bakery_ovens_done") || f.storefrontsFree >= 1,
    reasons: ["because somebody said the Monde ovens were lit again", "for a kitchen where you can hear the sea", "after the canteen in Port Sallow went to tins"],
    samples: ["Behind you. Hot. Mind yourself, I'm carrying.", "A handful. Yours, not mine. Mine's bigger.", "Eat. Then talk. Then eat again."],
  },
  {
    id: "builder", label: "Builder or restorer", age: [26, 60], lean: "M", presentation: W(25, 72, 3),
    pull: P(0.65, 0.15, 0.10, 0.10), values: P(0.45, 0.20, 0.15, 0.20), base: 0.7, dayOne: 5,
    attire: ["work_jacket", "pencil", "flat_cap", "boots"],
    occupations: ["carpenter", "roofer", "mason", "plumber"],
    workplaces: ["old_quarter.lamplighter_lane", "wharf.boathouse", "home"],
    likes: ["seasoned timber", "a sharp chisel", "plain tea"],
    dislikes: ["it'll do", "damp", "scaffolding that wobbles"],
    voice: "Slow and measured. Says mm while judging a wall. Metaphors from building; swears by the spirit level.",
    dreams: [
      d("builder", 1, "A roof I'm proud of", "Survey the worst roof on a Millbrook terrace", "Haul three loads of slate from the Wharf", "Finish it and have the street sign off"),
      d("builder", 2, "Train somebody", "Find a keen hand", "Teach three joints", "Hand over a job and keep your hands in your pockets"),
      d("builder", 3, "Raise the bandstand", "Examine the collapsed bandstand", "Draw the plan with Kasimir", "Lift the first beam on a Saturday"),
    ],
    shape: { kind: "one_or_two", two: 0.4 },
    requires: f => f.unrestoredHomes >= 3 && f.pillars.prosperity >= 30,
    reasons: ["because a town with sixty empty roofs needs somebody", "after hearing Kasimir Wolanski was working alone", "for work that stays standing"],
    samples: ["Mm. That wall's leaning. Not much. Enough.", "Measure twice. Then have tea. Then measure again.", "Level's the level. It doesn't care what you hoped."],
  },
  {
    id: "fisher", label: "Fisher", age: [22, 64], lean: "M", presentation: W(30, 68, 2),
    pull: P(0.45, 0.35, 0.10, 0.10), values: P(0.40, 0.35, 0.10, 0.15), base: 0.8, dayOne: 15,
    attire: ["oilskin", "knit_cap", "jumper", "boots"],
    occupations: ["boat owner", "deckhand", "crab-pot fisher"],
    workplaces: ["wharf.harbor_steps", "wharf.fish_market"],
    likes: ["flat calm at dawn", "good rope", "smoked fish"],
    dislikes: ["tangled gear", "loud engines", "gulls on the catch"],
    voice: "Short, weather first, understated. \"Fair.\" \"Could be worse.\" \"Tide's making.\"",
    dreams: [
      d("fisher", 1, "A boat with my name on it", "Find a hull and bring it to the boathouse", "Raise 60 coins from catches and community work", "Launch on Regatta day"),
      d("fisher", 2, "Open the cannery again", "Be one of ten signatures on the co-op petition", "Pitch the co-op to Nell (Regard ≥ 30)", "Make the first landing at the cannery"),
      d("fisher", 3, "Know the bay like a hand", "Row the coast with Old Moss or an elder fisher", "Mark three hazards on the harbour chart with Margo", "Skipper a heat at the Regatta"),
    ],
    shape: { kind: "fisher" },
    requires: f => f.pillars.safety >= 30,
    reasons: ["from Port Sallow, where the berths went to the freight boats", "because Marrow Quay silted up and the fish went elsewhere", "for a berth that doesn't cost a week's catch"],
    samples: ["Fair. Wind's backing.", "Could be worse. Could be raining.", "Tide's making. I'll be off."],
  },
  {
    id: "market_gardener", label: "Market gardener", age: [30, 66], lean: "M", presentation: W(55, 40, 5),
    pull: P(0.15, 0.10, 0.40, 0.35), values: P(0.20, 0.15, 0.35, 0.30), base: 0.6, dayOne: 3,
    attire: ["straw_hat", "jumper", "boots"],
    occupations: ["market gardener", "flower grower", "herb grower"],
    workplaces: ["commons.community_garden", "commons.glasshouse"],
    likes: ["rain at night", "good compost", "children who pull carrots"],
    dislikes: ["slugs", "bindweed", "people who step on beds"],
    voice: "Kind and earthy. Few metaphors, all small. \"Give it time.\"",
    dreams: [
      d("market_gardener", 1, "A plot that feeds the street", "Clear a bed in the Community Garden", "Plant a first row with seed from Teo", "Bring the first harvest to market"),
      d("market_gardener", 2, "Tomatoes under glass", "Help replace panes in the Glasshouse", "Start seed trays", "Taste the first one with Teo"),
      d("market_gardener", 3, "A scarecrow with a following", "Build one with the children", "Enter it at the Harvest Supper", "Win a ribbon, or lose gracefully"),
    ],
    shape: { kind: "one_or_two", two: 0.4 },
    requires: f => commonsOpen(f) && (started(f, "community_garden") || started(f, "glasshouse")),
    reasons: ["for ground that hasn't been dug in years", "because a garden on the Commons is worth a dozen windowsills", "after the allotments in Ashby Lock were sold for a car park"],
    samples: ["Give it time. Everything's slow in April.", "Slugs had the lettuces. Every one. They're clever things.", "Rain last night. Good. Good."],
  },
  {
    id: "mill_hand", label: "Former mill hand", age: [44, 66], lean: "M", presentation: W(48, 50, 2),
    pull: P(0.75, 0.15, 0.05, 0.05), values: P(0.55, 0.20, 0.10, 0.15), base: 0.9, dayOne: 18,
    attire: ["cardigan", "flat_cap", "work_jacket"],
    occupations: ["loom-setter", "casual repair hand", "boathouse shift worker"],
    workplaces: ["wharf.boathouse", "market_row.market_street"],
    likes: ["tea in a tin mug", "the sound of a loom running true", "a clock that keeps time"],
    dislikes: ["being retrained", "short shifts", "men with clipboards"],
    voice: "Plain and short. Knows the numbers: picks, bolts, hours. \"Used to be.\"",
    dreams: [
      d("mill_hand", 1, "Wages for work again", "Register at Town Hall", "Do one casual job a day for three days", "Take a shift at the boathouse, or a floor job when the Mill reopens"),
      d("mill_hand", 2, "Get the old loom turning", "Find the loom parts in the Mill yard", "Oil and set them with Kasimir", "Run the first bolt of cloth"),
      d("mill_hand", 3, "Be asked for advice", "Mentor an apprentice", "Give a safety talk before the Mill reopens", "Be named floor lead"),
    ],
    shape: { kind: "one_or_two", two: 0.4 },
    requires: f => f.pillars.prosperity >= 35,
    reasons: ["from a closed mill town much like this one", "because the packing floor in Hessle Cross went to night shifts", "on the rumour that Monde's mill might turn again"],
    samples: ["Used to be eight hundred picks a minute. Used to be.", "Short shift. Short pay. Tea's the same.", "Clock's three minutes fast. Somebody should see to it."],
  },
  {
    id: "clinician", label: "Doctor or nurse", age: [29, 55], lean: "M", presentation: W(62, 34, 4),
    pull: P(0.10, 0.65, 0.20, 0.05), values: P(0.15, 0.40, 0.30, 0.15), base: 0.3, dayOne: 0,
    attire: ["coat", "glasses"],
    occupations: ["doctor", "nurse", "midwife"],
    workplaces: ["home"],
    likes: ["clean hands", "a kettle in the surgery", "patients who tell the truth"],
    dislikes: ["it's only a cough said for a month", "stairs with a stretcher", "turpentine cures"],
    voice: "Calm and plain. Asks short questions and waits.",
    dreams: [
      d("clinician", 1, "A clinic where the lamp stays on", "Inventory the supplies with Priya", "Set the Tuesday and Friday surgeries to match the ferry", "See the first thirty patients"),
      d("clinician", 2, "Know every family", "Make house calls on ten homes", "Fill in the town health ledger with Margo", "Hold a no-appointment afternoon"),
      d("clinician", 3, "Teach first aid", "Run a class at the school (Regard ≥ 30 with felix)", "Teach the Wharf crews a rope-and-splint course", "Leave a kit at the pub"),
    ],
    shape: { kind: "one_or_two", two: 0.15 },
    // GDD-GAP: the clinic Project is outside the MVP (§4.2), so `project.clinic.progress >= 50` never holds in Spring.
    requires: f => has(f, "project_clinic_half") && f.pillars.safety >= 40,
    reasons: ["because a town with no doctor needs one more than a city with forty", "after a letter from Priya about the lamp", "for patients who know your name"],
    samples: ["Tell me where it hurts. Then where you've been pretending it doesn't.", "Sit. Sleeve up. Good.", "How long? Truly. Don't round it down."],
  },
  {
    id: "schoolteacher", label: "Schoolteacher", age: [25, 60], lean: "M", presentation: W(66, 30, 4),
    pull: P(0.10, 0.30, 0.50, 0.10), values: P(0.15, 0.25, 0.40, 0.20), base: 0.3, dayOne: 0,
    attire: ["cardigan", "glasses", "satchel"],
    occupations: ["schoolteacher", "assistant teacher"],
    workplaces: ["millbrook.school"],
    likes: ["chalk", "a full register", "a child asking why"],
    dislikes: ["leaks over the desks", "forms in triplicate", "good enough"],
    voice: "Gentle authority. Teaches by asking: \"What do you notice?\"",
    dreams: [
      d("schoolteacher", 1, "A second pair of hands in the room", "Tour the school with Felix (Regard ≥ 30)", "Take the youngest group for a morning", "Draw up the timetable together"),
      d("schoolteacher", 2, "A class for the teenagers", "Find five teen students", "Borrow Margo's reading room", "Hold the first examination"),
      d("schoolteacher", 3, "A school trip", "Plan the route with Old Moss", "Raise 30 coins", "Sail the whole school round the bay on the Gannet"),
    ],
    shape: { kind: "one_or_two", two: 0.15 },
    requires: f => f.pupils >= 15 && !has(f, "school_second_teacher"),
    reasons: ["because a one-room school with a desk waiting is a rare thing", "after a letter from Felix that was mostly about chalk", "for a register short enough to learn by heart"],
    samples: ["What do you notice? Take your time.", "Hands up if you know. Hands down if you're guessing.", "Good. Now tell me why it's so."],
  },
  {
    id: "retired_couple", label: "Retired couple", age: [60, 78], lean: "O", presentation: W(50, 50, 0),
    pull: P(0.05, 0.40, 0.10, 0.45), values: P(0.10, 0.35, 0.20, 0.35), base: 1.0, dayOne: 34,
    attire: ["raincoat", "cardigan", "scarf"],
    occupations: ["retired", "retired clerk", "retired draper"],
    workplaces: [],
    likes: ["a morning paper", "a kettle on the stove", "pleasant strangers"],
    dislikes: ["stairs", "drafts", "being managed"],
    voice: "Companionable. They finish each other's sentences and disagree as a form of affection. \"Don't we, dear?\"",
    dreams: [
      d("retired_couple", 1, "A bench with a view", "Choose a spot on the Commons", "Raise 15 coins or ask Kasimir to build it", "Sit on it with the first neighbor who stops"),
      d("retired_couple", 2, "Dancing on a Saturday night", "Find a hall", "Find a gramophone or a band", "Hold the dance"),
      d("retired_couple", 3, "Be useful, not just present", "Volunteer three shifts at the library, school or garden", "Get thanked by name in the Lantern", "Take a regular chair at the pub"),
    ],
    shape: { kind: "couple", age: [60, 78] },
    requires: f => f.pillars.safety >= 35 || f.pillars.charm >= 40,
    reasons: ["to downsize, with small savings and big opinions about the sea", "because they honeymooned here forty years ago and swore they'd come back", "for a ground floor and a sea view, in that order"],
    samples: ["We take the paper, don't we, dear? Both of us. Separately.", "He says the tea's stewed. It isn't. He likes it stewed.", "Lovely morning. Bit of a draught, but lovely."],
  },
  {
    id: "widowed_elder", label: "Widowed elder", age: [63, 88], lean: "O", presentation: W(72, 26, 2),
    pull: P(0.05, 0.35, 0.45, 0.15), values: P(0.10, 0.40, 0.30, 0.20), base: 0.8, dayOne: 22,
    attire: ["cardigan", "brooch", "headscarf"],
    occupations: ["retired", "retired seamstress", "retired postmistress"],
    workplaces: [],
    likes: ["knitting", "small birds at the window", "being asked for a story"],
    dislikes: ["boys on bicycles with no bells", "being called grandma by strangers", "a cold stove"],
    voice: "Gentle, rambling on purpose, circles back. \"Now where was I?\" Remembers prices from forty years ago.",
    dreams: [
      d("widowed_elder", 1, "Someone to eat supper with", "Be invited to supper by a neighbor (Regard ≥ 25)", "Return the invitation", "Set a standing Thursday table"),
      d("widowed_elder", 2, "Finish the quilt", "Gather scraps from five residents, each with a story", "Sew at the library table", "Hang the quilt at the Harvest Supper"),
      d("widowed_elder", 3, "Keep the chapel candles lit", "Trim the candles at St. Brigid's for a week", "Ask the sexton for the key", "Light the first lantern on Lantern Night"),
    ],
    shape: { kind: "widowed" },
    requires: f => f.pillars.spirit >= 30,
    reasons: ["for the quiet, after the house in Hessle Cross got too big", "because her late husband always said they'd retire by the sea", "to be nearer a nephew who never visits"],
    samples: ["Now where was I? The bread. One coin, it was. One coin.", "Sit down, sit down. The kettle's thinking about it.", "Little sparrow on the sill this morning. Bold as you like, he's back."],
  },
  {
    id: "retired_keeper", label: "Retired keeper of lights", age: [62, 80], lean: "O", presentation: W(30, 68, 2),
    pull: P(0.05, 0.45, 0.30, 0.20), values: P(0.15, 0.40, 0.25, 0.20), base: 0.4, dayOne: 3,
    attire: ["peaked_cap", "navy_jumper"],
    occupations: ["retired lighthouse keeper", "retired harbour pilot", "retired signalman"],
    workplaces: [],
    likes: ["barometers", "steady rain", "a kettle on a spirit stove"],
    dislikes: ["a stuttering foghorn", "guessing", "sloppy knots"],
    voice: "Laconic and precise. Gives the weather first and the time in bells. \"Wind's backing.\"",
    dreams: [
      d("retired_keeper", 1, "See the light turn again", "Climb the lighthouse with a lantern and inspect the lamp", "Replace the lens bearing with Kasimir", "Stand in the lamp room for the first night's beam"),
      d("retired_keeper", 2, "A logbook kept right", "Start a weather log at the lighthouse", "Give it to the Lantern to print", "Hand it on to the next keeper"),
      d("retired_keeper", 3, "Teach someone to read the sky", "Take the school out at dusk (Regard ≥ 25 with felix)", "Teach three cloud names", "Give a child the barometer"),
    ],
    shape: { kind: "one_or_two", two: 0.3 },
    requires: f => started(f, "lighthouse") && f.pillars.safety >= 35,
    oddball: false,
    reasons: ["because somebody is finally mending Point Lumière", "for a coast with a light worth keeping", "after forty years of other people's lights"],
    samples: ["Wind's backing. Rain by four bells.", "Glass is falling. Bring the washing in.", "Knot's wrong. Again. Watch."],
  },
  {
    id: "retired_organizer", label: "Retired organizer", age: [58, 76], lean: "O", presentation: W(55, 42, 3),
    pull: P(0.05, 0.10, 0.70, 0.15), values: P(0.15, 0.15, 0.50, 0.20), base: 0.5, dayOne: 7,
    attire: ["blazer", "glasses", "cardigan"],
    occupations: ["retired union steward", "retired church committee chair", "retired scout leader"],
    workplaces: [],
    likes: ["lists", "a gavel", "being thanked by name"],
    dislikes: ["meetings without minutes", "people who don't do committees", "cold tea"],
    voice: "Brisk, formal with warmth. Says \"Item one.\" Asks for volunteers by looking at you.",
    dreams: [
      d("retired_organizer", 1, "A rota that works", "Collect ten volunteers' names (Regard ≥ 20 with each)", "Print the rota at the Lantern", "Run one full week with no gap"),
      d("retired_organizer", 2, "A Harvest Supper committee", "Hold a first meeting in the pub's back room", "Assign roles", "Run the supper on time"),
      d("retired_organizer", 3, "A welcome for newcomers", "Meet three arrivals at the slip", "Give each a welcome basket", "Add a newcomer's guide to the Lantern"),
    ],
    shape: { kind: "one_or_two", two: 0.4 },
    requires: f => f.pillars.spirit >= 35,
    reasons: ["because a town this size runs on committees and has none", "after reading in the paper that Monde's fair needs hands", "for a rota that's never been tried"],
    samples: ["Item one. Who's got the key to the hall?", "Volunteers? Thank you. I'd been looking at you.", "Minutes, please. Somebody always forgets the minutes."],
  },
  {
    id: "returnee", label: "Returnee", age: [18, 82], lean: "M", presentation: W(50, 46, 4),
    pull: P(0.25, 0.25, 0.35, 0.15), values: P(0.20, 0.25, 0.30, 0.25), base: 0.6, dayOne: 0,
    attire: ["coat"], occupations: ["returning resident"], workplaces: ["home"],
    likes: ["the old smells of the place", "being recognized in the street", "their old chair"],
    dislikes: ["you haven't changed a bit", "being asked why they left in company", "fuss on the slip"],
    voice: "Careful, a little formal at first. Says \"used to\" a lot.",
    dreams: [
      d("returnee", 1, "Make it right", "Visit the person they left behind", "Say the one thing", "Share a meal"),
      d("returnee", 2, "See it whole again", "Walk the old route", "Tell the Lantern what has changed", "Do one small repair"),
      d("returnee", 3, "Stay", "Unpack and sign the register", "Take a post or a trade", "Hang their name on the door"),
    ],
    shape: { kind: "one" },
    // GDD-GAP: returnees come from the Departed list by letter (A.3.9, A.4), never from the roll; not part of G-02.
    requires: () => false,
    reasons: ["home again"], samples: ["Used to be a bench here.", "It's smaller. Or I'm bigger.", "I'll manage. I used to."],
  },
  {
    id: "birdwatcher", label: "Birdwatcher", age: [32, 82], lean: "O", presentation: W(45, 50, 5),
    pull: P(0.05, 0.15, 0.25, 0.55), values: P(0.05, 0.25, 0.30, 0.40), base: 0.4, dayOne: 2,
    attire: ["raincoat", "scarf", "boots"],
    occupations: ["bird counter for a Carrow society", "nature writer"],
    workplaces: [],
    likes: ["stillness", "flasks of tea", "being believed"],
    dislikes: ["dogs off the lead", "brass bands in nesting season", "is it a seagull asked of every white bird"],
    voice: "Whispers by default. Precise about species, vague about people. \"Shh. No, wait. Fine. It's gone.\"",
    dreams: [
      d("birdwatcher", 1, "The first heron of spring", "Watch from the footbridge at dawn, three mornings", "Log it in the Lantern's nature column", "Name the heron"),
      d("birdwatcher", 2, "A hide on the breakwater", "Choose a spot on the Wharf", "Build it from scrap with Kasimir", "Open it for a school visit"),
      d("birdwatcher", 3, "Count the Briar Woods owls", "Walk the Briar Woods path at dusk", "Spot an owl", "Report to Margo"),
    ],
    shape: { kind: "one_or_two", two: 0.15 },
    requires: f => commonsOpen(f) && f.pillars.charm >= 30,
    oddball: true,
    reasons: ["for the herons on the Liss, which nobody has counted since the war of the stamps", "because the society in Carrow needed someone on this stretch of coast", "after a turnstone landed on the ferry rail and stayed"],
    samples: ["Shh. No, wait. Fine. It's gone.", "Turnstone. Two. No, three.", "It isn't a seagull. Nothing is ever a seagull."],
  },
  {
    id: "retired_magician", label: "Semi-retired magician", age: [58, 82], lean: "O", presentation: W(30, 65, 5),
    pull: P(0.05, 0.05, 0.40, 0.50), values: P(0.10, 0.10, 0.35, 0.45), base: 0.3, dayOne: 1,
    attire: ["velvet_jacket", "scarf"],
    occupations: ["semi-retired stage magician", "fairground conjuror"],
    workplaces: [],
    likes: ["gasps", "a good cape", "children who guess wrong"],
    dislikes: ["hecklers who know how it's done", "rain on a poster", "being asked to do something"],
    voice: "Theatrical and self-mocking, with patter in every sentence.",
    dreams: [
      d("retired_magician", 1, "One more full house", "Find a stage", "Recruit an assistant from the young residents", "Perform at a festival"),
      d("retired_magician", 2, "Hand on the Great Trick", "Pick a pupil who asks the right questions", "Teach the first pass over three sessions", "Watch them do it without a mistake"),
      d("retired_magician", 3, "Make a bad mood disappear", "Visit three residents who are glum", "Perform at each door", "Hear all three laugh"),
    ],
    shape: { kind: "one_or_two", two: 0.3 },
    requires: f => f.pillars.spirit >= 35,
    oddball: true,
    reasons: ["with a trunk of props that has outlived three assistants", "because the piers in Port Sallow stopped booking turns", "for one more full house before the gloves go in a drawer"],
    samples: ["Observe: nothing up my sleeve, which is a tragedy for the sleeve.", "Pick a card. Not that one. Fine, that one'll do.", "The trick, my friend, is that there's always a trick."],
  },
  {
    id: "cartographer", label: "Cartographer", age: [30, 72], lean: "M", presentation: W(50, 42, 8),
    pull: P(0.20, 0.10, 0.25, 0.45), values: P(0.20, 0.15, 0.25, 0.40), base: 0.3, dayOne: 2,
    attire: ["satchel", "coat", "glasses"],
    occupations: ["cartographer", "surveyor", "chart-maker"],
    workplaces: ["home"],
    likes: ["fresh paper", "a sharp pencil", "a true compass"],
    dislikes: ["roughly", "folded maps", "being told it's just up there"],
    voice: "Precise and wry. Gives directions as bearings and distances. \"As the crow flies, which is unhelpful.\"",
    dreams: [
      d("cartographer", 1, "Redraw Monde from the ground up", "Walk each zone with a measuring chain", "Compare it with Aurélien's original in the library with Margo", "Print one and post it at the station"),
      d("cartographer", 2, "Find the missing lane", "Ask elders where the old lanes ran", "Walk the lane into Briar Woods", "Put it on the map and name it"),
      d("cartographer", 3, "A trail from the Wharf to the Folly", "Set waymarks with Kasimir", "Test-walk the route with the school class", "Publish the leaflet through the Lantern"),
    ],
    shape: { kind: "one_or_two", two: 0.15 },
    requires: f => f.pillars.charm >= 35,
    oddball: true,
    reasons: ["because Aurélien Monde's maps are the best on the coast and nobody has checked them", "for a town small enough to measure on foot", "after finding a Monde street that isn't on any chart"],
    samples: ["Two hundred yards, bearing north-east. As the crow flies, which is unhelpful.", "Roughly? Nothing's roughly. Everything's somewhere.", "Don't fold it. Roll it. Thank you."],
  },
  {
    id: "radio_tinkerer", label: "Radio and clock tinkerer", age: [40, 80], lean: "O", presentation: W(40, 55, 5),
    pull: P(0.20, 0.10, 0.40, 0.30), values: P(0.20, 0.15, 0.30, 0.35), base: 0.4, dayOne: 4,
    attire: ["smock", "glasses", "apron"],
    occupations: ["radio repairer", "clock repairer", "repair-counter tinkerer"],
    workplaces: ["home"],
    likes: ["a hot soldering iron", "a fault found", "patient audiences"],
    dislikes: ["it's only a radio", "static in the evening", "being handed a hammer"],
    voice: "Murmurs while working. Explains things with plumbing. \"Hold this. No, the other this.\"",
    dreams: [
      d("radio_tinkerer", 1, "One wireless for the whole town", "Fix the Hall's old set", "Tune the evening shipping forecast for the pub", "Hold the first Listening Night"),
      d("radio_tinkerer", 2, "An aerial on the water tower", "Ask Hollis's permission (Regard ≥ 30 with hollis)", "Rig the aerial with Kasimir", "Pick up a signal from Carrow"),
      d("radio_tinkerer", 3, "A clock for the oldest hands", "Visit Bertrand (Regard ≥ 30)", "Find a missing part", "Present the working clock"),
    ],
    shape: { kind: "one" },
    requires: () => true,
    oddball: true,
    reasons: ["with a back room's worth of valves in two suitcases", "because a town with a stopped clock needs someone who talks to machines", "for evenings quiet enough to hear a signal from Carrow"],
    samples: ["Hold this. No, the other this.", "It's like a pipe, see. The signal's the water.", "Fault's found. Fault's always somewhere."],
  },
];

export const ARCHETYPE_BY_ID: ReadonlyMap<ArchetypeId, Archetype> = new Map(ARCHETYPES.map(a => [a.id, a]));
export const archetypeOf = (id: string): Archetype | undefined => ARCHETYPE_BY_ID.get(id as ArchetypeId);

/** Archetypes that count as having a purpose without a workplace (Stay's `has_job_or_purpose`). */
export const PURPOSEFUL = new Set<ArchetypeId>([
  // GDD-GAP: §6.4 doesn't define "purpose". Retirees whose archetype brings a standing role (A.2 "Brings": volunteers,
  // a light to keep, a count, a turn at the festival) count; a widowed elder or a drifter has to find one first.
  "retired_couple", "retired_organizer", "retired_keeper", "birdwatcher", "retired_magician", "radio_tinkerer",
  "remote_craftsperson", "cartographer",
]);
