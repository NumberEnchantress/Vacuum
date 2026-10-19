// Builds review/palette-sample.html: each palette proposal shown as swatches
// (also under simulated color blindness) and as sample covers and artist
// pictures made by the real derivation code. Development tool.
//
//   node tools/palette-sample.mjs

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import { PROPOSALS, summary, combinations, contrastTable, ADJACENT_MIN } from "./palette.mjs";
import { simulate } from "./colorcheck.mjs";

const require = createRequire(import.meta.url);
const ROOT = new URL("../", import.meta.url);
const CORE_SRC = readFileSync(new URL("core/derive.js", ROOT), "utf8");
const { pictureSvg } = require("../core/pictures.js");
const WORDLIST = new Uint8Array(readFileSync(new URL("data/wordlist_v2-full.tsv", ROOT)));

// Load core/derive.js with a proposal's palette swapped in, so the sample
// uses exactly the derivation logic the extension ships.
function coreWith(colors) {
  const src = CORE_SRC
    .replace(/const PALETTE = Object\.freeze\(\[[\s\S]*?\n  \]\);/, `const PALETTE = Object.freeze(${JSON.stringify(colors)});`)
    .replace(/const CONTRAST = Object\.freeze\(\[[\s\S]*?\n  \]\);/, `const CONTRAST = Object.freeze(${JSON.stringify(contrastTable(colors))});`);
  const sandbox = { crypto: globalThis.crypto, TextEncoder, TextDecoder, module: { exports: {} } };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(src, sandbox);
  return sandbox.module.exports;
}

function fakeIds(count, seed) {
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  return Array.from({ length: count }, () => Array.from({ length: 22 }, () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return chars[seed % 62];
  }).join(""));
}

const SAMPLE_KEY = Uint8Array.from({ length: 32 }, (_, i) => (i * 37 + 11) % 256);
const VISIONS = [["normal", "Normal"], ["protan", "Protanopia"], ["deutan", "Deuteranopia"], ["tritan", "Tritanopia"]];
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

async function section(name, p) {
  const Unfamiliar = coreWith(p.colors);
  const d = await Unfamiliar.createDeriver({ key: SAMPLE_KEY, wordlistBytes: WORDLIST });
  const s = summary(p.colors), c = combinations(p.colors);
  const albums = await Promise.all(fakeIds(12, 101).map((id) => d.derive("album", id)));
  const artists = await Promise.all(fakeIds(12, 202).map((id) => d.derive("artist", id)));

  const swatches = VISIONS.map(([v, label]) =>
    `<div class="swrow"><span class="vlabel">${label}</span>${p.colors.map((hex) =>
      `<span class="sw" style="background:${simulate(hex, v)}" title="${hex}"></span>`).join("")}</div>`).join("");

  const albumCards = albums.map((a, i) => `<figure class="card">${pictureSvg(a.picture, p.colors, 140)}
    <figcaption><b>${esc(a.name)}</b><span class="by">${pictureSvg(artists[i].picture, p.colors, 18)} ${esc(artists[i].name)}</span></figcaption></figure>`).join("");

  const artistCards = artists.slice(0, 8).map((a) => `<figure class="card artist">${pictureSvg(a.picture, p.colors, 120)}
    <figcaption><b>${esc(a.name)}</b><span class="by">Artist</span></figcaption></figure>`).join("");

  const small = [...albums.slice(0, 8).map((a) => pictureSvg(a.picture, p.colors, 40)),
                 ...artists.slice(0, 8).map((a) => pictureSvg(a.picture, p.colors, 32))].join("");

  return `<section id="${name}">
  <h2>${esc(p.label)}</h2>
  <p class="stats">Closest pair of colors, worst case across the four kinds of vision: <b>ΔE ${s.worst.toFixed(1)}</b>.
  Colors that sit next to each other must be at least ΔE ${ADJACENT_MIN} apart; each color has ${s.minNeighbours} to ${Math.max(...s.table.map((t) => t.length))} allowed neighbours.
  Possible covers: ${c.covers.toExponential(1).replace("e+", " × 10^")}. Possible artist pictures: ${(c.rings * 4).toExponential(1).replace("e+", " × 10^")}.</p>
  <div class="swatches">${swatches}</div>
  <h3>Albums</h3><div class="grid">${albumCards}</div>
  <h3>Artists</h3><div class="grid">${artistCards}</div>
  <h3>Small, as in lists and the now-playing bar</h3><div class="small">${small}</div>
</section>`;
}

