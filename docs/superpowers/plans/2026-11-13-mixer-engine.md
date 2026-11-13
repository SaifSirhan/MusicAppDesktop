# Mixer Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the UI-agnostic mixing engine: two Web Audio decks, transport with seek/tempo/volume, an equal-power crossfader, and waveform peak extraction — fully unit-tested without a browser AudioContext.

**Architecture:** `src/plugins/mixer/renderer/engine.ts` holds pure math (`crossfaderGains`, `clampTempo`, `deckPosition`), a pure deck reducer, the `Deck` class (one-shot `AudioBufferSourceNode`, gain -> crossfader gain), and `MixerEngine` (two decks -> crossfader gains -> master -> destination). The engine receives an `AudioContext` and imports no IPC, YTM, Electron or plugin code. `waveform.ts` holds pure peak downsampling. Unit tests drive the classes through a fake Web Audio graph, so `pnpm test:unit` (node env) needs no real audio device.

**Tech Stack:** TypeScript, Web Audio API types (DOM lib), vitest, SolidJS later (Plan 3 consumes this engine).

**Spec:** `docs/superpowers/specs/2026-11-13-mixing-engine-design.md`

## Global Constraints

- No new dependencies.
- TypeScript strict; `pnpm typecheck` must pass. Tests are not typechecked by `tsconfig.json` (pre-existing project config).
- Unit tests: `pnpm test:unit` (vitest, `tests/unit/**/*.test.ts`, node environment).
- Lint touched source files: `pnpm exec oxlint --type-aware <files>` — zero errors.
- `engine.ts` and `waveform.ts` import no Electron, IPC, YTM, plugin-loader or `@/` modules. Only DOM Web Audio types and local relative imports.
- Equal-power law exactly: `gainA = cos((p + 1) * PI / 4)`, `gainB = sin((p + 1) * PI / 4)`, `p` clamped to `[-1, 1]`.
- Tempo clamp exactly `[0.92, 1.08]`; non-finite input falls back to `1`.
- Crossfader and volume changes use `setTargetAtTime(value, ctx.currentTime, 0.01)` to avoid zipper noise.
- Deck source is one-shot: every play/seek-while-playing creates a new `AudioBufferSourceNode`.
- Commit locally after each task; never push or publish.
- Leave untracked `src/plugins/kestrel-bridge/` and its tests untouched.
- Mixer backend (Plan 1) is done; do not change `src/plugins/mixer/backend/*`, `types.ts` or `renderer/client.ts` in this plan.

---

### Task 1: Crossfader curve and tempo clamp

**Files:**
- Create: `src/plugins/mixer/renderer/engine.ts`
- Test: `tests/unit/mixer-engine-math.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `crossfaderGains(position: number): { a: number; b: number }`, `TEMPO_MIN` (`0.92`), `TEMPO_MAX` (`1.08`), `clampTempo(rate: number): number`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';

import {
  clampTempo,
  crossfaderGains,
} from '../../src/plugins/mixer/renderer/engine';

const close = (value: number, expected: number) =>
  expect(value).toBeCloseTo(expected, 6);

describe('crossfaderGains', () => {
  it('is equal-power at the ends and centre', () => {
    const left = crossfaderGains(-1);
    close(left.a, 1);
    close(left.b, 0);

    const centre = crossfaderGains(0);
    close(centre.a, Math.SQRT1_2);
    close(centre.b, Math.SQRT1_2);

    const right = crossfaderGains(1);
    close(right.a, 0);
    close(right.b, 1);
  });

  it('keeps constant power across the sweep', () => {
    for (const position of [-1, -0.5, 0, 0.5, 1]) {
      const { a, b } = crossfaderGains(position);
      close(a * a + b * b, 1);
    }
  });

  it('is monotonic and clamps out-of-range input', () => {
    expect(crossfaderGains(-0.5).a).toBeGreaterThan(crossfaderGains(0).a);
    expect(crossfaderGains(0.5).b).toBeGreaterThan(crossfaderGains(0).b);
    expect(crossfaderGains(-4)).toEqual(crossfaderGains(-1));
    expect(crossfaderGains(9)).toEqual(crossfaderGains(1));
    expect(crossfaderGains(Number.NaN)).toEqual(crossfaderGains(0));
  });
});

describe('clampTempo', () => {
  it('clamps to the allowed range', () => {
    expect(clampTempo(0.5)).toBe(0.92);
    expect(clampTempo(1.08)).toBe(1.08);
    expect(clampTempo(2)).toBe(1.08);
  });

  it('falls back to 1 for non-finite input', () => {
    expect(clampTempo(Number.NaN)).toBe(1);
    expect(clampTempo(Number.POSITIVE_INFINITY)).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/mixer-engine-math.test.ts`
