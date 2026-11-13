export const TEMPO_MIN = 0.92;
export const TEMPO_MAX = 1.08;

export const crossfaderGains = (position: number): { a: number; b: number } => {
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
      this.source.playbackRate.setValueAtTime(this.rate, this.ctx.currentTime);
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
