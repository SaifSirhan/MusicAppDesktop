import { afterEach, describe, expect, it, vi } from 'vitest';

import { fakeBuffer, FakeContext } from './fake-audio';

import { createOverlapController } from '../../src/plugins/crossfade/overlap';
import { MixerEngine } from '../../src/plugins/mixer/renderer/engine';

import type { MixerQueueItem } from '../../src/plugins/mixer/renderer/session';

type FakeVideo = {
  currentTime: number;
  duration: number;
  muted: boolean;
  paused: boolean;
  playbackRate: number;
  volume: number;
  addEventListener: (event: string, fn: () => void) => void;
  removeEventListener: (event: string, fn: () => void) => void;
  play: () => Promise<void>;
  pause: () => void;
  emit: (event: string) => void;
};

const video = (): FakeVideo => {
  const listeners = new Map<string, Set<() => void>>();
  const element: FakeVideo = {
    currentTime: 0,
    duration: 200,
    muted: false,
    paused: false,
    playbackRate: 1,
    volume: 0.8,
    addEventListener: (event, fn) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(fn);
    },
    removeEventListener: (event, fn) => listeners.get(event)?.delete(fn),
    play: () => {
      element.paused = false;

      return Promise.resolve();
    },
    pause: () => {
      element.paused = true;
    },
    emit: (event) => {
      for (const fn of listeners.get(event) ?? []) fn();
    },
  };

  return element;
};

const item = (videoId: string): MixerQueueItem => ({
  videoId,
  title: videoId,
  artist: 'A',
  duration: 200,
});

const setup = () => {
  const element = video();
  let playerVideoId = 'one';
  const playerApi = {
    getVideoData: () => ({ video_id: playerVideoId }),
    seekTo: vi.fn(),
    getCurrentTime: () => element.currentTime,
    getPlayerState: () => (element.paused ? 2 : 1),
    setVolume: vi.fn(),
    getVolume: () => element.volume,
  };
  const queue = [item('one'), item('two'), item('three')];
  const readQueue = vi.fn(() => queue);
  const client = {
    cacheTrack: vi.fn((videoId: string) =>
      Promise.resolve({
        ok: true as const,
        track: {
          videoId,
          title: videoId,
          artist: 'A',
          duration: 200,
          path: `C:/cache/${videoId}.mp3`,
          extension: 'mp3',
        },
      }),
    ),
    readTrack: vi.fn(() => Promise.resolve(new ArrayBuffer(4))),
    removeTrack: vi.fn(() => Promise.resolve()),
    setPinnedTracks: vi.fn(() => Promise.resolve()),
    onCacheProgress: vi.fn(() => () => {}),
  };
  const frames: Array<() => void> = [];
  let clock = 0;
  const controller = createOverlapController({
    client,
    readQueue,
    getConfig: () => ({
      enabled: true,
      overlap: true,
      secondsBeforeEnd: 30,
      fadeInDuration: 30000,
      fadeOutDuration: 30000,
      fadeScaling: 'linear',
    }),
    now: () => clock,
    requestFrame: (cb) => {
      frames.push(cb);

      return frames.length;
    },
    cancelFrame: () => {},
    createEngine: () => new MixerEngine(new FakeContext() as never),
    decode: () => Promise.resolve(fakeBuffer(200)),
    advance: (ms: number) => {
      clock += ms;
    },
    flushFrames: () => {
      while (frames.length > 0) frames.shift()!();
    },
  });

  controller.start(element as never, playerApi as never);
  playerVideoId = 'one';

  return {
    controller,
    client,
    element,
    playerApi,
    frames,
    setPlayerVideoId: (id: string) => {
      playerVideoId = id;
    },
  };
};

afterEach(() => {
  vi.useRealTimers();
});