Expected: FAIL — cannot resolve `src/plugins/mixer/renderer/engine`.

- [ ] **Step 3: Write the implementation**

Create `src/plugins/mixer/renderer/engine.ts` with exactly:

```ts
export const TEMPO_MIN = 0.92;
export const TEMPO_MAX = 1.08;

export const crossfaderGains = (
  position: number,
): { a: number; b: number } => {
  const clamped = Number.isFinite(position)
    ? Math.min(1, Math.max(-1, position))
    : 0;
  const angle = ((clamped + 1) * Math.PI) / 4;

  return { a: Math.cos(angle), b: Math.sin(angle) };
};

export const clampTempo = (rate: number): number => {
  if (!Number.isFinite(rate)) return 1;

  return Math.min(TEMPO_MAX, Math.max(TEMPO_MIN, rate));
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/mixer-engine-math.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Lint and commit**

```bash
pnpm exec oxlint --type-aware src/plugins/mixer/renderer/engine.ts
git add src/plugins/mixer/renderer/engine.ts tests/unit/mixer-engine-math.test.ts
git commit -m "feat(mixer): add equal-power crossfader math and tempo clamp"
```

---

### Task 2: Deck state reducer and position math

**Files:**
- Modify: `src/plugins/mixer/renderer/engine.ts`
- Test: `tests/unit/mixer-engine-state.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `DeckStatus = 'empty' | 'loading' | 'ready' | 'playing' | 'paused' | 'ended' | 'error'`
  - `DeckCore = { status: DeckStatus; duration: number; error: string | null }`
  - `initialDeckCore: DeckCore`
  - `DeckAction = { type: 'load-start' } | { type: 'load-ready'; duration: number } | { type: 'load-error'; message: string } | { type: 'play' } | { type: 'pause' } | { type: 'ended' } | { type: 'reset' }`
  - `deckReducer(state: DeckCore, action: DeckAction): DeckCore`
  - `deckPosition(offset: number, startedAt: number, rate: number, now: number, duration: number): number`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/mixer-engine-state.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  deckPosition,
  deckReducer,
  initialDeckCore,
} from '../../src/plugins/mixer/renderer/engine';

import type { DeckCore } from '../../src/plugins/mixer/renderer/engine';

const at = (status: DeckCore['status']): DeckCore => ({
  ...initialDeckCore,
  status,
  duration: status === 'empty' || status === 'loading' ? 0 : 200,
});

describe('deckReducer', () => {
  it('walks the full transport state machine', () => {
    let state = deckReducer(initialDeckCore, { type: 'load-start' });
    expect(state.status).toBe('loading');

    state = deckReducer(state, { type: 'load-ready', duration: 200 });
    expect(state).toEqual({ status: 'ready', duration: 200, error: null });

    state = deckReducer(state, { type: 'play' });
    expect(state.status).toBe('playing');

    state = deckReducer(state, { type: 'pause' });
    expect(state.status).toBe('paused');

    state = deckReducer(state, { type: 'play' });
    expect(state.status).toBe('playing');

    state = deckReducer(state, { type: 'ended' });
    expect(state.status).toBe('ended');

    state = deckReducer(state, { type: 'play' });
    expect(state.status).toBe('playing');

    expect(deckReducer(state, { type: 'reset' })).toEqual(initialDeckCore);
  });

  it('rejects transitions that are not in the machine', () => {
    const empty = at('empty');
    expect(deckReducer(empty, { type: 'play' })).toBe(empty);

    const ready = at('ready');
    expect(deckReducer(ready, { type: 'pause' })).toBe(ready);
    expect(deckReducer(ready, { type: 'load-ready', duration: 5 })).toBe(ready);
    expect(deckReducer(ready, { type: 'load-error', message: 'x' })).toBe(
      ready,
    );

    const paused = at('paused');
    expect(deckReducer(paused, { type: 'ended' })).toBe(paused);
  });

  it('records load errors and recovers through a new load', () => {
    const loading = deckReducer(initialDeckCore, { type: 'load-start' });
    const failed = deckReducer(loading, {
      type: 'load-error',
      message: 'NETWORK',
    });
    expect(failed).toEqual({
      status: 'error',
      duration: 0,
      error: 'NETWORK',
    });

    const retried = deckReducer(failed, { type: 'load-start' });
    expect(retried.status).toBe('loading');
    expect(retried.error).toBeNull();
  });
});

