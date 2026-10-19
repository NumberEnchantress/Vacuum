// Page-structure rules that grading found wrong once (18 October 2026).
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../content/selectors.js");

const safe = (text) => S.SAFE_PHRASES.has(text) || S.SAFE_PATTERNS.some((re) => re.test(text));

test("interface text that is not a name stays", () => {
  for (const text of ["Fri, Oct 16", "Yesterday", "69 Public Playlists", "112 Following", "2 songs played",
    "1 song added", "Recents", "Your playlists", "Public Playlists", "Profile", "About"]) {
    assert.ok(safe(text), text);
  }
});

test("popularity counts are recognised, other counts are not", () => {
  for (const text of ["8,675,060 monthly listeners", "281,274 saves", "13 Followers", "1 Follower", "#12 in the world"]) {
    assert.ok(S.POPULARITY_COUNT.test(text), text);
    assert.ok(!safe(text), text);
  }
  assert.ok(!S.POPULARITY_COUNT.test("90 songs"));
});

test("profile links are names, their sub-pages are not", () => {
  assert.equal(S.USER_HREF_ID.exec("/user/31qz")[1], "31qz");
  assert.equal(S.USER_HREF_ID.exec("/user/31qz/top/tracks"), null);
  assert.equal(S.USER_HREF_ID.exec("/user/31qz/followers"), null);
});

test("built-in collection covers are kept, album covers are not", () => {
  assert.ok(S.BUILTIN_COVER.test("https://misc.scdn.co/liked-songs/liked-songs-64.jpg"));
  assert.ok(S.BUILTIN_COVER.test("https://misc.spotifycdn.com/your-episodes/SE-300.png"));
  assert.ok(!S.BUILTIN_COVER.test("https://i.scdn.co/image/ab67616d00001e02aaaaaaaaaaaaaaaaaaaaaaaa"));
});

test("event dates and times in library subtitles stay", () => {
  for (const text of ["Sat, Oct 18", "Sat Oct 18", "Sat, Oct 18, 2026", "Fri, Nov 7, 8:00 PM", "7:30 PM", "8 PM"]) {
    assert.ok(safe(text), text);
  }
  assert.ok(!safe("Madison Square Garden"));
});

test("genre tile pictures and the About card photo are handled", () => {
  assert.ok(S.SAFE_ZONE_IMAGES.includes('a[href^="/genre/"] img'));
  assert.ok(S.UI_ZONES.includes('a[href="/concerts"]'));
  assert.ok(S.ABOUT_PHOTO.includes("artist-page"));
});

test("a song page's more-like-this shelf is hidden like a discography", () => {
  assert.ok(S.HIDE_SHELF_HREF.test("/track/0dEIca2nhcxDUV8C5QkPYb/more-like-this"));
  assert.ok(S.HIDE_SHELF_HREF.test("/artist/4tZwfgrHOc3mvqYlEYSvVi/related"));
  assert.ok(!S.HIDE_SHELF_HREF.test("/genre/0JQ5DAqbMKFSi39LMRT0Cy"));
});

test("Made for <name> is recognised in mix subtitles", () => {
  assert.equal(S.MADE_FOR.exec("Made for Someone")[2], "Someone");
  assert.equal(S.MADE_FOR.exec("Spotify"), null);
});

test("labels: Spotify's own words pass, anything else is cut back", () => {
  assert.ok(S.labelWordsOnly("Play  by  "));
  assert.ok(S.labelWordsOnly("More options for "));
  assert.ok(S.labelWordsOnly("Made For "));
  assert.ok(S.labelWordsOnly("Now playing bar"));
  assert.ok(!S.labelWordsOnly("Play Discovery by Daft Punk"));
  assert.ok(!S.labelWordsOnly("Play Nightcall by "));
  assert.ok(!S.labelWordsOnly("Play 0397 by "));
  assert.equal(S.labelPrefix("Play Discovery by Daft Punk"), "Play");
  assert.equal(S.labelPrefix("More options for Zebra Crossing"), "More options");
  assert.equal(S.labelPrefix("Brand new music from artists you love."), "");
  assert.equal(S.labelPrefix("Spotify - Web Player: Listen to Music, Podcasts, and Audiobooks Online"), "Spotify - Web Player: Listen to Music, Podcasts, and Audiobooks Online");
});
