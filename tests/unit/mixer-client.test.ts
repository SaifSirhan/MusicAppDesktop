import { describe, expect, it, vi } from 'vitest';

import { createMixerClient } from '../../src/plugins/mixer/renderer/client';

const fakeIpc = () => ({
  invoke: vi.fn(async () => ({ ok: true })),
  on: vi.fn(),
  send: vi.fn(),
  removeAllListeners: vi.fn(),
});

describe('createMixerClient', () => {
  it('invokes the cache channel with the video id', async () => {
    const ipc = fakeIpc();
    const client = createMixerClient(ipc as never);
    await client.cacheTrack('dQw4w9WgXcQ');
    expect(ipc.invoke).toHaveBeenCalledWith(
      'mixer:cache-track',
      'dQw4w9WgXcQ',
    );
  });

  it('invokes the read channel with the path', async () => {
    const ipc = fakeIpc();
    const client = createMixerClient(ipc as never);
    await client.readTrack('/tmp/mixer-cache/a.mp3');
    expect(ipc.invoke).toHaveBeenCalledWith(
      'mixer:read-track',
      '/tmp/mixer-cache/a.mp3',
    );
  });

  it('subscribes and unsubscribes from progress events', () => {
    const ipc = fakeIpc();
    const client = createMixerClient(ipc as never);
    const listener = vi.fn();

    const unsubscribe = client.onCacheProgress(listener);
    expect(ipc.on).toHaveBeenCalledWith(
      'mixer:cache-progress',
      expect.any(Function),
    );

    const handler = ipc.on.mock.calls[0][1] as (
      event: unknown,
      progress: unknown,
    ) => void;

    unsubscribe();
    expect(ipc.removeAllListeners).toHaveBeenCalledWith(
      'mixer:cache-progress',
    );

    handler(undefined, { videoId: 'x', phase: 'downloading', ratio: 0.25 });
    expect(listener).not.toHaveBeenCalled();
  });

  it('forwards progress payloads to the listener', () => {
    const ipc = fakeIpc();
    const client = createMixerClient(ipc as never);
    const listener = vi.fn();
    client.onCacheProgress(listener);

    const handler = ipc.on.mock.calls[0][1] as (
      event: unknown,
      progress: unknown,
    ) => void;
    handler(undefined, { videoId: 'x', phase: 'downloading', ratio: 0.5 });
    expect(listener).toHaveBeenCalledWith({
      videoId: 'x',
      phase: 'downloading',
      ratio: 0.5,
    });
  });
});