describe('deckPosition', () => {
  it('stays put when no time has elapsed', () => {
    expect(deckPosition(42, 99, 1, 99, 200)).toBe(42);
  });

  it('advances by elapsed time times rate', () => {
    expect(deckPosition(10, 5, 1.08, 10, 200)).toBeCloseTo(15.4, 6);
  });

  it('clamps to the track duration and ignores a negative clock', () => {
    expect(deckPosition(199, 0, 1, 50, 200)).toBe(200);
    expect(deckPosition(5, 10, 1, 4, 200)).toBe(5);
  });
});
```

`deckPosition` expresses elapsed-time arithmetic only. The `Deck` class keeps paused decks out of this path (its `position()` returns the stored offset unless the state is `playing`), so the no-elapsed case is the paused-equivalent contract.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/mixer-engine-state.test.ts`
Expected: FAIL — `deckReducer` and `deckPosition` are not exported.

- [ ] **Step 3: Append the implementation to `engine.ts`**

```ts
export type DeckStatus =
  | 'empty'
  | 'loading'
  | 'ready'
  | 'playing'
  | 'paused'
  | 'ended'
  | 'error';

export type DeckCore = {
  status: DeckStatus;
  duration: number;
  error: string | null;
};

export const initialDeckCore: DeckCore = {
  status: 'empty',
  duration: 0,
  error: null,
};

export type DeckAction =
  | { type: 'load-start' }
  | { type: 'load-ready'; duration: number }
  | { type: 'load-error'; message: string }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'ended' }
  | { type: 'reset' };

export const deckReducer = (
  state: DeckCore,
  action: DeckAction,
): DeckCore => {
  switch (action.type) {
    case 'load-start':
      return { status: 'loading', duration: 0, error: null };
    case 'load-ready':
      return state.status === 'loading'
        ? { status: 'ready', duration: action.duration, error: null }
        : state;
    case 'load-error':
      return state.status === 'loading'
        ? { status: 'error', duration: 0, error: action.message }
        : state;
    case 'play':
      return state.status === 'ready' ||
        state.status === 'paused' ||
        state.status === 'ended'
        ? { ...state, status: 'playing' }
        : state;
    case 'pause':
      return state.status === 'playing'
        ? { ...state, status: 'paused' }
        : state;
    case 'ended':
      return state.status === 'playing'
        ? { ...state, status: 'ended' }
        : state;
    case 'reset':
      return { ...initialDeckCore };
  }
};

export const deckPosition = (
  offset: number,
  startedAt: number,
  rate: number,
  now: number,
  duration: number,
): number => {
  const elapsed = Math.max(0, now - startedAt);
  const position = offset + (elapsed * rate);

  return Math.max(0, Math.min(duration, position));
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/mixer-engine-state.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Lint and commit**

```bash
pnpm exec oxlint --type-aware src/plugins/mixer/renderer/engine.ts
git add src/plugins/mixer/renderer/engine.ts tests/unit/mixer-engine-state.test.ts
git commit -m "feat(mixer): add deck reducer and position math"
```

---

### Task 3: Deck with fake Web Audio

**Files:**
- Create: `tests/unit/fake-audio.ts` (test helper)
- Modify: `src/plugins/mixer/renderer/engine.ts`
- Test: `tests/unit/mixer-engine-deck.test.ts`

**Interfaces:**
- Consumes: `DeckCore`, `deckReducer`, `deckPosition`, `clampTempo` from `engine.ts`.
- Produces: `Deck` class:
  - `constructor(ctx: AudioContext, output: AudioNode, id: 'A' | 'B')`
  - `readonly id: 'A' | 'B'`
  - `getCore(): DeckCore`
  - `getDuration(): number`
  - `getRate(): number`
  - `getVolume(): number`
  - `hasBuffer(): boolean`
  - `subscribe(listener: (core: DeckCore) => void): () => void`
  - `beginLoading(): void`
  - `load(buffer: AudioBuffer): void`
  - `failLoading(message: string): void`
  - `play(): Promise<void>`
  - `pause(): void`
  - `seek(seconds: number): void`
  - `cue(): void`
  - `setRate(rate: number): void`
  - `setVolume(volume: number): void`
  - `position(): number`
  - `dispose(): void`
- Produces test helper `tests/unit/fake-audio.ts`: `FakeParam`, `FakeNode`, `FakeGain`, `FakeSource`, `FakeContext`, `fakeBuffer(duration)`, `fakeParam(initial)`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/fake-audio.ts`:

```ts
export type FakeParam = {
  value: number;
  setValueAtTime: (value: number, time: number) => void;
  setTargetAtTime: (value: number, time: number, constant: number) => void;
};

export const fakeParam = (initial: number): FakeParam => {
  const param: FakeParam = {
    value: initial,
    setValueAtTime: (value: number, time: number) => {
      param.value = value;
    },
    setTargetAtTime: (value: number, time: number, constant: number) => {
      param.value = value;
    },
  };

  return param;
};

export class FakeNode {
  connected: FakeNode[] = [];

  connect(destination: FakeNode): FakeNode {
    this.connected.push(destination);

    return destination;
  }

  disconnect(): void {
    this.connected = [];
  }
}

export class FakeGain extends FakeNode {
  gain: FakeParam = fakeParam(1);
}

export class FakeSource extends FakeNode {
  buffer: AudioBuffer | null = null;
  playbackRate: FakeParam = fakeParam(1);
  onended: (() => void) | null = null;
  started: { offset: number } | null = null;
  stopped = false;

  start(_when = 0, offset = 0): void {
    this.started = { offset };
  }

  stop(): void {
    this.stopped = true;
  }
}

export class FakeContext {
  currentTime = 0;
  state = 'running';
  destination = new FakeNode();
  createdSources: FakeSource[] = [];
  createdGains: FakeGain[] = [];

  createGain(): FakeGain {
    const gain = new FakeGain();
    this.createdGains.push(gain);

    return gain;
  }

  createBufferSource(): FakeSource {
    const source = new FakeSource();
    this.createdSources.push(source);

    return source;
  }

  async resume(): Promise<void> {
    this.state = 'running';
  }

  async suspend(): Promise<void> {
    this.state = 'suspended';
  }

  async close(): Promise<void> {
    this.state = 'closed';
  }
}

export const fakeBuffer = (duration: number): AudioBuffer =>
  ({
    duration,
    getChannelData: () => new Float32Array(0),
  }) as unknown as AudioBuffer;
```

Create `tests/unit/mixer-engine-deck.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

import { Deck } from '../../src/plugins/mixer/renderer/engine';
import {
  fakeBuffer,
  FakeContext,
  FakeGain,
} from './fake-audio';

const setup = () => {
  const ctx = new FakeContext();
  const output = new FakeGain();
  const deck = new Deck(
    ctx as unknown as AudioContext,
    output as unknown as AudioNode,
    'A',
  );

  return { ctx, output, deck };
};

describe('Deck', () => {
  it('connects its gain to the output and loads a buffer', () => {
    const { ctx, output, deck } = setup();
    const deckGain = ctx.createdGains[0];
    expect(deckGain.connected).toContain(output);

    deck.beginLoading();
    expect(deck.getCore().status).toBe('loading');

    deck.load(fakeBuffer(200));
    expect(deck.getCore()).toEqual({
      status: 'ready',
      duration: 200,
      error: null,
    });
    expect(deck.hasBuffer()).toBe(true);
  });

  it('plays a one-shot source and advances the position', async () => {
    const { ctx, deck } = setup();
    deck.load(fakeBuffer(200));

    await deck.play();
    const source = ctx.createdSources[0];
    expect(source.buffer).not.toBeNull();
    expect(source.started).toEqual({ offset: 0 });
    expect(deck.getCore().status).toBe('playing');

    ctx.currentTime = 3;
    expect(deck.position()).toBeCloseTo(3, 6);
  });

  it('pauses at the current position and holds it', async () => {
    const { ctx, deck } = setup();
    deck.load(fakeBuffer(200));
    await deck.play();

    ctx.currentTime = 4;
    deck.pause();

    expect(deck.getCore().status).toBe('paused');
    expect(deck.position()).toBeCloseTo(4, 6);

    ctx.currentTime = 40;
    expect(deck.position()).toBeCloseTo(4, 6);
  });

  it('seek while playing recreates the source at the new offset', async () => {
    const { ctx, deck } = setup();
    deck.load(fakeBuffer(200));
    await deck.play();

    ctx.currentTime = 5;
    deck.seek(30);

    const first = ctx.createdSources[0];
    const second = ctx.createdSources[1];
    expect(first.stopped).toBe(true);
    expect(second.started).toEqual({ offset: 30 });

    ctx.currentTime = 7;
    expect(deck.position()).toBeCloseTo(32, 6);
  });

  it('applies tempo with clamping and rebases the position', async () => {
    const { ctx, deck } = setup();
    deck.load(fakeBuffer(200));
    await deck.play();

    ctx.currentTime = 10;
    deck.setRate(2);
    expect(deck.getRate()).toBe(1.08);
    expect(ctx.createdSources[0].playbackRate.value).toBe(1.08);

    ctx.currentTime = 20;
    expect(deck.position()).toBeCloseTo(20.8, 6);

    deck.setRate(0.5);
    expect(deck.getRate()).toBe(0.92);
  });

  it('marks the deck ended when the source ends and replays from zero', async () => {
    const { ctx, deck } = setup();
    deck.load(fakeBuffer(200));
    await deck.play();

    ctx.createdSources[0].onended?.();
    expect(deck.getCore().status).toBe('ended');
    expect(deck.position()).toBe(200);

    await deck.play();
    expect(deck.getCore().status).toBe('playing');
    expect(ctx.createdSources[1].started).toEqual({ offset: 0 });
  });

  it('clamps deck volume and pushes it to the gain', () => {
    const { ctx, deck } = setup();
    deck.setVolume(2);
    expect(deck.getVolume()).toBe(1);
    deck.setVolume(-1);
    expect(deck.getVolume()).toBe(0);
    expect(ctx.createdGains[0].gain.value).toBe(0);
  });

  it('drops the previous source when a new buffer loads', async () => {
    const { ctx, deck } = setup();
    deck.load(fakeBuffer(200));
    await deck.play();

    deck.load(fakeBuffer(120));
    expect(ctx.createdSources[0].stopped).toBe(true);
    expect(deck.getCore().duration).toBe(120);
    expect(deck.getCore().status).toBe('ready');
  });

  it('notifies subscribers of state changes until unsubscribed', () => {
    const { deck } = setup();
    const listener = vi.fn();
    const unsubscribe = deck.subscribe(listener);

    deck.beginLoading();
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    deck.load(fakeBuffer(200));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('disposes sources and resets to empty', async () => {
    const { ctx, deck } = setup();
    deck.load(fakeBuffer(200));
    await deck.play();

    deck.dispose();
    expect(ctx.createdSources[0].stopped).toBe(true);
    expect(deck.getCore().status).toBe('empty');
    expect(deck.hasBuffer()).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/mixer-engine-deck.test.ts`
