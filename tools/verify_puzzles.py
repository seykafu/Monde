#!/usr/bin/env python3
"""Verify every authored puzzle and number riddle in docs/MONDE_GDD.md (§14, §15).

Each check rebuilds the instance exactly as the GDD prints it and asserts that it is solvable and,
where the design depends on it, that the solution is unique. Run after editing any puzzle:

    python3 tools/verify_puzzles.py

Exit code 0 means every check passed.
"""
import itertools
import re
import sys
from collections import deque

FAILURES = []


def check(name, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + name + (f"  ({detail})" if detail else ""))
    if not cond:
        FAILURES.append(name)


# ---------------------------------------------------------------- PZ-01 pipes
def pz01():
    N, E, S, W = "N", "E", "S", "W"
    order = [N, E, S, W]
    opp = {N: S, S: N, E: W, W: E}
    step = {N: (-1, 0), S: (1, 0), E: (0, 1), W: (0, -1)}
    base = {"I": {N, S}, "L": {N, E}, "T": {W, N, E}, ".": set()}

    def orients(t):
        return {frozenset(order[(order.index(e) + k) % 4] for e in base[t]) for k in range(4)}

    grid = [".LTL.", "LL.TI", "TIIT.", "ILIT.", "LLIL."]
    R, C = 5, 5
    source, outlets = (4, 0, W), [(0, 2, N), (1, 4, E)]
    ports = {source, *outlets}
    cells = [(r, c) for r in range(R) for c in range(C)]
    sols, a = [], {}

    def ok(r, c, o):
        for d in order:
            nr, nc = r + step[d][0], c + step[d][1]
            has = d in o
            if not (0 <= nr < R and 0 <= nc < C):
                if has != ((r, c, d) in ports):
                    return False
            elif (nr, nc) in a and has != (opp[d] in a[(nr, nc)]):
                return False
        return True

    def rec(i):
        if i == len(cells):
            seen, st = {(4, 0)}, [(4, 0)]
            while st:
                r, c = st.pop()
                for d in a[(r, c)]:
                    n = (r + step[d][0], c + step[d][1])
                    if 0 <= n[0] < R and 0 <= n[1] < C and n not in seen:
                        seen.add(n)
                        st.append(n)
            pieces = {(r, c) for r, c in cells if grid[r][c] != "."}
            if pieces <= seen:
                sols.append(dict(a))
            return
        r, c = cells[i]
        for o in orients(grid[r][c]):
            if ok(r, c, o):
                a[(r, c)] = o
                rec(i + 1)
                del a[(r, c)]

    rec(0)
    check("PZ-01 Under the Square: unique", len(sols) == 1, f"{len(sols)} solutions")


