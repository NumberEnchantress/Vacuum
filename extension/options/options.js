"use strict";

const $ = (id) => document.getElementById(id);
const send = (message) => browser.runtime.sendMessage(message);

// --- switch -------------------------------------------------------------

$("on").addEventListener("change", () => browser.storage.local.set({ on: $("on").checked }));

// --- settings -------------------------------------------------------------

const SWITCHES = ["hideArtistDescriptions", "hidePlaylistDescriptions", "showThemeTitles",
  "replaceOwnProfile", "replaceOwnPlaylists", "hidePages", "askOnOpen"];

// Only the settings you change are stored; everything else follows the defaults.
async function saveSetting(change) {
  const { settings = {} } = await browser.storage.local.get("settings");
  await browser.storage.local.set({ settings: Object.assign({}, settings, change) });
}

// The background fills in defaults for anything not stored yet.
async function showSettings() {
  const settings = await send({ type: "unfamiliar:get-settings" });
  for (const name of SWITCHES) $(name).checked = Boolean(settings[name]);
  $("convertOffTabs").checked = settings.offTabs === "convert";
  for (const radio of document.querySelectorAll('input[name="pictureSource"]')) radio.checked = radio.value === settings.pictureSource;
}

for (const name of SWITCHES) $(name).addEventListener("change", () => saveSetting({ [name]: $(name).checked }));
$("convertOffTabs").addEventListener("change", () => saveSetting({ offTabs: $("convertOffTabs").checked ? "convert" : "close" }));
for (const radio of document.querySelectorAll('input[name="pictureSource"]')) {
  radio.addEventListener("change", () => saveSetting({ pictureSource: radio.value, picturesChosen: true }));
}

// --- seed -----------------------------------------------------------------
// The page only ever learns whether the shared seed is in use, your own seed
// if you set one, and a test name. The shared seed itself never reaches it.

let customSeedText = null;
let seedShown = false;

function showSeedText() {
  $("seedText").textContent = seedShown && customSeedText ? customSeedText : "••••••••";
  $("showSeed").textContent = seedShown ? "Hide" : "Show";
}

async function showSeed() {
  const info = await send({ type: "unfamiliar:seed-info" });
  customSeedText = info.custom ? info.text : null;
  $("seedStatus").textContent = info.custom ? "Using your own seed." : "Using the shared seed.";
  $("customSeed").hidden = !info.custom;
  $("check").textContent = info.check;
  showSeedText();
}

function seedMessage(text, ok) {
  $("seedMessage").textContent = text;
  $("seedMessage").className = ok ? "ok" : "bad";
}

$("showSeed").addEventListener("click", () => { seedShown = !seedShown; showSeedText(); });

$("copySeed").addEventListener("click", async () => {
  if (!customSeedText) return;
  await navigator.clipboard.writeText(customSeedText);
  $("copySeed").textContent = "Copied";
  setTimeout(() => { $("copySeed").textContent = "Copy"; }, 1500);
});

