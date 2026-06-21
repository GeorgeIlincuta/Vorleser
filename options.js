const DEFAULTS = { serverUrl: "http://127.0.0.1:5000", voice: "M1" };
const $ = (id) => document.getElementById(id);
const base = () => $("serverUrl").value.trim().replace(/\/+$/, "");

// The API returns a flat list of voice ids (e.g. ["F1", ..., "M5"]); gender is
// inferred from the id prefix (F* = female, otherwise male) just for the label.
const genderOf = (id) => (/^f/i.test(id) ? "female" : "male");

async function init() {
  const s = await chrome.storage.sync.get(DEFAULTS);
  $("serverUrl").value = s.serverUrl || DEFAULTS.serverUrl;
  await populateVoices(s.voice || DEFAULTS.voice);
}

async function populateVoices(selected) {
  const sel = $("voice");
  sel.innerHTML = "";
  try {
    const resp = await fetch(base() + "/voices");
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    const data = await resp.json();
    for (const id of data.voices) {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = id + " (" + genderOf(id) + ")";
      sel.appendChild(opt);
    }
    sel.value = selected || data.default || DEFAULTS.voice;
  } catch (_) {
    const opt = document.createElement("option");
    opt.value = selected || DEFAULTS.voice;
    opt.textContent = (selected || DEFAULTS.voice) + " (voice list unavailable)";
    sel.appendChild(opt);
  }
}

$("test").addEventListener("click", async () => {
  $("testStatus").textContent = "…";
  try {
    const resp = await fetch(base() + "/health");
    const data = await resp.json();
    $("testStatus").textContent = data.tts
      ? "✅ TTS ready"
      : "⚠️ server reachable, TTS not ready";
    await populateVoices($("voice").value);
  } catch (_) {
    $("testStatus").textContent = "❌ cannot reach server";
  }
});

$("save").addEventListener("click", async () => {
  await chrome.storage.sync.set({ serverUrl: base(), voice: $("voice").value });
  $("saveStatus").textContent = "Saved";
  setTimeout(() => ($("saveStatus").textContent = ""), 1500);
});

init();
