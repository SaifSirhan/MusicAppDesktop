import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Mutex } from 'async-mutex';
import { BG, type BgConfig } from 'bgutils-js';
import { type BrowserWindow } from 'electron';
import is from 'electron-is';
import filenamify from 'filenamify';
import lazyVar from 'lazy-var';
import NodeID3 from 'node-id3';
import {
  Innertube,
  Platform,
  UniversalCache,
  Utils,
  YTNodes,
  type Types,
  type YT,
  type YTMusic,
} from '\u0079\u006f\u0075\u0074\u0075\u0062\u0065i.js';

import { getNetFetchAsFetch } from '@/plugins/utils/main';
import { cleanupName, getImage } from '@/providers/song-info';

import { downloadChunks } from './download-chunks';

export type TrackMetadata = {
  videoId: string;
  title: string;
  artist: string;
  album?: string;
  duration: number;
  imageSrc?: string;
};

export type TrackFormat = {
  /** Preset extension; when falsy the container of the chosen format is used. */
  extension?: string | null;
  ffmpegArgs: string[];
  downloadType: 'audio' | 'video+audio';
  containerForItag?: (itag: number) => string;
};

export type TrackProgress =
  | { phase: 'resolved'; metadata: TrackMetadata }
  | { phase: 'downloading'; ratio: number }
  | { phase: 'loading' }
  | { phase: 'preparing' }
  | { phase: 'converting'; ratio: number }
  | { phase: 'saving' }
  | { phase: 'tagging' };

export type FetchTrackOptions = {
  videoId: string;
  directory: string;
  format: TrackFormat;
  trackId?: string;
  skipExisting?: boolean;
  onProgress?: (progress: TrackProgress) => void;
};

export type CachedTrack = {
  path: string;
  metadata: TrackMetadata;
  extension: string;
  skipped: boolean;
};

// youtubei.js cannot run the player decipher script without an evaluator.
Platform.shim.eval = (
  data: Types.BuildScriptResult,
  env: Record<string, Types.VMPrimative>,
) => {
  const properties = [];

  if (env.n) {
    properties.push(`n: exportedVars.nFunction("${env.n}")`);
  }

  if (env.sig) {
    properties.push(`sig: exportedVars.sigFunction("${env.sig}")`);
  }

  const code = `${data.output}\nreturn { ${properties.join(', ')} }`;

  // oxlint-disable-next-line typescript/no-unsafe-return,typescript/no-implied-eval,typescript/no-unsafe-call
  return new Function(code)();
};

const ffmpeg = lazyVar.lazy(async () =>
  (await import('@ffmpeg.wasm/main')).createFFmpeg({
    log: false,
    logger() {},
    progress() {},
  }),
);
const ffmpegMutex = new Mutex();

let innertube: Innertube | undefined;

export const getCookieFromWindow = async (win: BrowserWindow) => {
  return (
    await win.webContents.session.cookies.get({
      url: 'https://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com',
    })
  )
    .map((it) => it.name + '=' + it.value)
    .join(';');
};

/**
 * Shared Innertube instance with a PoToken, which is what lets full-length
 * tracks download despite the stream gating applied to bare URLs.
 */
export const getInnertube = async (win: BrowserWindow): Promise<Innertube> => {
  if (innertube) return innertube;

  const yt = await Innertube.create({
    cache: new UniversalCache(false),
    cookie: await getCookieFromWindow(win),
    generate_session_locally: true,
    fetch: getNetFetchAsFetch(),
  });

  const requestKey = 'O43z0dpjhgX20SCx4KAo';
  const visitorData = yt.session.context.client.visitorData;

  if (visitorData) {
    const cleanUp = (context: Partial<typeof globalThis>) => {
      delete context.window;
      delete context.document;
    };

    try {
      const [width, height] = win.getSize();
      // Emulate jsdom for the bgutils challenge using happy-dom.
      const window = new (await import('happy-dom')).Window({
        width,
        height,
        console,
      });
      const document = window.document;

      Object.assign(globalThis, {
        window,
        document,
      });

      const bgConfig: BgConfig = {
        fetch: getNetFetchAsFetch(),
        globalObj: globalThis,
        identifier: visitorData,
        requestKey,
      };

      const bgChallenge = await BG.Challenge.create(bgConfig);
      const interpreterJavascript =
        bgChallenge?.interpreterJavascript
          .privateDoNotAccessOrElseSafeScriptWrappedValue;

      if (interpreterJavascript) {
        // oxlint-disable-next-line typescript/no-implied-eval,typescript/no-unsafe-call
        new Function(interpreterJavascript)();

        const poTokenResult = await BG.PoToken.generate({
          program: bgChallenge.program,
          globalName: bgChallenge.globalName,
          bgConfig,
        }).finally(() => {
          cleanUp(globalThis);
        });

        yt.session.po_token = poTokenResult.poToken;
      } else {
        cleanUp(globalThis);
      }
    } catch {
      cleanUp(globalThis);
    }
  }

  innertube = yt;
  return yt;
};

