# Queue overlap crossfade — design

**Status:** draft for review
**Date:** 2026-11-16
**Depends on:** mixer plugin (cache IPC + `MixerEngine`), crossfade plugin (config, settings, `crossfading` flag)

## Goal

Make transitions in the normal YouTube Music queue overlap: the next track is pre-cached, started
on a deck before the current track ends, and blended under it with equal power. After the blend the
deck — not the YTM `<video>` — is the audible source for the whole track. YTM stays on the same
track as a muted clock so its queue, history, progress bar, media keys and likes keep working.

## Decisions taken with the user

1. **Deck owns the whole track** after a blend starts (not just the overlap window).
2. **YTM is a muted clock**: `video.muted = true` while a deck owns audio; `video.volume` remains the
   master-volume reference and keeps driving the deck master.
3. Blend length **reuses** the existing Crossfade transition length (settings slider writes
   `secondsBeforeEnd`, `fadeInDuration`, `fadeOutDuration`; 30 s in the current config). No new
   duration knob. Off (0 s) disables overlap.
4. The feature lives in the **crossfade plugin** and requires the **mixer plugin enabled** (the only
   owner of `mixer:cache-track` / `mixer:read-track` / `mixer:remove-track`).

## Non-goals

- No changes to the mixer panel or its manual engine.
- No prefetch of more than the single next track.
- No support for playback speeds other than 1×, ads, or DRM tracks.
- No continuous clock resync beyond one seek per track boundary.

## Architecture

### Files

- `src/plugins/crossfade/overlap-machine.ts` — pure state machine + types (no DOM).
- `src/plugins/crossfade/overlap.ts` — `OverlapController`: DOM/engine wiring around the machine.
- `src/plugins/crossfade/index.ts` — construct the controller in `start`, keep it across config
  changes, tear down in `stop` / when `enabled` or `overlap` turns false.
- `src/plugins/crossfade/state.ts` — add `setOverlapActive` / `isOverlapActive` so the legacy
  fade handler and skip-silences can tell ownership apart from a normal fade.
- `src/plugins/in-app-menu/settings-schema.ts` — one switch row in the Crossfade section.
- `src/plugins/in-app-menu/main.ts` — case for `plugins.crossfade.overlap` writing
  `config.setPartial('plugins.crossfade', { overlap }, crossfadeDefaults)`.
- `src/plugins/mixer/renderer/index.ts` — dispatch `musicapp:mixer-open` / `musicapp:mixer-close`
  custom events on `window` in `openMixer` / `closeMixer`.
- Plugin config type: `overlap: boolean` default `false`; `crossfadeDefaults` gains the same key.

### Components

**`overlap-machine.ts`** — `OverlapState = 'idle' | 'arming' | 'blending' | 'owned'`,
`OverlapTrack = { videoId, title, duration }`, events and transitions:

- `idle`: YTM audible. On `arm(track, next)` with a cached-and-decoded next deck → `arming`.
  On `disarm` stay idle.
- `arming`: waiting for `remaining <= blendSeconds`. On `blend-start(now)` → `blending`; on
  `cache-failed` / `abort` → `idle`.
- `blending`: equal-power ramp running. On `ramp-done` → `owned`; on `cancel` (pause, seek,
  navigation mismatch, config change, mixer open) → `idle`.
- `owned`: deck audible, YTM muted. Carries an optional `incoming` slot. On `arm-incoming(track)`
  (pre-cache for the following track) it stores that slot; on `next-boundary` with `incoming`
  present → `blending` (outgoing deck → incoming deck); on `navigation-mismatch` / `abort` →
  `idle`; on `deck-ended` → request YTM advance (controller clicks `.next-button` when YTM has not
  already advanced). `ramp-done` from a chained blend returns to `owned` with the new deck and an
  empty `incoming` slot.

The machine takes `(state, event)` and returns `{ state, effects: Effect[] }`, where effects are
`'start-blend' | 'finish-blend' | 'mute-ytm' | 'unmute-ytm' | 'seek-ytm' | 'advance-ytm' |
'stop-decks'`. Controller executes effects; tests assert effects without DOM.

