// Name banks for generated arrivals (GDD Appendix A.3.6 "name pool (use or invent)", A.3.7 V02/V03, A.3.8 template
// names). Fictional, storybook-modern and mixed, like the town: nothing that reads as a famous person. Pure data.

/** First names by portrait presentation (A.2: f / m / a). */
export const FIRST_NAMES = {
  f: [
    "Agathe", "Annick", "Bettina", "Brigitte", "Carmen", "Cecily", "Clemency", "Dagny", "Elodie", "Esme", "Fenna",
    "Greta", "Hedda", "Henrike", "Ilse", "Ingrid", "Jolanta", "Kerensa", "Leonie", "Lise", "Lotte", "Lucinda", "Magda",
    "Malin", "Mireille", "Noor", "Oona", "Pernille", "Rosalie", "Saoirse", "Solveig", "Tamsin", "Ursula", "Vera",
    "Yara", "Zofia", "Amara", "Folake", "Mei", "Anouk", "Coralie", "Nadia", "Ottilie", "Signe", "Wanda",
  ],
  m: [
    "Albrecht", "Anselm", "Arvid", "Benedek", "Cyprian", "Dmitri", "Elias", "Emeric", "Florian", "Gaspard", "Hamish",
    "Henrik", "Idris", "Ivo", "Jasper", "Joaquim", "Kofi", "Lorcan", "Lucien", "Matthias", "Nils", "Oskar", "Pascal",
    "Quentin", "Rafael", "Rasmus", "Sefton", "Tadeusz", "Tomasz", "Ulf", "Viggo", "Wim", "Yannick", "Zoltan", "Ezra",
    "Kwame", "Ravi", "Anders", "Emil", "Aurelio", "Bram", "Corentin", "Halvard",
  ],
  a: [
    "Ash", "Bryn", "Cass", "Ellis", "Emery", "Frankie", "Jude", "Kit", "Lee", "Merritt", "Noel", "Quinn", "Rowan",
    "Sage", "Sasha", "Tam", "Wren", "Arden", "Linden", "Morgan",
  ],
} as const;

export const FAMILY_NAMES = [
  "Aalders", "Abernethy", "Akande", "Aldana", "Bakker", "Balogun", "Blaauw", "Brennan", "Castell", "Dahl", "Delvaux",
  "Drummond", "Ekwueme", "Falk", "Ferreira", "Fitzroy", "Gallagher", "Garnier", "Grieve", "Halvorsen", "Haldane",
  "Hartigan", "Holm", "Iversen", "Jankowski", "Jessop", "Kaminski", "Keane", "Kowal", "Lachance", "Larkin", "Lindgren",
  "Lowe", "Maertens", "Marlowe", "Morrow", "Nakamura", "Novak", "Nwosu", "Oakes", "Olander", "Pajari", "Pemberton",
  "Quarrie", "Rasku", "Rennick", "Rowntree", "Salerno", "Sandoval", "Selby", "Sorensen", "Tamsett", "Thackeray",
  "Tolland", "Ueda", "Vasquez", "Verhoeven", "Waddell", "Whitlock", "Yardley", "Zanetti", "Adeyemi", "Brodsky",
  "Coutinho", "Daventry", "Engström", "Fairweather", "Gorski", "Hawthorne", "Ishikawa", "Kerrigan", "Lombardi",
  "Mendel", "Okonjo", "Pryce", "Ruskova", "Sato", "Tremaine", "Underhill", "Vidmar", "Winslow",
] as const;

/**
 * Names nobody generated may carry (A.3.4 rule 7, A.3.7 V03): the core cast and featured residents, the Tollmen, the
 * named Day-1 people (A.1.5) and the Departed (A.4). First names here can't be an arrival's first name either.
 */
export const RESERVED_FIRST_NAMES: readonly string[] = [
  // Core cast and featured residents (content/residents).
  "Bertrand", "Ada", "Bru", "Augusta", "Ines", "Bastien", "Delphine", "Hollis", "Mossimo", "Moss", "Juniper", "June",
  "Marguerite", "Margo", "Edwina", "Felix", "Nell", "Odile", "Sable", "Kasimir", "Priya", "Rosalind", "Roz", "Nettie",
  "Roland", "Rook", "Teodor", "Teo", "Silas", "Tobias", "Tib",
  // Named Day-1 residents and the Tollmen (A.1.5).
  "Barnaby", "Barney", "Hester", "Raman", "Ilona", "Alphonse", "Ferdinand", "Ignatia", "Dolores", "Dolly", "Dex", "Dom",
  "Wendell", "Marit", "Cormac",
  // The Departed (A.4).
  "Odette", "Teddy", "Ivy", "Chidi", "Pippa", "Saffron", "Lyle", "Ambrose", "Fenwick", "Cornelius", "Hugo", "Philomena",
  "Hyacinth", "Waldemar", "Ilka", "Claudine", "Dennis", "Gustav", "Beatrix", "Colm", "Ruari", "Maeve", "Finn", "Isla",
  "Calder", "Nadine", "Sunny", "Wick", "Mateo", "Lucía", "Lucia", "Marisol", "Hazel", "Posy",
  // S05's stand-in until the first real arrival (story/host.ts).
  "Robin",
];

export const RESERVED_FAMILY_NAMES: readonly string[] = [
  "Achterberg", "Okafor", "Haskett", "Reyes", "Delacroix", "Mercer", "Brandt", "Ferrante", "Castellanos", "Liang", "Pell",
  "Amari", "Dunmore", "Fournier", "Moreau", "Wolanski", "Ramaswamy", "Hale", "Szabo", "Petrescu", "Vane", "Quill",
  "Quist", "Marchetti", "Voss", "Frane", "Calloway", "Pike", "Marsh", "Lumsden", "Aldous", "Brandvold", "Ashe",
  "Penhallow", "Marchbank", "Greaves", "Barrow", "Teague", "Strand", "Harcourt", "Lindqvist", "Amsel", "Rafferty",
  "Garrick", "Pruitt", "Vidal", "Quennell", "Monde",
];

/** A few famous names the pools could assemble (V03's deny list); checked case- and accent-insensitively. */
export const FAMOUS_NAMES: readonly string[] = [
  "Oskar Schindler", "Ingrid Bergman", "Greta Garbo", "Vera Lynn", "Hamish Macbeth", "Jude Law", "Ezra Pound", "Emil Nolde",
  "Anders Celsius", "Elias Howe", "Rafael Nadal", "Henrik Ibsen", "Lise Meitner", "Ursula Andress", "Noel Coward",
  "Florian Schneider", "Tomasz Kowal", "Viggo Mortensen", "Kofi Annan", "Nils Holm",
];

/** Lowercase, accents folded: how V03 compares names. */
export const foldName = (name: string): string => name.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
