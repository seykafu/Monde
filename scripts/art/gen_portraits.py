"""Dialogue portraits for every resident (MVP A-05, GDD §16.2): a neutral key per character in the v2 cartoon
style, then the other five expressions drawn against that key so only the face changes.

  neutral  -> references the approved style key (art_sources/style_bible_v2/portrait_odile.png)
  warm, sad, angry, surprised, worried -> reference that character's own neutral

People get the six; animals get the expressions their card lists (mapped onto the same prompts where they can).
Already-generated files are skipped, so the script can be re-run after a usage limit or a rejected image
(delete the file to redo it).

The portrait library (GDD §16.2, Appendix A.3.5: generic townsfolk for generated residents and arrivals) is drawn
the same way from content/portraits/library.json with --library: each master's caption is the character, its id the
folder. A colour variant (a row with `variant_of`) is the master recoloured, so each of its six expressions is an
edit of the master's SAME expression that changes only the hair and clothing colours (the row's `recolour` list).
A variant's image waits for its master's; asking for a variant queues its master too (existing files are skipped).
Images are scheduled as soon as the image they are drawn from exists, so --workers stays busy across characters.

Usage:
  python3 scripts/art/gen_portraits.py [id,id,...] [--out art_sources/portraits] [--workers 4]
  python3 scripts/art/gen_portraits.py --library [lib_id,...] [--workers 4] [--dry-run]
"""
import argparse
import collections
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


LIBRARY = os.path.join(ROOT, "content", "portraits", "library.json")


def load_library(ids: list[str] | None) -> list[dict]:
    """Library entries as card-like dicts (kind `library`): the caption is the appearance. A wanted variant brings
    its master along (the variant is drawn from the master's images)."""
    with open(LIBRARY, encoding="utf-8") as f:
        rows = json.load(f)["portraits"]
    by_id = {r["id"]: r for r in rows}
    wanted = None
    if ids is not None:
        unknown = [i for i in ids if i not in by_id]
        if unknown:
            raise SystemExit(f"not in the library: {', '.join(unknown)}")
        wanted = set(ids) | {by_id[i]["variant_of"] for i in ids if by_id[i].get("variant_of")}
    return [{"id": r["id"], "kind": "library", "name": "This townsperson", "age": r["age"],
             "appearance": f"{r['caption']} Skin tone: {r['skin_word']} (draw it clearly that shade).",
             "caption": r["caption"], "variant_of": r.get("variant_of"), "recolour": r.get("recolour", [])}
            for r in rows if wanted is None or r["id"] in wanted]


def describe(card: dict) -> str:
    appearance = " ".join(str(card.get("appearance", "")).split())
    if card.get("kind") == "library":
        return (f"an ordinary townsperson of Monde, about {card['age']} years old (no name, no props beyond what is "
                f"described). {appearance}")
    if card.get("kind") == "animal":
        return f"{card['name']}, an animal who lives in the town. {appearance}"
    return f"{card['name']}, {card['age']}, {card.get('occupation', 'a townsperson')}. {appearance}"


def neutral_prompt(card: dict) -> str:
    who = describe(card)
    if card.get("kind") == "animal":
        who += " Draw the animal as an animal (no clothes, not anthropomorphic), with as much personality as a person."
    return HEAD + MATCH_PORTRAIT + PORTRAIT_STYLE + "\n\n" + ERA + "\n\nThe character: " + who + \
        "\n\nExpression: " + NEUTRAL + "\n\n" + FRAMING


def recolour_prompt(card: dict) -> str:
    """A library colour variant: the attached master image (one expression) with only hair and clothing recoloured."""
    changes = "\n".join(f"- {c}" for c in card["recolour"])
    return HEAD + (
        "The attached image is a portrait of one of our game's townspeople. Create ONE new image that is EXACTLY the "
        "same picture recoloured: the same drawing, line for line, with new colours for the hair and the clothes "
        "only.\n\n"
        "Keep IDENTICAL: the face and every facial feature (eye shape and eye colour, nose, mouth, ears, wrinkles, "
        "freckles, marks), the skin tone, the facial expression exactly as drawn, the haircut and the shape of the "
        "hair, the cut, fit and folds of every garment, every accessory, the pose, the framing and crop, the line "
        "art and cel shading, and the flat, solid, pure magenta (#FF00FF) background.\n\n"
        "Change ONLY these colours:\n" + changes + "\n\n"
        "Eyebrows and any beard, moustache or stubble take the new hair colour unless a line above says otherwise. "
        "Every colour not listed stays exactly as it is.\n\n"
        "For reference, the person after the change: " + card["caption"] + "\n\nNo text, no border, no frame.")


