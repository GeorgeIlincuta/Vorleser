# Vorleser — Chrome Extension Design

**Date:** 2026-06-17
**Status:** Approved design, pending spec review
**Project:** `vorleser` (standalone — lives at `C:\LOCAL FILES\Claude Code\Chrome Extensions\vorleser`, separate from the Converse .NET API repo)

## Purpose & context

Vorleser is a Chrome (Manifest V3) extension that reads **selected German text
aloud**. You highlight German text on any page, right-click → **Listen with
Vorleser**, and hear it spoken — a study aid for reading German on the web.

It is purely a read-aloud client. It does **not** converse (no STT/LLM). It
calls the local **Converse API** `POST /tts` endpoint to synthesize speech and
plays the returned audio.

The Converse API is the existing self-hosted .NET service (default
`http://127.0.0.1:5000`). The extension is a separate project and does not live
inside that repo; the only backend change this design requires is a new
`GET /voices` endpoint (see [Backend dependency](#backend-dependency)).

## Scope

**v1 includes:**
- A context-menu item on selected text that synthesizes and plays it.
- Toolbar-icon **badge** feedback (loading → playing → idle) and **stop** by
  clicking the toolbar icon.
- An **options page** to set the server URL and choose a voice (voices fetched
  from `GET /voices`), with a "Test connection" button.

**Out of scope for v1** (possible later):
- Toolbar popup for pasting/typing arbitrary text.
- Language selector (v1 is fixed to German, `lang: "de"`).
- Non-localhost server origins (v1 assumes a local server; see Permissions).
- Any conversation/STT features (those belong to the future Tauri app).

## Architecture (Manifest V3)

```
page selection ─▶ context menu click
        │
        ▼
 background service worker  ──POST /tts──▶  Converse API ──WAV──▶ service worker
        │  (badge: loading → playing)                                  │
        ▼                                                              │
 offscreen document (<audio>) ◀──────── audio blob ────────────────────┘
        │  plays / stops, reports "ended"
        ▼
 toolbar badge cleared
```

MV3 service workers cannot play audio, and v1 intentionally avoids injecting UI
into the page, so playback uses an **offscreen document** — a hidden,
extension-owned page created with `chrome.offscreen` (reason
`AUDIO_PLAYBACK`) that holds a single `<audio>` element.

## Components

Each file has one clear responsibility:

- **`manifest.json`** — MV3 manifest. Permissions `contextMenus`, `storage`,
  `offscreen`; `host_permissions` for `http://127.0.0.1:5000/*` and
  `http://localhost:5000/*`; a toolbar `action` (icon, no default popup in v1);
  `options_page`; background `service_worker` (module).

- **`background.js`** (service worker) — the controller:
  - On install/startup: create the `contextMenus` item "Listen with Vorleser"
    (`contexts: ["selection"]`).
  - On context-menu click: take `info.selectionText`; load `{ serverUrl, voice }`
    from `chrome.storage.sync`; set badge to loading; `POST {serverUrl}/tts`;
    on success pass the audio to the offscreen document and set badge to playing;
    on failure set an error badge + notification.
  - On `action.onClicked` (toolbar icon): if playing, send "stop" to the
    offscreen document and clear the badge.
  - Starting a new synthesis stops any current playback first.

- **`offscreen.html` / `offscreen.js`** — owns one `<audio>` element. Receives
  messages: `play` (with the audio data), `stop`. Emits an `ended` message back
  to the service worker so it can clear the badge. Created on demand; reused.

- **`options.html` / `options.js`** — settings UI backed by
  `chrome.storage.sync`:
  - **Server URL** text field (default `http://127.0.0.1:5000`).
  - **Test connection** button → `GET {serverUrl}/health`; shows ✅/❌ and the
    `tts` readiness flag.
  - **Voice** dropdown → populated from `GET {serverUrl}/voices` (grouped by
    gender), defaulting to the API's reported default voice.
  - Save persists `{ serverUrl, voice }`.

- **`icons/`** — toolbar/extension icons (16/48/128).

## Settings & storage

`chrome.storage.sync` keys:
- `serverUrl` (string, default `http://127.0.0.1:5000`)
- `voice` (string, default = API's `default` voice, e.g. `M1`)

Language is fixed to `"de"` in v1 (not stored).

## Data flow

1. User selects German text, right-clicks → **Listen with Vorleser**.
2. Service worker reads `selectionText` and `{ serverUrl, voice }`.
3. Badge → ⏳ (loading). Any current playback is stopped.
4. `POST {serverUrl}/tts` with `{ "text", "voice", "lang": "de" }`,
   `Accept: audio/wav`.
5. On `200`: read the WAV blob, ensure the offscreen document exists, send it the
   audio; badge → ▶ (playing).
6. Offscreen `<audio>` plays; on `ended` it notifies the worker; badge cleared.
7. Clicking the toolbar icon while playing stops playback and clears the badge.

## API contract (endpoints used)

- **`POST /tts`** — body `{ "text": string, "voice": string, "lang": "de" }`;
  response `audio/wav` (44.1 kHz mono). Errors: `400` (unknown voice / bad
  language), `503` (TTS not ready).
- **`GET /voices`** — response
  `{ "default": "M1", "voices": [ { "id": "M1", "gender": "male" }, … ] }`.
  Used to populate the options dropdown.
- **`GET /health`** — response `{ "whisper": bool, "tts": bool, "llm": bool }`.
  Used by "Test connection" (only `tts` matters for this extension).

## Backend dependency

`GET /voices` does not exist yet and will be added to the Converse .NET API (in
that repo, unit-tested):
- Returns the voices currently loaded by the TTS pipeline plus the configured
  default. `gender` is derived from the voice id prefix (`M*` → male, `F*` →
  female).
- Shape: `{ "default": "<DefaultVoice>", "voices": [ { "id", "gender" }, … ] }`
  sorted by id.

This is the only change required outside the `vorleser` project.

## Error handling

Status and errors are surfaced via the toolbar **badge** plus the icon
**tooltip** (`chrome.action.setTitle`) — no Chrome notifications in v1, so no
notification icon asset is required.

- **Empty selection:** the menu only appears on selection, so this is rare; if
  `selectionText` is blank, do nothing.
- **Server unreachable / network error:** error badge (`!`) and a tooltip
  ("Vorleser error: …") explaining the server couldn't be reached.
- **`400`:** badge `!` with the server's message in the tooltip (e.g. unknown
  voice → re-pick a voice in Options).
- **`503`:** badge `!` with "TTS not ready" in the tooltip.
- **Restricted pages** (`chrome://`, Chrome Web Store, some PDFs): selection/
  context menu may be unavailable; this is an accepted limitation (the offscreen
  approach still plays audio fine where the menu works).
- **Options "Test connection":** clear ✅ (with `tts: true/false`) or ❌ so the
  user can validate setup before relying on it.

## Permissions

`host_permissions` cover the local server (`127.0.0.1:5000`, `localhost:5000`).
Custom/remote server origins are **out of scope for v1**; supporting them later
would use `optional_host_permissions` + `chrome.permissions.request` when the
user saves a non-default URL.

## Testing

- **Backend `GET /voices`:** unit-tested in the .NET project (xUnit), asserting
  the shape, default, and gender mapping.
- **Extension:** manual test checklist (extensions are glue code; no brittle
  automated harness in v1):
  1. Load unpacked; server running with TTS ready.
  2. Options: Test connection shows ✅ with `tts: true`; voice dropdown lists
     M1–M5/F1–F5; save a voice.
  3. On a German web page, select a sentence → right-click → Listen with
     Vorleser → hear it in the chosen voice; badge cycles loading → playing →
     idle.
  4. Select a long paragraph → badge shows loading for the synthesis time, then
     plays.
  5. Click the toolbar icon mid-playback → audio stops, badge clears.
  6. Stop the server → trigger → error badge + notification.
  7. Pick a wrong voice via a stale setting → 400 surfaces as a clear message.
  8. Switch voice in Options → next playback uses the new voice.

## Success criteria

Selecting German text on a normal web page and choosing "Listen with Vorleser"
plays correct German speech in the configured voice via the local Converse API,
with clear loading/stop feedback and graceful errors when the server is
unavailable.
