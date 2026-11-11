export const DISCOVERY_GENRES = [
  'Pop',
  'Rock',
  'Hip-Hop',
  'R&B',
  'Jazz',
  'Electronic',
  'Classical',
  'Metal',
  'Country',
  'Indie',
  'Latin',
  'K-Pop',
  'Blues',
  'Reggae',
  'Folk',
  'Soul',
  'Funk',
  'Soundtrack',
] as const;

export const UNDERGROUND_LISTENER_LIMIT = 100_000;

export interface TrackRef {
  videoId: string;
  title?: string;
  artists?: string[];
}

export const pickRandom = <T>(
  items: readonly T[],
  random: () => number = Math.random,
): T | undefined => {
  if (items.length === 0) return undefined;
  const index = Math.min(
    items.length - 1,
    Math.max(0, Math.floor(random() * items.length)),
  );
  return items[index];
};

export const normalizeArtist = (name: string): string =>
  name
    .toLowerCase()
    .trim()
    .replace(/\s*-\s*topic$/, '')
    .replace(/\s+/g, ' ')
    .trim();

export const trackArtistNames = (track: {
  artists?: { name: string }[];
  author?: { name: string };
}): string[] => {
  const names =
    track.artists?.map((artist) => artist.name).filter((name) => !!name) ??
    [];
  if (names.length > 0) return names;
  return track.author?.name ? [track.author.name] : [];
};

export const parseLastfmListeners = (payload: unknown): number | undefined => {
  if (!payload || typeof payload !== 'object') return undefined;
  const artist = (payload as { artist?: unknown }).artist;
  if (!artist || typeof artist !== 'object') return undefined;
  const stats = (artist as { stats?: unknown }).stats;
  if (!stats || typeof stats !== 'object') return undefined;
  const listeners = (stats as { listeners?: unknown }).listeners;

  if (typeof listeners === 'number') return listeners;
  if (typeof listeners === 'string') {
    const parsed = Number.parseInt(listeners, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

/**
 * Keeps tracks whose every named artist has a known listener count below the
 * limit. Unknown artists are dropped so an "underground" result is never an
 * unverified claim.
 */
export const selectUnderground = (
  tracks: TrackRef[],
  listenerCounts: ReadonlyMap<string, number>,
  limit = UNDERGROUND_LISTENER_LIMIT,
): TrackRef[] =>
  tracks.filter((track) => {
    const artists = track.artists ?? [];
    if (artists.length === 0) return false;
    return artists.every((artist) => {
      const listeners = listenerCounts.get(normalizeArtist(artist));
      return typeof listeners === 'number' && listeners < limit;
    });
  });

export const uniqueArtists = (tracks: TrackRef[]): string[] => {
  const seen = new Map<string, string>();
  for (const track of tracks) {
    for (const artist of track.artists ?? []) {
      const key = normalizeArtist(artist);
      if (key && !seen.has(key)) seen.set(key, artist);
    }
  }
  return [...seen.values()];
};
