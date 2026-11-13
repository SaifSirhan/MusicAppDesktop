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
