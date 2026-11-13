import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { createMixerBackend } from '../../src/plugins/mixer/backend/handlers';

import type { CacheProgress } from '../../src/plugins/mixer/types';

const metadata = {
  videoId: 'dQw4w9WgXcQ',
  title: 'Song',
  artist: 'Artist',
  album: '',
  duration: 200,
  imageSrc: undefined,
};

const setup = () => {
  const cacheDir = join('tmp', 'mixer-cache');
  const sent: CacheProgress[] = [];
  const fetchTrack = vi.fn(async () => ({
    path: join(cacheDir, 'a.mp3'),
    metadata,
    extension: 'mp3',
    skipped: false,
  }));
  const readFile = vi.fn(async () => Buffer.from('abc'));
  const evict = vi.fn(() => []);
  const backend = createMixerBackend({
    cacheDir,
    getMaxBytes: async () => 100,
    fetchTrack,
    readFile,
    evict,
    sendProgress: (progress) => sent.push(progress),
  });
  return { backend, cacheDir, fetchTrack, readFile, evict, sent };
};

describe('createMixerBackend', () => {
  it('rejects invalid video ids without fetching', async () => {
    const { backend, fetchTrack } = setup();
    const result = await backend.cacheTrack('bad id!');
    expect(result).toEqual({
      ok: false,
      code: 'UNPLAYABLE',
      message: 'Invalid video id',
    });
    expect(fetchTrack).not.toHaveBeenCalled();
  });

  it('caches with the mixer format and returns track info', async () => {
    const { backend, cacheDir, fetchTrack, evict } = setup();
    const result = await backend.cacheTrack('dQw4w9WgXcQ');

    expect(result).toEqual({
      ok: true,
      track: {
        ...metadata,
        path: join(cacheDir, 'a.mp3'),
        extension: 'mp3',
      },
    });

    const options = fetchTrack.mock.calls[0][0];
    expect(options.videoId).toBe('dQw4w9WgXcQ');
    expect(options.directory).toBe(cacheDir);
    expect(options.skipExisting).toBe(true);
    expect(options.format).toEqual({
      extension: 'mp3',
      ffmpegArgs: ['-b:a', '256k'],
      downloadType: 'video+audio',
      containerForItag: expect.any(Function),
    });
    expect(options.format.containerForItag(140)).toBe('mp3');
    expect(evict).toHaveBeenCalledWith(cacheDir, 100, [
      join(cacheDir, 'a.mp3'),
    ]);
  });

  it('keeps the cached track when eviction fails', async () => {
    const { backend, cacheDir, evict } = setup();
    evict.mockImplementationOnce(() => {
      throw new Error('EBUSY');
    });

    const result = await backend.cacheTrack('dQw4w9WgXcQ');

    expect(evict).toHaveBeenCalledWith(cacheDir, 100, [
      join(cacheDir, 'a.mp3'),
    ]);
    expect(result).toEqual({
      ok: true,
      track: {
        ...metadata,
        path: join(cacheDir, 'a.mp3'),
        extension: 'mp3',
      },
    });
  });

  it('forwards progress with the video id', async () => {
    const { backend, fetchTrack, sent } = setup();
    fetchTrack.mockImplementationOnce(async (options: any) => {
      options.onProgress({ phase: 'downloading', ratio: 0.5 });
      return {
        path: join('tmp', 'mixer-cache', 'a.mp3'),
        metadata,
        extension: 'mp3',
        skipped: false,
      };
    });

    await backend.cacheTrack('dQw4w9WgXcQ');
    expect(sent).toContainEqual({
      videoId: 'dQw4w9WgXcQ',
      phase: 'downloading',
      ratio: 0.5,
    });
  });

  it('maps provider failures to typed results', async () => {
    const { backend, fetchTrack } = setup();
    fetchTrack.mockRejectedValueOnce(new Error('[UNPLAYABLE] nope'));
    const result = await backend.cacheTrack('dQw4w9WgXcQ');
    expect(result).toEqual({
      ok: false,
      code: 'UNPLAYABLE',
      message: '[UNPLAYABLE] nope',
    });
  });

  it('reads cached bytes inside the cache dir', async () => {
    const { backend, cacheDir } = setup();
    const data = await backend.readTrack(join(cacheDir, 'a.mp3'));
    expect(data.byteLength).toBe(3);
  });

  it('refuses reads outside the cache dir', async () => {
    const { backend } = setup();
    await expect(
      backend.readTrack(join('tmp', 'other', 'secret.mp3')),
    ).rejects.toThrow('Refusing to read outside the mixer cache');
  });
});
