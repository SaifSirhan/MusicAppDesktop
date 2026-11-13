# Mixer Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the mixer backend: a cache directory with LRU eviction, typed IPC to cache a track via the shared `track-cache` provider and read cached bytes, plus a typed renderer client.

**Architecture:** A new plugin `src/plugins/mixer/` with a main-process backend only (no UI yet). Pure helpers (`cache.ts`, `errors.ts`) and an injectable handler factory (`handlers.ts`) keep the logic unit-testable without Electron. `backend/index.ts` wires the factory to real Electron/IPC. A renderer client wraps the IPC channels with types. UI, audio engine and crossfader come in later plans.

**Tech Stack:** TypeScript, Electron 42 main process, `@/providers/track-cache`, vitest, Node `fs`/`path`.

**Spec:** `docs/superpowers/specs/2026-11-13-mixing-engine-design.md`

## Global Constraints

- No new dependencies.
- TypeScript strict; `pnpm typecheck` must pass.
- Unit tests: `pnpm test:unit` (vitest, `tests/unit/**/*.test.ts`, node environment).
- Lint touched files: `pnpm exec oxlint --type-aware <files>`.
- Commit locally after each task; never push or publish without an explicit request.
- Leave untracked `src/plugins/kestrel-bridge/` and its tests untouched.
- Windows Git Bash; close MusicApp before installing; use `MSYS_NO_PATHCONV=1` for `/S` installs.
- Cache dir: `app.getPath('userData')/mixer-cache`.
- IPC names: `mixer:cache-track`, `mixer:read-track`, `mixer:cache-progress`.
- Mixer downloads always use `downloadType: 'video+audio'` (works for free and premium accounts), converted to mp3 at 256 kbps.

---

### Task 1: Shared types and defaults

**Files:**
- Create: `src/plugins/mixer/types.ts`
- Test: `tests/unit/mixer-types.test.ts`

**Interfaces:**
- Consumes: `TrackMetadata`, `TrackProgress` types from `@/providers/track-cache`.
- Produces: `MixerPluginConfig`, `defaultMixerConfig`, `MixerErrorCode`, `CachedTrackInfo`, `CacheTrackResult`, `CacheProgress`, `VIDEO_ID_PATTERN`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';

import {
  defaultMixerConfig,
  VIDEO_ID_PATTERN,
} from '../../src/plugins/mixer/types';

