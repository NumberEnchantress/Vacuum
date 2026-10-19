"""Build the De-ID word list, version v2.

v1 (build_wordlist.py) picked the 10,000 most frequent clean words. v2 keeps
v1's filters, adds stricter form / family / spelling filters, and then picks
the final 10,000 words so that they are spread out in meaning:

  1. Pool, WordNet content words, base forms, a-z 3-9 letters, no names or
     abbreviations (reuses the v1 functions).
  2. Slurs, hand-removed words (abbreviations, brands, clips), UK spellings.
  3. Inflected forms (plurals, -ed, -ing, comparatives) are dropped.
  4. Word families (adore / adoration / adorer): keep the most frequent member.
  5. GloVe vectors; words with no vector are dropped.
  6. Diversity pruning: repeatedly take the closest pair (cosine) and drop the
     member with the lower score (frequency plus a part-of-speech bonus), until
     10,000 words remain.

Run:  python build_wordlist_v2.py --glove PATH/glove.6B.300d.txt

Writes wordlist_<tag>.tsv, SHA256_<tag>.txt, sample-names-<tag>.md and audit-<tag>.tsv
(every dropped word and why), and prints the counts for each step.
Needs wordfreq, nltk (+ wordnet corpus), numpy.
"""
import argparse
import collections
import hashlib
import heapq
import json
import random
import re
from pathlib import Path
from functools import lru_cache

import numpy as np
from nltk.corpus import wordnet as wn
from nltk.stem.snowball import SnowballStemmer
from wordfreq import top_n_list, zipf_frequency

from build_wordlist import (
    HERE, WORD_RE, POS_NAMES, is_abbreviation, is_name, read_words, load_slurs,
)

VERSION = "v2"  # default tag; --tag changes the output names
SAMPLE_SEED = 20261015
POOL_TOP = 150000
POOL_SKIP = 10000
FINAL_SIZE = 10000
SPELLING_COS = 0.45  # a one-letter-apart pair counts as a variant above this cosine
PAIR_FLOOR = 0.30  # only cosine pairs at or above this are considered for pruning
# Added to a word's score in a pruning duel, so scarcer parts of speech survive.
POS_BONUS = {"noun": 0.0, "adj": 1.5, "verb": 0.8, "adv": 0.8}  # overridden by --bonus


@lru_cache(maxsize=None)
def zipf(w):
    return zipf_frequency(w, "en", wordlist="best")


@lru_cache(maxsize=None)
def has_lemma(w, pos):
    return bool(wn.lemmas(w, pos))


def has_pos(w, kinds):
    return any(has_lemma(w, p) for p in kinds)


# ---- spelling -------------------------------------------------------------

ROMAN_RE = re.compile(r"(?=[ivxlcdm]{3,}$)m{0,3}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})")
SHORT_MIN_ZIPF = 3.3  # 3-letter words below this are mostly fragments and foreign words

UK_RULES = [
    (re.compile(r"our(s|ed|ing|y|able)?$"), r"or\1", 6),
    (re.compile(r"is(e|ed|es|ing|er|ers|ation|ations|able)$"), r"iz\1", 5),
    (re.compile(r"ys(e|ed|es|ing)$"), r"yz\1", 5),
    (re.compile(r"(?<=[bcdfgkmnpstvz])re$"), "er", 5),
    (re.compile(r"(?<=[a-z])(ae|oe)(?=[a-z])"), "e", 7),
]


def uk_spelling(w, hand):
    if w in hand:
        return "uk list"
    for rx, rep, minlen in UK_RULES:
        if len(w) >= minlen and rx.search(w):
            u = rx.sub(rep, w)
            # A real variant spelling shares a WordNet synset with the US form
            # and is not much rarer than it (this spares advertise, prise, timbre).
            if u != w and set(wn.synsets(w)) & set(wn.synsets(u)) and zipf(u) >= zipf(w) - 1.0:
                return f"uk rule -> {u}"
    return None


