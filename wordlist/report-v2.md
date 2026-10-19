# De-ID word list v2: report

Files: `wordlist_v2.tsv` (10,000 lines, `word<TAB>pos`), `SHA256_v2.txt`, `sample-names-v2.md`, `audit-v2.tsv` (every word dropped, with the reason), `stats-v2.json`, `build_wordlist_v2.py`.
Inputs read by the script: `remove-list-en.txt`, `uk-spelling-en.txt`, `keep-forms-en.txt`, `slur-supplement-v2-en.txt`, `stop-words-en.txt` (plus the v1 slur files and `allow-list-en.txt`).
SHA-256 of `wordlist_v2.tsv`: `7296329b39fb7f5f17bcf4016d0c0b681d093c2e80b590fed2a67b1185fd7b6b`. A second run gave the same checksum. v1 files are untouched.

```bash
python build_wordlist_v2.py --glove path/to/glove.6B.300d.txt
```

Needs `wordfreq`, `nltk` (+ wordnet), `numpy`. Embeddings: GloVe 6B 300d (Stanford, `glove.6B.zip`, public-domain PDDL licence; I did not re-check the licence text).

## What changed from v1

| Step | v1 | v2 |
|---|---|---|
| Pool | ranks 10,001–60,000 | ranks 10,001–150,000 |
| Names, abbreviations, slurs | WordNet checks, LDNOOBW | same, plus code-like words (no vowel, mixed case), roman numerals, 3-letter words below zipf 3.3, a second slur supplement, hand removals |
| Brands, clips | none | removed by hand list (`remove-list-en.txt`) |
| Spelling | none | UK variants removed (US wins): hand list plus rules that need a shared WordNet synset with the US form |
| Inflected forms | WordNet base-form test only | plurals, -ed, -ing, comparatives and irregulars dropped when the base is a real word (rules in the script) |
| Word families | none | WordNet derivational links; keep the most frequent member |
| Selection | most frequent 10,000 | cosine pruning on GloVe (below) |

## Counts

| Step | Count |
|---|---|
| Pool | 140,000 |
| After v1-style filters, code-like, roman numerals, short rare words | 21,832 |
| After slurs, hand list, UK spellings | 20,975 |
| After dropping inflected forms | 18,731 |
| Dropped through the pair file (`families-extra-en.txt`) | 43 |
| After one word per family (1,567 families) | 16,851 |
| With a GloVe vector | 16,703 |
| After one word per affix family (1,011 families) | 15,366 |
| Entering pruning (most frequent 14,000) | 14,000 |
| Final | 10,000 |

## How the 10,000 are chosen

Pairs of candidates with cosine ≥ 0.30 are sorted by similarity, highest first. For each pair where both words are still in, the word with the lower score is dropped (score = zipf frequency plus a part-of-speech bonus: adj +1.5, verb +0.8, adv +0.8). Pairs one letter apart with cosine ≥ 0.45 (barbecue/barbeque) count as 1.0. This stops when 10,000 remain. It needs no randomness; similarities are rounded to six places and ties break alphabetically.

| Measure | v1 (10,000) | v2 (10,000) |
|---|---|---|
| Mean nearest-neighbour cosine | 0.527 | 0.403 |
| 95th percentile | 0.745 | 0.476 |
| Max | 0.944 | 0.485 |

So no two words in v2 are closer than 0.49 cosine. Mean zipf frequency of v2 is 2.73 (lowest 1.82). Only 4,741 words overlap with v1.

Part of speech: noun 6,950, adj 1,637, verb 1,221, adv 192. The adjective share is capped by the pool: adjectives cluster together in meaning, so more of them lose duels. A bigger adjective bonus changed almost nothing. Part of speech now falls back to word endings (-ous, -ly) before WordNet's first sense.

## The one knob: quality against spread

`--cand N` sets how many of the most frequent candidates enter pruning (default 14,000; after the affix-family step this is 91% of the 15,366 candidates). Measured:

| N | Max nearest-neighbour cosine | Mean zipf of final list |
|---|---|---|
| 10,500 | 0.67 | 3.07 |
| 12,500 | 0.54 | 2.95 |
| 14,000 (default; this row is from before the affix-family step, the first three are older still) | 0.49 | 2.85 |
| 17,000 | 0.43 | 2.62 |