const getVideoMetadata = (info: YTMusic.TrackInfo): TrackMetadata => ({
  videoId: info.basic_info.id!,
  title: cleanupName(info.basic_info.title!),
  artist: cleanupName(info.basic_info.author!),
  album:
    info.player_overlays?.browser_media_session?.as(YTNodes.BrowserMediaSession)
      .album?.text ?? '',
  imageSrc: info.basic_info.thumbnail?.find((t) => !t.url.endsWith('.webp'))
    ?.url,
  duration: info.basic_info.duration!,
});

const getAndroidTvInfo = async (id: string): Promise<YT.VideoInfo> => {
  if (!innertube) throw new Error('Innertube is not initialised');
  // getInfo 404s with this client, but getBasicInfo still returns streaming data.
  return await innertube.getBasicInfo(id, {
    client: 'TV_EMBEDDED',
  });
};

const iterableStreamToProcessedUint8Array = async (
  stream: AsyncGenerator<Uint8Array, void>,
  extension: string,
  metadata: TrackMetadata,
  presetFfmpegArgs: string[],
  contentLength: number,
  onProgress: (progress: TrackProgress) => void,
): Promise<Uint8Array | null> => {
  onProgress({ phase: 'loading' });

  const safeVideoName = randomBytes(32).toString('hex');

  return await ffmpegMutex.runExclusive(async () => {
    try {
      const ffmpegInstance = await ffmpeg.get();
      if (!ffmpegInstance.isLoaded()) {
        await ffmpegInstance.load();
      }

      onProgress({ phase: 'preparing' });
      ffmpegInstance.FS(
        'writeFile',
        safeVideoName,
        Buffer.concat(await downloadChunks(stream, contentLength, onProgress)),
      );

      onProgress({ phase: 'converting', ratio: 0 });

      ffmpegInstance.setProgress(({ ratio }) => {
        onProgress({ phase: 'converting', ratio });
      });

      const safeVideoNameWithExtension = `${safeVideoName}.${extension}`;
      try {
        await ffmpegInstance.run(
          '-i',
          safeVideoName,
          ...presetFfmpegArgs,
          ...getFFmpegMetadataArgs(metadata),
          safeVideoNameWithExtension,
        );
      } finally {
        ffmpegInstance.FS('unlink', safeVideoName);
      }

      onProgress({ phase: 'saving' });

      try {
        return ffmpegInstance.FS('readFile', safeVideoNameWithExtension);
      } finally {
        ffmpegInstance.FS('unlink', safeVideoNameWithExtension);
      }
    } catch (error: unknown) {
      throw error instanceof Error ? error : new Error(String(error));
    }
  });
};

const cropMaxWidth = (image: Electron.NativeImage) => {
  const imageSize = image.getSize();
  // Standard artwork width with margins from both sides is 280 + 720 + 280
  if (imageSize.width === 1280 && imageSize.height === 720) {
    return image.crop({
      x: 280,
      y: 0,
      width: 720,
      height: 720,
    });
  }

  return image;
};

const getCoverBuffer = async (url: string) => {
  const nativeImage = cropMaxWidth(await getImage(url));
  return nativeImage && !nativeImage.isEmpty() ? nativeImage.toPNG() : null;
};

