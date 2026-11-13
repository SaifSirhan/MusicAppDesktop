# Mixing Engine — Design Spec

Status: approved design, not yet planned or implemented.
Date: 2026-11-13
Project: MusicApp Desktop (`SaifSirhan/MusicAppDesktop`, branch `milestone-a`).

## 1. Goal

Add live **dual-deck DJ mixing** to MusicApp Desktop: two independent decks
playing local audio, a manual equal-power crossfader, per-deck transport,
waveform seek and tempo, fed by tracks auto-cached from YouTube Music.

This is sub-project 1–3 of a larger idea (see phasing). Beatmatch/sync,
effects, loops and recording are explicitly out of scope.

## 2. Constraints (verified)

- **Streaming overlap is impossible.** Bare YouTube stream URLs are gated to
  roughly the first 1 MiB. A second live stream cannot be played alongside
  YTM's player.
- **Local files can overlap.** The existing downloader defeats the gate by
  generating a PO token (bgutils-js) and running a custom player decipher,
  then downloads the full track and converts it with ffmpeg.wasm. It was
  extracted into `src/providers/track-cache.ts` (commit `fdf74fed`) precisely
  so the mixer can reuse it.
- **Caching is asynchronous and slow-ish.** Download plus ffmpeg.wasm
  conversion takes seconds per track and is serialized by a mutex. The mixer
  must show progress and pre-cache the next track.
- **One audio graph today.** `src/renderer.ts` owns a single `<video>` ->
  `createMediaElementSource` -> destination, and plugins (equalizer,
  visualizer, skip-silences) tap that source. The mixer uses its own
  `AudioContext` so it does not disturb that graph.
- **Stack:** Electron 42, TypeScript, electron-vite, SolidJS renderer,
  schema-driven settings, plugin lifecycle (`createPlugin`, backend +
  renderer). Tests: vitest for units, CDP harness against the built app for
  integration.

## 3. Decisions

1. **Audio engine:** Web Audio `AudioBuffer` decks (chosen over dual
   `<audio>` elements and a main-process engine). Sample-accurate overlap,
   easy waveform from the decoded buffer, tempo via `playbackRate`.
2. **Track source:** auto-cache from YTM through the shared `track-cache`
   provider. No local-folder library in MVP.
3. **MVP scope:** Tier 2 — two decks, crossfader, play/cue/volume, waveform
   overview with click-to-seek, tempo slider. No beatmatch.
4. **Shared provider:** `track-cache` is the single home for PO token,
   download, conversion and ID3. Downloader delegates to it; mixer reuses it.
5. **Independence:** the mixer ignores YTM navigation while open. Opening the
   mixer pauses and mutes YTM; closing stops the decks and restores YTM.

## 4. Architecture

```
src/
  providers/
    track-cache.ts            (done) getInnertube(), fetchTrack()
  plugins/
    mixer/
      index.ts                createPlugin({ backend, renderer })
      backend/
        index.ts              IPC handlers, cache dir, LRU, progress events
        cache.ts              paths, size cap, eviction, path validation
      renderer/
        engine.ts             MixerEngine + Deck (pure Web Audio)
        waveform.ts           peaks extraction + canvas draw
        MixerPanel.tsx        SolidJS overlay UI
        index.ts              mount panel, wire engine <-> IPC, YTM mute
        state.ts              mixer store (signals) + debug hook
```

**Module boundaries**
- `engine.ts` knows only `AudioBuffer`, gain values and transport state. It
  imports no YTM, plugin or IPC code. This is the unit-tested core.
- `backend/*` knows files and IPC. It imports `track-cache` and Node/Electron
  main APIs only. No Web Audio.
- `MixerPanel.tsx` glues engine and backend; `index.ts` handles lifecycle.
- Cache directory: `app.getPath('userData')/mixer-cache`, separate from the
  user's downloads folder.

## 5. Data flow

1. User opens the mixer from the title-bar button or View -> Mixer.
   - Panel registers `mixer:cache-progress` listener.
   - Renderer pauses the YTM `<video>` and stores its volume, then sets it to 0.
   - AudioContext is created; `resume()` runs on this user gesture.
2. Panel reads the current YTM queue through the existing player API and lists
   videoId, title, artist, duration, thumbnail. (Queue API shape confirmed in
   the plan phase against the player API types.)
3. User clicks "Load A" for a track.
   - Renderer calls `mixer:cache-track(videoId)`.
   - Backend: valid cached file exists -> return metadata immediately.
     Otherwise `fetchTrack()` downloads and converts, forwarding phases as
     `mixer:cache-progress` events `{ videoId, phase, ratio }`.
4. Renderer calls `mixer:read-track(path)` -> `ArrayBuffer`.
   - Backend validates `path` is inside the mixer cache dir before reading.
   - Renderer `decodeAudioData` -> `AudioBuffer` -> `Deck.load(buffer, meta)`.
   - Peaks are computed from the buffer; transport enables.
5. Pre-cache (toggle, default on): while deck A plays and deck B is empty,
   the next queue entry is cached and decoded into deck B.
6. Playback: each deck plays its own `AudioBufferSourceNode` through
   deck gain -> crossfader gain -> master gain -> destination. Both decks can
   play at once; the crossfader blends them.
7. Closing the mixer: stop both decks, suspend/close the context, restore the
   YTM volume and paused state.

## 6. Engine details

- **Deck graph:** `AudioBufferSourceNode -> GainNode (deck) -> GainNode
  (crossfader) -> GainNode (master) -> ctx.destination`.
- **Source is one-shot:** each `play` creates a new source. Seek stops the
  current source and recreates it with a new `offset`.
