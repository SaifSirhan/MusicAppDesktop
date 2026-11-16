import { describe, expect, it, vi } from 'vitest';

import { createMixerClient } from '../../src/plugins/mixer/renderer/client';

type RawListener = (event: unknown, ...args: unknown[]) => void;

// Mirrors src/loader/renderer.ts: `ipc.on` registers an Electron-style wrapper
// that strips the event and calls the plugin listener with the payload args.
const fakeIpc = () => {
  const rawListeners = new Map<string, RawListener>();
  const ipc = {
    invoke: vi.fn(async () => ({ ok: true })),
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      rawListeners.set(event, (_event, ...args) => listener(...args));
    }),
    send: vi.fn(),
    removeAllListeners: vi.fn(),
  };
  const rawListener = (event: string) => rawListeners.get(event);
  // Emit exactly as Electron would: (event, payload).
  const emit = (event: string, payload: unknown) => {
    rawListener(event)?.(undefined, payload);
  };
  return { ipc, emit };
};

describe('createMixerClient', () => {
  it('invokes the cache channel with the video id', async () => {
    const { ipc } = fakeIpc();
    const client = createMixerClient(ipc as never);
    await client.cacheTrack('dQw4w9WgXcQ');
    expect(ipc.invoke).toHaveBeenCalledWith(
      'mixer:cache-track',
      'dQw4w9WgXcQ',
    );
  });

  it('invokes the read channel with the path', async () => {
    const { ipc } = fakeIpc();
    const client = createMixerClient(ipc as never);
    await client.readTrack('/tmp/mixer-cache/a.mp3');
    expect(ipc.invoke).toHaveBeenCalledWith(
      'mixer:read-track',
      '/tmp/mixer-cache/a.mp3',
    );
  });

  it('invokes the remove channel with the path', async () => {
    const { ipc } = fakeIpc();
    const client = createMixerClient(ipc as never);
    await client.removeTrack('/tmp/mixer-cache/a.mp3');
    expect(ipc.invoke).toHaveBeenCalledWith(
      'mixer:remove-track',
      '/tmp/mixer-cache/a.mp3',
    );
  });

  it('invokes the pin channel with the path list', async () => {
    const { ipc } = fakeIpc();
    const client = createMixerClient(ipc as never);

    await client.setPinnedTracks(['/tmp/mixer-cache/a.mp3']);

    expect(ipc.invoke).toHaveBeenCalledWith('mixer:set-pinned-tracks', [
      '/tmp/mixer-cache/a.mp3',
    ]);
  });

  it('subscribes and unsubscribes from progress events', () => {
    const { ipc, emit } = fakeIpc();
    const client = createMixerClient(ipc as never);
    const listener = vi.fn();

    const unsubscribe = client.onCacheProgress(listener);
    expect(ipc.on).toHaveBeenCalledWith(
      'mixer:cache-progress',
      expect.any(Function),
    );

    unsubscribe();
    expect(ipc.removeAllListeners).toHaveBeenCalledWith(
      'mixer:cache-progress',
    );

    emit('mixer:cache-progress', {
      videoId: 'x',
      phase: 'downloading',
      ratio: 0.25,
    });
    expect(listener).not.toHaveBeenCalled();
  });

  it('forwards progress payloads to the listener', () => {
    const { ipc, emit } = fakeIpc();
    const client = createMixerClient(ipc as never);
    const listener = vi.fn();
    client.onCacheProgress(listener);

    const payload = { videoId: 'x', phase: 'downloading', ratio: 0.5 };
    emit('mixer:cache-progress', payload);
    expect(listener).toHaveBeenCalledWith(payload);
  });
});