# ---- inflections ----------------------------------------------------------

EXC = {p: wn._exception_map.get(p, {}) for p in "nvar"}


def inflection_candidates(w):
    """Possible base forms of w, as (base, kind). kind: s, ed, ing or cmp."""
    out = []

    def add(b, kind):
        if len(b) >= 3 and b != w:
            out.append((b, kind))

    dbl = lambda s: len(s) > 3 and s[-1] == s[-2] and s[-1] not in "aeiou"
    if w.endswith("ies"):
        add(w[:-3] + "y", "s")
    if w.endswith("ves"):
        add(w[:-3] + "f", "s"); add(w[:-3] + "fe", "s")
    if w.endswith("es"):
        add(w[:-2], "s")
    if w.endswith("s") and not w.endswith("ss"):
        add(w[:-1], "s")
    if w.endswith("ied"):
        add(w[:-3] + "y", "ed")
    if w.endswith("ed"):
        add(w[:-2], "ed"); add(w[:-1], "ed")
        if dbl(w[:-2]):
            add(w[:-3], "ed")
    if w.endswith("ing"):
        add(w[:-3], "ing"); add(w[:-3] + "e", "ing")
        if dbl(w[:-3]):
            add(w[:-4], "ing")
        if w.endswith("ying"):
            add(w[:-4] + "ie", "ing")
    if w.endswith("ier"):
        add(w[:-3] + "y", "cmp")
    if w.endswith("iest"):
        add(w[:-4] + "y", "cmp")
    if w.endswith("er"):
        add(w[:-2], "cmp"); add(w[:-1], "cmp")
        if dbl(w[:-2]):
            add(w[:-3], "cmp")
    if w.endswith("est"):
        add(w[:-3], "cmp"); add(w[:-2], "cmp")
        if dbl(w[:-3]):
            add(w[:-4], "cmp")
    return out


# The base must be this part of speech, and zipf(base) - zipf(form) must be
# at least this much. Plurals and participles: the base may be a bit rarer.
# Comparatives: the base must be clearly more common.
# A plural that is far more common than its singular (scissors, goggles) is a
# word in its own right, so plurals need a base that is at least comparable.
FORM_RULES = {"s": ("nv", -0.3), "ed": ("v", -1.0), "ing": ("v", -1.0), "cmp": ("as", 0.3)}


def inflection_of(w):
    for p, exc in EXC.items():
        if w in exc and exc[w][0] != w and zipf(exc[w][0]) - zipf(w) >= -0.3:
            return exc[w][0], "irregular"
    for b, kind in inflection_candidates(w):
        pos, margin = FORM_RULES[kind]
        if kind == "cmp" and has_lemma(w, "n"):
            continue  # cutter, primer, commoner: nouns in -er are not comparatives
        if has_pos(b, pos) and zipf(b) - zipf(w) >= margin:
            return b, kind
    return None


# ---- word families --------------------------------------------------------

def common_prefix(a, b):
    n = 0
    for x, y in zip(a, b):
        if x != y:
            break
        n += 1
    return n


def family_links(w, cand):
    """Words in cand that WordNet derives from / to w and that share its stem."""
    links = set()
    for s in wn.synsets(w):
        for l in s.lemmas():
            if l.name().lower() != w:
                continue
            for r in l.derivationally_related_forms():
                r = r.name().lower()
                if r in cand and r != w and common_prefix(w, r) >= max(4, min(len(w), len(r)) - 3):
                    links.add(r)
    # plural / participle and its base, whichever is more common wins
    for b, kind in inflection_candidates(w):
        if b in cand and has_pos(b, FORM_RULES[kind][0]):
            links.add(b)
    # adverbs in -ly / -ily / -ally from their adjective
    if w.endswith("ly"):
        for b in (w[:-2], w[:-3] + "y", w[:-2] + "le", w[:-4] if w.endswith("ally") else ""):
            if b in cand and b != w:
                links.add(b)
    return links


