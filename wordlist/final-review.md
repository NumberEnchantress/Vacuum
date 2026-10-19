# Final pass: items that need your decision

Status: sections 1 (group A) and 2 (person names) have since been applied and both lists rebuilt (now v2 SHA `7296329b…`, v2-full SHA `d4610605…` after your later reviews). Sections 3 to 5 are still open. The text below describes the lists as they were when I checked them (`daf6ebe2…` and `49ead58f…`).

## 1. The 295 / 310 words that replaced the Haiku removals

Run through every automated rule (inflection, UK spelling, removal lists, slur and vulgar lists, affix and stem families, short-form glosses, capitalised WordNet lemmas). Only 5 words per list tripped any rule, so the rules themselves are holding. I then read the new words by eye. About 11% were still problems the rules cannot see:

| Group | Words (in both lists unless marked) |
|---|---|
| A1 offensive or sexual | polack, negroid, homo, sodomite, popery, strumpet, imbecilic, orgiastic, shyster |
| A2 UK or variant spelling | caff, caecum, waggon, tzar, hadj, jiujitsu, dextrous, flypast, landslip, unpick, ploughman, ghillie, medivac (full only) |
| A3 clipped | staph; disco, undergrad, linac, techy (full only); gent (v2 only, an older word) |
| A4 not English | lycee, echt, valse, vivace, coquille, kroon, tenge; loti, ritonavir, stet (full only) |

My recommendation is to remove all of group A. Expect about 10% of the replacements to be junk again, so one more short review of the replacements is needed after that. Then freeze.

## 2. Person names still in the lists

Surnames, given names and characters that only look like ordinary words (the name check cannot tell): degas, hogg, lambert, lauder, sulla, sully, tallis, balboa, burnside, flinders, heller, kern, landau, muller, munch, parr, pitman, stein, weber, whitehead, fermi, curie, garibaldi, jacquard, vandyke, bunsen, vernier, roentgen, pollock, dickens, becket, banting, bolivar, adonis, goliath. v2 also has lister, mailer, skinner, spender, wheeler, whistler. Units named after people (hertz, joule, watt, kelvin) I would keep as ordinary nouns.

## 3. Sensitive terms (decided: aborigine, oriental, pansy, pouf, gringo, minge removed; the rest kept)

WordNet marks a sense of each of these as offensive or derogatory:
dike, gringo, hillbilly, oriental, paddy, pansy, pouf, spade, cockney, brit, aborigine, mongrel, minge; v2-full also guinea and fairy. `queer` is kept per your instruction.

## 4. Vulgar words (decided: allow-listed words stay; other profane, excretory and sexual words removed)

`flagged-v2.tsv` now lists 62 words and `flagged-v2-full.tsv` 61 (some earlier removals were put back at your request). About half come from your v1 allow-list and stay: arsehole, boner, dildo, fellatio, orgasm, orgy, porno, slut, smut, spunk, threesome and others. The rest are anatomical terms, sex-work terms and mild insults.

## 5. Things that affect the next step

- **Part-of-speech tags are guesses for most words.** 6,678 of 10,000 words in v2 (and 6,051 in v2-full) have no WordNet usage counts, so their tag comes from word endings or WordNet's first sense. If the next step builds "Adjective Noun" names, some will be wrong (earlier examples: madrigal tagged verb, manly tagged adverb). Adjectives are 16% and 15% of the lists; adverbs are 191 and only 68.
- **Derived forms stay when their base is not in the list.** In v2 the base words were skipped, so deepness, redesign, unsafe and similar remain. That follows the rule, but it may not be what you meant.
- **Rare words remain** (puka, sugi, bosc, baya, capiz, panga). I left obscure words alone.
- **Licences.** The wordfreq package metadata says its data is under CC BY-SA 4.0, so the frequency order carries attribution and share-alike terms. I have not checked the LDNOOBW licence. GloVe 6B is described by Stanford as public domain (PDDL), which I have not re-checked.
- **Reproducibility inputs.** wordfreq 3.1.1, NLTK 3.10.3, WordNet 3.0, numpy 2.5.4. GloVe `glove.6B.300d.txt` has SHA-256 `91125602f730fea7ca768736c6f442e668b49db095682bf2aad375db061c21ed`. There is no `requirements.txt` or README yet; scikit-learn was installed but is not used.
- **Integrity checks passed** for both lists: 10,000 lines, no duplicates, sorted, all a-z 3 to 9 letters, valid tags, checksums match, v1 untouched.
