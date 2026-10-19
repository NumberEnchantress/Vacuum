// unfamiliar sounds collections (phase 2, step 1): is a playlist about a theme, a
// person, or popularity? Rules only, no language model. See
// PHASE2-PROPOSAL.md.
//
// Verdicts:
//   "person"      built around one artist or public figure: hidden
//   "popularity"  charts and top lists: hidden
//   "unsure"      can't tell: hidden (fail closed)
//   "theme"       a mood, activity, genre or idea: shown
//
// Plain script with no imports: runs as a content script and under Node.

(function (root) {
  "use strict";

  // Rule 0: the format Spotify gives its own playlists in the page's data.
  // Artist radios ("inspiredby-mix"), "<artist> Mix" ("artist-mix-reader")
  // and "This Is <artist>" ("artistsets") are about that artist. Mixes of a
  // genre, mood or decade are "topic-mix"; Daily Mixes "daily-mix".
  const FORMAT_PERSON = new Set(["inspiredby-mix", "artist-mix-reader", "artistsets"]);
  const FORMAT_POPULARITY = new Set(["chart"]);

  // Rule 1: the title alone.
  const TITLE_PERSON = [/^this is /i, / radio$/i, /^best of /i, /'s picks$/i];
  const TITLE_POPULARITY = [
    /\btop (\d+|hits|songs|tracks|artists)\b/i, /\bviral \d+/i, /\bcharts?\b/i,
    /\bhot(test)? \d+/i, /\bhot hits\b/i,
  ];

  // Rule 4: the description.
  const DESCRIPTION_PERSON = [
    /^this is /i, /\bessential (tracks|songs)\b/i, /\bbiggest (hits|songs)\b/i, /\bgreatest hits\b/i,
    /\bpicked by\b/i, /\ball in one playlist\b/i, /\bbest of\b/i,
  ];
  const DESCRIPTION_POPULARITY = [/\bhottest \d+\b/i, /\bmost (played|streamed)\b/i, /\bcharts?\b/i];

  // Rule 3: one artist on at least this share of at least this many tracks.
  const DOMINANT_SHARE = 0.5;
  const DOMINANT_MIN_TRACKS = 8;

  // Names shorter than this are ignored when looking for names in titles.
  const MIN_NAME_LENGTH = 3;

  // Spotify's own playlists (editorial and generated) have IDs with this prefix.
  const SPOTIFY_ID_PREFIX = "37i9dQZF1";

  // "With A, B and C" / "A, B and more" -> ["A", "B", "C"]. Anything that
  // reads like a sentence gives no names.
  function namesInDescription(description) {
    let text = (description || "").trim();
    // "With A, B and more" / "A, B and more" are artist lists even when a
    // name has punctuation ("Panic! At The Disco"); anything else that reads
    // like a sentence gives no names.
    const looksLikeList = /^with\s/i.test(text) || /,?\s+and more$/i.test(text);
    if (!text || (!looksLikeList && /[.!?:]/.test(text))) return [];
    text = text.replace(/^with\s+/i, "").replace(/,?\s+and more$/i, "");
    return text.split(/\s*,\s*|\s+and\s+|\s+&\s+/).map((s) => s.trim()).filter(Boolean);
  }

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // Whole-phrase match, ignoring case, bounded by anything that isn't a
  // letter or digit.
  function titleNames(title, name) {
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(name)}($|[^\\p{L}\\p{N}])`, "iu");
    return re.test(title);
  }

  function dominantShare(rows) {
    const counts = new Map();
    for (const artists of rows) for (const a of new Set(artists)) counts.set(a, (counts.get(a) || 0) + 1);
    let top = 0;
    for (const n of counts.values()) top = Math.max(top, n);
    return rows.length ? top / rows.length : 0;
  }

  // evidence: {
  //   title:        real title ("" if not seen yet)
  //   description:  real description, if seen
  //   names:        real names of this playlist's own artists (track rows)
  //   sessionNames: real artist names seen anywhere this session
  //   rows:         [[artistId, ...], ...] for the track rows seen
  //   format:       Spotify's format for the playlist, from the page's data
  // }
  // Returns { verdict, rule }.
  function classify(evidence) {
    const title = (evidence.title || "").trim();
    const description = (evidence.description || "").trim();
    const format = evidence.format || "";
    if (FORMAT_PERSON.has(format)) return { verdict: "person", rule: "0 format" };
    if (FORMAT_POPULARITY.has(format)) return { verdict: "popularity", rule: "0 format" };
    if (!title) return { verdict: "unsure", rule: "no title yet" };

    if (TITLE_PERSON.some((re) => re.test(title))) return { verdict: "person", rule: "1 title pattern" };
    if (TITLE_POPULARITY.some((re) => re.test(title))) return { verdict: "popularity", rule: "1 title pattern" };

    // Rule 2 (and 5): the title names an artist.
    const candidates = new Set([
      ...namesInDescription(description),
      ...(evidence.names || []),
      ...(evidence.sessionNames || []),
    ]);
    let weak = false;
    for (const name of candidates) {
      if (name.length < MIN_NAME_LENGTH || !titleNames(title, name)) continue;
      if (/\s/.test(name.trim())) return { verdict: "person", rule: "2 title names an artist" };
      weak = true; // a one-word name may just be a word
    }

    const rows = evidence.rows || [];
    if (rows.length >= DOMINANT_MIN_TRACKS && dominantShare(rows) >= DOMINANT_SHARE) {
      return { verdict: "person", rule: "3 one artist dominates" };
    }

    if (DESCRIPTION_PERSON.some((re) => re.test(description))) return { verdict: "person", rule: "4 description" };
    if (DESCRIPTION_POPULARITY.some((re) => re.test(description))) return { verdict: "popularity", rule: "4 description" };

    if (weak) return { verdict: "unsure", rule: "5 one-word name in title" };
    return { verdict: "theme", rule: "6 none of the above" };
  }

  // Hidden verdicts that should stick once reached (the evidence for them,
  // such as track rows, isn't on every page).
  const STICKY = new Set(["person", "popularity"]);

  function isShown(verdict) {
    return verdict === "theme";
  }

  function isSpotifyPlaylist(id) {
    return id.startsWith(SPOTIFY_ID_PREFIX);
  }

  const api = Object.freeze({
    classify, namesInDescription, titleNames, dominantShare, isShown, isSpotifyPlaylist, STICKY,
    FORMAT_PERSON, FORMAT_POPULARITY, TITLE_PERSON, TITLE_POPULARITY, DESCRIPTION_PERSON, DESCRIPTION_POPULARITY,
    DOMINANT_SHARE, DOMINANT_MIN_TRACKS, SPOTIFY_ID_PREFIX,
  });
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.UnfamiliarCollections = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