Expected: FAIL — `Deck` is not exported.

- [ ] **Step 3: Append the implementation to `engine.ts`**

```ts
export type DeckId = 'A' | 'B';

type DeckListener = (core: DeckCore) => void;

export class Deck {
  readonly id: DeckId;

  private readonly ctx: AudioContext;
  private readonly gain: GainNode;
  private readonly listeners = new Set<DeckListener>();

  private core: DeckCore = { ...initialDeckCore };
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private startedAt = 0;
  private offset = 0;
  private rate = 1;
  private volume = 1;

  constructor(ctx: AudioContext, output: AudioNode, id: DeckId) {
    this.ctx = ctx;
    this.id = id;
    this.gain = ctx.createGain();
    this.gain.gain.value = 1;
    this.gain.connect(output);
  }

  getCore(): DeckCore {
    return this.core;
  }

  getDuration(): number {
    return this.buffer?.duration ?? 0;
  }

  getRate(): number {
    return this.rate;
  }

  getVolume(): number {
    return this.volume;
  }

  hasBuffer(): boolean {
    return this.buffer !== null;
  }

  subscribe(listener: DeckListener): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  beginLoading(): void {
    this.stopSource();
    this.buffer = null;
    this.offset = 0;
    this.dispatch({ type: 'load-start' });
  }

  load(buffer: AudioBuffer): void {
    this.stopSource();
    if (this.core.status !== 'loading') {
      this.dispatch({ type: 'load-start' });
    }
    this.buffer = buffer;
    this.offset = 0;
    this.dispatch({ type: 'load-ready', duration: buffer.duration });
  }

  failLoading(message: string): void {
    this.stopSource();
    this.buffer = null;
    this.offset = 0;
    this.dispatch({ type: 'load-error', message });
  }

  async play(): Promise<void> {
    const { status } = this.core;
    if (
      !this.buffer ||
      (status !== 'ready' && status !== 'paused' && status !== 'ended')
    ) {
      return;
    }

    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }

    if (status === 'ended') {
      this.offset = 0;
    }

    this.startSource();
    this.dispatch({ type: 'play' });
  }

  pause(): void {
    if (this.core.status !== 'playing') return;

    this.offset = this.position();
    this.stopSource();
    this.dispatch({ type: 'pause' });
  }

  seek(seconds: number): void {
    if (!this.buffer) return;

    const target = Math.max(0, Math.min(this.buffer.duration, seconds));
    const wasPlaying = this.core.status === 'playing';

    this.stopSource();
    this.offset = target;

    if (wasPlaying) {
      this.startSource();
    }
  }

  cue(): void {
    this.seek(0);
  }

  setRate(rate: number): void {
    if (this.core.status === 'playing') {
      this.offset = this.position();
      this.startedAt = this.ctx.currentTime;
    }

    this.rate = clampTempo(rate);

    if (this.source) {
      this.source.playbackRate.setValueAtTime(
        this.rate,
        this.ctx.currentTime,
      );
    }
  }

  setVolume(volume: number): void {
    const clamped = Number.isFinite(volume)
      ? Math.min(1, Math.max(0, volume))
      : 0;

    this.volume = clamped;
    this.gain.gain.setTargetAtTime(clamped, this.ctx.currentTime, 0.01);
  }

  position(): number {
    if (this.core.status !== 'playing') {
      return Math.min(this.offset, this.getDuration());
    }

    return deckPosition(
      this.offset,
      this.startedAt,
      this.rate,
      this.ctx.currentTime,
      this.getDuration(),
    );
  }

  dispose(): void {
    this.stopSource();
    this.buffer = null;
    this.offset = 0;
    this.gain.disconnect();
    this.listeners.clear();
    this.core = { ...initialDeckCore };
  }

  private startSource(): void {
    if (!this.buffer) return;

    this.stopSource();

    const source = this.ctx.createBufferSource();
    source.buffer = this.buffer;
    source.playbackRate.value = this.rate;
    source.connect(this.gain);
    source.onended = () => {
      if (this.source !== source) return;

      this.source = null;
      this.offset = this.buffer?.duration ?? 0;
      this.dispatch({ type: 'ended' });
    };

    this.startedAt = this.ctx.currentTime;
    this.source = source;
    source.start(0, this.offset);
  }

  private stopSource(): void {
    const source = this.source;
    if (!source) return;

    this.source = null;
    source.onended = null;
    try {
      source.stop();
    } catch {
      // A source that never started cannot be stopped; nothing to do.
    }
    source.disconnect();
  }

  private dispatch(action: DeckAction): void {
    const next = deckReducer(this.core, action);
    if (next === this.core) return;

    this.core = next;

    for (const listener of this.listeners) {
      listener(next);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/mixer-engine-deck.test.ts`
