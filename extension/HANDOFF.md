# unfamiliar sounds handoff notes

## Decisions so far (16 October 2026)

- Word list: `wordlist_v2-full.tsv`, frozen, label `v2-full`, SHA-256 `d4610605d28ebcc8efe24548b2cc38044618ee2f9147cafe6dbea770d6ebd0ab`. Checked: 10,000 lines, LF endings, sorted, no duplicates, all a–z 3–9 letters. Tags: noun 6,988, adj 1,552, verb 1,392, adv 68.
- Word order: option A (any words from the whole list). Option B will still be a one-line setting.
- Code lives here, in `unfamiliar sounds/extension/`.

## Stage 1: the switch and the container (done)

**What works** (tested in Firefox 157 with a temporary install):

- The toolbar button (grey rings when off, coloured rings when on) and `Alt+Shift+D` switch unfamiliar sounds on and off. The settings page has the same switch. The stored value in `storage.local` is the switch, and the background follows it.
- Switching on creates the "unfamiliar sounds" container (purple, fence icon) if it is missing and reopens any Spotify tabs already open into it.
- While on, opening `open.spotify.com` anywhere outside the container (a typed URL, a new tab, a link on another site) reopens it inside unfamiliar sounds. If the tab was on another site, that tab stays where it was and Spotify opens next to it. A blank or Spotify tab is replaced.
- The content script is registered only while on, and only for the unfamiliar sounds container (`contentScripts.register` with `cookieStoreId`). When off it is not injected at all. That covers requirement 3 by construction, not by an early return.
- Switching off stops redirecting, leaves every tab open, and tells running content scripts to stop. Reloading a unfamiliar sounds tab after switching off showed that the script no longer runs.

**Not tested yet:**

- Persistence across a browser restart. The code reads the stored state on startup, but a temporary add-on is removed when Firefox closes. To test this, the extension has to be installed in Developer Edition or Nightly with `xpinstall.signatures.required` set to false. Release Firefox only accepts signed add-ons, and signing means uploading to Mozilla, so I need to ask first.
- Private windows. They are skipped on purpose, because containers don't exist there.
- Deleting the unfamiliar sounds container while switched on. The code recreates it on next use.

**Unsure about:**

- (Resolved in stage 3: switching off now reloads unfamiliar sounds tabs so the real page comes back.)
- Manifest V2 was chosen because `contentScripts.register` with a container filter needs a persistent background page. Firefox still fully supports MV2.

## Stage 2: the derivation core (done; palette p16 approved)

**Files:** `core/derive.js` (plain script; runs in the extension and in Node), `data/wordlist_v2-full.tsv` (byte-identical copy), `test/derive.test.js` and `test/vectors.json`, `tools/reference.py`, `tools/colorcheck.mjs`, `tools/palette.mjs`, `tools/palette-sample.mjs`, `core/pictures.js` (a draft renderer for the sample), and `review/palette-sample.html`.

**How it derives.** `digest = HMAC-SHA-256(key, type + ":" + id)`. Bytes 0–15 become one big integer, and successive remainders mod the list length pick the words. Bytes 16–31 become a second big integer that picks the picture. Splitting the digest in two is my one change to requirement 12. It means changing the word order (`WORD_ORDER`, one line) never changes a picture. Types: `track`, `album`, `playlist`, `artist`. IDs must match `^[0-9A-Za-z]{22}$`, and anything else throws, so the page code can hide what it can't identify.

**Word list pinning.** `loadWordlist` hashes the exact bytes and refuses to run unless they match `v2-full` / `d4610605…`.

**Pictures (values only, drawn in stage 4).**
- Cover: 4 squares. Each has a background color, a shape color, one of 8 shapes, and a quarter turn.
- Artist: 8 rings, outermost first, plus one of 4 width profiles.
- A shape color, or a ring next to another ring, can only be a color from `CONTRAST[background]`. That means at least ΔE 20 apart under normal vision and simulated protanopia, deuteranopia and tritanopia (Machado 2009, CIEDE2000).

**Key.** On first run the background generates 32 random bytes and stores them as 64 hex characters in `storage.local`. The settings page shows, copies, saves, and imports the key, and the import accepts a whole saved file. It also shows a "key check" name, so two browsers can confirm they share a key without showing the key itself.

**Tests:** `node --test test/`. 16 tests, all passing. They check:
- the checksum, and refusal to run on a tampered list
- known answers from an independent Python implementation (`python tools/reference.py > test/vectors.json`)
- determinism, and different outputs for different types and keys
- that word order leaves pictures alone
- that pattern order picks the right parts of speech
- over 2,000 IDs: no color index outside the palette, and neighbours always contrasting
- key round-trips and rejection of bad input

**Checked in a browser:** the settings page, run behind a stand-in for the `browser` API. Its key-check names match the Python reference for both keys tried. **Not checked** inside the real installed extension: the Firefox test harness can't open `moz-extension://` pages.

**Palette: p16, approved by Violet on 16 October 2026.** It is written into the core (`tools/palette.mjs apply p16`). The sample page compares the three proposals:

| Proposal | Worst pair ΔE | Covers | Artist pictures |
|---|---|---|---|
| p16 (approved): Tol / Okabe-Ito colors with orange, vermilion and yellow | 9.5 | 7.6 × 10¹⁴ | 8.9 × 10⁸ |
| p12: fewer colors, more separation | 11.5 | 9.7 × 10¹³ | 1.2 × 10⁸ |
| p16opt: numerically optimised, muddier | 15.5 | 8.4 × 10¹⁴ | 1.0 × 10⁹ |

Changing the palette means `node tools/palette.mjs apply <name>`, then `python tools/reference.py > test/vectors.json`, then `node tools/palette-sample.mjs`.

**Unsure about:**
- With about 10M artists and 8.9 × 10⁸ ring pictures, about 1% of artists share a picture with someone. Their 3-word names still differ. That is why I added the width profiles (×4).
- Option A names include verbs and odd pairings ("Squander Chaise Attune"). That is expected for option A.

## Stage 3: name replacement with no flash (done for logged-out pages)

