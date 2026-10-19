// Palette proposals and the adjacency (contrast) table. Development tool.
//
//   node tools/palette.mjs report          distances for every proposal
//   node tools/palette.mjs apply <name>    write PALETTE and CONTRAST into core/derive.js
//
// "Worst" distance = smallest CIEDE2000 distance across normal vision and
// simulated protanopia, deuteranopia and tritanopia (see colorcheck.mjs).

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { worstDistance } from "./colorcheck.mjs";

// Colors next to each other (shape on square, neighbouring rings) must be at
// least this far apart for every kind of vision.
export const ADJACENT_MIN = 20;

// Picked by max-min search over Paul Tol's and Okabe & Ito's colour-blind
// safe palettes plus a few neutrals, with orange, vermilion and yellow forced in.
export const PROPOSALS = {
  p16: {
    label: "16 colors (approved)",
    colors: [
      "#1A1A1A", // black
      "#332288", // indigo
      "#0077BB", // blue
      "#77AADD", // light blue
      "#99DDFF", // pale cyan
      "#225555", // dark teal
      "#009E73", // green
      "#666633", // olive
      "#F0E442", // yellow
      "#E69F00", // orange
      "#D55E00", // vermilion
      "#663333", // brown
      "#CC79A7", // pink
      "#AA4499", // purple
      "#777777", // grey
      "#F4EFE6", // cream
    ],
  },
  p12: {
    label: "12 colors (more separation)",
    colors: [
      "#1A1A1A", // black
      "#332288", // indigo
      "#4477AA", // blue
      "#99DDFF", // pale cyan
      "#44BB99", // mint
      "#225522", // dark green
      "#F0E442", // yellow
      "#E69F00", // orange
      "#D55E00", // vermilion
      "#882255", // wine
      "#777777", // grey
      "#F4EFE6", // cream
    ],
  },
  p16opt: {
    label: "16 colors, numerically optimised (for comparison)",
    colors: [
      "#29015E", "#42507A", "#7B66C9", "#87A1F2", "#81E3F3", "#55818A", "#0E252A", "#D5F1E5",
      "#FDDFA3", "#BB9F75", "#AF6A14", "#6B4E2A", "#450E02", "#857868", "#545354", "#A9A9A9",
    ],
  },
};

export function distances(colors) {
  return colors.map((a) => colors.map((b) => (a === b ? 0 : worstDistance(a, b))));
}

export function contrastTable(colors, min = ADJACENT_MIN) {
  const d = distances(colors);
  return colors.map((_, i) => colors.map((_, j) => j).filter((j) => j !== i && d[i][j] >= min));
}

export function summary(colors) {
  const d = distances(colors);
  let worst = Infinity, pair = null;
  for (let i = 0; i < colors.length; i++) for (let j = i + 1; j < colors.length; j++) {
    if (d[i][j] < worst) { worst = d[i][j]; pair = [colors[i], colors[j]]; }
  }
  const table = contrastTable(colors);
  const counts = table.map((t) => t.length);
  return { worst, pair, minNeighbours: Math.min(...counts), meanNeighbours: counts.reduce((a, b) => a + b, 0) / counts.length, table };
}

// Number of different covers and ring pictures this palette allows.
export function combinations(colors) {
  const { table } = summary(colors);
  const neighbours = table.reduce((a, t) => a + t.length, 0);       // ordered (background, shape colour) pairs
  const perSquare = neighbours * 8 * 4;                                 // x shapes x quarter turns
  // Rings: count colour sequences of length 8 where each follows the table.
  let ways = colors.map(() => 1);
  for (let r = 1; r < 8; r++) ways = colors.map((_, i) => table[i].reduce((a, j) => a + ways[j], 0));
  return { covers: perSquare ** 4, rings: ways.reduce((a, b) => a + b, 0) };
}

function apply(name) {
  const p = PROPOSALS[name];
  if (!p) throw new Error(`no proposal "${name}"`);
  const file = fileURLToPath(new URL("../core/derive.js", import.meta.url));
  let src = readFileSync(file, "utf8");
  const palette = p.colors.map((c) => `    "${c}",`).join("\n");
  const contrast = contrastTable(p.colors).map((t) => `    [${t.join(", ")}],`).join("\n");
  src = src.replace(/const PALETTE = Object\.freeze\(\[[\s\S]*?\n  \]\);/, `const PALETTE = Object.freeze([\n${palette}\n  ]);`);
  src = src.replace(/const CONTRAST = Object\.freeze\(\[[\s\S]*?\n  \]\);/, `const CONTRAST = Object.freeze([\n${contrast}\n  ]);`);
  writeFileSync(file, src);
  console.log(`wrote ${name} (${p.colors.length} colors) into core/derive.js`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === "apply") apply(arg);
  else for (const [name, p] of Object.entries(PROPOSALS)) {
    const s = summary(p.colors), c = combinations(p.colors);
    console.log(`${name}: worst pair ${s.worst.toFixed(1)} ${s.pair.join("~")}; neighbours min ${s.minNeighbours} mean ${s.meanNeighbours.toFixed(1)}; covers ${c.covers.toExponential(1)}; rings ${c.rings.toExponential(1)}`);
  }
}