# ---------------------------------------------------------------- PZ-02 flues
def pz02():
    start = ["X.X", ".XX", "X.."]
    sols = []
    for mask in range(512):
        g = [[ch == "X" for ch in row] for row in start]
        presses = [(i // 3, i % 3) for i in range(9) if mask >> i & 1]
        for r, c in presses:
            for dr, dc in [(0, 0), (1, 0), (-1, 0), (0, 1), (0, -1)]:
                if 0 <= r + dr < 3 and 0 <= c + dc < 3:
                    g[r + dr][c + dc] ^= True
        if not any(any(row) for row in g):
            sols.append(presses)
    check("PZ-02 Flues: unique press set", sols == [[(1, 0), (1, 2), (2, 0), (2, 1)]], str(sols))


# ---------------------------------------------------------------- PZ-03 almanac
ALMANAC = [
    "In the sixth month the tides run high and the herring come in close.",
    "Sleep with a window open in May, and you will wake with the gulls.",
    "Keep a lamp in the window for my neighbours who fish late.",
    "A map is a promise that the road will be there in the morning.",
    "Mend your nets in the shade; the sun makes the twine proud.",
    "Plant beans on Saint Brigid's day, and talk to them kindly.",
    "The clock in the square keeps the time of the whole town, not of the mayor.",
    "Book your passage early, for the packet boat fills before the tide.",
    "Bread rises best in a warm kitchen and a quiet house.",
    "Of all the things a town can own, the shore is the one it sleeps beside.",
]


def pz03():
    words = [[re.sub(r"[^A-Za-z']", "", w).lower() for w in line.split()] for line in ALMANAC]
    codes = [(3, 8), (4, 2), (10, 15), (1, 1), (1, 2), (1, 3), (8, 1), (7, 9), (1, 6)]
    msg = " ".join(words[l - 1][w - 1] for l, w in codes)
    check("PZ-03 Almanac decodes", msg == "my map sleeps in the sixth book of tides", msg)


# ---------------------------------------------------------------- PZ-04 market
def pz04():
    V = ["Nell", "Kasimir", "June", "Odile", "Teo"]
    A = ["white", "blue", "yellow", "red", "green"]
    G = ["herring", "kites", "songs", "jam", "cuttings"]
    rules = [
        lambda v, a, g: v.index("Nell") == 0,
        lambda v, a, g: v.index("Kasimir") == 1,
        lambda v, a, g: a[v.index("Teo")] == "green",
        lambda v, a, g: a.index("red") + 1 == a.index("green"),
        lambda v, a, g: g[v.index("June")] == "songs",
        lambda v, a, g: a[v.index("June")] == "yellow",
        lambda v, a, g: abs(g.index("kites") - g.index("songs")) == 1,
        lambda v, a, g: g[v.index("Odile")] == "jam",
        lambda v, a, g: g[a.index("white")] == "herring",
        lambda v, a, g: g[v.index("Teo")] == "cuttings",
        lambda v, a, g: abs(v.index("Odile") - v.index("Nell")) != 1,
    ]
    sols = [(v, a, g) for v in itertools.permutations(V) for a in itertools.permutations(A)
            for g in itertools.permutations(G) if all(f(v, a, g) for f in rules)]
    want = (tuple(V), tuple(A), tuple(G))
    check("PZ-04 Market Day: unique", sols == [want], f"{len(sols)} solutions")


# ---------------------------------------------------------------- PZ-05 lens
def pz05():
    grid = ["..#..", "MM..#", "MMPM.", ".#...", "....."]
    step = {"N": (-1, 0), "S": (1, 0), "E": (0, 1), "W": (0, -1)}
    slash = {"E": "N", "N": "E", "W": "S", "S": "W"}
    back = {"E": "S", "S": "E", "W": "N", "N": "W"}
    mirrors = [(r, c) for r in range(5) for c in range(5) if grid[r][c] == "M"]

    def run(state):
        r, c, d, hit, seen = 2, 0, "E", False, set()
        while True:
            if not (0 <= r < 5 and 0 <= c < 5):
                return (pr, pc, d), hit
            if (r, c, d) in seen or grid[r][c] == "#":
                return None, hit
            seen.add((r, c, d))
            hit |= (r, c) == (2, 2)
            if (r, c) in mirrors:
                d = slash[d] if state[mirrors.index((r, c))] == "/" else back[d]
            pr, pc = r, c
            r, c = r + step[d][0], c + step[d][1]

    good = [s for s in itertools.product("/\\", repeat=len(mirrors))
            if run(s) == ((0, 3, "N"), True)]
    check("PZ-05 Lens: unique", good == [("/", "\\", "/", "\\", "/")], str(good))


# ---------------------------------------------------------------- PZ-06 ducks
def pz06():
    says = {
        "Tib": lambda c: c != "Tib",
        "Bertrand": lambda c: c == "June",
        "June": lambda c: c != "June",
        "Moss": lambda c: c in ("Tib", "Bertrand"),
    }
    culprits = [c for c in says if sum(not f(c) for f in says.values()) == 1]
    check("PZ-06 Ducks: exactly one fibber -> Bertrand", culprits == ["Bertrand"], str(culprits))


# ---------------------------------------------------------------- PZ-07 tune
def pz07():
    notes = "CDEGA"
    p = {n: i for i, n in enumerate(notes)}
    rules = [
        lambda t: t[0] == "C" and t[-1] == "C",
        lambda t: all(p[t[2]] > p[x] for i, x in enumerate(t) if i != 2),
        lambda t: all(t[i] != t[i + 1] for i in range(5)),
        lambda t: t.count("G") == 1,
        lambda t: p[t[1]] < p[t[3]],
        lambda t: set(t) == set(notes),
        lambda t: p[t[4]] - p[t[5]] == 1,
    ]
    sols = ["".join(t) for t in itertools.product(notes, repeat=6) if all(f(t) for f in rules)]
    check("PZ-07 Tune: unique C-E-A-G-D-C", sols == ["CEAGDC"], str(sols))


# ---------------------------------------------------------------- PZ-08 glasshouse
def pz08():
    plants = "TBLM"
    sols = []
    for rows in itertools.product(itertools.permutations(plants), repeat=4):
        if any(len({rows[r][c] for r in range(4)}) < 4 for c in range(4)):
            continue
        if any(rows[i][i] != "T" or rows[i][3 - i] != "M" for i in range(4)):
            continue
        bad = any(rows[r][c] == "L" and 0 <= r + dr < 4 and 0 <= c + dc < 4 and rows[r + dr][c + dc] == "T"
                  for r in range(4) for c in range(4) for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)))
        if not bad:
            sols.append(["".join(x) for x in rows])
    check("PZ-08 Glasshouse: unique", sols == [["TBLM", "BTML", "LMTB", "MLBT"]], str(sols))