**Files:** `content/selectors.js` (every page-structure fact in one place), `content/unfamiliar.css`, `content/unfamiliar.js`, `tools/leakcheck.mjs`; the background now derives names for the content script.

**How it works.**
- **Before ready.** `unfamiliar.css` keeps the page transparent until the content script has confirmed with the background (key and word list checksum). If that fails, the page stays hidden and shows the reason.
- **After ready.** A MutationObserver fixes every change in its callback, which runs before the browser paints. Each text node is handled in one of three ways:
  - **Name slots get the stand-in name.** These are links to `/track|album|artist|playlist/<id>`, card titles (their `id` says the real entity), the page header and the sticky top bar (entity taken from the URL). A link to `/album/…?highlight=spotify:track:<id>` is named after the song.
  - **Known-safe zones are left alone:** nav bar, footer, player buttons, genre links.
  - **Everything else is blanked** unless it is plainly not a name (`SAFE_PATTERNS` / `SAFE_PHRASES`: short numbers, durations, dates, UI labels). This is the fail-closed rule.
- **Names not derived yet** stay blank until the background answers. Requests go in batches.
- **Text is edited in place** (`nodeValue`), so React keeps working.
- **Tooltips:** `title` attributes become the stand-in name or are removed.
- **Tab title:** every `<title>` in the head becomes "Stand-in Name · Spotify", or "Spotify". Spotify inserts the next page's `<title>` before removing the old one, so all of them are fixed.
- **Media session** (system media overlay): the page's `navigator.mediaSession.metadata` setter is replaced. Whatever Spotify sets becomes stand-in title and artist, no album, no artwork.
- **Switching off or changing the key** reloads unfamiliar sounds tabs.

**Why derivation moved to the background.** In a Firefox content script, Web Crypto results come back through cross-compartment wrappers and can't be read ("Permission denied to access property constructor"). The background page derives instead. As a bonus, the key never enters the Spotify page's process.

**Checked on real pages** (Firefox 157, logged out): home, an album, an artist, a playlist, search ("justice") and a song.
- **Off and on captures.** `node tools/leakcheck.mjs <folder>` compared the visible text and tooltips of each page with unfamiliar sounds off and on. The only shared text left is genre and browse-category names (shown on purpose) plus allow-listed UI. No song, album, artist or playlist name was found.
- **Navigation watch.** A page-side MutationObserver ran right after unfamiliar sounds', through in-app navigation home → album → artist → playlist → song. No real name was ever present in text, tooltips or `<title>` once unfamiliar sounds' observer had run. That watch found the two `<title>` leaks, which are now fixed.
- **Off again.** Switching off reloaded the tab and showed real Spotify, with no unfamiliar sounds markers.
- **Media session.** Metadata set by the page came back blank.

