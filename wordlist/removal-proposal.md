# Proposed removals (pending approval, nothing removed yet)

Found by reading all 10,000 words in `wordlist.tsv`, then checked against the list.

## 1. Abbreviations, acronyms, units and clipped forms

bbl, bbs, bpm, bps, ccc, cps, khz, mcg, nth, pct, rpm, tsk, rbi, otc, ult, mrna, lev, lux, mol, pix, expo, fab, rad, temp, vac, sis, bod, deli, dorm, limo, lino, maths, typo, mono, diss, cert, cred, xii, xiii, xiv, xvi, xvii, xviii, xix, xxi, xxiii, viii

Notes: the roman numerals and units are not words. Clipped forms such as `temp`, `deli`, `dorm`, `limo`, `typo` are real English words, so they are included only if you want clipped forms gone too.

## 2. Brand names

ipod, xerox, jeep, dell, velcro, macintosh, fiat, tesla, fuji, cisco, siemens, chevy, coca

## 3. Alternate spellings (one spelling of each pair removed; choose which side below)

| Pair | Variant |
|---|---|
| civilised / civilized | civilised |
| authorise / authorize | authorise |
| baptised / baptized | baptised |
| coloring / colouring | colouring |
| cosy / cozy | cosy |
| diarrhea / diarrhoea | diarrhoea |
| endeavor / endeavour | endeavour |
| enquire / inquire | enquire |
| enquirer / inquirer | enquirer |
| equaliser / equalizer | equaliser |
| fervor / fervour | fervour |
| fetus / foetus | foetus |
| analog / analogue | analogue |
| armored / armoured | armoured |
| laborer / labourer | labourer |
| leukemia / leukaemia | leukaemia |
| liter / litre | litre |
| localized / localised | localised |
| lustre / luster | lustre |
| maneuver / manoeuvre | manoeuvre |
| modeled / modelling | modelling |
| mold / mould | mould |
| molding / moulding | moulding |
| mustache / moustache | moustache |
| odor / odour | odour |
| organizer / organiser | organiser |
| parlor / parlour | parlour |
| plow / plough | plough |
| plowed / ploughed | ploughed |
| plowing / ploughing | ploughing |
| rumor / rumour | rumour |
| saber / sabre | sabre |
| savior / saviour | saviour |
| savor / savour | savour |
| savory / savoury | savoury |
| specter / spectre | spectre |
| sceptical / skeptical | sceptical |
| sizable / sizeable | sizeable |
| skillful / skilful | skilful |
| somber / sombre | sombre |
| splendor / splendour | splendour |
| sulfur / sulphur | sulphur |
| traveler / traveller | traveller |
| utilize / utilise | utilise |
| valor / valour | valour |
| vapor / vapour | vapour |
| vigor / vigour | vigour |
| willful / wilful | wilful |
| yogurt / yoghurt | yoghurt |
| kilometer / kilometre | kilometre |
| chili / chilli | chilli |
| jeweler / jewellery | jewellery (mixed spelling of one word family; US spelling kept if the list is US) |
| flavoring / flavour | flavour (mixed: US `flavoring` and UK `flavour` are both present) |

Pairs I found to be different words, not spellings, and so not listed: enrolment / enroll, mold / molding (kept as one pair, see above), armour / armory, gaol / jail.

## 4. Inflected forms whose base is already in the list (participles, plurals, -ing, -er)

Step 3 used WordNet's base-form check, but WordNet lists many participles as adjectives, so these got through.

Automatic check: 815 words end in an inflection and have their base in the list. Many are correct matches (`awakened` of `awaken`, `amused` of `amuse`), but the check also matches different words (`alas`/`ala`, `beaker`/`beak`, `blazer`/`blaze`, `binder`/`bind`, `aerobics`/`aerobic`). The full automatic list is in `removal-candidates.md`. I have not approved any of it.

## 5. Word families sharing a stem (not proposed for removal)

946 stem groups hold 2,068 words, e.g. `adore`, `adored`, `adoring`, `adoration`; `obscene`, `obscenity`; `abolish`, `abolition`. Removing derived forms would be a policy choice (keep the noun? the adjective?), so I list them in `removal-candidates.md` for you to decide. I would not remove derivations automatically.