describe('mixer defaults', () => {
  it('ships disabled with a 2 GB cache cap and pre-cache on', () => {
    expect(defaultMixerConfig).toEqual({
      enabled: false,
      cacheMaxBytes: 2 * 1024 * 1024 * 1024,
      preCache: true,
    });
  });

  it('accepts YouTube video ids and rejects garbage', () => {
    expect(VIDEO_ID_PATTERN.test('dQw4w9WgXcQ')).toBe(true);
    expect(VIDEO_ID_PATTERN.test('28jp-30w8Lg')).toBe(true);
    expect(VIDEO_ID_PATTERN.test('bad id!')).toBe(false);
    expect(VIDEO_ID_PATTERN.test('')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/mixer-types.test.ts`
Expected: FAIL — cannot resolve `src/plugins/mixer/types`.

- [ ] **Step 3: Write minimal implementation**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/mixer-types.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/plugins/mixer/types.ts tests/unit/mixer-types.test.ts
git commit -m "feat(mixer): shared types and defaults"
```

---

### Task 2: Cache directory helpers

**Files:**
- Create: `src/plugins/mixer/backend/cache.ts`
- Test: `tests/unit/mixer-cache.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `CacheFile` (`{ path, size, mtimeMs }`), `isPathInside(root, candidate): boolean`, `planEviction(files, maxBytes): CacheFile[]`, `listCacheFiles(dir): CacheFile[]`, `evictCache(dir, maxBytes): string[]`.

- [ ] **Step 1: Write the failing test**

```ts
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  isPathInside,
  planEviction,
} from '../../src/plugins/mixer/backend/cache';

describe('isPathInside', () => {
  const root = join('tmp', 'mixer-cache');

  it('accepts files under the root', () => {
    expect(isPathInside(root, join(root, 'a.mp3'))).toBe(true);
  });

  it('rejects siblings that share a prefix', () => {
    expect(isPathInside(root, join('tmp', 'mixer-cache-evil', 'a.mp3'))).toBe(
      false,
    );
  });

  it('rejects parent traversal', () => {
    expect(isPathInside(root, join(root, '..', 'secret.mp3'))).toBe(false);
  });
});

describe('planEviction', () => {
  const file = (size: number, mtimeMs: number) => ({
    path: `f${mtimeMs}.mp3`,
    size,
    mtimeMs,
  });

  it('keeps everything when under the cap', () => {
    expect(planEviction([file(10, 1), file(10, 2)], 20)).toEqual([]);
  });

  it('evicts oldest first until under the cap', () => {
    const evicted = planEviction(
      [file(10, 3), file(10, 1), file(10, 2)],
      15,
    );
    expect(evicted.map((entry) => entry.mtimeMs)).toEqual([1, 2]);
  });

  it('evicts everything when the cap is zero', () => {
    const evicted = planEviction([file(5, 1), file(5, 2)], 0);
    expect(evicted).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/mixer-cache.test.ts`
Expected: FAIL — cannot resolve `.../backend/cache`.

- [ ] **Step 3: Write minimal implementation**

```ts
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

export type CacheFile = {
  path: string;
  size: number;
  mtimeMs: number;
};

export const isPathInside = (root: string, candidate: string): boolean => {
  const normalizedRoot = `${resolve(root)}${sep}`;
  const normalizedCandidate = resolve(candidate);

  if (process.platform === 'win32') {
    return normalizedCandidate
      .toLowerCase()
      .startsWith(normalizedRoot.toLowerCase());
  }

  return normalizedCandidate.startsWith(normalizedRoot);
};

export const planEviction = (
  files: CacheFile[],
  maxBytes: number,
): CacheFile[] => {
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total <= maxBytes) return [];

  const oldestFirst = [...files].sort((a, b) => a.mtimeMs - b.mtimeMs);
  const evicted: CacheFile[] = [];
  let remaining = total;

  for (const file of oldestFirst) {
    if (remaining <= maxBytes) break;
    evicted.push(file);
    remaining -= file.size;
  }

  return evicted;
};

export const listCacheFiles = (dir: string): CacheFile[] => {
  if (!existsSync(dir)) return [];

  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const path = join(dir, entry.name);
      const stats = statSync(path);
      return { path, size: stats.size, mtimeMs: stats.mtimeMs };
    });
};

export const evictCache = (dir: string, maxBytes: number): string[] => {
  const evicted = planEviction(listCacheFiles(dir), maxBytes);
  for (const file of evicted) rmSync(file.path, { force: true });
  return evicted.map((file) => file.path);
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/mixer-cache.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/plugins/mixer/backend/cache.ts tests/unit/mixer-cache.test.ts
git commit -m "feat(mixer): cache dir helpers and LRU planning"
```

---

### Task 3: Error classifier

**Files:**
- Create: `src/plugins/mixer/backend/errors.ts`
- Test: `tests/unit/mixer-errors.test.ts`

**Interfaces:**
- Consumes: `MixerErrorCode` from `../types`.
- Produces: `toCacheErrorCode(error: unknown): MixerErrorCode`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';

import { toCacheErrorCode } from '../../src/plugins/mixer/backend/errors';

describe('toCacheErrorCode', () => {
  it('maps unplayable and login-required errors', () => {
    expect(toCacheErrorCode(new Error('[UNPLAYABLE] nope'))).toBe(
      'UNPLAYABLE',
    );
    expect(
      toCacheErrorCode(new Error('[LOGIN_REQUIRED] sign in')),
    ).toBe('UNPLAYABLE');
  });

  it('maps filesystem write errors', () => {
    expect(toCacheErrorCode(new Error('EACCES: permission denied'))).toBe(
      'WRITE',
    );
    expect(toCacheErrorCode(new Error('ENOSPC: no space left'))).toBe('WRITE');
  });

  it('maps token/botguard failures', () => {
    expect(toCacheErrorCode(new Error('BotGuard challenge failed'))).toBe(
      'PO_TOKEN',
    );
    expect(toCacheErrorCode(new Error('po_token missing'))).toBe('PO_TOKEN');
  });

  it('falls back to network on anything else', () => {
    expect(toCacheErrorCode(new Error('fetch failed'))).toBe('NETWORK');
    expect(toCacheErrorCode('boom')).toBe('NETWORK');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/mixer-errors.test.ts`
Expected: FAIL — cannot resolve `.../backend/errors`.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { MixerErrorCode } from '../types';

export const toCacheErrorCode = (error: unknown): MixerErrorCode => {
  const message = error instanceof Error ? error.message : String(error);

  if (/UNPLAYABLE|LOGIN_REQUIRED/i.test(message)) return 'UNPLAYABLE';
  if (/\b(ENOSPC|EACCES|EPERM|EROFS)\b/.test(message)) return 'WRITE';
  if (/po.?token|botguard|challenge/i.test(message)) return 'PO_TOKEN';

  return 'NETWORK';
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/mixer-errors.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/plugins/mixer/backend/errors.ts tests/unit/mixer-errors.test.ts
git commit -m "feat(mixer): classify cache errors"
```

---

### Task 4: Injectable backend handlers

**Files:**
- Create: `src/plugins/mixer/backend/handlers.ts`
- Test: `tests/unit/mixer-handlers.test.ts`

**Interfaces:**
- Consumes: `isPathInside` from `./cache`, `toCacheErrorCode` from `./errors`, `VIDEO_ID_PATTERN`/types from `../types`, `FetchTrackOptions`/`CachedTrack` types from `@/providers/track-cache`.
- Produces: `MixerBackendDeps` and `createMixerBackend(deps)` returning `{ cacheTrack(videoId: unknown): Promise<CacheTrackResult>; readTrack(path: unknown): Promise<ArrayBuffer> }`.

- [ ] **Step 1: Write the failing test**

```ts
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
    expect(evict).toHaveBeenCalledWith(cacheDir, 100);
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/mixer-handlers.test.ts`
Expected: FAIL — cannot resolve `.../backend/handlers`.

- [ ] **Step 3: Write minimal implementation**

```ts
import { isPathInside } from './cache';
import { toCacheErrorCode } from './errors';

import { VIDEO_ID_PATTERN } from '../types';

import type {
  CacheProgress,
  CacheTrackResult,
  CachedTrackInfo,
} from '../types';
import type { CachedTrack, FetchTrackOptions } from '@/providers/track-cache';

export type MixerBackendDeps = {
  cacheDir: string;
  getMaxBytes: () => Promise<number>;
  fetchTrack: (options: FetchTrackOptions) => Promise<CachedTrack>;
  readFile: (path: string) => Promise<Buffer>;
  evict: (dir: string, maxBytes: number) => string[];
  sendProgress: (progress: CacheProgress) => void;
};

export const createMixerBackend = (deps: MixerBackendDeps) => {
  const { cacheDir, getMaxBytes, fetchTrack, readFile, evict, sendProgress } =
    deps;

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
            sendProgress({ videoId, ...progress } as CacheProgress);
          },
        });

        evict(cacheDir, maxBytes);

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
  };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/mixer-handlers.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/plugins/mixer/backend/handlers.ts tests/unit/mixer-handlers.test.ts
git commit -m "feat(mixer): injectable cache/read handlers"
```

---

### Task 5: Plugin entry, IPC wiring, i18n

**Files:**
- Create: `src/plugins/mixer/index.ts`
- Create: `src/plugins/mixer/backend/index.ts`
- Modify: `src/i18n/resources/en.json` (add `plugins.mixer` after the `compact-sidebar` entry)

**Interfaces:**
- Consumes: `createMixerBackend` (Task 4), `evictCache` (Task 2), `fetchTrack` from `@/providers/track-cache`, `defaultMixerConfig` (Task 1), `onMainLoad` registered as plugin backend.
- Produces: plugin `mixer` with IPC channels `mixer:cache-track`, `mixer:read-track`, and events `mixer:cache-progress`.

- [ ] **Step 1: Write the plugin entry**

```ts
import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import { onMainLoad } from './backend';
import { defaultMixerConfig } from './types';

export default createPlugin({
  name: () => t('plugins.mixer.name'),
  description: () => t('plugins.mixer.description'),
  restartNeeded: true,
  config: defaultMixerConfig,
  backend: {
    start: onMainLoad,
  },
});
```

- [ ] **Step 2: Write the backend wiring**

```ts
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

  ipc.handle('mixer:cache-track', backend.cacheTrack);
  ipc.handle('mixer:read-track', backend.readTrack);
};
```

- [ ] **Step 3: Add i18n keys**

In `src/i18n/resources/en.json`, immediately after the `compact-sidebar` object, add:

```json
    "mixer": {
      "description": "Two-deck DJ mixer with a crossfader",
      "name": "Mixer"
    },
```

- [ ] **Step 4: Verify types, lint and tests**

Run: `pnpm typecheck`
Expected: PASS.

Run: `pnpm exec oxlint --type-aware src/plugins/mixer/types.ts src/plugins/mixer/backend/cache.ts src/plugins/mixer/backend/errors.ts src/plugins/mixer/backend/handlers.ts src/plugins/mixer/backend/index.ts src/plugins/mixer/index.ts`
Expected: 0 errors.

Run: `pnpm test:unit`
Expected: all suites pass (existing 59 + new).

- [ ] **Step 5: Commit**

```bash
git add src/plugins/mixer/index.ts src/plugins/mixer/backend/index.ts src/i18n/resources/en.json
git commit -m "feat(mixer): plugin entry and IPC wiring"
```

---

### Task 6: Typed renderer client

**Files:**
- Create: `src/plugins/mixer/renderer/client.ts`
- Test: `tests/unit/mixer-client.test.ts`

**Interfaces:**
- Consumes: `RendererContext['ipc']` and mixer types.
- Produces: `MixerClient`, `createMixerClient(ipc)` with `cacheTrack(videoId)`, `readTrack(path)`, `onCacheProgress(listener)` returning an unsubscribe function.

- [ ] **Step 1: Write the failing test**

```ts
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

    unsubscribe();
    expect(ipc.removeAllListeners).toHaveBeenCalledWith(
      'mixer:cache-progress',
    );
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/mixer-client.test.ts`
Expected: FAIL — cannot resolve `.../renderer/client`.

- [ ] **Step 3: Write minimal implementation**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/mixer-client.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/plugins/mixer/renderer/client.ts tests/unit/mixer-client.test.ts
git commit -m "feat(mixer): typed renderer IPC client"
```

---

### Task 7: Live verification in the app

**Files:**
- Modify: `package.json` (bump version to `0.1.16`)
- Create (temporary, not committed): `/c/Users/USER/AppData/Local/Temp/cdp-mixer-backend.mjs`

**Interfaces:**
- Consumes: the built plugin from Task 5.
- Produces: evidence that caching and reading work end to end.

- [ ] **Step 1: Build and install**

Run:

```bash
cd /c/Users/USER/AndroidStudioProjects/MusicAppDesktop
node -e "const fs=require('fs');const p=require('./package.json');p.version='0.1.16';fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\n')"
pnpm dist:win
taskkill //IM MusicApp.exe //F
MSYS_NO_PATHCONV=1 "./pack/MusicApp-Desktop.exe" /S
```

- [ ] **Step 2: Enable the mixer in config**

Run:

```bash
cd "$APPDATA/MusicApp"
node -e "const fs=require('fs');const c=JSON.parse(fs.readFileSync('config.json','utf8').replace(/^\uFEFF/,''));c.plugins.mixer={enabled:true};fs.writeFileSync('config.json',JSON.stringify(c,null,2));console.log('mixer enabled')"
```

- [ ] **Step 3: Launch with CDP**

Run:

```bash
cd /c/Users/USER/AppData/Local/Programs/MusicApp
./MusicApp.exe --remote-debugging-port=9222 >/dev/null 2>&1 &
```

- [ ] **Step 4: Invoke cache, read and path-guard checks**

Create the temporary script and run it:

```js
const targets = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
};
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const n = ++id;
    pending.set(n, resolve);
    ws.send(JSON.stringify({ id: n, method, params }));
  });
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (r.result?.exceptionDetails)
    throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600));
  return r.result?.result?.value;
};

const result = await evaluate(`window.ipcRenderer.invoke('mixer:cache-track', '28jp-30w8Lg')`);
console.log('cache:', JSON.stringify(result));

const bytes = await evaluate(`window.ipcRenderer.invoke('mixer:read-track', ${JSON.stringify(result.track.path)}).then((b) => b.byteLength)`);
console.log('read byteLength:', bytes);

const guard = await evaluate(`window.ipcRenderer.invoke('mixer:read-track', 'C:/Windows/win.ini').then(() => 'allowed').catch((e) => 'blocked: ' + String(e))`);
console.log('guard:', guard);
ws.close();
```

Run: `node "C:/Users/USER/AppData/Local/Temp/cdp-mixer-backend.mjs"`

Expected:
- `cache:` an object with `ok: true` and `track.path` inside `%APPDATA%/MusicApp/mixer-cache`.
- `read byteLength:` a number greater than 1,000,000.
- `guard:` starts with `blocked:`.

- [ ] **Step 5: Confirm the cache file and restore state**

Run:

```bash
ls -la "$APPDATA/MusicApp/mixer-cache" | tail -3
taskkill //IM MusicApp.exe //F
cd "$APPDATA/MusicApp"
node -e "const fs=require('fs');const c=JSON.parse(fs.readFileSync('config.json','utf8').replace(/^\uFEFF/,''));c.plugins.mixer.enabled=false;fs.writeFileSync('config.json',JSON.stringify(c,null,2))"
cd /c/Users/USER/AppData/Local/Programs/MusicApp
./MusicApp.exe >/dev/null 2>&1 &
```

- [ ] **Step 6: Final checks and commit**

Run:

```bash
cd /c/Users/USER/AndroidStudioProjects/MusicAppDesktop
pnpm typecheck
pnpm test:unit
git add package.json
git commit -m "chore(mixer): verify backend end to end (0.1.16)"
```

Expected: typecheck passes; all unit suites pass.

---

## Self-Review Notes

- Spec coverage for this plan: §3 decision 4 (shared provider reuse), §4 cache dir + path validation, §5 steps 3–4 (cache/read), §8 typed errors + path guard, §9 unit tests for cache/LRU/path validation. Engine, UI, pre-cache, YTM lifecycle and E2E are deliberately in Plans 2–4.
- No placeholders: every step has concrete code or a concrete command.
- Type consistency: `CachedTrackInfo` = `TrackMetadata & { path, extension }`; `fetchTrack` returns `CachedTrack` with `{ path, metadata, extension, skipped }`; handlers spread `metadata` plus `path`/`extension`.