Expected: PASS (10 tests). Any failure about a missing fake member means the fake and the real Web Audio usage drifted — fix the fake to match the real API, not the engine.

- [ ] **Step 5: Lint and commit**

```bash
pnpm exec oxlint --type-aware src/plugins/mixer/renderer/engine.ts
git add src/plugins/mixer/renderer/engine.ts tests/unit/fake-audio.ts tests/unit/mixer-engine-deck.test.ts
git commit -m "feat(mixer): add Web Audio deck with transport and tempo"
```

---

### Task 4: MixerEngine graph, crossfader and lifecycle

**Files:**
- Modify: `src/plugins/mixer/renderer/engine.ts`
- Test: `tests/unit/mixer-engine.test.ts`

**Interfaces:**
- Consumes: `Deck`, `DeckId`, `crossfaderGains`, test helper from Task 3.
- Produces: `MixerEngine` class:
  - `constructor(context?: AudioContext)` — defaults to `new AudioContext()`
  - `readonly context: AudioContext`
  - `readonly decks: Record<DeckId, Deck>`
  - `getCrossfader(): number`
  - `setCrossfader(position: number): void`
  - `getMasterVolume(): number`
  - `setMasterVolume(volume: number): void`
  - `resume(): Promise<void>`
  - `close(): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/mixer-engine.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { MixerEngine } from '../../src/plugins/mixer/renderer/engine';
import { FakeContext } from './fake-audio';

const setup = () => {
  const ctx = new FakeContext();
  const engine = new MixerEngine(ctx as unknown as AudioContext);

  return { ctx, engine };
};

describe('MixerEngine', () => {
  it('wires decks through crossfader gains into the master', () => {
    const { ctx } = setup();
    const [master, xfadeA, xfadeB, deckA, deckB] = ctx.createdGains;

    expect(master.connected).toContain(ctx.destination);
    expect(xfadeA.connected).toContain(master);
    expect(xfadeB.connected).toContain(master);
    expect(deckA.connected).toContain(xfadeA);
    expect(deckB.connected).toContain(xfadeB);
  });

  it('starts centred with equal-power gains', () => {
    const { ctx } = setup();
    const [, xfadeA, xfadeB] = ctx.createdGains;

    expect(xfadeA.gain.value).toBeCloseTo(Math.SQRT1_2, 6);
    expect(xfadeB.gain.value).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it('applies and clamps the crossfader position', () => {
    const { ctx, engine } = setup();
    const [, xfadeA, xfadeB] = ctx.createdGains;

    engine.setCrossfader(-1);
    expect(engine.getCrossfader()).toBe(-1);
    expect(xfadeA.gain.value).toBeCloseTo(1, 6);
    expect(xfadeB.gain.value).toBeCloseTo(0, 6);

    engine.setCrossfader(5);
    expect(engine.getCrossfader()).toBe(1);
    expect(xfadeA.gain.value).toBeCloseTo(0, 6);
    expect(xfadeB.gain.value).toBeCloseTo(1, 6);

    engine.setCrossfader(Number.NaN);
    expect(engine.getCrossfader()).toBe(0);
  });

  it('clamps master volume', () => {
    const { ctx, engine } = setup();
    const [master] = ctx.createdGains;

    engine.setMasterVolume(3);
    expect(engine.getMasterVolume()).toBe(1);
    expect(master.gain.value).toBe(1);

    engine.setMasterVolume(-2);
    expect(engine.getMasterVolume()).toBe(0);
    expect(master.gain.value).toBe(0);
  });

  it('resumes a suspended context only when needed', async () => {
    const { ctx, engine } = setup();
    ctx.state = 'suspended';

    await engine.resume();
    expect(ctx.state).toBe('running');
  });

  it('stops both decks and closes the context', async () => {
    const { ctx, engine } = setup();
    engine.decks.A.load({
      duration: 10,
      getChannelData: () => new Float32Array(0),
    } as unknown as AudioBuffer);
    await engine.decks.A.play();

    await engine.close();
    expect(ctx.createdSources[0].stopped).toBe(true);
    expect(ctx.state).toBe('closed');
    expect(engine.decks.A.getCore().status).toBe('empty');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/mixer-engine.test.ts`
