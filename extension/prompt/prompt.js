"use strict";

// Shown when "Ask how to open Spotify links" is on. The link itself is
// only shown as an address; nothing from Spotify is loaded here.
const url = new URLSearchParams(location.search).get("url") || "";
document.getElementById("link").textContent = url;

async function choose(choice) {
  const answer = await browser.runtime.sendMessage({ type: "unfamiliar:open-choice", choice, url });
  if (answer && answer.leave) {
    if (history.length > 1) history.back();
    else window.close();
  }
}

document.getElementById("us").addEventListener("click", () => choose("us"));
document.getElementById("normal").addEventListener("click", () => choose("normal"));
