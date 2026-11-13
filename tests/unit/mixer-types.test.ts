import { describe, expect, it } from 'vitest';

import {
  defaultMixerConfig,
  VIDEO_ID_PATTERN,
} from '../../src/plugins/mixer/types';

describe('mixer defaults', () => {
  it('ships disabled with a 2 GB cache cap and pre-cache on', () => {
    expect(defaultMixerConfig).toEqual({
      enabled: false,
      cacheMaxBytes: 2 * 1024 * 1024 * 1024,
      preCache: true,
    });
  });

  it('accepts YouTube video ids and rejects garbage', () => {
    expect(VIDEO_ID_PATTERN.test('dQw4w9WgXcQ')).toBe(true);
    expect(VIDEO_ID_PATTERN.test('28jp-30w8Lg')).toBe(true);
    expect(VIDEO_ID_PATTERN.test('bad id!')).toBe(false);
    expect(VIDEO_ID_PATTERN.test('')).toBe(false);
  });
});
