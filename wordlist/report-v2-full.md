# De-ID word list v2-full: report

Same pipeline as v2 (`build_wordlist_v2.py`), with the 10,000 most frequent words no longer skipped.

```bash
python build_wordlist_v2.py --glove path/to/glove.6B.300d.txt --skip 0 --tag v2-full --cand 15700
```

Files: `wordlist_v2-full.tsv`, `SHA256_v2-full.txt`, `sample-names-v2-full.md`, `audit-v2-full.tsv`, `stats-v2-full.json`, `flagged-v2-full.tsv`.
SHA-256 of `wordlist_v2-full.tsv`: `d4610605d28ebcc8efe24548b2cc38044618ee2f9147cafe6dbea770d6ebd0ab`. A second run gave the same checksum.

## What is different from v2

- Pool is ranks 1 to 150,000. All v2 filters still apply: WordNet content word and base form, a-z 3 to 9 letters, no names or abbreviations, slurs, hand list, UK spellings, inflected forms, one word per family, then one word per affix family (color / discolor / bicolor / tricolor: only `color` stays).
- **New: `stop-words-en.txt`.** Without the top 10,000 skipped, function words (above, between, within, whenever), pronouns, auxiliaries (can, will, must), numbers, ordinals, months, days and interjections reach the pool, so they are listed and removed.
- About 80 more personal names, places, nationalities, brands and clipped forms were removed by hand (appended to `remove-list-en.txt`). Names that are also ordinary words (mark, bill, grant, mason, cole) are kept.

## Counts

| Step | Count |
|---|---|
| Pool | 150,000 |
| After v1-style filters and short/rare/roman/code-like | 27,427 |
| After slurs, stop words, hand list, UK spellings | 26,232 |
| After dropping inflected forms | 23,000 |
| Dropped through the pair file (`families-extra-en.txt`) | 53 |
| After one word per family (3,062 families) | 18,762 |
| With a GloVe vector | 18,628 |
| After one word per affix family (1,233 families; see `report-v2.md`) | 16,939 |
| Entering pruning (most frequent 15,700) | 15,700 |
| Final | 10,000 |

Families remove far more here (3,062 families) because the common member of a family now competes and wins.

## Spread and frequency

| | v1 | v2 | v2-full |
|---|---|---|---|
| Mean nearest-neighbour cosine | 0.527 | 0.403 | 0.407 |
| Max | 0.944 | 0.485 | 0.484 |
| Mean zipf (higher = more common) | n/a | 2.73 | 2.92 |

`--cand 15700` is 93% of the 16,939 candidates after the family steps (v2 uses 91%) and gives the same worst-case spread. Other values tried (measured before the affix-family step, so only indicative): 14,000 gives max 0.54 and mean zipf 3.29; 17,500 gives max 0.46 and 2.90; all of the then-19,057 candidates gives max 0.43 and 2.71 (which keeps more rare words).

Part of speech: noun 6,988, adj 1,552, verb 1,392, adv 68. Overlap with v2: 7,957 words; with v1: 3,572.

## Known problems

- Common words are back, so the list now has plain words like become, call, good, full, last, world. That is what an unrestricted pool gives; the pruning makes sure no two are close in meaning.
- Name detection is still WordNet plus a hand list. I read the words that are new relative to v2 once; first names, places and demonyms I missed may remain.
- Adverbs fell to 87. I did not check why; likely the stop list plus -ly adverbs losing to their adjective in the family step.
- Vulgar flagging: `flagged-v2-full.tsv` has 61 words (the allow-listed words, anatomical terms, mild insults and a few others, kept on purpose).

## After the Haiku review

The same Haiku-driven changes described at the end of `report-v2.md` apply to this list (UK spellings, about 220 hand removals, 13 slurs, 11 stop words, and the 61-pair `families-extra-en.txt`, which dropped 53 words here). The replacements that came in afterwards have not been read by anyone.

## Final review changes

The same final-review removals described in `report-v2.md` apply here (offensive terms, UK spellings, clipped and non-English words, 41 person names).

Replacement words were screened as they arrived, and these were skipped: broncho, chirk, wedel, whacko, cony (plus the 17 words you picked out; see `report-v2.md`). `twofer` is kept on purpose.

The sensitive-term removals described in `report-v2.md` apply here too (aborigine, oriental, pansy, pouf, gringo, minge). Replacements skipped while screening: lockman, orientate, erst, floozy.

The vulgar-word removals described in `report-v2.md` apply here too (profane, excretory and sexual words that were not allow-listed).

The words you asked to restore (booger, damn, dung, fart, fetish, goddamn, piss, poop, prick, puke, turd, pussycat, lust) are back in play. In this list all of them are present except `prick`.
