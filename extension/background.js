// unfamiliar sounds background: the on/off switch and the unfamiliar sounds container.
//
// While on, every open.spotify.com page loads inside the "unfamiliar sounds" container,
// and the content script is registered for that container only. While off,
// nothing is redirected and no content script is registered, so Spotify is
// untouched. The state lives in storage.local and survives restarts.

"use strict";

const SPOTIFY_MATCH = ["*://open.spotify.com/*"];
const CONTAINER = { name: "unfamiliar sounds", color: "purple", icon: "fence" };

let on = false;
let containerId = null;    // cookieStoreId of the unfamiliar sounds container, once known
let registration = null;   // handle from contentScripts.register
const reopening = new Set(); // tab ids we are already moving

// --- container ----------------------------------------------------------

// The project was called De-ID until 17 October 2026; a container made then is
// renamed rather than replaced, so its tabs and Spotify login carry over.
const OLD_CONTAINER_NAME = "De-ID";

async function ensureContainer() {
  if (containerId) return containerId;
  let found = await browser.contextualIdentities.query({ name: CONTAINER.name });
  if (!found.length) {
    const old = await browser.contextualIdentities.query({ name: OLD_CONTAINER_NAME });
    if (old.length) found = [await browser.contextualIdentities.update(old[0].cookieStoreId, CONTAINER)];
  }
  const identity = found.length ? found[0] : await browser.contextualIdentities.create(CONTAINER);
  containerId = identity.cookieStoreId;
  return containerId;
}

browser.contextualIdentities.onRemoved.addListener(({ contextualIdentity }) => {
  if (contextualIdentity.cookieStoreId !== containerId) return;
  // Someone deleted the container. Forget it; it is made again on next use.
  containerId = null;
  unregisterContent();
  if (on) ensureContainer().then(registerContent).catch(reportError);
});

// --- content script -----------------------------------------------------

async function registerContent() {
  if (registration) return;
  registration = await browser.contentScripts.register({
    matches: SPOTIFY_MATCH,
    js: [{ file: "core/collections.js" }, { file: "content/selectors.js" }, { file: "content/unfamiliar.js" }],
    css: [{ file: "content/unfamiliar.css" }],
    runAt: "document_start",
    cookieStoreId: containerId,
  });
}

function unregisterContent() {
  if (!registration) return;
  registration.unregister();
  registration = null;
}

// --- moving tabs into the container -------------------------------------

// Pages a tab may be showing that are not worth keeping when we move it.
function isThrowaway(url) {
  return !url || url === "about:blank" || url === "about:newtab" || url === "about:home" ||
         /^https?:\/\/open\.spotify\.com\//.test(url);
}

async function reopenInContainer(tab, url) {
  const id = await ensureContainer();
  await browser.tabs.create({
    url,
    cookieStoreId: id,
    windowId: tab.windowId,
    index: tab.index + 1,
    active: tab.active,
    pinned: tab.pinned,
  });
  // A tab that was on some other site (a search result, say) stays where it
  // was; a blank or Spotify tab is replaced.
  if (isThrowaway(tab.url)) await browser.tabs.remove(tab.id);
}

// Tabs allowed to open one Spotify address normally, after "Open normally".
const openNormally = new Map(); // tab id -> url

async function onBeforeRequest(details) {
  if (!on || details.tabId < 0 || details.incognito) return {};
  const id = await ensureContainer();
  if (details.cookieStoreId === id) return {};
  if (openNormally.get(details.tabId) === details.url) {
    openNormally.delete(details.tabId);
    return {};
  }
  if (reopening.has(details.tabId)) return { cancel: true };

  // "Ask how to open Spotify links": show the choice page in this tab.
  if (settingsCache.askOnOpen) {
    const prompt = browser.runtime.getURL(`prompt/prompt.html?url=${encodeURIComponent(details.url)}`);
    browser.tabs.update(details.tabId, { url: prompt }).catch(reportError);
    return { cancel: true };
  }

  reopening.add(details.tabId);
  try {
    const tab = await browser.tabs.get(details.tabId);
    await reopenInContainer(tab, details.url);
  } catch (e) {
    reportError(e);
  } finally {
    reopening.delete(details.tabId);
  }
  return { cancel: true };
}

