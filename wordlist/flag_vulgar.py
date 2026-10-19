"""Flag vulgar words in a word list. Flag only: nothing is removed.

    python flag_vulgar.py wordlist_v2.tsv [more lists ...]

For each list it writes flagged-<stem>.tsv (word, pos, category, source) next to
the list and prints a summary. Sources, all read from this folder:

  slur-list-en.txt          LDNOOBW list (exact word match)
  slur-supplement-*.txt     slurs added at review (exact word match)
  vulgar-extra-en.tsv       hand-made list with categories (exact word match)
  STEMS below               profane stems that appear inside other words

A word on allow-list-en.txt is still flagged; the source column says
"(allow-listed)" so you can see it was a kept-on-purpose word.
"""
import collections
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent

# Stem -> category. A word that contains the stem is flagged "substring". Only stems
# that almost never sit inside innocent words (not cock, dick, rape: cockatoo, drape).
STEMS = {
    "fuck": "profane", "shit": "profane", "cunt": "profane", "bitch": "profane",
    "whore": "sex-work", "nigg": "slur", "porn": "sexual", "pussy": "profane",
}


def read_words(name):
    p = HERE / name
    if not p.exists():
        return set()
    return {l.strip().lower() for l in p.read_text(encoding="utf-8").splitlines()
            if l.strip() and not l.startswith("#")}


def load_sources():
    src = {}  # word -> (category, source)
    for w in read_words("slur-list-en.txt"):
        src[w] = ("ldnoobw", "LDNOOBW")
    for p in sorted(HERE.glob("slur-supplement-*.txt")):
        for w in read_words(p.name):
            src[w] = ("slur", p.name)
    extra = HERE / "vulgar-extra-en.tsv"
    for line in extra.read_text(encoding="utf-8").splitlines():
        if line.strip() and not line.startswith("#"):
            w, _, cat = line.partition("\t")
            src.setdefault(w.strip().lower(), (cat.strip() or "vulgar", "vulgar-extra-en.tsv"))
    return src


def main(paths):
    src = load_sources()
    allowed = read_words("allow-list-en.txt")
    for path in map(Path, paths):
        rows = [l.rstrip("\n").split("\t") for l in path.read_text(encoding="utf-8").splitlines() if l.strip()]
        flagged = []
        for w, pos in ((r[0], r[1] if len(r) > 1 else "") for r in rows):
            if w in src:
                cat, source = src[w]
                flagged.append((w, pos, cat, source + (" (allow-listed)" if w in allowed else "")))
            else:
                for stem, cat in STEMS.items():
                    if stem in w:
                        flagged.append((w, pos, cat, f"substring '{stem}'"))
                        break
        out = path.with_name(f"flagged-{path.stem.replace('wordlist_', '')}.tsv")
        with open(out, "w", encoding="utf-8", newline="\n") as f:
            f.write("word\tpos\tcategory\tsource\n")
            for r in sorted(flagged):
                f.write("\t".join(r) + "\n")
        by = collections.Counter(r[2] for r in flagged)
        print(f"{path.name}: {len(flagged)} of {len(rows)} flagged -> {out.name}  {dict(by)}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    main(sys.argv[1:])
