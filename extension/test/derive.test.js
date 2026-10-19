// Tests for core/derive.js. Run: node --test test/
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Unfamiliar = require("../core/derive.js");

const ROOT = path.join(__dirname, "..");
const WORDLIST_BYTES = new Uint8Array(fs.readFileSync(path.join(ROOT, Unfamiliar.WORDLIST.file)));
const VECTORS = JSON.parse(fs.readFileSync(path.join(__dirname, "vectors.json"), "utf8"));
const TEST_KEY = Unfamiliar.keyFromText(VECTORS.key);

const make = (opts = {}) => Unfamiliar.createDeriver({ key: TEST_KEY, wordlistBytes: WORDLIST_BYTES, ...opts });

// Deterministic made-up Spotify IDs for bulk checks.
function fakeIds(count) {
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let seed = 7;
  return Array.from({ length: count }, () => Array.from({ length: 22 }, () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return chars[seed % 62];
  }).join(""));
}

// --- word list ------------------------------------------------------------

test("shipped word list matches its pinned checksum", async () => {
  const list = await Unfamiliar.loadWordlist(WORDLIST_BYTES);
  assert.equal(list.words.length, 10000);
  assert.equal(new Set(list.words).size, 10000);
  assert.equal(list.byPos.adj.length + list.byPos.noun.length + list.byPos.verb.length + list.byPos.adv.length, 10000);
});

test("refuses to run on a changed word list", async () => {
  const tampered = WORDLIST_BYTES.slice();
  tampered[0] = "b".charCodeAt(0); // aardvark -> bardvark
  await assert.rejects(make({ wordlistBytes: tampered }), /checksum .* does not match v2-full/);
  await assert.rejects(make({ wordlistBytes: WORDLIST_BYTES.slice(0, -1) }), /refusing to run/);
});

// --- known answers --------------------------------------------------------

test("matches the independent Python reference", async () => {
  const any = await make({ wordOrder: "any" });
  const pattern = await make({ wordOrder: "pattern" });
  for (const c of VECTORS.cases) {
    const label = `${c.type}:${c.id}`;
    const digest = Buffer.from(await any.digest(c.type, c.id)).toString("hex");
    assert.equal(digest, c.any.digest, label);
    const got = await any.derive(c.type, c.id);
    assert.deepEqual(got.words, c.any.words, label);
    assert.deepEqual(JSON.parse(JSON.stringify(got.picture)), c.any.picture, label);
    assert.deepEqual((await pattern.derive(c.type, c.id)).words, c.pattern, label);
  }
});

test("names are title-cased words", async () => {
  const d = await make();
  const { name, words } = await d.derive("artist", VECTORS.cases.find((c) => c.type === "artist").id);
  assert.equal(words.length, 3);
  assert.equal(name, words.map((w) => w[0].toUpperCase() + w.slice(1)).join(" "));
});

// --- determinism ----------------------------------------------------------

test("same input gives the same output across derivers and calls", async () => {
  const a = await make(), b = await make();
  for (const id of fakeIds(200)) {
    for (const type of Object.keys(Unfamiliar.NAMES)) {
      const x = await a.derive(type, id), y = await b.derive(type, id);
      assert.deepEqual(x, y);
      assert.deepEqual(await a.derive(type, id), x);
    }
  }
});

test("different entity types give different outputs for the same id", async () => {
  const d = await make();
  for (const id of fakeIds(200)) {
    const types = Object.keys(Unfamiliar.NAMES);
    const digests = await Promise.all(types.map(async (t) => Buffer.from(await d.digest(t, id)).toString("hex")));
    assert.equal(new Set(digests).size, types.length);
    const album = await d.derive("album", id), track = await d.derive("track", id);
    assert.notDeepEqual(album.words, track.words);
    assert.notDeepEqual(album.picture, track.picture);
  }
});

test("a different key gives different names", async () => {
  const other = await Unfamiliar.createDeriver({ key: Unfamiliar.generateKey(), wordlistBytes: WORDLIST_BYTES });
  const d = await make();
  let same = 0;
  for (const id of fakeIds(100)) if ((await d.derive("track", id)).name === (await other.derive("track", id)).name) same++;
  assert.ok(same <= 1, `${same} of 100 names unchanged by a new key`);
});

test("word order setting never changes the picture", async () => {
  const any = await make({ wordOrder: "any" }), pattern = await make({ wordOrder: "pattern" });
  for (const id of fakeIds(100)) {
    assert.deepEqual((await any.derive("artist", id)).picture, (await pattern.derive("artist", id)).picture);
  }
});