def expressions_for(card: dict) -> list[str]:
    if card.get("kind") == "animal":
        return [e for e in card.get("portrait_expressions", []) if e in EXPRESSIONS]
    return list(EXPRESSIONS)


def plan(cards: list[dict]) -> list[tuple[dict, str, tuple[str, str] | None]]:
    """Every image as (card, expression, the (id, expression) image it is drawn from, or None for the style key)."""
    tasks = []
    for c in cards:
        for e in ["neutral", *expressions_for(c)]:
            if c.get("variant_of"):
                dep = (c["variant_of"], e)
            else:
                dep = None if e == "neutral" else (c["id"], "neutral")
            tasks.append((c, e, dep))
    return tasks


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("ids", nargs="?", default="")
    ap.add_argument("--out", default=os.path.join(ROOT, "art_sources", "portraits"))
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--library", action="store_true", help="draw the portrait library (content/portraits/library.json)")
    ap.add_argument("--dry-run", action="store_true", help="list the images that would be drawn, and draw nothing")
    a = ap.parse_args()
    wanted = [i for i in a.ids.split(",") if i] or None
    cards = load_library(wanted) if a.library else load_cards(wanted)
    out = os.path.abspath(a.out)
    target = lambda cid, expr: os.path.join(out, cid, f"{expr}.png")  # noqa: E731

    def job(card: dict, expr: str) -> str:
        dest = target(card["id"], expr)
        if os.path.exists(dest):
            return f"{card['id']}/{expr}: exists"
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        label = f"{card['id']}/{expr}"
        if card.get("variant_of"):
            ref = target(card["variant_of"], expr)
            if not os.path.exists(ref):
                return f"{label}: SKIPPED (no {card['variant_of']}/{expr} to recolour)"
            return run_job(label, recolour_prompt(card), ref, dest)
        if expr == "neutral":
            return run_job(label, neutral_prompt(card), STYLE_KEY, dest)
        ref = target(card["id"], "neutral")
        if not os.path.exists(ref):
            return f"{label}: SKIPPED (no neutral key)"
        name = "this townsperson" if card.get("kind") == "library" else card["name"].split()[0]
        return run_job(label, expression_variant(name, EXPRESSIONS[expr]), ref, dest)

    tasks = plan(cards)
    if a.dry_run:
        todo = [(c, e) for c, e, _ in tasks if not os.path.exists(target(c["id"], e))]
        for c, e in todo:
            print(f"{c['id']}/{e}" + (f"  (recolour of {c['variant_of']}/{e})" if c.get("variant_of") else ""))
        variants = sum(1 for c, _ in todo if c.get("variant_of"))
        print(f"{len(todo)} images to draw ({len(todo) - variants} master, {variants} variant); "
              f"{len(tasks) - len(todo)} already exist")
        return 0

    # Each image starts as soon as the image it is drawn from is done (or straight away if that is not in this run:
    # the job then uses the file on disk, or reports SKIPPED).
    keys = {(c["id"], e) for c, e, _ in tasks}
    waiting: dict[tuple[str, str], list[tuple[dict, str]]] = collections.defaultdict(list)
    ready = []
    for c, e, dep in tasks:
        (waiting[dep] if dep in keys else ready).append((c, e))
    with cf.ThreadPoolExecutor(max_workers=a.workers) as ex:
        running = {ex.submit(job, c, e): (c["id"], e) for c, e in ready}
        while running:
            done, _ = cf.wait(running, return_when=cf.FIRST_COMPLETED)
            for f in done:
                key = running.pop(f)
                try:
                    print(f.result(), flush=True)
                except Exception as err:  # one bad image must not stop a long run
                    print(f"{key[0]}/{key[1]}: ERROR {err!r}", flush=True)
                for c, e in waiting.pop(key, []):
                    running[ex.submit(job, c, e)] = (c["id"], e)
    return 0


if __name__ == "__main__":
    sys.exit(main())