describe('OverlapController', () => {
  it('pre-caches the next item and pins it while arming', async () => {
    const { controller, client, element } = setup();
    element.currentTime = 150;
    await controller.tickForTest();

    expect(client.cacheTrack).toHaveBeenCalledWith('two');
    expect(client.setPinnedTracks).toHaveBeenCalled();
    expect(controller.snapshot().state).toBe('arming');
  });

  it('blends, mutes YTM on navigation and owns the deck', async () => {
    const { controller, element, setPlayerVideoId } = setup();
    element.currentTime = 150;
    await controller.tickForTest();

    element.currentTime = 175; // inside the 30 s window of a 200 s track
    await controller.tickForTest();
    expect(controller.snapshot().state).toBe('blending');

    element.currentTime = 200;
    setPlayerVideoId('two');
    controller.navigateForTest('two');

    const snap = controller.snapshot();
    expect(snap.state).toBe('owned');
    expect(snap.activeDeck).toBe('A');
    expect(element.muted).toBe(true);
  });

  it('mirrors pause onto the active deck and keeps ownership', async () => {
    const { controller, element, setPlayerVideoId } = setup();
    element.currentTime = 150;
    await controller.tickForTest();
    element.currentTime = 175;
    await controller.tickForTest();
    setPlayerVideoId('two');
    controller.navigateForTest('two');

    element.paused = true;
    element.emit('pause');

    expect(controller.snapshot().state).toBe('owned');
    element.paused = false;
    element.emit('play');
  });

  it('mirrors a user seek into the deck', async () => {
    const { controller, element, setPlayerVideoId } = setup();
    element.currentTime = 150;
    await controller.tickForTest();
    element.currentTime = 175;
    await controller.tickForTest();
    setPlayerVideoId('two');
    controller.navigateForTest('two');

    element.currentTime = 42;
    element.emit('seeked');
    expect(controller.snapshot().position).toBeCloseTo(42, 0);
  });

  it('tears down and unmutes on a mismatched navigation', async () => {
    const { controller, element, setPlayerVideoId } = setup();
    element.currentTime = 150;
    await controller.tickForTest();
    element.currentTime = 175;
    await controller.tickForTest();
    setPlayerVideoId('two');
    controller.navigateForTest('two');

    controller.navigateForTest('three');

    expect(controller.snapshot().state).toBe('idle');
    expect(element.muted).toBe(false);
  });

  it('falls back to idle when the next item cannot be cached', async () => {
    const { controller, client, element } = setup();
    client.cacheTrack.mockResolvedValue({
      ok: false,
      code: 'NETWORK',
      message: 'offline',
    } as never);

    element.currentTime = 150;
    await controller.tickForTest();
    element.currentTime = 175;
    await controller.tickForTest();

    expect(client.cacheTrack).toHaveBeenCalledTimes(1);
    expect(controller.snapshot().state).toBe('idle');
    expect(element.muted).toBe(false);
  });

  it('ignores the pause YTM emits as the track ends during a blend', async () => {
    const { controller, element } = setup();
    element.currentTime = 150;
    await controller.tickForTest();
    element.currentTime = 175;
    await controller.tickForTest();
    expect(controller.snapshot().state).toBe('blending');

    element.currentTime = 200;
    element.paused = true;
    element.emit('pause');

    expect(controller.snapshot().state).toBe('blending');
  });

  it('keeps ownership when YTM reports play while the deck is playing', async () => {
    const { controller, element, setPlayerVideoId } = setup();
    element.currentTime = 150;
    await controller.tickForTest();
    element.currentTime = 175;
    await controller.tickForTest();
    setPlayerVideoId('two');
    controller.navigateForTest('two');

    element.emit('play');

    expect(controller.snapshot().state).toBe('owned');
  });

  it('keeps YTM muted when the player restores its own flag', async () => {
    const { controller, element, setPlayerVideoId } = setup();
    element.currentTime = 150;
    await controller.tickForTest();
    element.currentTime = 175;
    await controller.tickForTest();
    setPlayerVideoId('two');
    controller.navigateForTest('two');

    element.muted = false;
    await controller.tickForTest();

    expect(element.muted).toBe(true);
    expect(controller.snapshot().state).toBe('owned');
  });

  it('pushes the clock to the deck while the handoff video settles', async () => {
    const { controller, element, playerApi, setPlayerVideoId } = setup();
    element.currentTime = 150;
    await controller.tickForTest();
    element.currentTime = 175;
    await controller.tickForTest();
    setPlayerVideoId('two');
    controller.navigateForTest('two');

    element.currentTime = 30;
    await controller.tickForTest();

    expect(playerApi.seekTo).toHaveBeenCalled();
    expect(playerApi.seekTo.mock.calls.at(-1)?.[0]).toBeCloseTo(0, 0);
  });

  it('mirrors a volume change into the engine while owned', async () => {
    const { controller, element, setPlayerVideoId } = setup();
    element.currentTime = 150;
    await controller.tickForTest();
    element.currentTime = 175;
    await controller.tickForTest();
    setPlayerVideoId('two');
    controller.navigateForTest('two');

    element.volume = 0.4;
    element.emit('volumechange');

    expect(controller.snapshot().volume).toBeCloseTo(0.4, 2);
  });
});
