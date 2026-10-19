// unfamiliar sounds: which museum artwork stands in for a cover or an artist
// picture (Violet's choice, 17 October 2026).
//
// From your secret key and the Spotify ID of a release, artist or playlist,
// a fixed chain of candidates is derived:
//
//   bytes_n  = HMAC-SHA-256(key, "picture:" + type + ":" + id + "#" + n)
//   museum   = bytes 0..7 as a number, mod the sum of the weights
//              (weights are each museum's count of free images, so every
//              image is about equally likely)
//   object   = bytes 8..15 as a number, mod the museum's ID range
//
// The background walks the chain in order (n = 0, 1, 2, …) and takes the
// first candidate that exists, is public domain / CC0 and has an image. Same
// key and ID, same chain, same image. The answer is then cached for good, so
// later changes at a museum can't move it.
//
// No safety filtering for now (Violet, 17 October 2026).
//
// Plain script with no imports: background page and Node tests.

(function (root) {
  "use strict";

  // Counts of free-to-use objects with images and ID ranges, checked against
  // each API on 17 October 2026 (see HANDOFF.md).
  const MUSEUMS = Object.freeze([
    Object.freeze({ name: "met", weight: 371112, min: 1, max: 900000 }),      // The Met, integer object IDs
    Object.freeze({ name: "aic", weight: 59063, min: 1, max: 288000 }),       // Art Institute of Chicago
    Object.freeze({ name: "cma", weight: 41820, min: 90000, max: 180000 }),   // Cleveland Museum of Art
  ]);
  const TOTAL_WEIGHT = MUSEUMS.reduce((sum, m) => sum + m.weight, 0);

  // Give up (and keep the generated picture) after this many candidates.
  const MAX_CANDIDATES = 40;

  // AIC asks for its cached widths (200, 400, 600, 843).
  const AIC_WIDTH = 400;

  function bigIntFrom(bytes) {
    let n = 0n;
    for (const b of bytes) n = (n << 8n) | BigInt(b);
    return n;
  }

  function seedLabel(type, id, n) {
    return `picture:${type}:${id}#${n}`;
  }

  // One candidate from one HMAC output (32 bytes).
  function candidate(bytes) {
    let pick = Number(bigIntFrom(bytes.subarray(0, 8)) % BigInt(TOTAL_WEIGHT));
    let museum = MUSEUMS[MUSEUMS.length - 1];
    for (const m of MUSEUMS) {
      if (pick < m.weight) { museum = m; break; }
      pick -= m.weight;
    }
    const span = BigInt(museum.max - museum.min + 1);
    const id = museum.min + Number(bigIntFrom(bytes.subarray(8, 16)) % span);
    return { museum: museum.name, id };
  }

  // --- the APIs ------------------------------------------------------------

  function lookupUrl(museum, id) {
    if (museum === "met") return `https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`;
    if (museum === "cma") return `https://openaccess-api.clevelandart.org/api/artworks/${id}`;
    throw new Error(`no single lookup for ${museum}`);
  }

  // AIC answers up to 100 IDs at once and leaves out the ones that don't exist.
  function aicBatchUrl(ids) {
    return `https://api.artic.edu/api/v1/artworks?ids=${ids.join(",")}&fields=id,is_public_domain,image_id&limit=100`;
  }

  // The image address for a lookup answer, or null if the object can't be used.
  function metImage(json) {
    return json && json.isPublicDomain === true && json.primaryImageSmall ? json.primaryImageSmall : null;
  }

  function cmaImage(json) {
    const d = json && json.data;
    const url = d && d.share_license_status === "CC0" && d.images && d.images.web && d.images.web.url;
    return url || null;
  }

  function aicImage(record) {
    return record && record.is_public_domain === true && record.image_id
      ? `https://www.artic.edu/iiif/2/${record.image_id}/full/${AIC_WIDTH},/0/default.jpg`
      : null;
  }

  // Only image addresses on the museums' own image servers are fetched.
  const IMAGE_HOSTS = /^https:\/\/(images\.metmuseum\.org\/|www\.artic\.edu\/iiif\/|openaccess-cdn\.clevelandart\.org\/)/;
  function isMuseumImage(url) {
    return IMAGE_HOSTS.test(url || "");
  }

  const api = Object.freeze({
    MUSEUMS, TOTAL_WEIGHT, MAX_CANDIDATES, seedLabel, candidate,
    lookupUrl, aicBatchUrl, metImage, cmaImage, aicImage, isMuseumImage,
  });
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.UnfamiliarMuseums = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