browser.webRequest.onBeforeRequest.addListener(
  onBeforeRequest,
  { urls: SPOTIFY_MATCH, types: ["main_frame"] },
  ["blocking"]
);

// --- switching ----------------------------------------------------------

async function showState() {
  await browser.browserAction.setIcon({ path: on ? "icons/on.svg" : "icons/off.svg" });
  await browser.browserAction.setTitle({ title: on ? "unfamiliar sounds is on" : "unfamiliar sounds is off" });
}

// atStartup: tabs restored with the browser load after the script is
// registered, so they need no reload.
async function switchOn(atStartup) {
  await ensureContainer();
  await registerContent();
  // Spotify tabs already open elsewhere move into the container. Ones
  // already in it reload, because the content script only runs on page load.
  const tabs = await browser.tabs.query({ url: SPOTIFY_MATCH });
  for (const tab of tabs) {
    if (tab.incognito) continue;
    if (tab.cookieStoreId !== containerId) await reopenInContainer(tab, tab.url).catch(reportError);
    else if (!atStartup) await browser.tabs.reload(tab.id).catch(reportError);
  }
}

// The container is only used while switched on. Switching off closes every
// tab in it, or (setting "offTabs": "convert") reopens each one in the
// default context, same window and place. The container itself is kept,
// empty, so its Spotify login is there next time.
async function switchOff() {
  unregisterContent();
  if (!containerId) return;
  const tabs = await browser.tabs.query({ cookieStoreId: containerId });
  if (settingsCache.offTabs !== "convert") {
    if (tabs.length) await browser.tabs.remove(tabs.map((t) => t.id)).catch(reportError);
    return;
  }
  for (const tab of tabs) {
    try {
      await browser.tabs.create({
        url: /^about:/.test(tab.url) ? undefined : tab.url, // a new tab page can't be opened by URL
        cookieStoreId: "firefox-default",
        windowId: tab.windowId,
        index: tab.index + 1,
        active: tab.active,
        pinned: tab.pinned,
      });
      await browser.tabs.remove(tab.id);
    } catch (e) {
      reportError(e);
    }
  }
}

async function apply(next, atStartup = false) {
  on = next;
  await showState();
  if (on) await switchOn(atStartup);
  else await switchOff();
}

// Clicks are queued so a quick double click can't interleave two switches.
let queue = Promise.resolve();
function enqueue(task) {
  queue = queue.then(task).catch(reportError);
  return queue;
}

// The stored value is the switch; the toolbar button and the options page
// both just write it.
browser.browserAction.onClicked.addListener(() => {
  browser.storage.local.set({ on: !on }).catch(reportError);
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !("on" in changes)) return;
  const next = Boolean(changes.on.newValue);
  enqueue(() => (next === on ? null : apply(next)));
});

function reportError(e) {
  console.error("unfamiliar sounds:", e);
  browser.browserAction.setTitle({ title: `unfamiliar sounds: ${e && e.message ? e.message : e}` }).catch(() => {});
}

// --- seed -------------------------------------------------------------------
// Every stand-in name and picture comes from a seed (Violet, 17 October 2026).
// By default everyone shares one built-in seed, so everyone sees the same
// stand-ins. It is never shown, exported or sent to a page; the settings page
// only ever learns whether the default is in use. Anyone may set their own
// seed instead (any text, at least 8 characters).
//
// Caveat, recorded honestly: the default seed ships inside the extension, so
// someone who unpacks the extension could recover it.

const DEFAULT_SEED_HEX = "b81a7bad3ef997f880e1c9c7f8535c65209de8d1cac13972496b6d7f970cce07";
const SEED_MIN = 8;
const SEED_MAX = 500;

