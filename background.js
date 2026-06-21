const MENU_ID = "vorleser-listen";
const DEFAULTS = { serverUrl: "http://127.0.0.1:5000", voice: "M1" };

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: "Listen with Vorleser",
    contexts: ["selection"],
  });
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== MENU_ID) return;
  const text = (info.selectionText || "").trim();
  if (!text) return;

  const { serverUrl, voice } = await getSettings();
  await ensureOffscreen();
  setBadge("…", "#888888", "Vorleser: synthesizing…");
  chrome.runtime.sendMessage({ target: "offscreen", cmd: "play", serverUrl, text, voice });
});

chrome.action.onClicked.addListener(() => {
  chrome.runtime.sendMessage({ target: "offscreen", cmd: "stop" });
  clearBadge();
});

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.target !== "background") return;
  if (msg.status === "playing") {
    setBadge("▶", "#22aa77", "Vorleser: playing (click icon to stop)");
  } else if (msg.status === "ended") {
    clearBadge();
  } else if (msg.status === "error") {
    setBadge("!", "#cc3333", "Vorleser error: " + (msg.message || "unknown"));
  }
});

async function getSettings() {
  const s = await chrome.storage.sync.get(DEFAULTS);
  return {
    serverUrl: s.serverUrl || DEFAULTS.serverUrl,
    voice: s.voice || DEFAULTS.voice,
  };
}

function setBadge(text, color, title) {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
  if (title) chrome.action.setTitle({ title });
}

function clearBadge() {
  chrome.action.setBadgeText({ text: "" });
  chrome.action.setTitle({ title: "Vorleser" });
}

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["AUDIO_PLAYBACK"],
    justification: "Play synthesized speech audio.",
  });
}
