// Tests for core/museums.js. Run: node --test test/
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const M = require("../core/museums.js");

const KEY = Buffer.alloc(32, 7);
const mac = (label) => new Uint8Array(crypto.createHmac("sha256", KEY).update(label).digest());

test("the same key, type and ID always give the same chain", () => {
  const chain = (id) => Array.from({ length: 10 }, (_, n) => M.candidate(mac(M.seedLabel("album", id, n))));
  assert.deepEqual(chain("1V8Qu6CwkBfYucnCWxynq8"), chain("1V8Qu6CwkBfYucnCWxynq8"));
  assert.notDeepEqual(chain("1V8Qu6CwkBfYucnCWxynq8"), chain("4GGazqHvuKwxBjWLFaJkDL"));
  assert.notDeepEqual(M.candidate(mac(M.seedLabel("album", "x", 0))), M.candidate(mac(M.seedLabel("artist", "x", 0))));
});

test("a different key gives a different chain", () => {
  const other = (label) => new Uint8Array(crypto.createHmac("sha256", Buffer.alloc(32, 8)).update(label).digest());
  const a = Array.from({ length: 5 }, (_, n) => M.candidate(mac(M.seedLabel("album", "abc", n))));
  const b = Array.from({ length: 5 }, (_, n) => M.candidate(other(M.seedLabel("album", "abc", n))));
  assert.notDeepEqual(a, b);
});

test("museums are chosen in proportion to their free images, IDs stay in range", () => {
  const counts = { met: 0, aic: 0, cma: 0 };
  const N = 20000;
  for (let i = 0; i < N; i++) {
    const c = M.candidate(mac(`sample ${i}`));
    counts[c.museum]++;
    const m = M.MUSEUMS.find((x) => x.name === c.museum);
    assert.ok(Number.isInteger(c.id) && c.id >= m.min && c.id <= m.max, `${c.museum} ${c.id}`);
  }
  for (const m of M.MUSEUMS) {
    const expected = (m.weight / M.TOTAL_WEIGHT) * N;
    assert.ok(Math.abs(counts[m.name] - expected) < expected * 0.08 + 50, `${m.name}: ${counts[m.name]} vs ${expected}`);
  }
});

test("lookup answers: only public-domain / CC0 objects with an image are used", () => {
  assert.equal(M.metImage({ isPublicDomain: true, primaryImageSmall: "https://images.metmuseum.org/a.jpg" }), "https://images.metmuseum.org/a.jpg");
  assert.equal(M.metImage({ isPublicDomain: false, primaryImageSmall: "" }), null);
  assert.equal(M.metImage({ isPublicDomain: true, primaryImageSmall: "" }), null);
  assert.equal(M.cmaImage({ data: { share_license_status: "CC0", images: { web: { url: "https://openaccess-cdn.clevelandart.org/1/1_web.jpg" } } } }), "https://openaccess-cdn.clevelandart.org/1/1_web.jpg");
  assert.equal(M.cmaImage({ data: { share_license_status: "Copyrighted", images: null } }), null);
  assert.equal(M.aicImage({ is_public_domain: true, image_id: "2d484387-2509-5e8e-2c43-22f9981972eb" }),
    "https://www.artic.edu/iiif/2/2d484387-2509-5e8e-2c43-22f9981972eb/full/400,/0/default.jpg");
  assert.equal(M.aicImage({ is_public_domain: false, image_id: "x" }), null);
});

test("only the museums' own image servers are trusted", () => {
  assert.ok(M.isMuseumImage("https://images.metmuseum.org/CRDImages/ep/web-large/x.jpg"));
  assert.ok(M.isMuseumImage("https://www.artic.edu/iiif/2/abc/full/400,/0/default.jpg"));
  assert.ok(M.isMuseumImage("https://openaccess-cdn.clevelandart.org/1915.534/1915.534_web.jpg"));
  assert.ok(!M.isMuseumImage("https://example.com/x.jpg"));
  assert.ok(!M.isMuseumImage("http://images.metmuseum.org/x.jpg"));
});
