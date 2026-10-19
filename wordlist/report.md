# De-ID word list v1: report

Files in this folder: `wordlist.tsv` (10,000 lines, `word<TAB>pos`), `SHA256.txt`, `sample-names.md`, `build_wordlist.py`, `slur-list-en.txt`, `slur-supplement-en.txt`, `allow-list-en.txt`.
SHA-256 of `wordlist.tsv`: `f3ef814f5de25cb3ed87fc04a6c1d913d0cb688a0ea9b4c9ac8cc0286356049d`

A second run of the current script gave the same checksum.

## Sources and licences

| Source | Used for | Version | Licence |
|---|---|---|---|
| `wordfreq` (Python package), `top_n_list('en', 60000, wordlist='best')` | Frequency pool and order | 3.1.1 | Code: Apache-2.0 (from package metadata). Data: I believe CC BY-SA 4.0, but I did not check the package's data notice. Please confirm before publishing. |
| NLTK WordNet corpus (`nltk.download('wordnet')`) | Content-word check, base-form check, names, part of speech | NLTK 3.10.3 | WordNet licence (permissive). NLTK code: Apache-2.0. |
| LDNOOBW "List of Dirty, Naughty, Obscene, and Otherwise Bad Words", English (`slur-list-en.txt`, 403 lines, fetched from GitHub; SHA-256 `af851ecef1d5f212caba17339b12ac39cc2fef7d78c74876f67237644fcee8bd`) | Slur removal | master branch, as fetched | Not checked. I did not find a licence file in the repo. |
| Review decisions: `slur-supplement-en.txt` (9 words) and `allow-list-en.txt` (46 LDNOOBW words, including `smut`, plus `queer`) | Slur removal and exceptions | n/a | Reviewer's decisions, not from a published list. |

No packages were installed beyond `wordfreq` and `nltk`, as the brief allows.

## Counts after each step

| Step | Count |
|---|---|
| 1. Pool: ranks 10,001 to 60,000 | 50,000 |
| 2. Has a WordNet sense (noun, verb, adj or adv) | 33,263 |
| 3. Is a base form in WordNet (not an inflection) | 22,802 |
| 4. Plain a–z, 3–9 letters, not a name, not an abbreviation | 14,111 |
| 4a. Dropped as names only (includes capitalised acronyms) | 3,044 |
| 4b. Dropped as abbreviations (not already counted as names) | 4 |
| 5. Removed by the slur lists | 28 |
| 5. Left after the slur lists | 14,083 |
| 6. Kept: the 10,000 most frequent survivors | 10,000 |

Of the 28 slur removals, 9 come from the review supplement and 19 from LDNOOBW.

## Part of speech

| POS | Count |
|---|---|
| noun | 6,246 |
| verb | 1,601 |
| adj | 1,868 |
| adv | 285 |

**This breakdown is skewed toward nouns; see item 5 below.**

## Review decisions applied in this version

- **Removed from LDNOOBW (19):** clit, coon, fag, faggot, hooker, kike, negro, nigga, nigger, pedophile, poof, poon, rapist, skeet, spastic, swastika, tit, twat, xxx.
- **Removed from the missed-slur supplement (9):** dyke, wop, honky, cracker, midget, retard, gypsy, moron, cripple. Removal is whole-word only.
- **Kept (46 LDNOOBW words, including smut, plus queer):** the allow-list.

The 28 removals in total are the 19 above plus the 9 supplement words.

Your message listed `queer` both under "keep" and under "remove". I read the first instruction as the intent, so queer is kept. It is in `allow-list-en.txt`. If you want it removed, delete that line and rebuild.

Queer is still in `sample-names.md` as a word in one pair (42. "Bony Queer Blanc").

## Recipe changes and things that did not work as written

1. **Step 3, inflected forms.** The brief says to "keep only the base form", but it also says to lemmatise. I did not map inflections onto their base forms. I dropped inflected forms, and a base form stays only if it is in the pool by itself. So "lanterns" is gone, and "lantern" is kept only if it is among the candidates. Mapping would need a decision about base forms outside the pool.
2. **Step 4, names and abbreviations.** The brief names the rule but not how to detect it. I used two checks, both in `build_wordlist.py`:
   - A word is a name if every WordNet sense is an *instance* (WordNet's class for named people, places and organisations), or if its WordNet lemma is capitalised in every sense. The second check is needed because many place and person names are not instances, for example "Laos", "Delilah" and "Atlantis".
   - A word is an abbreviation if its WordNet lemma is all capitals (NSF, WWW) or its gloss says "abbreviation", "acronym" or "initialism".
   The names check is approximate. Some names may still get through, and a few real words may be lost if WordNet capitalises them in every sense.
3. **Step 5, slur lists.** The brief asks for one standard list. LDNOOBW also removes non-slurs. The allow-list and supplement are the review decisions. A word can be restored by adding it to `allow-list-en.txt`, and a word can be added by putting it in `slur-supplement-en.txt`.
4. **Step 5, slurs still possibly missed.** Other terms may still be missing from LDNOOBW and the supplement. I did not search for more.
5. **Step 6, part of speech.** The brief says to use the most common WordNet sense. WordNet's frequency counts (SemCor tags) exist for only about half the words. For **5,250** words the count was zero, so I fell back to WordNet's first sense. WordNet lists nouns first, so the fallback pushes the breakdown toward nouns. This matters for the adjective + noun pattern, since there are fewer adjectives than nouns. A better fallback would need a frequency source by part of speech. I have not changed the recipe. You said this is fine.

## Possible problems for review

**Odd survivors that look like abbreviations or units** (step 4 did not catch them): aah, aba, ade, bbl, bbs, bpm, bps, ccc, cps, khz, mcg, nth, pct, rpm, tsk. Some are unit or code words, and "aah" is an interjection. Recommend removing them in a v2 if you want a stricter rule.

**Brand-like words:** dell, jeep, coca, coco, xerox.

**Function-like words that got through step 2:** hereby, herein, therein, thence. The brief's "no 'the', 'and', 'of'" rule is met, because those words are in the top 10,000 and never reach the pool.

**Strange-looking or regional words:** ness (a headland), lough (an Irish lake), chou (a pastry, also a Chinese dynasty), monte, joss, bey, dahl, auld, cosy.

**Sensitive but not removed (no mood filter, per the brief):** fetish, spanking, bulge, gripe, profanity.

**Words that could read as names in a title:** some words are both common words and people's names, and the names check keeps them when WordNet has a common-noun sense. "rowan" is in the list, and "monte" and "joss" are too. Worth a look in `sample-names.md`.

## Reproducing

```bash
python build_wordlist.py
```

Requires `wordfreq`, `nltk`, and the NLTK `wordnet` corpus. The script rewrites `wordlist.tsv`, `SHA256.txt` and `sample-names.md`, and prints the step counts. The sample names use a fixed seed (20261015), so they are reproducible too.