Larger N means a more spread-out list but rarer words.

## Review decisions made in this version (please check)

- **Slurs added (`slur-supplement-v2-en.txt`, 25 words):** chink, coolie, dago, darky, gook, gipsy, kaffir, kafir, limey, mulatto, nigra, pollack, squaw, wog, yid, shylock, cretin, gimp, imbecile, mongoloid, cissy, nance, sissy, skank, slut. `slut` is also on `allow-list-en.txt` (your v1 decision), and the allow-list wins, so it is still in the list; delete it from the allow-list to drop it. For the others, add to `allow-list-en.txt` to restore.
- **Also removed by hand:** `niggle`, `snigger` (they contain a slur as a substring), roughly 150 personal names, places, brands and fragment-like words (see `remove-list-en.txt`).
- **Kept:** `queer` (per your answer), `scissors`, `alas`; `keep-forms-en.txt` also lists greeting, dwelling, stove and crooked, but greeting lost a pruning duel.

## Known problems

- **Vulgar words.** Profane, excretory and sexual words that were not on your allow-list have been removed (arse, bugger, wanker, fucker, ejaculate and others). Kept on purpose: the allow-listed words from v1, anatomical terms, sex-work terms, mild insults, `foreskin`, `pussycat`, `lust`, and, at your request, booger, damn, dung, fart, fetish, goddamn, piss, poop, prick, puke and turd. `python flag_vulgar.py wordlist_v2.tsv` writes `flagged-v2.tsv` (62 words) so you can see what is left.
- **Some rare or odd words remain.** I read the list twice and removed what I spotted; new ones that entered afterwards were checked once. Expect stragglers (dialect, foreign, jargon). Anything wrong goes in `remove-list-en.txt`; rebuild takes about 15 seconds.
- **Inflection and family rules are heuristics.** A few real words are lost (outer, crooked-type adjectives unless listed in `keep-forms-en.txt`) and a few forms may remain. `audit-v2.tsv` lists every drop.
- **Family dedup keeps the most frequent member, so a noun can win over its adjective** (and the reverse).
- **British vocabulary is not filtered** (only spellings): e.g. nappy, pram, petrol.
- **Brand and name detection is manual** beyond the WordNet checks.

## Added after the first write-up

- **Stop words.** `stop-words-en.txt` (379 words: prepositions, conjunctions, pronouns, auxiliaries, quantifiers, number words, months, days, interjections) is removed from every build. v2 hardly needs it, but it swapped about 30 words in (archaic function words such as hereby, thereof, thou). That is why the v2 checksum above differs from the first draft.
- **Vulgar flagger** (`flag_vulgar.py`): see the section above. Sources are LDNOOBW, the slur supplements, `vulgar-extra-en.tsv` (about 110 words in categories sexual, anatomical, profane, excretory, insult, sex-work) and a few substring stems (fuck, shit, cunt, bitch, whore, nigg, porn, pussy). A word on the allow-list is still flagged and marked "(allow-listed)". It is a first-pass word list, not a classifier: it will miss words I did not think of, and the anatomical and insult categories are broad on purpose so you can pick what to act on.
- **Second list with the top 10,000 included:** see `report-v2-full.md`.

## Family step, second version (word families such as color / discolor / bicolor / tricolor)

The first family step only used WordNet derivational links between words that start alike, so it missed prefixed words. A second step now runs after the GloVe filter:

1. **Prefix and suffix pairs.** If a word is another word plus a prefix (dis, bi, tri, un, re, in, over, under, non, anti, ...) or a suffix (ful, less, ness, ment, ly, er, ist, ism, ous, ive, ...), the pair is joined when there is evidence: the longer word's WordNet definition mentions the shorter one, they are WordNet antonyms or derivationally related forms, or their cosine is at least 0.35.
2. **Shared root.** Words are also joined through a root that is not itself a candidate, so discolor, bicolor and tricolor are one family even when "color" is not in the pool (as in v2, which skips the top 10,000).
3. **Same stem.** Words with the same Snowball stem are joined at cosine 0.1 or more.
4. In each family only the most frequent word is kept. 1,018 families were found.

Cosine alone is the wrong tool here. GloVe puts color and discolor at cosine 0.10, so a looser pruning tolerance would not remove them, and it would also delete many unrelated words. That is why this step uses spelling plus evidence.