def families(cand):
    parent = {w: w for w in cand}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for w in sorted(cand):
        for r in family_links(w, cand):
            a, b = find(w), find(r)
            if a != b:
                parent[max(a, b)] = min(a, b)
    groups = collections.defaultdict(list)
    for w in cand:
        groups[find(w)].append(w)
    return groups


# ---- affix families (color / discolor / bicolor / tricolor) ----------------

PREFIXES = ("dis bi tri un re in im il ir mis pre post over under out up non anti de co sub super "
            "inter semi multi poly mono uni counter fore after back down off sur trans ultra mid self").split()
SUFFIXES = ("ful less ness ment ly er est able ible ish ize ise ist ism ity y al ic ous ive ion ation "
            "ing ed ship hood dom age ery or ant ent ance ence").split()
STEM_COS = 0.1   # words sharing a Snowball stem are one family at or above this cosine
AFFIX_COS = 0.35  # an affix pair at or above this cosine is a family without any WordNet evidence


@lru_cache(maxsize=None)
def gloss_words(w):
    """Words used in the definitions of the senses where w is a lemma."""
    out = set()
    for s in wn.synsets(w):
        if any(l.name().lower() == w for l in s.lemmas()):
            out.update(re.findall(r"[a-z]+", s.definition().lower()))
    return frozenset(out)


@lru_cache(maxsize=None)
def antonym_names(w):
    return frozenset(
        a.name().lower() for s in wn.synsets(w) for l in s.lemmas() if l.name().lower() == w
        for a in l.antonyms()
    )


@lru_cache(maxsize=None)
def related_names(w):
    """Lemmas WordNet links to w as derivationally related forms or pertainyms."""
    out = set()
    for s in wn.synsets(w):
        for l in s.lemmas():
            if l.name().lower() == w:
                out.update(r.name().lower() for r in l.derivationally_related_forms())
                out.update(r.name().lower() for r in l.pertainyms())
    return frozenset(out)


def mentions(words, b, own):
    # `own` is the word whose definition this is: its own spelling does not count
    forms = {b, b + "s", b + "es", b + "ed", b + "ing", b + "er", b + "ers"}
    if b.endswith("e"):
        forms |= {b[:-1] + "ing", b[:-1] + "ed", b + "d", b + "r"}
    if b.endswith("y"):
        forms |= {b[:-1] + "ies", b[:-1] + "ied"}
    return bool((forms - {own}) & words)


def affix_bases(w):
    """Words that w may be built from by adding a prefix or a suffix."""
    out = set()
    for p in PREFIXES:
        if w.startswith(p) and len(w) - len(p) >= 4:
            out.add(w[len(p):])
    for sfx in SUFFIXES:
        if w.endswith(sfx) and len(w) - len(sfx) >= 3:
            b = w[: -len(sfx)]
            out |= {b, b + "e"}
            if b.endswith("i"):
                out.add(b[:-1] + "y")
            if len(b) > 3 and b[-1] == b[-2]:
                out.add(b[:-1])
    return {b for b in out if len(b) >= 4 and b != w}


