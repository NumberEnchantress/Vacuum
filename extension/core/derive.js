// unfamiliar sounds derivation core.
//
// Every stand-in is a pure function of (secret key, entity type, displayed
// name). Keyed by the name as shown, not the Spotify ID, so a song that
// Spotify lists under two IDs (the same recording on two releases) gets one
// stand-in everywhere (Violet's decision, 17 October 2026):
//
//   digest = HMAC-SHA-256(key, type + ":" + normalizeName(name))
//   bytes  0..15 -> one big integer -> successive remainders pick the words
//   bytes 16..31 -> one big integer -> successive remainders pick the picture
//
// Words and picture use separate halves so that switching the word order
// (option A / B) never changes anyone's picture.
//
// Plain script with no imports, so it runs in the background page, on the
// settings page, and under Node for the tests. (Not in content scripts:
// Firefox wraps Web Crypto results there, so the background derives.)

(function (root) {
  "use strict";

  // --- fixed inputs -------------------------------------------------------

  // The reviewed word list. Shipped unchanged; refuse to run on any other.
  const WORDLIST = Object.freeze({
    version: "v2-full",
    file: "data/wordlist_v2-full.tsv",
    sha256: "d4610605d28ebcc8efe24548b2cc38044618ee2f9147cafe6dbea770d6ebd0ab",
    length: 10000,
  });

  // Requirement 13a. "any": any words from the whole list (option A).
  // "pattern": part-of-speech patterns (option B).
  const WORD_ORDER = "any";

  const NAMES = Object.freeze({
    track:    { any: 2, pattern: ["adj", "noun"] },
    album:    { any: 2, pattern: ["adj", "noun"] },
    playlist: { any: 2, pattern: ["adj", "noun"] },
    artist:   { any: 3, pattern: ["adj", "adj", "noun"] },
    user:     { any: 2, pattern: ["adj", "noun"] },     // playlist owners
  });

  const PICTURE_KIND = Object.freeze({
    track: "cover",
    album: "cover",
    playlist: "cover",
    artist: "rings",
    user: "rings",
  });

  // Palette p16, approved by Violet on 16 October 2026 (review/palette-sample.html).
  // Changing it changes every picture, like a new word list edition.
  // Chosen so every pair stays apart under normal vision and simulated
  // protanopia, deuteranopia and tritanopia.
  const PALETTE = Object.freeze([
    "#1A1A1A",
    "#332288",
    "#0077BB",
    "#77AADD",
    "#99DDFF",
    "#225555",
    "#009E73",
    "#666633",
    "#F0E442",
    "#E69F00",
    "#D55E00",
    "#663333",
    "#CC79A7",
    "#AA4499",
    "#777777",
    "#F4EFE6",
  ]);

  // CONTRAST[i] lists the palette indices that may sit next to color i: a
  // shape on its square, or the neighbouring ring. Generated with the
  // palette by tools/palette.mjs.
  const CONTRAST = Object.freeze([
    [2, 3, 4, 6, 7, 8, 9, 10, 12, 13, 14, 15],
    [3, 4, 6, 7, 8, 9, 10, 11, 12, 14, 15],
    [0, 4, 7, 8, 9, 10, 11, 14, 15],
    [0, 1, 5, 7, 8, 9, 10, 11, 14, 15],
    [0, 1, 2, 5, 6, 7, 8, 9, 10, 11, 13, 14],
    [3, 4, 6, 7, 8, 9, 10, 12, 15],
    [0, 1, 4, 5, 8, 11, 13, 15],
    [0, 1, 2, 3, 4, 5, 8, 9, 12, 13, 15],
    [0, 1, 2, 3, 4, 5, 6, 7, 10, 11, 12, 13, 14],
    [0, 1, 2, 3, 4, 5, 7, 11, 13, 14, 15],
    [0, 1, 2, 3, 4, 5, 8, 11, 14, 15],
    [1, 2, 3, 4, 6, 8, 9, 10, 12, 14, 15],
    [0, 1, 5, 7, 8, 11, 15],
    [0, 4, 6, 7, 8, 9, 15],
    [0, 1, 2, 3, 4, 8, 9, 10, 11, 15],
    [0, 1, 2, 3, 5, 6, 7, 9, 10, 11, 12, 13, 14],
  ]);

  const SHAPES = Object.freeze(["circle", "square", "triangle", "diamond", "half-disc", "ring", "bar", "cross"]);
  const TURNS = 4;    // quarter turns for each shape
  const SQUARES = 4;  // 2 x 2 cover
  const RINGS = 8;
  const RING_PROFILES = 4; // how ring widths are spread; drawn in stage 4

  const MAX_NAME_LENGTH = 500;
  const KEY_BYTES = 32;

  // --- helpers ------------------------------------------------------------

  const subtle = root.crypto.subtle;

  function toHex(bytes) {
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  function bigIntFrom(bytes) {
    let n = 0n;
    for (const b of bytes) n = (n << 8n) | BigInt(b);
    return n;
  }

  // Successive remainders of one big integer.
  function drawer(bytes) {
    let n = bigIntFrom(bytes);
    return function draw(count) {
      const k = BigInt(count);
      const r = n % k;
      n /= k;
      return Number(r);
    };
  }

  // The same name however it is spaced or capitalised: Unicode NFC, runs of
  // whitespace as one space, trimmed, lower case.
  function normalizeName(name) {
    return String(name).normalize("NFC").replace(/\s+/gu, " ").trim().toLowerCase();
  }

  function checkEntity(type, name) {
    if (!Object.prototype.hasOwnProperty.call(NAMES, type)) throw new Error(`unfamiliar sounds: unknown entity type "${type}"`);
    const n = normalizeName(name);
    if (!n) throw new Error("unfamiliar sounds: empty name");
    if (n.length > MAX_NAME_LENGTH) throw new Error("unfamiliar sounds: name too long");
    return n;
  }

  // --- key ----------------------------------------------------------------

  function generateKey() {
    return root.crypto.getRandomValues(new Uint8Array(KEY_BYTES));
  }

  function keyToText(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length !== KEY_BYTES) throw new Error("unfamiliar sounds: key must be 32 bytes");
    return toHex(bytes);
  }

  // Accepts 64 hex digits; spaces and line breaks are ignored.
  function keyFromText(text) {
    const hex = String(text).replace(/\s+/g, "").toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error("unfamiliar sounds: a key is 64 hexadecimal characters");
    return Uint8Array.from(hex.match(/../g), (h) => parseInt(h, 16));
  }

  // --- word list ----------------------------------------------------------

  async function sha256Hex(bytes) {
    return toHex(new Uint8Array(await subtle.digest("SHA-256", bytes)));
  }

  // Checks the exact bytes against the pinned checksum, then parses.
  async function loadWordlist(bytes) {
    const actual = await sha256Hex(bytes);
    if (actual !== WORDLIST.sha256) {
      throw new Error(`unfamiliar sounds: word list checksum ${actual} does not match ${WORDLIST.version} (${WORDLIST.sha256}); refusing to run`);
    }
    const lines = new TextDecoder().decode(bytes).split("\n");
    if (lines[lines.length - 1] === "") lines.pop();
    if (lines.length !== WORDLIST.length) throw new Error(`unfamiliar sounds: word list has ${lines.length} lines`);
    const words = [];
    const byPos = { noun: [], verb: [], adj: [], adv: [] };
    for (const line of lines) {
      const [word, pos] = line.split("\t");
      words.push(word);
      byPos[pos].push(word);
    }
    return Object.freeze({ words, byPos });
  }

  // --- derivation ---------------------------------------------------------

  function pickWords(draw, list, type, order) {
    const spec = NAMES[type];
    if (order === "any") {
      return Array.from({ length: spec.any }, () => list.words[draw(list.words.length)]);
    }
    if (order === "pattern") {
      return spec.pattern.map((pos) => list.byPos[pos][draw(list.byPos[pos].length)]);
    }
    throw new Error(`unfamiliar sounds: unknown word order "${order}"`);
  }

  function nextTo(draw, color) {
    const allowed = CONTRAST[color];
    return allowed[draw(allowed.length)];
  }

  function pickCover(draw) {
    const squares = [];
    for (let i = 0; i < SQUARES; i++) {
      const background = draw(PALETTE.length);
      squares.push({
        background,
        color: nextTo(draw, background),
        shape: SHAPES[draw(SHAPES.length)],
        turn: draw(TURNS),
      });
    }
    return { kind: "cover", squares };
  }

  function pickRings(draw) {
    // Outermost first. Each ring differs clearly from the one outside it.
    const rings = [draw(PALETTE.length)];
    while (rings.length < RINGS) rings.push(nextTo(draw, rings[rings.length - 1]));
    return { kind: "rings", rings, profile: draw(RING_PROFILES) };
  }

  const titleCase = (w) => w.charAt(0).toUpperCase() + w.slice(1);

  // key: Uint8Array(32); wordlistBytes: the raw bytes of the shipped file.
  async function createDeriver({ key, wordlistBytes, wordOrder = WORD_ORDER }) {
    const list = await loadWordlist(wordlistBytes);
    const hmacKey = await subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const cache = new Map();

    async function digest(type, name) {
      const n = checkEntity(type, name);
      const data = new TextEncoder().encode(`${type}:${n}`);
      return new Uint8Array(await subtle.sign("HMAC", hmacKey, data));
    }

    // Each distinct (type, name) is derived once and then served from cache.
    async function derive(type, name) {
      const cacheKey = `${type}:${checkEntity(type, name)}`;
      if (cache.has(cacheKey)) return cache.get(cacheKey);
      const d = await digest(type, name);
      const words = pickWords(drawer(d.subarray(0, 16)), list, type, wordOrder);
      const draw = drawer(d.subarray(16, 32));
      const picture = PICTURE_KIND[type] === "rings" ? pickRings(draw) : pickCover(draw);
      const result = Object.freeze({ type, words, name: words.map(titleCase).join(" "), picture, digest: d });
      cache.set(cacheKey, result);
      return result;
    }

    // A keyed digest of any label (pictures use "picture:<type>:<id>#<n>").
    async function mac(label) {
      return new Uint8Array(await subtle.sign("HMAC", hmacKey, new TextEncoder().encode(label)));
    }

    return Object.freeze({ derive, digest, mac, wordlist: list });
  }

  const api = Object.freeze({
    WORDLIST, WORD_ORDER, NAMES, PICTURE_KIND, PALETTE, CONTRAST, SHAPES, TURNS, RINGS, RING_PROFILES,
    generateKey, keyToText, keyFromText, loadWordlist, createDeriver, sha256Hex, normalizeName,
  });

  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Unfamiliar = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