Known limits: the step is heuristic. Some true families stay because no evidence links them (grieve / grievance / grievous, nutrient / nutrition, selfish / selfless / self), and some unrelated words are joined (render / surrender, formalize / inform, anime / animal). I tried a looser rule on shared spelling prefixes and dropped it, because it merged things like absolve / absolute and advance / advantage. Compounds (blackbird / blackface, housework / houseboat) are not treated as families. `audit-v2.tsv` lists each drop as "affix family of X".

## Haiku review and the changes it led to

Four Haiku reviewers each read half of v2 and v2-full (about 700 flags). Their report was uneven (for example, it claimed `desultory` appeared twice, and it flagged breed names and `queer`), so I applied only the categories I could check, and left out obscure words, vulgar words and the ambiguous slurs. Details in `haiku-review-proposed.md`.

- **UK spellings** (21 words, e.g. baulk, camomile, enquiry, louvre, mouldy, wilfully): added to `uk-spelling-en.txt`.
- **Hand removals** (about 220 words): misspellings and non-words (racoon, sherbert, miniscule), 74 clipped forms (camo, chimp, condo, kilo, ...), non-English words (agua, bleu, dinero, signor, ...), and names, brands and places (andromeda, columbo, amazon, tripoli, ...). Added to `remove-list-en.txt`.
- **Slurs** (13: fagot, hymie, greaser, blackface, mammy, spick, welch, papist, popish, redbone, slapper, wench, hadji): added to `slur-supplement-v2-en.txt`.
- **Stop words** (11: cheerio, ciao, adios, nay, ooh, vroom, passim, sic, non, lidar, maglev): added to `stop-words-en.txt`.
- **Pair file** `families-extra-en.txt` (61 pairs): same-family words and variant spellings Haiku found (nutrition / nutrient, loyalty / loyal, tabu / taboo, fiord / fjord, ...). When both words are candidates, the more frequent one stays. A variant whose standard form is not in the pool stays (kaftan, eyrie, teepee, bannister, dickie are still in).
- Haiku's findings were not re-reviewed after the rebuild. The words that replaced the removed ones have not been read by anyone.

## Final review changes

After the Haiku round, the replacement words were checked again. I removed the clear rule breakers (7 offensive terms, 13 UK or variant spellings, 18 sexual, clipped or non-English words) and 41 person names that look like ordinary words (degas, lambert, stein, weber, curie, dickens, ...). They went into `slur-supplement-v2-en.txt`, `uk-spelling-en.txt` and `remove-list-en.txt`. See `final-review.md` for what is still open.

After you reviewed the replacement words, 17 more were removed (arethusa, athar, dhal, sucre, yuan, whang, scag, quango, tombola, trews, lathi, qadi, sheikha, resh, perfecta, exacta, mescaline); `twofer` and `foreskin` were kept on purpose. The words that then came in were screened as they arrived, and these were skipped: broncho, chirk, wedel, whacko, cony. The last batch had nothing to skip.

Sensitive terms removed at your request: aborigine, oriental, pansy, pouf, gringo, minge. Kept at your request: dike, spade, paddy, fairy, guinea, mongrel, hillbilly, cockney, brit, queer. Replacements skipped while screening: lockman, orientate, erst, floozy.

Vulgar-word round: the removed words went into `remove-list-en.txt`. Replacements skipped while screening: buggery, crapper, fetishism, urinal, niggardly, kwanza, obeah, longlegs, fetishist, urination, reflexion, fetishize, rescript. `bondage` and `wank` came back as replacements and were kept because they are on your allow-list.

You then asked for booger, damn, dung, fart, fetish, goddamn, piss, poop, prick, puke, turd, pussycat and lust to go back in. They came off `remove-list-en.txt`. Not every one is in each list: a word has to survive the frequency and spread selection. In v2, damn, goddamn, lust and piss are absent (they are among the 10,000 most common words that v2 skips); in v2-full, prick is absent (pruned as too close to another word). Of the 47 allow-listed words, 31 are in v2 and 26 are in v2-full; the others were never candidates or lost the spread selection (for example bondage, vibrator, clitoris). Their return pushed out the lowest-scoring neighbours (for example samizdat, sepal, piteous in v2-full) and let in `servitude`.
