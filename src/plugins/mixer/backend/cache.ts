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
