# Vorleser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Chrome (MV3) extension, `vorleser`, that reads selected German text aloud by calling the local Converse TTS API, plus a small `GET /voices` endpoint added to that API.

**Architecture:** Two parts. **(A)** Backend: add `GET /voices` to the Converse .NET API (returns installed voices + default). **(B)** Extension: an MV3 extension where a service worker handles the context menu and toolbar badge, and an offscreen document does the `POST /tts` fetch and audio playback (MV3 service workers can't play audio). German is fixed (`lang: "de"`); server defaults to `http://127.0.0.1:5000`.

**Tech Stack:** .NET 10 / xUnit (backend); Chrome Manifest V3, vanilla JS (extension).

**Two working directories:**
- Backend repo: `C:\LOCAL FILES\Claude Code\DotNet\Converse`
- Extension repo: `C:\LOCAL FILES\Claude Code\Chrome Extensions\vorleser`

**Error feedback note:** This plan surfaces status/errors via the toolbar **badge + icon tooltip** (`chrome.action.setTitle`) rather than Chrome notifications, to avoid a required notification icon asset in v1. (Refines the spec's "Chrome notification".) No custom icons are needed in v1; Chrome shows its default action icon.

---

## File structure

**Backend (added/modified in the .NET repo):**
- Create `Converse.Api/Tts/VoiceCatalog.cs` — `VoiceInfo`/`VoicesResponse` records + pure `Build(...)` (gender mapping + sort). Testable.
- Create `Converse.Api/Endpoints/VoicesEndpoints.cs` — maps `GET /voices`.
- Modify `Converse.Api/Tts/SupertonicPipeline.cs` — expose `VoiceNames`.
- Modify `Converse.Api/Program.cs` — register the endpoint.
- Create `Converse.Api.Tests/VoiceCatalogTests.cs` — unit test.
- Modify `Converse.Api.Tests/SupertonicPipelineSmokeTests.cs` — gated `VoiceNames` check.

**Extension (`vorleser` repo):**
- `manifest.json` — MV3 manifest.
- `background.js` — service worker: context menu, badge, orchestration, stop.
- `offscreen.html` / `offscreen.js` — fetch `/tts` + audio playback.
- `options.html` / `options.js` — server URL, test connection, voice dropdown.
- `.gitignore`, `README.md`.

---

# Part A — Backend `GET /voices`

Working directory for all Part A tasks: `C:\LOCAL FILES\Claude Code\DotNet\Converse`

## Task A1: Voice catalog model + builder

**Files:**
- Create: `Converse.Api/Tts/VoiceCatalog.cs`
- Test: `Converse.Api.Tests/VoiceCatalogTests.cs`

- [ ] **Step 1: Write the failing test**

Create `Converse.Api.Tests/VoiceCatalogTests.cs`:
```csharp
using FluentAssertions;
using Converse.Api.Tts;

namespace Converse.Api.Tests;

public class VoiceCatalogTests
{
    [Fact]
    public void Build_sorts_by_id_maps_gender_and_sets_default()
    {
        var result = VoiceCatalog.Build(new[] { "M2", "F1", "M1" }, "M1");

        result.Default.Should().Be("M1");
        result.Voices.Select(v => v.Id).Should().ContainInOrder("F1", "M1", "M2");
        result.Voices.Single(v => v.Id == "F1").Gender.Should().Be("female");
        result.Voices.Single(v => v.Id == "M1").Gender.Should().Be("male");
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `dotnet test --filter FullyQualifiedName~VoiceCatalogTests`
Expected: FAIL — `VoiceCatalog` does not exist.

- [ ] **Step 3: Implement `VoiceCatalog`**

Create `Converse.Api/Tts/VoiceCatalog.cs`:
```csharp
namespace Converse.Api.Tts;

public sealed record VoiceInfo(string Id, string Gender);

public sealed record VoicesResponse(string Default, IReadOnlyList<VoiceInfo> Voices);

// Builds the /voices response from the installed voice ids. Gender is inferred
// from the id prefix (F* = female, otherwise male), and ids are sorted.
public static class VoiceCatalog
{
    public static VoicesResponse Build(IEnumerable<string> ids, string defaultVoice)
    {
        var voices = ids
            .OrderBy(id => id, StringComparer.Ordinal)
            .Select(id => new VoiceInfo(
                id,
                id.StartsWith("F", StringComparison.OrdinalIgnoreCase) ? "female" : "male"))
            .ToList();
        return new VoicesResponse(defaultVoice, voices);
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `dotnet test --filter FullyQualifiedName~VoiceCatalogTests`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add Converse.Api/Tts/VoiceCatalog.cs Converse.Api.Tests/VoiceCatalogTests.cs
git commit -m "Add VoiceCatalog (voices response model + builder)"
```

## Task A2: Expose voices + map `GET /voices`

**Files:**
- Modify: `Converse.Api/Tts/SupertonicPipeline.cs`
- Create: `Converse.Api/Endpoints/VoicesEndpoints.cs`
- Modify: `Converse.Api/Program.cs`
- Test: `Converse.Api.Tests/SupertonicPipelineSmokeTests.cs`

- [ ] **Step 1: Expose `VoiceNames` on the pipeline**

In `Converse.Api/Tts/SupertonicPipeline.cs`, the private field
`private readonly Dictionary<string, VoiceStyle> _voices = new();` already exists.
Add this public accessor next to the other public properties (e.g. after
`public int SampleRate => ...`):
```csharp
    /// <summary>Ids of the loaded voice styles (e.g. "M1"). Empty if not ready.</summary>
    public IReadOnlyCollection<string> VoiceNames => _voices.Keys;
```

- [ ] **Step 2: Create the endpoint**

Create `Converse.Api/Endpoints/VoicesEndpoints.cs`:
```csharp
using Converse.Api.Configuration;
using Converse.Api.Tts;
using Microsoft.Extensions.Options;

namespace Converse.Api.Endpoints;

internal static class VoicesEndpoints
{
    public static IEndpointRouteBuilder MapVoicesEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/voices", (SupertonicPipeline pipeline, IOptions<SupertonicOptions> opts) =>
            pipeline.IsReady
                ? Results.Ok(VoiceCatalog.Build(pipeline.VoiceNames, opts.Value.DefaultVoice))
                : Results.Problem("Supertonic TTS is not ready.", statusCode: 503));

        return app;
    }
}
```

- [ ] **Step 3: Register the endpoint**

In `Converse.Api/Program.cs`, find the existing endpoint mappings (e.g.
`app.MapTtsEndpoints();`) and add alongside them:
```csharp
app.MapVoicesEndpoints();
```
`VoicesEndpoints` is in the `Converse.Api.Endpoints` namespace, which Program.cs
already imports (the other `Map*Endpoints` calls are there).

- [ ] **Step 4: Add a gated integration check**

In `Converse.Api.Tests/SupertonicPipelineSmokeTests.cs`, add this test method to
the class (the `TryBuildPipeline()` helper already exists from the TTS work):
```csharp
    [Fact]
    public void VoiceNames_lists_installed_voices()
    {
        using var pipeline = TryBuildPipeline();
        if (pipeline is null) return; // models not present — skip
        pipeline.VoiceNames.Should().Contain(new[] { "M1", "F1" });
    }
```

- [ ] **Step 5: Build and test**

Run: `dotnet build -clp:ErrorsOnly` then `dotnet test`
Expected: Build succeeded; all tests PASS.

- [ ] **Step 6: Manually verify the endpoint**

Start the app and curl it (in a separate shell, with the models installed):
```bash
# from C:/LOCAL FILES/Claude Code/DotNet/Converse
ASPNETCORE_ENVIRONMENT=Development dotnet run --project Converse.Api &
# wait for startup, then:
curl -s http://127.0.0.1:5000/voices
```
Expected JSON like:
`{"default":"M1","voices":[{"id":"F1","gender":"female"},...,{"id":"M5","gender":"male"}]}`
Stop the app afterward.

- [ ] **Step 7: Commit and push**

```bash
git add Converse.Api/Tts/SupertonicPipeline.cs Converse.Api/Endpoints/VoicesEndpoints.cs Converse.Api/Program.cs Converse.Api.Tests/SupertonicPipelineSmokeTests.cs
git commit -m "Add GET /voices endpoint"
git push
```

---

# Part B — Vorleser extension

Working directory for all Part B tasks: `C:\LOCAL FILES\Claude Code\Chrome Extensions\vorleser`

> These are vanilla-JS MV3 files with no practical unit-test harness, so each task
> is **create file(s) → load/reload the unpacked extension → verify manually**.
> The testable logic (voice gender mapping) lives in Part A.

## Task B1: Project init + manifest

**Files:**
- Create: `.gitignore`, `manifest.json`

- [ ] **Step 1: Initialize the repo**

```bash
cd "C:/LOCAL FILES/Claude Code/Chrome Extensions/vorleser"
git init
```

- [ ] **Step 2: Create `.gitignore`**

```
# OS / editor
.DS_Store
Thumbs.db
.vscode/
*.zip
```

- [ ] **Step 3: Create `manifest.json`**

```json
{
  "manifest_version": 3,
  "name": "Vorleser",
  "version": "0.1.0",
  "description": "Read selected German text aloud via the local Converse TTS API.",
  "permissions": ["contextMenus", "storage", "offscreen"],
  "host_permissions": [
    "http://127.0.0.1:5000/*",
    "http://localhost:5000/*"
  ],
  "background": { "service_worker": "background.js" },
  "action": { "default_title": "Vorleser" },
  "options_page": "options.html"
}
```

- [ ] **Step 4: Load and verify**

In Chrome: `chrome://extensions` → enable **Developer mode** → **Load unpacked**
→ select the `vorleser` folder. Expected: the extension loads with **no errors**
(it does nothing yet). The Service Worker may show "inactive" — that's fine.

- [ ] **Step 5: Commit**

```bash
git add .gitignore manifest.json
git commit -m "Init vorleser extension with MV3 manifest"
```

## Task B2: Offscreen document (fetch + playback)

**Files:**
- Create: `offscreen.html`, `offscreen.js`

- [ ] **Step 1: Create `offscreen.html`**

```html
<!DOCTYPE html>
<html>
  <head><meta charset="utf-8" /></head>
  <body><script src="offscreen.js"></script></body>
</html>
```

- [ ] **Step 2: Create `offscreen.js`**

```javascript
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
```

- [ ] **Step 3: Commit**

```bash
git add offscreen.html offscreen.js
git commit -m "Add offscreen document for TTS fetch and audio playback"
```
(Verified end-to-end in Task B3, once the service worker drives it.)

## Task B3: Service worker (context menu, badge, orchestration)

**Files:**
- Create: `background.js`

- [ ] **Step 1: Create `background.js`**

```javascript
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
```

- [ ] **Step 2: Reload and verify end-to-end**

Ensure the Converse API is running with TTS ready (`/health` shows `tts:true`).
In `chrome://extensions`, click **Reload** on Vorleser (so `onInstalled` recreates
the menu). Then on any page with German text:
1. Select a sentence → right-click → **Listen with Vorleser**.
2. Expected: badge shows `…` then `▶`, and you hear the audio; badge clears when
   it finishes.
3. While playing, click the Vorleser toolbar icon → audio stops, badge clears.
4. Stop the API and trigger again → badge shows `!`; hovering the icon shows the
   error in the tooltip.

If nothing happens, open the service worker console (`chrome://extensions` →
Vorleser → "Service worker") and check for errors.

- [ ] **Step 3: Commit**

```bash
git add background.js
git commit -m "Add service worker: context menu, badge, playback orchestration"
```

## Task B4: Options page (server URL, voice, test connection)

**Files:**
- Create: `options.html`, `options.js`

- [ ] **Step 1: Create `options.html`**

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Vorleser Options</title>
    <style>
      body { font-family: sans-serif; max-width: 420px; margin: 1rem; }
      label { display: block; margin: 0.7rem 0 0.2rem; font-weight: bold; }
      input, select { width: 100%; padding: 0.35rem; box-sizing: border-box; }
      button { margin-top: 0.8rem; padding: 0.4rem 0.9rem; cursor: pointer; }
      .status { margin-left: 0.5rem; }
    </style>
  </head>
  <body>
    <h2>Vorleser</h2>

    <label for="serverUrl">Server URL</label>
    <input id="serverUrl" type="text" placeholder="http://127.0.0.1:5000" />
    <button id="test">Test connection</button>
    <span id="testStatus" class="status"></span>

    <label for="voice">Voice</label>
    <select id="voice"></select>

    <div>
      <button id="save">Save</button>
      <span id="saveStatus" class="status"></span>
    </div>

    <script src="options.js"></script>
  </body>
</html>
```

- [ ] **Step 2: Create `options.js`**

```javascript
const DEFAULTS = { serverUrl: "http://127.0.0.1:5000", voice: "M1" };
const $ = (id) => document.getElementById(id);
const base = () => $("serverUrl").value.trim().replace(/\/+$/, "");

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
    for (const v of data.voices) {
      const opt = document.createElement("option");
      opt.value = v.id;
      opt.textContent = v.id + " (" + v.gender + ")";
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
```

- [ ] **Step 3: Reload and verify**

Reload the extension. Open its **Options** (`chrome://extensions` → Vorleser →
Details → Extension options, or right-click the toolbar icon → Options):
1. Server URL pre-filled with the default; **Test connection** → `✅ TTS ready`.
2. Voice dropdown lists `M1 (male)` … `F5 (female)` from `/voices`.
3. Pick `F1`, click **Save** → "Saved".
4. Select German text → Listen → it now plays in the F1 voice.

- [ ] **Step 4: Commit**

```bash
git add options.html options.js
git commit -m "Add options page: server URL, test connection, voice picker"
```

## Task B5: README + final end-to-end check

**Files:**
- Create: `README.md`

- [ ] **Step 1: Create `README.md`**

```markdown
# Vorleser

A Chrome (Manifest V3) extension that reads **selected German text aloud** using
the local [Converse](https://github.com/GeorgeIlincuta/Converse) TTS API.

## Use
1. Run the Converse API (it must show `tts: true` at `/health`).
2. Load this folder as an unpacked extension (`chrome://extensions` → Developer
   mode → Load unpacked).
3. In **Options**, set the server URL (default `http://127.0.0.1:5000`), click
   **Test connection**, and pick a voice.
4. On any page, select German text → right-click → **Listen with Vorleser**.
   The toolbar badge shows `…` (synthesizing) then `▶` (playing); click the icon
   to stop.

## How it works
- `background.js` (service worker) — context menu, toolbar badge, orchestration.
- `offscreen.html`/`offscreen.js` — fetches `POST /tts` and plays the WAV
  (MV3 service workers can't play audio).
- `options.html`/`options.js` — settings, stored in `chrome.storage.sync`;
  voices come from `GET /voices`.

Language is fixed to German (`lang: "de"`). Server origin is local only in v1.
```

- [ ] **Step 2: Full end-to-end checklist**

With the Converse API running (TTS ready) and the extension reloaded, confirm:
- [ ] Options: Test connection ✅; dropdown lists M1–M5/F1–F5; save a voice.
- [ ] Select a short German sentence → Listen → correct German audio; badge
      cycles `…` → `▶` → clear.
- [ ] Select a long paragraph → badge stays `…` during synthesis, then plays.
- [ ] Click toolbar icon mid-playback → stops; badge clears.
- [ ] Stop the API → Listen → badge `!`, tooltip shows the error.
- [ ] Change voice in Options → next playback uses the new voice.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "Add README and finalize v1"
```

---

## Self-review

**Spec coverage:**
- Context-menu "Listen with Vorleser" on selection → Task B3. ✓
- Toolbar badge (loading/playing/idle) + stop on icon click → Task B3. ✓
- Options page: server URL, Test connection (GET /health), voice dropdown
  (GET /voices), chrome.storage.sync → Task B4. ✓
- Offscreen-document audio playback, no page injection → Task B2. ✓
- Endpoints POST /tts (lang "de"), GET /voices, GET /health → B2 (tts), B4
  (voices/health), Part A (voices). ✓
- `GET /voices` backend (default + gender, sorted), unit-tested → Tasks A1, A2. ✓
- German fixed; localhost host_permissions → Tasks B1, B2. ✓
- Error handling (server down, non-200) → B2 (offscreen) + B3 (badge/tooltip). ✓
- Manual test checklist → Task B5. ✓

**Deviation from spec (intentional):** errors are shown via badge + icon tooltip
instead of Chrome notifications, removing the need for a notification icon asset
in v1. Noted in the header.

**Placeholder scan:** none — every step has complete file content or exact commands.

**Type/contract consistency:** the `/voices` shape produced by `VoiceCatalog.Build`
(Task A1) — `{ default, voices: [{ id, gender }] }` — matches what `options.js`
consumes (Task B4: `data.voices[].id/.gender`, `data.default`). The message
protocol is consistent: service worker → offscreen `{ target:"offscreen", cmd:
"play"|"stop", serverUrl, text, voice }`; offscreen → service worker `{ target:
"background", status:"playing"|"ended"|"error", message }` (Tasks B2 & B3 match).
The `POST /tts` body `{ text, voice, lang:"de" }` matches the API contract.
