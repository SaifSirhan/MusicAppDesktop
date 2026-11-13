import type { TrackMetadata, TrackProgress } from '@/providers/track-cache';

export type MixerPluginConfig = {
  enabled: boolean;
  cacheMaxBytes: number;
  preCache: boolean;
};

export const defaultMixerConfig: MixerPluginConfig = {
  enabled: false,
  cacheMaxBytes: 2 * 1024 * 1024 * 1024,
  preCache: true,
};

export type MixerErrorCode = 'PO_TOKEN' | 'NETWORK' | 'UNPLAYABLE' | 'WRITE';

export type CachedTrackInfo = TrackMetadata & {
  path: string;
  extension: string;
};

export type CacheTrackResult =
  | { ok: true; track: CachedTrackInfo }
  | { ok: false; code: MixerErrorCode; message: string };

export type CacheProgress = TrackProgress & { videoId: string };

export const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{5,32}$/;
