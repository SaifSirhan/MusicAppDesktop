import type { CacheProgress, MixerErrorCode } from '../types';
import type { MixerClient } from './client';
import type { Deck } from './engine';

export type MixerQueueItem = {
  videoId: string;
  title: string;
  artist: string;
  duration: number;
  thumbnail?: string;
};

type Runs = { runs?: { text?: string }[] };

type QueueRenderer = {
  title?: Runs;
  longBylineText?: Runs;
  lengthText?: Runs;
  thumbnail?: { thumbnails?: { url?: string }[] };
  navigationEndpoint?: { watchEndpoint?: { videoId?: string } };
};

const asObject = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;

const firstText = (runs: Runs | undefined): string =>
  runs?.runs?.find((run) => typeof run.text === 'string')?.text ?? '';

const parseLength = (runs: Runs | undefined): number => {
  const text = firstText(runs);
  const parts = text.split(':').map((part) => Number(part.trim()));
  if (parts.length < 2 || parts.some((part) => !Number.isFinite(part))) {
    return 0;
  }

  return parts.reduce((total, part) => (total * 60) + part, 0);
};

const isSeparator = (text: string): boolean => {
  const stripped = text.replace(/[•\u2022]/gu, '').trim();

  return stripped.length === 0;
};

const toItem = (value: unknown): MixerQueueItem | undefined => {
  const entry = asObject(value);
  // Segmented videos arrive only as wrapper rows; their primary renderer is
  // the sole representation of the track in the queue.
  const primary = asObject(entry?.playlistPanelVideoWrapperRenderer);
  const source = entry?.playlistPanelVideoRenderer ?? primary?.primaryRenderer;
  const nested = asObject(source);
  const renderer = (nested?.playlistPanelVideoRenderer ?? nested) as
    | QueueRenderer
    | undefined;
  const videoId = renderer?.navigationEndpoint?.watchEndpoint?.videoId;
  if (!renderer || typeof videoId !== 'string' || videoId.length === 0) {
    return undefined;
  }

  const artist =
    renderer.longBylineText?.runs?.find(
      (run) => typeof run.text === 'string' && !isSeparator(run.text),
    )?.text ?? '';
  const thumbnails = renderer.thumbnail?.thumbnails ?? [];
  const largest = thumbnails.at(-1)?.url;

  return {
    videoId,
    title: firstText(renderer.title),
    artist,
    duration: parseLength(renderer.lengthText),
    thumbnail: typeof largest === 'string' ? largest : undefined,
  };
};

export const toQueueItems = (items: readonly unknown[]): MixerQueueItem[] => {
  const seen = new Set<string>();
  const result: MixerQueueItem[] = [];

  for (const value of items) {
    const item = toItem(value);
    if (!item || seen.has(item.videoId)) continue;

    seen.add(item.videoId);
    result.push(item);
  }

  return result;
};

export const formatTime = (seconds: number): string => {
  const total = Number.isFinite(seconds)
    ? Math.max(0, Math.floor(seconds))
    : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (value: number) => String(value).padStart(2, '0');

  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(secs)}`
    : `${minutes}:${pad(secs)}`;
};

export const errorCopy: Record<MixerErrorCode, string> = {
  PO_TOKEN: 'YouTube asked for verification. Retry in a moment.',
  NETWORK: "Couldn't cache this track. Check your connection and retry.",
  UNPLAYABLE: "This track can't be played from YouTube Music.",
  WRITE: "Couldn't save the track. Check disk space and try again.",
};

const DECODE_ERROR = 'Could not decode this track. Try another one.';

export const progressLabel = (progress: CacheProgress): string => {
  const percent = (ratio: number) => `${Math.round(ratio * 100)}%`;

  switch (progress.phase) {
    case 'resolved':
      return `Found ${progress.metadata.title}`;
    case 'downloading':
      return `Downloading ${percent(progress.ratio)}`;
    case 'loading':
      return 'Loading from YouTube…';
    case 'preparing':
      return 'Preparing audio…';
    case 'converting':
      return `Converting ${percent(progress.ratio)}`;
    case 'saving':
      return 'Saving…';
    case 'tagging':
      return 'Tagging…';
  }
};

export type LoadDeps = {
  client: Pick<MixerClient, 'cacheTrack' | 'readTrack'>;
  decode: (data: ArrayBuffer) => Promise<AudioBuffer>;
  onProgress?: (progress: CacheProgress | null) => void;
};

// The deck only accepts a result for its newest token and while it is still
// loading, so a slow load can never land on a deck that moved on. A later
// loadTrack takes over the deck through beginLoading(); the earlier load's
// result is then dropped here instead of being reported as an error.
export const loadTrack = async (
  deps: LoadDeps,
  deck: Deck,
  item: MixerQueueItem,
): Promise<void> => {
  const token = deck.beginLoading();
  const isCurrent = () => deck.getLoadToken() === token;
  const report = (progress: CacheProgress | null) => {
    if (!isCurrent()) return;

    try {
      deps.onProgress?.(progress);
    } catch {
      // A failing progress sink must not abort the load.
    }
  };
  const fail = (message: string) => {
    if (isCurrent()) deck.failLoading(message, token);
  };

  try {
    report(null);

    const result = await deps.client.cacheTrack(item.videoId);
    if (!result.ok) {
      fail(errorCopy[result.code]);

      return;
    }

    const data = await deps.client.readTrack(result.track.path);

    let buffer: AudioBuffer;
    try {
      buffer = await deps.decode(data);
    } catch {
      fail(DECODE_ERROR);

      return;
    }

    if (isCurrent()) deck.load(buffer, token);
  } catch {
    // Cache or file-read failure: the track never reached the decoder.
    fail(errorCopy.NETWORK);
  } finally {
    report(null);
  }
};
