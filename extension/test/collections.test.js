// Tests for core/collections.js. Run: node --test test/
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const C = require("../core/collections.js");

const verdict = (evidence) => C.classify(evidence).verdict;
const rows = (...artists) => artists.map((a) => [a]);

test("theme and mood playlists are themes", () => {
  for (const title of ["rainy day", "internet crush", "Chill Mix", "Chill Essentials", "Peaceful Piano", "Daily Mix 1", "Pop Rising"]) {
    assert.equal(verdict({ title, description: "Khruangbin, Men I Trust and more" }), "theme", title);
  }
});

test("title patterns: person and popularity", () => {
  assert.equal(verdict({ title: "This Is Justice" }), "person");
  assert.equal(verdict({ title: "Morgan Wallen Radio" }), "person");
  assert.equal(verdict({ title: "Best of Daft Punk" }), "person");
  assert.equal(verdict({ title: "Justice's Picks" }), "person");
  for (const title of ["Top 50 - Global", "Viral 50 - USA", "Today’s Top Hits", "Hot Hits USA", "Hot 100", "Featured Charts"]) {
    assert.equal(verdict({ title }), "popularity", title);
  }
});

test("a title naming one of the playlist's artists is about that person", () => {
  assert.equal(verdict({ title: "Tame Impala Mix", description: "Tame Impala, MGMT and more" }), "person");
  assert.equal(verdict({ title: "UNDERTALE | Daft Punk", names: ["Daft Punk", "Toby Fox"] }), "person");
  assert.equal(verdict({ title: "songs like grand theft auto vi", sessionNames: ["Grand Theft Auto VI"] }), "person");
});

test("a one-word name in the title is unsure, not a theme", () => {
  assert.equal(verdict({ title: "Justice Mix", description: "Justice, Kavinsky and more" }), "unsure");
  assert.equal(verdict({ title: "Justice Remixes", sessionNames: ["Justice"] }), "unsure");
  assert.equal(verdict({ title: "Social Justice Anthems", sessionNames: ["Justice"] }), "unsure");
});

test("names match whole phrases only, and very short names are ignored", () => {
  assert.equal(verdict({ title: "Chillwave nights", sessionNames: ["Chill"] }), "theme");
  assert.equal(verdict({ title: "Low key", sessionNames: ["Low"] }), "unsure");
  assert.equal(verdict({ title: "Mo Mood", sessionNames: ["Mo"] }), "theme");
  assert.ok(C.titleNames("Love Ty Dolla $ign", "Ty Dolla $ign"));
  assert.ok(!C.titleNames("Dolla bills", "Ty Dolla $ign"));
});

test("one artist on half of the tracks makes it about that artist", () => {
  const many = rows("a", "a", "a", "a", "b", "c", "d", "e");
  assert.equal(verdict({ title: "my favourites", rows: many }), "person");
  assert.equal(verdict({ title: "my favourites", rows: rows("a", "a", "a", "b", "c", "d", "e", "f") }), "theme");
  assert.equal(verdict({ title: "my favourites", rows: rows("a", "a", "a") }), "theme"); // too few tracks to tell
  assert.equal(C.dominantShare([["a", "b"], ["a"], ["c"], ["a", "a"]]), 0.75);
});

test("descriptions can mark person and popularity playlists", () => {
  assert.equal(verdict({ title: "Neon nights", description: "This is Justice. The essential tracks, all in one playlist." }), "person");
  assert.equal(verdict({ title: "Today’s list", description: "The hottest 50. Cover: someone" }), "popularity");
});

test("descriptions are read as artist lists only when they look like one", () => {
  assert.deepEqual(C.namesInDescription("With Bailey Zimmerman, Tucker Wetmore, Jordan Davis and more"), ["Bailey Zimmerman", "Tucker Wetmore", "Jordan Davis"]);
  assert.deepEqual(C.namesInDescription("Justice, Tame Impala and SZA"), ["Justice", "Tame Impala", "SZA"]);
  assert.deepEqual(C.namesInDescription("Chill vibes. Lofi beats to relax to."), []);
});

test("no title yet is unsure; only themes are shown", () => {
  assert.equal(verdict({ title: "" }), "unsure");
  assert.ok(C.isShown("theme"));
  for (const v of ["person", "popularity", "unsure"]) assert.ok(!C.isShown(v));
});

test("Spotify's own playlists are recognised by ID", () => {
  assert.ok(C.isSpotifyPlaylist("37i9dQZF1DXcBWIGoYBM5M"));
  assert.ok(!C.isSpotifyPlaylist("175ilrDuQOmHLb36aF59EK"));
});

test("Spotify's own format for a playlist decides first", () => {
  assert.equal(verdict({ title: "Alfonso Peduto Mix", format: "artist-mix-reader" }), "person");
  assert.equal(verdict({ title: "This Is Daft Punk", format: "artistsets" }), "person");
  assert.equal(verdict({ title: "Chill Mix", format: "topic-mix" }), "theme");
  assert.equal(verdict({ title: "", format: "inspiredby-mix" }), "person");
  assert.equal(verdict({ title: "Top 50 - Global", format: "chart" }), "popularity");
  assert.equal(verdict({ title: "Chill Mix", format: "some-other-format" }), "theme");
});