test("pattern order uses the right parts of speech", async () => {
  const d = await make({ wordOrder: "pattern" });
  const { byPos } = d.wordlist;
  for (const id of fakeIds(100)) {
    const [a1, a2, n] = (await d.derive("artist", id)).words;
    assert.ok(byPos.adj.includes(a1) && byPos.adj.includes(a2) && byPos.noun.includes(n));
  }
});

// --- palette --------------------------------------------------------------

test("palette has 12 to 16 distinct colors", () => {
  assert.ok(Unfamiliar.PALETTE.length >= 12 && Unfamiliar.PALETTE.length <= 16);
  assert.equal(new Set(Unfamiliar.PALETTE).size, Unfamiliar.PALETTE.length);
  for (const c of Unfamiliar.PALETTE) assert.match(c, /^#[0-9A-F]{6}$/);
});

test("contrast table matches the palette tool", async () => {
  const tool = await import("../tools/palette.mjs");
  assert.deepEqual(JSON.parse(JSON.stringify(Unfamiliar.CONTRAST)), tool.contrastTable(Unfamiliar.PALETTE));
  for (const [i, row] of Unfamiliar.CONTRAST.entries()) {
    assert.ok(row.length >= 6, `color ${i} has only ${row.length} neighbours`);
    assert.ok(!row.includes(i));
  }
});

test("no picture color ever falls outside the palette, and neighbours always contrast", async () => {
  const d = await make();
  const inPalette = (i) => Number.isInteger(i) && i >= 0 && i < Unfamiliar.PALETTE.length;
  for (const id of fakeIds(2000)) {
    const cover = (await d.derive("album", id)).picture;
    assert.equal(cover.squares.length, 4);
    for (const s of cover.squares) {
      assert.ok(inPalette(s.background) && inPalette(s.color));
      assert.ok(Unfamiliar.CONTRAST[s.background].includes(s.color));
      assert.ok(Unfamiliar.SHAPES.includes(s.shape));
      assert.ok(s.turn >= 0 && s.turn < Unfamiliar.TURNS);
    }
    const rings = (await d.derive("artist", id)).picture;
    assert.equal(rings.rings.length, Unfamiliar.RINGS);
    rings.rings.forEach((c, i) => {
      assert.ok(inPalette(c));
      if (i > 0) assert.ok(Unfamiliar.CONTRAST[rings.rings[i - 1]].includes(c));
    });
    assert.ok(rings.profile >= 0 && rings.profile < Unfamiliar.RING_PROFILES);
  }
});

test("covers and artist pictures are different kinds", async () => {
  const d = await make();
  const id = fakeIds(1)[0];
  assert.equal((await d.derive("album", id)).picture.kind, "cover");
  assert.equal((await d.derive("track", id)).picture.kind, "cover");
  assert.equal((await d.derive("artist", id)).picture.kind, "rings");
});

// --- key ------------------------------------------------------------------

test("keys are 32 random bytes and survive export and import", () => {
  const k = Unfamiliar.generateKey();
  assert.equal(k.length, 32);
  assert.notDeepEqual(k, Unfamiliar.generateKey());
  const text = Unfamiliar.keyToText(k);
  assert.match(text, /^[0-9a-f]{64}$/);
  assert.deepEqual(Unfamiliar.keyFromText(text), k);
  assert.deepEqual(Unfamiliar.keyFromText(`  ${text.slice(0, 32).toUpperCase()}\n${text.slice(32)} `), k);
});

test("rejects malformed keys", () => {
  assert.throws(() => Unfamiliar.keyFromText("abc"), /64 hexadecimal/);
  assert.throws(() => Unfamiliar.keyFromText("g".repeat(64)), /64 hexadecimal/);
  assert.throws(() => Unfamiliar.keyToText(new Uint8Array(16)), /32 bytes/);
});

// --- inputs ---------------------------------------------------------------

test("names are keyed as displayed, ignoring spacing and capitals", async () => {
  const d = await make();
  const a = await d.derive("track", "Never Gonna Give You Up");
  assert.deepEqual(await d.derive("track", "  never  gonna give you UP\n"), a);
  assert.notDeepEqual((await d.derive("track", "Never Gonna Give You Up (Remastered)")).words, a.words);
  // "e" + combining acute (decomposed) is the same name as precomposed "é"
  assert.equal(Unfamiliar.normalizeName("Café  Del  Mar"), "café del mar");
});

test("rejects empty or overlong names and unknown types", async () => {
  const d = await make();
  await assert.rejects(d.derive("track", "   "), /empty name/);
  await assert.rejects(d.derive("track", "x".repeat(501)), /too long/);
  await assert.rejects(d.derive("show", "Some podcast"), /unknown entity type/);
});
