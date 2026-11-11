export interface SpotifyTrack {
  title: string;
  artists: string;
  uri?: string;
}

export function parseSpotifyPlaylistId(input: string): string | null {
  const trimmed = input.trim();
  if (/^[A-Za-z0-9]{22}$/.test(trimmed)) return trimmed;
  const match = trimmed.match(/playlist[/:]([A-Za-z0-9]{22})/);
  return match ? match[1] : null;
}

export function parseSpotifyEmbed(html: string): SpotifyTrack[] {
  const match = html.match(
    /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
  );
  if (!match) throw new Error('Spotify embed data not found in page');

  const data = JSON.parse(match[1]) as {
    props?: {
      pageProps?: {
        state?: {
          data?: { entity?: { trackList?: Array<Record<string, unknown>> } };
        };
      };
    };
  };

  const trackList =
    data?.props?.pageProps?.state?.data?.entity?.trackList ?? [];

  const tracks: SpotifyTrack[] = [];
  for (const track of trackList) {
    const title = typeof track.title === 'string' ? track.title : '';
    if (!title) continue;
    tracks.push({
      title,
      artists: typeof track.subtitle === 'string' ? track.subtitle : '',
      uri: typeof track.uri === 'string' ? track.uri : undefined,
    });
  }
  return tracks;
}
