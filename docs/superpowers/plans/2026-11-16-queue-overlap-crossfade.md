# Queue Overlap Crossfade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Blend the next YTM queue track under the current one using a pre-cached Web Audio deck, then let the deck own the whole track while YTM stays a muted, mirrored clock.

**Architecture:** The crossfade plugin gains a pure state machine (`overlap-machine.ts`) and a controller (`overlap.ts`) that owns a private `MixerEngine`. The next queue item is cached through the mixer IPC; after the blend the deck is the audible source and YTM's `<video>` is muted but keeps its clock, with seek/pause/play/volume mirrored and one drift-correcting seek per boundary. Cache pins protect owned and incoming files from eviction.

**Tech Stack:** TypeScript, SolidJS (settings only), Web Audio (`AudioBufferSourceNode`), Electron IPC, vitest (node env), oxlint type-aware.

**Spec:** `docs/superpowers/specs/2026-11-16-queue-overlap-crossfade-design.md`

## Global Constraints

- Never touch `.env`, secrets, or `src/plugins/kestrel-bridge/`; stage only listed files.
- No external network calls beyond the app's own `127.0.0.1:9222` CDP and `pnpm`/`gh` tooling.
- Do not run `oxfmt --write` on `engine.ts`-style files with mixed arithmetic; it strips required parentheses.
- `tsconfig.json` includes only `src/**`; tests are executed, not typechecked.
- oxlint import order is quirky under `--type-aware`: verify each new file with
  `pnpm exec oxlint --type-aware <file>` and reorder empirically. Practical rule used in this repo:
  value imports first, blank line, type imports with parent (`../`) before siblings.
- Every task ends with `pnpm exec oxlint --type-aware <files>` at 0/0 for those files,
  `pnpm tsc -p tsconfig.json --noEmit` clean, and `pnpm vitest run tests/unit` green.
- Blend length is `min(secondsBeforeEnd, fadeOutDuration / 1000, video.duration / 2)`, minimum 1 s;
  `fadeInDuration` is not used by overlap.
- Version for live verification: `0.1.19`.

---

### Task 1: Mixer cache pins

**Files:**
- Modify: `src/plugins/mixer/backend/handlers.ts`
- Modify: `src/plugins/mixer/backend/index.ts`
- Modify: `src/plugins/mixer/renderer/client.ts`
- Test: `tests/unit/mixer-handlers.test.ts`
- Test: `tests/unit/mixer-client.test.ts`

**Interfaces:**
- Produces: `backend.setPinnedTracks(paths: unknown): void`, `backend.getPinnedTracks(): string[]`,
  IPC channel `mixer:set-pinned-tracks`, `MixerClient.setPinnedTracks(paths: string[]): Promise<void>`.
- `cacheTrack` eviction exclusion becomes `[result.path, ...pinnedPaths]`.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/mixer-handlers.test.ts` append inside `describe('createMixerBackend', ...)`:

```ts
  it('pins validated cache paths across evictions', async () => {
    const { backend, cacheDir, evict } = setup();

    backend.setPinnedTracks([
      join(cacheDir, 'b.mp3'),
      join(cacheDir, 'b.mp3'),
      join('tmp', 'other', 'secret.mp3'),
      42,
    ]);

    expect(backend.getPinnedTracks()).toEqual([join(cacheDir, 'b.mp3')]);

    await backend.cacheTrack('dQw4w9WgXcQ');

    expect(evict).toHaveBeenCalledWith(cacheDir, 100, [
      join(cacheDir, 'a.mp3'),
      join(cacheDir, 'b.mp3'),
    ]);
  });

  it('replaces the pin set instead of appending', async () => {
    const { backend, cacheDir } = setup();

    backend.setPinnedTracks([join(cacheDir, 'b.mp3')]);
    backend.setPinnedTracks([join(cacheDir, 'c.mp3')]);

    expect(backend.getPinnedTracks()).toEqual([join(cacheDir, 'c.mp3')]);
  });