Expected: FAIL — `MixerEngine` is not exported.

- [ ] **Step 3: Append the implementation to `engine.ts`**

```ts
export class MixerEngine {
  readonly context: AudioContext;
  readonly decks: Record<DeckId, Deck>;

  private readonly master: GainNode;
  private readonly xfadeA: GainNode;
  private readonly xfadeB: GainNode;

  private crossfader = 0;
  private masterVolume = 1;

  constructor(context: AudioContext = new AudioContext()) {
    this.context = context;

    this.master = context.createGain();
    this.master.gain.value = 1;
    this.master.connect(context.destination);

    this.xfadeA = context.createGain();
    this.xfadeB = context.createGain();
    this.xfadeA.connect(this.master);
    this.xfadeB.connect(this.master);

    this.decks = {
      A: new Deck(context, this.xfadeA, 'A'),
      B: new Deck(context, this.xfadeB, 'B'),
    };

    const gains = crossfaderGains(this.crossfader);
    this.xfadeA.gain.value = gains.a;
    this.xfadeB.gain.value = gains.b;
  }

  getCrossfader(): number {
    return this.crossfader;
  }

  setCrossfader(position: number): void {
    this.crossfader = Number.isFinite(position)
      ? Math.min(1, Math.max(-1, position))
      : 0;

    const gains = crossfaderGains(this.crossfader);
    const now = this.context.currentTime;

    this.xfadeA.gain.setTargetAtTime(gains.a, now, 0.01);
    this.xfadeB.gain.setTargetAtTime(gains.b, now, 0.01);
  }

  getMasterVolume(): number {
    return this.masterVolume;
  }

  setMasterVolume(volume: number): void {
    this.masterVolume = Number.isFinite(volume)
      ? Math.min(1, Math.max(0, volume))
      : 0;

    this.master.gain.setTargetAtTime(
      this.masterVolume,
      this.context.currentTime,
      0.01,
    );
  }

  async resume(): Promise<void> {
    if (this.context.state === 'suspended') {
      await this.context.resume();
    }
  }

  async close(): Promise<void> {
    this.decks.A.dispose();
    this.decks.B.dispose();
    this.xfadeA.disconnect();
    this.xfadeB.disconnect();
    this.master.disconnect();
    await this.context.close();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/mixer-engine.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Lint and commit**

```bash
pnpm exec oxlint --type-aware src/plugins/mixer/renderer/engine.ts
git add src/plugins/mixer/renderer/engine.ts tests/unit/mixer-engine.test.ts
git commit -m "feat(mixer): add MixerEngine graph and crossfader"
```

---

### Task 5: Waveform peak extraction and final checks

**Files:**
- Create: `src/plugins/mixer/renderer/waveform.ts`
- Test: `tests/unit/mixer-waveform.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `computePeaks(samples: Float32Array, buckets: number): Float32Array` — per-bucket maximum absolute amplitude, length `max(1, floor(buckets))`, values clamped to `[0, 1]`. When `buckets` exceeds the sample count, adjacent buckets repeat the nearest sample's peak.
  - `bufferPeaks(buffer: AudioBuffer, buckets: number): Float32Array` — uses channel 0.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/mixer-waveform.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  bufferPeaks,
  computePeaks,
} from '../../src/plugins/mixer/renderer/waveform';