function hexBytes(hex) {
  return Uint8Array.from(hex.match(/../g), (h) => parseInt(h, 16));
}

async function sha256(bytes) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

// The HMAC key for a custom seed. A 64-hex-digit seed is used as the key
// itself, so keys saved by earlier versions (the "secret key") still work.
async function customSeedKey(text) {
  if (/^[0-9a-f]{64}$/i.test(text.trim())) return hexBytes(text.trim().toLowerCase());
  return sha256(new TextEncoder().encode(`unfamiliar sounds seed:${text}`));
}

let seedState = null; // { key: Uint8Array, custom: bool, id: short hash for cache names }

async function currentSeed() {
  if (!seedState) {
    const { seed } = await browser.storage.local.get("seed");
    const custom = Boolean(seed && typeof seed.text === "string" && seed.text.length >= SEED_MIN);
    const key = custom ? await customSeedKey(seed.text) : hexBytes(DEFAULT_SEED_HEX);
    const id = Array.from((await sha256(key)).subarray(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
    seedState = { key, custom, id };
  }
  return seedState;
}

// The random per-install key of earlier versions is replaced by the shared
// default seed.
async function dropOldKey() {
  await browser.storage.local.remove("key");
}

// --- deriving names for the content script --------------------------------

// Derivation happens here, not in the page: Firefox's cross-compartment
// wrappers make Web Crypto results unreadable in content scripts, and this
// way the key never enters the Spotify page's process.
let deriverPromise = null;

function deriver() {
  if (!deriverPromise) {
    deriverPromise = (async () => {
      const { key } = await currentSeed();
      const res = await fetch(browser.runtime.getURL(Unfamiliar.WORDLIST.file));
      const wordlistBytes = new Uint8Array(await res.arrayBuffer());
      return Unfamiliar.createDeriver({ key, wordlistBytes });
    })();
    deriverPromise.catch(() => { deriverPromise = null; });
  }
  return deriverPromise;
}

async function checkSender(sender) {
  await queue; // let startup or a switch in progress finish first
  if (!on || !sender.tab || sender.tab.cookieStoreId !== containerId) throw new Error("unfamiliar sounds is off for this tab");
}

browser.runtime.onMessage.addListener((message, sender) => {
  if (!message) return undefined;
  if (message.type === "unfamiliar:init") {
    // Fails (and the page stays hidden) if the word list doesn't match its checksum.
    return checkSender(sender).then(deriver).then(async () => ({
      ok: true,
      seedId: (await currentSeed()).id,
      stuck: await stuckVerdicts(),
      settings: await readSettings(),
    }));
  }
  if (message.type === "unfamiliar:derive") {
    return checkSender(sender).then(deriver).then((d) => Promise.all(
      message.items.map(({ type, text }) => d.derive(type, text).then(
        (r) => ({ type, text, name: r.name, image: UnfamiliarPictures.pictureDataUrl(r.picture, Unfamiliar.PALETTE) }),
        () => ({ type, text, name: null, image: null }),
      ))
    ));
  }
  if (message.type === "unfamiliar:get-settings") return readSettings(); // settings page
  if (message.type === "unfamiliar:dev") return devOp(message, sender);   // test builds only
  if (message.type === "unfamiliar:seed-info") return seedInfo();        // settings page
  if (message.type === "unfamiliar:set-seed") return setSeed(message.text); // settings page
  if (message.type === "unfamiliar:open-choice") return openChoice(message, sender);
  if (message.type === "unfamiliar:art") {
    return checkSender(sender).then(() => Promise.all(
      message.items.map(({ type, id }) => artFor(type, id).then(
        (image) => ({ type, id, image }),
        () => ({ type, id, image: null }),
      ))
    ));
  }
  if (message.type === "unfamiliar:verdicts") {
    return checkSender(sender).then(() => saveVerdicts(message.items));
  }
  return undefined;
});

// --- playlist verdicts (phase 2) ---------------------------------------------

// storage.local "playlistVerdicts": playlist id -> latest verdict. Only IDs
// and verdicts, never titles or names. "person" and "popularity" stick: a
// later, weaker look never turns them back into "theme". The settings page
// counts these (TEMPORARY, to see how often "unsure" happens).
const STICKY_VERDICTS = new Set(["person", "popularity"]);
let verdictWrite = Promise.resolve();

function saveVerdicts(items) {
  verdictWrite = verdictWrite.then(async () => {
    const { playlistVerdicts = {} } = await browser.storage.local.get("playlistVerdicts");
    for (const [id, verdict] of Object.entries(items || {})) {
      if (!/^[0-9A-Za-z]{22}$/.test(id)) continue;
      if (STICKY_VERDICTS.has(playlistVerdicts[id]) && !STICKY_VERDICTS.has(verdict)) continue;
      playlistVerdicts[id] = verdict;
    }
    await browser.storage.local.set({ playlistVerdicts });
  }).catch(reportError);
  return verdictWrite;
}

async function stuckVerdicts() {
  const { playlistVerdicts = {} } = await browser.storage.local.get("playlistVerdicts");
  const stuck = {};
  for (const [id, verdict] of Object.entries(playlistVerdicts)) if (STICKY_VERDICTS.has(verdict)) stuck[id] = verdict;
  return stuck;
}

// --- pictures from museums ------------------------------------------------------
// Covers and artist pictures are artworks from The Met, the Art Institute of
// Chicago and the Cleveland Museum of Art, picked by a chain derived from your
// key and the Spotify ID (see core/museums.js). The first usable candidate is
// cached for good in storage.local "pictureCache:<seed id>" (Spotify type:ID -> image
// address), and the image file in the extension's Cache storage, so each
// release costs a few small requests once and nothing after that.
// Requests to the museums reveal only object numbers, never the release, the
// name or the key.

const M = UnfamiliarMuseums;
const AIC_HEADERS = { "AIC-User-Agent": "unfamiliar sounds (personal, non-commercial listening experiment)" };
const ART_SIZE = 400;

let pictureCache = null;         // Map "type:id" -> { museum, objectId, url, frame }
let pictureSave = null;

async function loadPictureCache() {
  if (!pictureCache) {
    const name = `pictureCache:${(await currentSeed()).id}`;
    const stored = (await browser.storage.local.get(name))[name] || {};
    pictureCache = new Map(Object.entries(stored));
    pictureCache.storageName = name;
  }
  return pictureCache;
}

function savePictureCache() {
  clearTimeout(pictureSave);
  pictureSave = setTimeout(() => {
    if (pictureCache) browser.storage.local.set({ [pictureCache.storageName]: Object.fromEntries(pictureCache) }).catch(reportError);
  }, 2000);
}

// A lookup that answers the record (usable or not), null if the object
// doesn't exist (404), or throws if the museum couldn't be reached (then
// nothing is cached and it is tried again later).
// Each museum has its own pace. The Met's bot protection refuses bursts
// (403) far below its documented limit and then keeps refusing for a while,
// so it gets one request at a time, 500 ms apart; a refusal pauses that
// museum and the request is tried again.
const PACE = { met: { gap: 500, max: 1 }, cma: { gap: 150, max: 2 }, aic: { gap: 1100, max: 1 }, img: { gap: 50, max: 4 } };
const lanes = {};

function lane(name) {
  if (!lanes[name]) lanes[name] = { active: 0, next: 0, pausedUntil: 0, queue: [] };
  return lanes[name];
}

function paced(name, task) {
  const l = lane(name);
  const p = PACE[name];
  return new Promise((resolve, reject) => {
    l.queue.push({ task, resolve, reject });
    pump(name);
  });

  function pump(n) {
    const L = lane(n);
    const P = PACE[n];
    while (L.queue.length && L.active < P.max) {
      const wait = Math.max(L.next, L.pausedUntil) - Date.now();
      if (wait > 0) { setTimeout(() => pump(n), wait); return; }
      const job = L.queue.shift();
      L.active++;
      L.next = Date.now() + P.gap;
      job.task().then(job.resolve, job.reject).finally(() => { L.active--; pump(n); });
    }
  }
}

function museumOf(url) {
  if (url.includes("metmuseum.org/public/collection")) return "met";
  if (url.includes("clevelandart.org/api")) return "cma";
  if (url.includes("api.artic.edu")) return "aic";
  return "img";
}

// A lookup that answers the record (usable or not), null if the object
// doesn't exist (404), or throws if the museum couldn't be reached (then
// nothing is cached and it is tried again later). Refusals (403/429) pause
// that museum (3, 6, 9… s) and retry, up to six times.
async function lookupJson(url, headers) {
  const name = museumOf(url);
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await paced(name, () => fetch(url, { headers: headers || {} }));
    if (res.status === 404) return null;
    if (res.ok) return res.json();
    if (res.status !== 403 && res.status !== 429) throw new Error(`${url} answered ${res.status}`);
    lane(name).pausedUntil = Date.now() + 3000 * (attempt + 1);
  }
  throw new Error(`${url} kept refusing`);
}

// Chicago: one shared queue for every picture being looked up. Up to 100 IDs
// go in one request, at most one request a second (AIC allows 60 a minute).
// Answers are remembered for the session; a refused request is retried later.
const aicKnown = new Map();     // AIC id -> image address | null
const aicWaiting = new Map();   // AIC id -> [resolve, …]
let aicTimer = null;
let aicPause = 1100;

function aicImageFor(id) {
  if (aicKnown.has(id)) return Promise.resolve(aicKnown.get(id));
  return new Promise((resolve) => {
    if (!aicWaiting.has(id)) aicWaiting.set(id, []);
    aicWaiting.get(id).push(resolve);
    if (!aicTimer) aicTimer = setTimeout(aicFlush, 0);
  });
}

async function aicFlush() {
  const ids = [...aicWaiting.keys()].slice(0, 100);
  try {
    const json = await lookupJson(M.aicBatchUrl(ids), AIC_HEADERS);
    const found = new Map(((json && json.data) || []).map((r) => [r.id, M.aicImage(r)]));
    for (const id of ids) {
      const url = found.get(id) || null;
      aicKnown.set(id, url);
      for (const resolve of aicWaiting.get(id) || []) resolve(url);
      aicWaiting.delete(id);
    }
    aicPause = 1100;
  } catch (e) {
    console.warn("unfamiliar sounds: Chicago", e);
    aicPause = Math.min(aicPause * 2, 60000); // refused or unreachable: wait longer, then retry
  }
  aicTimer = aicWaiting.size ? setTimeout(aicFlush, aicPause) : null;
}

// Walk the chain: the first candidate that is free to use and has an image.
async function resolvePicture(type, id) {
  const d = await deriver();
  const chain = [];
  for (let n = 0; n < M.MAX_CANDIDATES; n++) {
    const bytes = await d.mac(M.seedLabel(type, id, n));
    chain.push({ ...M.candidate(bytes), bytes });
  }
  // Ask Chicago about all of this chain's Chicago candidates at once.
  for (const c of chain) if (c.museum === "aic") aicImageFor(c.id);
  const single = new Map();  // n -> Promise<image address | null> for The Met and Cleveland
  const lookup = (n) => {
    if (!single.has(n)) {
      const c = chain[n];
      single.set(n, lookupJson(M.lookupUrl(c.museum, c.id)).then((json) => (c.museum === "met" ? M.metImage(json) : M.cmaImage(json))));
      single.get(n).catch(() => {}); // awaited in order below
    }
    return single.get(n);
  };
  for (let n = 0; n < chain.length; n++) {
    const c = chain[n];
    let url = null;
    if (c.museum === "aic") {
      url = await aicImageFor(c.id);
    } else {
      // Ask about the next few candidates at once; still take them in order.
      for (let k = n; k < Math.min(n + 2, chain.length); k++) if (chain[k].museum !== "aic") lookup(k);
      url = await lookup(n);
    }
    if (url && M.isMuseumImage(url)) {
      // Two frame colours for artist pictures, from the same candidate.
      const outer = c.bytes[16] % Unfamiliar.PALETTE.length;
      const ring = Unfamiliar.CONTRAST[outer];
      return { museum: c.museum, objectId: c.id, url, frame: [outer, ring[c.bytes[17] % ring.length]] };
    }
  }
  return { museum: null, url: null }; // none usable: keep the generated picture
}

// The image file, from the extension's cache or the network. Museum images
// must be on the museums' image servers; images from your own list may be on
// any https site you allowed.
async function museumImageBlob(url, ownList = false) {
  if (ownList ? !/^https:\/\//.test(url) : !M.isMuseumImage(url)) throw new Error("not an allowed image address");
  const cache = await caches.open("unfamiliar-museum-images-v1");
  let res = await cache.match(url);
  if (!res) {
    res = await paced("img", () => fetch(url, url.includes("artic.edu") ? { headers: AIC_HEADERS } : {}));
    if (!res.ok) throw new Error(`image ${res.status}`);
    await cache.put(url, res.clone());
  }
  return res.blob();
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// Covers: the artwork cropped square, full bleed. Artist pictures: a round
// crop inside a two-colour ring frame, so the two still look different.
async function renderArt(blob, round, frame) {
  const bitmap = await createImageBitmap(blob);
  const side = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - side) / 2;
  const sy = (bitmap.height - side) / 2;
  const canvas = new OffscreenCanvas(ART_SIZE, ART_SIZE);
  const ctx = canvas.getContext("2d");
  const c = ART_SIZE / 2;
  if (round) {
    ctx.fillStyle = "#121212";
    ctx.fillRect(0, 0, ART_SIZE, ART_SIZE);
    ctx.fillStyle = Unfamiliar.PALETTE[frame[0]];
    ctx.beginPath(); ctx.arc(c, c, c, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = Unfamiliar.PALETTE[frame[1]];
    ctx.beginPath(); ctx.arc(c, c, c * 0.88, 0, Math.PI * 2); ctx.fill();
    ctx.save();
    ctx.beginPath(); ctx.arc(c, c, c * 0.8, 0, Math.PI * 2); ctx.clip();
    ctx.drawImage(bitmap, sx, sy, side, side, c * 0.2, c * 0.2, ART_SIZE * 0.8, ART_SIZE * 0.8);
    ctx.restore();
  } else {
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, ART_SIZE, ART_SIZE);
  }
  bitmap.close();
  return blobToDataUrl(await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 }));
}