const sections = [];
for (const [name, p] of Object.entries(PROPOSALS)) sections.push(await section(name, p));

// Machado et al. (2009) matrices; SVG filters work in linear RGB by default,
// which is what these matrices expect.
const MATRICES = {
  protan: "0.152286 1.052583 -0.204868 0 0  0.114503 0.786281 0.099216 0 0  -0.003882 -0.048116 1.051998 0 0  0 0 0 1 0",
  deutan: "0.367322 0.860646 -0.227968 0 0  0.280085 0.672501 0.047413 0 0  -0.011820 0.042940 0.968881 0 0  0 0 0 1 0",
  tritan: "1.255528 -0.076749 -0.178779 0 0  -0.078411 0.930809 0.147602 0 0  0.004733 0.691367 0.303900 0 0  0 0 0 1 0",
  grey:   "0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0 0 0 1 0",
};

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>unfamiliar sounds palette sample</title>
<style>
  :root { --bg: #121212; --panel: #1e1e1e; --text: #f2f2f2; --muted: #a7a7a7; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.5 system-ui, sans-serif; }
  header { position: sticky; top: 0; z-index: 2; background: #000c; backdrop-filter: blur(6px); padding: 12px 16px; border-bottom: 1px solid #333; }
  header h1 { font-size: 18px; margin: 0 0 6px; }
  header p { margin: 0 0 8px; color: var(--muted); font-size: 13px; max-width: 70ch; }
  .views button { background: var(--panel); color: var(--text); border: 1px solid #444; border-radius: 999px; padding: 4px 12px; margin: 2px 4px 2px 0; cursor: pointer; font: inherit; font-size: 13px; }
  .views button[aria-pressed="true"] { background: var(--text); color: #000; }
  main { padding: 0 16px 48px; max-width: 1100px; }
  section { border-top: 1px solid #333; padding-top: 8px; margin-top: 24px; }
  h2 { font-size: 20px; } h3 { font-size: 14px; color: var(--muted); font-weight: 600; margin: 20px 0 8px; }
  .stats { color: var(--muted); font-size: 13px; max-width: 80ch; }
  .stats b { color: var(--text); }
  .swrow { display: flex; align-items: center; gap: 4px; margin: 3px 0; flex-wrap: wrap; }
  .vlabel { width: 100px; font-size: 12px; color: var(--muted); }
  .sw { width: 30px; height: 30px; border-radius: 4px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; }
  .card { margin: 0; background: var(--panel); padding: 10px; border-radius: 8px; }
  .card svg { display: block; width: 100%; height: auto; border-radius: 4px; }
  .card.artist svg { border-radius: 50%; }
  figcaption { margin-top: 8px; font-size: 13px; }
  figcaption b { display: block; font-weight: 600; }
  .by { color: var(--muted); display: flex; align-items: center; gap: 6px; }
  .by svg { width: 18px; height: 18px; border-radius: 50%; flex: none; }
  .small { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .small svg[width="32"] { border-radius: 50%; }
  .small svg[width="40"] { border-radius: 3px; }
  main.protan { filter: url(#protan); } main.deutan { filter: url(#deutan); }
  main.tritan { filter: url(#tritan); } main.grey { filter: url(#grey); }
</style>
</head>
<body>
<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  ${Object.entries(MATRICES).map(([k, m]) => `<filter id="${k}"><feColorMatrix type="matrix" values="${m}"/></filter>`).join("\n  ")}
</svg>
<header>
  <h1>unfamiliar sounds palette sample</h1>
  <p>Three palettes, each shown with the real derivation code and a made-up sample key. The names are option A (any words). The buttons below simulate how the page looks with each kind of color blindness.</p>
  <div class="views">
    <button data-v="" aria-pressed="true">Normal vision</button>
    <button data-v="protan" aria-pressed="false">Protanopia</button>
    <button data-v="deutan" aria-pressed="false">Deuteranopia</button>
    <button data-v="tritan" aria-pressed="false">Tritanopia</button>
    <button data-v="grey" aria-pressed="false">Greyscale</button>
  </div>
</header>
<main>
${sections.join("\n")}
</main>
<script>
  const main = document.querySelector("main");
  document.querySelectorAll(".views button").forEach((b) => b.addEventListener("click", () => {
    main.className = b.dataset.v;
    document.querySelectorAll(".views button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  }));
</script>
</body>
</html>
`;

mkdirSync(new URL("review/", ROOT), { recursive: true });
writeFileSync(new URL("review/palette-sample.html", ROOT), html);
console.log("wrote review/palette-sample.html");
