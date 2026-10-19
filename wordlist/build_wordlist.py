"""Build the De-ID word list, version v1.

Follows the recipe in brief-wordlist.md. Run it from anywhere:

    python build_wordlist.py

It writes wordlist.tsv, SHA256.txt and sample-names.md next to this file,
and prints the counts for each step of the recipe (paste them into report.md).

Needs the wordfreq and nltk packages, plus the NLTK 'wordnet' corpus
(python -c "import nltk; nltk.download('wordnet')").
Reads slur-list-en.txt (the LDNOOBW English list), slur-supplement-en.txt
(words added at review) and allow-list-en.txt (words kept despite a list), all next to this file.
"""
import collections
import hashlib
import json
import random
import re
from pathlib import Path

from nltk.corpus import wordnet as wn
from wordfreq import top_n_list

HERE = Path(__file__).resolve().parent
VERSION = "v1"
SAMPLE_SEED = 20261015  # fixed, so the sample names can be regenerated exactly
POOL_TOP = 60000        # step 1: the 60,000 most frequent words...
POOL_SKIP = 10000       # ...minus the 10,000 most frequent
FINAL_SIZE = 10000      # step 6
WORD_RE = re.compile(r"[a-z]{3,9}")  # step 4: plain a-z, 3 to 9 letters
POS_NAMES = {"n": "noun", "v": "verb", "a": "adj", "s": "adj", "r": "adv"}


def pos_names(senses):
    return {POS_NAMES[s.pos()] for s in senses}


def senses_with_word(word, senses):
    # The senses where the word is written as a lemma (not just reached via morphy).
    return [s for s in senses if any(l.name().lower() == word for l in s.lemmas())]


def word_names(word, sense):
    return [l.name() for l in sense.lemmas() if l.name().lower() == word]


def is_name(word, senses):
    # WordNet files people, places and organisations as instances of a
    # class, and writes their lemmas capitalised. If every sense is one of
    # those, the word is only a name.
    relevant = senses_with_word(word, senses)
    return all(
        s.instance_hypernyms() or all(n[0].isupper() for n in word_names(word, s))
        for s in relevant
    )


def is_abbreviation(word, senses):
    # WordNet writes acronyms in capitals (NSF, WWW) and glosses them as
    # abbreviations. If every sense does this, the word is an abbreviation.
    relevant = senses_with_word(word, senses)
    return all(
        all(n.isupper() for n in word_names(word, s))
        or any(k in s.definition().lower() for k in ("abbreviation", "acronym", "initialism"))
        for s in relevant
    )


def most_common_pos(word, senses):
    # The most common sense is the one with the most SemCor tags.
    # Ties, and words with no tags, fall back to WordNet's sense order.
    best, best_n = senses[0], -1
    for s in senses:
        n = sum(l.count() for l in s.lemmas() if l.name().lower() == word)
        if n > best_n:
            best, best_n = s, n
    return POS_NAMES[best.pos()], best_n


def read_words(name):
    # One word per line; lines starting with # are comments.
    lines = (HERE / name).read_text(encoding="utf-8").splitlines()
    return {l.strip().lower() for l in lines if l.strip() and not l.startswith("#")}


def load_slurs():
    # LDNOOBW, plus words added at review, minus words the reviewer allowed.
    return (read_words("slur-list-en.txt") | read_words("slur-supplement-en.txt")) - read_words(
        "allow-list-en.txt"
    )