const artMemo = new Map();   // "type:id" -> Promise<data URL | null>
const ART_MEMO_MAX = 600;

// --- your own picture library (Advanced settings) ----------------------------------
// A list of image addresses loaded from a CSV/TSV/text file on the settings
// page, stored as storage.local "customLibrary" { name, urls }. The picture
// for a release is the list entry at a position derived from the seed and the
// Spotify ID: no lookups, and the same list and seed always give the same
// picture. Images are fetched only from sites you allowed when loading it.

let customLibraryCache = null;

async function customLibrary() {
  if (!customLibraryCache) {
    const { customLibrary: lib } = await browser.storage.local.get("customLibrary");
    customLibraryCache = lib && Array.isArray(lib.urls) ? lib : { name: "", urls: [] };
  }
  return customLibraryCache;
}

async function customPick(type, id) {
  const lib = await customLibrary();
  if (!lib.urls.length) return { url: null };
  const bytes = await (await deriver()).mac(M.seedLabel(type, id, 0));
  let n = 0n;
  for (const b of bytes.subarray(0, 8)) n = (n << 8n) | BigInt(b);
  const url = lib.urls[Number(n % BigInt(lib.urls.length))];
  const outer = bytes[16] % Unfamiliar.PALETTE.length;
  const ring = Unfamiliar.CONTRAST[outer];
  return { url, frame: [outer, ring[bytes[17] % ring.length]] };
}

