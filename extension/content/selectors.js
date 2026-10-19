// Everything unfamiliar sounds knows about the Spotify web player's page structure, in
// one place. Spotify changes its markup often; when something breaks, this
// is the file to update. Prefer links, data-testid and ARIA over classes.
//
// The rule is fail closed: inside the page, a piece of text stays visible
// only if it is (1) a name unfamiliar sounds has replaced, (2) inside a known-safe zone,
// or (3) plainly not a name (SAFE_TEXT). Everything else is blanked.

(function (root) {
  "use strict";

  // Links whose text is the name of the thing they point to. Podcasts,
  // episodes and audiobooks are named like releases.
  // Groups: 1 = type, 2 = Spotify ID. Deeper paths (/artist/<id>/discography)
  // don't match and fall through to the fail-closed rule.
  const ENTITY_HREF = /^(?:https:\/\/open\.spotify\.com)?\/(?:intl-[a-z-]+\/)?(track|album|artist|playlist|show|episode|audiobook)\/([0-9A-Za-z]{22})\/?(?:[?#].*)?$/;

  // A link to an album that "highlights" one of its songs is labelled with
  // the song's title (song cards, the now-playing bar). The song wins.
  const HIGHLIGHT = /[?&]highlight=spotify:(track):([0-9A-Za-z]{22})/;

  // Card titles carry the real entity in their id, even when the card links
  // somewhere else (a song card links to its album with ?highlight=).
  const CARD_TITLE = '[id^="card-title-spotify:"]';
  const CARD_TITLE_ID = /^card-title-spotify:(track|album|artist|playlist):([0-9A-Za-z]{22})/;

  // Text that names the page's own entity, taken from the URL.
  const PAGE_TITLE_SLOTS = [
    '[data-testid="entityTitle"]',
    '[data-testid="topbar-content"]',
    '[data-testid="adaptiveEntityTitle"]',                  // artist page header
  ].join(",");
  const ROUTE = /^\/(?:intl-[a-z-]+\/)?(track|album|artist|playlist)\/([0-9A-Za-z]{22})/;

  // The now-playing bar, for the media session (system media overlay).
  const NOW_PLAYING = '[data-testid="now-playing-widget"]';
  const NOW_PLAYING_TRACK = 'a[data-testid="context-item-link"], [data-testid="context-item-info-title"] a[href]';
  const NOW_PLAYING_ARTISTS = '[data-testid="context-item-info-subtitles"] a[href]';

  // Pictures. An <img> takes the picture of the entity its container is
  // about. Unknown images stay hidden (unfamiliar.css). Inline background images
  // (hero banners) are always removed.
  const CARD = '[data-encore-id="card"]';
  const PAGE_IMAGE_SLOTS = '[data-testid="entity-header"]';     // entity from the URL
  const IMAGE_CONTAINERS = [
    '[data-testid="tracklist-row"]',
    '[data-testid="top-result-card"]',
    '[data-testid="artist-pick-image-container"]',
    '[data-testid="track-artist-link-card"]',
    '[data-testid="now-playing-widget"]',
  ].join(",");
  // Which link in a container names the picture. Pictures are keyed by the
  // name shown, so a song's picture follows the song's title.
  const IMAGE_LINK_ORDER = ["track", "album", "playlist", "artist", "user"];

  // --- Hiding (stage 5): people, popularity --------------------------------

  // A shelf is a row of cards with a heading. Its aria-label holds the real
  // heading; its "Show all" link says what it is.
  const SHELF = 'section[data-testid="component-shelf"]';
  const SHELF_LINK = '[data-testid="see-all-link"]';
  // A song page's "Recommended releases" (more-like-this) is mostly the
  // same artist's other releases, so it goes like a discography shelf.
  const HIDE_SHELF_HREF = /\/artist\/[0-9A-Za-z]{22}\/(featuring|discovered-on|playlists|related|appears-on|concerts)\b|\/track\/[0-9A-Za-z]{22}\/more-like-this\b/;
  // Discography shelves are hidden everywhere except on that artist's own page.
  const DISCOGRAPHY_HREF = /\/artist\/([0-9A-Za-z]{22})\/discography\b/;
  const HIDE_HEADINGS = /^(trending|popular|featured charts|charts?\b|top \d|top (songs|tracks|artists|albums|hits)\b|most (played|popular)|featuring |fans also like|more by |appears on|discovered on|artist playlists|artist pick|on tour)/i;

  // Phase 2: where unfamiliar sounds reads evidence about playlists. The rules that
  // judge them are in core/collections.js.
  const CARD_SUBTITLE = '[id^="card-subtitle-spotify:playlist:"]';
  const CARD_SUBTITLE_ID = /^card-subtitle-spotify:playlist:([0-9A-Za-z]{22})/;
  const ENTITY_HEADER = '[data-testid="entity-header"]';
  const TRACK_ROW = '[data-testid="tracklist-row"]';

  // "Popular tracks" lists (artist pages, song pages). Hidden with their heading.
  const POPULAR_TRACKS = '[data-testid="track-list"][aria-label="popular tracks"]';

  // Artist pages keep only the header and the Discography shelf, and the
  // shelf is switched from "Popular releases" (a ranking) to "Albums".
  const ARTIST_PAGE = '[data-testid="artist-page"]';
  const CHIP = 'button[data-encore-id="chip"]';
  const RANKED_CHIP = "Popular releases";
  const PREFERRED_CHIP = "Albums";

  // Whole pages replaced by a short notice.
  const HIDE_ROUTES = /^\/(?:intl-[a-z-]+\/)?(artist\/[0-9A-Za-z]{22}\/(discography|related|featuring|appears-on|discovered-on|playlists|concerts)|concert\/)/;
  const PAGE_HEADING = 'main h1';

  // --- Names keyed by displayed text (17 October 2026) ----------------------

  // Elements whose id says what they are titling: cards and library rows.
  //   card-title-spotify:<type>:<id>-<n>    listrow-title-spotify:<type>:<rest>
  const TITLE_ID = '[id^="card-title-spotify:"], [id^="listrow-title-spotify:"]';
  const TITLE_ID_RE = /^(?:card|listrow)-title-spotify:([a-z]+):(.+)$/;
  const LIST_ROW = '[data-encore-id="listRow"]';
  // Titles and subtitles of rows and cards, ids or not.
  const ROW_TITLE_ANY = '[data-encore-id="listRowTitle"], [data-encore-id="cardTitle"]';
  const ROW_SUBTITLE_ANY = '[data-encore-id="listRowSubtitle"], [data-encore-id="cardSubtitle"]';
  // A row title that is neither linked nor id'd (the Recents page).
  const ENTITY_ROW_TITLE = '[data-entity-row] [data-encore-id="listRowTitle"]';
  // A song title that isn't a link (a profile's top tracks).
  const TRACK_TITLE_PLAIN = '[data-testid="tracklist-row"] [aria-colindex="2"] div[data-encore-id="text"][dir="auto"]';
  // Your local files.
  const LOCAL_HREF = /^\/local\//;
  // Headings of shelves and sections: Spotify's words, sometimes with a name.
  const HEADINGS = 'main h2, main h3, [data-testid="see-all-link"]';
  const FOLLOWER_COUNT = /^[\d,.]+[KM]?\s+Followers?$/i;
  const POPULARITY_COUNT = /^(?:[\d,.]+[KMB]?\s+(?:monthly listeners?|listeners?|followers?|saves?|likes?|plays?|streams?)|#\d[\d,]*\s+in the world)$/i;
  // Library row subtitles: "Playlist • <owner>", "Album • <artist>, <artist>".
  const LISTROW_SUBTITLE = '[id^="listrow-subtitle-spotify:"]';
  // Card subtitles of anything but playlists ("Album • <artist>" on Recents
  // cards), when they hold no links of their own.
  const CARD_SUBTITLE_ANY = '[id^="card-subtitle-spotify:"]';
  // Links to people that aren't /artist/ pages.
  const USER_HREF = /^\/user\/[^/?#]+/;
  const URI_ARTIST = /^spotify:artist:[0-9A-Za-z]{22}/;

  // Free text about someone: artist bios (a text block with spotify: links)
  // and playlist descriptions in page headers. Shown as "???" unless the
  // "Show descriptions" setting is on.
  const DESCRIPTION = [
    '[data-encore-id="text"]:has(> a[href^="spotify:"])',
    '[data-testid="entity-header"] span[data-encore-id="text"] > div',
  ].join(",");

  // Interface text: tooltips, menus, buttons, chips and the devices panel.
  // Shown as written, with any name unfamiliar sounds knows swapped for its stand-in.
  const UI_ZONES = [
    '[role="tooltip"]',
    '[role="menu"]',
    'button',
    '[data-encore-id="chip"]',
    '[role="checkbox"]',
    'aside[aria-label="Connect to a device"]',
    '[data-testid^="device-picker"]',
    // Browse tiles on /search that aren't genres: "Live Events", "Podcast
    // Charts", seasonal hubs. Spotify's words, with known names swapped.
    'a[href="/concerts"]',
    'a[href^="/podcastcharts"]',
    'a[href^="/cultural-moment/"]',
  ].join(",");

  // --- You and your own things (17 October 2026) ----------------------------

  // Spotify's built-in collections (Liked Songs, Your Episodes, Local Files):
  // titles and covers stay as they are.
  const BUILTIN_TITLE = /^(?:card|listrow)-title-spotify:(?:collection\b|local-files\b)/;
  const BUILTIN_SUBTITLE = /^listrow-subtitle-spotify:(?:collection\b|local-files\b)/;

  // Your account button: its aria-label is your display name; it holds your avatar.
  const USER_WIDGET = '[data-testid="user-widget-link"]';
  const USER_AVATAR = '[data-testid="user-widget-avatar"] img';
  // Pictures inside safe zones that are still handled: your avatar, and the
  // pictures on genre tiles (Browse on /search), which get generated ones.
  const SAFE_ZONE_IMAGES = `${USER_AVATAR}, a[href^="/genre/"] img`;
  // The photo on the artist page's About card is an inline background image;
  // it shows the page's own picture instead (unfamiliar.css).
  const ABOUT_PHOTO = '[data-testid="artist-page"] button[style*="url("]';
  // Your folders carry your user id: spotify:user:<you>:folder:<id>.
  const OWN_FOLDER_ID = /spotify:user:([^:]+):folder:/;
  const USER_ROUTE = /^\/(?:intl-[a-z-]+\/)?user\/([^/?#]+)/;
  // A link to a person's profile itself, not to its sub-pages (/user/<id>/top/tracks…).
  const USER_HREF_ID = /^\/user\/([^/?#]+)\/?(?:[?#].*)?$/;

  // Covers Spotify makes itself for a playlist without an uploaded picture:
  // a 2x2 mosaic of album covers, or one album's cover (image ids ab67616d…).
  // Uploaded playlist pictures have other ids (ab67706c…).
  // The built-in collections' own covers (the Liked Songs heart and the like).
  const BUILTIN_COVER = /misc\.(?:scdn\.co|spotifycdn\.com)\/(?:liked-songs|your-episodes|local-files)|\/(?:liked-songs|your-episodes|local-files)-\d+\.(?:png|jpe?g|webp)/;

  const DEFAULT_PLAYLIST_COVER = /mosaic\.scdn\.co\/|\/image\/ab67616d/;

  // The notice shown over a hidden page.
  const NOTICE_ID = "unfamiliar-notice";

  // Where the page keeps data unfamiliar sounds reads (in memory only): your
  // library's list, fetched when "Add to playlist" opens, and the page's
  // saved copy of earlier query answers.
  const ROOTLIST_URL = /\/playlist\/v2\/user\/[^/?#]+\/rootlist\b/;
  const PAGE_CACHE_DB = "keyval-store";
  const PAGE_CACHE_STORE = "keyval";
  const PAGE_CACHE_KEY = "react-query";

  // "Made for <name>" in the subtitles of Spotify's mixes made for you.
  const MADE_FOR = /^(Made for )(.+)$/i;

  // Screen-reader labels and hover text: the words Spotify builds them from
  // ("Play <album> by <artist>", "More options for <playlist>"). Once the
  // names unfamiliar sounds knows are taken out, a label may only hold these
  // words (and the words of SAFE_PHRASES); anything else may be a name.
  const LABEL_WORDS = new Set(`
    a an and by for from in of on or to with your you my me this that it
    play pause preview resume shuffle repeat enable disable next previous skip
    more options save remove add go back forward close open opens show hide
    expand collapse folder folders tab new list view default custom order sort
    filter filters options search clear field type update will below content
    now playing bar player controls connect device mute unmute volume high low
    full screen enter exit lyrics queue friend activity listening what's whats
    browse main navigation resize library liked songs episodes saved downloaded
    good morning afternoon evening spotify web listen music podcasts audiobooks
    online home create playlist playlists album albums artist artists song
    track tracks episode podcast audiobook profile user explicit verified
    edit details delete share copy link embed report download downloaded app
    install premium free mini player picture what do want not all is
    notifications notification friends
  `.split(/\s+/).filter(Boolean));

  const labelWords = (text) => (text || "").split(/[^\p{L}\p{N}']+/u).filter(Boolean);

  // True when every word of `text` is one of LABEL_WORDS. Numbers aren't:
  // a song can be called "0397".
  function labelWordsOnly(text) {
    return labelWords(text).every((w) => LABEL_WORDS.has(w.toLowerCase()));
  }

  // The label's leading run of LABEL_WORDS ("Play X by Y" -> "Play"), or "".
  function labelPrefix(text) {
    const out = [];
    for (const w of (text || "").trim().split(/\s+/)) {
      const words = labelWords(w);
      if (!words.every((x) => LABEL_WORDS.has(x.toLowerCase()))) break;
      out.push(w);
    }
    while (out.length && (/^(a|an|and|by|for|from|in|of|on|or|to|with)$/i.test(out[out.length - 1]) || !labelWords(out[out.length - 1]).length)) out.pop();
    return out.join(" ");
  }

  // Pages of podcasts, episodes and audiobooks: their title is named like a
  // release (pictures and the tab title stay as they were).
  const MEDIA_ROUTE = /^\/(?:intl-[a-z-]+\/)?(show|episode|audiobook)\/([0-9A-Za-z]{22})/;

  // Genre tiles on /search: their names are shown on purpose.
  const GENRE_TILE = 'a[href^="/genre/"]';

  // Labels left alone: the cookie banner's own dialog.
  const LABELS_LEFT_ALONE = "#onetrust-consent-sdk, #onetrust-pc-sdk";

  // Menus, and the search box that opens the "Add to playlist" submenu.
  const MENU = '[role="menu"]';
  const MENU_SEARCH = '[role="search"]';

  // Inside a safe zone, these still hold names: the search box's suggestion
  // and recent-search dropdowns, and any dialog or menu opened from there.
  const UNSAFE_IN_SAFE = '[role="listbox"], [role="option"], [role="dialog"], [role="menu"]';

  // Zones that never hold names: browser chrome, player buttons, legal text.
  const SAFE_ZONES = [
    '[data-testid="global-nav-bar"]',
    '#unfamiliar-notice',                                   // our own notice over hidden pages
    '[data-testid="left-sidebar-legal-links"]',
    '[data-testid="left-sidebar-footer"]',
    '[data-testid="language-selection-modal"]',
    '[data-testid="footer-div"]',
    '[data-testid="signup-bar"]',
    '[data-testid="player-controls"]',
    '[data-testid="playback-position"]',
    '[data-testid="playback-duration"]',
    '[data-testid="volume-bar"]',
    '[data-testid="action-bar-row"]',
    '[data-testid="column-header-context-menu"]',
    '[data-testid="LayoutResizer__resize-bar"]',
    'a[href^="/genre/"]',                                   // genre and mood names
    'script', 'style', 'noscript', 'template',
  ].join(",");

  // Text that is plainly not a name. English UI only.
  const SAFE_PATTERNS = [
    /^[\s.,:;•·\-–—()#/+&|]*$/,                                           // separators only
    /^\d{1,4}$/,                                                              // track numbers, years (not play counts)
    /^\d{1,2}(:\d{2}){1,2}$/, /^-:--$/,                                      // durations
    /^\d{1,3}(,\d{3})* (songs?|episodes?|playlists?|albums?|artists?|folders?)$/i, // your library's counts
    /^E$/,                                                                   // explicit badge
    /^\d+ (songs?|min|sec|hr|hours?|minutes?|seconds?)(,? (about )?\d+ (min|sec|hr))*$/i,
    /^(about )?\d+ (hr|min)( \d+ (min|sec))?$/i,
    /^\d+ (seconds?|minutes?|hours?|days?|weeks?|months?|years?) ago$/i,
    /^(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)( \d{1,2})?(, \d{4})?$/,
    /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec) \d{1,2}(, \d{4})?$/, // Recents day headings
    /^\d{1,3}(,\d{3})* (Public Playlists?|Following)$/,                      // a profile's own counts (not followers)
    /^\d+ (songs?|episodes?) (played|added)$/i,
    /^\d{1,2}(:\d{2})?\s?(AM|PM)$/i,                                          // event times
    /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)(, | )(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec) \d{1,2}(, \d{4})?(,? \d{1,2}(:\d{2})?\s?(AM|PM))?$/i, // event dates
  ];

  const SAFE_PHRASES = new Set([
    // entity kinds and page labels
    "Single", "Album", "EP", "Compilation", "Artist", "Playlist", "Public Playlist", "Song", "Songs",
    "Albums", "Artists", "Playlists", "Popular releases", "Singles and EPs", "Compilations", "Podcasts", "Episodes", "Profiles", "Genres & Moods", "All",
    "Top result", "Show all", "See more", "See less", "Show more", "Show less", "Title", "Date added", "List", "Compact",
    "By Spotify", "Spotify", "Your Library", "Create", "Search", "Home", "Queue", "Now playing", "Next in queue",
    "Recently played", "Liked Songs", "Your Episodes", "Discography", "See discography", "Browse all",
    "Create your first playlist", "It's easy, we'll help you", "Let's find some podcasts to follow",
    "We'll keep you updated on new episodes", "Browse podcasts", "Create playlist",
    "Recents", "Your playlists", "Jump back in", "Made For You", "Made For", "Your top mixes", "Your shows",
    "Episodes for you", "New releases for you", "Discover picks for you", "Recommended Stations",
    "Recommended for today", "Daily mixes", "Your Library", "By you", "Downloaded", "Recently added",
    "Recently played", "Alphabetical", "Creator", "Custom order", "Custom Order",
    "Today", "Yesterday", "About", "Profile", "Public Playlists", "Followers", "Following", "Top tracks this month",
    "Top artists this month", "Recommended releases", "Podcast", "Audiobook", "Audiobooks", "Episode", "Concert",
    "Verified Artist", "Verified", "Verified by Spotify",
    "Lyrics", "Sign in to see lyrics and listen to the full track", "Log in", "Sign up", "Recommended", "Based on this song",
    // menus
    "Add to queue", "Add to playlist", "Add to Your Library", "Remove from Your Library", "Save to your Liked Songs",
    "Remove from your Liked Songs", "Go to song radio", "Go to artist radio", "Go to playlist radio", "Go to album radio",
    "Go to artist", "Go to album", "View credits", "Share", "Copy Song Link", "Copy link to Song", "Copy Album Link",
    "Copy link to Album", "Copy link to playlist", "Copy link to artist", "Embed track", "Embed album", "Embed playlist",
    "Open in Desktop app", "Report", "Exclude from your taste profile", "Hide song", "Follow", "Following", "Unfollow",
    "Play", "Pause", "Clear queue", "Remove from queue", "Sleep timer",
    "New playlist", "New folder", "Create folder", "Find a playlist", "Add to folder", "Move to folder", "Remove from folder",
  ]);

  // Spotify's interface words are label words too.
  for (const phrase of SAFE_PHRASES) for (const w of phrase.toLowerCase().split(/[^\p{L}\p{N}']+/u)) if (w) LABEL_WORDS.add(w);

  const api = Object.freeze({
    UNSAFE_IN_SAFE, MEDIA_ROUTE, GENRE_TILE, LABEL_WORDS, labelWordsOnly, labelPrefix, LABELS_LEFT_ALONE, MADE_FOR, MENU, MENU_SEARCH, ROOTLIST_URL, PAGE_CACHE_DB, PAGE_CACHE_STORE, PAGE_CACHE_KEY, BUILTIN_COVER, BUILTIN_TITLE, BUILTIN_SUBTITLE, ROW_TITLE_ANY, ROW_SUBTITLE_ANY, ENTITY_ROW_TITLE,
    TRACK_TITLE_PLAIN, LOCAL_HREF, HEADINGS, FOLLOWER_COUNT, POPULARITY_COUNT, USER_WIDGET, USER_AVATAR, SAFE_ZONE_IMAGES, ABOUT_PHOTO, OWN_FOLDER_ID, USER_ROUTE, USER_HREF_ID, DEFAULT_PLAYLIST_COVER, NOTICE_ID,
    TITLE_ID, TITLE_ID_RE, LIST_ROW, LISTROW_SUBTITLE, CARD_SUBTITLE_ANY, USER_HREF, URI_ARTIST, DESCRIPTION, UI_ZONES,
    CARD, PAGE_IMAGE_SLOTS, IMAGE_CONTAINERS, IMAGE_LINK_ORDER,
    ENTITY_HREF, HIGHLIGHT, NOW_PLAYING, NOW_PLAYING_TRACK, NOW_PLAYING_ARTISTS, CARD_TITLE, CARD_TITLE_ID, PAGE_TITLE_SLOTS, ROUTE, SAFE_ZONES,
    SAFE_PATTERNS, SAFE_PHRASES,
    SHELF, SHELF_LINK, HIDE_SHELF_HREF, DISCOGRAPHY_HREF, HIDE_HEADINGS, POPULAR_TRACKS,
    CARD_SUBTITLE, CARD_SUBTITLE_ID, ENTITY_HEADER, TRACK_ROW,
    ARTIST_PAGE, CHIP, RANKED_CHIP, PREFERRED_CHIP, HIDE_ROUTES, PAGE_HEADING,
  });
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.UnfamiliarSelectors = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
