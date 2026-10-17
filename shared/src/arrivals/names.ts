// Name banks for generated residents: the Day-1 census (Appendix A.1.5, shared/src/census) and arrivals (A.3.6 "name
// pool (use or invent)", A.3.7 V02/V03, A.3.8 template names). Fictional, storybook-European and coastal, and mixed like
// the town: 150 first names for each of f and m, 100 androgynous ones, 300 family names. Nothing that reads as a famous
// person (FAMOUS_NAMES lists the combinations the banks could still assemble). Pure data.

/** First names by portrait presentation (A.2: f / m / a). */
export const FIRST_NAMES = {
  f: [
    "Agathe", "Annick", "Bettina", "Brigitte", "Carmen", "Cecily", "Clemency", "Dagny", "Elodie", "Esme", "Fenna",
    "Greta", "Hedda", "Henrike", "Ilse", "Ingrid", "Jolanta", "Kerensa", "Leonie", "Lise", "Lotte", "Lucinda", "Magda",
    "Malin", "Mireille", "Noor", "Oona", "Pernille", "Rosalie", "Saoirse", "Solveig", "Tamsin", "Ursula", "Vera",
    "Yara", "Zofia", "Amara", "Folake", "Mei", "Anouk", "Coralie", "Nadia", "Ottilie", "Signe", "Wanda",
    "Adela", "Aino", "Alida", "Aline", "Alys", "Anneke", "Antje", "Astrid", "Aurore", "Beata", "Bernadette", "Birgit",
    "Bronwen", "Camilla", "Celeste", "Clio", "Constance", "Cordelia", "Dalia", "Delia", "Dorota", "Edda", "Eilidh",
    "Elin", "Elke", "Elspeth", "Emmeline", "Estelle", "Fenella", "Freja", "Genevieve", "Gwendolen", "Heloise", "Hilde",
    "Honor", "Imke", "Irene", "Isolde", "Janneke", "Josette", "Katrien", "Klara", "Laila", "Lavinia", "Liesel",
    "Linnea", "Liv", "Lorna", "Lucette", "Marthe", "Matilde", "Mette", "Mina", "Morwenna", "Nerys", "Olwen", "Orla",
    "Paloma", "Petra", "Philippa", "Rhona", "Romy", "Rosamund", "Ruth", "Sabine", "Selma", "Seren", "Silke", "Sinead",
    "Sorcha", "Svea", "Tilde", "Ulla", "Winifred", "Zuzanna", "Adaeze", "Ayesha", "Farida", "Leila", "Soraya",
    "Anjali", "Meera", "Suki", "Hana", "Akiko", "Rosa", "Pilar", "Thea", "Ailsa", "Moira", "Una", "Effie", "Gudrun",
    "Hanne", "Kaja", "Lene", "Sigrid", "Thora", "Ebba", "Frida", "Nkechi", "Abena", "Efua", "Yaa", "Sunita",
  ],
  m: [
    "Albrecht", "Anselm", "Arvid", "Benedek", "Cyprian", "Dmitri", "Elias", "Emeric", "Florian", "Gaspard", "Hamish",
    "Henrik", "Idris", "Ivo", "Jasper", "Joaquim", "Kofi", "Lorcan", "Lucien", "Matthias", "Nils", "Oskar", "Pascal",
    "Quentin", "Rafael", "Rasmus", "Sefton", "Tadeusz", "Tomasz", "Ulf", "Viggo", "Wim", "Yannick", "Zoltan", "Ezra",
    "Kwame", "Ravi", "Anders", "Emil", "Aurelio", "Bram", "Corentin", "Halvard",
    "Adrien", "Aksel", "Alban", "Amadou", "Anatole", "Armand", "Arne", "Augustin", "Basile", "Benoit", "Bertil",
    "Bjorn", "Blaise", "Caspar", "Cathal", "Cedric", "Clement", "Conrad", "Dafydd", "Damian", "Declan", "Desmond",
    "Didier", "Dorian", "Edmund", "Egon", "Einar", "Emrys", "Ewan", "Fabian", "Fergus", "Filip", "Fintan", "Florent",
    "Gareth", "Gerrit", "Gideon", "Gilles", "Gunnar", "Hakon", "Hartley", "Hector", "Iain", "Jakub", "Jerome", "Jonas",
    "Jory", "Josef", "Kasper", "Kester", "Klaus", "Konrad", "Lars", "Laurent", "Leif", "Leopold", "Lucas", "Ludo",
    "Magnus", "Malachy", "Marek", "Marius", "Mathis", "Maurice", "Mikael", "Milan", "Niall", "Nikolai", "Noam", "Olav",
    "Olivier", "Otto", "Piet", "Radek", "Raoul", "Rodrigo", "Rufus", "Ruben", "Sander", "Seamus", "Sigurd", "Soren",
    "Stig", "Sven", "Tristan", "Valentin", "Vidar", "Walter", "Wilfred", "Xavier", "Yusuf", "Emeka", "Chinedu",
    "Tunde", "Obi", "Arjun", "Dev", "Rohan", "Kenji", "Tariq", "Omar", "Karim", "Ilias", "Kojo", "Yaw", "Mattias",
    "Alun",
  ],
  a: [
    "Ash", "Bryn", "Cass", "Ellis", "Emery", "Frankie", "Jude", "Kit", "Lee", "Merritt", "Noel", "Quinn", "Rowan",
    "Sage", "Sasha", "Tam", "Wren", "Arden", "Linden", "Morgan",
    "Alex", "Ari", "Avery", "Blair", "Cameron", "Carey", "Dale", "Dana", "Darcy", "Devon", "Drew", "Eden", "Elliot",
    "Ember", "Fen", "Finley", "Gale", "Glen", "Hadley", "Harper", "Jamie", "Jesse", "Jo", "Jody", "Jordan", "Joss",
    "Kai", "Kendall", "Kerry", "Lane", "Lark", "Laurie", "Lennox", "Lindsay", "Lou", "Marin", "Marley", "Max", "Mika",
    "Nico", "Noa", "Oakley", "Pat", "Perry", "Pip", "Ray", "Reese", "Remy", "Riley", "Rory", "Rue", "Sacha", "Sam",
    "Sandy", "Sawyer", "Shay", "Sidney", "Skye", "Sol", "Stevie", "Sutton", "Tal", "Teagan", "Terry", "Toby", "Val",
    "Vale", "Wynn", "Yael", "Alix", "Billie", "Charlie", "Claude", "Camille", "Dominique", "Gabi", "Georgie", "Corin",
    "Ren", "Jules",
  ],
} as const;

