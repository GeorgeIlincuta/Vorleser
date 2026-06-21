// Runs in an offscreen document (full DOM APIs). Fetches /tts and plays the
// returned WAV. Reports status back to the service worker.
const audio = new Audio();
let currentUrl = null;

audio.addEventListener("ended", () => send("ended"));
audio.addEventListener("error", () => send("error", "Audio playback failed."));

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.target !== "offscreen") return;
  if (msg.cmd === "play") play(msg.serverUrl, msg.text, msg.voice);
  else if (msg.cmd === "stop") stop();
});

function stop() {
  try {
    audio.pause();
    audio.currentTime = 0;
  } catch (_) {}
}

async function play(serverUrl, text, voice) {
  stop();
  try {
    const base = String(serverUrl).replace(/\/+$/, "");
    const resp = await fetch(base + "/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice, lang: "de" }),
    });
    if (!resp.ok) {
      let detail = "Server returned " + resp.status;
      try {
        const t = await resp.text();
        if (t) detail = t;
      } catch (_) {}
      throw new Error(detail);
    }
    const blob = await resp.blob();
    if (currentUrl) URL.revokeObjectURL(currentUrl);
    currentUrl = URL.createObjectURL(blob);
    audio.src = currentUrl;
    await audio.play();
    send("playing");
  } catch (err) {
    send("error", err && err.message ? err.message : String(err));
  }
}

function send(status, message) {
  chrome.runtime.sendMessage({ target: "background", status, message });
}
