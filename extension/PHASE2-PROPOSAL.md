# Phase 2 proposal: theme playlists or person playlists

*Draft, 16 October 2026. **Step 1 (rules) is now built; see HANDOFF.md. Step 2 (a language model) is not.** Requirement 18 of the brief: keep playlists about a theme or mood, hide playlists about a person. Propose a language model for the hard cases, but don't build one without asking.*

## Where we are

Stage 5 judges a playlist by its real title alone, using patterns (`HIDE_PLAYLIST_TITLES`): This Is…, … Radio, Best of…, …'s Picks, Top 50, Charts, and so on. On the search page for "justice" this caught "This Is Justice" and both "… Radio" playlists. It missed three:

- "Justice Mix"
- "Justice Remixes"
- user playlists named after the artist, like "UNDERTALE | Justice"

It also wrongly hides theme playlists that share a pattern, like "Chill Essentials". Every playlist that stays still shows a two-word stand-in instead of its title, so "rainy day" is as hidden as "This Is Justice".

## What unfamiliar sounds can see, without asking Spotify for anything

Everything below is already on the page that's open. Nothing new is fetched (brief: no private APIs, no scraping beyond the open page).

| Where | What it says about a playlist |
|---|---|
| Card | Real title. Real description, which on Spotify's own playlists usually names a few artists ("With Bailey Zimmerman, Tucker Wetmore, Jordan Davis and more"). Owner ("By Spotify"). |
| Playlist page | All of the above, plus every track row with its artists' IDs and real names. |
| Anywhere | unfamiliar sounds reads real text in the instant before replacing it, as stage 5 already does for titles. |

## Step 1: rules (no language model)

A playlist gets one of four verdicts: **person**, **popularity**, **theme**, or **unsure**. Each rule below gives its verdict, in this order; the first that applies decides.

1. **Title patterns** (what stage 5 has now), split into person and popularity. "This Is…", "… Radio", "Best of…" and "…'s Picks" mean **person**. "Top 50", "Viral 50", "Charts" and "Hot Hits" mean **popularity**. The ambiguous ones ("… Essentials", "… Mix") are no longer decided here.
2. **The title names one of the playlist's own artists**: **person**. The artist names come from the description on a card, or from the track rows on the playlist page. The check is a whole-phrase match, ignoring case. This catches "Justice Mix", "Justice Remixes" and "UNDERTALE | Justice", and lets "Chill Mix" and "Chill Essentials" through.
3. **One artist dominates the tracks**: **person**. That means the most frequent artist is on at least half of the tracks, with at least 8 tracks seen. Only possible on the playlist page, where the rows are visible. This catches discography-style playlists whose title doesn't name anyone.
4. **The description reads as being about a person**: **person**. Patterns like "This is …", "the essential …", "… biggest hits", "picked by …", "… greatest".
5. **A match on a weak word**: **unsure**. If rule 2 matched only because an artist's name is a single common word ("Justice", "Low", "Yes", "Fever"), the verdict is unsure rather than person. One check: is the name in the unfamiliar sounds word list or a short list of very common words?
6. **Everything else**: **theme**.

**What each verdict does:**
- **Person and popularity:** the card is hidden and the page shows the notice, as now.
- **Theme:** shown, with its **real title** (see question 1) and a generated cover.
- **Unsure:** hidden (fail closed) until something better decides.

**Verdicts are remembered** by playlist ID in `storage.local`, so a playlist judged on its page stays judged on every card. Only the ID and the verdict are stored, never a title or a name.

**Before choosing a model, measure.** Add a temporary counter of how many playlists land in each verdict while you browse normally. If "unsure" is rare, a language model isn't worth its cost or its privacy questions.

## Step 2: a language model for "unsure" (only if step 1 leaves too many)

**What it would be asked.** One short request per playlist, never repeated, because the answer is cached by playlist ID:

> Classify this Spotify playlist as **theme** (a mood, activity, genre, scene or idea), **person** (built around one artist, band or public figure, including their mixes, radios and essentials) or **popularity** (charts, top lists, most-played).
> Title: "…". Description: "…". Owner: Spotify / a user. Most frequent artists: A (12 tracks), B (3), C (2).
> Reply with JSON: `{"verdict": "...", "confident": true|false}`.

A reply that isn't confident counts as unsure and stays hidden.

**Three ways to run it**, in the order I'd suggest:

| Option | How it works | Network | Notes |
|---|---|---|---|
| **A. Local model in Firefox** | Firefox has an experimental API that lets an extension run a small model on the computer, with no network. *I haven't checked its current state or which models it allows; I'd verify before relying on it.* | None | Most private. The download is large, quality is unknown on short titles, and it may need Nightly or a flag. |
| **B. Small cloud model, opt-in** | A small, fast Claude model (Haiku class) through the Anthropic API, with an API key you paste into the settings page. Only for "unsure" playlists, batched, and cached forever by ID. | Yes: title, description, owner and top artist names of the unsure playlists | Best quality for little effort. It needs a second switch in settings, off by default. The request reveals which playlists you look at; the key and the unfamiliar sounds secret never leave the browser except in that one request header. I'd check current pricing before building. |
| **C. Stay with rules** | Unsure stays hidden. | None | Simplest. Some theme playlists will be invisible. |

**Not proposed:** precomputing verdicts for Spotify's editorial playlists ahead of time. It would mean collecting data from Spotify beyond the open page.

## Questions for Violet

1. **Real titles for theme playlists?** The point of keeping "internet crush" is to read it, so I'd show the real title (but keep the generated cover). The catch: a playlist wrongly judged theme would show a real title, perhaps a name. I recommend real titles, given rules 2 and 5 and the fail-closed unsure verdict.
2. **Unsure: hide or show?** I recommend hide.
3. **A model at all, and if so, A, B or C?** I recommend measuring first (the counter in step 1), then deciding.
4. **Who checks the verdicts?** A check needs someone to read real titles next to verdicts, which would spoil the experiment for you. Yerin could review a sample from a "review mode" that is only on in a separate Firefox profile.

## Size of the work

- **Step 1** is about a day: new rules in `selectors.js`, reading descriptions and track-row artists in `unfamiliar.js`, a verdict store, and unit tests for the rules on sample titles. Then a check on real pages like the earlier stages.
- **Step 2, option B** is about another day: settings switch, key handling, request and caching, failure handling. **Option A** depends on what the Firefox API turns out to support.