export const FAMILY_NAMES = [
  "Aalders", "Abernethy", "Akande", "Aldana", "Bakker", "Balogun", "Blaauw", "Brennan", "Castell", "Dahl", "Delvaux",
  "Drummond", "Ekwueme", "Falk", "Ferreira", "Fitzroy", "Gallagher", "Garnier", "Grieve", "Halvorsen",
  "Hartigan", "Holm", "Iversen", "Jankowski", "Jessop", "Kaminski", "Keane", "Kowal", "Lachance", "Larkin", "Lindgren",
  "Maertens", "Marlowe", "Morrow", "Nakamura", "Novak", "Nwosu", "Oakes", "Olander", "Pajari", "Pemberton",
  "Quarrie", "Rasku", "Rennick", "Rowntree", "Salerno", "Sandoval", "Selby", "Sorensen", "Tamsett", "Thackeray",
  "Tolland", "Ueda", "Vasquez", "Verhoeven", "Waddell", "Whitlock", "Yardley", "Zanetti", "Adeyemi", "Brodsky",
  "Coutinho", "Daventry", "Engström", "Fairweather", "Gorski", "Hawthorne", "Ishikawa", "Kerrigan", "Lombardi",
  "Mendel", "Okonjo", "Pryce", "Ruskova", "Sato", "Tremaine", "Underhill", "Vidmar", "Winslow",
  "Aldridge", "Almeida", "Ashdown", "Aubert", "Bainbridge", "Ballard", "Barros", "Beaumont", "Beck", "Benedetti",
  "Berg", "Birkett", "Blackwood", "Blom", "Borowski", "Bramwell", "Brannigan", "Brookes", "Bruun", "Buckley", "Byrne",
  "Callan", "Carmody", "Carvalho", "Casey", "Chalmers", "Chandra", "Cheung", "Clancy", "Corbett", "Corrigan",
  "Cresswell", "Crowther", "Cuthbert", "Danby", "Darrow", "Dawes", "Deakin", "Delaney", "Demir", "Devlin", "Dewar",
  "Doherty", "Donnelly", "Duarte", "Dufresne", "Durand", "Duval", "Egan", "Ekberg", "Ennis", "Esposito", "Evers",
  "Fagan", "Farrant", "Ferraro", "Finch", "Flanagan", "Fleury", "Flynn", "Fonseca", "Forsyth", "Fowler", "Frazer",
  "Gallo", "Garvey", "Gilchrist", "Gillard", "Goddard", "Gomes", "Goodall", "Gowan", "Gunn", "Hagen", "Hallam",
  "Halloran", "Hanley", "Hayward", "Hedley", "Hegarty", "Hendry", "Hewitt", "Hillier", "Hobbs", "Holloway", "Horvath",
  "Hughes", "Irvine", "Jarvis", "Jensen", "Kaplan", "Keating", "Kelleher", "Kemp", "Kerr", "Kinsella", "Kirkby",
  "Kovacs", "Lacey", "Laird", "Lamont", "Landry", "Langley", "Latimer", "Lefevre", "Leroux", "Lindahl", "Llewellyn",
  "Lockhart", "Lund", "Lyall", "Madsen", "Maguire", "Malik", "Mallory", "Marchant", "Marsden", "Mathers", "McAllister",
  "McBride", "Meijer", "Mendes", "Moller", "Molloy", "Moran", "Morland", "Munro", "Murtagh", "Navarro", "Nesbitt",
  "Nielsen", "Noonan", "Nowak", "Nyberg", "O'Dowd", "Ogden", "Okeke", "Olsen", "Ortega", "Osei", "Parris", "Pascoe",
  "Pedersen", "Pelham", "Penrose", "Pereira", "Perrin", "Pickering", "Pinto", "Prentice", "Quinlan", "Radford",
  "Rahman", "Ramsay", "Redfern", "Reid", "Renard", "Rigby", "Rios", "Roche", "Rourke", "Rudd", "Ryland", "Sandberg",
  "Santos", "Saunders", "Seaton", "Severn", "Sheehan", "Solberg", "Soto", "Stafford", "Starling", "Strachan",
  "Sutherland", "Swann", "Talbot", "Tait", "Teixeira", "Thorne", "Tierney", "Toft", "Torres", "Tully", "Tyrell",
  "Underwood", "Varga", "Vaughan", "Venn", "Wade", "Wakefield", "Walcott", "Warrick", "Waverley", "Webb", "Whelan",
  "Wylie", "Yates", "Yilmaz", "Zielinski", "Adebayo", "Mensah", "Asante", "Chukwu", "Eze", "Banerjee", "Iyer", "Menon",
  "Pillai", "Kwan", "Takahashi", "Mori", "Tanaka", "Treharne", "Polglaze", "Carew", "Trevelyan", "Kittow", "Rosewarne",
  "Pengelly", "Nance",
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
  // Named supporting residents and absent people (§12.4): Maud Szabo, Dunstan Frye, Rev. Alma Cobb, Dr. Imogen Lowe, and
  // the dead the cards remember (Arthur Pell, Gil Mercer, Maren Brandt, Daniel Hale).
  "Maud", "Dunstan", "Alma", "Imogen", "Arthur", "Gil", "Maren", "Daniel",
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
  // §12.4: Dunstan Frye, Rev. Alma Cobb, Dr. Imogen Lowe; §13.3a: old Mr. Haldane, who died in February.
  "Frye", "Cobb", "Lowe", "Haldane",
];

/** A few famous names the pools could assemble (V03's deny list); checked case- and accent-insensitively. */
export const FAMOUS_NAMES: readonly string[] = [
  "Oskar Schindler", "Ingrid Bergman", "Greta Garbo", "Vera Lynn", "Hamish Macbeth", "Jude Law", "Ezra Pound", "Emil Nolde",
  "Anders Celsius", "Elias Howe", "Rafael Nadal", "Henrik Ibsen", "Lise Meitner", "Ursula Andress", "Noel Coward",
  "Florian Schneider", "Tomasz Kowal", "Viggo Mortensen", "Kofi Annan", "Nils Holm",
  "Astrid Lindgren", "Noel Gallagher", "Rory Gallagher", "Brigitte Nielsen", "Sam Mendes", "Declan Donnelly",
  "Desmond Llewellyn", "Damian Hurst", "Mina Harker",
];

/** Lowercase, accents folded: how V03 compares names. */
export const foldName = (name: string): string => name.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
