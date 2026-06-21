# Vorleser

A Chrome (Manifest V3) extension that reads **selected German text aloud** using
the local [Converse](https://github.com/GeorgeIlincuta/Converse) TTS API.

## Requirements

This extension is a thin client and **does not work on its own** — it requires
the [Converse API](https://github.com/GeorgeIlincuta/Converse) running locally
to synthesize speech. Clone, build, and run that project first; it must be
reachable (default `http://127.0.0.1:5000`) and report `tts: true` at `/health`
before Vorleser can play anything.

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
  voices come from `GET /voices` (a flat list of ids; gender shown in the picker
  is inferred from the `F*`/`M*` prefix).

Language is fixed to German (`lang: "de"`). Server origin is local only in v1.
