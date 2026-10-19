// Makes a test build of the extension for automated testing.
//
//   node tools/make-dev-build.mjs <output folder>
//
// The copy is named "unfamiliar sounds (dev)" (which switches on the
// background's test handler, see devOp in background.js) and adds a small
// content script, dev/bridge.js, on Spotify and example.com pages. A tester
// running script in the page can then call:
//
//   window.postMessage({ unfamiliarDev: "<op>", args: {...}, id: 1 }, "*")
//
// and gets { unfamiliarDevReply: 1, result | error } back via postMessage.
// Ops: state, setSettings, resetSettings, setOn, setSeed, seedInfo,
// setLibrary, clearPictureCaches, tabs. It also has broad https access so a
// test picture list works without the permission prompt.
//
// Never install a test build for normal use: any page script could change
// settings through the bridge.

import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.resolve(process.argv[2] || "");
if (!process.argv[2] || out.startsWith(root)) throw new Error("give an output folder outside the extension");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const entry of ["manifest.json", "background.js", "core", "content", "options", "prompt", "icons", "data"]) {
  cpSync(path.join(root, entry), path.join(out, entry), { recursive: true });
}

const manifest = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8"));
manifest.name = `${manifest.name} (dev)`;
manifest.permissions = [...manifest.permissions, "https://*/*"];
manifest.content_scripts = [{ matches: ["*://open.spotify.com/*", "*://example.com/*"], js: ["dev/bridge.js"], run_at: "document_start" }];
writeFileSync(path.join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

mkdirSync(path.join(out, "dev"), { recursive: true });
writeFileSync(path.join(out, "dev", "bridge.js"), `"use strict";
// Test builds only: relays test commands from the page to the background.
window.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || typeof data.unfamiliarDev !== "string") return;
  browser.runtime.sendMessage({ type: "unfamiliar:dev", op: data.unfamiliarDev, args: data.args || {} }).then(
    (result) => window.postMessage({ unfamiliarDevReply: data.id, result: JSON.parse(JSON.stringify(result === undefined ? null : result)) }, "*"),
    (error) => window.postMessage({ unfamiliarDevReply: data.id, error: String(error && error.message || error) }, "*"),
  );
});
`);
console.log(`test build written to ${out}`);