```

In `tests/unit/mixer-client.test.ts` add after the remove-channel test:

```ts
  it('invokes the pin channel with the path list', async () => {
    const { ipc } = fakeIpc();
    const client = createMixerClient(ipc as never);

    await client.setPinnedTracks(['/tmp/mixer-cache/a.mp3']);

    expect(ipc.invoke).toHaveBeenCalledWith('mixer:set-pinned-tracks', [
      '/tmp/mixer-cache/a.mp3',
    ]);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/unit/mixer-handlers.test.ts tests/unit/mixer-client.test.ts`
Expected: FAIL with `backend.setPinnedTracks is not a function` and
`client.setPinnedTracks is not a function`.

- [ ] **Step 3: Implement the pin set**

In `src/plugins/mixer/backend/handlers.ts`, inside `createMixerBackend`, before `return {`:

```ts
  let pinnedPaths: string[] = [];

  const normalizePinned = (paths: unknown): string[] => {
    if (!Array.isArray(paths)) return [];

    const seen = new Set<string>();
    const result: string[] = [];

    for (const value of paths) {
      if (typeof value !== 'string' || !isPathInside(cacheDir, value)) continue;

      const key =
        process.platform === 'win32' ? value.toLowerCase() : value;

      if (seen.has(key)) continue;

      seen.add(key);
      result.push(value);
    }

    return result;
  };
```

Change the eviction call in `cacheTrack` from

```ts
          evict(cacheDir, maxBytes, [result.path]);
```

to

```ts
          evict(cacheDir, maxBytes, [result.path, ...pinnedPaths]);
```

Add to the returned object next to `readTrack`/`removeTrack`:

```ts
    setPinnedTracks(paths: unknown): void {
      pinnedPaths = normalizePinned(paths);
    },

    getPinnedTracks(): string[] {
      return [...pinnedPaths];
    },
```

In `src/plugins/mixer/backend/index.ts`, below the remove handler:

```ts
  ipc.handle('mixer:set-pinned-tracks', (paths: unknown) =>
    backend.setPinnedTracks(paths),
  );
```

In `src/plugins/mixer/renderer/client.ts`, add to the type and factory:

```ts
  setPinnedTracks: (paths: string[]) => Promise<void>;
```

```ts
  setPinnedTracks: async (paths) => {
    await ipc.invoke('mixer:set-pinned-tracks', paths);
  },
```

- [ ] **Step 4: Run tests, lint and typecheck**

Run: `pnpm vitest run tests/unit/mixer-handlers.test.ts tests/unit/mixer-client.test.ts`
Expected: PASS.

Run: `pnpm exec oxlint --type-aware src/plugins/mixer/backend/handlers.ts src/plugins/mixer/backend/index.ts src/plugins/mixer/renderer/client.ts`
Expected: `Found 0 warnings and 0 errors.`

Run: `pnpm tsc -p tsconfig.json --noEmit`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/plugins/mixer/backend/handlers.ts src/plugins/mixer/backend/index.ts src/plugins/mixer/renderer/client.ts tests/unit/mixer-handlers.test.ts tests/unit/mixer-client.test.ts
git commit -m "feat(mixer): pin cache files against eviction"
```

---

### Task 2: `loadTrack` returns the cached path

**Files:**
- Modify: `src/plugins/mixer/renderer/session.ts`
- Test: `tests/unit/mixer-load.test.ts`

**Interfaces:**
- Produces: `loadTrack(deps, deck, item): Promise<string | undefined>` — the cached file path when the
  buffer was installed, otherwise `undefined`. All existing callers ignore the value.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/mixer-load.test.ts`, in `caches, reads, decodes and installs the buffer`, change the
call to:

```ts
    const path = await loadTrack(deps as never, deck, item);

    expect(path).toBe('C:/cache/song.mp3');
```

In `maps cache failures to user copy` and `reports decode failures without throwing`, assert:

```ts
    expect(await loadTrack(deps as never, deck, item)).toBeUndefined();
```

(`maps cache failures...` currently calls `await loadTrack(...)`; replace that line. The decode test
already uses `expect(...).resolves.toBeUndefined()` — keep it.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/unit/mixer-load.test.ts`
Expected: FAIL — success case receives `undefined`, not `'C:/cache/song.mp3'`.

- [ ] **Step 3: Implement the return value**

In `src/plugins/mixer/renderer/session.ts`:

```ts
export const loadTrack = async (
  deps: LoadDeps,
  deck: Deck,
  item: MixerQueueItem,
): Promise<string | undefined> => {
```

Replace the success tail:

```ts
    if (isCurrent() && deck.load(buffer, token)) return result.track.path;

    return undefined;
```

Keep every failure branch as `return;` (typed `undefined`).

- [ ] **Step 4: Run tests, lint and typecheck**

Run: `pnpm vitest run tests/unit/mixer-load.test.ts tests/unit/mixer-panel` (if no such file, run
`pnpm vitest run tests/unit`)
Expected: PASS.

Run: `pnpm exec oxlint --type-aware src/plugins/mixer/renderer/session.ts`
Expected: 0/0. Run `pnpm tsc -p tsconfig.json --noEmit` — no output.

- [ ] **Step 5: Commit**

```bash
git add src/plugins/mixer/renderer/session.ts tests/unit/mixer-load.test.ts
git commit -m "feat(mixer): return the cached path from loadTrack"
```

---

### Task 3: Pure overlap state machine

**Files:**
- Create: `src/plugins/crossfade/overlap-machine.ts`
- Test: `tests/unit/overlap-machine.test.ts`

**Interfaces:**
- Produces:
  - `OverlapDeckId = 'A' | 'B'`
  - `OverlapMachine = { phase: 'idle'|'arming'|'blending'|'owned'; activeDeck: OverlapDeckId|null;
    incomingDeck: OverlapDeckId|null; ytmTrackId: string|null; activeTrackId: string|null;
    incomingTrackId: string|null }`
  - `OverlapEvent` = `armed {deck, trackId}` | `blend-start` | `ramp-done` | `next-boundary` |
    `navigation {videoId}` | `deck-ended` | `abort`
  - `OverlapEffect = 'start-ramp'|'mute-ytm'|'seek-ytm'|'unmute-ytm'|'advance-ytm'|'stop-decks'|'pin-tracks'`
  - `initialOverlap(): OverlapMachine`
  - `reduceOverlap(state, event): { state: OverlapMachine; effects: OverlapEffect[] }`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/overlap-machine.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  initialOverlap,
  reduceOverlap,
  type OverlapMachine,
} from '../../src/plugins/crossfade/overlap-machine';

const run = (
  state: OverlapMachine,
  events: Parameters<typeof reduceOverlap>[1][],
) => {
  let current = state;
  const effects: string[] = [];

  for (const event of events) {
    const result = reduceOverlap(current, event);
    current = result.state;
    effects.push(...result.effects);
  }

  return { state: current, effects };
};

describe('reduceOverlap', () => {
  it('arms and opens the first blend', () => {
    const idle = reduceOverlap(initialOverlap(), {
      type: 'navigation',
      videoId: 'one',
    }).state;
    const armed = run(idle, [
      { type: 'armed', deck: 'A', trackId: 'two' },
    ]);
    expect(armed.state).toMatchObject({
      phase: 'arming',
      incomingDeck: 'A',
      incomingTrackId: 'two',
    });

    const blending = reduceOverlap(armed.state, { type: 'blend-start' });
    expect(blending.state.phase).toBe('blending');
    expect(blending.effects).toEqual(['start-ramp']);
  });

  it('hands YTM over to the deck when navigation lands on the incoming track', () => {
    const { state } = run(initialOverlap(), [
      { type: 'navigation', videoId: 'one' },
      { type: 'armed', deck: 'A', trackId: 'two' },
      { type: 'blend-start' },
      { type: 'navigation', videoId: 'two' },
    ]);

    expect(state).toMatchObject({
      phase: 'owned',
      activeDeck: 'A',
      activeTrackId: 'two',
      incomingDeck: null,
    });
  });

  it('seeks on a matching navigation while owned and aborts on a mismatch', () => {
    const owned = run(initialOverlap(), [
      { type: 'navigation', videoId: 'one' },
      { type: 'armed', deck: 'A', trackId: 'two' },
      { type: 'blend-start' },
      { type: 'navigation', videoId: 'two' },
    ]).state;

    const same = reduceOverlap(owned, { type: 'navigation', videoId: 'two' });
    expect(same.state).toBe(owned);
    expect(same.effects).toEqual(['seek-ytm']);

    const other = reduceOverlap(owned, {
      type: 'navigation',
      videoId: 'three',
    });
    expect(other.state.phase).toBe('idle');
    expect(other.effects).toEqual(['stop-decks', 'unmute-ytm', 'pin-tracks']);
  });

  it('chains a deck-to-deck blend and promotes the incoming deck', () => {
    const owned = run(initialOverlap(), [
      { type: 'navigation', videoId: 'one' },
      { type: 'armed', deck: 'A', trackId: 'two' },
      { type: 'blend-start' },
      { type: 'navigation', videoId: 'two' },
    ]).state;
    const armed = run(owned, [
      { type: 'armed', deck: 'B', trackId: 'three' },
    ]).state;
    const chained = reduceOverlap(armed, { type: 'next-boundary' });
    expect(chained.state.phase).toBe('blending');
    expect(chained.effects).toEqual(['start-ramp']);

    const done = reduceOverlap(chained.state, { type: 'ramp-done' });
    expect(done.state).toMatchObject({
      phase: 'owned',
      activeDeck: 'B',
      activeTrackId: 'three',
      incomingDeck: null,
    });
  });

  it('only advances YTM from an owned deck end', () => {
    expect(
      reduceOverlap(initialOverlap(), { type: 'deck-ended' }).effects,
    ).toEqual([]);

    const owned = run(initialOverlap(), [
      { type: 'navigation', videoId: 'one' },
      { type: 'armed', deck: 'A', trackId: 'two' },
      { type: 'blend-start' },
      { type: 'navigation', videoId: 'two' },
    ]).state;

    expect(reduceOverlap(owned, { type: 'deck-ended' }).effects).toEqual([
      'advance-ytm',
    ]);
  });

  it('aborts ownership with the full teardown effect set', () => {
    const owned = run(initialOverlap(), [
      { type: 'navigation', videoId: 'one' },
      { type: 'armed', deck: 'A', trackId: 'two' },
      { type: 'blend-start' },
      { type: 'navigation', videoId: 'two' },
    ]).state;

    const abort = reduceOverlap(owned, { type: 'abort' });
    expect(abort.state.phase).toBe('idle');
    expect(abort.effects).toEqual(['stop-decks', 'unmute-ytm', 'pin-tracks']);
  });

  it('ignores blend events outside their phases', () => {
    const idle = initialOverlap();
    expect(reduceOverlap(idle, { type: 'blend-start' }).state).toBe(idle);
    expect(reduceOverlap(idle, { type: 'next-boundary' }).state).toBe(idle);
    expect(reduceOverlap(idle, { type: 'ramp-done' }).state).toBe(idle);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/unit/overlap-machine.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the machine**

Create `src/plugins/crossfade/overlap-machine.ts`:

```ts
export type OverlapDeckId = 'A' | 'B';

export type OverlapPhase = 'idle' | 'arming' | 'blending' | 'owned';

export type OverlapMachine = {
  phase: OverlapPhase;
  activeDeck: OverlapDeckId | null;
  incomingDeck: OverlapDeckId | null;
  ytmTrackId: string | null;
  activeTrackId: string | null;
  incomingTrackId: string | null;
};

export type OverlapEvent =
  | { type: 'armed'; deck: OverlapDeckId; trackId: string }
  | { type: 'blend-start' }
  | { type: 'ramp-done' }
  | { type: 'next-boundary' }
  | { type: 'navigation'; videoId: string }
  | { type: 'deck-ended' }
  | { type: 'abort' };

export type OverlapEffect =
  | 'start-ramp'
  | 'mute-ytm'
  | 'seek-ytm'
  | 'unmute-ytm'
  | 'advance-ytm'
  | 'stop-decks'
  | 'pin-tracks';

export const initialOverlap = (): OverlapMachine => ({
  phase: 'idle',
  activeDeck: null,
  incomingDeck: null,
  ytmTrackId: null,
  activeTrackId: null,
  incomingTrackId: null,
});

const idleOn = (videoId?: string): OverlapMachine => ({
  ...initialOverlap(),
  ytmTrackId: videoId ?? null,
  activeTrackId: videoId ?? null,
});

export const reduceOverlap = (
  state: OverlapMachine,
  event: OverlapEvent,
): { state: OverlapMachine; effects: OverlapEffect[] } => {
  switch (event.type) {
    case 'armed': {
      if (state.phase === 'blending') return { state, effects: [] };

      return {
        state: {
          ...state,
          incomingDeck: event.deck,
          incomingTrackId: event.trackId,
        },
        effects: [],
      };
    }
    case 'blend-start': {
      if (state.phase !== 'arming') return { state, effects: [] };

      return {
        state: { ...state, phase: 'blending' },
        effects: ['start-ramp'],
      };
    }
    case 'next-boundary': {
      if (state.phase !== 'owned' || !state.incomingDeck) {
        return { state, effects: [] };
      }

      return {
        state: { ...state, phase: 'blending' },
        effects: ['start-ramp'],
      };
    }
    case 'ramp-done': {
      if (state.phase !== 'blending' || !state.incomingDeck) {
        return { state, effects: [] };
      }

      return {
        state: {
          ...state,
          phase: 'owned',
          activeDeck: state.incomingDeck,
          activeTrackId: state.incomingTrackId,
          incomingDeck: null,
          incomingTrackId: null,
        },
        effects: ['pin-tracks'],
      };
    }
    case 'navigation': {
      if (state.phase === 'idle') {
        return { state: idleOn(event.videoId), effects: [] };
      }

      if (event.videoId === state.activeTrackId) {
        return {
          state: { ...state, ytmTrackId: event.videoId },
          effects: state.phase === 'owned' ? ['seek-ytm'] : [],
        };
      }

      if (event.videoId === state.incomingTrackId) {
        return {
          state: {
            ...state,
            phase: 'owned',
            activeDeck: state.incomingDeck,
            activeTrackId: event.videoId,
            incomingDeck: null,
            incomingTrackId: null,
            ytmTrackId: event.videoId,
          },
          effects: ['mute-ytm', 'seek-ytm', 'pin-tracks'],
        };
      }

      return {
        state: idleOn(event.videoId),
        effects: ['stop-decks', 'unmute-ytm', 'pin-tracks'],
      };
    }
    case 'deck-ended': {
      return {
        state,
        effects: state.phase === 'owned' ? ['advance-ytm'] : [],
      };
    }
    case 'abort': {
      if (state.phase === 'idle') return { state, effects: [] };

      return {
        state: idleOn(state.ytmTrackId ?? undefined),
        effects: ['stop-decks', 'unmute-ytm', 'pin-tracks'],
      };
    }
  }
};
```

- [ ] **Step 4: Run tests, lint and typecheck**

Run: `pnpm vitest run tests/unit/overlap-machine.test.ts`
Expected: PASS (7 tests).

Run: `pnpm exec oxlint --type-aware src/plugins/crossfade/overlap-machine.ts`
Expected: 0/0. Run `pnpm tsc -p tsconfig.json --noEmit` — no output.

- [ ] **Step 5: Commit**

```bash
git add src/plugins/crossfade/overlap-machine.ts tests/unit/overlap-machine.test.ts
git commit -m "feat(crossfade): add overlap state machine"
```

---

### Task 4: Overlap controller

**Files:**
- Create: `src/plugins/crossfade/overlap.ts`
- Modify: `src/plugins/crossfade/state.ts`
- Test: `tests/unit/overlap-controller.test.ts`

**Interfaces:**
- Consumes: `MixerEngine`, `Deck` (`../mixer/renderer/engine`), `MixerClient`
  (`../mixer/renderer/client`), `loadTrack` + `MixerQueueItem` (`../mixer/renderer/session`),
  `crossfaderGains` (`../mixer/renderer/engine`), machine from Task 3.
- Produces:
  - `state.ts`: `setOverlapActive(value: boolean): void`, `isOverlapActive(): boolean`.
  - `OverlapController` with `start(video, playerApi)`, `stop()`, `updateConfig(config)`,
    `snapshot(): { state: string; activeDeck: 'A'|'B'|null; videoId: string|null; position: number;
    ytmMuted: boolean }`.
  - `createOverlapController({ client, readQueue, getConfig, now?, requestFrame?, cancelFrame? })`.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/overlap-controller.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createOverlapController } from '../../src/plugins/crossfade/overlap';
import { MixerEngine } from '../../src/plugins/mixer/renderer/engine';

import { fakeBuffer, FakeContext } from './fake-audio';

import type { MixerQueueItem } from '../../src/plugins/mixer/renderer/session';

type FakeVideo = {
  currentTime: number;
  duration: number;
  muted: boolean;
  paused: boolean;
  playbackRate: number;
  volume: number;
  addEventListener: (event: string, fn: () => void) => void;
  removeEventListener: (event: string, fn: () => void) => void;
  play: () => Promise<void>;
  pause: () => void;
  emit: (event: string) => void;
};

const video = (): FakeVideo => {
  const listeners = new Map<string, Set<() => void>>();
  const element: FakeVideo = {
    currentTime: 0,
    duration: 200,
    muted: false,
    paused: false,
    playbackRate: 1,
    volume: 0.8,
    addEventListener: (event, fn) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(fn);
    },
    removeEventListener: (event, fn) => listeners.get(event)?.delete(fn),
    play: () => {
      element.paused = false;

      return Promise.resolve();
    },
    pause: () => {
      element.paused = true;
    },
    emit: (event) => {
      for (const fn of listeners.get(event) ?? []) fn();
    },
  };

  return element;
};

const item = (videoId: string): MixerQueueItem => ({
  videoId,
  title: videoId,
  artist: 'A',
  duration: 200,
});

const setup = () => {
  const element = video();
  let playerVideoId = 'one';
  const playerApi = {
    getVideoData: () => ({ video_id: playerVideoId }),
    seekTo: vi.fn(),
    getCurrentTime: () => element.currentTime,
    getPlayerState: () => (element.paused ? 2 : 1),
    setVolume: vi.fn(),
    getVolume: () => element.volume,
  };
  const queue = [item('one'), item('two'), item('three')];
  const readQueue = vi.fn(() => queue);
  const client = {
    cacheTrack: vi.fn(async (videoId: string) => ({
      ok: true as const,
      track: {
        videoId,
        title: videoId,
        artist: 'A',
        duration: 200,
        path: `C:/cache/${videoId}.mp3`,
        extension: 'mp3',
      },
    })),
    readTrack: vi.fn(async () => new ArrayBuffer(4)),
    removeTrack: vi.fn(async () => {}),
    setPinnedTracks: vi.fn(async () => {}),
    onCacheProgress: vi.fn(() => () => {}),
  };
  const frames: Array<() => void> = [];
  let clock = 0;
  const controller = createOverlapController({
    client,
    readQueue,
    getConfig: () => ({
      enabled: true,
      overlap: true,
      secondsBeforeEnd: 30,
      fadeInDuration: 30000,
      fadeOutDuration: 30000,
      fadeScaling: 'linear',
    }),
    now: () => clock,
    requestFrame: (cb) => {
      frames.push(cb);

      return frames.length;
    },
    cancelFrame: () => {},
    createEngine: () => new MixerEngine(new FakeContext() as never),
    decode: async () => fakeBuffer(200),
    advance: (ms: number) => {
      clock += ms;
    },
    flushFrames: () => {
      while (frames.length > 0) frames.shift()!();
    },
  });

  controller.start(element as never, playerApi as never);
  playerVideoId = 'one';

  return {
    controller,
    client,
    element,
    playerApi,
    frames,
    setPlayerVideoId: (id: string) => {
      playerVideoId = id;
    },
  };
};

afterEach(() => {
  vi.useRealTimers();
});

describe('OverlapController', () => {
  it('pre-caches the next item and pins it while arming', async () => {
    const { controller, client, element } = setup();
    element.currentTime = 150;
    await controller.tickForTest();

    expect(client.cacheTrack).toHaveBeenCalledWith('two');
    expect(client.setPinnedTracks).toHaveBeenCalled();
    expect(controller.snapshot().state).toBe('arming');
  });

  it('blends, mutes YTM on navigation and owns the deck', async () => {
    const { controller, element, setPlayerVideoId } = setup();
    element.currentTime = 150;
    await controller.tickForTest();

    element.currentTime = 175; // inside the 30 s window of a 200 s track
    await controller.tickForTest();
    expect(controller.snapshot().state).toBe('blending');

    element.currentTime = 200;
    setPlayerVideoId('two');
    controller.navigateForTest('two');

    const snap = controller.snapshot();
    expect(snap.state).toBe('owned');
    expect(snap.activeDeck).toBe('A');
    expect(element.muted).toBe(true);
  });

  it('mirrors pause onto the active deck and keeps ownership', async () => {
    const { controller, element, playerApi, setPlayerVideoId } = setup();
    element.currentTime = 150;
    await controller.tickForTest();
    element.currentTime = 175;
    await controller.tickForTest();
    setPlayerVideoId('two');
    controller.navigateForTest('two');

    element.paused = true;
    element.emit('pause');

    expect(controller.snapshot().state).toBe('owned');
    element.paused = false;
    element.emit('play');
  });

  it('mirrors a user seek into the deck', async () => {
    const { controller, element, setPlayerVideoId } = setup();
    element.currentTime = 150;
    await controller.tickForTest();
    element.currentTime = 175;
    await controller.tickForTest();
    setPlayerVideoId('two');
    controller.navigateForTest('two');

    element.currentTime = 42;
    element.emit('seeked');
    expect(controller.snapshot().position).toBeCloseTo(42, 0);
  });

  it('tears down and unmutes on a mismatched navigation', async () => {
    const { controller, element, setPlayerVideoId } = setup();
    element.currentTime = 150;
    await controller.tickForTest();
    element.currentTime = 175;
    await controller.tickForTest();
    setPlayerVideoId('two');
    controller.navigateForTest('two');

    controller.navigateForTest('three');

    expect(controller.snapshot().state).toBe('idle');
    expect(element.muted).toBe(false);
  });

  it('falls back to idle when the next item cannot be cached', async () => {
    const { controller, client, element } = setup();
    client.cacheTrack.mockResolvedValue({
      ok: false,
      code: 'NETWORK',
      message: 'offline',
    } as never);

    element.currentTime = 150;
    await controller.tickForTest();
    element.currentTime = 175;
    await controller.tickForTest();

    expect(client.cacheTrack).toHaveBeenCalledTimes(1);
    expect(controller.snapshot().state).toBe('idle');
    expect(element.muted).toBe(false);
  });

  it('mirrors a volume change into the engine while owned', async () => {
    const { controller, element, setPlayerVideoId } = setup();
    element.currentTime = 150;
    await controller.tickForTest();
    element.currentTime = 175;
    await controller.tickForTest();
    setPlayerVideoId('two');
    controller.navigateForTest('two');

    element.volume = 0.4;
    element.emit('volumechange');

    expect(controller.snapshot().volume).toBeCloseTo(0.4, 2);
  });
});
```

Add `advance`, `flushFrames`, and a `volume` field to `snapshot` in the implementation. `tickForTest`
and `navigateForTest` are thin public wrappers the implementation must expose.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/unit/overlap-controller.test.ts`
Expected: FAIL — `createOverlapController` is not a function.

- [ ] **Step 3: Implement the controller and state flag**

Add to `src/plugins/crossfade/state.ts`:

```ts
let overlapActive = false;

export const setOverlapActive = (value: boolean) => {
  overlapActive = value;
};

export const isOverlapActive = () => overlapActive;
```

Create `src/plugins/crossfade/overlap.ts`:

```ts
import { crossfaderGains, MixerEngine } from '../mixer/renderer/engine';
import { loadTrack, type MixerQueueItem } from '../mixer/renderer/session';

import {
  initialOverlap,
  reduceOverlap,
  type OverlapEffect,
  type OverlapEvent,
  type OverlapMachine,
} from './overlap-machine';
import { isCrossfading, setCrossfading, setOverlapActive } from './state';

import type { MixerClient } from '../mixer/renderer/client';
import type { CrossfadePluginConfig } from './index';
import type { MusicPlayer } from '@/types/music-player';

type OverlapDeckId = 'A' | 'B';

export type OverlapControllerOptions = {
  client: MixerClient;
  readQueue: () => MixerQueueItem[];
  getConfig: () => CrossfadePluginConfig;
  createEngine?: () => MixerEngine;
  decode?: (context: AudioContext, data: ArrayBuffer) => Promise<AudioBuffer>;
  now?: () => number;
  requestFrame?: (callback: () => void) => number;
  cancelFrame?: (handle: number) => void;
  advance?: (ms: number) => void;
  flushFrames?: () => void;
};

export type OverlapSnapshot = {
  state: OverlapMachine['phase'];
  activeDeck: OverlapDeckId | null;
  videoId: string | null;
  position: number;
  volume: number;
  ytmMuted: boolean;
};

const MIN_BLEND_SECONDS = 1;

export const createOverlapController = (options: OverlapControllerOptions) => {
  const now = options.now ?? (() => performance.now());
  const requestFrame =
    options.requestFrame ?? ((callback: () => void) => window.requestAnimationFrame(() => callback()));
  const cancelFrame = options.cancelFrame ?? ((handle: number) => window.cancelAnimationFrame(handle));
  const advance = options.advance ?? (() => {});
  const decode =
    options.decode ??
    ((context: AudioContext, data: ArrayBuffer) =>
      context.decodeAudioData(data.slice(0)));

  let machine = initialOverlap();
  let engine: MixerEngine | null = null;
  let video: HTMLVideoElement | null = null;
  let playerApi: MusicPlayer | null = null;
  let config = options.getConfig();
  let master = 1;
  let rampToken = 0;
  let rampFrame = 0;
  let arming = false;
  let suspended = false;
  let lastAdvanceAt = -Infinity;
  let loadedPaths: Partial<Record<OverlapDeckId, string>> = {};
  let failedTrackId: string | null = null;
  const detachers: Array<() => void> = [];
  const timers: number[] = [];
  let tickTimer: number | null = null;

  const videoId = (): string | null =>
    playerApi?.getVideoData()?.video_id ??
    new URLSearchParams(location.search).get('v');

  const deck = (id: OverlapDeckId) => engine?.decks[id] ?? null;

  const ensureEngine = (): MixerEngine => {
    if (engine) return engine;

    engine = options.createEngine ? options.createEngine() : new MixerEngine();
    engine.setMasterVolume(video?.volume ?? master);
    engine.decks.A.subscribe(onDeckCore);
    engine.decks.B.subscribe(onDeckCore);

    return engine;
  };

  const setActive = (value: boolean) => {
    setOverlapActive(value);
  };

  const syncPins = () => {
    const paths = [
      loadedPaths[machine.activeDeck ?? 'A'],
      loadedPaths[machine.incomingDeck ?? 'B'],
    ].filter((path, index, all): path is string =>
      Boolean(path) && all.indexOf(path) === index,
    );

    options.client.setPinnedTracks(paths).catch(() => {});
  };

  const stopDecks = () => {
    engine?.decks.A.dispose();
    engine?.decks.B.dispose();
    loadedPaths = {};
    setOverlapActive(false);
    setCrossfading(false);
  };

  const cancelRamp = () => {
    rampToken += 1;
    if (rampFrame) cancelFrame(rampFrame);
    rampFrame = 0;
  };

  const guardedAdvance = () => {
    if (now() - lastAdvanceAt < 300) return;
    if (videoId() !== machine.activeTrackId) return;

    lastAdvanceAt = now();
    document.querySelector<HTMLButtonElement>('.next-button')?.click();
  };

  const applyEffects = (effects: OverlapEffect[]) => {
    for (const effect of effects) {
      switch (effect) {
        case 'mute-ytm':
          if (video) video.muted = true;
          break;
        case 'seek-ytm': {
          const active = machine.activeDeck ? deck(machine.activeDeck) : null;
          if (active && playerApi) playerApi.seekTo(active.position());
          break;
        }
        case 'unmute-ytm':
          if (video) {
            video.muted = false;
            video.volume = master;
          }
          break;
        case 'advance-ytm':
          guardedAdvance();
          break;
        case 'stop-decks':
          cancelRamp();
          stopDecks();
          break;
        case 'pin-tracks':
          syncPins();
          break;
        case 'start-ramp':
          break;
      }
    }

    setActive(machine.phase !== 'idle');
  };

  const dispatch = (event: OverlapEvent) => {
    const previous = machine;
    const result = reduceOverlap(machine, event);
    machine = result.state;
    applyEffects(result.effects);

    if (result.effects.includes('start-ramp')) {
      startRamp(previous.phase === 'owned' ? previous.activeDeck : null);
    }
  };

  const blendSeconds = (): number => {
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) {
      return 0;
    }

    const configured = Math.min(
      config.secondsBeforeEnd,
      config.fadeOutDuration / 1000,
      video.duration / 2,
    );

    return configured >= MIN_BLEND_SECONDS ? configured : 0;
  };

  const remaining = (): number | null => {
    if (machine.phase === 'owned' || machine.phase === 'blending') {
      const active = machine.activeDeck ? deck(machine.activeDeck) : null;
      if (!active || active.getDuration() === 0) return null;

      return active.getDuration() - active.position();
    }

    if (!video || !Number.isFinite(video.duration)) return null;

    return video.duration - video.currentTime;
  };

  const otherDeck = (): OverlapDeckId =>
    machine.activeDeck === 'A' || machine.incomingDeck === 'A' ? 'B' : 'A';

  const armNext = async () => {
    if (arming || suspended) return;

    const items = options.readQueue();
    const index = items.findIndex((entry) => entry.videoId === machine.activeTrackId);
    const next = index >= 0 ? items[index + 1] : undefined;

    if (!next || next.videoId === machine.activeTrackId) return;
    if (failedTrackId === next.videoId) return;

    arming = true;

    try {
      const target = ensureEngine();
      const deckId = otherDeck();
      const path = await loadTrack(
        {
          client: options.client,
          decode: (data) => decode(target.context, data),
        },
        target.decks[deckId],
        next,
      );

      if (!path) {
        failedTrackId = next.videoId;

        return;
      }

      if (videoId() !== machine.activeTrackId) return;

      loadedPaths[deckId] = path;
      dispatch({ type: 'armed', deck: deckId, trackId: next.videoId });
      syncPins();
    } finally {
      arming = false;
    }
  };

  const startRamp = (fromDeck: OverlapDeckId | null) => {
    if (!video || !engine || !machine.incomingDeck) return;

    const incoming = machine.incomingDeck;
    const elapsedSeconds = Math.max(MIN_BLEND_SECONDS, blendSeconds());
    const durationMs = elapsedSeconds * 1000;
    const started = now();
    const token = ++rampToken;
    const outgoingIsYtm = machine.phase === 'blending' && fromDeck === null;

    master = video.volume || master;
    engine.setMasterVolume(master);
    setCrossfading(true);

    if (outgoingIsYtm) {
      engine.setCrossfader(incoming === 'A' ? -1 : 1);
      engine.decks[incoming].setVolume(0);
      engine.decks[incoming].play().then((startedOk) => {
        if (!startedOk) abortOwnership();
      });
    } else {
      engine.decks.A.setVolume(1);
      engine.decks.B.setVolume(1);
    }

    const step = () => {
      if (token !== rampToken || !video || !engine) return;

      const p = Math.min(1, (now() - started) / durationMs);

      if (outgoingIsYtm) {
        const gains = crossfaderGains(-1 + p * 2);
        video.volume = master * gains.a;
        engine.decks[incoming].setVolume(gains.b);
      } else if (fromDeck === 'A') {
        engine.setCrossfader(-1 + p * 2);
      } else {
        engine.setCrossfader(1 - p * 2);
      }

      if (p < 1) {
        rampFrame = requestFrame(step);

        return;
      }

      if (outgoingIsYtm) {
        engine.decks[incoming].setVolume(1);
        video.volume = video.muted ? master : 0;
      } else {
        engine.setCrossfader(incoming === 'A' ? -1 : 1);
      }

      setCrossfading(false);
      dispatch({ type: 'ramp-done' });
    };

    step();
  };

  const abortOwnership = () => {
    cancelRamp();
    dispatch({ type: 'abort' });
    setCrossfading(false);
  };

  const onDeckCore = (core: { status: string }) => {
    if (core.status === 'ended' && machine.phase !== 'idle') {
      dispatch({ type: 'deck-ended' });
    }
  };

  const onTick = async () => {
    if (suspended || !video || !playerApi) return;

    if (
      (machine.phase === 'owned' || machine.phase === 'blending') &&
      engine?.context.state === 'suspended'
    ) {
      const resumed = await engine.resume();
      if (!resumed) abortOwnership();

      return;
    }

    const windowSeconds = blendSeconds();
    if (windowSeconds <= 0) return;

    if (machine.phase === 'blending') return;

    const left = remaining();
    if (left === null) return;

    if (
      machine.incomingDeck === null &&
      (machine.phase === 'idle' || machine.phase === 'owned') &&
      left <= windowSeconds + 45
    ) {
      await armNext();
    }

    if (machine.phase === 'arming' && left <= windowSeconds) {
      dispatch({ type: 'blend-start' });
    }

    if (
      machine.phase === 'owned' &&
      machine.incomingDeck !== null &&
      left <= windowSeconds
    ) {
      dispatch({ type: 'next-boundary' });
    }
  };

  const onNavigation = (newVideoId: string) => {
    failedTrackId = null;

    if (machine.phase === 'blending') {
      cancelRamp();
      if (engine) {
        engine.decks.A.setVolume(1);
        engine.decks.B.setVolume(1);
        engine.setCrossfader(machine.incomingDeck === 'A' ? -1 : 1);
      }
      if (video) video.volume = master;
    }

    dispatch({ type: 'navigation', videoId: newVideoId });
  };

  const onSeeked = () => {
    if (!video) return;

    if (machine.phase === 'owned') {
      if (machine.activeDeck) deck(machine.activeDeck)?.seek(video.currentTime);
      return;
    }

    if (machine.phase === 'blending') abortOwnership();
  };

  const onPause = () => {
    if (machine.phase === 'blending') {
      abortOwnership();
      return;
    }

    if (machine.phase === 'owned' && machine.activeDeck) {
      deck(machine.activeDeck)?.pause();
    }
  };

  const onPlay = () => {
    if (machine.phase === 'owned' && machine.activeDeck) {
      const active = deck(machine.activeDeck);
      if (!active) return;

      active.play().then((started) => {
        if (!started) abortOwnership();
      });
    }
  };

  const onVolume = () => {
    if (!video || machine.phase === 'idle') return;

    if (machine.phase === 'owned' && engine && video.muted) {
      engine.setMasterVolume(video.volume);
    }
  };

  const onRate = () => {
    if (video && video.playbackRate !== 1 && machine.phase !== 'idle') {
      abortOwnership();
    }
  };

  const microSync = () => {
    if (!video || !engine || machine.phase !== 'owned' || video.paused) return;
    if (!machine.activeDeck) return;

    const active = deck(machine.activeDeck);
    if (!active || active.getCore().status !== 'playing') return;

    if (Math.abs(video.currentTime - active.position()) > 0.5) {
      active.seek(video.currentTime);
    }
  };

  const onMixerOpen = () => {
    suspended = true;
    abortOwnership();
  };

  const onMixerClose = () => {
    suspended = false;
  };

  const listen = (target: EventTarget, event: string, handler: () => void) => {
    target.addEventListener(event, handler);
    detachers.push(() => target.removeEventListener(event, handler));
  };

  return {
    start(element: HTMLVideoElement, api: MusicPlayer) {
      video = element;
      playerApi = api;
      master = element.volume || 1;

      listen(element, 'timeupdate', () => void onTick());
      listen(element, 'pause', onPause);
      listen(element, 'play', onPlay);
      listen(element, 'seeked', onSeeked);
      listen(element, 'volumechange', onVolume);
      listen(element, 'ratechange', onRate);

      const onNavigateWindow = (event: Event) => {
        const target = event as unknown as { destination?: { url?: string } };
        const url = new URL(target.destination?.url ?? location.href);
        const id = url.searchParams.get('v');
        if (id) onNavigation(id);
      };
      window.navigation?.addEventListener('navigate', onNavigateWindow);
      detachers.push(() =>
        window.navigation?.removeEventListener('navigate', onNavigateWindow),
      );

      const current = videoId();
      if (current) onNavigation(current);

      listen(window, 'musicapp:mixer-open', onMixerOpen);
      listen(window, 'musicapp:mixer-close', onMixerClose);

      tickTimer = window.setInterval(() => void onTick(), 250);
      timers.push(tickTimer);
      timers.push(window.setInterval(microSync, 5000));
    },

    stop() {
      cancelRamp();
      abortOwnership();
      options.client.setPinnedTracks([]).catch(() => {});
      for (const off of detachers) off();
      detachers.length = 0;
      for (const timer of timers) window.clearInterval(timer);
      timers.length = 0;
      void engine?.close();
      engine = null;
      video = null;
      playerApi = null;
      setOverlapActive(false);
      setCrossfading(false);
    },

    updateConfig(next: CrossfadePluginConfig) {
      config = next;
      if (!next.enabled || !next.overlap) abortOwnership();
    },

    tickForTest() {
      advance(1000);
      element.currentTime += 1;

      return onTick();
    },

    navigateForTest(id: string) {
      onNavigation(id);
    },

    snapshot(): OverlapSnapshot {
      const active = machine.activeDeck ? deck(machine.activeDeck) : null;

      return {
        state: machine.phase,
        activeDeck: machine.activeDeck,
        videoId: machine.activeTrackId,
        position: active?.position() ?? 0,
        volume: engine?.getMasterVolume() ?? master,
        ytmMuted: video?.muted ?? false,
      };
    },
  };
};
```

Notes for the implementer:

- `CrossfadePluginConfig` must be exported from `index.ts` (Task 5 does this; if it is not yet
  exported, declare a local structural type for this task).
- `window.navigation` is typed in this repo; if `navigation?.addEventListener` complains, cast once
  (the crossfade plugin already uses `window.navigation.addEventListener`).
- `tickForTest` advances the injected clock by 1 s and `element.currentTime += 1` so the test can
  step through the window; tests set `currentTime` directly before calling it.

- [ ] **Step 4: Run tests, lint and typecheck**

Run: `pnpm vitest run tests/unit/overlap-controller.test.ts tests/unit/overlap-machine.test.ts`
Expected: PASS (6 controller tests + 7 machine tests). If a test times out or state is wrong, fix
the controller, not the test.

Run: `pnpm exec oxlint --type-aware src/plugins/crossfade/overlap.ts src/plugins/crossfade/overlap-machine.ts src/plugins/crossfade/state.ts`
Expected: 0/0. Run `pnpm tsc -p tsconfig.json --noEmit` — no output.

- [ ] **Step 5: Commit**

```bash
git add src/plugins/crossfade/overlap.ts src/plugins/crossfade/overlap-machine.ts src/plugins/crossfade/state.ts tests/unit/overlap-controller.test.ts
git commit -m "feat(crossfade): add deck-owning overlap controller"
```

---

### Task 5: Crossfade plugin integration

**Files:**
- Modify: `src/plugins/crossfade/index.ts`
- Test: manual (live in Task 8)

**Interfaces:**
- Consumes: `createOverlapController` (Task 4), `createMixerClient` (`../mixer/renderer/client`),
  `toQueueItems` (`../mixer/renderer/session`), `QueueElement` (`@/types/queue`),
  `MusicPlayer` (`@/types/music-player`), `isOverlapActive` (`./state`).
- Produces: `CrossfadePluginConfig.overlap: boolean` (exported type), dev hook `window.__overlap`.

- [ ] **Step 1: Extend the config type and defaults**

In `src/plugins/crossfade/index.ts` add to `CrossfadePluginConfig`:

```ts
  /** Blend the next cached queue track under the current one. */
  overlap: boolean;
```

and to the plugin `config`:

```ts
    overlap: false,
```

- [ ] **Step 2: Wire the controller into the renderer lifecycle**

At the top of the file:

```ts
import { createMixerClient } from '../mixer/renderer/client';
import { toQueueItems } from '../mixer/renderer/session';

import { createOverlapController } from './overlap';
import { isOverlapActive } from './state';

import type { QueueElement } from '@/types/queue';
import type { MusicPlayer } from '@/types/music-player';
```

Inside `renderer`, add fields and methods:

```ts
    overlap: null as ReturnType<typeof createOverlapController> | null,

    async start(context) {
      this.config = await context.getConfig();
      this.overlap = createOverlapController({
        client: createMixerClient(context.ipc),
        readQueue: () => {
          const queue = document.querySelector<QueueElement>('#queue');
          if (!queue) return [];

          try {
            return toQueueItems(queue.queue.getItems());
          } catch {
            return [];
          }
        },
        getConfig: () => this.config!,
      });
    },

    stop() {
      this.overlap?.stop();
      this.overlap = null;
    },

    onConfigChange(newConfig) {
      this.config = newConfig;
      this.overlap?.updateConfig(newConfig);
    },
```

In `onPlayerApiReady(playerApi)`, after the `video` lookup, start the controller when configured:

```ts
      if (this.config?.overlap) {
        this.overlap?.start(video, playerApi);
        (window as unknown as { __overlap?: unknown }).__overlap = {
          snapshot: () => this.overlap?.snapshot(),
        };
      }
```

On `stop`/disable also delete the hook:

```ts
      delete (window as { __overlap?: unknown }).__overlap;
```

(place that inside `stop()`).

- [ ] **Step 3: Suppress the legacy fade while overlap is active**

In the existing `timeupdate` listener, first line:

```ts
        if (isOverlapActive()) return;
```

and in `fadeIn`, guard the same way before touching volume:

```ts
        if (isOverlapActive()) return;
```

- [ ] **Step 4: Lint, typecheck, full suite and build**

Run: `pnpm exec oxlint --type-aware src/plugins/crossfade/index.ts`
Expected: 0/0 (reorder imports empirically if needed).

Run: `pnpm tsc -p tsconfig.json --noEmit` — no output.

Run: `pnpm vitest run tests/unit` — all green.

Run: `pnpm build` — must succeed.

- [ ] **Step 5: Commit**

```bash
git add src/plugins/crossfade/index.ts
git commit -m "feat(crossfade): run the overlap controller from the plugin"
```

---

### Task 6: Settings row and config mapping

**Files:**
- Modify: `src/plugins/in-app-menu/settings-schema.ts`
- Modify: `src/plugins/in-app-menu/main.ts`

**Interfaces:**
- Consumes: `plugins.crossfade.overlap` config key.
- Produces: a switch in the Crossfade section with `apply: 'live'`.

- [ ] **Step 1: Add the settings row**

In `settings-schema.ts`, inside the `crossfade` section after the range row:

```ts
      {
        kind: 'switch',
        key: 'plugins.crossfade.overlap',
        label: 'Real overlap',
        description:
          'Blend the next track under the current one when it is cached. Requires the Mixer plugin.',
        apply: 'live',
      },
```

- [ ] **Step 2: Map the key in the main process**

In `main.ts`, extend `crossfadeDefaults`:

```ts
    overlap: false,
```

and add the case next to `plugins.crossfade.transitionSeconds`:

```ts
      case 'plugins.crossfade.overlap': {
        config.setPartial(
          'plugins.crossfade',
          { overlap: Boolean(value) },
          crossfadeDefaults,
        );
        return;
      }
```

- [ ] **Step 3: Lint, typecheck and build**

Run: `pnpm exec oxlint --type-aware src/plugins/in-app-menu/settings-schema.ts src/plugins/in-app-menu/main.ts`
Expected: 0/0. Run `pnpm tsc -p tsconfig.json --noEmit` and `pnpm build` — both clean.

- [ ] **Step 4: Commit**

```bash
git add src/plugins/in-app-menu/settings-schema.ts src/plugins/in-app-menu/main.ts
git commit -m "feat(crossfade): add the real-overlap setting"
```

---

### Task 7: Mixer open/close events

**Files:**
- Modify: `src/plugins/mixer/renderer/index.tsx`

**Interfaces:**
- Produces: `window` CustomEvents `musicapp:mixer-open` and `musicapp:mixer-close`, dispatched at the
  start of `openMixer()` and at the end of `closeMixer()`.

- [ ] **Step 1: Dispatch the events**

At the top of `openMixer`, after the early-return guard:

```ts
  window.dispatchEvent(new CustomEvent('musicapp:mixer-open'));
```

At the end of `closeMixer` (after the try/catch around `current.close()`):

```ts
  window.dispatchEvent(new CustomEvent('musicapp:mixer-close'));
```

- [ ] **Step 2: Lint, typecheck**

Run: `pnpm exec oxlint --type-aware src/plugins/mixer/renderer/index.tsx`
Expected: 0/0. Run `pnpm tsc -p tsconfig.json --noEmit` — no output.

- [ ] **Step 3: Commit**

```bash
git add src/plugins/mixer/renderer/index.tsx
git commit -m "feat(mixer): announce panel open and close"
```

---

### Task 8: Live verification

**Files:**
- Modify: `package.json` (version `0.1.19`)
- Create (temporary, not committed): `%TEMP%/cdp-overlap.mjs`

**Interfaces:**
- Consumes: the installed build and `window.__overlap` (Task 5).

- [ ] **Step 1: Bump and build**

```bash
node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));p.version='0.1.19';fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\n')"
pnpm dist:win
```

- [ ] **Step 2: Install and enable**

```bash
taskkill //IM MusicApp.exe //F || true
MSYS_NO_PATHCONV=1 "./pack/MusicApp-Desktop.exe" /S
node -e "const fs=require('fs');const path=process.env.APPDATA+'/MusicApp/config.json';const c=JSON.parse(fs.readFileSync(path,'utf8').replace(/^\uFEFF/,''));c.plugins.mixer={...(c.plugins.mixer||{}),enabled:true};c.plugins.crossfade={...(c.plugins.crossfade||{}),overlap:true};fs.writeFileSync(path,JSON.stringify(c,null,2))"
```

Launch with `--remote-debugging-port=9222` through PowerShell `Start-Process`.

- [ ] **Step 3: CDP assertions**

Script requirements (same WebSocket scaffold used for the mixer harness):

1. `window.__overlap.snapshot()` exists and reports `state: 'idle'`.
2. Seek YTM to `duration - 40` by setting `video.currentTime` (evaluate on the page) and wait: the
   snapshot reaches `arming` (next item cached).
3. Wait for `state: 'owned'`; assert `video.muted === true` and
   `Math.abs(getCurrentTime() - position) <= 1` within 3 s.
4. Pause via the player API; assert the active deck status is `paused` (snapshot stays `owned`);
   resume and assert it returns to `playing`.
5. Seek to a mid-track time; assert the snapshot position tracks `getCurrentTime()` within 1 s.
6. Click `.next-button`; assert `state: 'idle'` and `video.muted === false`.
7. With `plugins.mixer.enabled = false` (config + restart), repeat step 2 and assert the snapshot
   stays `idle` while the legacy fade still runs (YTM volume drops in the last seconds).

- [ ] **Step 4: By ear**

Load a queue, enable overlap, and listen across at least two boundaries: both songs must be audible
during the blend, the handoff must not click, and YTM's progress bar must keep advancing. This step
is for the user; record that the agent cannot perform it.

- [ ] **Step 5: Restore, final checks, commit**

Restore the config values you changed (keep `overlap` only if the user wants it on), relaunch
without CDP, then:

```bash
pnpm typecheck
pnpm test:unit
git add package.json
git commit -m "chore(crossfade): verify queue overlap end to end (0.1.19)"
```

---

## Self-Review Notes

- Spec coverage: ownership model (Tasks 3–5), muted clock + transport mirroring (Task 4), blend maths
  (Task 4), nav handoff + drift seek (Tasks 3–4), micro-sync + context watchdog + advance guard
  (Task 4), eviction lock (Task 1), settings (Task 6), mixer conflict (Tasks 4, 7), dev hook and
  live checks (Tasks 5, 8).
- Known simplification: the controller test harness injects frame stepping and clock; the live
  check covers real rAF audio ramps.
- Type consistency: `OverlapDeckId` is `'A' | 'B'` everywhere; `loadTrack` returns
  `Promise<string | undefined>` from Task 2 onward; pin channel name is
  `mixer:set-pinned-tracks` in Tasks 1, 4.
