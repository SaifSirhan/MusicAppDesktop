import { dialog, type BrowserWindow } from 'electron';

import { createPlugin } from '@/utils';

import {
  DISCOVERY_GENRES,
  isLikelyMusicAlbum,
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
  title?: string | { toString(): string };
  artists?: { name: string }[];
  author?: { name: string };
  endpoint?: { payload?: { browseId?: string } };
};

const titleText = (item: ShelfItem | undefined): string => {
  const title = item?.title;
  if (typeof title === 'string') return title;
  return title?.toString?.() ?? '';
};

const browseId = (item: ShelfItem | undefined): string | undefined =>
  item?.id ?? item?.endpoint?.payload?.browseId;

const shelfItems = (contents: unknown): ShelfItem[] => {
  if (!Array.isArray(contents)) return [];
  const shelf = contents.find(
    (node) => (node as { type?: string })?.type === 'MusicShelf',
  ) as { contents?: unknown } | undefined;
  return Array.isArray(shelf?.contents) ? (shelf.contents as ShelfItem[]) : [];
};

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

const pendingAcks = new Map<string, (inserted: boolean) => void>();

const waitForAck = (videoId: string, timeoutMs = 6000): Promise<boolean> =>
  new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingAcks.delete(videoId);
      resolve(false);
    }, timeoutMs);
    pendingAcks.set(videoId, (inserted) => {
      clearTimeout(timer);
      pendingAcks.delete(videoId);
      resolve(inserted);
    });
  });

const queueTracks = async (
  window: BrowserWindow,
  tracks: TrackRef[],
): Promise<number> => {
  // Inserting after the current song keeps the selection visible and next in
  // line instead of buried at the end of a long radio queue. Sending in
  // reverse makes the final queue order match the album/playlist order.
  const ordered = [...tracks].reverse();
  let inserted = 0;

  for (const track of ordered) {
    const ack = waitForAck(track.videoId);
    window.webContents.send(
      'peard:add-to-queue',
      track.videoId,
      'INSERT_AFTER_CURRENT_VIDEO',
    );
    if (await ack) inserted += 1;
    await delay(120);
  }

  return inserted;
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
  const inserted = await queueTracks(window, finalTracks);

  await dialog.showMessageBox(window, {
    type: 'info',
    message: `Inserted ${inserted} of ${finalTracks.length} ${genre} tracks after the current song.`,
    detail: `Playlist: ${titleText(chosen) || 'unknown'}`,
  });
};

type AlbumDetail = {
  header?: {
    author?: { name?: string };
    strapline_text_one?: { toString(): string };
    subtitle?: { toString(): string };
  };
  contents?: unknown;
};

const albumArtistNames = (album: AlbumDetail): string[] => {
  // Album pages expose the artist as the strapline, not the subtitle
  // ("Album • 2026"). Fall back to the header author, then track artists.
  const strapline = album.header?.strapline_text_one?.toString?.()?.trim();
  if (strapline) return [strapline];

  const author = album.header?.author?.name;
  if (author) return [author];

  const fromTracks = playlistTracks(album.contents)
    .flatMap((track) => track.artists ?? [])
    .filter((name) => !!name);
  return fromTracks.length > 0 ? [...new Set(fromTracks)] : [];
};

const collectAlbums = async (yt: Innertube): Promise<ShelfItem[]> => {
  const feeds = await Promise.all([
    yt.music.getExplore(),
    yt.music.getHomeFeed(),
  ]);
  const seen = new Set<string>();
  const albums: ShelfItem[] = [];

  for (const feed of feeds) {
    const sections = (feed as { sections?: unknown }).sections;
    if (!Array.isArray(sections)) continue;
    for (const section of sections) {
      const contents = (section as { contents?: unknown }).contents;
      if (!Array.isArray(contents)) continue;
      for (const item of contents as ShelfItem[]) {
        if (item?.item_type !== 'album') continue;
        const id = browseId(item);
        if (!id || seen.has(id)) continue;
        if (!isLikelyMusicAlbum(titleText(item))) continue;
        seen.add(id);
        albums.push(item);
      }
    }
  }

  return albums;
};

const playRandomAlbum = async (
  window: BrowserWindow,
  config: DiscoveryConfig,
): Promise<void> => {
  const yt = await getInnertube();
  const albums = await collectAlbums(yt);
  if (albums.length === 0) throw new Error('No albums found.');

  const apiKey = config.lastfmApiKey.trim();
  const underground = config.undergroundOnly;
  let filterActive = underground;

  if (underground && !apiKey) {
    filterActive = false;
    await dialog.showMessageBox(window, {
      type: 'info',
      message: 'Underground filter is on but no Last.fm API key is set.',
      detail:
        'Add a free key from last.fm/api/account/create in Settings → Advanced. Picking an album without the filter.',
    });
  }

  let chosen: ShelfItem | undefined;
  let tracks: TrackRef[] = [];

  for (const candidate of shuffle([...albums]).slice(0, 10)) {
    const id = browseId(candidate);
    if (!id) continue;

    const album = (await yt.music.getAlbum(id)) as AlbumDetail;
    const candidateTracks = playlistTracks(album.contents);
    // Whole releases only: skip singles and one-track EPs.
    if (candidateTracks.length < 4) {
      await delay(150);
      continue;
    }

    if (filterActive) {
      const artists = albumArtistNames(album);
      if (artists.length === 0) {
        await delay(150);
        continue;
      }
      const listeners = await lookupListeners(artists[0], apiKey);
      await delay(220);
      if (listeners === 'invalid') {
        filterActive = false;
        await dialog.showMessageBox(window, {
          type: 'warning',
          message: 'Last.fm rejected the API key.',
          detail:
            'Check the key in Settings → Advanced. Picking an album without the underground filter.',
        });
      } else if (
        typeof listeners !== 'number' ||
        listeners >= UNDERGROUND_LISTENER_LIMIT
      ) {
        continue;
      }
    }

    chosen = candidate;
    tracks = candidateTracks;
    break;
  }

  if (!chosen) {
    throw new Error(
      filterActive
        ? 'No underground album with enough tracks was found. Try again.'
        : 'No suitable album found. Try again.',
    );
  }

  const selection = tracks.slice(0, 40);
  const inserted = await queueTracks(window, selection);

  await dialog.showMessageBox(window, {
    type: 'info',
    message: `Inserted ${inserted} of ${selection.length} album tracks after the current song.`,
    detail: titleText(chosen),
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
  backend: {
    start({ ipc }) {
      ipc.on('peard:add-to-queue-result', (videoId: unknown, inserted: unknown) => {
        const ack = pendingAcks.get(String(videoId));
        if (ack) ack(Boolean(inserted));
      });
    },
  },
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