function artFor(type, id) {
  if (!/^[0-9A-Za-z]{22}$/.test(id || "") || !["album", "track", "artist", "playlist"].includes(type)) return Promise.resolve(null);
  const key = `${type}:${id}`;
  if (!artMemo.has(key)) {
    const job = (async () => {
      if (settingsCache.pictureSource === "custom") {
        const pick = await customPick(type, id);
        if (!pick.url) return null;
        return renderArt(await museumImageBlob(pick.url, true), type === "artist", pick.frame);
      }
      if (settingsCache.pictureSource !== "museums") return null;
      const cache = await loadPictureCache();
      let pick = cache.get(key);
      if (!pick) {
        pick = await resolvePicture(type, id);
        cache.set(key, pick);
        savePictureCache();
      }
      if (!pick.url) return null;
      return renderArt(await museumImageBlob(pick.url), type === "artist", pick.frame);
    })().catch((e) => {
      console.warn("unfamiliar sounds: picture", e);
      artMemo.delete(key); // a network failure is retried next time
      return null;
    });
    artMemo.set(key, job);
    if (artMemo.size > ART_MEMO_MAX) artMemo.delete(artMemo.keys().next().value);
  }
  return artMemo.get(key);
}

// --- test builds ---------------------------------------------------------------------
// Only a build made by tools/make-dev-build.mjs (named "… (dev)") answers these:
// they let an automated tester change settings without the settings page,
// which the test harness can't open. They never return the default seed.

