import {
  existsSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { evictCache } from '../../src/plugins/mixer/backend/cache';

const createdDirs: string[] = [];

const makeDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'mixer-evict-'));
  createdDirs.push(dir);
  return dir;
};

const makeFile = (
  dir: string,
  name: string,
  bytes: number,
  ageSeconds: number,
): string => {
  const path = join(dir, name);
  writeFileSync(path, 'x'.repeat(bytes));
  const timestamp = new Date(Date.now() - ageSeconds * 1000);
  utimesSync(path, timestamp, timestamp);
  return path;
};

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('evictCache on the real filesystem', () => {
  it('evicts the oldest file when the cache is over the cap', () => {
    const dir = makeDir();
    const oldest = makeFile(dir, 'oldest.mp3', 10, 300);
    const newest = makeFile(dir, 'newest.mp3', 10, 100);

    const evicted = evictCache(dir, 15);

    expect(evicted).toEqual([oldest]);
    expect(existsSync(oldest)).toBe(false);
    expect(existsSync(newest)).toBe(true);
  });

  it('keeps an excluded served path even when it is the oldest', () => {
    const dir = makeDir();
    const served = makeFile(dir, 'served.mp3', 10, 300);
    const other = makeFile(dir, 'other.mp3', 10, 100);

    const evicted = evictCache(dir, 15, [served]);

    expect(evicted).toEqual([other]);
    expect(existsSync(served)).toBe(true);
    expect(existsSync(other)).toBe(false);
  });
});
