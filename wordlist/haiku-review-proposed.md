# Haiku review: proposed changes (nothing applied)

Four Haiku reviewers each read half of `wordlist_v2.tsv` and `wordlist_v2-full.tsv` (about 700 flags). This file keeps the flags I judge clear. Words flagged but not listed here need your decision; see the end.

## UK spellings and spelling variants (add to uk-spelling-en.txt; US form wins) (60)

baulk camomile cognisant enquiry [v2] draughty louvre moulder mouldy nett odourless pedlar phial pitta rateable wilfully phoney sepulchre serjeant soya [full] storeyed sulphide tabu kail karat kasbah kabob kaftan fiord fuze carrousel eyrie banister bannister briony brier harken manilla veldt vertu teepee tiro riband shew swart aline aether faerie ebon cristal pacha silvan naif dickey dickie gramma goodby whacky ikon phantasy therefor

## Misspellings and non-words (add to remove-list-en.txt) (24)

lense miniscule pallette racoon rubel ratan sherbert fuschia camelia icecream cocoanut allgood airforce parttime taichi ology lazuli chon kwai proto pseudo prox inst alright [full]

## Slurs and demeaning terms (add to slur-supplement-v2-en.txt) (13)

fagot hymie greaser blackface mammy spick welch papist popish redbone slapper [v2] wench hadji

## Clipped forms (you said drop clips; add to remove-list-en.txt) (74)

beaut biotech brolly budgie camo chimp civvies condo [v2] cuppa deco detox fella frat gator gramps gran grad jammies klick lech mayo mag matric maxi medevac orang [v2] pecs perm pharma prefab prelim preemie psyop psycho quin quint recce rhino [v2] soph spec strep synchro tach telco telly toon trad trike veg ammo aggro bra [full] cabby coco combo [full] corp [full] hippo hypo kilo lite [v2] lolly lube meth mini [full] narc neocon obit oleo postdoc prom [full] roomie [full] semi [full] servo sub [full]

## Interjections, Latin function words, abbreviations (add to stop-words-en.txt) (11)

cheerio ciao adios nay ooh vroom passim sic non [full] lidar maglev

## Foreign words that are not English loans (add to remove-list-en.txt) (45)

agua blanc bleu boeuf bonheur dinero fils finis folie lapin manana magnifico nihil pallone paseo plage poulet porta prima primo secondo selva signor signora ultima ultimo pilar musculus reductio sapiens morgen llano olla outre pestis pontifex mouton liman ligne campana arcus claro feria gamba glace

## Personal names, characters, brands, places (add to remove-list-en.txt) (62)

andromeda argus daphne dulcinea baldrick bismark columbo coruscant cicero hotspur jezebel jonah kylie inga maxwell milo mollie marcel phoebe tammy toby telfer taira osmund rydberg pascal yagi vanda lulu erica cassie cole [full] edda eros angostura airbus [full] amazon [full] ironman marmite novocaine primus saran sharpie tannoy ritz peavey argentine balmoral champaign cordoba cyprian islay klondike malacca muscovite provencal saskatoon silesia tripoli tyrolean ulster curacao

## Same-family pairs Haiku found (add to a pair file; the pipeline keeps the more frequent word) (32)

laxity/lax leafless/leaf legalese/legal legionary/legion louden/loud loyalty/loyal moisten/moist naivety/naive notoriety/notorious nutrition/nutrient quieten/quiet slacken/slack sower/sow synonymy/synonym techie/tech veggie/veg uttermost/utmost whiteness/whiten anarchism/anarchy jingoism/jingo detoxify/detox augury/augur liaise/liaison brunet/brunette grieve/grievance pendent/pendant waggoner/wagoner rajah/raja peavy/peavey junto/junta jadeite/jade jessamine/jasmine

## Not proposed (your call)

- **Vulgar** (on hold, see `flagged-*.tsv`): arse, arsehole, bollocks, bugger, wanker, fucker, dildo, fellatio, boner, douche, fart, poop, puke, turd, putz, minge, shite, smut, slut, porno, raper, sext, fanny, pederasty, sodom.
- **Slurs or touchy, but ambiguous:** oriental, redneck, pansy (also a flower), ponce, commie, papoose, aborigine, brit, cockney, queer (you chose to keep it), dickens.
- **Obscure, archaic, dialect (about 200 words):** e.g. abed, asea, bairn, brae, doss, fain, furze, lief, mickle, morn, troth, twain, victuals, wight, withal, wroth. Real dictionary words, so I did not propose removing them.
- **Foreign loans that are used in English:** shogun, sadhu, shofar, samsara, seppuku, rooibos, kraal, wadi, zakat and similar. Kept.
- **Wrong part-of-speech tags** (cosmetic): madrigal, manly, renege, hibachi, punky. Not a list problem.
- **Haiku errors:** it reported `desultory` twice (it appears once) and flagged `queer` and several breed names. Treat its flags as hints, not facts.
