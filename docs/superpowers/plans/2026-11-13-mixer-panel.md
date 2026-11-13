# Mixer Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the mixer usable and audible: a full-screen SolidJS panel with two deck cards (waveform, transport, tempo, volume), a crossfader, a YTM queue picker, and correct YTM pause/mute on open and restore on close.

**Architecture:** `renderer/session.ts` is the UI-agnostic glue (queue reading, load-with-progress, decode, pre-cache hook) and is unit-tested; `MixerPanel.tsx` renders it with SolidJS + solid-styled-components; `renderer/index.ts` owns mount/unmount and the YTM lifecycle (`<video>` pause + volume). `renderer/state.ts` exposes a dev-only `window.__mixer` debugging hook for Plan 4's E2E harness.

**Tech Stack:** SolidJS, solid-styled-components, existing `MixerClient` (Plan 1), `MixerEngine`/`Deck`/`peaks` (Plan 2), YTM `#queue` element types (`src/types/queue.ts`).

**Spec:** `docs/superpowers/specs/2026-11-13-mixing-engine-design.md` (§5 data flow, §7 UI, §8 errors, §9 verification)

## Global Constraints

- No new dependencies.
- TypeScript strict; `pnpm typecheck` must pass.
- Unit tests: `pnpm test:unit` (vitest, node env, `tests/unit/**/*.test.ts`).
- Lint touched source files: `pnpm exec oxlint --type-aware <files>` — zero errors.
- Never run `oxfmt --write` on files containing mixed arithmetic: it strips the parentheses `@stylistic/no-mixed-operators` requires.
- Solid components use `createSignal`/`createMemo`, never `useState`; `ref` for DOM handles; `onCleanup` for timers and listeners.
- Styling: solid-styled-components `css` + `cacheNoArgs`, colours from YTM CSS vars (`--ytmusic-*`, `--titlebar-background-color`) with literal fallbacks — no new theme system.
- `engine.ts` stays import-free and UI-free; the panel never reaches into private deck state.
- Mixer plugin `restartNeeded: true` stays; do not add a backend `stop`.
- Commit locally after each task; never push or publish.
- Leave untracked `src/plugins/kestrel-bridge/` and its tests untouched.

---

### Task 1: Pure queue mapping and time formatting

**Files:**
- Create: `src/plugins/mixer/renderer/session.ts`
- Test: `tests/unit/mixer-session.test.ts`

**Interfaces:**
- Consumes: nothing (types only, as `import type`).
- Produces:
  - `MixerQueueItem = { videoId: string; title: string; artist: string; duration: number; thumbnail?: string }`
  - `toQueueItems(items: readonly unknown[]): MixerQueueItem[]`
  - `formatTime(seconds: number): string`

`toQueueItems` accepts the raw YTM `QueueItem[]` shape (typed `unknown` here so the module stays free of DOM types) and:
- skips entries without `playlistPanelVideoRenderer` or without a `watchEndpoint.videoId`
- title from `renderer.title.runs[0].text`
- artist from the first `longBylineText.runs[*].text` whose text is not `' • '`, `'•'` or empty, falling back to `''`
- duration parsed from `lengthText.runs[0].text` (`mm:ss` or `h:mm:ss`), `0` when missing/unparsable
- thumbnail from the last entry in `thumbnail.thumbnails` (largest)
- de-duplicates by `videoId`, keeping the first occurrence

`formatTime` returns `m:ss` under an hour and `h:mm:ss` above, with `Math.max(0, Math.floor(seconds))`, and `0:00` for non-finite input.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/mixer-session.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  formatTime,
  toQueueItems,
} from '../../src/plugins/mixer/renderer/session';

const entry = (
  videoId: string,
  title: string,
  artist: string,
  length: string,
  thumb = 'https://img/small.jpg',
) => ({
  playlistPanelVideoRenderer: {
    title: { runs: [{ text: title }] },
    longBylineText: { runs: [{ text: artist }, { text: ' • ' }] },
    lengthText: { runs: [{ text: length }] },
    thumbnail: {
      thumbnails: [
        { url: thumb, width: 60, height: 60 },
        { url: 'https://img/large.jpg', width: 226, height: 226 },
      ],
    },
    navigationEndpoint: { watchEndpoint: { videoId } },
  },
});

describe('toQueueItems', () => {
  it('maps YTM queue entries to mixer entries', () => {
    const items = toQueueItems([entry('abc123', 'Song', 'Artist', '3:07')]);

    expect(items).toEqual([
      {
        videoId: 'abc123',
        title: 'Song',
        artist: 'Artist',
        duration: 187,
        thumbnail: 'https://img/large.jpg',
      },
    ]);
  });

  it('parses hour-long lengths', () => {
    expect(toQueueItems([entry('x1', 'Long', 'A', '1:02:03')])[0].duration).toBe(
      3723,
    );
  });

  it('skips unplayable entries and duplicates', () => {
    const items = toQueueItems([
      entry('dup', 'One', 'A', '1:00'),
      entry('dup', 'One again', 'A', '1:00'),
      { playlistPanelVideoRenderer: { title: { runs: [] } } },
      { somethingElse: true },
      entry('two', 'Two', 'B', '2:00'),
    ]);

    expect(items.map((item) => item.videoId)).toEqual(['dup', 'two']);
    expect(items[0].title).toBe('One');
  });

  it('survives missing artist, length and thumbnails', () => {
    const items = toQueueItems([
      {
        playlistPanelVideoRenderer: {
          title: { runs: [{ text: 'Bare' }] },
          navigationEndpoint: { watchEndpoint: { videoId: 'bare1' } },
        },
      },
    ]);

    expect(items[0]).toEqual({
      videoId: 'bare1',
      title: 'Bare',
      artist: '',
      duration: 0,
      thumbnail: undefined,
    });
  });

  it('returns an empty list for garbage input', () => {
    expect(toQueueItems([])).toEqual([]);
    expect(toQueueItems([null, 42, 'x'] as unknown[])).toEqual([]);
  });
});

