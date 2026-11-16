import { describe, expect, it } from 'vitest';

import { barsFromPeaks } from '../../src/plugins/mixer/renderer/waveform';

describe('barsFromPeaks', () => {
  it('returns one value per column', () => {
    const bars = barsFromPeaks(new Float32Array([0.2, 0.4, 0.6, 0.8]), 4);

    expect(bars[0]).toBeCloseTo(0.2, 6);
    expect(bars[1]).toBeCloseTo(0.4, 6);
    expect(bars[2]).toBeCloseTo(0.6, 6);
    expect(bars[3]).toBeCloseTo(0.8, 6);
  });

  it('downsamples and upsamples without leaving [0, 1]', () => {
    const bars = barsFromPeaks(new Float32Array([0, 0.5, 1]), 6);

    expect(bars).toHaveLength(6);
    for (const bar of bars) {
      expect(bar).toBeGreaterThanOrEqual(0);
      expect(bar).toBeLessThanOrEqual(1);
    }
    expect(bars[0]).toBe(0);
    expect(bars.at(-1)).toBe(1);
  });

  it('returns an empty list for an empty buffer or non-positive width', () => {
    expect(barsFromPeaks(new Float32Array(0), 10)).toEqual([]);
    expect(barsFromPeaks(new Float32Array([0.5]), 0)).toEqual([]);
    expect(barsFromPeaks(new Float32Array([0.5]), Number.NaN)).toEqual([]);
  });
});
