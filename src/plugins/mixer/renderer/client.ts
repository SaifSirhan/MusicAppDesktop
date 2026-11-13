import type { RendererContext } from '@/types/contexts';

import type {
  CacheProgress,
  CacheTrackResult,
  MixerPluginConfig,
} from '../types';

type MixerIpc = RendererContext<MixerPluginConfig>['ipc'];

export type MixerClient = {
  cacheTrack: (videoId: string) => Promise<CacheTrackResult>;
  readTrack: (path: string) => Promise<ArrayBuffer>;
  onCacheProgress: (listener: (progress: CacheProgress) => void) => () => void;
};

export const createMixerClient = (ipc: MixerIpc): MixerClient => ({
  cacheTrack: async (videoId) =>
    (await ipc.invoke('mixer:cache-track', videoId)) as CacheTrackResult,

  readTrack: async (path) =>
    (await ipc.invoke('mixer:read-track', path)) as ArrayBuffer,

  onCacheProgress: (listener) => {
    const handler = (_event: unknown, progress: CacheProgress) =>
      listener(progress);
    ipc.on('mixer:cache-progress', handler);
    return () => ipc.removeAllListeners('mixer:cache-progress');
  },
});