describe('computePeaks', () => {
  it('returns zeros for empty input', () => {
    expect(Array.from(computePeaks(new Float32Array(0), 4))).toEqual([
      0, 0, 0, 0,
    ]);
  });

  it('downsamples to the maximum absolute amplitude per bucket', () => {
    const samples = new Float32Array([0.5, -0.9, 0.1, 0.2]);
    const peaks = computePeaks(samples, 2);

    expect(peaks[0]).toBeCloseTo(0.9, 6);
    expect(peaks[1]).toBeCloseTo(0.2, 6);
  });

  it('handles more buckets than samples and clamps amplitude', () => {
    const samples = new Float32Array([2, -0.25]);
    const peaks = computePeaks(samples, 4);

    expect(peaks).toHaveLength(4);
    expect(peaks[0]).toBe(1);
    expect(peaks[1]).toBe(1);
    expect(peaks[2]).toBeCloseTo(0.25, 6);
    expect(peaks[3]).toBeCloseTo(0.25, 6);
  });

  it('always produces at least one bucket', () => {
    expect(computePeaks(new Float32Array([0.3]), 0)).toHaveLength(1);
    expect(computePeaks(new Float32Array([0.3]), -2)[0]).toBeCloseTo(0.3, 6);
  });
});

describe('bufferPeaks', () => {
  it('reads channel zero of an AudioBuffer', () => {
    const buffer = {
      duration: 1,
      getChannelData: () => new Float32Array([0.1, -0.6, 0.4, 0.2]),
    } as unknown as AudioBuffer;

    const peaks = bufferPeaks(buffer, 2);
    expect(peaks[0]).toBeCloseTo(0.6, 6);
    expect(peaks[1]).toBeCloseTo(0.4, 6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/mixer-waveform.test.ts`
Expected: FAIL — cannot resolve `src/plugins/mixer/renderer/waveform`.

- [ ] **Step 3: Write the implementation**

Create `src/plugins/mixer/renderer/waveform.ts`:

```ts
export const computePeaks = (
  samples: Float32Array,
  buckets: number,
): Float32Array => {
  const count = Math.max(1, Math.floor(Number.isFinite(buckets) ? buckets : 1));
  const peaks = new Float32Array(count);

  if (samples.length === 0) return peaks;

  const bucketSize = samples.length / count;

  for (let bucket = 0; bucket < count; bucket += 1) {
    const start = Math.floor(bucket * bucketSize);
    const end = Math.min(
      samples.length,
      Math.max(start + 1, Math.floor((bucket + 1) * bucketSize)),
    );

    let peak = 0;

    for (let index = start; index < end; index += 1) {
      const amplitude = Math.abs(samples[index]);
      if (amplitude > peak) peak = amplitude;
    }

    peaks[bucket] = Math.min(1, peak);
  }

  return peaks;
};

export const bufferPeaks = (
  buffer: AudioBuffer,
  buckets: number,
): Float32Array => computePeaks(buffer.getChannelData(0), buckets);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/mixer-waveform.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Run the full suite, typecheck, lint and commit**

```bash
pnpm test:unit
pnpm typecheck
pnpm exec oxlint --type-aware src/plugins/mixer/renderer/engine.ts src/plugins/mixer/renderer/waveform.ts
git add src/plugins/mixer/renderer/waveform.ts tests/unit/mixer-waveform.test.ts
git commit -m "feat(mixer): add waveform peak extraction"
```

Expected: every suite passes; typecheck exits 0; lint has no errors.

---

## Self-Review Notes

- Spec coverage for this plan: §3 decision 1 (Web Audio AudioBuffer decks), §6 engine details (graph, one-shot source, position tracking, equal-power crossfader, tempo clamp, volume, reducer state machine), §9 unit tests (crossfader, reducer/seek math, waveform peaks). UI, pre-cache, YTM lifecycle and E2E remain in Plans 3–5.
- No placeholders: every step has complete code or a concrete command.
- Type consistency: `DeckId` is introduced in Task 3 and reused by `MixerEngine.decks` in Task 4; `DeckCore`/`DeckAction` from Task 2 are what `Deck.dispatch` consumes; test helper members used by Task 4 (`createdGains`, `createdSources`, `FakeSource.stopped`) are all defined in Task 3.
- Known trap: `Deck.play()` calls `ctx.resume()`; the fake's `resume()` resolves immediately so tests do not hang.
- Out of scope for this plan (deliberate): connecting the engine to `mixer:read-track`, decodeAudioData, SolidJS panel, YTM mute/pause, pre-cache, CDP harness.
