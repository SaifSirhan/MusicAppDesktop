import { isPathInside } from './cache';
import { toCacheErrorCode } from './errors';

import {
  VIDEO_ID_PATTERN,
  type CacheProgress,
  type CacheTrackResult,
  type CachedTrackInfo,
} from '../types';

import type { CachedTrack, FetchTrackOptions } from '@/providers/track-cache';

export type MixerBackendDeps = {
  cacheDir: string;
  getMaxBytes: () => Promise<number>;
  fetchTrack: (options: FetchTrackOptions) => Promise<CachedTrack>;
  readFile: (path: string) => Promise<Buffer>;
  removeFile: (path: string) => Promise<void>;
  evict: (dir: string, maxBytes: number, excludePaths?: string[]) => string[];
  sendProgress: (progress: CacheProgress) => void;
};

export const createMixerBackend = (deps: MixerBackendDeps) => {
  const {
    cacheDir,
    getMaxBytes,
    fetchTrack,
    readFile,
    removeFile,
    evict,
    sendProgress,
  } = deps;

  let pinnedPaths: string[] = [];

  const normalizePinned = (paths: unknown): string[] => {
    if (!Array.isArray(paths)) return [];

    const seen = new Set<string>();
    const result: string[] = [];

    for (const value of paths) {
      if (typeof value !== 'string' || !isPathInside(cacheDir, value)) continue;

      const key = process.platform === 'win32' ? value.toLowerCase() : value;

      if (seen.has(key)) continue;

      seen.add(key);
      result.push(value);
    }

    return result;
  };

  return {
    async cacheTrack(videoId: unknown): Promise<CacheTrackResult> {
      if (typeof videoId !== 'string' || !VIDEO_ID_PATTERN.test(videoId)) {
        return {
          ok: false,
          code: 'UNPLAYABLE',
          message: 'Invalid video id',
        };
      }

      try {
        const maxBytes = await getMaxBytes();
        const result = await fetchTrack({
          videoId,
          directory: cacheDir,
          skipExisting: true,
          format: {
            extension: 'mp3',
            ffmpegArgs: ['-b:a', '256k'],
            downloadType: 'video+audio',
            containerForItag: () => 'mp3',
          },
          onProgress: (progress) => {
            try {
              sendProgress({ videoId, ...progress } as CacheProgress);
            } catch {
              // Progress reporting is best-effort; never abort the download.
            }
          },
        });

        try {
          // Never evict the file just returned: a skipped pre-existing file
          // keeps its old mtime and would otherwise be the first candidate.
          evict(cacheDir, maxBytes, [result.path, ...pinnedPaths]);
        } catch {
          // Eviction is best-effort; the downloaded track is still valid.
        }

        const track: CachedTrackInfo = {
          ...result.metadata,
          path: result.path,
          extension: result.extension,
        };

        return { ok: true, track };
      } catch (error) {
        return {
          ok: false,
          code: toCacheErrorCode(error),
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async readTrack(path: unknown): Promise<ArrayBuffer> {
      if (typeof path !== 'string' || !isPathInside(cacheDir, path)) {
        throw new Error('Refusing to read outside the mixer cache');
      }

      const buffer = await readFile(path);
      return buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      ) as ArrayBuffer;
    },

    setPinnedTracks(paths: unknown): void {
      pinnedPaths = normalizePinned(paths);
    },

    getPinnedTracks(): string[] {
      return [...pinnedPaths];
    },

    async removeTrack(path: unknown): Promise<void> {
      if (typeof path !== 'string' || !isPathInside(cacheDir, path)) {
        throw new Error('Refusing to remove outside the mixer cache');
      }

      try {
        await removeFile(path);
      } catch {
        // Best-effort: a file that is already gone or held by another reader
        // must not fail the caller's load.
      }
    },
  };
};
