import { describe, expect, it } from 'vitest';

import {
  formatTime,
  toQueueItems,
} from '../../src/plugins/mixer/renderer/session';

const entry = (
  videoId: string,
  title: string,
  artist: string,
  length: string,
  thumb = 'https://img/small.jpg',
) => ({
  playlistPanelVideoRenderer: {
    title: { runs: [{ text: title }] },
    longBylineText: { runs: [{ text: artist }, { text: ' • ' }] },
    lengthText: { runs: [{ text: length }] },
    thumbnail: {
      thumbnails: [
        { url: thumb, width: 60, height: 60 },
        { url: 'https://img/large.jpg', width: 226, height: 226 },
      ],
    },
    navigationEndpoint: { watchEndpoint: { videoId } },
  },
});

describe('toQueueItems', () => {
  it('maps YTM queue entries to mixer entries', () => {
    const items = toQueueItems([entry('abc123', 'Song', 'Artist', '3:07')]);

    expect(items).toEqual([
      {
        videoId: 'abc123',
        title: 'Song',
        artist: 'Artist',
        duration: 187,
        thumbnail: 'https://img/large.jpg',
      },
    ]);
  });

  it('parses hour-long lengths', () => {
    expect(toQueueItems([entry('x1', 'Long', 'A', '1:02:03')])[0].duration).toBe(
      3723,
    );
  });

  it('skips unplayable entries and duplicates', () => {
    const items = toQueueItems([
      entry('dup', 'One', 'A', '1:00'),
      entry('dup', 'One again', 'A', '1:00'),
      { playlistPanelVideoRenderer: { title: { runs: [] } } },
      { somethingElse: true },
      entry('two', 'Two', 'B', '2:00'),
    ]);

    expect(items.map((item) => item.videoId)).toEqual(['dup', 'two']);
    expect(items[0].title).toBe('One');
  });

  it('survives missing artist, length and thumbnails', () => {
    const items = toQueueItems([
      {
        playlistPanelVideoRenderer: {
          title: { runs: [{ text: 'Bare' }] },
          navigationEndpoint: { watchEndpoint: { videoId: 'bare1' } },
        },
      },
    ]);

    expect(items[0]).toEqual({
      videoId: 'bare1',
      title: 'Bare',
      artist: '',
      duration: 0,
      thumbnail: undefined,
    });
  });

  it('returns an empty list for garbage input', () => {
    expect(toQueueItems([])).toEqual([]);
    expect(toQueueItems([null, 42, 'x'] as unknown[])).toEqual([]);
  });

  it('keeps wrapper-only rows through their primary renderer', () => {
    const items = toQueueItems([
      {
        playlistPanelVideoWrapperRenderer: {
          primaryRenderer: entry('wrapped1', 'Segmented', 'Artist', '4:10'),
        },
      },
    ]);

    expect(items).toEqual([
      {
        videoId: 'wrapped1',
        title: 'Segmented',
        artist: 'Artist',
        duration: 250,
        thumbnail: 'https://img/large.jpg',
      },
    ]);
  });
});

describe('formatTime', () => {
  it('formats minutes and hours', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(7)).toBe('0:07');
    expect(formatTime(187)).toBe('3:07');
    expect(formatTime(3723)).toBe('1:02:03');
  });

  it('clamps invalid input', () => {
    expect(formatTime(-5)).toBe('0:00');
    expect(formatTime(Number.NaN)).toBe('0:00');
    expect(formatTime(59.9)).toBe('0:59');
  });
});