def main():
    stats = collections.OrderedDict()

    # 1. Pool, ranked most frequent first.
    ranked = top_n_list("en", POOL_TOP, wordlist="best")
    pool = ranked[POOL_SKIP:]
    stats["1 pool (ranks 10,001 to 60,000)"] = len(pool)

    # 2. Content words: WordNet has at least one sense for the word.
    content = {}
    for w in pool:
        senses = wn.synsets(w)
        if senses:
            content[w] = senses
    stats["2 content words (WordNet sense as n/v/adj/adv)"] = len(content)

    # 3. One form per word: keep only words that WordNet lists as a base form.
    #    wn.lemmas(w) finds exact lemmas only, so "lanterns" and "wandered" fail.
    base = {w: s for w, s in content.items() if wn.lemmas(w)}
    stats["3 base forms only"] = len(base)

    # 4. Readable: plain a-z, 3 to 9 letters, not only a name, not an abbreviation.
    readable = {}
    dropped_names, dropped_abbrev = [], []
    for w, senses in base.items():
        if not WORD_RE.fullmatch(w):
            continue
        if is_name(w, senses):
            dropped_names.append(w)
            continue
        if is_abbreviation(w, senses):
            dropped_abbrev.append(w)
            continue
        readable[w] = senses
    stats["4 readable (a-z, 3-9 letters, not only names)"] = len(readable)
    stats["4 dropped as names only (count)"] = len(dropped_names)
    stats["4 dropped as abbreviations (count)"] = len(dropped_abbrev)

    # 5. No slurs (LDNOOBW English list, which is broader than slurs alone).
    slurs = load_slurs()
    dropped_slurs = sorted(w for w in readable if w in slurs)
    survivors = [w for w in pool if w in readable and w not in slurs]
    stats["5 removed by slur list (count)"] = len(dropped_slurs)
    stats["5 after slur list"] = len(survivors)

    # 6. Cut to the 10,000 most frequent survivors, tag each with a POS.
    if len(survivors) < FINAL_SIZE:
        raise SystemExit(f"Only {len(survivors)} survivors; need {FINAL_SIZE}.")
    chosen = survivors[:FINAL_SIZE]
    tagged = []
    no_tags = 0
    for w in chosen:
        pos, n = most_common_pos(w, readable[w])
        no_tags += n == 0
        tagged.append((w, pos))
    stats["6 final list"] = len(tagged)
    stats["6 words with no SemCor tags (fell back to first sense)"] = no_tags
    stats["6 part-of-speech breakdown"] = dict(collections.Counter(p for _, p in tagged))

    tagged.sort(key=lambda t: t[0])
    tsv = HERE / "wordlist.tsv"
    with open(tsv, "w", encoding="utf-8", newline="\n") as f:
        for w, pos in tagged:
            f.write(f"{w}\t{pos}\n")

    digest = hashlib.sha256(tsv.read_bytes()).hexdigest()
    (HERE / "SHA256.txt").write_text(
        f"{VERSION}\n{digest}  wordlist.tsv\n", encoding="utf-8", newline="\n"
    )

    write_samples(tagged)

    stats["final sha256"] = digest
    stats["dropped as names (first 60)"] = dropped_names[:60]
    stats["removed by slur list (all)"] = dropped_slurs
    print(json.dumps(stats, indent=2))


def write_samples(tagged):
    rng = random.Random(SAMPLE_SEED)
    words = [w for w, _ in tagged]
    adjs = [w for w, p in tagged if p == "adj"]
    nouns = [w for w, p in tagged if p == "noun"]
    title = lambda parts: " ".join(p.title() for p in parts)

    adj_noun = [title((rng.choice(adjs), rng.choice(nouns))) for _ in range(100)]
    any_two = [title(rng.sample(words, 2)) for _ in range(100)]
    artists = [title((rng.choice(adjs), rng.choice(adjs), rng.choice(nouns))) for _ in range(50)]

    lines = [
        f"# Sample names, wordlist {VERSION}",
        "",
        f"Generated by build_wordlist.py with seed {SAMPLE_SEED}. "
        "These are random draws, not the derivation; the real names come from the app.",
        "",
        "## Adjective + noun (100)",
        "",
        *[f"{i}. {n}" for i, n in enumerate(adj_noun, 1)],
        "",
        "## Any two words (100)",
        "",
        *[f"{i}. {n}" for i, n in enumerate(any_two, 1)],
        "",
        "## Artist names: adjective + adjective + noun (50)",
        "",
        *[f"{i}. {n}" for i, n in enumerate(artists, 1)],
        "",
    ]
    (HERE / "sample-names.md").write_text("\n".join(lines), encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main()
