import { describe, expect, it, vi } from 'vitest';

import { subscribeProgress } from '../../src/plugins/mixer/renderer/session';

const fakeIpc = () => {
  let listener: ((progress: unknown) => void) | undefined;

  return {
    on: vi.fn((_channel: string, fn: (progress: unknown) => void) => {
      listener = fn;
    }),
    removeAllListeners: vi.fn(),
    emit: (progress: unknown) => listener?.(progress),
  };
};

describe('subscribeProgress', () => {
  it('delivers typed cache progress payloads', () => {
    const ipc = fakeIpc();
    const handler = vi.fn();

    subscribeProgress(ipc as never, handler);
    ipc.emit({ videoId: 'abc', phase: 'downloading', ratio: 0.5 });

    expect(handler).toHaveBeenCalledWith({
      videoId: 'abc',
      phase: 'downloading',
      ratio: 0.5,
    });
  });

  it('drops payloads without a video id', () => {
    const ipc = fakeIpc();
    const handler = vi.fn();

    subscribeProgress(ipc as never, handler);
    ipc.emit({ phase: 'saving' });
    ipc.emit(null);
    ipc.emit('nope');

    expect(handler).not.toHaveBeenCalled();
  });

  it('stops delivering and releases the channel after unsubscribe', () => {
    const ipc = fakeIpc();
    const handler = vi.fn();

    const unsubscribe = subscribeProgress(ipc as never, handler);
    unsubscribe();
    ipc.emit({ videoId: 'abc', phase: 'saving' });

    expect(handler).not.toHaveBeenCalled();
    expect(ipc.removeAllListeners).toHaveBeenCalledWith('mixer:cache-progress');
  });
});