**Not checked (needs a signed-in account; I won't sign in):**
- the now-playing bar, the queue, the Your Library sidebar, context menus, lyrics
- the media session with real playback

These are covered by the general rules (entity links, fail-closed text), but nobody has looked. The selectors for the now-playing bar (`NOW_PLAYING*`) are from Spotify's known markup, not observed here.

**Known gaps and choices:**
- **Images are still real** (stage 4), and cover art often contains the title or artist name as text.
- **Blank headings.** Section headings that aren't allow-listed are blanked ("Trending songs", "Popular artists", "Featuring …"). Fail closed, but the page has blank headings. Stage 5 decides what to hide properly.
- **Artist pages** show stand-in names; bio, monthly listeners, concerts and "Artist pick" text are blanked. The page itself is still there; stage 5 replaces it with a notice.
- **All playlist names are replaced,** including theme playlists. Phase 2 can let theme names through.
- **English UI only.** The allow-list is English. In another Spotify language, most labels would blank (safe, but ugly).
- **`aria-label`s still hold real names.** They aren't visible, but a screen reader would read them out.
- **Genre and browse-category links** are a safe zone. A category named after a person would show.

## Stage 4: covers and artist pictures (done for logged-out pages)

**How it works.**
- **Rendering.** The background renders each entity's picture (`core/pictures.js`) as an SVG `data:` URL and returns it with the name.
- **Outline.** Every picture has a thin light outline (Violet's decision, 16 October 2026): 1.5 screen px, white at 40%. Palette black otherwise vanishes into Spotify's background.
- **Default hidden.** `unfamiliar.css` makes every `<img>` invisible unless it carries `data-unfamiliar-img`. It also makes `<video>` and SVG `<image>` invisible, and strips inline background images (artist banners, header backdrops). The cookie banner is exempt.
- **Swapping in.** The content script sets `src` to the generated picture, removes `srcset`/`sizes`, sets `alt` to the stand-in name and marks the image. If React puts a real `src` back, the observer swaps it out again before the next paint. Images with no known entity stay hidden, and their `alt` (often the real name) is emptied.
- **Which picture an image gets** (`IMAGE_*` in `selectors.js`):
  - card → the card title's entity; a song card uses its album's cover
  - page header → the URL's entity; a song page uses its album
  - tracklist row, top search result, song-page artist card, now-playing bar → the first link to an album, then playlist, song, artist
- **Consistency.** A song shows its album's cover everywhere it can. Artist popular-track rows have no album link, so those songs get a cover from the song's own ID.
- **Switching on** now also reloads Spotify tabs already in the unfamiliar sounds container. You found you had to reload by hand. At browser startup these tabs aren't reloaded, because restored tabs load after the script is registered anyway.

**Checked on real pages** (logged out): home, album, artist, playlist, search, song.
- **Static check.** No visible image anywhere uses a real source. Only Spotify's generic grey placeholder graphic shows, which isn't identifying.
- **Navigation watch.** A page-side observer watched home → album → artist → playlist → song (98 batches of changes). After every batch, no marked image had a real `src` or `srcset`, no unmarked image was visible, and no `alt` held a real name.

**Not checked:**
- The switch-on reload fix, in the real toolbar flow.
- The now-playing cover, the queue and library thumbnails, and Spotify Canvas videos. These need a signed-in account; videos are hidden by CSS regardless.

**Hidden on purpose (fail closed):**
- podcasts, episodes, audiobooks, user profiles and genre cards (not unfamiliar sounds entity types)
- the artist-page "artist pick" image and "about" photo
- one artist image on song pages that isn't inside a recognised container

**Unsure about:**
- An inline `background-image` with `!important` would beat the CSS rule. None seen.
- Album art that Spotify draws through stylesheets rather than inline styles or `<img>` would get through. None seen.

## Stage 5: hiding people and popularity (done for logged-out pages)

**Decision (Violet, 16 October 2026):** artist pages show their releases, unranked. That means the stand-in name, then the Discography shelf, switched from "Popular releases" to "Albums" (by date). Everything else on the page is hidden.

**Rules** (all in `content/selectors.js`):
- **Shelves** (`section[data-testid="component-shelf"]`) are hidden by their "Show all" link:
  - `/artist/<id>/featuring|discovered-on|playlists|related|appears-on|concerts`
  - `/artist/<id>/discography` on any page except that artist's own
- **Shelves are also hidden by their real heading** (`aria-label`, `HIDE_HEADINGS`): Trending…, Popular…, Featured Charts, Top…, Featuring…, Fans also like, More by…, Appears on, Discovered on, Artist playlists, Artist pick, On tour. This covers "More by …" on album pages, the home page's popularity shelves, and "Featuring …" in search.
- **"Popular tracks" lists** (artist and song pages) are hidden with their heading and "See more".
- **Artist pages** keep only the header and their own Discography shelf. "Popular releases" is hidden and "Albums" is clicked once; the shelf stays hidden until that has happened. The shelf's "Show all" link is hidden too.
- **Playlists** are judged by their real title, read just before it is replaced (`HIDE_PLAYLIST_TITLES`): This Is…, … Radio, Best of…, …'s Picks, … Essentials, … Deep Cuts, Top 50/Hits/Songs, Viral 50, Charts, Hot Hits, Hot 100. Their cards are hidden; their pages show the notice.
- **Pages replaced by a notice** ("unfamiliar sounds hides this page: it is about a person, or about popularity."):
  - artist sub-pages: discography, related, featuring, appears-on, discovered-on, playlists, concerts
  - concert pages
  - playlists judged as above
  - any page whose real `<h1>` matches `HIDE_HEADINGS`
- **Counts** (play counts, monthly listeners, followers, saves) were already blanked by stage 3's fail-closed text rule. Stage 3's number pattern only allows up to 4 digits and no thousands separators.

**Checked** (logged out):
- **Artist page:** only header and Discography (Albums) are visible.
- **Song page:** popular tracks and every discography shelf are hidden; Recommended stays.
- **Album page:** "More by" is hidden.
- **Home page:** all five popularity shelves are hidden.
- **Search:** "Featuring …" is hidden; the This Is and Radio cards are hidden.
- **Notices:** the discography page and "Today's Top Hits" show the notice.
- **Navigation watch** (home → album → artist → album → song, 80 batches): no hidden shelf, popular list or ranked chip was ever visible after unfamiliar sounds' observer ran.

**Known gaps:**
- **The logged-out home page is now empty.** Every shelf on it is a popularity list. Logged in, it should have "Made for you" and similar.
- **Title patterns miss some person-centred playlists:** "Justice Mix", user playlists named after an artist, "Justice Remixes". Phase 2 (playlist artists, perhaps a language model) is the real fix. They also hide some theme playlists that share a form, such as "Chill Essentials".
- **English only.** Headings, chip labels and the `popular tracks` aria-label are matched in English.
- **The sticky top bar** above a hidden page still shows the stand-in name and a play button.
- **Untested logged-in parts:** Your Library, the queue, the now-playing view (which has its own artist "About" card), and lyrics.
- **`aria-label`s** on shelves and buttons still hold real names. They aren't visible.

## Phase 2, step 1: theme or person playlists, by rules (done)

**Built as proposed in `PHASE2-PROPOSAL.md`.** Rules only; no language model and no network.
- **Rules:** `core/collections.js`, a pure module with tests in `test/collections.test.js`.
- **Evidence** is collected by `content/unfamiliar.js`. It is the real text the content script sees just before replacing it: a playlist's title, its description (card subtitle or page header), the artists on its track rows, and every artist name seen this session. All of it is kept in memory only.
- **Verdicts:**
  - **person, popularity or unsure:** card hidden, page shows the notice
  - **theme:** shown. A theme playlist owned by Spotify (ID starts `37i9dQZF1`) shows its **real title**; a user's theme playlist keeps a stand-in. Covers are always generated.
- **Rule 5, simplified:** a title that matches a one-word artist name is "unsure" rather than "person". Both hide the playlist, so no word list is needed. As a result, the "justice" search hides every playlist, including "Social Justice …"-style titles.
- **Verdict store:** `storage.local` key `playlistVerdicts`, playlist ID → verdict, written by the background. It never holds titles or names. Person and popularity verdicts stick, so a playlist judged on its page (for example by rule 3, one artist dominating) stays hidden on cards. The stage 5 title list (`HIDE_PLAYLIST_TITLES`) is gone; its patterns live on as rule 1.
- **TEMPORARY counter:** the settings page counts verdicts since the last reset, with a Reset button. Remove it once the "unsure" rate is known.

**Checked** (logged out, Firefox):
- **Search "justice":** every playlist is hidden. This Is and Radio by rule 1; "Justice Mix", "UNDERTALE | Justice" and the user playlists called "Justice" as unsure. The stage 5 patterns had missed "Justice Mix" and the user playlists.
- **Search "rainy day" (first 20):** all theme and shown. Spotify's ("Rainy Day Mix", "Rain Sounds", "Rainy Day Jazz", "twilight vibes") show real titles; user playlists show stand-ins. All covers are generated.
- **Pages:** "Rainy Day Jazz" is shown with its real title (and tab title) and stand-in tracks. "Today's Top Hits" (popularity) and "Justice Mix" show the notice.
- **Leak check:** on search, unchanged; no song, album or artist names.
- `node --test test/`: 26 tests pass.

**Not checked:**
- **The counter.** It's written by the background and shown on the settings page; I can't open extension pages from the test harness. Violet: about:addons → unfamiliar sounds → Preferences.
- **Rule 3 (one artist dominates) on a real page.** It is unit-tested only. I didn't find a page where it alone decides.

**Known gaps:**
- **Session names inflate "unsure".** After visiting a page about an artist with a common-word name, theme playlists using that word stay hidden for the rest of the visit.
- **A theme verdict can flip later.** If a theme playlist's page later shows one artist dominating, it flips to person and is hidden. For a moment its real title (Spotify playlists only) was visible. That title had passed rules 1, 2 and 4, so it shouldn't name anyone, unless it names someone unfamiliar sounds hasn't seen.
- **English patterns only.**

## Next

- Watch the counter for a while. If "unsure" is common, decide on step 2: local model, opt-in cloud model, or none (see the proposal).
- The logged-in parts (now-playing, queue, library) still need a check by Violet in her own Firefox.

## 17 October 2026: changes after Violet's first signed-in test

**What Violet found:**
- The same song showed two different stand-ins (playlist vs play bar). Spotify had used two IDs for one recording on two releases.
- Device names and button tooltips were blank.
- Playback had no sound.
- Artist bios were word-list garble.
- The Library sidebar was blank.
- The generated pictures looked samey.

**Decisions (Violet):**
- Stand-ins come from the displayed name, not the ID.
- Pictures come from public-domain artworks (Art Institute of Chicago).
- Bios show "???" by default; a setting shows them with known names swapped.
- She signed in herself in the test window so pages could be checked logged in.

**Changes:**
- **Names keyed by displayed text.** `HMAC(key, type + ":" + normalizeName(name))`, where `normalizeName` is NFC, collapsed whitespace, trimmed, lower case. The same title gets the same stand-in everywhere, whichever ID Spotify uses. Same-titled songs by different artists now share a stand-in, as do different artists with the same name. This changes requirement 7 ("ID" becomes "displayed name"); the Python reference and the vectors are updated to match. New type `user` (playlist owners, profiles).
- **Translated once per name.** The content script caches real name → stand-in per page; the background caches derivations. Twenty appearances of an artist cost one derivation. The content script also remembers each text node's real value, so the real name behind a slot can be re-read after it was replaced (memory only).
- **Interface text.** Tooltips, menus, buttons, chips and the devices panel show their real text, with any name unfamiliar sounds knows swapped for its stand-in. If a name is still being derived, the text is blank until it arrives.
- **Descriptions** (artist bios, playlist descriptions): "???" by default. With the setting on, artist links are translated and other known names swapped.
- **Card subtitles** listing artists ("With A, B and more") are translated. Their links are artist names, even when they link to an artist's mix playlist.
- **Library sidebar:**
  - **Titles:** read from `listrow-title-spotify:<type>:…` ids.
  - **Subtitles:** "Album • A, B" and "Playlist • owner" are translated; song counts are kept.
  - **Your folders and Liked Songs:** their names are shown as written.
- **Pictures are keyed by the name shown next to them.** A song's picture follows its title. Collections (Liked Songs) get a generated cover, because Spotify shows mosaics of real covers there.
- **Real titles of theme playlists** are now behind a setting, **off by default**. On the signed-in home page, titles like "Mixtape #4 <artist>" named artists unfamiliar sounds had never seen.
- **Performance:** batches of changes that only touch safe zones (the progress bar, the clock) are skipped.
- **Switching on** reloads Spotify tabs already in the container.

**Playback ("plays, no sound"):** not reproducible in the test profile, which can't play at all because its DRM (Widevine) check never answers. The likely cause in Violet's Firefox was Spotify Connect playing on another device, hidden by the blank devices panel, which now shows device names. To confirm in her own Firefox.

**Checked** (signed in, test profile):
- On the home page, every visible text is a stand-in, interface text, or Violet's own folder names. The first check found real artist names in mix-card subtitles and a promo header; both are fixed.
- No real images.
- Tooltips ("Queue", "Connect to a device") and the devices panel are readable.
- A playlist page shows a stand-in title, "???" description and stand-in tracks.
- 27 unit tests pass.

**Artworks: stopped (Violet, 17 October 2026).**
- **The build:** stopped part way (prints and drawings fetched, nothing saved). No list, checksum or review page exists, and the extension never requested an image from AIC.
- **The extension:** its AIC permission is removed, the Pictures option is gone from settings, and the default is generated pictures. The background's artwork handler returns nothing without touching the network, and the content script no longer asks for artworks.
- **Code left in place, inactive:** `core/artworks.js`, `tools/build_artworks.py`, and the swap-in path in `content/unfamiliar.js` and `background.js`. It could be reused for another picture source, or deleted.
- **Unchanged:** pictures are the generated covers and rings, which Violet found samey; that is still open. 27 tests pass.

## 17 October 2026, later: rename, your own things, opening and closing, search

**Rename.** The project is now **unfamiliar sounds**.
- Toolbar, settings page, container, notices and docs all use the new name.
- **In code:** `Unfamiliar…` globals, `data-unfamiliar-*` attributes, `unfamiliar:*` messages, and the files `content/unfamiliar.js` and `content/unfamiliar.css`.
- **Extension id:** `unfamiliar-sounds@violet.local`. This is a new add-on identity, so it starts with a new key; import an old saved key to keep the old names. Key import accepts files saved with the old "De-ID secret key" header.
- **Container:** an existing "De-ID" container is renamed, not replaced.
- **Left alone:** the brief and sketch in `recognizer/…/de-id-music/` still say De-ID; they are outside this folder.

**Settings added** (all checked in the test window unless marked):
- **Hide artist descriptions / Hide playlist descriptions:** both on by default ("???"). They replace the single "show descriptions" switch, and an old value is migrated.
- **Replace my own name and picture:** off by default. Your display name (the account button's label), your avatar, your profile links and "Playlist • you" stay as they are.
- **Change my own playlists:** off by default.
  - Your playlists keep their titles, descriptions and uploaded covers.
  - Only Spotify's automatic covers (album mosaic `mosaic.scdn.co`, or a single album cover `…/image/ab67616d…`) are replaced.
  - Your playlists are recognised from "Playlist • you" in the library and from the creator link on their pages. Their IDs are kept in `storage.local` "ownPlaylists".
- **Built-in collections** (Liked Songs, Local Files) keep their titles and covers. Not a setting.
- **Hide pages about a person or popularity:** on by default. The notice is now a real element over the page area, with a **Show anyway** button for that page until the tab reloads.
- **When switched off, keep its tabs open as normal tabs:** off by default. Switching off now closes the container's tabs. With the setting on, they reopen in the default context. The container itself stays, so its login is kept.
- **Ask how to open Spotify links:** off by default. While on, a Spotify link opened outside the container shows a small choice page: "With unfamiliar sounds" (new container tab) or "Normally" (in place). **Not checked in the window:** the harness can't open extension pages or flip settings.

**Search.**
- **How:** typing a stand-in now finds the real thing. The page's `fetch` is wrapped: for Spotify's own search requests (POST to `/pathfinder/`, operations `search…`), any stand-in in `variables.query` is swapped for the real name before sending. A query that is the start of exactly one known stand-in becomes that real name (as-you-type suggestions).
- **What you see:** the search box, the address and the results never show the real name.
- **What's stored:** a stand-in can only be reversed if its real name has been seen, so a stand-in → real-name table is kept in `storage.local` "reverseNames" (up to 20,000 entries, this computer only). It is the one place real names are stored.
- **Checked:** typing "Parse Hock Unroll" (the current stand-in for the artist Justice) searched "Justice" and showed its results as stand-ins. The word "Justice" appears nowhere on the page.
- **Note for the brief:** this changes requests the page already sends. It makes no requests of its own to Spotify's private API.

**Known gaps:** covers on the full discography page (`/artist/…/discography/all`) stay hidden, because that layout isn't recognised yet.

## 17 October 2026, evening: pictures from museums

**Decision (Violet):** covers and artist pictures come from The Met, the Art Institute of Chicago (AIC) and the Cleveland Museum of Art (CMA).
- Each picture is chosen by an exact-ID chain from her key, with the museum picked in proportion to its free images, plus a permanent local cache.
- Pictures are per-key: other people's keys give other pictures.
- Pictures are keyed by the Spotify ID of what they show, as on Spotify: a song shows its release's cover, so a list and the play bar can show different covers.
- No safety filtering for now. Smithsonian and NASA are left out.

**How it works:**
- **Pure module:** `core/museums.js`, with `test/museums.test.js`.
- **The chain:** for candidate n, `bytes = HMAC(key, "picture:<type>:<id>#<n>")`. Bytes 0–7 choose the museum by weight (Met 371,112 / AIC 59,063 / CMA 41,820 free images: about 79% / 12.5% / 9%). Bytes 8–15 choose an object ID in that museum's range (Met 1–900,000; AIC 1–288,000; CMA 90,000–180,000).
- **Usable:**
  - The Met: `isPublicDomain` and `primaryImageSmall`.
  - AIC: `is_public_domain` and `image_id` (IIIF, 400 px).
  - CMA: `share_license_status == "CC0"` and `images.web.url`.
- **Order:** the first usable candidate in chain order wins. After 40 candidates, the generated picture stays.
- **Background (`background.js`):**
  - **Chain:** walks it, looking up the next two Met/CMA candidates ahead in parallel but taking them in order. AIC candidates from all pending pictures share one queue, up to 100 IDs per request.
  - **Caches:** the pick (type:id → museum, object, image address, frame colours) is stored for good in `storage.local` "pictureCache", and the image file in Cache storage "unfamiliar-museum-images-v1". Pictures already seen show at once, identically.
  - **Rendering:** covers are cropped square; artist pictures are a round crop in a two-colour ring frame from the palette.
- **Pace:** the Met's bot protection refuses bursts (403) far below its documented 80 requests a second. So each museum has its own pace (Met: 2 at once, 250 ms apart; CMA 100 ms; AIC 1.1 s), and a 403/429 pauses that museum and retries.
- **Content script:** works out each image's Spotify ID (`pictureKey`). It shows the generated picture until the museum picture arrives, then swaps it; each picture comes back on its own. This also gives the discography page covers.
- **Settings:** Pictures: museums (default) or generated (offline). The settings page now stores only the switches you change, because an older full saved copy had frozen the picture source to "generated".
- **Permissions:** the museums' API and image hosts. Requests reveal only object numbers.

**Checked** (signed in, test window):
- **First visit to the home page:** about one new picture a second, limited by the Met's pace. Pictures appear one by one.
- **Determinism:** after a reload, all 30 museum pictures were back within 4 s and byte-identical.
- **No real Spotify images:** only the intended ones (your avatar, your playlists' uploaded covers, Liked Songs).
- **Tests:** 33 pass, including a new guard (`test/background.test.js`). Twice an edit had deleted a function from background.js; the guard fails if background.js calls something that isn't defined.

**Removed:** the old list-based AIC code (`core/artworks.js`, `tools/build_artworks.py`).

**Not done or not checked:**
- the "Ask how to open Spotify links" choice page (the harness can't open extension pages)
- pictures on artist pages and in the queue or now-playing view (not looked at)

## 18 October 2026: seed, placeholders, own picture lists, graded testing

**Seed instead of key (Violet).**
- **Default:** everyone shares one built-in seed (`DEFAULT_SEED_HEX` in background.js), so everyone sees the same stand-ins and pictures.
- **Never revealed:** the settings page only learns "shared seed in use" and a test name (`seed-info`), and no page or content script ever receives the default. The honest caveat: it ships inside the extension, so someone who unpacks the package could recover it.
- **Custom seed:** Advanced → Seed. Any text of 8 to 500 characters; the HMAC key is `SHA-256("unfamiliar sounds seed:" + text)`. A 64-hex-digit seed is used as the key itself, so keys saved by earlier versions still work. A custom seed can be shown, copied and saved.
- **Old keys:** the per-install random key of earlier versions is removed on start.
- **Caches per seed:** `pictureCache:<seed id>` and `reverseNames:<seed id>`. The seed id is a short hash of the key, never the seed.

**No blank holes, offline included.** Every image gets a picture:
1. the library picture once it has arrived;
2. until then, or if it fails or the network is down, the generated picture from the name shown next to it;
3. with no name nearby, a generated picture from its Spotify ID;
4. for an image unfamiliar sounds can't place at all (podcasts and the like), a generated picture from its address.

Real images appear only for the deliberate exceptions.

**Your own picture list (Advanced → Picture library).**
- **The file:** a CSV, TSV or text file with one https image address per line; the first https field per line is used. Duplicates are dropped and the order is kept, up to 200,000 entries.
- **Permission:** loading it asks Firefox for permission to the sites in the list (optional permission `https://*/*`, requested per site).
- **Picking:** a picture is the entry at position `HMAC(seed, "picture:<type>:<id>#0") mod list length`. No lookups. Same seed and list, same picture.
- **Fallback:** if an image fails, the generated picture stays.

**Settings page.** The everyday switches stay at the top. Seed, picture library, own list, word list and the temporary verdict counter move under **Advanced**.

**Testing.**
- `node tools/make-dev-build.mjs <folder outside the extension>` makes a test build named "unfamiliar sounds (dev)". It has a page bridge (`dev/bridge.js`), and the background answers `unfamiliar:dev` ops only in a "(dev)" build: state, setSettings, resetSettings, setOn, setSeed, seedInfo, setLibrary, clearPictureCaches, tabs. None returns the default seed.
- **Never install a test build for normal use:** any page script could change settings through the bridge.
- The grading brief for adversarial testing is kept with the session.

### Grading round 1: RED, 17 issues, then fixed

**Search dropdown.** Suggestions and recent searches sit inside the nav bar's safe zone. Safe zones now exclude listboxes, options, dialogs and menus (`UNSAFE_IN_SAFE`), so names and pictures there are replaced.

**Names inside text.**
- Known names are kept per type, and the swap prefers artist > album > playlist > user (so "Justice" in a description is the artist).
- Text swapped earlier is swapped again whenever new names become known (`reswap`).
- Songs and releases share one name space, so a single and its only song get the same stand-in.
- "A, B and more" and "With A, B" lists count as artist lists even when a name has punctuation ("Panic! At The Disco").

**Your own playlists.**
- A card's "By <owner>" line marks it as yours when the owner is you.
- Playlists on your own profile page are yours.
- Your playlists are never hidden as person or popularity playlists.
- A playlist that keeps its real title also keeps it in the tab title.

**Pictures.**
- The custom source is actually used.
- Your avatar is recognised wherever it appears (by its image hash), and stays real unless replaceOwnProfile is on.
- An owner's avatar in a playlist header gets that person's picture.
- Liked Songs and the other built-ins keep only their own covers (the heart and the like), not the album covers Spotify stacks on them.
- With replaceOwnProfile on, the user widget's tooltip shows your stand-in.

**Headers and layout.**
- The artist title (`adaptiveEntityTitle`) is now replaced.
- Header banners (`[data-testid="background-image"]`) show the page's own picture through the `--unfamiliar-backdrop` CSS variable; other inline background images are still removed.
- A hidden card's grid cell is hidden with it, so shelves have no gaps.
- Home shelf headings, Library chips and filter checkboxes are readable, and "Made For <you>" keeps your name.
- The artist page's Discography heading keeps its "Show all" (that page has the notice with "Show anyway").

**Profile links.** Only links to a profile itself (`/user/<id>`) count as names; links to `/user/<id>/top/...` sub-pages are interface text.

**The Met.** One request at a time, 500 ms apart. A refusal pauses 3, 6, 9… seconds, with up to six tries.

### Grading round 2: RED, 18 issues, then fixed

**Search dropdown.**
- An artist got a different stand-in there because the "Verified" badge's `<svg><title>` was read as part of the name. Text inside icons is no longer part of a name (`nameNodes`).
- Pictures of rows without ids (dropdown, Recents) are keyed by the title link's Spotify ID, like everywhere else.
- Word-only suggestions (`/search/…` rows) are hidden by CSS: they echo the real name behind a stand-in.

**Your own things.**
- A playlist row or card whose subtitle names you ("Playlist • <you>", "By <you>", or a link to your profile) is yours, wherever it appears (`rowKind`, `noteOwnerOf`).
- The Recents page has no ids: rows are matched by owner, or by title against your playlists seen on the page (in memory only).
- When your name is learnt after the page was first processed, the page is looked at again.
- With "Change my name and picture" on: card subtitles, the "Made For <you>" heading and your profile picture use your stand-in and your generated picture.

**Pictures.**
- People never get library pictures. An owner's avatar no longer takes the playlist's picture.
- Liked Songs and Your Episodes pictures are kept everywhere (`misc.scdn.co` and `misc.spotifycdn.com`), menus included.
- Hidden videos (Canvas, preview cards) get a generated picture behind them (`data-unfamiliar-poster`).

**Text.**
- Song titles that aren't links (a profile's top tracks) and local files are named.
- Podcasts, audiobooks and concerts get stand-ins (named like releases).
- Recents day headings, "N songs played", profile counts and headings are recognised as interface text.
- Shelf and section headings are Spotify's own words: known names are swapped. A heading that still has a capital or digit after its first letter gets a stand-in heading.
- Follower, listener and save counts and world rankings are blanked everywhere (buttons included), with their "•" separator.
- With playlist descriptions hidden, artist-list card subtitles (Daily Mixes) show "???" too.

**Hiding.**
- A hidden card's whole carousel cell is hidden (up to 4 wrapper levels), so no gaps. A shelf whose cards are all hidden disappears.
- With artist bios shown, the artist page keeps its About block (the listener count blanked).
- "Show anyway" shows the whole page, shelves included.

**Tests:** `test/selectors.test.js` covers the new interface-text, count, profile-link and built-in cover rules. 37 pass.

**Not explained:** once during self-checking, the Library panel showed Spotify's own error screen after a script scrolled it rapidly. It didn't come back after a reload or on gentle scrolling.

### Grading round 3 (final): RED, 15 issues

The loop stopped here, as agreed: at most three rounds.

**Fixed after round 3: self-checked, not graded.**
- **Critical, caused by round 2:** Spotify's personal playlists (Daily Mixes, radios, "<artist> Mix", Discover Weekly) list you as owner, so they were saved as yours and shown real. Spotify playlist ids (`37i9dQZF1…`) are now never yours, and old entries are dropped on load.
- **Critical:** "everything on your own profile is yours" also caught other people's playlists shown there. That rule is gone. Ownership comes from owner lines, creator links and the library.
- Your playlists' titles are no longer swapped inside menus, and id-less rows (Recents) get the same playlist stand-in as elsewhere.
- "1 song added" on a card is interface text.
- Your uploaded covers are kept on the home shortcut tiles.
- With hidePages off, pages that would be hidden are shown whole (`/user/<id>/top/artists`).

**Still open:**
1. "Add to playlist" submenu: other people's playlists show real titles unless the name was seen elsewhere on the page (menus only swap known names).
2. Home "Your playlists" shelf: your playlists not yet seen in the Library or on their page get stand-ins on first load. The cards don't say whose they are.
3. Theme titles that contain an artist name ("boygenius: Blueprint") stay real with showThemeTitles on: the known risk of that setting. Some "<artist> Mix" cards are judged theme ("Alfonso Peduto Mix").
4. Library filtered views (Podcasts, Audiobooks, Events chips): subtitles are blanked rather than given stand-ins.
5. "Spotify" as an owner is sometimes swapped ("Playlist • Windup Espy") and sometimes kept.
6. Artist page with bios shown: the About card's photo leaves an empty box; Merch items have unlabelled generated pictures; unlinked names in the bio stay real (by design).
7. /search Browse tiles: category pictures are hidden or generated and lose their printed labels.
8. The song page's "Recommended releases" shelf (the artist's albums) is shown.
9. The "Spotify" owner avatar keeps its real logo (intended: Spotify isn't a person).
10. Once, a tab stopped being processed after the test build was reinstalled (probably an orphaned content script). It wasn't reproducible after a reload.

### After round 3: the "Still open" list (18 October 2026)

Worked through by a follow-up session. Self-checked in the test window, signed in and signed out; not graded.

**New: what the page's own data says (no new requests).** Ownership and a playlist's kind now come from data Spotify already gives the page. It is read in memory only, and nothing new is stored except your playlist ids, which were already kept.
- **Query answers.** The `fetch` wrapper (the one search already uses) also reads the answers to the page's own `/pathfinder/` queries. Each playlist in them has its owner (`ownerV2`), title and Spotify's `format`. Your own user id comes from `me.profile.username`.
- **Library list.** The page fetches it from `spclient …/playlist/v2/user/<you>/rootlist` when "Add to playlist" opens. It holds every playlist in your library with its owner (`ownerUsername`).
- **Saved copy.** On first load the page draws Home from its own saved copy of earlier answers: IndexedDB `keyval-store`, key `react-query`. unfamiliar sounds reads that once before showing the page. It opens the database only if it exists and never writes to it. This is what makes item 2 work on first load.
- **Playlists recognised as yours:**
  - owned by your user id (by your display name until the id is known);
  - Spotify playlist ids (`37i9dQZF1…`) are still never yours, even where Spotify lists you as owner ("Your Episodes").
  - Many can be learnt at once (about 770 from the library list), so their slots are refreshed together before the next paint.
- **Your titles.** Titles of your playlists from the data are matched in the "Add to playlist" menu and in rows that don't say whose they are.
  - Only titles shown on the page as yours are still left unswapped inside text.
  - A name that merely equals one of your library's titles is still swapped in tooltips and bios.
- **Violet may want to veto this.** It reads Spotify's private data formats and the page's IndexedDB. If those change, the extension fails closed: stand-ins instead of your titles, and mixes judged by their titles as before.

**The list:**
1. **Fixed: "Add to playlist" submenu.**
   - The submenu is recognised by its own "Find a playlist" search box (`MENU_SEARCH`), nested folders included.
   - Every title in it gets a playlist stand-in, seen or not. Yours stay as written; so do your folders (items that open a submenu).
   - Checked: three of your playlists real, three collaborative playlists owned by others as stand-ins (owners confirmed in the library list).
   - "New playlist" and the other folder commands are interface text.
2. **Fixed: Home "Your playlists".** With the stored own-playlist ids cleared, all 8 cards showed real titles on first load. Their owners came from the saved copy.
3. **Partly fixed.**
   - **Mixes:** Spotify's format decides first (`core/collections.js`, rule 0).
     - `artist-mix-reader` ("<artist> Mix"), `inspiredby-mix` (radios) and `artistsets` ("This Is …") are person.
     - `chart` is popularity.
     - `topic-mix` (genre, mood, decade mixes), `daily-mix` and `editorial` fall through to the usual rules.
     - Both artist mixes in "Your top mixes" are now hidden on first load.
   - **Known risk, unchanged:** theme titles naming an artist stay real with showThemeTitles on.
4. **Fixed: Library filtered views.**
   - Subtitles without a "Kind •" in front (podcast publishers, audiobook authors, an event's venue and city) get stand-ins.
   - Event dates and times are interface text.
   - Checked with the Podcasts, Audiobooks and Events chips.
   - Also given stand-ins instead of blanks:
     - links to `/show/`, `/episode/` and `/audiobook/` (Home's Podcasts and Audiobooks views);
     - "Album • <artist>" on Recents cards.
5. **Fixed: "Spotify" as owner.**
   - The swapped case was Spotify's mixes made for you, whose subtitle is "Playlist • Made for <you>". Your name now stays (`MADE_FOR`), or gets your stand-in with "Change my name" on.
   - Owner checks for Spotify also ignore case and accept the user id `spotify`.
6. **About card photo fixed.**
   - It is an inline background image. It now shows the artist's own picture (the page backdrop) under Spotify's shade (`ABOUT_PHOTO`, `data-unfamiliar-backdrop`). Checked signed out with bios shown.
   - **Unchanged:** merch pictures are generated with no label, and unlinked names in bios stay real (by design).
7. **Fixed: /search Browse tiles.**
   - Genre tiles' pictures are now generated ones (they sat in a safe zone and stayed invisible).
   - "Live Events", "Podcast Charts" and seasonal hub tiles keep their labels: interface text with known names swapped.
8. **Fixed: song page "Recommended releases".** The shelf (`/track/<id>/more-like-this`) is mostly the same artist's other releases, so it is hidden like a discography shelf.
9. **Unchanged (intended):** the Spotify owner avatar.
10. **Not reproduced:** the orphaned content script after reinstalling. Each reinstall here was followed by a reload, and every page was processed.

**Tests:** 42 pass. New ones cover rule 0 (formats), event dates, `MADE_FOR`, the more-like-this shelf, and the genre tile and About card selectors.

**Not done (then):** `aria-label`s still held real names. Done the same day; see the next section.

### Hidden text: screen-reader labels and hover text (18 October 2026)

Asked by Violet: adjust hover text and anything else not seen on screen, then run the tests that had been missed.

**What was found.** A page-wide inventory of attributes on Home found 196 distinct `aria-label`s, many with real names ("Play <album> by <artist>", "More options for <playlist>", shelf labels). The other places names were found:
- `title` hover text: handled before, but your own playlists got stand-ins there while their text stayed real;
- `alt` text: already stand-ins;
- the tab title: already stand-ins;
- `<meta>` tags: hold only "Spotify".

**How labels are handled now** (`fixAriaLabel`, `fixTitleAttribute`, `labelText` in `content/unfamiliar.js`; `LABEL_WORDS`, `labelWordsOnly`, `labelPrefix` in `content/selectors.js`):
- **Known names** in a label are swapped for their stand-ins.
- **Waiting.** While a name in a label is still being derived, the label is empty. It is filled once the name arrives (labels are judged again after every batch of names).
- **Unknown names.** Once known names are taken out, what is left must be Spotify's own words (`LABEL_WORDS`, plus the words of `SAFE_PHRASES`). Numbers don't count as Spotify's words: a song can be called "0397". Otherwise the label may hold a name unfamiliar sounds doesn't know, and it is cut back to its leading words ("Play", "More options") or emptied. Fail closed.
- **What stays as written:**
  - your own name and your playlists' titles, unless the settings say otherwise;
  - your account button's label (it becomes your stand-in with "Change my name" on);
  - genre tiles' labels;
  - the cookie banner.
- **Safe zones too.** Labels in safe zones (nav bar, player controls, action bar) are judged as well. The action bar's "More options for <podcast>" leaked on a podcast page.
- **Hover text.** Hover text repeating a name slot shows what the slot shows, so your own titles stay real there too. Other hover text is judged like a label (it used to be removed).
- **Never removed.** Attributes are rewritten, never removed. The real values are kept in memory (`readRealAttr`), so hiding still reads shelves' real labels, and your name is still read from your account button.
- **Also fixed:**
  - podcast, episode and audiobook page titles get stand-ins (`MEDIA_ROUTE`); they were blank;
  - your playlists with a cover Spotify made keep their own title as the picture's alt text.

**Tests run** (signed in, dev build, test window):
- **Unit tests:** 43 pass, including new ones for the label rules.
- **Leak scan.** A test-only page script (not part of the extension) collected the real names from the page's own data. It took about 1,700 names: songs, albums, artists, playlists, podcasts and profiles, minus your own playlists. It then searched every text node (hidden ones included), every `title`, `aria-label`, `alt` and `placeholder`, and the tab title for them.
  - **Pages scanned:** Home, an album, two artists, a Spotify playlist, a Daily Mix, another user's playlist, your playlist, your profile, another user's profile, Liked Songs, Your Episodes, search results, a song page, a genre page and a podcast page.
  - **Remaining hits** are all allowed: your folder names, your own playlist titles (one contains an album's name), the footer's "United Kingdom", and stand-ins that happen to equal a one-word real name ("Phoenix", "Mimic").
- **Navigation watch.** A page-side observer running after unfamiliar sounds' own checked every change for multi-word real names in text, `title`, `aria-label` and `alt`. Over 104 batches it found none. Route: album → artist → Spotify playlist → search → song → your playlist → podcast → Home → profile.
- **Menus:** the "Add to playlist" submenu and its labels are clean; yours are real, others' are stand-ins.
- **Settings, previously unchecked signed in:**
  - **"Change my name and picture" and "Change my own playlists" on:** your name, playlist titles and the account button's label all become stand-ins. Your folder names stay as written by design; a folder called "Violet's" keeps her name.
  - **"Show theme titles" on:** only Spotify theme playlists show real titles (text and hover text). Artist mixes stay hidden.
  - **Descriptions shown:**
    - the signed-in About card shows the artist's picture, and its label is a stand-in;
    - unlinked names in bios and playlist descriptions stay real, the known cost of those settings.
- **Library Events filter:** concert rows show dates as written, and venues and cities as stand-ins.

**Could not be tested here:**
- **Needs playback:** the queue, Now Playing view, lyrics, the media session and the now-playing bar with a song. The test profile can't play (DRM), and starting playback would add to Violet's listening history. Both panels opened empty and clean.
- **Needs Violet, in her own Firefox:**
  - the toolbar switch (switching on reloads tabs, switching off closes them);
  - the "Ask how to open Spotify links" choice page;
  - the settings page and its verdict counter.

  The harness can't click toolbar buttons or open `moz-extension://` pages.
- **The off/on comparison (`tools/leakcheck.mjs`)** was not repeated: switching off closes the signed-in container tab. The signed-in leak scan and navigation watch above cover more.
- **Rule 3 (one artist dominates)** is still only unit-tested. No page was found where it alone decides.

The normal build from `extension/` is reinstalled in the test window, with settings back to their defaults.
