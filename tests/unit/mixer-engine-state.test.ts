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