const DEV = browser.runtime.getManifest().name.endsWith("(dev)");

async function devOp({ op, args = {} }) {
  if (!DEV) throw new Error("not a test build");
  switch (op) {
    case "state": {
      const stored = await browser.storage.local.get(null);
      const keys = Object.keys(stored);
      return { on, containerId, settings: await readSettings(), seed: { custom: (await currentSeed()).custom }, storageKeys: keys, library: (stored.customLibrary || {}).urls ? stored.customLibrary.urls.length : 0 };
    }
    case "setSettings": {
      const { settings = {} } = await browser.storage.local.get("settings");
      await browser.storage.local.set({ settings: Object.assign({}, settings, args, args.pictureSource ? { picturesChosen: true } : {}) });
      return readSettings();
    }
    case "resetSettings":
      await browser.storage.local.remove(["settings", "playlistVerdicts", "ownPlaylists"]);
      return readSettings();
    case "setOn":
      await browser.storage.local.set({ on: Boolean(args.on) });
      return { on: Boolean(args.on) };
    case "setSeed":
      return setSeed(args.text === undefined ? null : args.text);
    case "seedInfo":
      return seedInfo();
    case "setLibrary":
      await browser.storage.local.set({ customLibrary: { name: args.name || "test list", urls: args.urls || [] } });
      return { urls: (args.urls || []).length };
    case "clearPictureCaches": {
      const stored = await browser.storage.local.get(null);
      await browser.storage.local.remove(Object.keys(stored).filter((k) => k.startsWith("pictureCache") || k.startsWith("reverseNames")));
      pictureCache = null;
      artMemo.clear();
      await caches.delete("unfamiliar-museum-images-v1");
      return { cleared: true };
    }
    case "tabs":
      return (await browser.tabs.query({})).map((t) => ({ id: t.id, url: t.url, container: t.cookieStoreId, active: t.active }));
    default:
      throw new Error(`unknown op ${op}`);
  }
}