- **Position tracking:** store `{ offset, startedAtContextTime, rate }`;
  `position() = offset + (ctx.currentTime - startedAt) * rate`, clamped to
  `buffer.duration`.
- **Crossfader:** position `p` in `[-1, 1]`; `gainA = cos((p + 1) * PI/4)`,
  `gainB = sin((p + 1) * PI/4)` (equal-power). Applied with
  `setTargetAtTime` to avoid zipper noise.
- **Tempo:** `source.playbackRate.value = rate`, clamped to `[0.92, 1.08]`.
  This changes pitch; no time-stretch in MVP.
- **Volume:** per-deck gain in `[0, 1]`; master gain in `[0, 1]`.
- **End of track:** `ended` -> state `ended`, playhead at duration.
- **State machine:** `empty -> loading -> ready -> playing <-> paused ->
  ended`, plus `error`. Transitions validated in one reducer so UI and tests
  agree.

## 7. UI

Full-screen SolidJS overlay above the YTM content; close button top-right.
Uses appearance tokens (`--ma-*`) and the `in-app-menu` styling conventions.

- **Deck card (A left, B right):**
  - Header: artwork, title/artist, "Load" button.
  - Waveform canvas (~72 px tall): full-track overview, played portion
    tinted, rAF playhead; click-to-seek maps x to time.
  - Transport row: play/pause, cue (seek to 0), time readout.
  - Tempo slider 0.92–1.08 with double-click reset to 1.0; shows `+x%`.
  - Deck volume slider.
  - Loading: spinner + phase text ("Downloading 42%", "Converting…",
    "Tagging…"); transport disabled.
  - Error: inline message + Retry.
- **Crossfader:** horizontal slider centered below the decks; keyboard arrows
  when focused.
- **Track picker:** side list of the queue with "A" and "B" buttons per row;
  pre-cache toggle at the top.
- **Accessibility:** visible focus rings, `aria-label` on icon-only buttons,
  sliders are real range inputs, reduced-motion respected (no entrance
  animation required).
- **Copy:** action labels keep their name through the flow ("Load A" ->
  "Loading…" -> "Loaded"), errors state cause and recovery ("Couldn't cache
  this track. Check your connection and retry.").

## 8. Error handling

- `mixer:cache-track` rejects with a typed error code
  (`PO_TOKEN`, `NETWORK`, `UNPLAYABLE`, `WRITE`); panel maps to copy.
- Decode failure: error state, delete the cache entry, allow retry.
- Latest-wins loading: each load gets a token; stale responses are discarded.
- Reads are rejected unless the path is inside the mixer cache dir.
- AudioContext suspended: retried on user gesture; if it stays suspended the
  panel shows "Click play to start audio".
- Cache dir created on demand; LRU cap default 2 GB, evicted at startup and
  after each successful cache. Write failure -> `WRITE` error, no crash.
- Only two `AudioBuffer`s are retained; loading a new track into a deck drops
  its previous buffer.
- No persistence of mixer state in MVP.

## 9. Testing and verification

**Unit (vitest)**
- Crossfader equal-power gains at `p = -1, 0, 1` and monotonicity.
- Deck reducer transitions; seek math with a fake context clock.
- Waveform peak downsampling (fixed synthetic samples).
- Cache LRU eviction and path validation (pure helpers).
- Track-cache pure helpers: extension resolution and filename building
  (extracted/exported for tests).

**Integration (CDP harness, built app)**
- Dev-only `window.__mixer` exposes deck state, gains, positions.
- Load two committed WAV fixtures (1-second sine, ~90 KB) through a
  test-only cache-dir path; assert both play, gains follow the crossfader,
  playhead advances, seek and tempo apply.
- Assert YTM `<video>` is paused and volume 0 on open, restored on close.

**Manual**
- Two real cached tracks blended by ear; no clicks at play/seek; tempo
  audible; loading and error states behave.

**Regression**
- Downloader still downloads through `fetchTrack` (already verified live).
- Opening the mixer does not disturb skip-silences/crossfade (YTM paused).

**Acceptance**
- Two tracks audibly overlap and blend.
- Crossfader is equal-power and smooth.
- Seek, tempo and per-deck volume work.
- Load-from-queue works with pre-cache of the next track.
- Cache/decode failures show an inline error and never crash the panel.
- Closing restores YTM exactly as it was.

## 10. Phasing

1. **Backend:** mixer IPC (`cache-track`, `read-track`, progress events),
   cache dir, LRU, path validation; reuse `track-cache`.
2. **Engine:** Deck + MixerEngine with reducer and unit tests.
3. **Panel:** deck cards, waveform, transport, crossfader, tempo, picker.
4. **Pre-cache + YTM lifecycle:** auto-load next, pause/mute/restore.
5. **E2E harness + polish:** CDP assertions, error copy, a11y pass.

Each phase is gated: verify, then commit locally. No publish without an
explicit request.

## 11. Out of scope

Beatmatch/BPM detection, time-stretch, sync, effects, hot cues, loops,
recording/export, mixer state persistence, local-folder library, streaming
decks, UI themes for the mixer beyond app tokens.

## 12. Risks

- **PO-token fragility:** cache failures are expected occasionally; handled
  as typed errors with retry, not crashes.
- **ffmpeg.wasm cost:** conversion is CPU-bound and serialized; mitigated by
  pre-caching and a loading state.
- **Memory:** two decoded buffers can be ~80 MB; acceptable, bounded to two.
- **Pitch shift from tempo:** expected without time-stretch; labeled in UI.
- **Plugin audio taps:** equalizer/visualizer listen to YTM's source, so they
  do not process deck audio in MVP. Documented, not fixed.
- **Autoplay policy:** the context may start suspended; resumed on the
  opening gesture.
