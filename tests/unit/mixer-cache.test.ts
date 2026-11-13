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
