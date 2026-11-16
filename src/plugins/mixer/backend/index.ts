import { readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import { app } from 'electron';

import { fetchTrack } from '@/providers/track-cache';

import { clampMaxBytes, evictCache } from './cache';
import { createMixerBackend } from './handlers';

import type { MixerPluginConfig } from '../types';
import type { BackendContext } from '@/types/contexts';

export const onMainLoad = ({
  window: win,
  ipc,
  getConfig,
}: BackendContext<MixerPluginConfig>) => {
  const cacheDir = join(app.getPath('userData'), 'mixer-cache');
  const getMaxBytes = async () =>
    clampMaxBytes((await getConfig()).cacheMaxBytes);

  const backend = createMixerBackend({
    cacheDir,
    getMaxBytes,
    fetchTrack: (options) => fetchTrack(win, options),
    readFile,
    removeFile: unlink,
    evict: evictCache,
    sendProgress: (progress) => ipc.send('mixer:cache-progress', progress),
  });

  ipc.handle('mixer:cache-track', (videoId: unknown) =>
    backend.cacheTrack(videoId),
  );
  ipc.handle('mixer:read-track', (path: unknown) => backend.readTrack(path));
  ipc.handle('mixer:remove-track', (path: unknown) => backend.removeTrack(path));
  ipc.handle('mixer:set-pinned-tracks', (paths: unknown) =>
    backend.setPinnedTracks(paths),
  );

  // Spec §8: the cache is evicted at startup as well as after each cache.
  // Non-blocking and never throws: startup eviction is best-effort.
  (async () => {
    try {
      evictCache(cacheDir, await getMaxBytes());
    } catch {
      // Startup eviction is best-effort.
    }
  })();
};
