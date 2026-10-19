// Compare page captures taken with unfamiliar sounds off and on, and list possible leaks.
//
//   node tools/leakcheck.mjs <folder>
//
// The folder holds off-<page>.json and on-<page>.json, each
// {url, docTitle, texts: [visible text nodes], titles: [title attributes]}.
// A LEAK is text shown with unfamiliar sounds on that was also shown with it off, and
// that is neither a stand-in name, nor allowed by the extension's own
// allow-list (content/selectors.js), nor fixed UI text listed below.
// UNKNOWN is on-only text that isn't a stand-in name; worth a look.

import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const S = require("../content/selectors.js");
const WORDS = new Set(readFileSync(new URL("../data/wordlist_v2-full.tsv", import.meta.url), "utf8")
  .split("\n").filter(Boolean).map((l) => l.split("\t")[0]));

// Text in zones the extension leaves alone on purpose (nav bar, sidebar
// promos, footer, signup bar), checked by hand.
const UI = new Set([
  "Skip to main content", "What do you want to play?", "Ctrl", "Shift", "L", "Premium", "Support", "Download",
  "Install App", "Sign up", "Log in", "Legal", "Safety & Privacy Center", "Privacy Policy", "Cookies", "About Ads",
  "Accessibility", "Notice at Collection", "Your Privacy Choices", "English", "Resize main navigation",
  "Preview of Spotify", "Sign up free", "Change progress", "Change volume",
  "Sign up to get unlimited songs and podcasts with occasional ads. No credit card needed.",
  "Company", "Communities", "Useful links", "Spotify Plans", "About", "Jobs", "For the Record", "For Artists",
  "Developers", "Advertising", "Investors", "Vendors", "Free Mobile App", "Popular by Country", "Import your music",
  "Premium Individual", "Premium Duo", "Premium Family", "Premium Student", "Spotify Free", "Audiobooks Access",
  "For Authors", "For Creators", "Top Song Lyrics", "X", "Instagram", "Facebook", "© 2026 Spotify AB",
]);

const isSafe = (t) => S.SAFE_PHRASES.has(t) || S.SAFE_PATTERNS.some((re) => re.test(t));
const isStandIn = (t) => {
  const name = t.replace(/ · Spotify$/, "");
  const parts = name.split(" ");
  return parts.length >= 2 && parts.length <= 3 && parts.every((p) => /^[A-Z]/.test(p) && WORDS.has(p.toLowerCase()));
};

const folder = process.argv[2];
let total = 0;
for (const file of readdirSync(folder).filter((f) => /^on-.*\.json$/.test(f)).sort()) {
  const page = file.slice(3, -5);
  const on = JSON.parse(readFileSync(path.join(folder, file), "utf8"));
  const off = JSON.parse(readFileSync(path.join(folder, `off-${page}.json`), "utf8"));
  const real = new Set([...off.texts, ...off.titles, off.docTitle]);
  const shown = [...on.texts, ...on.titles, on.docTitle];
  const ok = (t) => isStandIn(t) || isSafe(t) || UI.has(t);
  const leaks = [...new Set(shown.filter((t) => real.has(t) && !ok(t)))].sort();
  const unknown = [...new Set(shown.filter((t) => !real.has(t) && !ok(t)))].sort();
  console.log(`== ${page}: ${on.texts.length} texts, ${shown.filter(isStandIn).length} stand-in names, title ${JSON.stringify(on.docTitle)}`);
  for (const t of leaks) console.log(`   LEAK    ${JSON.stringify(t)}`);
  for (const t of unknown) console.log(`   UNKNOWN ${JSON.stringify(t)}`);
  total += leaks.length;
}
console.log(`\n${total} possible leaks`);
