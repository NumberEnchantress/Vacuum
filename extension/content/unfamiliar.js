// unfamiliar sounds content script. Registered by the background only while unfamiliar sounds is on,
// and only for tabs in the unfamiliar sounds container, so when the switch is off this
// file never runs at all.
//
// How it avoids showing real names, even for a frame:
//  - unfamiliar.css keeps the whole page transparent until this script is ready.
//  - After that, a MutationObserver sees every change. Its callback runs
//    before the browser paints, and it fixes every text node synchronously:
//    a name it already knows is written in, anything else is blanked.
//  - Names not yet derived (the background page derives them, in batches)
//    stay blank until they arrive.
// Text nodes are edited in place (nodeValue), never replaced, so Spotify's
// React keeps working; when React rewrites a node, the observer fixes it again.
//
// Stand-ins are keyed by the name as displayed (type + text), not by Spotify
// ID, so the same song title gets the same stand-in in a playlist and in the
// play bar even when Spotify uses two IDs for it. Each distinct name is
// translated once and then served from cache.

"use strict";

(function () {
  const S = UnfamiliarSelectors;
  const C = UnfamiliarCollections;
  const root = document.documentElement;
  root.dataset.unfamiliar = "on";

  const NAME_TYPES = new Set(["track", "album", "artist", "playlist", "user", "show", "episode", "audiobook", "concert"]);

  let ready = false;
  let observer = null;
  // Defaults; the background sends the stored values (see DEFAULT_SETTINGS there).
  let settings = {
    hideArtistDescriptions: true,
    hidePlaylistDescriptions: true,
    showThemeTitles: false,
    replaceOwnProfile: false,
    replaceOwnPlaylists: false,
    hidePages: true,
    pictureSource: "museums",
  };

  // --- small helpers ------------------------------------------------------

  function isSafeText(text) {
    return S.SAFE_PHRASES.has(text) || S.SAFE_PATTERNS.some((re) => re.test(text));
  }

  function textNodesIn(el) {
    const out = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n);
    return out;
  }

  // Safe zones (the nav bar, player controls) never hold names, except for
  // what pops up inside them: the search box's suggestions and recent
  // searches are full of names.
  function inSafe(el) {
    return Boolean(el.closest(S.SAFE_ZONES)) && !el.closest(S.UNSAFE_IN_SAFE);
  }

  function isDocumentTitle(el) {
    return el.tagName === "TITLE" && el.parentElement === document.head;
  }

  // Spotify itself as an owner: not a person, kept. Its username "spotify"
  // can show for a moment before the display name.
  function isSpotifyName(text) {
    return (text || "").trim().toLowerCase() === "spotify";
  }

  function spotifyId(text) {
    const m = /^([0-9A-Za-z]{22})/.exec(text || "");
    return m ? m[1] : null;
  }

  // --- real text bookkeeping ------------------------------------------------
  // unfamiliar sounds remembers, per text node, what it wrote and what the real text was,
  // so the real name behind a slot can be read again after it was replaced.
  // Real text stays in memory for this page only.

  const written = new WeakMap(); // text node -> value unfamiliar sounds wrote
  const realOf = new WeakMap();  // text node -> last real value seen

  function readReal(node) {
    const v = node.nodeValue;
    if (written.has(node) && written.get(node) === v) return realOf.has(node) ? realOf.get(node) : v;
    written.delete(node);
    realOf.set(node, v);
    return v;
  }

  function write(node, value) {
    readReal(node); // record the real value before overwriting it
    if (node.nodeValue !== value) node.nodeValue = value;
    written.set(node, value);
  }

  // The text of a name, without the <title> of any icon inside it (the
  // "Verified" badge next to an artist's name has one).
  function nameNodes(el) {
    return textNodesIn(el).filter((n) => !(n.parentElement && n.parentElement.closest("svg")));
  }

  function slotReal(el) {
    if (!el) return "";
    return nameNodes(el).map(readReal).join("").replace(/\s+/g, " ").trim();
  }

  // The first text node gets the value; any others are emptied.
  function fill(slot, value) {
    nameNodes(slot).forEach((n, i) => write(n, i === 0 && value ? value : ""));
    fixLabelsIn(slot);
  }

  function restore(slot) {
    for (const n of nameNodes(slot)) write(n, readReal(n));
    fixLabelsIn(slot);
  }

  // What a slot shows now (after unfamiliar sounds has written it).
  function slotShown(el) {
    return nameNodes(el).map((n) => n.nodeValue).join("").replace(/\s+/g, " ").trim();
  }

  // --- attributes: the real value behind what unfamiliar sounds wrote ---------
  // Hover text (title) and screen-reader labels (aria-label) are rewritten in
  // place; the real value is remembered (memory only) so it can be read again.

  const attrState = new WeakMap(); // element -> { attr: { real, written } }

  function readRealAttr(el, attr) {
    const v = el.getAttribute(attr);
    const st = attrState.get(el);
    const s = st && st[attr];
    return s && v === s.written ? s.real : v;
  }

  function writeAttr(el, attr, value) {
    const real = readRealAttr(el, attr);
    let st = attrState.get(el);
    if (!st) {
      st = {};
      attrState.set(el, st);
    }
    st[attr] = { real, written: value };
    if (el.getAttribute(attr) !== value) el.setAttribute(attr, value);
  }

  function fixLabelsIn(el) {
    if (el.hasAttribute("title")) fixTitleAttribute(el);
    el.querySelectorAll("[title]").forEach(fixTitleAttribute);
    if (el.hasAttribute("aria-label")) fixAriaLabel(el);
    el.querySelectorAll("[aria-label]").forEach(fixAriaLabel);
  }

  // --- translations: real name -> stand-in, cached --------------------------

  const norm = (t) => t.normalize("NFC").replace(/\s+/gu, " ").trim().toLowerCase();
  // Songs and releases share one name space: a single and its only song,
  // both called "X", get the same stand-in.
  // Podcasts, episodes, audiobooks and concerts are named like releases.
  const nameType = (type) => (["track", "show", "episode", "audiobook", "concert"].includes(type) ? "album" : type);
  const tkey = (type, text) => `${nameType(type)}\u0000${norm(text)}`;

  const standIns = new Map();     // tkey -> stand-in name
  const pictures = new Map();     // tkey -> data: URL
  const knownReal = new Map();    // real name as displayed -> Map(type -> stand-in), for swapping inside text
  const SWAP_PREFERENCE = ["artist", "album", "playlist", "user"]; // "Justice" the artist beats "Justice" the album
  const pendingReal = new Set();  // real names requested but not derived yet
  const waiting = new Map();      // tkey -> Set of retry callbacks
  const retries = new Set();      // callbacks to run after the next batch arrives
  let batch = null;
  let swapList = null;            // [real, stand-in, RegExp] longest first, rebuilt when names arrive

  // Labels for generated pictures that aren't names start with this.
  const PLACEHOLDER = "\u0001";

  // The stand-in for this name, or null (and a retry later) if not derived yet.
  function translate(type, real, retry) {
    const k = tkey(type, real);
    const name = standIns.get(k);
    if (name) return name;
    let set = waiting.get(k);
    if (!set) {
      set = new Set();
      waiting.set(k, set);
      if (!real.startsWith(PLACEHOLDER)) pendingReal.add(real.trim());
      if (!batch) {
        batch = [];
        setTimeout(flush, 0);
      }
      batch.push({ type: nameType(type), text: real });
    }
    if (retry) set.add(retry);
    return null;
  }

  function flush() {
    const items = batch;
    batch = null;
    browser.runtime.sendMessage({ type: "unfamiliar:derive", items }).then((results) => {
      const todo = new Set(retries);
      retries.clear();
      for (const r of results) {
        const k = tkey(r.type, r.text);
        pendingReal.delete(r.text.trim());
        const set = waiting.get(k) || new Set();
        waiting.delete(k);
        if (!r.name) continue; // stays blank (and pictures hidden)
        standIns.set(k, r.name);
        pictures.set(k, r.image);
        if (!r.text.startsWith(PLACEHOLDER)) {
          const real = r.text.trim();
          if (!knownReal.has(real)) knownReal.set(real, new Map());
          knownReal.get(real).set(r.type, r.name);
          rememberReverse(r.name, real);
        }
        for (const cb of set) todo.add(cb);
      }
      swapList = null;
      for (const cb of todo) {
        try { cb(); } catch (e) { console.error("unfamiliar sounds:", e); }
      }
      reswap();
      updateDocumentTitle();
      refreshMediaSession();
    }, (e) => {
      for (const { type, text } of items) {
        waiting.delete(tkey(type, text));
        pendingReal.delete(text.trim());
      }
      console.error("unfamiliar sounds:", e);
    });
  }

  // Swapping known names inside a piece of text (tooltips, menus, bios).
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const nameRe = (name) => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(name)}(?=$|[^\\p{L}\\p{N}])`, "gu");

  function swaps() {
    if (!swapList) {
      swapList = [...knownReal]
        .filter(([real]) => real.length >= 3 && !isSafeText(real) && !(ownTitlesShown.has(real) && !settings.replaceOwnPlaylists))
        .sort((a, b) => b[0].length - a[0].length)
        .map(([real, byType]) => {
          const type = SWAP_PREFERENCE.find((x) => byType.has(x)) || [...byType.keys()][0];
          return [real, byType.get(type), nameRe(real)];
        });
    }
    return swapList;
  }

  // The text with every known name swapped, or null when it contains a name
  // that is still being derived (then `retry` runs once it is).
  function substitute(text, retry) {
    if (isSafeText(text.trim())) return text;
    for (const real of pendingReal) {
      if (real.length >= 3 && nameRe(real).test(text)) {
        if (retry) retries.add(retry);
        return null;
      }
    }
    let out = text;
    for (const [real, stand, re] of swaps()) {
      if (out.includes(real)) out = out.replace(re, (m, pre) => pre + stand);
    }
    return out;
  }

  // Text shown with swaps is remembered, and swapped again whenever new names
  // become known: a name can appear in a bio or tooltip before the link that
  // makes it known has been processed.
  const swappedNodes = new Set();

  function substituteNode(node) {
    const real = readReal(node);
    if (!real.trim()) return;
    swappedNodes.add(node);
    const out = substitute(real, () => node.isConnected && substituteNode(node));
    write(node, out === null ? "" : out);
  }

  function reswap() {
    for (const node of swappedNodes) {
      if (!node.isConnected) { swappedNodes.delete(node); continue; }
      if (written.get(node) === node.nodeValue) substituteNode(node);
    }
    // Labels judged before a name in them was known are judged again.
    for (const [el, fix] of labelled) {
      if (!el.isConnected) { labelled.delete(el); continue; }
      fix(el);
    }
  }

  // --- you and your own playlists ---------------------------------------------
  // Your name, picture and playlists stay as they are unless the settings say
  // otherwise. Your display name comes from the account button's label, your
  // user id from your folders, your playlists from the library ("Playlist •
  // <you>") and from playlist pages that you made. Only playlist IDs are
  // stored (storage.local "ownPlaylists").

  let ownName = "";
  let ownUserId = "";
  const ownPlaylists = new Set();
  let ownSave = null;
  let ownRefresh = null;

  let ownAvatar = "";

  function noteOwnName() {
    const widget = document.querySelector(S.USER_WIDGET);
    const name = widget && (readRealAttr(widget, "aria-label") || "").trim();
    // Learnt after the page was first processed: your things on it are
    // looked at again, now that they can be recognised.
    if (name && !ownName && ready) {
      setTimeout(() => {
        checkDataOwners();
        if (document.body) processTree(document.body);
      }, 0);
    }
    if (name) ownName = name;
    if (widget && name && settings.replaceOwnProfile) {
      const stand = translate("user", name, () => noteOwnName());
      writeAttr(widget, "aria-label", stand || "");
    }
    const img = widget && widget.querySelector("img");
    const tail = img && imageTail(realSrc.get(img) || img.getAttribute("src"));
    if (tail) ownAvatar = tail;
    // With your name replaced, the avatar's tooltip must not show it either.
    const figure = widget && widget.querySelector("figure[title]");
    if (figure && settings.replaceOwnProfile && ownName) {
      const stand = translate("user", ownName, () => noteOwnName());
      if (figure.getAttribute("title") !== (stand || "")) {
        if (stand) figure.setAttribute("title", stand);
        else figure.removeAttribute("title");
      }
    }
  }

  function markOwnPlaylist(id) {
    // Spotify's personal playlists (Daily Mixes, radios, Discover Weekly)
    // list you as their owner; they are still Spotify's.
    if (!id || ownPlaylists.has(id) || C.isSpotifyPlaylist(id)) return;
    ownPlaylists.add(id);
    if (!settings.replaceOwnPlaylists && ready) {
      // Many can be learnt at once (the library list): their slots are
      // looked at again together, before the next paint.
      if (!ownRefresh) {
        ownRefresh = new Set();
        queueMicrotask(() => {
          const ids = ownRefresh;
          ownRefresh = null;
          for (const x of ids) refreshPlaylistSlots(x);
          document.querySelectorAll("img").forEach(processImage);
        });
      }
      ownRefresh.add(id);
    }
    clearTimeout(ownSave);
    ownSave = setTimeout(() => {
      browser.storage.local.set({ ownPlaylists: [...ownPlaylists] }).catch(() => {});
    }, 1000);
  }

  function isOwnUser(info, real) {
    return Boolean((info.userId && ownUserId && info.userId === ownUserId) || (ownName && real === ownName));
  }

  // Your playlists are left alone, unless "Change my own playlists" is on.
  function keepOwnPlaylist(id) {
    return Boolean(id && ownPlaylists.has(id) && !settings.replaceOwnPlaylists);
  }

  // --- rows and cards without ids -----------------------------------------------
  // Search dropdowns and the Recents page show rows with no Spotify id in
  // their markup: the title links to the thing (or doesn't link at all), and
  // the subtitle says what kind of thing it is and, for playlists, whose.

  const KIND_TYPE = {
    Playlist: "playlist", "Public Playlist": "playlist", Album: "album", Single: "album", EP: "album",
    Compilation: "album", Song: "track", Artist: "artist", Podcast: "show", Episode: "episode",
    Audiobook: "audiobook", Profile: "user", Concert: "concert",
  };

  // { type, ownerId, ownerName } from a row's or card's subtitle.
  function rowKind(holder) {
    const sub = holder.querySelector(S.ROW_SUBTITLE_ANY);
    const out = { type: null, ownerId: null, ownerName: "" };
    if (!sub) return out;
    const parts = slotReal(sub).split(/\s*•\s*/).map((p) => p.trim()).filter(Boolean);
    for (const p of parts) if (!out.type && KIND_TYPE[p]) out.type = KIND_TYPE[p];
    const u = sub.querySelector('a[href^="/user/"]');
    const m = u && S.USER_HREF_ID.exec(u.getAttribute("href") || "");
    if (m) {
      out.ownerId = m[1];
      out.ownerName = slotReal(u);
    } else if (parts.length) {
      out.ownerName = parts[parts.length - 1].replace(/^By\s+/, "");
    }
    return out;
  }

  function isMine(kind) {
    return Boolean((kind.ownerId && ownUserId && kind.ownerId === ownUserId) || (ownName && kind.ownerName === ownName));
  }

  // { type, id, text, own } of a row or card, from its title, or null.
  function rowEntity(holder) {
    const title = holder.querySelector(S.ROW_TITLE_ANY);
    if (!title) return null;
    const text = slotReal(title);
    if (!text) return null;
    const link = title.closest("a[href]") || title.querySelector("a[href]");
    const href = (link && link.getAttribute("href")) || "";
    const m = S.ENTITY_HREF.exec(href);
    if (m) return { type: m[1], id: m[2], text, own: isMine(rowKind(holder)) };
    const u = S.USER_HREF_ID.exec(href);
    if (u) return { type: "user", id: null, userId: u[1], text, own: false };
    const kind = rowKind(holder);
    return { type: kind.type || "album", id: null, text, own: isMine(kind) };
  }

  // Titles of your playlists (in memory only): rows that don't say whose
  // they are (Recents) and the "Add to playlist" menu are matched by title.
  // Those shown on this page as yours are also left alone inside text; the
  // rest of your library's titles aren't, so a name that happens to be one
  // of your titles is still swapped in tooltips and bios.
  const ownTitles = new Set();
  const ownTitlesShown = new Set();

  let ownTitleRefresh = false;

  function noteOwnTitle(title, fromData) {
    if (!title) return;
    if (!fromData && !ownTitlesShown.has(title)) {
      ownTitlesShown.add(title);
      swapList = null;
    }
    if (ownTitles.has(title)) return;
    ownTitles.add(title);
    if (ownTitleRefresh || !ready) return;
    ownTitleRefresh = true;
    queueMicrotask(() => {
      ownTitleRefresh = false;
      for (const el of document.querySelectorAll(`${S.ENTITY_ROW_TITLE}, ${S.MENU}`)) processTree(el);
      for (const img of document.querySelectorAll(`${S.LIST_ROW} img`)) processImage(img);
    });
  }

  // Playlists in a row or card whose subtitle names you as the owner are yours.
  function noteOwnerOf(info) {
    if (info.type !== "playlist" || !info.id || ownPlaylists.has(info.id)) return;
    const holder = info.slot.closest(`${S.LIST_ROW}, ${S.CARD}`);
    if (holder && isMine(rowKind(holder))) markOwnPlaylist(info.id);
  }

  // --- what a piece of text is ----------------------------------------------

  // A name slot, or null for ordinary text.
  //   { type, id, slot }           name slot: translate its real text
  //   { mode: "real", slot }       your own things (folders, Liked Songs): show, with swaps
  //   { mode: "hidden", slot }     things unfamiliar sounds doesn't cover (podcasts): blank
  //   { mode: "subtitle", slot }   library row subtitle
  function slotOf(el) {
    const titled = el.closest(S.TITLE_ID);
    if (titled) {
      if (S.BUILTIN_TITLE.test(titled.id)) return { mode: "real", slot: titled };
      const own = S.OWN_FOLDER_ID.exec(titled.id);
      if (own) {
        ownUserId = own[1];
        return { mode: "real", slot: titled };
      }
      const m = S.TITLE_ID_RE.exec(titled.id);
      if (m) {
        const [, kind, rest] = m;
        if (kind === "user") return { type: "user", userId: rest.replace(/-\d+$/, ""), slot: titled, isTitle: true };
        if (NAME_TYPES.has(kind)) return { type: kind, id: spotifyId(rest), slot: titled, isTitle: true };
        return { mode: "hidden", slot: titled };
      }
    }
    const link = el.closest("a[href]");
    if (link) {
      const href = link.getAttribute("href");
      const m = S.ENTITY_HREF.exec(href);
      if (m) {
        const h = S.HIGHLIGHT.exec(href);
        return h ? { type: h[1], id: h[2], slot: link } : { type: m[1], id: m[2], slot: link };
      }
      const u = S.USER_HREF_ID.exec(href);
      if (u) return { type: "user", userId: u[1], slot: link };
      if (S.URI_ARTIST.test(href)) return { type: "artist", id: null, slot: link };
      // Your local files, listed among your songs.
      if (S.LOCAL_HREF.test(href)) return { type: "track", id: null, slot: link };
      return null;
    }
    // A song title that isn't a link (a profile's top tracks).
    const plain = el.closest(S.TRACK_TITLE_PLAIN);
    if (plain) return { type: "track", id: null, slot: plain };
    // A row title with no id and no link (the Recents page): the subtitle
    // says what it is and whose.
    const rowTitle = el.closest(S.ENTITY_ROW_TITLE);
    if (rowTitle) {
      const holder = rowTitle.closest(S.LIST_ROW);
      const kind = holder ? rowKind(holder) : { type: null };
      return { type: kind.type || "album", id: null, slot: rowTitle, isTitle: true, own: isMine(kind), anon: true, typed: Boolean(kind.type) };
    }
    const titleSlot = el.closest(S.PAGE_TITLE_SLOTS);
    if (titleSlot) {
      const m = S.ROUTE.exec(location.pathname) || S.MEDIA_ROUTE.exec(location.pathname);
      if (m) return { type: m[1], id: m[2], slot: titleSlot, isTitle: true };
      const u = S.USER_ROUTE.exec(location.pathname);
      if (u) return { type: "user", userId: u[1], slot: titleSlot, isTitle: true };
    }
    const sub = el.closest(S.LISTROW_SUBTITLE);
    if (sub) return S.BUILTIN_SUBTITLE.test(sub.id) ? { mode: "real", slot: sub } : { mode: "subtitle", slot: sub };
    const cardSub = el.closest(S.CARD_SUBTITLE_ANY);
    if (cardSub && !cardSub.querySelector("a[href]")) return { mode: "subtitle", slot: cardSub };
    return null;
  }

  function processSlot(info) {
    const real = slotReal(info.slot);
    if (!real) return;
    const retry = () => info.slot.isConnected && processSlot(info);
    if (info.mode === "hidden") return fill(info.slot, null);
    if (info.mode === "real") {
      for (const n of textNodesIn(info.slot)) substituteNode(n);
      return;
    }
    if (info.mode === "subtitle") return processSubtitle(info.slot, real, retry);
    if (info.type === "user" && (isSpotifyName(real) || info.userId === "spotify")) return restore(info.slot);
    if (info.type === "user" && isOwnUser(info, real) && !settings.replaceOwnProfile) return restore(info.slot);
    if (info.anon) {
      // "1 song played": a group of songs, not a name.
      if (isSafeText(real)) return restore(info.slot);
      // A row that doesn't say whose it is, titled like one of your playlists.
      if (!info.own && (!info.typed || info.type === "playlist") && ownTitles.has(real)) info = Object.assign({}, info, { own: true, type: "playlist" });
    }
    noteOwnerOf(info);
    const ownHere = info.type === "playlist" && ((info.id && ownPlaylists.has(info.id)) || info.own);
    if (ownHere) noteOwnTitle(real);
    if (ownHere && !settings.replaceOwnPlaylists) return restore(info.slot);
    noteEvidence(info, real);
    if (info.isTitle && info.type === "playlist" && info.id && showRealTitle(info.id)) return restore(info.slot);
    fill(info.slot, translate(info.type, real, retry));
  }

  // Row subtitles in the library and on cards: "Album • Artist A, Artist B",
  // "Playlist • Owner", and in the filtered views (Podcasts, Audiobooks,
  // Events) a publisher, authors, or a date and a place, often without a
  // kind in front. Spotify's words, dates and Spotify itself stay; every
  // other part is a name and gets a stand-in (owners of playlists are
  // people, everything else is named like an artist).
  const SUBTITLE_ID = /^(?:listrow|card)-subtitle-spotify:([a-z]+):([0-9A-Za-z]{22})?/;

  function processSubtitle(slot, real, retry) {
    const parts = real.split(/\s*•\s*/).filter(Boolean);
    const sid = SUBTITLE_ID.exec(slot.id || "") || [];
    const playlist = parts[0] === "Playlist" || sid[1] === "playlist";
    const owner = parts.length > 1 ? parts[parts.length - 1] : "";
    if (playlist && ownName && owner === ownName) {
      if (sid[1] === "playlist" && sid[2]) markOwnPlaylist(sid[2]);
      if (!settings.replaceOwnProfile) return restore(slot);
    }
    const kept = (t) => isSafeText(t) || isSpotifyName(t);
    let missing = false;
    const out = parts.map((part) => {
      if (kept(part)) return part;
      // Spotify's mixes made for you: "Made for <you>" (Spotify owns them).
      const made = S.MADE_FOR.exec(part);
      if (made) {
        if (ownName && made[2] === ownName && !settings.replaceOwnProfile) return part;
        const stand = translate("user", made[2], retry);
        if (!stand) missing = true;
        return stand ? `${made[1]}${stand}` : "";
      }
      return part.split(/\s*,\s*/).map((name) => {
        if (kept(name)) return name;
        const stand = translate(playlist ? "user" : "artist", name, retry);
        if (!stand) missing = true;
        return stand || "";
      }).join(", ");
    });
    if (out.every((p, i) => p === parts[i])) return restore(slot);
    fill(slot, missing ? `${out.filter((p, i) => p === parts[i]).join(" • ")}` : out.join(" • "));
  }

  // Playlist card subtitles that list artists ("With A, B and more"): the
  // names are translated. Anything else there is a description.
  function processCardSubtitle(sub, node) {
    const real = slotReal(sub);
    if (isSafeText(real)) return restore(sub);
    const own = S.CARD_SUBTITLE_ID.exec(sub.id);
    // "By <owner>": an owner line, not a description. Your own name marks the
    // playlist as yours.
    const by = /^By (.+)$/.exec(real);
    if (by) {
      const owner = by[1].trim();
      noteOwnName();
      if (own && ownName && owner === ownName) markOwnPlaylist(own[1]);
      if (isSpotifyName(owner) || (ownName && owner === ownName && !settings.replaceOwnProfile)) return restore(sub);
      const name = translate("user", owner, () => sub.isConnected && processCardSubtitle(sub, null));
      return fill(sub, name ? `By ${name}` : null);
    }
    // "Playlist • <owner>": as in the library.
    const kindLine = /^(.*?)\s*•\s*(.+)$/.exec(real);
    if (kindLine && KIND_TYPE[kindLine[1].trim()]) {
      return processSubtitle(sub, real, () => sub.isConnected && processCardSubtitle(sub, null));
    }
    // Follower counts are popularity.
    if (S.FOLLOWER_COUNT.test(real) || S.POPULARITY_COUNT.test(real)) return fill(sub, null);
    if (own && keepOwnPlaylist(own[1])) return restore(sub);
    const names = C.namesInDescription(real);
    if (!names.length) return processDescription(sub, node);
    noteDescriptionFor(sub, real);
    // A list of artists is still the playlist's description.
    if (settings.hidePlaylistDescriptions) return fill(sub, "???");
    const retry = () => sub.isConnected && processCardSubtitle(sub, null);
    const stand = names.map((n) => translate("artist", n, retry));
    if (!stand.every(Boolean)) return fill(sub, null);
    const lead = /^with\s/i.test(real) ? "With " : "";
    const more = /\band more$/i.test(real);
    const list = more || stand.length < 2 ? stand.join(", ") : `${stand.slice(0, -1).join(", ")} and ${stand[stand.length - 1]}`;
    fill(sub, `${lead}${list}${more ? " and more" : ""}`);
  }

  // Which playlist a description belongs to, or null for an artist's bio.
  function descriptionPlaylist(desc) {
    const sub = desc.closest(S.CARD_SUBTITLE);
    if (sub) {
      const m = S.CARD_SUBTITLE_ID.exec(sub.id);
      return m ? m[1] : "";
    }
    if (desc.closest(S.ENTITY_HEADER) && routePlaylist()) return routePlaylist();
    return null;
  }

  // Bios and playlist descriptions: "???" while their setting says hide (the
  // default); otherwise shown with artist links translated and other known
  // names swapped. Your own playlists' descriptions are left alone.
  function processDescription(desc, node) {
    noteDescriptionFor(desc, slotReal(desc));
    const playlist = descriptionPlaylist(desc);
    if (playlist && keepOwnPlaylist(playlist)) return restore(desc);
    const hideIt = playlist === null ? settings.hideArtistDescriptions : settings.hidePlaylistDescriptions;
    if (hideIt) {
      textNodesIn(desc).forEach((n, i) => write(n, i === 0 ? "???" : ""));
      return;
    }
    const nodes = node ? [node] : textNodesIn(desc);
    for (const n of nodes) {
      const info = n.parentElement && slotOf(n.parentElement);
      if (info && info.type) processSlot(info);
      else substituteNode(n);
    }
  }

  // Shelf and section headings are Spotify's own words ("Albums featuring
  // songs you like", "A haunting kind of mood"), sometimes with a name in
  // them ("More like <artist>", "Made For <you>"). Known names are swapped. A
  // heading that still has a capital or a digit past its first letter may
  // hold a name unfamiliar sounds doesn't know, so it gets a stand-in of its
  // own instead. Your own name stays unless "Change my name" is on.
  function processHeading(node, real) {
    const retry = () => node.isConnected && processText(node);
    if (ownName && real.includes(ownName) && isSafeText(real.replace(ownName, "").trim() || "Spotify")) {
      if (!settings.replaceOwnProfile) return write(node, real);
      const stand = translate("user", ownName, retry);
      return write(node, stand ? real.replace(ownName, stand) : "");
    }
    const swapped = substitute(real, retry);
    if (swapped === null) return write(node, "");
    let rest = real;
    for (const [name, , re] of swaps()) if (rest.includes(name)) rest = rest.replace(re, "$1");
    if (!/[\p{Lu}\p{Lt}\p{N}]/u.test(rest.trim().slice(1))) return write(node, swapped);
    write(node, translate("playlist", real.trim(), retry) || "");
  }

  // The "Add to playlist" submenu lists playlists you can add to: yours and
  // other people's that you collaborate on, most of them never shown
  // elsewhere on the page. Every title in it is a playlist title, so it gets
  // a playlist stand-in whether or not it has been seen; yours stay as
  // written (unless "Change my own playlists" is on), and so do your
  // folders (items that open a submenu of their own).
  function inPlaylistPicker(el) {
    for (let m = el.closest(S.MENU); m; m = m.parentElement && m.parentElement.closest(S.MENU)) {
      const search = m.querySelector(S.MENU_SEARCH);
      if (search && search.closest(S.MENU) === m) return true;
    }
    return false;
  }

  function processPickerItem(node, el) {
    const real = readReal(node);
    const text = real.trim();
    if (!text) return;
    if (isSafeText(text)) return write(node, real);
    const item = el.closest('[role="menuitem"]');
    if (item && item.hasAttribute("aria-expanded")) return substituteNode(node);
    if (ownTitles.has(text) && !settings.replaceOwnPlaylists) return write(node, real);
    write(node, translate("playlist", text, () => node.isConnected && processText(node)) || "");
  }

  // A count that is blanked takes its "•" separator with it.
  function hideSeparatorBefore(el) {
    let box = el;
    while (box.parentElement && box.parentElement.childNodes.length === 1) box = box.parentElement;
    const prev = box.previousElementSibling;
    if (prev && prev.matches("[data-separator]")) hide(prev);
  }

  function processText(node) {
    const el = node.parentElement;
    if (!el) return;
    if (isDocumentTitle(el)) return updateDocumentTitle();
    if (!document.body || !document.body.contains(el)) return;
    if (inSafe(el)) return;
    // Icon tooltips (<svg><title>): interface words only.
    if (el.closest("svg")) {
      const t = readReal(node).trim();
      if (t && !isSafeText(t)) write(node, "");
      return;
    }

    if (inPlaylistPicker(el)) return processPickerItem(node, el);

    const desc = el.closest(S.DESCRIPTION);
    if (desc) return processDescription(desc, node);
    // A card subtitle's links are artist names even when they link to a
    // playlist (mixes link each artist to that artist's mix).
    const cardSub = el.closest(S.CARD_SUBTITLE);
    if (cardSub) return processCardSubtitle(cardSub, node);

    const info = slotOf(el);
    if (info) return processSlot(info);

    const real = readReal(node);
    const text = real.trim();
    if (!text) return;
    if (el.closest(S.PAGE_HEADING) && S.HIDE_HEADINGS.test(text)) hiddenPages.add(location.pathname);
    // Listener, follower and save counts and rankings are popularity,
    // wherever they are (the artist's About card is a button).
    if (S.POPULARITY_COUNT.test(text)) {
      write(node, "");
      if (el.closest(S.ENTITY_HEADER)) hideSeparatorBefore(el);
      return;
    }
    if (el.closest(S.UI_ZONES)) return substituteNode(node);
    if (isSafeText(text)) return;
    if (el.closest(S.HEADINGS)) return processHeading(node, real);
    write(node, "");
    if (el.closest(S.ENTITY_HEADER)) hideSeparatorBefore(el);
  }

  // --- pictures -------------------------------------------------------------

  // What an <img> shows a picture of: { type, text } from the name displayed
  // next to it, or null if unknown.
  //   "keep" leaves the real picture.
  function imageName(img) {
    if (img.matches(S.USER_AVATAR)) {
      if (!settings.replaceOwnProfile) return "keep";
      noteOwnName();
      return ownName ? { type: "user", text: ownName } : null;
    }
    // Your profile picture, wherever it appears (your profile page, the
    // owner line of your playlists).
    if (!settings.replaceOwnProfile && ownAvatar && imageTail(realSrc.get(img)) === ownAvatar) return "keep";
    // The built-in collections' own pictures (the Liked Songs heart), wherever
    // they appear (menus included).
    if (S.BUILTIN_COVER.test(realSrc.get(img) || "")) return "keep";
    // An owner's small picture next to a playlist's header: a person.
    const owner = img.closest("figure[title]");
    if (owner && img.closest(S.ENTITY_HEADER)) {
      const name = owner.getAttribute("title") || "";
      if (isSpotifyName(name) || (ownName && name === ownName && !settings.replaceOwnProfile)) return "keep";
      return name ? { type: "user", text: name } : null;
    }
    // Built-in collections (Liked Songs, Local Files) keep their own covers,
    // but not the album covers Spotify sometimes stacks on them.
    if (/^\/collection\//.test(location.pathname) && img.closest(S.PAGE_IMAGE_SLOTS)) {
      return S.BUILTIN_COVER.test(realSrc.get(img) || "") ? "keep" : null;
    }
    const holder = img.closest(S.CARD) || img.closest(S.LIST_ROW);
    const titled = holder && holder.querySelector(S.TITLE_ID);
    if (holder && !titled) {
      // A row or card without ids (search dropdown, Recents).
      const ent = rowEntity(holder);
      if (ent && !isSafeText(ent.text)) {
        const mine = ent.own || (!ent.id && ownTitles.has(ent.text));
        if ((ent.type === "playlist" || mine) && (keepOwnPlaylist(ent.id) || (mine && !settings.replaceOwnPlaylists)) && !isDefaultCover(img)) return "keep";
        if (ent.type === "user" && isOwnUser({ userId: ent.userId }, ent.text) && !settings.replaceOwnProfile) return "keep";
        return { type: ent.type, text: ent.text };
      }
    }
    if (titled) {
      if (S.BUILTIN_TITLE.test(titled.id)) {
        if (S.BUILTIN_COVER.test(realSrc.get(img) || "")) return "keep";
        const text = slotReal(titled);
        return text ? { type: "playlist", text } : null;
      }
      const m = S.TITLE_ID_RE.exec(titled.id);
      if (!m) return null;
      if (m[1] === "playlist" && keepOwnPlaylist(spotifyId(m[2])) && !isDefaultCover(img)) return "keep";
      if (m[1] === "user" && isOwnUser({ userId: m[2].replace(/-\d+$/, "") }, slotReal(titled)) && !settings.replaceOwnProfile) return "keep";
      if (!NAME_TYPES.has(m[1])) return null;
      const text = slotReal(titled);
      return text ? { type: m[1], text } : null;
    }
    const row = img.closest(S.TRACK_ROW);
    if (row) return linkedName(row, ["track"]);
    // A profile's own picture: that person's (yours stays unless "Change my
    // name and picture" is on).
    const profile = S.USER_ROUTE.exec(location.pathname);
    if (profile && img.closest(S.PAGE_IMAGE_SLOTS)) {
      const text = slotReal(document.querySelector(S.PAGE_TITLE_SLOTS));
      if ((ownUserId && profile[1] === ownUserId) || (ownName && text === ownName)) {
        if (!settings.replaceOwnProfile) return "keep";
        return ownName ? { type: "user", text: ownName } : null;
      }
      return text ? { type: "user", text } : null;
    }
    if (img.closest(S.PAGE_IMAGE_SLOTS)) {
      const here = routePlaylist();
      if (here && keepOwnPlaylist(here) && !isDefaultCover(img)) return "keep";
      const m = S.ROUTE.exec(location.pathname);
      const text = slotReal(document.querySelector(S.PAGE_TITLE_SLOTS));
      return m && text ? { type: m[1], text } : null;
    }
    const container = img.closest(S.IMAGE_CONTAINERS) || img.closest("a[href]")?.parentElement;
    if (container) {
      const pl = pathEntity(container, ["playlist"]);
      if (pl && keepOwnPlaylist(pl.id) && !isDefaultCover(img)) return "keep";
      return linkedName(container, S.IMAGE_LINK_ORDER);
    }
    return null;
  }

  // The first named link in `el`, preferring the given types in order.
  function linkedName(el, types) {
    const found = {};
    for (const a of el.querySelectorAll("a[href]")) {
      const info = slotOf(a);
      if (!info || !info.type || found[info.type]) continue;
      const text = slotReal(a);
      if (text) found[info.type] = { type: info.type, text };
    }
    for (const t of types) if (found[t]) return found[t];
    return null;
  }

  // Museum pictures are keyed by the Spotify ID of what the image shows, like
  // Spotify's own covers: a song shows its release's cover (so a song can
  // show cover A in a list and cover B in the play bar, as on Spotify).

  // The first link in `el` to one of `types`, by its address (an album link's
  // own ID, not its ?highlight song).
  function pathEntity(el, types) {
    const found = {};
    for (const a of el.querySelectorAll("a[href]")) {
      const m = S.ENTITY_HREF.exec(a.getAttribute("href"));
      if (m && !found[m[1]]) found[m[1]] = { type: m[1], id: m[2] };
    }
    for (const t of types) if (found[t]) return found[t];
    return null;
  }

  // { type, id } of what an <img> is a picture of, or null.
  function pictureKey(img) {
    const holder = img.closest(S.CARD) || img.closest(S.LIST_ROW);
    const titled = holder && holder.querySelector(S.TITLE_ID);
    if (holder && !titled) {
      const ent = rowEntity(holder);
      if (!ent || !ent.id) return null;
      if (ent.type === "track") return pathEntity(holder, ["album"]) || { type: "track", id: ent.id };
      return ["album", "artist", "playlist"].includes(ent.type) ? { type: ent.type, id: ent.id } : null;
    }
    if (titled) {
      const m = S.TITLE_ID_RE.exec(titled.id);
      if (!m) return null;
      const id = spotifyId(m[2]);
      if (m[1] === "track") return pathEntity(holder, ["album"]) || (id && { type: "track", id });
      return id && ["album", "artist", "playlist"].includes(m[1]) ? { type: m[1], id } : null;
    }
    const row = img.closest(S.TRACK_ROW);
    if (row) return pathEntity(row, ["album", "track"]);
    const header = img.closest(S.PAGE_IMAGE_SLOTS);
    if (header) {
      const m = S.ROUTE.exec(location.pathname);
      if (!m) return null;
      if (m[1] === "track") return pathEntity(header, ["album"]) || { type: "track", id: m[2] };
      return { type: m[1], id: m[2] };
    }
    const container = img.closest(S.IMAGE_CONTAINERS) || img.closest("a[href]")?.parentElement;
    return container ? pathEntity(container, ["album", "playlist", "artist", "track"]) : null;
  }

  const museumArt = new Map();      // "type:id" -> data URL of the museum picture
  const artRequested = new Set();
  let artBatch = null;

  function requestArt(pk) {
    if (!["museums", "custom"].includes(settings.pictureSource) || !pk) return;
    const key = `${pk.type}:${pk.id}`;
    if (artRequested.has(key)) return;
    artRequested.add(key);
    if (!artBatch) {
      artBatch = [];
      setTimeout(flushArt, 0);
    }
    artBatch.push(pk);
  }

  // One message per picture, so each appears as soon as it is found.
  function flushArt() {
    const items = artBatch;
    artBatch = null;
    for (const item of items) {
      browser.runtime.sendMessage({ type: "unfamiliar:art", items: [item] }).then((results) => {
        const r = results[0];
        if (!r || !r.image) return;
        const key = `${r.type}:${r.id}`;
        museumArt.set(key, r.image);
        updateBackdrop();
        for (const img of document.querySelectorAll("img[data-unfamiliar-pic]")) {
          if (img.getAttribute("data-unfamiliar-pic") === key) processImage(img);
        }
      }, (e) => console.error("unfamiliar sounds: pictures", e));
    }
  }

  // The image's own (Spotify) address, remembered before it is replaced.
  const realSrc = new WeakMap();

  // Spotify image ids are a kind and size prefix plus the picture's own
  // hash (the last 24 hex digits), the same at every size.
  function imageTail(src) {
    const m = /\/image\/([0-9a-f]{40})/.exec(src || "");
    return m ? m[1].slice(-24) : "";
  }

  // A cover Spotify made itself (album mosaic or one album's cover), not one
  // uploaded for the playlist.
  function isDefaultCover(img) {
    return S.DEFAULT_PLAYLIST_COVER.test(realSrc.get(img) || "");
  }

  // Unknown or not-yet-derived images keep no mark, so unfamiliar.css keeps
  // them invisible, and lose their alt text (often the real name). Known ones
  // get the picture, the mark and the stand-in name as alt text; "keep"
  // images get their real picture back.
  function processImage(img) {
    const src = img.getAttribute("src") || "";
    if (src && !src.startsWith("data:")) realSrc.set(img, src);
    if (inSafe(img) && !img.matches(S.SAFE_ZONE_IMAGES)) return;
    const what = imageName(img);
    if (what === "keep") {
      const real = realSrc.get(img);
      if (real && img.getAttribute("src") !== real) img.setAttribute("src", real);
      if (img.getAttribute("data-unfamiliar-img") !== "keep") img.setAttribute("data-unfamiliar-img", "keep");
      return;
    }
    const unmark = () => {
      if (img.hasAttribute("data-unfamiliar-img")) img.removeAttribute("data-unfamiliar-img");
      if (img.getAttribute("alt")) img.setAttribute("alt", "");
    };
    // The museum picture, once it has arrived; until then the generated one.
    // People have no library pictures: theirs come from their names.
    const pk = what && what.type === "user" ? null : pictureKey(img);
    const picKey = pk ? `${pk.type}:${pk.id}` : "";
    if (picKey && img.getAttribute("data-unfamiliar-pic") !== picKey) img.setAttribute("data-unfamiliar-pic", picKey);
    if (!picKey && img.hasAttribute("data-unfamiliar-pic")) img.removeAttribute("data-unfamiliar-pic");
    const art = picKey && museumArt.get(picKey);
    if (!art) requestArt(pk);
    // What the generated picture is made from. No image is left blank: with
    // no name next to it, the picture comes from its Spotify ID, and for an
    // image unfamiliar sounds can't place, from its address. The generated
    // picture also stands in whenever a library picture hasn't arrived or
    // couldn't be fetched (offline included).
    let source = what;
    if (!source && pk) source = { type: pk.type === "artist" ? "artist" : "album", text: `${PLACEHOLDER}${pk.type}:${pk.id}` };
    if (!source && realSrc.get(img)) source = { type: "album", text: `${PLACEHOLDER}img:${realSrc.get(img).slice(0, 300)}` };
    if (!source && !art) return unmark();
    const k = source ? tkey(source.type, source.text) : `pic\u0000${picKey}`;
    const url = art || pictures.get(k);
    if (!url) {
      unmark();
      translate(source.type, source.text, () => img.isConnected && processImage(img));
      return;
    }
    if (img.hasAttribute("srcset")) img.removeAttribute("srcset");
    if (img.hasAttribute("sizes")) img.removeAttribute("sizes");
    if (img.getAttribute("src") !== url) img.setAttribute("src", url);
    // Your playlists with a cover Spotify made get a generated picture, but
    // keep their own title as its text.
    const ownAlt = what && what.type === "playlist" && ownTitles.has(what.text) && !settings.replaceOwnPlaylists;
    const alt = ownAlt ? what.text : (what && standIns.get(k)) || "";
    if (img.getAttribute("alt") !== alt) img.setAttribute("alt", alt);
    if (img.getAttribute("data-unfamiliar-img") !== k) img.setAttribute("data-unfamiliar-img", k);
    if (art) {
      if (!img.hasAttribute("data-unfamiliar-art")) img.setAttribute("data-unfamiliar-art", "");
    } else if (img.hasAttribute("data-unfamiliar-art")) {
      img.removeAttribute("data-unfamiliar-art");
    }
  }

  // Videos (song Canvases, preview cards) stay hidden (unfamiliar.css); the
  // box behind them shows a generated picture so there is no dark hole.
  function processVideo(video) {
    const box = video.parentElement;
    if (!box || inSafe(box)) return;
    let ent = null;
    for (let el = box, i = 0; el && i < 6 && !ent; el = el.parentElement, i++) ent = pathEntity(el, ["track", "album", "playlist", "artist"]);
    const text = `${PLACEHOLDER}${ent ? `${ent.type}:${ent.id}` : `video:${location.pathname}`}`;
    const url = pictures.get(tkey("album", text));
    if (!url) return void translate("album", text, () => video.isConnected && processVideo(video));
    const want = `url("${url}")`;
    if (box.style.getPropertyValue("--unfamiliar-poster") !== want) box.style.setProperty("--unfamiliar-poster", want);
    if (!box.hasAttribute("data-unfamiliar-poster")) box.setAttribute("data-unfamiliar-poster", "");
  }

  // --- collections: evidence about playlists (phase 2) ----------------------
  // Real text kept in memory for this page only, to judge playlists.

  const playlists = new Map();       // id -> { title, descParts:Set, names:Set, rows:Map, verdict }
  const sessionNames = new Set();    // real artist names seen this session
  let stuck = {};                    // id -> "person" | "popularity", remembered across visits
  const dirty = new Set();           // playlist ids whose evidence changed
  let pendingReport = null;          // verdicts to send to the background
  const hiddenPages = new Set();     // paths whose real heading is about a person or popularity
  const chipSwitched = new Set();    // artist pages whose Discography shelf was moved off the ranking

  function playlistRecord(id) {
    let rec = playlists.get(id);
    if (!rec) {
      rec = { title: "", descParts: new Set(), names: new Set(), rows: new Map(), format: "", verdict: null };
      playlists.set(id, rec);
    }
    return rec;
  }

  function routePlaylist() {
    const m = S.ROUTE.exec(location.pathname);
    return m && m[1] === "playlist" ? m[2] : null;
  }

  function noteEvidence(info, real) {
    if (info.type === "playlist" && info.id) {
      const rec = playlistRecord(info.id);
      if (rec.title !== real) {
        rec.title = real;
        dirty.add(info.id);
      }
    } else if (info.type === "artist") {
      const here = routePlaylist();
      if (here && info.slot.closest(S.TRACK_ROW) && !playlistRecord(here).names.has(real)) {
        playlistRecord(here).names.add(real);
        dirty.add(here);
      }
      if (!sessionNames.has(real)) {
        sessionNames.add(real);
        for (const id of playlists.keys()) dirty.add(id); // a new name may be in any title
      }
    }
  }

  // Descriptions: a card's subtitle, or the header of the playlist's own page.
  function noteDescriptionFor(el, text) {
    if (!text) return;
    let id = null;
    const sub = el.closest(S.CARD_SUBTITLE);
    if (sub) {
      const m = S.CARD_SUBTITLE_ID.exec(sub.id);
      if (m) id = m[1];
    } else if (el.closest(S.ENTITY_HEADER)) {
      id = routePlaylist();
    }
    if (!id) return;
    const rec = playlistRecord(id);
    if (!rec.descParts.has(text)) {
      rec.descParts.add(text);
      dirty.add(id);
    }
  }

  // Track rows on the playlist's own page: which artists are on each track.
  function noteRows() {
    const id = routePlaylist();
    if (!id) return;
    const rec = playlistRecord(id);
    for (const row of document.querySelectorAll(S.TRACK_ROW)) {
      const track = row.querySelector('a[href*="/track/"]');
      const key = track && track.getAttribute("href");
      if (!key || rec.rows.has(key)) continue;
      const artists = [...row.querySelectorAll('a[href*="/artist/"]')]
        .map((a) => S.ENTITY_HREF.exec(a.getAttribute("href")))
        .filter(Boolean).map((m) => m[2]);
      rec.rows.set(key, artists);
      dirty.add(id);
    }
  }

  function verdictOf(id) {
    if (stuck[id]) return stuck[id];
    const rec = playlists.get(id);
    return (rec && rec.verdict) || "unsure";
  }

  // A theme playlist from Spotify keeps its real title, if the setting is on
  // (off by default: a title can name an artist unfamiliar sounds has never seen).
  function showRealTitle(id) {
    return settings.showThemeTitles && C.isSpotifyPlaylist(id) && C.isShown(verdictOf(id));
  }

  // Judge every playlist whose evidence changed; refresh the slots of any
  // whose verdict changed, and report the verdicts to the background.
  function judgePlaylists() {
    noteRows();
    for (const id of dirty) {
      const rec = playlists.get(id);
      if (!rec) continue;
      const before = verdictOf(id);
      rec.verdict = C.classify({
        title: rec.title,
        description: [...rec.descParts].join(" "),
        names: [...rec.names],
        sessionNames: [...sessionNames],
        rows: [...rec.rows.values()],
        format: rec.format,
      }).verdict;
      if (C.STICKY.has(rec.verdict)) stuck[id] = rec.verdict;
      const after = verdictOf(id);
      if (after !== before) refreshPlaylistSlots(id);
      if (rec.title) report(id, after);
    }
    dirty.clear();
  }

  function refreshPlaylistSlots(id) {
    const slots = [
      ...document.querySelectorAll(`[id^="card-title-spotify:playlist:${id}"], [id^="listrow-title-spotify:playlist:${id}"]`),
      ...document.querySelectorAll(`a[href^="/playlist/${id}"]`),
    ];
    if (routePlaylist() === id) slots.push(...document.querySelectorAll(S.PAGE_TITLE_SLOTS));
    for (const slot of slots) processSlot({ type: "playlist", id, slot });
  }

  function report(id, verdict) {
    if (!pendingReport) {
      pendingReport = {};
      setTimeout(() => {
        const items = pendingReport;
        pendingReport = null;
        browser.runtime.sendMessage({ type: "unfamiliar:verdicts", items }).catch(() => {});
      }, 1000);
    }
    pendingReport[id] = verdict;
  }

  // --- hiding: people and popularity (stage 5) ------------------------------

  function hide(el) {
    if (!el.hasAttribute("data-unfamiliar-hide")) el.setAttribute("data-unfamiliar-hide", "");
  }

  function unhide(el) {
    if (el.hasAttribute("data-unfamiliar-hide")) el.removeAttribute("data-unfamiliar-hide");
  }

  // The block a list belongs to (its heading and "See more" included): climb
  // until the parent holds other shelves or lists, never past the page itself.
  function blockOf(el) {
    let block = el;
    for (let parent = block.parentElement; parent && parent.tagName !== "MAIN"; parent = block.parentElement) {
      if (parent.matches('[data-testid$="-page"]') || parent.querySelector('[data-testid="entity-header"]')) return block;
      const siblings = [...parent.children].filter((c) => c !== block);
      if (siblings.some((c) => c.matches(S.SHELF) || c.querySelector(`${S.SHELF}, [data-testid="track-list"]`))) return block;
      block = parent;
    }
    return block;
  }

  // A card and the wrapper(s) that hold only it: the cell in its row or grid.
  function cardBox(card) {
    let box = card;
    for (let i = 0; i < 4; i++) {
      const parent = box.parentElement;
      if (!parent || parent.children.length !== 1 || parent.matches(`${S.SHELF}, main`)) break;
      box = parent;
    }
    return box;
  }

  function shelfHref(shelf) {
    const link = shelf.querySelector(S.SHELF_LINK);
    return (link && link.getAttribute("href")) || "";
  }

  // Artist pages keep the header and their own Discography shelf only.
  function trimArtistPage(artistId) {
    const page = document.querySelector(S.ARTIST_PAGE);
    if (!page) return;
    const own = [...page.querySelectorAll(S.SHELF)].find((shelf) => {
      const d = S.DISCOGRAPHY_HREF.exec(shelfHref(shelf));
      return d && d[1] === artistId;
    });
    const anyShelf = own || page.querySelector(S.SHELF);
    if (anyShelf && anyShelf.parentElement) {
      for (const child of anyShelf.parentElement.children) {
        if (own && (child === own || child.contains(own))) unhide(child);
        else if (isAboutBlock(child)) unhide(child);
        else hide(child);
      }
    }
    if (own) unrankDiscography(own);
  }

  // The artist's "About" block (the bio) shows when bios are shown; its
  // listener count and ranking are blanked like any other count.
  function isAboutBlock(el) {
    return !settings.hideArtistDescriptions && textNodesIn(el).some((n) => readReal(n).trim() === "About");
  }

  // The shelf opens on "Popular releases", a ranking. Hide that chip and pick
  // "Albums" (by date) instead; keep the shelf hidden until that has happened.
  function unrankDiscography(shelf) {
    const chips = [...shelf.querySelectorAll(S.CHIP)];
    const label = (c) => textNodesIn(c).map(readReal).join("").trim();
    const ranked = chips.find((c) => label(c) === S.RANKED_CHIP);
    if (!ranked) return unhide(shelf);
    hide(ranked);
    if (ranked.getAttribute("aria-checked") !== "true") return unhide(shelf);
    hide(shelf);
    const other = chips.find((c) => label(c) === S.PREFERRED_CHIP) || chips.find((c) => c !== ranked);
    if (other && !chipSwitched.has(location.pathname)) {
      chipSwitched.add(location.pathname);
      other.click();
    }
  }

  function applyHiding() {
    const route = S.ROUTE.exec(location.pathname);
    const artistId = route && route[1] === "artist" ? route[2] : null;
    // A page you chose to see anyway is shown whole.
    const shownHere = shownAnyway.has(location.pathname) ||
      (!settings.hidePages && (S.HIDE_ROUTES.test(location.pathname) || hiddenPages.has(location.pathname)));

    judgePlaylists();
    for (const title of document.querySelectorAll(S.CARD_TITLE)) {
      const m = S.CARD_TITLE_ID.exec(title.id);
      const card = m && title.closest(S.CARD);
      if (!card) continue;
      // Hide the card's grid cell too, so hidden cards leave no gap.
      const box = cardBox(card);
      if (m[1] === "playlist" && !keepOwnPlaylist(m[2]) && !C.isShown(verdictOf(m[2]))) hide(box);
      else unhide(box);
    }

    for (const shelf of document.querySelectorAll(S.SHELF)) {
      const href = shelfHref(shelf);
      const d = S.DISCOGRAPHY_HREF.exec(href);
      const label = readRealAttr(shelf, "aria-label") || "";
      // A shelf whose cards are all hidden goes too, heading and all.
      const cards = [...shelf.querySelectorAll(S.CARD)];
      const empty = cards.length > 0 && cards.every((card) => {
        const h = card.closest("[data-unfamiliar-hide]");
        return h && h !== shelf && shelf.contains(h);
      });
      if (shownHere) unhide(shelf);
      else if (S.HIDE_SHELF_HREF.test(href) || (d && d[1] !== artistId) || S.HIDE_HEADINGS.test(label) || empty) hide(shelf);
      else if (!(d && d[1] === artistId)) unhide(shelf);
    }
    if (!shownHere) for (const list of document.querySelectorAll(S.POPULAR_TRACKS)) hide(blockOf(list));
    if (artistId) trimArtistPage(artistId);

    // Playlists you made: learnt from their page's creator link.
    const here = routePlaylist();
    if (here) {
      const creator = document.querySelector(`${S.ENTITY_HEADER} [data-testid="creator-link"]`);
      const u = creator && S.USER_HREF_ID.exec(creator.getAttribute("href") || "");
      if ((u && ownUserId && u[1] === ownUserId) || (creator && ownName && slotReal(creator) === ownName)) markOwnPlaylist(here);
    }

    const pageHidden = settings.hidePages && !shownAnyway.has(location.pathname) && !keepOwnPlaylist(here) &&
      (S.HIDE_ROUTES.test(location.pathname) || hiddenPages.has(location.pathname) ||
       Boolean(route && route[1] === "playlist" && !C.isShown(verdictOf(route[2]))));
    if (pageHidden) {
      if (root.dataset.unfamiliarPage !== "hidden") root.dataset.unfamiliarPage = "hidden";
    } else if (root.dataset.unfamiliarPage) {
      delete root.dataset.unfamiliarPage;
    }
    showNotice(pageHidden);
  }

  // The notice sits over the page area (outside Spotify's own elements, so
  // React never sees it) and offers to show the page for this visit.
  const shownAnyway = new Set();  // paths shown anyway, until the tab reloads

  function showNotice(visible) {
    let notice = document.getElementById(S.NOTICE_ID);
    if (!visible) {
      if (notice) notice.remove();
      return;
    }
    const main = document.querySelector("main");
    if (!main || !document.body) return;
    if (!notice) {
      notice = document.createElement("div");
      notice.id = S.NOTICE_ID;
      const text = document.createElement("p");
      text.textContent = "unfamiliar sounds hides this page: it is about a person, or about popularity.";
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Show anyway";
      button.addEventListener("click", () => {
        shownAnyway.add(location.pathname);
        applyHiding();
      });
      notice.append(text, button);
      document.body.append(notice);
    }
    const r = main.getBoundingClientRect();
    Object.assign(notice.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  }

  window.addEventListener("resize", () => {
    if (document.getElementById(S.NOTICE_ID)) showNotice(true);
  });

  // --- tooltips, page title -----------------------------------------------

  // Hover text (title="...") and screen-reader labels (aria-label="...")
  // hold names too ("Play <album> by <artist>"). They are never removed,
  // only rewritten ("" hides them), so they can be fixed again later.
  const labelled = new Map(); // element -> its fix function, for reswap()

  // Hover text. A tooltip repeating a name slot's text shows whatever the
  // slot shows (a stand-in, or your own title as written); other hover text
  // is a label like any other.
  function fixTitleAttribute(el) {
    if (!el.hasAttribute("title") || el.closest(S.LABELS_LEFT_ALONE)) return;
    const raw = readRealAttr(el, "title");
    const retry = () => el.isConnected && fixTitleAttribute(el);
    if (inSafe(el)) return safeZoneLabel(el, "title", raw, retry, fixTitleAttribute);
    const info = slotOf(el);
    let want;
    const real = info ? slotReal(info.slot) : "";
    if (info && real && norm(raw) === norm(real)) want = slotShown(info.slot);
    else if (info && info.type) want = (real && translate(info.type, real, retry)) || "";
    else if (isSafeText(raw.trim())) want = raw;
    else if (el.closest(S.UI_ZONES)) want = substitute(raw, retry) || "";
    else want = labelText(raw, retry);
    labelled.set(el, fixTitleAttribute);
    writeAttr(el, "title", want);
  }

  // Screen-reader labels. Your account button keeps your name unless
  // "Change my name and picture" is on (see noteOwnName).
  function fixAriaLabel(el) {
    if (!el.hasAttribute("aria-label") || el.matches(S.USER_WIDGET) || el.closest(S.LABELS_LEFT_ALONE)) return;
    const raw = readRealAttr(el, "aria-label");
    const retry = () => el.isConnected && fixAriaLabel(el);
    if (inSafe(el)) return safeZoneLabel(el, "aria-label", raw, retry, fixAriaLabel);
    labelled.set(el, fixAriaLabel);
    writeAttr(el, "aria-label", labelText(raw, retry));
  }

  // Labels in safe zones (the nav bar, player controls, the action bar) are
  // judged like any other: the action bar's "More options for <podcast>"
  // can name something the page title never made known. Genre tiles keep
  // their genre names, as their text does.
  function safeZoneLabel(el, attr, raw, retry, fix) {
    labelled.set(el, fix);
    writeAttr(el, attr, el.closest(S.GENRE_TILE) ? raw : labelText(raw, retry));
  }

  // A label with every known name swapped. What is left once the known
  // names (and your own name and titles, where they stay) are taken out must
  // be Spotify's own words; otherwise the label may hold a name unfamiliar
  // sounds doesn't know, and it is cut back to its leading words ("Play",
  // "More options for") or emptied. While a name in it is still being
  // derived it is empty, and `retry` runs once the name arrives.
  function labelText(raw, retry) {
    const text = raw.trim();
    if (!text || isSafeText(text)) return raw;
    const swapped = substitute(raw, retry);
    if (swapped === null) return "";
    let rest = raw;
    for (const [name, , re] of swaps()) if (rest.includes(name)) rest = rest.replace(re, "$1 ");
    if (ownName && !settings.replaceOwnProfile && rest.includes(ownName)) rest = rest.split(ownName).join(" ");
    if (!settings.replaceOwnPlaylists) {
      const own = [...ownTitles].filter((t) => t.length >= 2 && rest.includes(t)).sort((a, b) => b.length - a.length);
      for (const t of own) rest = rest.replace(nameRe(t), "$1 ");
    }
    if (S.labelWordsOnly(rest)) return swapped;
    return S.labelPrefix(raw);
  }

  // The artist's About card has its photo as an inline background image:
  // unfamiliar.css shows the page's own picture there instead.
  function markAboutPhoto(el) {
    if (!el.hasAttribute("data-unfamiliar-backdrop")) el.setAttribute("data-unfamiliar-backdrop", "");
  }

  // Inline background images (artist banners, playlist backdrops) are
  // removed by unfamiliar.css and replaced by this page's own picture, via a
  // CSS variable, so headers aren't left empty.
  let backdrop = null;

  function updateBackdrop() {
    const m = S.ROUTE.exec(location.pathname);
    let url = "";
    if (m) {
      const key = `${m[1] === "track" ? "track" : m[1]}:${m[2]}`;
      url = museumArt.get(key) || "";
      if (!url) {
        requestArt({ type: m[1], id: m[2] });
        const real = slotReal(document.querySelector(S.PAGE_TITLE_SLOTS));
        url = (real && pictures.get(tkey(m[1], real))) || pictures.get(tkey(m[1] === "artist" ? "artist" : "album", `${PLACEHOLDER}${m[1]}:${m[2]}`)) || "";
        if (!url) translate(m[1] === "artist" ? "artist" : "album", `${PLACEHOLDER}${m[1]}:${m[2]}`, () => updateBackdrop());
      }
    }
    if (url === backdrop) return;
    backdrop = url;
    if (url) root.style.setProperty("--unfamiliar-backdrop", `url("${url}")`);
    else root.style.removeProperty("--unfamiliar-backdrop");
  }

  function updateDocumentTitle() {
    const m = S.ROUTE.exec(location.pathname);
    let want = "Spotify";
    if (m) {
      const real = slotReal(document.querySelector(S.PAGE_TITLE_SLOTS));
      if (real && m[1] === "playlist" && (showRealTitle(m[2]) || keepOwnPlaylist(m[2]))) want = `${real} · Spotify`;
      else if (real && ready) {
        const name = translate(m[1], real, null);
        if (name) want = `${name} · Spotify`;
      }
    }
    // Spotify adds the next page's <title> before removing the old one, so
    // every <title> in the head is fixed, not just the current one.
    if (document.head) {
      for (const t of document.head.querySelectorAll("title")) {
        const n = t.firstChild;
        if (n && n.nodeType === Node.TEXT_NODE && !n.nextSibling) {
          if (n.nodeValue !== want) n.nodeValue = want;
        } else if (t.textContent !== want) {
          t.textContent = want;
        }
      }
    }
    if (document.title !== want) document.title = want;
  }

  // --- walking the page -----------------------------------------------------

  function processTree(node) {
    if (node.nodeType === Node.TEXT_NODE) return processText(node);
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (isDocumentTitle(node)) return updateDocumentTitle();
    // Your avatar sits in the nav bar, a safe zone, but is still handled, as
    // are genre tiles' pictures.
    if (node.matches(S.SAFE_ZONE_IMAGES)) processImage(node);
    node.querySelectorAll(S.SAFE_ZONE_IMAGES).forEach(processImage);
    // Labels inside safe zones can still name things ("More options for
    // <album>" in the action bar).
    if (inSafe(node)) return fixLabelsIn(node);
    if (node.matches(S.ABOUT_PHOTO)) markAboutPhoto(node);
    node.querySelectorAll(S.ABOUT_PHOTO).forEach(markAboutPhoto);
    textNodesIn(node).forEach(processText);
    fixLabelsIn(node);
    if (node.tagName === "IMG") processImage(node);
    node.querySelectorAll("img").forEach(processImage);
    if (node.tagName === "VIDEO") processVideo(node);
    node.querySelectorAll("video").forEach(processVideo);
  }

  function inSafeZone(node) {
    const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    return Boolean(el && !isDocumentTitle(el) && inSafe(el));
  }

  function onMutations(records) {
    if (!ownName) noteOwnName();
    let touched = false;
    for (const r of records) {
      // The player's progress bar and clock change constantly; they are in
      // safe zones, so those changes cost nothing.
      if (r.target.nodeType === Node.ELEMENT_NODE && r.target.matches(S.SAFE_ZONE_IMAGES)) {
        processImage(r.target);
        continue;
      }
      if (inSafeZone(r.target)) {
        if (r.type === "childList") {
          r.addedNodes.forEach((n) => {
            if (n.nodeType !== Node.ELEMENT_NODE) return;
            if (n.matches(S.SAFE_ZONE_IMAGES)) processImage(n);
            n.querySelectorAll(S.SAFE_ZONE_IMAGES).forEach(processImage);
            fixLabelsIn(n);
          });
        } else if (r.attributeName === "title") {
          fixTitleAttribute(r.target);
        } else if (r.attributeName === "aria-label") {
          fixAriaLabel(r.target);
        }
        continue;
      }
      touched = true;
      // One odd node must not stop the rest of the batch from being fixed.
      try {
        if (r.type === "characterData") processText(r.target);
        else if (r.type === "childList") r.addedNodes.forEach(processTree);
        else if (r.attributeName === "title") fixTitleAttribute(r.target);
        else if (r.attributeName === "aria-label") fixAriaLabel(r.target);
        else if (r.target.tagName === "IMG") processImage(r.target); // src or srcset changed
        else processTree(r.target); // href or id changed: the slot may now name something else
      } catch (e) {
        console.error("unfamiliar sounds:", e);
      }
    }
    if (!touched) return;
    if (!ownName) noteOwnName();
    applyHiding();
    updateBackdrop();
    updateDocumentTitle();
    refreshMediaSession();
  }

  // --- search: stand-ins back to real names -----------------------------------
  // Typing a stand-in in Spotify's search finds nothing, because Spotify only
  // knows real names. So the search requests the page sends are rewritten on
  // the way out: any stand-in in the query becomes the real name it stands
  // for. The search box, the address bar and the results never show it;
  // results come back and are replaced as usual.
  //
  // A stand-in can only be turned back if its real name has been seen (the
  // keyed hash can't be run backwards), so the extension keeps a table of
  // stand-in -> real name in its own storage ("reverseNames"), on this
  // computer only.

  const reverse = new Map();       // stand-in, lower case -> real name
  let reverseStore = "reverseNames"; // per seed: "reverseNames:<seed id>"
  const REVERSE_MAX = 20000;
  let reverseSave = null;

  function rememberReverse(standIn, real) {
    const k = standIn.toLowerCase();
    if (reverse.get(k) === real) return;
    reverse.delete(k);
    reverse.set(k, real);
    if (reverse.size > REVERSE_MAX) reverse.delete(reverse.keys().next().value);
    clearTimeout(reverseSave);
    reverseSave = setTimeout(() => {
      browser.storage.local.set({ [reverseStore]: Object.fromEntries(reverse) }).catch(() => {});
    }, 2000);
  }

  // The query with stand-ins replaced by real names. A query that is the
  // start of exactly one known stand-in (as you type) becomes that real name.
  function unsubstitute(query) {
    const q = query.trim();
    if (q.length < 3) return query;
    const lower = q.toLowerCase();
    if (reverse.has(lower)) return reverse.get(lower);
    let out = q;
    let changed = false;
    const keys = [...reverse.keys()].filter((k) => k.length >= 5 && lower.includes(k)).sort((a, b) => b.length - a.length);
    for (const k of keys) {
      const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(k)}(?=$|[^\\p{L}\\p{N}])`, "giu");
      const next = out.replace(re, (m, pre) => pre + reverse.get(k));
      if (next !== out) { out = next; changed = true; }
    }
    if (changed) return out;
    const starts = [...reverse.keys()].filter((k) => k.startsWith(lower));
    return starts.length === 1 ? reverse.get(starts[0]) : query;
  }

  // Spotify searches by POSTing JSON to its query service with the typed
  // text in variables.query (operations named search…). Only that one field
  // of those requests is touched.
  function guardSearch() {
    const page = window.wrappedJSObject;
    if (!page || typeof page.fetch !== "function") return;
    const original = page.fetch;
    page.fetch = exportFunction(function (input, init) {
      let url = "";
      try {
        const raw = init && init.wrappedJSObject ? init.wrappedJSObject : init;
        url = typeof input === "string" ? input : (input && input.url) || "";
        if (ready && raw && typeof raw.body === "string" && /\/pathfinder\//.test(url)) {
          const body = JSON.parse(raw.body);
          const query = body && body.variables && body.variables.query;
          if (/^search/i.test(body.operationName || "") && typeof query === "string") {
            const real = unsubstitute(query);
            if (real !== query) {
              body.variables.query = real;
              const next = new page.Object();
              for (const key of Object.keys(raw)) next[key] = raw[key];
              next.body = JSON.stringify(body);
              init = next;
            }
          }
        }
      } catch (e) {
        console.error("unfamiliar sounds: search", e);
      }
      const result = original.call(page, input, init);
      if (/\/pathfinder\//.test(url) || S.ROOTLIST_URL.test(url)) readPageData(result);
      return result;
    }, page);
  }

  // --- what the page's own data says about playlists ---------------------------
  // The answers Spotify's query service sends the page (no request of
  // unfamiliar sounds' own) say who owns each playlist shown, its title, and
  // its format ("inspiredby-mix", "chart"). Read in memory only: your
  // playlists are recognised before they are seen in the Library, menus can
  // tell yours from other people's, and mixes made from one artist are known
  // as such.

  const dataPlaylists = new Map(); // id -> { name, ownerId, ownerName, format }

  function readPageData(promise) {
    const page = window.wrappedJSObject;
    const quiet = exportFunction(() => {}, page);
    try {
      promise.then(exportFunction((response) => {
        try {
          response.clone().text().then(exportFunction((text) => {
            try { learnFromData(JSON.parse(text)); } catch (e) { /* not JSON */ }
          }, page), quiet);
        } catch (e) { /* body already used */ }
      }, page), quiet);
    } catch (e) {
      console.error("unfamiliar sounds: page data", e);
    }
  }

  const PLAYLIST_URI = /^spotify:playlist:([0-9A-Za-z]{22})$/;
  const USER_URI = /^spotify:user:([^:]+)$/;

  function learnFromData(data) {
    if (data && data.contents && Array.isArray(data.contents.items) && Array.isArray(data.contents.metaItems)) {
      learnFromLibraryList(data.contents);
      return;
    }
    let budget = 500000;
    const walk = (o, depth) => {
      if (depth > 60 || --budget < 0) return;
      if (Array.isArray(o)) {
        for (const x of o) if (x && typeof x === "object") walk(x, depth + 1);
        return;
      }
      if (o.__typename === "Playlist" && typeof o.uri === "string") notePlaylistData(o);
      // Your own account ("me" in profile queries).
      const me = o.me && o.me.profile;
      if (me && typeof me.username === "string" && !ownUserId) ownUserId = me.username;
      for (const k in o) {
        const v = o[k];
        if (v && typeof v === "object") walk(v, depth + 1);
      }
    };
    if (data && typeof data === "object") walk(data, 0);
    checkDataOwners();
  }

  function notePlaylistData(o) {
    const m = PLAYLIST_URI.exec(o.uri);
    if (!m) return;
    const id = m[1];
    const rec = dataPlaylists.get(id) || {};
    if (typeof o.name === "string" && o.name) rec.name = o.name;
    const owner = o.ownerV2 && o.ownerV2.data;
    const u = owner && typeof owner.uri === "string" && USER_URI.exec(owner.uri);
    if (u) {
      rec.ownerId = decodeURIComponent(u[1]);
      rec.ownerName = typeof owner.name === "string" ? owner.name : "";
    }
    if (typeof o.format === "string" && o.format && rec.format !== o.format) {
      rec.format = o.format;
      const ev = playlistRecord(id);
      ev.format = o.format;
      dirty.add(id);
    }
    dataPlaylists.set(id, rec);
  }

  // Your library's list (fetched by the page when the "Add to playlist"
  // menu opens): every playlist in it, its title and its owner.
  function learnFromLibraryList(contents) {
    contents.items.forEach((item, i) => {
      const meta = contents.metaItems[i];
      const m = item && typeof item.uri === "string" && PLAYLIST_URI.exec(item.uri);
      if (!m || !meta) return;
      const rec = dataPlaylists.get(m[1]) || {};
      if (meta.attributes && typeof meta.attributes.name === "string") rec.name = meta.attributes.name;
      if (typeof meta.ownerUsername === "string") {
        rec.ownerId = meta.ownerUsername;
        rec.ownerName = "";
      }
      dataPlaylists.set(m[1], rec);
    });
    checkDataOwners();
  }

  // On first load the page draws Home and other views from its own saved
  // copy of earlier answers (IndexedDB "keyval-store", key "react-query"),
  // not from the network. That copy is read once, before anything is shown,
  // so your playlists there are known from the first frame. Only read: the
  // database is opened only if it exists, and never changed.
  async function readCachedPageData() {
    const page = window.wrappedJSObject;
    try {
      const idb = page.indexedDB;
      if (!idb || typeof idb.databases !== "function") return;
      const list = await idb.databases();
      if (![...list].some((d) => d.name === S.PAGE_CACHE_DB)) return;
      const text = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(""), 1500);
        const finish = (v) => { clearTimeout(timer); resolve(v); };
        const req = idb.open(S.PAGE_CACHE_DB);
        req.onerror = exportFunction(() => finish(""), page);
        req.onsuccess = exportFunction(() => {
          try {
            const db = req.result;
            if (![...db.objectStoreNames].includes(S.PAGE_CACHE_STORE)) { db.close(); return finish(""); }
            const get = db.transaction(S.PAGE_CACHE_STORE, "readonly").objectStore(S.PAGE_CACHE_STORE).get(S.PAGE_CACHE_KEY);
            get.onerror = exportFunction(() => { db.close(); finish(""); }, page);
            get.onsuccess = exportFunction(() => {
              let out = "";
              try { out = get.result ? page.JSON.stringify(get.result) : ""; } catch (e) { /* not cloneable */ }
              db.close();
              finish(out || "");
            }, page);
          } catch (e) {
            finish("");
          }
        }, page);
      });
      if (text) learnFromData(JSON.parse(text));
    } catch (e) {
      console.error("unfamiliar sounds: page cache", e);
    }
  }

  // Playlists the page's data says are yours (by your user id, or by your
  // display name while the id isn't known).
  function dataOwnsIt(rec) {
    if (!rec || !rec.ownerId) return false;
    if (ownUserId) return rec.ownerId === ownUserId;
    return Boolean(ownName && rec.ownerName === ownName);
  }

  function checkDataOwners() {
    if (!ready) return;
    for (const [id, rec] of dataPlaylists) {
      if (C.isSpotifyPlaylist(id)) continue;
      if (dataOwnsIt(rec)) markOwnPlaylist(id);
      // Titles of your playlists, also those only known as yours from an
      // earlier visit (the menu lists them by title alone).
      if (rec.name && ownPlaylists.has(id)) noteOwnTitle(rec.name, true);
    }
  }

  // Patch before any page script runs.
  try { guardSearch(); } catch (e) { console.error("unfamiliar sounds: search", e); }

  // --- media session (system media overlay) --------------------------------

  // Spotify sets navigator.mediaSession.metadata with the real title, artist
  // and cover. The page's setter is replaced so whatever it sets becomes the
  // stand-in names with no artwork. Content-script code goes through Xray
  // wrappers and still reaches the browser's own setter. Nothing here may
  // throw into the page.
  let lastMetadata = null;

  function safeMetadata() {
    try {
      const widget = document.querySelector(S.NOW_PLAYING);
      const track = widget && widget.querySelector(S.NOW_PLAYING_TRACK);
      const artists = widget ? [...widget.querySelectorAll(S.NOW_PLAYING_ARTISTS)] : [];
      const name = (type, el) => {
        const real = slotReal(el);
        return (real && ready && translate(type, real, null)) || "";
      };
      return {
        title: track ? name("track", track) : "",
        artist: artists.map((a) => name("artist", a)).filter(Boolean).join(", "),
        album: "",
        artwork: [],
      };
    } catch (e) {
      return { title: "", artist: "", album: "", artwork: [] };
    }
  }

  function refreshMediaSession() {
    try {
      if (!navigator.mediaSession || !navigator.mediaSession.metadata) return;
      const meta = safeMetadata();
      const sig = JSON.stringify(meta);
      if (sig === lastMetadata) return;
      lastMetadata = sig;
      navigator.mediaSession.metadata = new MediaMetadata(meta);
    } catch (e) {
      console.error("unfamiliar sounds: media session", e);
    }
  }

  function guardMediaSession() {
    const page = window.wrappedJSObject;
    if (!page || !page.MediaSession) return;
    const proto = page.MediaSession.prototype;
    const native = Object.getOwnPropertyDescriptor(MediaSession.prototype, "metadata");
    if (!native || !native.set) return;
    Object.defineProperty(proto, "metadata", {
      configurable: true,
      enumerable: true,
      get: exportFunction(function () { return native.get.call(navigator.mediaSession); }, page),
      set: exportFunction(function (value) {
        lastMetadata = null;
        try {
          native.set.call(navigator.mediaSession, value ? new MediaMetadata(safeMetadata()) : null);
        } catch (e) {
          console.error("unfamiliar sounds: media session", e);
        }
      }, page),
    });
  }

  // Patch before any page script runs.
  try { guardMediaSession(); } catch (e) { console.error("unfamiliar sounds: media session", e); }

  // --- start and stop -----------------------------------------------------

  async function start() {
    const init = await browser.runtime.sendMessage({ type: "unfamiliar:init" });
    stuck = init.stuck || {};
    settings = Object.assign(settings, init.settings || {});
    reverseStore = `reverseNames:${init.seedId}`;
    const stored = await browser.storage.local.get({ ownPlaylists: [], [reverseStore]: {} });
    for (const id of stored.ownPlaylists) if (!C.isSpotifyPlaylist(id)) ownPlaylists.add(id);
    for (const [k, v] of Object.entries(stored[reverseStore])) reverse.set(k, v);
    noteOwnName();
    await readCachedPageData();
    ready = true;
    checkDataOwners();
    observer = new MutationObserver(onMutations);
    observer.observe(root, {
      subtree: true, childList: true, characterData: true,
      attributes: true, attributeFilter: ["title", "aria-label", "href", "id", "src", "srcset", "alt"],
    });
    if (document.body) processTree(document.body);
    applyHiding();
    updateDocumentTitle();
    root.dataset.unfamiliarReady = "";
  }

  start().catch((e) => {
    console.error("unfamiliar sounds:", e);
    root.dataset.unfamiliarError = e && e.message ? e.message : String(e);
  });

  // Switching off, changing the key or changing a setting reloads the page:
  // nothing half-rewritten is left behind.
  browser.runtime.onMessage.addListener((message) => {
    if (message && ["unfamiliar:off", "unfamiliar:rekey", "unfamiliar:settings"].includes(message.type)) {
      if (observer) observer.disconnect();
      location.reload();
    }
  });
})();