**`overlap.ts`** — `OverlapController` inputs:

```ts
type OverlapDeps = {
  video: () => HTMLVideoElement | null;
  playerApi: () => MusicPlayer | null;
  cache: Pick<MixerClient, 'cacheTrack' | 'readTrack' | 'removeTrack'>;
  getConfig: () => CrossfadePluginConfig;
  now: () => number;
  raf: (cb: (time: number) => void) => number;
  cancelRaf: (id: number) => void;
  queueItems: () => MixerQueueItem[]; // #queue + toQueueItems
};
```

It owns a private `MixerEngine`, created lazily on the first arm, master volume mirrored from
`video.volume`. Deck loading reuses `loadTrack({ client: cache, decode }, deck, item)`; the decode
is `engine.context.decodeAudioData(data.slice(0))`; peaks are ignored.

**Blend maths**

- YTM → deck: for `p ∈ [-1, 1]`, `gains = crossfaderGains(p)`;
  `video.volume = master * gains.a`, `deck.setVolume(gains.b)`. The engine crossfader is placed on
  the incoming deck's side (so gains are computed for that deck) and both deck volumes are reset
  to 1 once ownership settles.
- Deck → deck: both deck volumes stay 1; `engine.setCrossfader(p)` with `p` moved from the
  outgoing side to the incoming side. `setCrossfader` already ramps with `setTargetAtTime(0.01)`,
  so a 60 Hz rAF update is smooth.

Ramps last `blendSeconds = min(secondsBeforeEnd, fadeOutDuration / 1000, video.duration / 2)`.
`fadeInDuration` is unused by the overlap (the equal-power ramp spans the same window); it still
drives the legacy fallback.

**Timing**

- Pre-cache trigger, measured on the currently audible source (YTM while idle, owned deck while
  owned): `remaining <= blendSeconds + 45` (download lead).
- Blend trigger, idle: `video` `timeupdate` with `video.duration - video.currentTime <= blendSeconds`.
- Blend trigger, owned: 250 ms interval comparing `deck.position()` to `deck.getDuration()`.
- End of an owned track: deck `ended` subscription; if `playerApi.getVideoData().videoId` is still
  the owned track, click `.next-button` once. YTM autoplay may win the race; the navigation handler
  de-duplicates by videoId.

**Navigation handoff** (`window.navigation` `navigate`)

1. Read the new videoId.
2. If a deck is owned or blending and the new videoId equals the deck's track:
   set `video.muted = true`, restore `video.volume = master` (the slider reference),
   `playerApi.seekTo(deck.position())`, stay owned.
3. Otherwise: stop decks, `video.muted = false`, `video.volume = master`, state idle, re-read the
   queue and arm for the new track.

**Transport mirroring**

- `pause` → active deck `pause()`; mid-blend → cancel ramp, stop incoming deck, restore
  `video.volume = master`, state idle; on `play` → re-arm (the deck is still loaded).
- `play` → active deck `play()`; if it resolves false, abort ownership and unmute YTM.
- `seeked` while owned → `deck.seek(video.currentTime)`; if the new remaining is inside the blend
  window, arm/re-blend.
- `volumechange` while owned → `engine.setMasterVolume(video.volume)`; video stays muted.
- `playbackRate !== 1` → do not arm; if owned, abort and unmute.

**Mixer conflict**

- `openMixer()` dispatches `musicapp:mixer-open` before creating its engine; the controller aborts
  ownership (decks stopped, YTM unmuted) and sets a `suspended` flag that blocks arming.
- `closeMixer()` dispatches `musicapp:mixer-close`; the controller clears `suspended` and re-arms
  on the next trigger.

## Failure handling

Do not arm (legacy fade-out → skip → fade-in runs unchanged) when:

- no next queue item, queue end, or next item equals the current track;
- the mixer plugin is disabled — `mixer:*` invoke rejects; log once per session and stay idle;
- `cacheTrack`, `readTrack` or decode fails (including the truncated-cache path, which already
  invalidates the file);
