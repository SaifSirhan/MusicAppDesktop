import { describe, expect, it } from 'vitest';

import { FakeContext } from './fake-audio';

import { MixerEngine } from '../../src/plugins/mixer/renderer/engine';

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
    engine.decks.A.beginLoading();
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
