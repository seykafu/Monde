"""Blind A/B comparison of two dialogue eval runs (GDD §9.16; a dev tool, never run in CI).

Two runs of tools/eval-dialogue.ts against different builds play the same scripted player lines. Judges scoring each
run separately drift (one judge's 4.2 is another's 3.9), so a change is compared by ONE judge seeing both runs of each
scenario side by side, with the labels shuffled per scenario so it can't tell which build is which.

  python3 tools/eval-pair.py make  <old_dir>/dialogue_eval_<old>.judge.md <new_dir>/dialogue_eval_<new>.judge.md <out_dir>
      writes <out_dir>/pair.judge.md (give it to the judge; nothing in it names a build) and <out_dir>/key.json
  python3 tools/eval-pair.py score <out_dir>
      reads the judge's <out_dir>/scores_pair.json and prints wins per build and mean scores per build

The judge answers { "<scenario>": { "A": {"turns": [...]}, "B": {"turns": [...]}, "better": "A"|"B"|"tie", "why": "..." } }
with the eval rubric's per-turn scores (responds, remembers or null, in_character, note).
"""
import json
import random
import re
import sys


def sections(path: str) -> tuple[str, dict[str, str]]:
    text = open(path, encoding="utf-8").read()
    head, *rest = re.split(r"(?m)^# Scenario ", text)
    return head, {r.split("\n", 1)[0].strip(): "# Scenario " + r for r in rest}


def label(path: str) -> str:
    m = re.search(r"dialogue_eval_(.+)\.judge\.md$", path)
    return m.group(1) if m else path


def make(old_path: str, new_path: str, out: str) -> None:
    _, old = sections(old_path)
    head, new = sections(new_path)
    names = (label(old_path), label(new_path))
    rubric = head.split("\n", 1)[1].split("Answer with one JSON object")[0]
    parts = [
        "# Paired judge bundle\n", rubric,
        "Each scenario below appears twice, as Version A and Version B: two independent runs of the same scripted player"
        " lines against two builds. The labels are random per scenario. Score every GRADE THIS TURN step of BOTH versions"
        " on the rubric above, then say which version is better overall for that scenario (A, B or tie) and why in one"
        " sentence.\n",
        'Answer with one JSON object: { "<scenario id>": { "A": { "turns": [ { "step": n, "responds": 1-5, "remembers":'
        ' 1-5 or null, "in_character": 1-5, "note": "..." } ] }, "B": { "turns": [...] }, "better": "A"|"B"|"tie", "why":'
        ' "..." } }\n',
    ]
    rng = random.Random(f"{names[0]}|{names[1]}")
    key: dict[str, dict[str, str]] = {}
    for sid, body_new in new.items():
        if sid not in old:
            continue
        pair = [(names[0], old[sid]), (names[1], body_new)]
        rng.shuffle(pair)
        key[sid] = {"A": pair[0][0], "B": pair[1][0]}
        for tag, (_, body) in zip("AB", pair):
            parts.append(body.replace(f"# Scenario {sid}", f"# Scenario {sid}: Version {tag}", 1))
    bundle = "\n".join(parts)
    leaks = [n for n in names if n in bundle]
    if leaks:
        sys.exit(f"the bundle names a build ({', '.join(leaks)}); not blind")
    open(f"{out}/pair.judge.md", "w", encoding="utf-8").write(bundle)
    json.dump(key, open(f"{out}/key.json", "w", encoding="utf-8"), indent=1)
    print(f"{len(key)} scenarios paired -> {out}/pair.judge.md")


def score(out: str) -> None:
    scores = json.load(open(f"{out}/scores_pair.json", encoding="utf-8"))
    key = json.load(open(f"{out}/key.json", encoding="utf-8"))
    builds = sorted({b for k in key.values() for b in k.values()})
    agg = {b: {"responds": [], "remembers": [], "in_character": []} for b in builds}
    wins = {b: 0 for b in builds} | {"tie": 0}
    for sid, v in scores.items():
        for tag in "AB":
            for t in v[tag]["turns"]:
                for metric in agg[key[sid][tag]]:
                    if t.get(metric) is not None:
                        agg[key[sid][tag]][metric].append(t[metric])
        winner = "tie" if v["better"] == "tie" else key[sid][v["better"]]
        wins[winner] += 1
        print(f"{sid:26} {winner:10} {v['why'][:120]}")
    for b, metrics in agg.items():
        means = "  ".join(f"{m} {sum(x) / len(x):.2f} (n={len(x)})" for m, x in metrics.items() if x)
        print(f"{b}: {means}")
    print("wins:", wins)


if __name__ == "__main__":
    if len(sys.argv) == 5 and sys.argv[1] == "make":
        make(*sys.argv[2:])
    elif len(sys.argv) == 3 and sys.argv[1] == "score":
        score(sys.argv[2])
    else:
        sys.exit(__doc__)
