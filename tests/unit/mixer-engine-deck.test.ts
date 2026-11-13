import { describe, expect, it, vi } from 'vitest';

import { fakeBuffer, FakeContext, FakeGain } from './fake-audio';

import { Deck } from '../../src/plugins/mixer/renderer/engine';

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

    deck.beginLoading();

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
    deck.beginLoading();
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
    deck.beginLoading();
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
    deck.beginLoading();
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
    deck.beginLoading();
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
    deck.beginLoading();
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
    deck.beginLoading();
    deck.load(fakeBuffer(200));
    await deck.play();

    deck.beginLoading();

    deck.load(fakeBuffer(120));
    expect(ctx.createdSources[0].stopped).toBe(true);
    expect(deck.getCore().duration).toBe(120);
    expect(deck.getCore().status).toBe('ready');
  });

  it('ignores a buffer that arrives after a newer load started', () => {
    const { ctx, deck } = setup();
    deck.beginLoading();
    const stale = deck.getLoadToken();
    deck.beginLoading();

    deck.load(fakeBuffer(200), stale);
    expect(deck.getCore().status).toBe('loading');
    expect(deck.hasBuffer()).toBe(false);
    expect(ctx.createdSources).toHaveLength(0);

    deck.load(fakeBuffer(90), deck.getLoadToken());
    expect(deck.getCore()).toEqual({
      status: 'ready',
      duration: 90,
      error: null,
    });
  });

  it('ignores loads and failures outside the loading state', async () => {
    const { deck } = setup();
    deck.beginLoading();
    deck.load(fakeBuffer(200));

    deck.load(fakeBuffer(10));
    expect(deck.getCore().duration).toBe(200);

    deck.failLoading('NETWORK');
    expect(deck.getCore().status).toBe('ready');
    expect(deck.getCore().error).toBeNull();

    await deck.play();
    deck.beginLoading();
    deck.load(fakeBuffer(50));
    expect(deck.getCore().status).toBe('ready');
    expect(deck.getCore().duration).toBe(50);
  });

  it('notifies subscribers of state changes until unsubscribed', () => {
    const { deck } = setup();
    const listener = vi.fn();
    const unsubscribe = deck.subscribe(listener);

    deck.beginLoading();
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    deck.beginLoading();
    deck.load(fakeBuffer(200));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('disposes sources and resets to empty', async () => {
    const { ctx, deck } = setup();
    deck.beginLoading();
    deck.load(fakeBuffer(200));
    await deck.play();

    deck.dispose();
    expect(ctx.createdSources[0].stopped).toBe(true);
    expect(deck.getCore().status).toBe('empty');
    expect(deck.hasBuffer()).toBe(false);
  });
});
