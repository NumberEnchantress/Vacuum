// A guard against losing a function while editing background.js (it happened
// once): every plain function call in it must be defined in the background
// scripts or be a known browser/JS global. Run: node --test test/
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

test("every function background.js calls is defined", () => {
  const manifest = JSON.parse(read("manifest.json"));
  const all = manifest.background.scripts.map(read).join("\n");
  const background = read("background.js")
    .replace(/\/\/.*$/gm, "")                  // comments
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""');    // double-quoted strings
  const called = new Set([...background.matchAll(/(?<![\w.$])([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]));
  const defined = new Set([
    ...[...all.matchAll(/function\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]),
    ...[...all.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)].map((m) => m[1]),
  ]);
  const globals = new Set(["async", "if", "for", "while", "switch", "catch", "return", "function", "typeof", "await",
    "fetch", "setTimeout", "clearTimeout", "Promise", "Map", "Set", "String", "Number", "Boolean", "Error", "Object",
    "Array", "JSON", "Math", "Date", "BigInt", "Uint8Array", "encodeURIComponent", "createImageBitmap",
    "OffscreenCanvas", "FileReader", "TextEncoder", "TextDecoder", "parseInt", "resolve", "reject", "task", "run"]);
  const missing = [...called].filter((name) => !defined.has(name) && !globals.has(name));
  assert.deepEqual(missing, []);
});