$("saveSeed").addEventListener("click", () => {
  if (!customSeedText) return;
  const blob = new Blob([`unfamiliar sounds seed\n${customSeedText}\n`], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "unfamiliar-sounds-seed.txt";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$("randomSeed").addEventListener("click", () => {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  $("newSeed").value = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
});

$("useSeed").addEventListener("click", async () => {
  // Accept a pasted seed file too (header line from this page, or the
  // "secret key" files of earlier versions).
  const text = $("newSeed").value.replace(/^(unfamiliar sounds seed|unfamiliar sounds secret key|De-ID secret key)\s*/i, "").trim();
  if (text.length < 8) return seedMessage("A seed is at least 8 characters.", false);
  if (text === customSeedText) return seedMessage("That is already the seed in use.", true);
  if (!confirm("Use this seed? Every stand-in name and picture changes to the ones this seed makes.")) return;
  try {
    await send({ type: "unfamiliar:set-seed", text });
    $("newSeed").value = "";
    seedMessage("Seed changed.", true);
  } catch (e) {
    seedMessage(e.message, false);
  }
});

$("defaultSeed").addEventListener("click", async () => {
  if (!confirm("Go back to the shared seed? Every stand-in name and picture changes back to everyone's. Your own seed is forgotten unless you saved it.")) return;
  await send({ type: "unfamiliar:set-seed", text: null });
  seedMessage("Using the shared seed again.", true);
});

// --- your own picture list ---------------------------------------------------

let pendingLibrary = null;

// One https address per line; the first https field on each line is used.
function parseLibrary(text) {
  const urls = [];
  const seen = new Set();
  for (const line of text.split(/\r?\n/)) {
    for (const field of line.split(/[,\t;]/)) {
      const value = field.trim().replace(/^"(.*)"$/, "$1").trim();
      if (/^https:\/\/[^\s"]+$/.test(value)) {
        if (!seen.has(value)) { seen.add(value); urls.push(value); }
        break;
      }
    }
  }
  return urls;
}

function originsOf(urls) {
  return [...new Set(urls.map((u) => `${new URL(u).origin}/*`))];
}

$("libraryFile").addEventListener("change", async () => {
  const file = $("libraryFile").files[0];
  pendingLibrary = null;
  $("useLibrary").disabled = true;
  if (!file) return;
  const urls = parseLibrary(await file.text()).slice(0, 200000);
  if (!urls.length) {
    $("libraryStatus").textContent = "No https image addresses found in that file.";
    $("libraryStatus").className = "bad";
    return;
  }
  pendingLibrary = { name: file.name, urls };
  $("libraryStatus").textContent = `${urls.length.toLocaleString()} images from ${originsOf(urls).length} site(s). Press "Use this list"; you'll be asked to allow those sites.`;
  $("libraryStatus").className = "note";
  $("useLibrary").disabled = false;
});

$("useLibrary").addEventListener("click", async () => {
  if (!pendingLibrary) return;
  // Asked for during the click, as browsers require.
  const granted = await browser.permissions.request({ origins: originsOf(pendingLibrary.urls) });
  if (!granted) {
    $("libraryStatus").textContent = "Not allowed, so the list wasn't loaded.";
    $("libraryStatus").className = "bad";
    return;
  }
  await browser.storage.local.set({ customLibrary: pendingLibrary });
  await saveSetting({ pictureSource: "custom", picturesChosen: true });
  $("libraryStatus").textContent = `Using "${pendingLibrary.name}": ${pendingLibrary.urls.length.toLocaleString()} images.`;
  $("libraryStatus").className = "ok";
});

async function showLibrary() {
  const { customLibrary } = await browser.storage.local.get("customLibrary");
  if (customLibrary && customLibrary.urls && customLibrary.urls.length && !$("libraryStatus").textContent) {
    $("libraryStatus").textContent = `Loaded: "${customLibrary.name}", ${customLibrary.urls.length.toLocaleString()} images.`;
  }
}

// --- word list -----------------------------------------------------------

async function checkWordlist() {
  const el = $("wordlist");
  try {
    const res = await fetch(browser.runtime.getURL(Unfamiliar.WORDLIST.file));
    await Unfamiliar.loadWordlist(new Uint8Array(await res.arrayBuffer()));
    el.textContent = `Version ${Unfamiliar.WORDLIST.version}, ${Unfamiliar.WORDLIST.length.toLocaleString()} words, checksum verified.`;
    el.className = "ok";
  } catch (e) {
    el.textContent = e.message;
    el.className = "bad";
  }
}

// --- playlist verdicts (TEMPORARY counter) -------------------------------

function showVerdicts(map) {
  const counts = { theme: 0, person: 0, popularity: 0, unsure: 0 };
  for (const v of Object.values(map || {})) if (v in counts) counts[v]++;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  $("verdicts").textContent = total
    ? `${total} playlists: ${counts.theme} theme (shown), ${counts.person} person, ${counts.popularity} popularity, ${counts.unsure} unsure (hidden).`
    : "None yet.";
}

$("resetVerdicts").addEventListener("click", () => {
  if (confirm("Forget all playlist verdicts? Playlists judged as about a person will be judged again when next seen.")) {
    browser.storage.local.remove("playlistVerdicts");
  }
});

// --- state --------------------------------------------------------------

async function load() {
  const stored = await browser.storage.local.get({ on: false, playlistVerdicts: {} });
  $("on").checked = stored.on;
  showVerdicts(stored.playlistVerdicts);
  await showSettings();
  await showSeed();
  await showLibrary();
}

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if ("on" in changes) $("on").checked = Boolean(changes.on.newValue);
  if ("seed" in changes) showSeed();
  if ("playlistVerdicts" in changes) showVerdicts(changes.playlistVerdicts.newValue);
  if ("settings" in changes) showSettings();
});

checkWordlist().then(load);
