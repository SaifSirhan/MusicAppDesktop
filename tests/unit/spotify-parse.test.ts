import { expect, test } from 'vitest';

import {
  parseSpotifyEmbed,
  parseSpotifyPlaylistId,
} from '../../src/plugins/spotify-import/parse';

const html = `<html><head><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(
  {
    props: {
      pageProps: {
        state: {
          data: {
            entity: {
              trackList: [
                { title: 'Song A', subtitle: 'Artist X', uri: 'spotify:track:1' },
                {
                  title: 'Song B',
                  subtitle: 'Artist Y, Artist Z',
                  uri: 'spotify:track:2',
                },
                { title: '', subtitle: 'skip me' },
              ],
            },
          },
        },
      },
    },
  },
)}</script></head></html>`;

test('parses a playlist id from a URL, URI, or raw id', () => {
  expect(
    parseSpotifyPlaylistId(
      'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc',
    ),
  ).toBe('37i9dQZF1DXcBWIGoYBM5M');
  expect(parseSpotifyPlaylistId('spotify:playlist:37i9dQZF1DXcBWIGoYBM5M')).toBe(
    '37i9dQZF1DXcBWIGoYBM5M',
  );
  expect(parseSpotifyPlaylistId('37i9dQZF1DXcBWIGoYBM5M')).toBe(
    '37i9dQZF1DXcBWIGoYBM5M',
  );
  expect(
    parseSpotifyPlaylistId('https://open.spotify.com/track/abc'),
  ).toBeNull();
});

test('parses the embed trackList into title/artist tracks, skipping empties', () => {
  expect(parseSpotifyEmbed(html)).toEqual([
    { title: 'Song A', artists: 'Artist X', uri: 'spotify:track:1' },
    { title: 'Song B', artists: 'Artist Y, Artist Z', uri: 'spotify:track:2' },
  ]);
});

test('throws when the embed data is absent', () => {
  expect(() => parseSpotifyEmbed('<html></html>')).toThrow();
});
