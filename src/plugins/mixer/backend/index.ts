import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { app } from 'electron';

import { fetchTrack } from '@/providers/track-cache';

import { evictCache } from './cache';
import { createMixerBackend } from './handlers';

import type { MixerPluginConfig } from '../types';
import type { BackendContext } from '@/types/contexts';

export const onMainLoad = ({
  window: win,
  ipc,
  getConfig,
}: BackendContext<MixerPluginConfig>) => {
  const cacheDir = join(app.getPath('userData'), 'mixer-cache');

  const backend = createMixerBackend({
    cacheDir,
    getMaxBytes: async () => (await getConfig()).cacheMaxBytes,
    fetchTrack: (options) => fetchTrack(win, options),
    readFile,
    evict: evictCache,
    sendProgress: (progress) => ipc.send('mixer:cache-progress', progress),
  });

  ipc.handle('mixer:cache-track', (videoId: unknown) =>
    backend.cacheTrack(videoId),
  );
  ipc.handle('mixer:read-track', (path: unknown) => backend.readTrack(path));
};