def affix_families(words, vec_of, roots):
    """Group words that differ by a prefix or suffix and are related in meaning:
    WordNet gloss or antonym evidence, or a cosine of AFFIX_COS or more.
    `roots` is a wider vocabulary: discolor and bicolor are one family through
    "color" even when "color" is not itself a candidate. Returns the groups'
    members from `words` only."""
    wset = set(words)
    parent = {}

    def find(x):
        parent.setdefault(x, x)
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for w in sorted(words):
        find(w)
        for b in sorted(affix_bases(w) & (wset | roots)):
            vw, vb = vec_of(w), vec_of(b)
            related = (
                mentions(gloss_words(w), b, w) or mentions(gloss_words(b), w, b)
                or b in antonym_names(w) or w in antonym_names(b)
                or b in related_names(w) or w in related_names(b)
                or (vw is not None and vb is not None and float(vw @ vb) >= AFFIX_COS)
            )
            if related:
                x, y = find(w), find(b)
                if x != y:
                    parent[max(x, y)] = min(x, y)
    # Words that share a stem (nutrition / nutritive, induction / inductive) and mean
    # something alike are one family, even when no prefix or suffix rule joins them.
    stemmer = SnowballStemmer("english")
    by_stem = collections.defaultdict(list)
    for w in sorted(wset | roots):
        by_stem[stemmer.stem(w)].append(w)
    for members in by_stem.values():
        if len(members) < 2 or len(members) > 40 or not (wset & set(members)):
            continue
        for i, w in enumerate(members):
            for b in members[i + 1:]:
                if w not in wset and b not in wset:
                    continue
                vw, vb = vec_of(w), vec_of(b)
                if vw is not None and vb is not None and float(vw @ vb) >= STEM_COS:
                    x, y = find(w), find(b)
                    if x != y:
                        parent[max(x, y)] = min(x, y)
    groups = collections.defaultdict(list)
    for w in words:
        groups[find(w)].append(w)
    return groups


# ---- part of speech -------------------------------------------------------

ADJ_END = ("ous", "ive", "ful", "less", "able", "ible", "ish", "ic", "ical", "ary", "ent", "ant", "al", "ular")
VERB_END = ("ize", "ify", "ate", "ise")


def part_of_speech(word, senses):
    own = [s for s in senses if any(l.name().lower() == word for l in s.lemmas())] or senses
    counts = collections.Counter()
    order = []
    for s in own:
        p = POS_NAMES[s.pos()]
        if p not in order:
            order.append(p)
        counts[p] += sum(l.count() for l in s.lemmas() if l.name().lower() == word)
    if counts and max(counts.values()) > 0:
        best = max(counts.values())
        return next(p for p in order if counts[p] == best)
    if word.endswith("ly") and "adv" in order:
        return "adv"
    if word.endswith(ADJ_END) and "adj" in order:
        return "adj"
    if word.endswith(VERB_END) and len(word) > 5 and "verb" in order:
        return "verb"
    return order[0]


# ---- embeddings and pruning ------------------------------------------------

def load_vectors(path, wanted):
    vecs = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            w, _, rest = line.partition(" ")
            if w in wanted:
                vecs[w] = np.asarray(rest.split(), dtype=np.float64)
    return vecs


def close_pairs(X, floor):
    """All (sim, i, j), i < j, with cosine >= floor. Sims rounded to 6 places."""
    n = len(X)
    sims, rows, cols = [], [], []
    for i0 in range(0, n, 2000):
        S = X[i0:i0 + 2000] @ X.T
        ii, jj = np.nonzero(S >= floor)
        ii = ii + i0
        keep = ii < jj
        sims.append(np.round(S[ii[keep] - i0, jj[keep]], 6))
        rows.append(ii[keep]); cols.append(jj[keep])
    return np.concatenate(sims), np.concatenate(rows), np.concatenate(cols)


def spelling_pairs(words, minlen=5):
    """Index pairs of words one edit apart: one letter added, dropped or changed
    (barbecue/barbeque, scissor/scissors, cypher/cipher)."""
    index = {w: i for i, w in enumerate(words)}
    pairs = set()
    wild = collections.defaultdict(list)
    for i, w in enumerate(words):
        if len(w) < minlen:
            continue
        for k in range(len(w)):
            d = w[:k] + w[k + 1:]
            if d in index and len(d) >= minlen:
                pairs.add(tuple(sorted((i, index[d]))))
            wild[w[:k] + "*" + w[k + 1:]].append(i)
    for g in wild.values():
        for x in range(len(g)):
            for y in range(x + 1, len(g)):
                pairs.add((g[x], g[y]))
    return sorted(pairs)


