import { dialog, type BrowserWindow } from 'electron';

import { createPlugin } from '@/utils';

import {
  DISCOVERY_GENRES,
  normalizeArtist,
  parseLastfmListeners,
  pickRandom,
  selectUnderground,
  trackArtistNames,
  UNDERGROUND_LISTENER_LIMIT,
  uniqueArtists,
  type TrackRef,
} from './discovery';

import type { Innertube } from 'youtubei.js';

export type DiscoveryConfig = {
  enabled: boolean;
  undergroundOnly: boolean;
  lastfmApiKey: string;
};

const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

let innertube: Promise<Innertube> | undefined;
const getInnertube = (): Promise<Innertube> => {
  innertube ??= (async () => {
    const { Innertube: InnertubeClient } = await import('youtubei.js');
    return InnertubeClient.create();
  })().catch((error: unknown) => {
    innertube = undefined;
    throw error;
  });
  return innertube;
};

type ShelfItem = {
  id?: string;
  item_type?: string;
  title?: string;
  endpoint?: { payload?: { browseId?: string } };
};

const shelfItems = (contents: unknown): ShelfItem[] => {
  if (!Array.isArray(contents)) return [];
  const shelf = contents.find(
    (node) => (node as { type?: string })?.type === 'MusicShelf',
  ) as { contents?: unknown } | undefined;
  return Array.isArray(shelf?.contents) ? (shelf.contents as ShelfItem[]) : [];
};

const browseId = (item: ShelfItem | undefined): string | undefined =>
  item?.id ?? item?.endpoint?.payload?.browseId;

type ResolvedItem = {
  item_type?: string;
  id?: string;
  title?: string;
  artists?: { name: string }[];
  author?: { name: string };
};

const playlistTracks = (items: unknown): TrackRef[] => {
  if (!Array.isArray(items)) return [];
  return (items as ResolvedItem[])
    .filter(
      (item) =>
        typeof item?.id === 'string' &&
        (item.item_type === 'song' || item.item_type === 'video'),
    )
    .map((item) => ({
      videoId: item.id as string,
      title: item.title,
      artists: trackArtistNames(item),
    }));
};

const shuffle = <T>(items: T[]): T[] => {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
};

const lookupListeners = async (
  artist: string,
  apiKey: string,
): Promise<number | 'invalid' | undefined> => {
  const url = new URL('https://ws.audioscrobbler.com/2.0/');
  url.searchParams.set('method', 'artist.getinfo');
  url.searchParams.set('artist', artist);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('format', 'json');
  try {
    const response = await fetch(url, {
      headers: { 'user-agent': 'MusicApp-Desktop' },
    });
    if (response.status === 403) return 'invalid';
    if (!response.ok) return undefined;
    return parseLastfmListeners(await response.json());
  } catch {
    return undefined;
  }
};

const queueTracks = async (
  window: BrowserWindow,
  tracks: TrackRef[],
): Promise<number> => {
  let queued = 0;
  for (const track of tracks) {
    window.webContents.send('peard:add-to-queue', track.videoId, 'INSERT_AT_END');
    queued += 1;
    await delay(200);
  }
  return queued;
};

const filterUnderground = async (
  tracks: TrackRef[],
  apiKey: string,
): Promise<TrackRef[] | 'invalid-key'> => {
  const artists = uniqueArtists(tracks).slice(0, 25);
  const counts = new Map<string, number>();
  let invalidKey = false;

  for (const artist of artists) {
    const listeners = await lookupListeners(artist, apiKey);
    if (listeners === 'invalid') invalidKey = true;
    if (typeof listeners === 'number') {
      counts.set(normalizeArtist(artist), listeners);
    }
    await delay(220);
  }

  if (invalidKey) return 'invalid-key';
  return selectUnderground(tracks, counts);
};