// --- the seed, for the settings page -------------------------------------------------

// What the settings page may know: whether the default is in use, your own
// seed if you set one, and a test name to compare two browsers by. Never the
// default seed.
async function seedInfo() {
  const seed = await currentSeed();
  const { seed: stored } = await browser.storage.local.get("seed");
  const d = await deriver();
  const check = (await d.derive("track", "unfamiliar sounds seed check")).name;
  return { custom: seed.custom, text: seed.custom ? stored.text : null, check };
}

async function setSeed(text) {
  if (text === null) {
    await browser.storage.local.remove("seed");
    return { ok: true };
  }
  const t = String(text);
  if (t.length < SEED_MIN || t.length > SEED_MAX) throw new Error(`A seed is ${SEED_MIN} to ${SEED_MAX} characters.`);
  await browser.storage.local.set({ seed: { text: t } });
  return { ok: true };
}

// --- the "how should this open?" page ---------------------------------------------

// The choice page (prompt/prompt.html) sits in the tab where a Spotify link was
// opened. "unfamiliar sounds" opens the link in the container, in a new tab
// next to it; "normally" opens it right there, outside the container.
async function openChoice({ choice, url }, sender) {
  if (!/^https:\/\/open\.spotify\.com\//.test(url || "") || !sender.tab) throw new Error("bad link");
  const tab = sender.tab;
  if (choice === "normal") {
    openNormally.set(tab.id, url);
    await browser.tabs.update(tab.id, { url });
    return { done: true };
  }
  const id = await ensureContainer();
  await browser.tabs.create({ url, cookieStoreId: id, windowId: tab.windowId, index: tab.index + 1, active: true });
  return { done: true, leave: true }; // the page goes back, or closes if it was a new tab
}

// --- settings ---------------------------------------------------------------

const DEFAULT_SETTINGS = {
  hideArtistDescriptions: true,   // bios show "???"
  hidePlaylistDescriptions: true, // playlist descriptions show "???"
  showThemeTitles: false,         // real titles of Spotify's theme playlists
  replaceOwnProfile: false,       // your own name and picture
  replaceOwnPlaylists: false,     // your own playlists' titles, descriptions and uploaded covers
  hidePages: true,                // notice over pages about a person or popularity
  offTabs: "close",               // switching off: "close" container tabs or "convert" them to normal ones
  askOnOpen: false,               // ask how to open each Spotify link while switched on
  pictureSource: "museums",       // "museums", "custom" (your list) or "generated" (offline)
};

let settingsCache = {};

async function refreshSettingsCache() {
  settingsCache = await readSettings();
}

async function readSettings() {
  const { settings = {} } = await browser.storage.local.get("settings");
  const stored = Object.assign({}, settings);
  // Older versions saved a full copy of the settings, freezing whatever the
  // defaults were then. A picture source only counts if it was chosen.
  if (!stored.picturesChosen) delete stored.pictureSource;
  const merged = Object.assign({}, DEFAULT_SETTINGS, stored);
  // Before 17 October 2026 one switch, showDescriptions, covered both kinds.
  if (settings.showDescriptions === true && !("hideArtistDescriptions" in settings)) {
    merged.hideArtistDescriptions = false;
    merged.hidePlaylistDescriptions = false;
  }
  delete merged.showDescriptions;
  return merged;
}

async function tellUnfamiliarTabs(type) {
  if (!containerId) return;
  const tabs = await browser.tabs.query({ cookieStoreId: containerId });
  for (const tab of tabs) browser.tabs.sendMessage(tab.id, { type }).catch(() => {});
}

// A new seed means new names and pictures everywhere, and a changed setting
// changes pages: reload the unfamiliar sounds tabs.
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if ("seed" in changes) {
    seedState = null;
    deriverPromise = null;
    pictureCache = null;
    artMemo.clear();
    tellUnfamiliarTabs("unfamiliar:rekey");
  }
  if ("customLibrary" in changes) {
    customLibraryCache = null;
    artMemo.clear();
    tellUnfamiliarTabs("unfamiliar:settings");
  }
  if ("settings" in changes) {
    refreshSettingsCache().catch(reportError);
    artMemo.clear();
    tellUnfamiliarTabs("unfamiliar:settings");
  }
});

// --- startup ------------------------------------------------------------

enqueue(async () => {
  await refreshSettingsCache();
  await dropOldKey();
  const stored = await browser.storage.local.get({ on: false });
  await apply(stored.on, true);
});