def prune(words, X, score, target):
    """Drop words until `target` remain: lower score loses in the closest pair."""
    sims, rows, cols = close_pairs(X, PAIR_FLOOR)
    # Spelling neighbours that also mean something alike (variant spellings,
    # singular / plural) duel first, as if their cosine were 1.0.
    sp = [(a, b) for a, b in spelling_pairs(words) if float(X[a] @ X[b]) >= SPELLING_COS]
    if sp:
        sims = np.concatenate([sims, np.ones(len(sp))])
        rows = np.concatenate([rows, [a for a, _ in sp]])
        cols = np.concatenate([cols, [b for _, b in sp]])
    order = np.lexsort((cols, rows, -sims))  # sim desc, then index order
    alive = np.ones(len(words), dtype=bool)
    removed = []  # (word, closest-kept-partner, sim)
    left = len(words)
    for k in order:
        if left <= target:
            break
        i, j = int(rows[k]), int(cols[k])
        if not (alive[i] and alive[j]):
            continue
        # lower score loses; ties: the alphabetically later word loses
        lose, keep = (i, j) if (score[i], words[j]) < (score[j], words[i]) else (j, i)
        alive[lose] = False
        left -= 1
        removed.append((words[lose], words[keep], float(sims[k])))
    if left > target:
        raise SystemExit(f"Ran out of pairs >= {PAIR_FLOOR} with {left} words left; lower PAIR_FLOOR.")
    return alive, removed


def nn_stats(X):
    nn = np.empty(len(X))
    for i0 in range(0, len(X), 2000):
        S = X[i0:i0 + 2000] @ X.T
        S[np.arange(S.shape[0]), np.arange(S.shape[0]) + i0] = -1
        nn[i0:i0 + 2000] = S.max(axis=1)
    return {
        "mean nearest-neighbour cosine": round(float(nn.mean()), 4),
        "median": round(float(np.median(nn)), 4),
        "95th percentile": round(float(np.percentile(nn, 95)), 4),
        "max": round(float(nn.max()), 4),
    }


