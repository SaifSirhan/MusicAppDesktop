import { describe, expect, it } from 'vitest';

import {
  isLikelyMusicAlbum,
  normalizeArtist,
  parseLastfmListeners,
  pickRandom,
  selectUnderground,
  trackArtistNames,
  uniqueArtists,
  type TrackRef,
} from '../../src/plugins/discovery/discovery';

describe('isLikelyMusicAlbum', () => {
  it('accepts normal album titles', () => {
    expect(isLikelyMusicAlbum('Random Access Memories')).toBe(true);
    expect(isLikelyMusicAlbum('Grace')).toBe(true);
  });

  it('rejects soundtracks, karaoke, covers and other non-albums', () => {
    expect(
      isLikelyMusicAlbum('Scene (Original Motion Picture Soundtrack)'),
    ).toBe(false);
    expect(isLikelyMusicAlbum('Karaoke Hits Vol. 3')).toBe(false);
    expect(isLikelyMusicAlbum('A Tribute to Queen')).toBe(false);
    expect(isLikelyMusicAlbum('Rain Sounds for Sleep')).toBe(false);
    expect(isLikelyMusicAlbum('  ')).toBe(false);
  });
});

describe('pickRandom', () => {
  it('returns undefined for an empty list', () => {
    expect(pickRandom([], () => 0)).toBeUndefined();
  });

  it('stays inside the list for edge random values', () => {
    expect(pickRandom(['a', 'b', 'c'], () => 0)).toBe('a');
    expect(pickRandom(['a', 'b', 'c'], () => 0.999)).toBe('c');
    expect(pickRandom(['a', 'b', 'c'], () => 1)).toBe('c');
  });
});

describe('normalizeArtist', () => {
  it('lowercases, drops Topic suffix and squeezes spaces', () => {
    expect(normalizeArtist('  Daft   Punk - Topic ')).toBe('daft punk');
    expect(normalizeArtist('Billie Holiday')).toBe('billie holiday');
  });
});

describe('parseLastfmListeners', () => {
  it('reads numeric and string listener counts', () => {
    expect(
      parseLastfmListeners({ artist: { stats: { listeners: 42000 } } }),
    ).toBe(42000);
    expect(
      parseLastfmListeners({ artist: { stats: { listeners: '999' } } }),
    ).toBe(999);
  });

  it('returns undefined for malformed payloads', () => {
    expect(parseLastfmListeners(null)).toBeUndefined();
    expect(parseLastfmListeners({})).toBeUndefined();
    expect(parseLastfmListeners({ artist: { stats: {} } })).toBeUndefined();
    expect(
      parseLastfmListeners({ artist: { stats: { listeners: 'abc' } } }),
    ).toBeUndefined();
  });
});

describe('selectUnderground', () => {
  const tracks: TrackRef[] = [
    { videoId: '1', artists: ['Small Band'] },
    { videoId: '2', artists: ['Big Star'] },
    { videoId: '3', artists: ['Unknown Act'] },
    { videoId: '4' },
  ];
  const counts = new Map([
    ['small band', 12_000],
    ['big star', 4_000_000],
  ]);

  it('keeps only tracks whose artists are known and below the limit', () => {
    expect(selectUnderground(tracks, counts).map((t) => t.videoId)).toEqual([
      '1',
    ]);
  });

  it('treats the limit as exclusive', () => {
    const exact = new Map([['small band', 100_000]]);
    expect(selectUnderground(tracks.slice(0, 1), exact)).toEqual([]);
  });

  it('drops tracks with missing artist data', () => {
    expect(selectUnderground(tracks.slice(3), counts)).toEqual([]);
  });
});

describe('artist helpers', () => {
  it('prefers artists and falls back to author', () => {
    expect(trackArtistNames({ artists: [{ name: 'A' }] })).toEqual(['A']);
    expect(trackArtistNames({ author: { name: 'B' } })).toEqual(['B']);
    expect(trackArtistNames({})).toEqual([]);
  });

  it('dedupes artists case-insensitively', () => {
    expect(
      uniqueArtists([
        { videoId: '1', artists: ['Daft Punk'] },
        { videoId: '2', artists: ['daft punk'] },
        { videoId: '3', artists: ['Justice'] },
      ]),
    ).toEqual(['Daft Punk', 'Justice']);
  });
});