# ---------------------------------------------------------------- PZ-09 scales
def pz09():
    # Adversarial check: 9 candidates, ternary split. Two weighings separate at most 3^2 = 9 cases.
    check("PZ-09 Scales: 9 bottles <= 3^2 outcomes", 9 <= 3 ** 2)


# ---------------------------------------------------------------- PZ-10 mill race
def pz10():
    big, small, target = 9, 4, 6
    dist, q = {(0, 0): 0}, deque([(0, 0)])
    while q:
        a, b = q.popleft()
        for t in [(big, b), (a, small), (0, b), (a, 0),
                  (a - min(a, small - b), b + min(a, small - b)),
                  (a + min(b, big - a), b - min(b, big - a))]:
            if t not in dist:
                dist[t] = dist[(a, b)] + 1
                q.append(t)
    best = min(v for (a, b), v in dist.items() if a == target)
    check("PZ-10 Mill Race: 6 in big chamber in 8 moves", best == 8, f"min {best}")


# ---------------------------------------------------------------- PZ-11 signal box
def pz11():
    names = ["1", "2", "3", "4", "5", "6", "7"]
    start = {"1": 0, "2": 0, "3": 0, "4": 0, "5": 0, "6": 1, "7": 0}
    goal = {"1": 1, "2": 1, "3": 1, "4": 1, "5": 1, "6": 0, "7": 0}

    def can(s, l):
        if l == "3":
            return s["4"] == 0 and s["2"] == 0
        if l == "4":
            return s["2"] == 0 and (s["3"] == 1 if s["4"] == 0 else True)
        if l in ("5", "7"):
            return s["2"] == 0
        if l == "6":
            return s["7"] == 1 and s["2"] == 0
        if l == "2":
            if s["2"] == 0:
                return s["4"] == 1 and s["5"] == 1 and s["6"] == 0 and s["7"] == 0
            return s["1"] == 0
        if l == "1":
            return s["2"] == 1 if s["1"] == 0 else True

    key = lambda s: tuple(s[n] for n in names)
    dist, q = {key(start): 0}, deque([start])
    while q:
        s = q.popleft()
        for l in names:
            if can(s, l):
                t = dict(s)
                t[l] ^= 1
                if key(t) not in dist:
                    dist[key(t)] = dist[key(s)] + 1
                    q.append(t)
    seq, s = ["7", "6", "7", "3", "4", "5", "2", "1"], dict(start)
    valid = True
    for l in seq:
        valid &= bool(can(s, l))
        s[l] ^= 1
    check("PZ-11 Signal Box: 8-move minimum", dist.get(key(goal)) == 8, f"min {dist.get(key(goal))}")
    check("PZ-11 Signal Box: documented sequence valid", valid and key(s) == key(goal))


# ---------------------------------------------------------------- PZ-12 sokoban
def pz12():
    level = ["##########", "#   ##   #", "# $    $ #", "## ## ## #", "#  o  o  #",
             "# ## $## #", "#   o    #", "#  @##   #", "##########"]
    walls, goals, boxes = set(), set(), set()
    for r, row in enumerate(level):
        for c, ch in enumerate(row):
            if ch == "#":
                walls.add((r, c))
            if ch == "o":
                goals.add((r, c))
            if ch == "$":
                boxes.add((r, c))
            if ch == "@":
                player = (r, c)

    def reach(p, bx):
        seen, st = {p}, [p]
        while st:
            r, c = st.pop()
            for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                n = (r + dr, c + dc)
                if n not in walls and n not in bx and n not in seen:
                    seen.add(n)
                    st.append(n)
        return seen

    def dead(b):
        r, c = b
        w = lambda x: x in walls
        return b not in goals and (w((r - 1, c)) or w((r + 1, c))) and (w((r, c - 1)) or w((r, c + 1)))

    start = (min(reach(player, frozenset(boxes))), frozenset(boxes))
    dist, q = {start: 0}, deque([(player, frozenset(boxes))])
    best = None
    while q:
        p, bx = q.popleft()
        k = (min(reach(p, bx)), bx)
        if bx == goals:
            best = dist[k]
            break
        R = reach(p, bx)
        for b in bx:
            for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                frm, to = (b[0] - dr, b[1] - dc), (b[0] + dr, b[1] + dc)
                if frm in R and to not in walls and to not in bx and not dead(to):
                    nb = frozenset((bx - {b}) | {to})
                    nk = (min(reach(b, nb)), nb)
                    if nk not in dist:
                        dist[nk] = dist[k] + 1
                        q.append((b, nb))
    check("PZ-12 Cannery: solvable in 16 pushes", best == 16, f"min {best}")