const writeID3 = async (
  buffer: Buffer,
  metadata: TrackMetadata,
  trackId: string | undefined,
  onProgress: (progress: TrackProgress) => void,
) => {
  onProgress({ phase: 'tagging' });

  const tags: NodeID3.Tags = {};
  tags.title = metadata.title;
  tags.artist = metadata.artist;

  if (metadata.album) {
    tags.album = metadata.album;
  }

  if (metadata.imageSrc) {
    const coverBuffer = await getCoverBuffer(metadata.imageSrc);
    if (coverBuffer) {
      tags.image = {
        mime: 'image/png',
        type: {
          id: NodeID3.TagConstants.AttachedPicture.PictureType.FRONT_COVER,
        },
        description: 'thumbnail',
        imageBuffer: coverBuffer,
      };
    }
  }

  if (trackId) {
    tags.trackNumber = trackId;
  }

  return NodeID3.write(tags, buffer);
};

const getFFmpegMetadataArgs = (metadata: TrackMetadata) => {
  if (!metadata) return [];

  return [
    ...(metadata.title ? ['-metadata', `title=${metadata.title}`] : []),
    ...(metadata.artist ? ['-metadata', `artist=${metadata.artist}`] : []),
    ...(metadata.album ? ['-metadata', `album=${metadata.album}`] : []),
  ];
};

/**
 * Resolve, download and convert a track to a local file.
 *
 * Throws on unplayable tracks or download failures; the caller owns any UI
 * feedback. The returned path already exists on disk.
 */
export const fetchTrack = async (
  win: BrowserWindow,
  options: FetchTrackOptions,
): Promise<CachedTrack> => {
  const { videoId, directory, format, trackId, skipExisting } = options;
  const onProgress = options.onProgress ?? (() => {});

  const yt = await getInnertube(win);

  let info: YTMusic.TrackInfo | YT.VideoInfo = await yt.music.getInfo(videoId);

  if (!info) {
    throw new Error(`Video id not found: ${videoId}`);
  }

  const metadata = getVideoMetadata(info);
  if (metadata.album === 'N/A') {
    metadata.album = '';
  }

  onProgress({ phase: 'resolved', metadata });

  let playabilityStatus = info.playability_status;
  let bypassedResult: YT.VideoInfo;
  if (playabilityStatus?.status === 'LOGIN_REQUIRED') {
    // Try to bypass the age restriction
    bypassedResult = await getAndroidTvInfo(videoId);
    playabilityStatus = bypassedResult.playability_status;

    if (playabilityStatus?.status === 'LOGIN_REQUIRED') {
      throw new Error(
        `[${playabilityStatus.status}] ${playabilityStatus.reason}`,
      );
    }

    info = bypassedResult;
  }

  if (playabilityStatus?.status === 'UNPLAYABLE') {
    const errorScreen =
      playabilityStatus.error_screen as YTNodes.PlayerErrorMessage | null;
    throw new Error(
      `[${playabilityStatus.status}] ${errorScreen?.reason.text}: ${errorScreen?.subreason.text}`,
    );
  }

  const downloadOptions: Types.FormatOptions = {
    type: format.downloadType,
    quality: 'best',
    format: 'any',
  };

  const chosenFormat = info.chooseFormat(downloadOptions);
  const extension =
    format.extension || format.containerForItag?.(chosenFormat.itag) || 'mp3';

  const name = `${metadata.artist ? `${metadata.artist} - ` : ''}${metadata.title}`;
  let filename = filenamify(`${name}.${extension}`, {
    replacement: '_',
    maxLength: 255,
  });
  if (!is.macOS()) {
    filename = filename.normalize('NFC');
  }

  const filePath = join(directory, filename);

  if (skipExisting && existsSync(filePath)) {
    return { path: filePath, metadata, extension, skipped: true };
  }

  const stream = await info.download(downloadOptions);

  if (!existsSync(directory)) {
    mkdirSync(directory, { recursive: true });
  }

  let fileBuffer = await iterableStreamToProcessedUint8Array(
    Utils.streamToIterable(stream),
    extension,
    metadata,
    format.ffmpegArgs,
    chosenFormat.content_length ?? 0,
    onProgress,
  );

  if (fileBuffer && extension === 'mp3') {
    fileBuffer = await writeID3(
      Buffer.from(fileBuffer),
      metadata,
      trackId,
      onProgress,
    );
  }

  if (!fileBuffer) {
    throw new Error(`Failed to process track ${videoId}`);
  }

  writeFileSync(filePath, fileBuffer);

  return { path: filePath, metadata, extension, skipped: false };
};
