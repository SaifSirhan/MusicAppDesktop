import { describe, expect, it, vi } from 'vitest';

import { fakeBuffer, FakeContext, FakeGain } from './fake-audio';

import { Deck } from '../../src/plugins/mixer/renderer/engine';
import {
  errorCopy,
  loadTrack,
  type MixerQueueItem,
} from '../../src/plugins/mixer/renderer/session';

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
  const readTrack = vi.fn(() => Promise.resolve(new ArrayBuffer(4)));
  const cacheTrack = vi.fn(() =>
    Promise.resolve({
      ok: true as const,
      track: { ...item, path: 'C:/cache/song.mp3', extension: 'mp3' },
    }),
  );
  const decode = vi.fn(() => Promise.resolve(fakeBuffer(200)));
  const removeTrack = vi.fn(() => Promise.resolve());
  const progress: unknown[] = [];

  return {
    deck,
    cacheTrack,
    readTrack,
    removeTrack,
    decode,
    progress,
    deps: {
      client: { cacheTrack, readTrack, removeTrack },
      decode,
      onProgress: (value: unknown) => progress.push(value),
    },
  };
};

describe('loadTrack', () => {
  it('caches, reads, decodes and installs the buffer', async () => {
    const { deck, deps, cacheTrack, readTrack, removeTrack, decode } = setup();

    await loadTrack(deps as never, deck, item);

    expect(cacheTrack).toHaveBeenCalledWith('dQw4w9WgXcQ');
    expect(readTrack).toHaveBeenCalledWith('C:/cache/song.mp3');
    expect(decode).toHaveBeenCalled();
    expect(removeTrack).not.toHaveBeenCalled();
    expect(deck.getCore()).toEqual({
      status: 'ready',
      duration: 200,
      error: null,
    });
    expect(deps.onProgress).toBeTypeOf('function');
  });

  it('clears the progress sink at the start and end of a load', async () => {
    const { deck, deps, progress } = setup();

    await loadTrack(deps as never, deck, item);

    // Real download progress arrives through client.onCacheProgress (the
    // panel subscribes); loadTrack only brackets the load with null markers.
    expect(progress[0]).toBeNull();
    expect(progress.at(-1)).toBeNull();
    expect(deck.getCore().status).toBe('ready');
  });

  it('reports read failures with the cache copy', async () => {
    const { deck, deps, readTrack } = setup();
    readTrack.mockRejectedValueOnce(new Error('ENOENT'));

    await loadTrack(deps as never, deck, item);

    expect(deck.getCore().status).toBe('error');
    expect(deck.getCore().error).toBe(errorCopy.NETWORK);
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

  it('invalidates the cached file when decode fails', async () => {
    const { deck, deps, decode, removeTrack } = setup();
    decode.mockRejectedValueOnce(new Error('EncodingError'));

    await loadTrack(deps as never, deck, item);

    // A short download converts into an undecodable file; leaving it cached
    // would make every retry fail on the same bytes.
    expect(removeTrack).toHaveBeenCalledWith('C:/cache/song.mp3');
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

    // The first load must be inside decode() before the second starts, or the
    // second would install its buffer first and the first would become the
    // later load. cacheTrack and readTrack each await one promise, so two
    // microtask hops are needed; a single hop lands before decode is called.
    const first = loadTrack(deps as never, deck, item);
    await Promise.resolve();
    await Promise.resolve();
    expect(deck.getCore().status).toBe('loading');
    const second = loadTrack(deps as never, deck, item);
    release(fakeBuffer(90));
    await Promise.all([first, second]);

    // The first decode resolves with 90 but its token is already superseded,
    // so the second load's fakeBuffer(200) is the one on the deck.
    expect(deck.getCore().duration).toBe(200);
  });
});
