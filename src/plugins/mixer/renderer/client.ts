import type {
  CacheProgress,
  CacheTrackResult,
  MixerPluginConfig,
} from '../types';
import type { RendererContext } from '@/types/contexts';

type MixerIpc = RendererContext<MixerPluginConfig>['ipc'];

export type MixerClient = {
  cacheTrack: (videoId: string) => Promise<CacheTrackResult>;
  readTrack: (path: string) => Promise<ArrayBuffer>;
  removeTrack: (path: string) => Promise<void>;
  onCacheProgress: (listener: (progress: CacheProgress) => void) => () => void;
};

export const createMixerClient = (ipc: MixerIpc): MixerClient => ({
  cacheTrack: async (videoId) =>
    (await ipc.invoke('mixer:cache-track', videoId)) as CacheTrackResult,

  readTrack: async (path) =>
    (await ipc.invoke('mixer:read-track', path)) as ArrayBuffer,

  removeTrack: async (path) => {
    await ipc.invoke('mixer:remove-track', path);
  },

  onCacheProgress: (listener) => {
    // RendererContext.ipc.on strips the Electron event and forwards only the
    // payload args, so this handler is payload-first. The context only exposes
    // channel-wide removal, so the panel owns a single progress subscription;
    // guard against post-unsubscribe delivery.
    let active = true;
    const handler = (progress: CacheProgress) => {
      if (active) listener(progress);
    };
    ipc.on('mixer:cache-progress', handler);
    return () => {
      active = false;
      ipc.removeAllListeners('mixer:cache-progress');
    };
  },
});