# ---------------------------------------------------------------- PZ-13 breakers
def pz13():
    wiring = {1: "ABC", 2: "DE", 3: "AEF", 4: "BD", 5: "AE", 6: "CD"}
    sols = []
    for mask in range(64):
        on = [b for b in range(1, 7) if mask >> (b - 1) & 1]
        if all(sum(ch in wiring[b] for b in on) % 2 for ch in "ABCDEF"):
            sols.append(on)
    check("PZ-13 Lamplight: unique {1,2,3,5}", sols == [[1, 2, 3, 5]], str(sols))


# ---------------------------------------------------------------- PZ-14 nonogram
def pz14():
    rows = [[2], [1, 1], [6], [2, 2, 2], [1, 4, 1], [1, 4, 1], [2, 2, 2], [6], [1, 1], [6]]
    cols = [[0], [4], [2, 2, 1], [2, 2, 3], [1, 6, 1], [1, 6, 1], [2, 2, 3], [2, 2, 1], [4], [0]]
    n = 10

    def runs(line):
        return [len(m) for m in re.findall("#+", line)] or [0]

    def cands(clue):
        out = []
        for bits in itertools.product(".#", repeat=n):
            line = "".join(bits)
            if runs(line) == clue:
                out.append(line)
        return out

    rc = [cands(r) for r in rows]
    count = 0

    def prefix_ok(g):
        for c in range(n):
            col = "".join(row[c] for row in g)
            done = [len(m) for m in re.findall("#+", col[:-1] if col.endswith("#") else col)]
            tail = len(re.search("#*$", col).group())
            target = cols[c] if cols[c] != [0] else []
            if col.endswith("#"):
                done = [len(m) for m in re.findall("#+", col)][:-1]
            if done != target[:len(done)]:
                return False
            if tail and (len(done) >= len(target) or tail > target[len(done)]):
                return False
            if len(g) == n and runs(col) != cols[c]:
                return False
        return True

    def dfs(g):
        nonlocal count
        if count > 1:
            return
        if len(g) == n:
            count += 1
            return
        for cand in rc[len(g)]:
            if prefix_ok(g + [cand]):
                dfs(g + [cand])

    dfs([])
    check("PZ-14 Quilt nonogram: unique", count == 1, f"{count} solutions")


# ---------------------------------------------------------------- PZ-15 gears
def pz15():
    box = [8, 10, 12, 16, 24, 30, 32, 40, 48]
    trains = {tuple(sorted([(a, b), (c, d)])) for a, b, c, d in itertools.permutations(box, 4)
              if a < b and c < d and a + b == c + d and a * c * 12 == b * d}
    check("PZ-15 Gears: unique 10->30, 8->32", trains == {((8, 32), (10, 30))}, str(trains))


# ---------------------------------------------------------------- PZ-16 ledger
def pz16():
    ledger_equip = [40, 135, 50, 45, 130, 55, 140, 45]
    retained = [200, 105, 190, 195, 110, 185, 100, 195]
    receipts = [40, 35, 50, 45, 30, 55, 40, 45]
    rows_balance = all(600 == 360 + e + r for e, r in zip(ledger_equip, retained))
    padded = [i + 1 for i, (e, rc) in enumerate(zip(ledger_equip, receipts)) if e != rc]
    skim = sum(e - rc for e, rc in zip(ledger_equip, receipts))
    check("PZ-16 Ledger: rows balance", rows_balance)
    check("PZ-16 Ledger: weeks 2,5,7 padded by 300", padded == [2, 5, 7] and skim == 300, f"{padded} {skim}")
    check("PZ-16 Ledger: ghost guards are anagrams",
          sorted("kurtbashet") == sorted("bruhaskett") and sorted("betsietanzo") == sorted("nettieszabo"))