- the AudioContext is suspended after `resume()`, `video` is missing, `blendSeconds <= 0`, or
  `video.duration < 2 * blendSeconds`.

Abort an in-flight blend/ownership on the same failures, plus: pause, user seek, navigation to a
different track, speed change, mixer open, plugin disable. Abort restores `video.volume = master`,
`video.muted = false`, stops both sources and unloads both decks (`Deck.dispose()`, engine kept for
the next arm), and returns to idle.

While overlap is active, the legacy `timeupdate` fade handler returns early (`isOverlapActive()`),
so the two never manipulate `video.volume` at once. YTM advancement in owned mode is handled by the
controller (`.next-button` click guarded by videoId); autoplay's own advance is de-duplicated.

## Settings and config

- Config: `plugins.crossfade.overlap: boolean` (default `false`). Read on every arm.
- Settings row (Crossfade section), switch, `apply: 'live'`:
  - label `Real overlap`
  - description `Blend the next track under the current one when it is cached. Requires the Mixer plugin.`
- Transition length slider keeps its meaning; `0` disables both overlap and the legacy fade.

## Developer hook

When the plugin is enabled with overlap on, install `window.__overlap` with
`{ snapshot: () => ({ state, activeDeck, videoId, position, ytmMuted }) }`; remove it on disable or
plugin stop. This mirrors the existing `__mixer` hook for CDP verification.

## Testing

**Unit (node, deterministic clock/rAF)**

- `overlap-machine.test.ts`: idle → arming on cached next; blend-start only inside the window;
  ramp-done → owned; navigation match keeps ownership and emits `seek-ytm`; mismatch → idle +
  `unmute-ytm`; cancel from pause/seek/config/mixer-open emits `stop-decks` + `unmute-ytm`; no
  effects in the wrong state.
- `overlap-controller.test.ts`: fake `video` (EventTarget with `duration/currentTime/volume/muted/
  paused/playbackRate`), fake playerApi (`getVideoData`, `getPlayerState`, `seekTo`, `setVolume`),
  fake cache; real `Deck` + `FakeContext`. Asserts: deck loads the next item and starts at blend
  time; gains follow `crossfaderGains`; pause cancels and restores volume; navigation seeks YTM to
  the deck position and mutes; cache failure leaves YTM audible and emits no deck play.

**Live (CDP on the installed build)**

- `window.__overlap.snapshot()` transitions idle → owned; `video.muted === true`; YTM
  `getCurrentTime()` within 1 s of the deck position after the boundary.
- Pause mirrors (deck status paused), seek mirrors (position follows), Next tears down and unmutes.
- With the mixer plugin disabled: no ownership, legacy fade still works.
- By ear: the 30 s blends must overlap audibly with no clicks.

## Risks and limits

- 30 s blends cache a full extra track per boundary; the shared 2 GB mixer cache evicts oldest
  files, so long sessions will re-download skipped tracks.
- Clock drift between YTM and the deck is corrected once per boundary (seek), not continuously;
  progress display can be off by tens of milliseconds mid-track.
- The handoff seek can hitch if YTM has not buffered the same track yet; the blend hides most of it
  because the deck stays audible.
- Mixer and overlap are mutually exclusive by construction (the mixer-open event), not by
  scheduling.

## Acceptance criteria

1. With mixer + crossfade + overlap enabled, a queue transition inside the blend window is audible
   as two overlapping tracks, and the next track continues from the deck without a gap.
2. YTM shows the correct track, playing, with a working progress bar, and `video.muted` is true
   while a deck owns audio.
3. Pause, play, seek, volume and Next behave as described; no state leaves YTM muted after the
   plugin is disabled or the mixer opens.
4. Any cache/decode failure falls back to the current fade-out → skip → fade-in with no silent
   gap and no stuck deck.
5. Unit suites pass; `pnpm typecheck`, `pnpm build` and lint are clean; live CDP evidence recorded.
