"""List words in wordlist.tsv that may need removing, for manual review.

Writes removal-candidates.md next to this file. Nothing is removed here.
Run: python review_candidates.py
"""
import collections
import re
from pathlib import Path

from nltk.stem import PorterStemmer

HERE = Path(__file__).resolve().parent
WORDS = [l.split("\t")[0] for l in (HERE / "wordlist.tsv").read_text(encoding="utf-8").splitlines()]
WORD_SET = set(WORDS)
STEMMER = PorterStemmer()

# Suffixes that mark an inflected form (plural, past, -ing, comparative, ...).
INFLECTIONS = ["ings", "ing", "ers", "er", "ed", "es", "s", "ly"]

def inflected_base(w):
    """Return a base form in the list that w appears to inflect, else None."""
    for suf in INFLECTIONS:
        if not w.endswith(suf) or len(w) - len(suf) < 3:
            continue
        stem = w[: -len(suf)]
        # try the stem, stem+e (chok+e), and undoubled consonant (grin, stop -> stop)
        options = [stem, stem + "e"]
        if len(stem) > 3 and stem[-1] == stem[-2]:
            options.append(stem[:-1])
        for base in options:
            if base in WORD_SET and base != w:
                return base
    return None

def main():
    inflected = {}
    for w in WORDS:
        base = inflected_base(w)
        if base:
            inflected[w] = base

    groups = collections.defaultdict(list)
    for w in WORDS:
        groups[STEMMER.stem(w)].append(w)
    shared = [sorted(g) for g in groups.values() if len(g) > 1]

    lines = [
        "# Removal candidates (for review, nothing removed yet)",
        "",
        f"- Inflected forms whose base is also in the list: {len(inflected)}",
        f"- Word families sharing a stem (Porter): {len(shared)} groups, {sum(len(g) for g in shared)} words",
        "",
        "## Inflected forms of a base already in the list",
        "",
    ]
    lines += [f"- {w} (base: {b})" for w, b in sorted(inflected.items())]
    lines += ["", "## Word families sharing a stem", ""]
    lines += ["- " + ", ".join(g) for g in sorted(shared)]
    (HERE / "removal-candidates.md").write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
    print(len(inflected), len(shared), sum(len(g) for g in shared))

if __name__ == "__main__":
    main()
