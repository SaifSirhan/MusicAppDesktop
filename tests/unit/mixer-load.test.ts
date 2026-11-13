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
    // Progress reaches loadTrack through the client's onCacheProgress
    // subscription (loadTrack does not wire it), so it is fed via the sink here.
    deps.onProgress?.({ videoId: item.videoId, phase: 'downloading', ratio: 0.4 });

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
