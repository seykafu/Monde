"""Dialogue portraits for every resident (MVP A-05, GDD §16.2): a neutral key per character in the v2 cartoon
style, then the other five expressions drawn against that key so only the face changes.

  neutral  -> references the approved style key (art_sources/style_bible_v2/portrait_odile.png)
  warm, sad, angry, surprised, worried -> reference that character's own neutral

People get the six; animals get the expressions their card lists (mapped onto the same prompts where they can).
Already-generated files are skipped, so the script can be re-run after a usage limit or a rejected image
(delete the file to redo it).

Usage:
  python3 scripts/art/gen_portraits.py [id,id,...] [--out art_sources/portraits] [--workers 4]
"""
import argparse
import concurrent.futures as cf
import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(__file__))
from gen_style_bible_v2 import ERA, EXPRESSIONS, FRAMING, HEAD, MATCH_PORTRAIT, PORTRAIT_STYLE, expression_variant, run_job  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
STYLE_KEY = os.path.join(ROOT, "art_sources", "style_bible_v2", "portrait_odile.png")
NEUTRAL = "neutral: calm and attentive, mouth relaxed, the character's ordinary resting face."


def load_cards(ids: list[str] | None) -> list[dict]:
    # The repo's own `yaml` npm package parses the cards (no Python YAML dependency).
    script = ("const fs=require('fs'),p=require('path'),Y=require('yaml');const d='content/residents';"
              "console.log(JSON.stringify(fs.readdirSync(d).filter(f=>f.endsWith('.yaml')).sort()"
              ".map(f=>Y.parse(fs.readFileSync(p.join(d,f),'utf8')))))")
    cards = json.loads(subprocess.run(["node", "-e", script], cwd=ROOT, capture_output=True, text=True, check=True).stdout)
    return [c for c in cards if ids is None or c["id"] in ids]


def describe(card: dict) -> str:
    appearance = " ".join(str(card.get("appearance", "")).split())
    if card.get("kind") == "animal":
        return f"{card['name']}, an animal who lives in the town. {appearance}"
    return f"{card['name']}, {card['age']}, {card.get('occupation', 'a townsperson')}. {appearance}"


def neutral_prompt(card: dict) -> str:
    who = describe(card)
    if card.get("kind") == "animal":
        who += " Draw the animal as an animal (no clothes, not anthropomorphic), with as much personality as a person."
    return HEAD + MATCH_PORTRAIT + PORTRAIT_STYLE + "\n\n" + ERA + "\n\nThe character: " + who + \
        "\n\nExpression: " + NEUTRAL + "\n\n" + FRAMING


def expressions_for(card: dict) -> list[str]:
    if card.get("kind") == "animal":
        return [e for e in card.get("portrait_expressions", []) if e in EXPRESSIONS]
    return list(EXPRESSIONS)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("ids", nargs="?", default="")
    ap.add_argument("--out", default=os.path.join(ROOT, "art_sources", "portraits"))
    ap.add_argument("--workers", type=int, default=4)
    a = ap.parse_args()
    cards = load_cards([i for i in a.ids.split(",") if i] or None)
    out = os.path.abspath(a.out)

    def job(card: dict, expr: str) -> str:
        folder = os.path.join(out, card["id"])
        os.makedirs(folder, exist_ok=True)
        target = os.path.join(folder, f"{expr}.png")
        if os.path.exists(target):
            return f"{card['id']}/{expr}: exists"
        if expr == "neutral":
            return run_job(f"{card['id']}/neutral", neutral_prompt(card), STYLE_KEY, target)
        ref = os.path.join(folder, "neutral.png")
        if not os.path.exists(ref):
            return f"{card['id']}/{expr}: SKIPPED (no neutral key)"
        return run_job(f"{card['id']}/{expr}", expression_variant(card["name"].split()[0], EXPRESSIONS[expr]), ref, target)

    # Neutral keys first (each character's other expressions reference their own key).
    for phase in ("neutral", "rest"):
        tasks = [(c, "neutral") for c in cards] if phase == "neutral" else [(c, e) for c in cards for e in expressions_for(c)]
        with cf.ThreadPoolExecutor(max_workers=a.workers) as ex:
            for msg in ex.map(lambda t: job(*t), tasks):
                print(msg, flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
