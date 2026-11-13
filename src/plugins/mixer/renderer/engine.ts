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