describe('formatTime', () => {
  it('formats minutes and hours', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(7)).toBe('0:07');
    expect(formatTime(187)).toBe('3:07');
    expect(formatTime(3723)).toBe('1:02:03');
  });

  it('clamps invalid input', () => {
    expect(formatTime(-5)).toBe('0:00');
    expect(formatTime(Number.NaN)).toBe('0:00');
    expect(formatTime(59.9)).toBe('0:59');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/mixer-session.test.ts`
Expected: FAIL — cannot resolve `src/plugins/mixer/renderer/session`.

- [ ] **Step 3: Write the implementation**

Create `src/plugins/mixer/renderer/session.ts`:

```ts
export type MixerQueueItem = {
  videoId: string;
  title: string;
  artist: string;
  duration: number;
  thumbnail?: string;
};

type Runs = { runs?: { text?: string }[] };

type QueueRenderer = {
  title?: Runs;
  longBylineText?: Runs;
  lengthText?: Runs;
  thumbnail?: { thumbnails?: { url?: string }[] };
  navigationEndpoint?: { watchEndpoint?: { videoId?: string } };
};

const asObject = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;

const firstText = (runs: Runs | undefined): string =>
  runs?.runs?.find((run) => typeof run.text === 'string')?.text ?? '';

const parseLength = (runs: Runs | undefined): number => {
  const text = firstText(runs);
  const parts = text.split(':').map((part) => Number(part.trim()));
  if (parts.length < 2 || parts.some((part) => !Number.isFinite(part))) {
    return 0;
  }

  return parts.reduce((total, part) => (total * 60) + part, 0);
};

const isSeparator = (text: string): boolean => {
  const stripped = text.replace(/[•\u2022]/gu, '').trim();

  return stripped.length === 0;
};

const toItem = (value: unknown): MixerQueueItem | undefined => {
  const wrapper = asObject(value);
  const renderer = asObject(wrapper?.playlistPanelVideoRenderer) as
    | QueueRenderer
    | undefined;
  const videoId = renderer?.navigationEndpoint?.watchEndpoint?.videoId;
  if (!renderer || typeof videoId !== 'string' || videoId.length === 0) {
    return undefined;
  }

  const artist =
    renderer.longBylineText?.runs?.find(
      (run) => typeof run.text === 'string' && !isSeparator(run.text),
    )?.text ?? '';
  const thumbnails = renderer.thumbnail?.thumbnails ?? [];
  const largest = thumbnails.at(-1)?.url;

  return {
    videoId,
    title: firstText(renderer.title),
    artist,
    duration: parseLength(renderer.lengthText),
    thumbnail: typeof largest === 'string' ? largest : undefined,
  };
};

export const toQueueItems = (items: readonly unknown[]): MixerQueueItem[] => {
  const seen = new Set<string>();
  const result: MixerQueueItem[] = [];

  for (const value of items) {
    const item = toItem(value);
    if (!item || seen.has(item.videoId)) continue;

    seen.add(item.videoId);
    result.push(item);
  }

  return result;
};

export const formatTime = (seconds: number): string => {
  const total = Number.isFinite(seconds)
    ? Math.max(0, Math.floor(seconds))
    : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (value: number) => String(value).padStart(2, '0');

  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(secs)}`
    : `${minutes}:${pad(secs)}`;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/mixer-session.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Lint and commit**

```bash
pnpm exec oxlint --type-aware src/plugins/mixer/renderer/session.ts
git add src/plugins/mixer/renderer/session.ts tests/unit/mixer-session.test.ts
git commit -m "feat(mixer): add queue mapping and time formatting"
```

---

### Task 2: Load orchestration with latest-wins and progress

**Files:**
- Modify: `src/plugins/mixer/renderer/session.ts`
- Test: `tests/unit/mixer-load.test.ts`

**Interfaces:**
- Consumes: `MixerClient` from `../renderer/client` (type only), `Deck` from `./engine` (type only), `CacheProgress`/`CacheTrackResult` from `../types`, `MixerQueueItem` from Task 1.
- Produces:
  - `MixerErrorCopy: Record<MixerErrorCode, string>`-shaped object `errorCopy`
  - `progressLabel(progress: CacheProgress): string`
  - `loadTrack(deps, deck, item): Promise<void>` where
    ```ts
    type LoadDeps = {
      client: Pick<MixerClient, 'cacheTrack' | 'readTrack'>;
      decode: (data: ArrayBuffer) => Promise<AudioBuffer>;
      onProgress?: (progress: CacheProgress | null) => void;
    };
    ```
  - `loadTrack` returns nothing; it drives `deck.beginLoading()` / `deck.load(buffer, token)` / `deck.failLoading(message, token)` and never throws.

Behaviour: cache failure → `failLoading(errorCopy[code])`; decode failure → `failLoading('Could not decode this track.')`; a stale token (another load started) is silently dropped by the deck, and `loadTrack` stops forwarding progress once superseded.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/mixer-load.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

import { errorCopy, loadTrack } from '../../src/plugins/mixer/renderer/session';
import { Deck } from '../../src/plugins/mixer/renderer/engine';
import { fakeBuffer, FakeContext, FakeGain } from './fake-audio';

import type { MixerQueueItem } from '../../src/plugins/mixer/renderer/session';

const item: MixerQueueItem = {
  videoId: 'dQw4w9WgXcQ',
  title: 'Song',
  artist: 'Artist',
  duration: 200,
};

const setup = () => {
  const ctx = new FakeContext();
  const deck = new Deck(
    ctx as unknown as AudioContext,
    new FakeGain() as unknown as AudioNode,
    'A',
  );
  const readTrack = vi.fn(async () => new ArrayBuffer(4));
  const cacheTrack = vi.fn(async () => ({
    ok: true as const,
    track: { ...item, path: 'C:/cache/song.mp3', extension: 'mp3' },
  }));
  const decode = vi.fn(async () => fakeBuffer(200));
  const progress: unknown[] = [];

  return {
    deck,
    cacheTrack,
    readTrack,
    decode,
    progress,
    deps: {
      client: { cacheTrack, readTrack },
      decode,
      onProgress: (value: unknown) => progress.push(value),
    },
  };
};

describe('loadTrack', () => {
  it('caches, reads, decodes and installs the buffer', async () => {
    const { deck, deps, cacheTrack, readTrack, decode } = setup();

    await loadTrack(deps as never, deck, item);

    expect(cacheTrack).toHaveBeenCalledWith('dQw4w9WgXcQ');
    expect(readTrack).toHaveBeenCalledWith('C:/cache/song.mp3');
    expect(decode).toHaveBeenCalled();
    expect(deck.getCore()).toEqual({
      status: 'ready',
      duration: 200,
      error: null,
    });
    expect(deps.onProgress).toBeTypeOf('function');
  });

  it('forwards cache progress and clears it when finished', async () => {
    const { deck, deps, progress, cacheTrack } = setup();
    cacheTrack.mockImplementationOnce(async (videoId: string) => {
      deps.onProgress?.({
        videoId,
        phase: 'downloading',
        ratio: 0.4,
      } as never);

      return {
        ok: true as const,
        track: { ...item, path: 'p', extension: 'mp3' },
      };
    });

    await loadTrack(deps as never, deck, item);

    expect(progress[0]).toMatchObject({ phase: 'downloading', ratio: 0.4 });
    expect(progress.at(-1)).toBeNull();
  });

  it('maps cache failures to user copy', async () => {
    const { deck, deps, cacheTrack } = setup();
    cacheTrack.mockResolvedValueOnce({
      ok: false as const,
      code: 'PO_TOKEN',
      message: 'bot',
    } as never);

    await loadTrack(deps as never, deck, item);

    expect(deck.getCore().status).toBe('error');
    expect(deck.getCore().error).toBe(errorCopy.PO_TOKEN);
  });

  it('reports decode failures without throwing', async () => {
    const { deck, deps, decode } = setup();
    decode.mockRejectedValueOnce(new Error('EncodingError'));

    await expect(loadTrack(deps as never, deck, item)).resolves.toBeUndefined();
    expect(deck.getCore().error).toBe(
      'Could not decode this track. Try another one.',
    );
  });

  it('never overwrites a load that started later', async () => {
    const { deck, deps, decode } = setup();
    let release: (value: AudioBuffer) => void = () => {};
    decode.mockImplementationOnce(
      () =>
        new Promise<AudioBuffer>((resolve) => {
          release = resolve;
        }),
    );

    const first = loadTrack(deps as never, deck, item);
    await Promise.resolve();
    const second = loadTrack(deps as never, deck, item);
    release(fakeBuffer(90));
    await Promise.all([first, second]);

    expect(deck.getCore().duration).toBe(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/mixer-load.test.ts`
Expected: FAIL — `errorCopy` and `loadTrack` are not exported.

- [ ] **Step 3: Append the implementation to `session.ts`**

```ts
import type { MixerClient } from './client';
import type { Deck } from './engine';
import type { CacheProgress, MixerErrorCode } from '../types';

export const errorCopy: Record<MixerErrorCode, string> = {
  PO_TOKEN: 'YouTube asked for verification. Retry in a moment.',
  NETWORK: "Couldn't cache this track. Check your connection and retry.",
  UNPLAYABLE: "This track can't be played from YouTube Music.",
  WRITE: "Couldn't save the track. Check disk space and try again.",
};

const DECODE_ERROR = 'Could not decode this track. Try another one.';

export const progressLabel = (progress: CacheProgress): string => {
  const percent = (ratio: number) => `${Math.round(ratio * 100)}%`;

  switch (progress.phase) {
    case 'resolved':
      return `Found ${progress.metadata.title}`;
    case 'downloading':
      return `Downloading ${percent(progress.ratio)}`;
    case 'loading':
      return 'Loading from YouTube…';
    case 'preparing':
      return 'Preparing audio…';
    case 'converting':
      return `Converting ${percent(progress.ratio)}`;
    case 'saving':
      return 'Saving…';
    case 'tagging':
      return 'Tagging…';
  }
};

export type LoadDeps = {
  client: Pick<MixerClient, 'cacheTrack' | 'readTrack'>;
  decode: (data: ArrayBuffer) => Promise<AudioBuffer>;
  onProgress?: (progress: CacheProgress | null) => void;
};

export const loadTrack = async (
  deps: LoadDeps,
  deck: Deck,
  item: MixerQueueItem,
): Promise<void> => {
  const token = deck.beginLoading();
  const report = (progress: CacheProgress | null) => {
    if (deck.getLoadToken() !== token) return;

    try {
      deps.onProgress?.(progress);
    } catch {
      // A failing progress sink must not abort the load.
    }
  };

  try {
    report(null);

    const result = await deps.client.cacheTrack(item.videoId);
    if (!result.ok) {
      deck.failLoading(errorCopy[result.code] ?? errorCopy.NETWORK, token);

      return;
    }

    const data = await deps.client.readTrack(result.track.path);
    const buffer = await deps.decode(data);

    deck.load(buffer, token);
  } catch {
    deck.failLoading(DECODE_ERROR, token);
  } finally {
    report(null);
  }
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/mixer-load.test.ts`
Expected: PASS (5 tests).

If the "never overwrites a load that started later" test fails because both loads resolve in the wrong order, the deck's token gate is correct and the test's release ordering is wrong — fix the test ordering, not the deck.

- [ ] **Step 5: Lint and commit**

```bash
pnpm exec oxlint --type-aware src/plugins/mixer/renderer/session.ts
git add src/plugins/mixer/renderer/session.ts tests/unit/mixer-load.test.ts
git commit -m "feat(mixer): add latest-wins track loading with progress"
```

---

### Task 3: Progress subscription that never mixes cache events

**Files:**
- Modify: `src/plugins/mixer/renderer/session.ts`
- Test: `tests/unit/mixer-progress.test.ts`

**Interfaces:**
- Consumes: `CacheProgress` from `../types`, `MixerQueueItem` from Task 1.
- Produces: `subscribeProgress(ipc: Pick<RendererContext['ipc'], 'on' | 'removeAllListeners'>, handler: (progress: CacheProgress) => void): () => void` — a thin, testable adapter that ignores payloads whose `videoId` is not a string, and that stops delivering after unsubscribe.

Rationale: `MixerClient.onCacheProgress` already implements the single-subscriber contract with an `active` guard; this task makes the panel's own filtering testable in node, because the panel component itself is not unit-tested.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/mixer-progress.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

import { subscribeProgress } from '../../src/plugins/mixer/renderer/session';

const fakeIpc = () => {
  let listener: ((progress: unknown) => void) | undefined;

  return {
    on: vi.fn((_channel: string, fn: (progress: unknown) => void) => {
      listener = fn;
    }),
    removeAllListeners: vi.fn(),
    emit: (progress: unknown) => listener?.(progress),
  };
};

describe('subscribeProgress', () => {
  it('delivers typed cache progress payloads', () => {
    const ipc = fakeIpc();
    const handler = vi.fn();

    subscribeProgress(ipc as never, handler);
    ipc.emit({ videoId: 'abc', phase: 'downloading', ratio: 0.5 });

    expect(handler).toHaveBeenCalledWith({
      videoId: 'abc',
      phase: 'downloading',
      ratio: 0.5,
    });
  });

  it('drops payloads without a video id', () => {
    const ipc = fakeIpc();
    const handler = vi.fn();

    subscribeProgress(ipc as never, handler);
    ipc.emit({ phase: 'saving' });
    ipc.emit(null);
    ipc.emit('nope');

    expect(handler).not.toHaveBeenCalled();
  });

  it('stops delivering and releases the channel after unsubscribe', () => {
    const ipc = fakeIpc();
    const handler = vi.fn();

    const unsubscribe = subscribeProgress(ipc as never, handler);
    unsubscribe();
    ipc.emit({ videoId: 'abc', phase: 'saving' });

    expect(handler).not.toHaveBeenCalled();
    expect(ipc.removeAllListeners).toHaveBeenCalledWith('mixer:cache-progress');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/mixer-progress.test.ts`
Expected: FAIL — `subscribeProgress` is not exported.

- [ ] **Step 3: Append the implementation to `session.ts`**

```ts
type ProgressIpc = {
  on: (event: string, listener: (progress: CacheProgress) => void) => void;
  removeAllListeners: (event: string) => void;
};

const isCacheProgress = (value: unknown): value is CacheProgress =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { videoId?: unknown }).videoId === 'string';

export const subscribeProgress = (
  ipc: ProgressIpc,
  handler: (progress: CacheProgress) => void,
): (() => void) => {
  let active = true;
  ipc.on('mixer:cache-progress', (progress) => {
    if (!active || !isCacheProgress(progress)) return;

    handler(progress);
  });

  return () => {
    active = false;
    ipc.removeAllListeners('mixer:cache-progress');
  };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/mixer-progress.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Lint and commit**

```bash
pnpm exec oxlint --type-aware src/plugins/mixer/renderer/session.ts
git add src/plugins/mixer/renderer/session.ts tests/unit/mixer-progress.test.ts
git commit -m "feat(mixer): subscribe to cache progress safely"
```

---

### Task 4: Dev hook — `window.__mixer`

**Files:**
- Create: `src/plugins/mixer/renderer/state.ts`
- Test: `tests/unit/mixer-state.test.ts`

**Interfaces:**
- Consumes: `Deck`, `DeckId`, `MixerEngine` types from `./engine`.
- Produces:
  - `MixerSnapshot = { crossfader: number; masterVolume: number; decks: Record<DeckId, { status: string; duration: number; position: number; rate: number; volume: number }> }`
  - `toSnapshot(engine: Pick<MixerEngine, 'getCrossfader' | 'getMasterVolume' | 'decks'>): MixerSnapshot`
  - `installDevHook(engine): () => void` — sets `window.__mixer` to `{ snapshot }` and returns a cleanup that deletes it.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';

import { toSnapshot } from '../../src/plugins/mixer/renderer/state';
import { Deck } from '../../src/plugins/mixer/renderer/engine';
import { fakeBuffer, FakeContext, FakeGain } from './fake-audio';

const engine = (() => {
  const ctx = new FakeContext();
  const deck = (id: 'A' | 'B') =>
    new Deck(
      ctx as unknown as AudioContext,
      new FakeGain() as unknown as AudioNode,
      id,
    );

  return {
    ctx,
    engine: {
      getCrossfader: () => -0.25,
      getMasterVolume: () => 0.8,
      decks: { A: deck('A'), B: deck('B') },
    },
  };
})();

describe('toSnapshot', () => {
  it('reports transport state for both decks', async () => {
    engine.engine.decks.A.load(
      fakeBuffer(200),
      engine.engine.decks.A.beginLoading(),
    );
    await engine.engine.decks.A.play();
    engine.ctx.currentTime = 12;

    const snapshot = toSnapshot(engine.engine as never);

    expect(snapshot.crossfader).toBe(-0.25);
    expect(snapshot.masterVolume).toBe(0.8);
    expect(snapshot.decks.A).toEqual({
      status: 'playing',
      duration: 200,
      position: 12,
      rate: 1,
      volume: 1,
    });
    expect(snapshot.decks.B.status).toBe('empty');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/mixer-state.test.ts`
Expected: FAIL — cannot resolve `src/plugins/mixer/renderer/state`.

- [ ] **Step 3: Write the implementation**

```ts
import type { DeckId, MixerEngine } from './engine';

export type MixerSnapshot = {
  crossfader: number;
  masterVolume: number;
  decks: Record<
    DeckId,
    {
      status: string;
      duration: number;
      position: number;
      rate: number;
      volume: number;
    }
  >;
};

export const toSnapshot = (
  engine: Pick<MixerEngine, 'getCrossfader' | 'getMasterVolume' | 'decks'>,
): MixerSnapshot => ({
  crossfader: engine.getCrossfader(),
  masterVolume: engine.getMasterVolume(),
  decks: {
    A: {
      status: engine.decks.A.getCore().status,
      duration: engine.decks.A.getDuration(),
      position: engine.decks.A.position(),
      rate: engine.decks.A.getRate(),
      volume: engine.decks.A.getVolume(),
    },
    B: {
      status: engine.decks.B.getCore().status,
      duration: engine.decks.B.getDuration(),
      position: engine.decks.B.position(),
      rate: engine.decks.B.getRate(),
      volume: engine.decks.B.getVolume(),
    },
  },
});

export const installDevHook = (
  engine: Pick<MixerEngine, 'getCrossfader' | 'getMasterVolume' | 'decks'>,
): (() => void) => {
  const hook = { snapshot: () => toSnapshot(engine) };
  (window as unknown as { __mixer?: typeof hook }).__mixer = hook;

  return () => {
    delete (window as unknown as { __mixer?: typeof hook }).__mixer;
  };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/mixer-state.test.ts`
Expected: PASS (1 test).

If `window` is undefined in the node test, only `toSnapshot` is exercised — do not add a `window` shim; keep `installDevHook` untested rather than mocking globals.

- [ ] **Step 5: Lint and commit**

```bash
pnpm exec oxlint --type-aware src/plugins/mixer/renderer/state.ts
git add src/plugins/mixer/renderer/state.ts tests/unit/mixer-state.test.ts
git commit -m "feat(mixer): expose engine snapshot for debugging"
```

---

### Task 5: Waveform bar sampling

**Files:**
- Modify: `src/plugins/mixer/renderer/waveform.ts`
- Test: `tests/unit/mixer-waveform-draw.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `barsFromPeaks(peaks: Float32Array, columns: number): number[]` — one height per pixel column in `[0, 1]`, sampling `peaks` by floor ratio; `[]` for an empty buffer or zero/negative/non-finite width.

The Solid canvas component that consumes this lands with the panel in Task 7. This task is pure so it can be tested in node; the `.tsx` files are not unit-tested because `vitest.config.ts` only includes `*.test.ts` in a node environment with no Solid/JSX transform.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/mixer-waveform-draw.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { barsFromPeaks } from '../../src/plugins/mixer/renderer/waveform';

describe('barsFromPeaks', () => {
  it('returns one value per column', () => {
    const bars = barsFromPeaks(new Float32Array([0.2, 0.4, 0.6, 0.8]), 4);

    expect(bars[0]).toBeCloseTo(0.2, 6);
    expect(bars[1]).toBeCloseTo(0.4, 6);
    expect(bars[2]).toBeCloseTo(0.6, 6);
    expect(bars[3]).toBeCloseTo(0.8, 6);
  });

  it('downsamples and upsamples without leaving [0, 1]', () => {
    const bars = barsFromPeaks(new Float32Array([0, 0.5, 1]), 6);

    expect(bars).toHaveLength(6);
    for (const bar of bars) {
      expect(bar).toBeGreaterThanOrEqual(0);
      expect(bar).toBeLessThanOrEqual(1);
    }
    expect(bars[0]).toBe(0);
    expect(bars.at(-1)).toBe(1);
  });

  it('returns an empty list for an empty buffer or non-positive width', () => {
    expect(barsFromPeaks(new Float32Array(0), 10)).toEqual([]);
    expect(barsFromPeaks(new Float32Array([0.5]), 0)).toEqual([]);
    expect(barsFromPeaks(new Float32Array([0.5]), Number.NaN)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/mixer-waveform-draw.test.ts`
Expected: FAIL — `barsFromPeaks` is not exported.

- [ ] **Step 3: Append the implementation to `waveform.ts`**

```ts
export const barsFromPeaks = (
  peaks: Float32Array,
  columns: number,
): number[] => {
  const width = Math.floor(Number.isFinite(columns) ? columns : 0);
  if (peaks.length === 0 || width <= 0) return [];

  const bars: number[] = [];

  for (let column = 0; column < width; column += 1) {
    const index = Math.min(
      peaks.length - 1,
      Math.floor((column / width) * peaks.length),
    );
    bars.push(Math.min(1, Math.max(0, peaks[index])));
  }

  return bars;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/mixer-waveform-draw.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Lint and commit**

```bash
pnpm exec oxlint --type-aware src/plugins/mixer/renderer/waveform.ts
git add src/plugins/mixer/renderer/waveform.ts tests/unit/mixer-waveform-draw.test.ts
git commit -m "feat(mixer): add waveform bar sampling"
```

---

### Task 6: Waveform canvas component

**Files:**
- Create: `src/plugins/mixer/renderer/Waveform.tsx`

**Interfaces:**
- Consumes: `barsFromPeaks` (Task 5).
- Produces: `Waveform(props: { peaks: Float32Array; position: number; duration: number; onSeek: (seconds: number) => void })` — a `<canvas>` filling its container, centre-out bars with the played portion tinted, a playhead line, click-to-seek and ArrowLeft/ArrowRight ±5 s.

Not unit-tested (node vitest has no DOM); verified live in Task 9. Keep every DOM access nullable-guarded.

**Requirements:**
- aspect: `display: block; width: 100%; height: 72px`, `cursor: pointer`, rounded corners, background `color-mix(in srgb, var(--titlebar-background-color, #030303) 60%, transparent)`
- draw at device pixel ratio (`window.devicePixelRatio || 1`), recompute size when `clientWidth` changes
- `ResizeObserver` on the canvas, disconnected in `onCleanup`
- `createEffect` redraws when `props.peaks`, `props.position` or `props.duration` change
- `role="slider"`, `tabindex="0"`, `aria-label="Track waveform, click to seek"`, `aria-valuemin="0"`, `aria-valuemax={props.duration}`, `aria-valuenow={props.position}`
- click maps `clientX` to seconds clamped to `[0, duration]`

- [ ] **Step 1: Write `Waveform.tsx`** per the requirements, importing `barsFromPeaks` from `./waveform` and `cacheNoArgs` from `@/providers/decorators`.

- [ ] **Step 2: Lint and typecheck**

```bash
pnpm exec oxlint --type-aware src/plugins/mixer/renderer/Waveform.tsx
pnpm tsc -p tsconfig.json --noEmit
```

If `perfectionist/sort-jsx-props` demands a different attribute order, reorder JSX props only.

- [ ] **Step 3: Commit**

```bash
git add src/plugins/mixer/renderer/Waveform.tsx
git commit -m "feat(mixer): add waveform canvas component"
```

---

### Task 7: Deck card and mixer panel UI

**Files:**
- Create: `src/plugins/mixer/renderer/DeckCard.tsx`
- Create: `src/plugins/mixer/renderer/MixerPanel.tsx`

**Interfaces:**
- Consumes: `Deck`, `DeckCore`, `DeckId`, `TEMPO_MIN`, `TEMPO_MAX`, `MixerEngine` from `./engine`; `bufferPeaks` from `./waveform`; `MixerQueueItem`, `formatTime`, `progressLabel`, `loadTrack`, `errorCopy` from `./session`; `CacheProgress` from `../types`; `MixerClient` from `./client`; `Waveform` (Task 6).
- Produces:
  ```ts
  DeckCard(props: {
    id: DeckId;
    deck: Deck;
    item?: MixerQueueItem;
    peaks: Float32Array;
    progress: CacheProgress | null;
    position: number;
    onLoad: () => void;
    onRetry: () => void;
  })

  MixerPanel(props: {
    client: Pick<MixerClient, 'cacheTrack' | 'readTrack'>;
    engine: MixerEngine;
    items: MixerQueueItem[];
    onRefreshQueue: () => void;
    savedVolume: number;
    onClose: () => void;
  })
  ```

Deck requirements: header (48 px thumbnail, title, artist, `Load A`/`Load B` → `Loading…` → `Loaded`), `<Waveform>` with `onSeek={(s) => props.deck.seek(s)}`, transport row (play/pause, cue, `formatTime(position) / formatTime(duration)`), tempo slider `0.92…1.08 step 0.01` showing `+x%`/`-x%` with double-click reset, deck volume slider `0…1 step 0.01`, loading state (spinner + `progressLabel(progress)` or `Starting…`, transport disabled), error state (message + `Retry`). Every icon-only control has `aria-label`; when `deck.play()` resolves `false`, show "Click play again to start audio."

Panel requirements: fixed full-screen overlay `inset: 0; z-index: 10000010`, close button top-right (`aria-label="Close mixer"`), deck cards side by side (column below 900 px), crossfader `<input type="range" min="-1" max="1" step="0.01">` wired with `onInput` to `engine.setCrossfader`, value label `A`/`Centre`/`B`, master volume slider wired to `engine.setMasterVolume`, queue list with `A`/`B` buttons per row and duration, empty state "Play something in YouTube Music to see its queue here.", "Refresh queue" button calling `props.onRefreshQueue`, Esc closes.

Load flow inside the panel: per-deck `createSignal<CacheProgress | null>` for progress and `createSignal<Float32Array>` for peaks; `decode` wraps `engine.context.decodeAudioData(data.slice(0))` and stores `bufferPeaks(buffer, 900)` before resolving; deck loads go through `loadTrack({ client, decode, onProgress }, deck, item)`.

- [ ] **Step 1: Write `DeckCard.tsx`.**
- [ ] **Step 2: Write `MixerPanel.tsx`.**
- [ ] **Step 3: Lint and typecheck**

```bash
pnpm exec oxlint --type-aware src/plugins/mixer/renderer/DeckCard.tsx src/plugins/mixer/renderer/MixerPanel.tsx
pnpm tsc -p tsconfig.json --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/plugins/mixer/renderer/DeckCard.tsx src/plugins/mixer/renderer/MixerPanel.tsx
git commit -m "feat(mixer): add deck cards and mixer panel"
```

---

### Task 8: Plugin renderer lifecycle, YTM handoff and entry points

**Files:**
- Create: `src/plugins/mixer/renderer/index.ts`
- Modify: `src/plugins/mixer/index.ts`
- Modify: `src/i18n/resources/en.json`

**Interfaces:**
- Consumes: `MixerPanel` (Task 7), `MixerEngine` (Plan 2), `createMixerClient` (Plan 1), `installDevHook` (Task 4).
- Produces: `openMixer()` / `closeMixer()` / `toggleMixer()` exported for the menu, plus a `renderer.onPlayerApiReady` mount that injects a "Mixer" title-bar button next to the settings gear.

Requirements:
- `openMixer()` (idempotent): create `new MixerEngine()`; `await engine.resume()`; capture `{ paused: video.paused, volume: video.volume }` from `document.querySelector('video')`, then `video.pause()` and `video.volume = 0`; read the queue once via `document.querySelector<QueueElement>('#queue')?.queue.getItems()` → `toQueueItems`; `render(() => <MixerPanel … />, host)` into a host `<div>` appended to `document.body`; `installDevHook(engine)`; if `engine.resume()` returned `false`, render the panel with `audioBlocked` so it shows "Click play to start audio."
- `closeMixer()` (idempotent): `dispose()` the panel, `installDevHook` cleanup, `await engine.close()`, restore `video.volume` and (only if it was playing) `video.play()`, remove the host element, clear the engine
- `toggleMixer()`: exported on `window` as `__mixerToggle` for the CDP harness **and** bound to the injected title-bar button
- title-bar entry: in `onPlayerApiReady`, insert a button after the existing settings gear (`document.querySelector('[aria-label="Settings"]')?.parentElement`) with `aria-label="Mixer"`, text `Mixer`; if the gear is missing, fall back to appending to `ytmusic-player-bar` — log and skip if neither exists
- Esc closes the panel (document `keydown` listener added on open, removed on close)
- `src/plugins/mixer/index.ts` gains `renderer: { start, onPlayerApiReady, onConfigChange }`, keeps `backend.start` and `restartNeeded: true`; `onConfigChange` closes the panel when the plugin is disabled
- no main-process menu item in this plan (title-bar button only) — Plan 4 adds the View menu entry with its own `mixer:toggle` channel
- `en.json` gains `"mixer": { "panel": { "close": "Close mixer" }, "title": "Mixer" }` nested under the existing `plugins.mixer` object, keeping keys alphabetical

This task is verified live in Task 9 (build + CDP + by ear).

- [ ] **Step 1: Write `renderer/index.ts`** per the requirements, keeping every DOM access nullable-guarded.

- [ ] **Step 2: Wire the plugin definition** (`createPlugin` renderer block).

- [ ] **Step 3: Add i18n keys.**

- [ ] **Step 4: Lint, typecheck, full suite, production build**

```bash
pnpm exec oxlint --type-aware src/plugins/mixer/renderer/index.ts src/plugins/mixer/index.ts src/plugins/mixer/renderer/MixerPanel.tsx src/plugins/mixer/renderer/DeckCard.tsx src/plugins/mixer/renderer/Waveform.tsx
pnpm tsc -p tsconfig.json --noEmit
pnpm test:unit
pnpm build
```

`pnpm build` must succeed before Task 9 installs anything: a bundle error here is cheaper than a failed install.

- [ ] **Step 5: Commit**

```bash
git add src/plugins/mixer/renderer/index.ts src/plugins/mixer/index.ts src/i18n/resources/en.json
git commit -m "feat(mixer): open and close the mixer with YTM handoff"
```

---

### Task 9: Live verification in the app

**Files:**
- Modify: `package.json` (version `0.1.17`)
- Create (temporary, not committed): `%TEMP%/cdp-mixer-panel.mjs`

**Interfaces:**
- Consumes: the built plugin from Tasks 1–8.
- Produces: evidence that the panel opens, both decks play, the crossfader moves gains, YTM is paused/muted and restored.

- [ ] **Step 1: Build and install**

```bash
cd /c/Users/USER/AndroidStudioProjects/MusicAppDesktop
node -e "const fs=require('fs');const p=require('./package.json');p.version='0.1.17';fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\n')"
pnpm dist:win
taskkill //IM MusicApp.exe //F || true
MSYS_NO_PATHCONV=1 "./pack/MusicApp-Desktop.exe" /S
```

- [ ] **Step 2: Enable the mixer and launch with CDP**

```bash
cd "$APPDATA/MusicApp"
node -e "const fs=require('fs');const c=JSON.parse(fs.readFileSync('config.json','utf8').replace(/^\uFEFF/,''));c.plugins.mixer={...(c.plugins.mixer||{}),enabled:true};fs.writeFileSync('config.json',JSON.stringify(c,null,2));console.log('mixer enabled')"
cd /c/Users/USER/AppData/Local/Programs/MusicApp
./MusicApp.exe --remote-debugging-port=9222 >/dev/null 2>&1 &
```

- [ ] **Step 3: Run the CDP checks**

Script (same WebSocket evaluate scaffold as the Plan 1 script), asserting:
1. Preserve YTM state: `const before = { volume: video.volume, paused: video.paused }`; then `document.querySelector('[aria-label="Mixer"]').click()` (fallback `window.__mixerToggle()`); after open, `video.paused === true` and `video.volume === 0`.
2. `window.__mixer.snapshot()` exists and returns `crossfader: 0`; the panel root element is in the DOM.
3. `await window.ipcRenderer.invoke('mixer:cache-track', '28jp-30w8Lg')` and a second id (e.g. `'dQw4w9WgXcQ'`); then click the picker's `A` button for the first item and `B` for the second; assert both decks reach `ready` within 120 s (poll `snapshot()`), then click each deck's play button and assert `status === 'playing'`.
4. `snapshot().decks.A.position` increases between two samples 1 s apart.
5. Set the crossfader input's value to `-1`, dispatch `input`, and assert `snapshot().crossfader === -1`; repeat with `1`.
6. Click close; assert `window.__mixer` is `undefined`, the panel root is gone, and `video.volume === before.volume`.

- [ ] **Step 4: Confirm by ear**

With two cached tracks loaded, drag the crossfader slowly: both tracks must be audible at the centre and only one at each end, with no clicks at play/pause/seek. If audio is inaudible, first check `snapshot().decks.*.status` and `masterVolume` before assuming an engine fault.

- [ ] **Step 5: Restore state, final checks, commit**

```bash
taskkill //IM MusicApp.exe //F || true
cd "$APPDATA/MusicApp"
node -e "const fs=require('fs');const c=JSON.parse(fs.readFileSync('config.json','utf8').replace(/^\uFEFF/,''));c.plugins.mixer={...(c.plugins.mixer||{}),enabled:false};fs.writeFileSync('config.json',JSON.stringify(c,null,2))"
cd /c/Users/USER/AppData/Local/Programs/MusicApp
./MusicApp.exe >/dev/null 2>&1 &
cd /c/Users/USER/AndroidStudioProjects/MusicAppDesktop
pnpm typecheck
pnpm test:unit
git add package.json
git commit -m "chore(mixer): verify panel end to end (0.1.17)"
```

---

## Self-Review Notes

- Spec coverage: §5 steps 1–7 (open, queue read, load with progress, decode, play, crossfade, close/restore), §7 (deck card, waveform, transport, tempo, volume, crossfader, picker, a11y, copy), §8 (typed errors, decode failure, latest-wins, suspended context), §9 (dev hook `window.__mixer`, live assertions).
- Deferred to Plan 4: auto pre-cache of the next queue entry, the main-process View → Mixer menu item, committed WAV fixtures and a permanent CDP harness.
- No placeholders: every step names exact files, exact signatures and exact commands.
- Type consistency: `MixerQueueItem` (Task 1) → `loadTrack` (Task 2) → `DeckCard`/`MixerPanel` (Task 7); `barsFromPeaks` (Task 5) feeds `Waveform` (Task 6); `bufferPeaks` (Plan 2) produces the `peaks` the panel stores; `Deck.beginLoading()` returns the token that `Deck.load(buffer, token)` requires (Plan 2 final API).
- Testing boundary, stated deliberately: pure/session logic is unit-tested in node (Tasks 1–5); `.tsx` components and the YTM handoff are verified live in Task 9, because `vitest.config.ts` includes only `*.test.ts` in a node environment without a JSX/DOM setup.
