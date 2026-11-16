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
    const armed = run(idle, [{ type: 'armed', deck: 'A', trackId: 'two' }]);
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
