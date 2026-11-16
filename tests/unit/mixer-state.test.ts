import { describe, expect, it } from 'vitest';

import { fakeBuffer, FakeContext, FakeGain } from './fake-audio';

import { Deck } from '../../src/plugins/mixer/renderer/engine';
import { toSnapshot } from '../../src/plugins/mixer/renderer/state';

const setup = () => {
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
};

describe('toSnapshot', () => {
  it('reports transport state for both decks', async () => {
    const { ctx, engine } = setup();
    engine.decks.A.load(fakeBuffer(200), engine.decks.A.beginLoading());
    await engine.decks.A.play();
    ctx.currentTime = 12;

    const snapshot = toSnapshot(engine as never);

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
    expect(snapshot.decks.B.duration).toBe(0);
  });
});
