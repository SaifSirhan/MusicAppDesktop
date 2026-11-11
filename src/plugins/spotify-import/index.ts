import prompt from 'custom-electron-prompt';
import { dialog } from 'electron';

import { createPlugin } from '@/utils';

import { parseSpotifyEmbed, parseSpotifyPlaylistId } from './parse';

const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

// Search results are a union of node types; only some carry a video id.
const firstVideoId = (videos: unknown): string | undefined => {
  if (!Array.isArray(videos)) return undefined;
  for (const video of videos) {
    if (video && typeof video === 'object' && 'video_id' in video) {
      const id = (video as { video_id?: unknown }).video_id;
      if (typeof id === 'string' && id.length > 0) return id;
    }
  }
  return undefined;
};

export default createPlugin({
  name: () => 'Spotify Import',
  description: () =>
    'Import a public Spotify playlist link and queue its tracks on YouTube Music.',
  restartNeeded: false,
  config: {
    enabled: true,
  },
  menu({ window }) {
    return [
      {
        label: 'Import Spotify playlist…',
        async click() {
          const url = await prompt(
            {
              title: 'Import Spotify playlist',
              label: 'Paste a public Spotify playlist link:',
              value: '',
              type: 'input',
              inputAttrs: {
                type: 'text',
                placeholder: 'https://open.spotify.com/playlist/…',
              },
              width: 560,
              height: 190,
            },
            window,
          );
          if (!url) return;

          const playlistId = parseSpotifyPlaylistId(url);
          if (!playlistId) {
            await dialog.showMessageBox(window, {
              type: 'error',
              message: 'That does not look like a Spotify playlist link.',
            });
            return;
          }

          try {
            const response = await fetch(
              `https://open.spotify.com/embed/playlist/${playlistId}`,
              { headers: { 'user-agent': 'Mozilla/5.0' } },
            );
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const tracks = parseSpotifyEmbed(await response.text());
            if (tracks.length === 0) {
              throw new Error('No tracks found in that playlist.');
            }

            const { Innertube } = await import('youtubei.js');
            const yt = await Innertube.create();

            let queued = 0;
            for (const track of tracks) {
              const query = `${track.title} ${track.artists}`.trim();
              try {
                const results = await yt.search(query);
                const videoId = firstVideoId(results.videos);
                if (videoId) {
                  window.webContents.send(
                    'peard:add-to-queue',
                    videoId,
                    'INSERT_AT_END',
                  );
                  queued += 1;
                }
              } catch {
                // skip a track that fails to resolve
              }
              await delay(250);
            }

            await dialog.showMessageBox(window, {
              type: 'info',
              message: `Queued ${queued} of ${tracks.length} Spotify tracks on YouTube Music.`,
            });
          } catch (error) {
            await dialog.showMessageBox(window, {
              type: 'error',
              message: 'Spotify import failed',
              detail: error instanceof Error ? error.message : String(error),
            });
          }
        },
      },
    ];
  },
});