const prepareTracks = async (
  window: BrowserWindow,
  tracks: TrackRef[],
  config: DiscoveryConfig,
): Promise<TrackRef[]> => {
  const selected = shuffle([...tracks]).slice(0, 30);

  if (!config.undergroundOnly) return selected;

  const apiKey = config.lastfmApiKey.trim();
  if (!apiKey) {
    await dialog.showMessageBox(window, {
      type: 'info',
      message: 'Underground filter is on but no Last.fm API key is set.',
      detail:
        'Add a free key from last.fm/api/account/create in Settings → Advanced. Playing without the filter this time.',
    });
    return selected;
  }

  const underground = await filterUnderground(selected, apiKey);
  if (underground === 'invalid-key') {
    await dialog.showMessageBox(window, {
      type: 'warning',
      message: 'Last.fm rejected the API key.',
      detail:
        'Check the key in Settings → Advanced. Playing without the underground filter.',
    });
    return selected;
  }
  if (underground.length > 0) return underground;

  await dialog.showMessageBox(window, {
    type: 'info',
    message:
      'No tracks from artists under ' +
      `${UNDERGROUND_LISTENER_LIMIT / 1000}k listeners were found.`,
    detail: 'Playing the unfiltered selection instead.',
  });
  return selected;
};

const playRandomGenre = async (
  window: BrowserWindow,
  config: DiscoveryConfig,
): Promise<void> => {
  const genre = pickRandom(DISCOVERY_GENRES);
  if (!genre) return;

  const yt = await getInnertube();
  const search = await yt.music.search(genre);
  const filtered = await search.applyFilter('Featured playlists');
  const playlists = shelfItems(filtered.contents).filter(
    (item) => item.item_type === 'playlist' && browseId(item),
  );

  const chosen = pickRandom(playlists);
  const id = browseId(chosen);
  if (!chosen || !id) throw new Error(`No playlists found for ${genre}.`);

  const detail = await yt.music.getPlaylist(id);
  const tracks = playlistTracks(detail.items);
  if (tracks.length === 0) throw new Error('That playlist has no tracks.');

  const finalTracks = await prepareTracks(window, tracks, config);
  const queued = await queueTracks(window, finalTracks);

  await dialog.showMessageBox(window, {
    type: 'info',
    message: `Queued ${queued} tracks from ${genre}.`,
    detail: `Playlist: ${chosen.title ?? 'unknown'}`,
  });
};

const playRandomAlbum = async (
  window: BrowserWindow,
  _config: DiscoveryConfig,
): Promise<void> => {
  const genre = pickRandom(DISCOVERY_GENRES);
  if (!genre) return;

  const yt = await getInnertube();
  const search = await yt.music.search(genre);
  const filtered = await search.applyFilter('Albums');
  const albums = shelfItems(filtered.contents).filter(
    (item) => item.item_type === 'album' && browseId(item),
  );
  if (albums.length === 0) throw new Error(`No albums found for ${genre}.`);

  let chosen = pickRandom(albums);
  let tracks: TrackRef[] = [];

  // Singles and one-track EPs show up in album search; retry until a real
  // multi-track release is found, then accept whatever is left.
  for (const candidate of shuffle([...albums]).slice(0, 4)) {
    const id = browseId(candidate);
    if (!id) continue;
    const album = await yt.music.getAlbum(id);
    const candidateTracks = playlistTracks(album.contents);
    if (candidateTracks.length > tracks.length) {
      chosen = candidate;
      tracks = candidateTracks;
    }
    if (tracks.length >= 4) break;
    await delay(150);
  }

  if (!chosen || tracks.length === 0) {
    throw new Error('That album has no tracks.');
  }

  const queued = await queueTracks(window, tracks.slice(0, 40));

  await dialog.showMessageBox(window, {
    type: 'info',
    message: `Queued the album ${chosen.title ?? ''}`.trim() + '.',
    detail: `${queued} tracks, ${genre}.`,
  });
};

const run = async (
  window: BrowserWindow,
  action: (win: BrowserWindow, config: DiscoveryConfig) => Promise<void>,
  getConfig: () => unknown,
): Promise<void> => {
  try {
    await action(window, (await getConfig()) as DiscoveryConfig);
  } catch (error) {
    await dialog.showMessageBox(window, {
      type: 'error',
      message: 'Discovery failed',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
};

export default createPlugin({
  name: () => 'Discovery',
  description: () =>
    'Queue a random genre station or a random full album from YouTube Music.',
  restartNeeded: false,
  config: {
    enabled: true,
    undergroundOnly: false,
    lastfmApiKey: '',
  } as DiscoveryConfig,
  menu({ window, getConfig }) {
    return [
      {
        label: 'Play random genre',
        click() {
          run(window, playRandomGenre, getConfig);
        },
      },
      {
        label: 'Play random album',
        click() {
          run(window, playRandomAlbum, getConfig);
        },
      },
    ];
  },
});