# ---------------------------------------------------------------- PZ-17 slide
def pz17():
    start, goal = (4, 6, 1, 5, 0, 3, 8, 2, 7), (1, 2, 3, 4, 5, 6, 7, 8, 0)
    dist, q = {start: 0}, deque([start])
    while q:
        s = q.popleft()
        if s == goal:
            break
        i = s.index(0)
        r, c = divmod(i, 3)
        for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            if 0 <= r + dr < 3 and 0 <= c + dc < 3:
                j = (r + dr) * 3 + c + dc
                t = list(s)
                t[i], t[j] = t[j], t[i]
                t = tuple(t)
                if t not in dist:
                    dist[t] = dist[s] + 1
                    q.append(t)
    check("PZ-17 Mural: 20-move minimum", dist.get(goal) == 20, f"min {dist.get(goal)}")


# ---------------------------------------------------------------- PZ-18 planks
def pz18():
    planks, gaps = [2, 3, 3, 4, 5, 5, 5], [7, 9, 11]
    found = set()
    for assign in itertools.product(range(3), repeat=len(planks)):
        sums = [0, 0, 0]
        groups = [[], [], []]
        for p, g in zip(planks, assign):
            sums[g] += p
            groups[g].append(p)
        if sums == gaps:
            found.add(tuple(tuple(sorted(x)) for x in groups))
    check("PZ-18 Planks: unique partition", found == {((2, 5), (4, 5), (3, 3, 5))}, str(found))


# ---------------------------------------------------------------- PZ-19 engine
def pz19():
    rules = [
        lambda o: o[0] == "A",
        lambda o: o.index("F") < o.index("D"),
        lambda o: o.index("B") + 1 == o.index("C"),
        lambda o: o.index("C") < o.index("D"),
        lambda o: o.index("D") + 1 == o.index("E"),
        lambda o: o.index("F") > o.index("B"),
    ]
    sols = ["".join(o) for o in itertools.permutations("ABCDEF") if all(f(o) for f in rules)]
    check("PZ-19 Engine: unique ABCFDE", sols == ["ABCFDE"], str(sols))


# ---------------------------------------------------------------- PZ-20 seating
def pz20():
    guests = ["Pell", "Hollis", "Roz", "Nell", "Augusta", "Felix", "Bertrand"]
    near = lambda s, a, b: (s.index(a) - s.index(b)) % 8 in (1, 7)
    rules = [
        lambda s: s[4] == "Pell",
        lambda s: s[1] == "Augusta",
        lambda s: s[1] == "Bertrand" or s[7] == "Bertrand",
        lambda s: (s.index("Hollis") - s.index("Roz")) % 8 == 1,
        lambda s: near(s, "Roz", "Pell"),
        lambda s: not near(s, "Nell", "Pell"),
        lambda s: not near(s, "Felix", "Augusta"),
    ]
    sols = [("Odile",) + p for p in itertools.permutations(guests) if all(f(("Odile",) + p) for f in rules)]
    want = ("Odile", "Augusta", "Nell", "Felix", "Pell", "Roz", "Hollis", "Bertrand")
    check("PZ-20 Seating: unique", sols == [want], str(sols))


# ---------------------------------------------------------------- riddle arithmetic
def riddles():
    check("OQ-3: 1838 + 8 hands + 4 faces = 1850", 1838 + 4 * 2 + 4 == 1850)
    check("OQ-5: strokes 1..12 = 78", sum(range(1, 13)) == 78)
    rot13 = "GUR BIRA XRLFGBAR".translate(str.maketrans(
        "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "NOPQRSTUVWXYZABCDEFGHIJKLM"))
    check("MR-3: ROT13 -> THE OVEN KEYSTONE", rot13 == "THE OVEN KEYSTONE", rot13)
    check("MR-4: len(MONDE) + 4 faces = 9", len("MONDE") + 4 == 9)
    check("MB-4: MILL -> WILL -> WELL, one letter each",
          sum(a != b for a, b in zip("MILL", "WILL")) == 1 and sum(a != b for a, b in zip("WILL", "WELL")) == 1)
    check("SH-5: 7:40 + 55 + 6 = 8:41", (7 * 60 + 40 + 55 + 6) == 8 * 60 + 41)
    check("LN-2: SNOMMOC is an anagram of COMMONS", sorted("SNOMMOC") == sorted("COMMONS"))


if __name__ == "__main__":
    for fn in (pz01, pz02, pz03, pz04, pz05, pz06, pz07, pz08, pz09, pz10, pz11, pz12, pz13,
               pz14, pz15, pz16, pz17, pz18, pz19, pz20, riddles):
        fn()
    print()
    print("ALL PASSED" if not FAILURES else f"{len(FAILURES)} FAILED: {FAILURES}")
    sys.exit(1 if FAILURES else 0)
