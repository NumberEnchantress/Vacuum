"""Independent reference for the unfamiliar sounds derivation, used to make test vectors.

Written separately from core/derive.js (standard library only) so the tests
compare two implementations rather than the code against itself. It reads
the palette tables from core/derive.js, because those are data, not logic.

    python tools/reference.py > test/vectors.json
"""

import hashlib
import hmac
import json
import pathlib
import re
import unicodedata

ROOT = pathlib.Path(__file__).resolve().parent.parent
WORDLIST = ROOT / "data" / "wordlist_v2-full.tsv"
CORE = (ROOT / "core" / "derive.js").read_text(encoding="utf-8")

SHAPES = ["circle", "square", "triangle", "diamond", "half-disc", "ring", "bar", "cross"]
COUNTS = {"track": 2, "album": 2, "playlist": 2, "artist": 3, "user": 2}
PATTERNS = {"track": ["adj", "noun"], "album": ["adj", "noun"], "playlist": ["adj", "noun"], "artist": ["adj", "adj", "noun"], "user": ["adj", "noun"]}
PICTURE = {"track": "cover", "album": "cover", "playlist": "cover", "artist": "rings", "user": "rings"}


def normalize_name(name):
    return re.sub(r"\s+", " ", unicodedata.normalize("NFC", name)).strip().lower()


def js_array(name):
    body = re.search(r"const %s = Object\.freeze\(\[(.*?)\n  \]\);" % name, CORE, re.S).group(1)
    return json.loads("[" + re.sub(r",\s*$", "", body.strip()) + "]")


PALETTE = js_array("PALETTE")
CONTRAST = js_array("CONTRAST")

rows = [line.split("\t") for line in WORDLIST.read_text(encoding="utf-8").splitlines()]
WORDS = [w for w, _ in rows]
BY_POS = {p: [w for w, q in rows if q == p] for p in ("noun", "verb", "adj", "adv")}


class Draw:
    def __init__(self, data):
        self.n = int.from_bytes(data, "big")

    def __call__(self, k):
        self.n, r = divmod(self.n, k)
        return r


def derive(key, kind, name, order="any"):
    d = hmac.new(key, f"{kind}:{normalize_name(name)}".encode(), hashlib.sha256).digest()
    draw = Draw(d[:16])
    if order == "any":
        words = [WORDS[draw(len(WORDS))] for _ in range(COUNTS[kind])]
    else:
        words = [BY_POS[p][draw(len(BY_POS[p]))] for p in PATTERNS[kind]]
    draw = Draw(d[16:])
    if PICTURE[kind] == "cover":
        squares = []
        for _ in range(4):
            bg = draw(len(PALETTE))
            allowed = CONTRAST[bg]
            squares.append({"background": bg, "color": allowed[draw(len(allowed))],
                            "shape": SHAPES[draw(len(SHAPES))], "turn": draw(4)})
        picture = {"kind": "cover", "squares": squares}
    else:
        rings = [draw(len(PALETTE))]
        while len(rings) < 8:
            allowed = CONTRAST[rings[-1]]
            rings.append(allowed[draw(len(allowed))])
        picture = {"kind": "rings", "rings": rings, "profile": draw(4)}
    return {"digest": d.hex(), "words": words, "picture": picture}


TEST_KEY = bytes(range(32))
CASES = [
    ("track", "Never Gonna Give You Up"),
    ("track", "  never   gonna give YOU up "),
    ("track", "Été indien"),
    ("album", "Never Gonna Give You Up"),
    ("album", "Random Access Memories"),
    ("artist", "Daft Punk"),
    ("artist", "Sigur Rós"),
    ("playlist", "Rainy Day Jazz"),
    ("user", "Someone"),
]

if __name__ == "__main__":
    out = {
        "key": TEST_KEY.hex(),
        "palette": PALETTE,
        "cases": [
            {"type": t, "id": i, "any": derive(TEST_KEY, t, i), "pattern": derive(TEST_KEY, t, i, "pattern")["words"]}
            for t, i in CASES
        ],
    }
    print(json.dumps(out, indent=2))