# ---- main -----------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--glove", required=True, help="path to glove.6B.300d.txt")
    ap.add_argument("--dump-cands", default="", help="write the candidates before the affix step to this file")
    ap.add_argument("--skip", type=int, default=POOL_SKIP, help="most frequent words to leave out (0 = none)")
    ap.add_argument("--tag", default=VERSION, help="names the output files, e.g. v2-full")
    ap.add_argument("--cand", type=int, default=14000, help="candidates entering pruning")
    ap.add_argument("--bonus", default="", help="e.g. adj=1.0,verb=0.5,adv=0.5")
    args = ap.parse_args()
    for kv in filter(None, args.bonus.split(",")):
        k, v = kv.split("=")
        POS_BONUS[k] = float(v)

    stats = collections.OrderedDict()
    audit = []  # (word, reason)

    ranked = top_n_list("en", POOL_TOP, wordlist="best")
    pool = ranked[args.skip:]
    stats["1 pool (skipping the top %d)" % args.skip] = len(pool)

    # Step 2-4 as in v1: WordNet content words, base forms, readable, not a name.
    base = {}
    for w in pool:
        if not WORD_RE.fullmatch(w):
            continue
        senses = wn.synsets(w)
        if not senses or not wn.lemmas(w):
            continue
        if is_name(w, senses):
            audit.append((w, "name")); continue
        if is_abbreviation(w, senses):
            audit.append((w, "abbreviation")); continue
        if ROMAN_RE.fullmatch(w) and w != "mix":
            audit.append((w, "roman numeral")); continue
        if len(w) == 3 and zipf(w) < SHORT_MIN_ZIPF:
            audit.append((w, "3-letter and rare")); continue
        if not re.search(r"[aeiouy]", w) or any(
            any(c.isupper() for c in l.name()[1:]) for s in senses for l in s.lemmas() if l.name().lower() == w
        ):
            audit.append((w, "code-like (no vowel or mixed case)")); continue
        base[w] = senses
    stats["2 v1 filters (WordNet, base form, a-z 3-9, no names/abbrev)"] = len(base)

    slurs = (load_slurs() | read_words("slur-supplement-v2-en.txt")) - read_words("allow-list-en.txt")
    hand = read_words("remove-list-en.txt")
    stop = read_words("stop-words-en.txt")
    uk_hand = read_words("uk-spelling-en.txt")
    keep_forms = read_words("keep-forms-en.txt")
    cand = {}
    for w, senses in base.items():
        if w in slurs:
            audit.append((w, "slur")); continue
        if w in stop:
            audit.append((w, "stop word / number / date / interjection")); continue
        if w in hand:
            audit.append((w, "hand-removed (abbrev/brand/clip/name)")); continue
        why = uk_spelling(w, uk_hand)
        if why and w not in keep_forms:
            audit.append((w, why)); continue
        cand[w] = senses
    stats["3 after slurs, hand list, UK spellings"] = len(cand)

    forms = {}
    for w in list(cand):
        if w in keep_forms:
            continue
        r = inflection_of(w)
        if r:
            forms[w] = r
            audit.append((w, f"inflection of {r[0]} ({r[1]})"))
            del cand[w]
    stats["4 after dropping inflected forms"] = len(cand)

    # Hand-checked pairs (families-extra-en.txt): keep the more frequent of the two.
    pair_dropped = 0
    pf = HERE / "families-extra-en.txt"
    if pf.exists():
        for line in pf.read_text(encoding="utf-8").splitlines():
            if not line.strip() or line.startswith("#"):
                continue
            a, b = line.split()
            if a in cand and b in cand:
                head, tail = sorted((a, b), key=lambda w: (-zipf(w), w))
                if tail not in keep_forms:
                    audit.append((tail, f"pair file: family of {head}"))
                    del cand[tail]
                    pair_dropped += 1
    stats["4 dropped through families-extra-en.txt"] = pair_dropped

    fam_dropped = 0
    fam_groups = 0
    for g in families(set(cand)).values():
        if len(g) < 2:
            continue
        fam_groups += 1
        g.sort(key=lambda w: (-zipf(w), w))
        for w in g[1:]:
            if w in keep_forms:
                continue
            audit.append((w, f"family of {g[0]}"))
            del cand[w]
            fam_dropped += 1
    stats["5 families with 2+ members"] = fam_groups
    stats["5 after keeping one word per family"] = len(cand)

    words = sorted(cand)
    roots = {w for w in ranked if w.isalpha() and len(w) >= 4 and wn.lemmas(w)}
    vecs = load_vectors(args.glove, set(words) | roots)
    nov = [w for w in words if w not in vecs]
    audit.extend((w, "no GloVe vector") for w in nov)
    words = [w for w in words if w in vecs]
    stats["6 with a GloVe vector"] = len(words)

    if args.dump_cands:  # for tuning: the candidates just before the affix-family step
        Path(args.dump_cands).write_text(chr(10).join(words) + chr(10), encoding="utf-8")
    unit = {w: v / np.linalg.norm(v) for w, v in vecs.items()}
    af_groups = 0
    for g in affix_families(words, unit.get, roots).values():
        if len(g) < 2:
            continue
        af_groups += 1
        g.sort(key=lambda w: (-zipf(w), w))
        for w in g[1:]:
            if w in keep_forms:
                continue
            audit.append((w, f"affix family of {g[0]}"))
            del cand[w]
    words = [w for w in words if w in cand]
    stats["6 affix families with 2+ members"] = af_groups
    stats["6 after keeping one word per affix family"] = len(words)
    if len(words) < FINAL_SIZE:
        raise SystemExit(f"Only {len(words)} candidates; raise POOL_TOP.")

    # Quality first: only the CAND_N most frequent candidates go into pruning.
    words = sorted(sorted(words), key=lambda w: -zipf(w))[:args.cand]
    audit.extend((w, "below frequency cut") for w in set(vecs) & set(cand) if w not in set(words))
    words.sort()
    stats["6 candidates entering pruning"] = len(words)
    stats["6 lowest zipf among them"] = round(min(zipf(w) for w in words), 2)

    X = np.stack([vecs[w] for w in words])
    X /= np.linalg.norm(X, axis=1, keepdims=True)
    pos = {w: part_of_speech(w, cand[w]) for w in words}
    stats["6 candidate part of speech"] = dict(collections.Counter(pos.values()))
    score = [zipf(w) + POS_BONUS[pos[w]] for w in words]

    alive, removed = prune(words, X, score, FINAL_SIZE)
    audit.extend((w, f"too close to {k} (cos {s:.3f})") for w, k, s in removed)
    keep_idx = [i for i in range(len(words)) if alive[i]]
    final = [words[i] for i in keep_idx]
    stats["7 final"] = len(final)
    stats["7 last pair removed, cosine"] = round(removed[-1][2], 4) if removed else None
    stats["7 final zipf: mean / lowest"] = [round(float(np.mean([zipf(w) for w in final])), 2), round(min(zipf(w) for w in final), 2)]
    stats["7 final part of speech"] = dict(collections.Counter(pos[w] for w in final))
    stats["7 final spread (nearest neighbour)"] = nn_stats(X[keep_idx])

    # v1 for comparison, over the words GloVe knows.
    v1 = [l.split("\t")[0] for l in (HERE / "wordlist.tsv").read_text(encoding="utf-8").splitlines()]
    v1v = load_vectors(args.glove, set(v1))
    V1 = np.stack([v1v[w] for w in sorted(v1v)])
    V1 /= np.linalg.norm(V1, axis=1, keepdims=True)
    stats["v1 for comparison (nearest neighbour)"] = nn_stats(V1)
    stats["v1 words also in v2"] = len(set(v1) & set(final))

    tagged = [(w, pos[w]) for w in final]
    tsv = HERE / f"wordlist_{args.tag}.tsv"
    with open(tsv, "w", encoding="utf-8", newline="\n") as f:
        for w, p in tagged:
            f.write(f"{w}\t{p}\n")
    digest = hashlib.sha256(tsv.read_bytes()).hexdigest()
    sha = HERE / f"SHA256_{args.tag}.txt"
    sha.write_text(f"{args.tag}\n{digest}  wordlist_{args.tag}.tsv\n", encoding="utf-8", newline="\n")
    with open(HERE / f"audit-{args.tag}.tsv", "w", encoding="utf-8", newline="\n") as f:
        for w, why in sorted(audit):
            f.write(f"{w}\t{why}\n")
    write_samples(tagged, args.tag)
    stats["final sha256"] = digest
    print(json.dumps(stats, indent=2))


def write_samples(tagged, tag):
    rng = random.Random(SAMPLE_SEED)
    words = [w for w, _ in tagged]
    adjs = [w for w, p in tagged if p == "adj"]
    nouns = [w for w, p in tagged if p == "noun"]
    title = lambda parts: " ".join(p.title() for p in parts)
    adj_noun = [title((rng.choice(adjs), rng.choice(nouns))) for _ in range(100)]
    any_two = [title(rng.sample(words, 2)) for _ in range(100)]
    artists = [title((rng.choice(adjs), rng.choice(adjs), rng.choice(nouns))) for _ in range(50)]
    lines = [f"# Sample names, wordlist {tag}", "",
             f"Generated by build_wordlist_v2.py with seed {SAMPLE_SEED}.", "",
             "## Adjective + noun (100)", "", *[f"{i}. {n}" for i, n in enumerate(adj_noun, 1)], "",
             "## Any two words (100)", "", *[f"{i}. {n}" for i, n in enumerate(any_two, 1)], "",
             "## Artist names: adjective + adjective + noun (50)", "",
             *[f"{i}. {n}" for i, n in enumerate(artists, 1)], ""]
    (HERE / f"sample-names-{tag}.md").write_text("\n".join(lines), encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main()
