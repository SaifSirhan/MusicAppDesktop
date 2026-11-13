import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  clampMaxBytes,
  isPathInside,
  planEviction,
} from '../../src/plugins/mixer/backend/cache';
import { defaultMixerConfig } from '../../src/plugins/mixer/types';

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

  it('keeps an excluded oldest file and evicts the next oldest', () => {
    const files = [file(10, 1), file(10, 2), file(10, 3)];
    const [oldest, nextOldest] = files;

    // The excluded file still counts toward the total (30 > 20 cap) but is
    // never a candidate, and an absolute spelling of the path must match.
    const evicted = planEviction(files, 20, [resolve(oldest.path)]);

    expect(evicted.map((entry) => entry.path)).toEqual([nextOldest.path]);
  });
});

describe('clampMaxBytes', () => {
  it('falls back to the default for zero, negative and non-finite values', () => {
    expect(clampMaxBytes(0)).toBe(defaultMixerConfig.cacheMaxBytes);
    expect(clampMaxBytes(-5)).toBe(defaultMixerConfig.cacheMaxBytes);
    expect(clampMaxBytes(Number.NaN)).toBe(defaultMixerConfig.cacheMaxBytes);
    expect(clampMaxBytes(Number.POSITIVE_INFINITY)).toBe(
      defaultMixerConfig.cacheMaxBytes,
    );
  });

  it('parses numeric strings', () => {
    expect(clampMaxBytes('2048')).toBe(2048);
  });

  it('passes a valid positive number through', () => {
    expect(clampMaxBytes(5 * 1024 * 1024)).toBe(5 * 1024 * 1024);
  });
});
