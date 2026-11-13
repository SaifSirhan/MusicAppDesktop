import { describe, expect, it } from 'vitest';

import {
  bufferPeaks,
  computePeaks,
} from '../../src/plugins/mixer/renderer/waveform';

describe('computePeaks', () => {
  it('returns zeros for empty input', () => {
    expect(Array.from(computePeaks(new Float32Array(0), 4))).toEqual([
      0, 0, 0, 0,
    ]);
  });

  it('downsamples to the maximum absolute amplitude per bucket', () => {
    const samples = new Float32Array([0.5, -0.9, 0.1, 0.2]);
    const peaks = computePeaks(samples, 2);

    expect(peaks[0]).toBeCloseTo(0.9, 6);
    expect(peaks[1]).toBeCloseTo(0.2, 6);
  });

  it('handles more buckets than samples and clamps amplitude', () => {
    const samples = new Float32Array([2, -0.25]);
    const peaks = computePeaks(samples, 4);

    expect(peaks).toHaveLength(4);
    expect(peaks[0]).toBe(1);
    expect(peaks[1]).toBeCloseTo(0.25, 6);
    expect(peaks[2]).toBeCloseTo(0.25, 6);
    expect(peaks[3]).toBeCloseTo(0.25, 6);
  });

  it('always produces at least one bucket', () => {
    expect(computePeaks(new Float32Array([0.3]), 0)).toHaveLength(1);
    expect(computePeaks(new Float32Array([0.3]), -2)[0]).toBeCloseTo(0.3, 6);
  });

  it('keeps the tail audible when buckets exceed samples', () => {
    const peaks = computePeaks(new Float32Array([0.5, 0.9]), 10);

    expect(peaks).toHaveLength(10);
    expect(peaks[0]).toBeCloseTo(0.5, 6);
    expect(peaks[9]).toBeCloseTo(0.9, 6);
    expect(Math.min(...peaks)).toBeGreaterThan(0);
  });

  it('falls back to one bucket for a non-finite bucket count', () => {
    expect(computePeaks(new Float32Array([0.4, 0.8]), Number.NaN)).toHaveLength(
      1,
    );
  });
});

describe('bufferPeaks', () => {
  it('reads channel zero of an AudioBuffer', () => {
    const buffer = {
      duration: 1,
      getChannelData: () => new Float32Array([0.1, -0.6, 0.4, 0.2]),
    } as unknown as AudioBuffer;

    const peaks = bufferPeaks(buffer, 2);
    expect(peaks[0]).toBeCloseTo(0.6, 6);
    expect(peaks[1]).toBeCloseTo(0.4, 6);
  });
});
