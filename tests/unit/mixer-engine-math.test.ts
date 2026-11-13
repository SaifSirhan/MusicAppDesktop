import { describe, expect, it } from 'vitest';

import {
  clampTempo,
  crossfaderGains,
} from '../../src/plugins/mixer/renderer/engine';

const close = (value: number, expected: number) =>
  expect(value).toBeCloseTo(expected, 6);

describe('crossfaderGains', () => {
  it('is equal-power at the ends and centre', () => {
    const left = crossfaderGains(-1);
    close(left.a, 1);
    close(left.b, 0);

    const centre = crossfaderGains(0);
    close(centre.a, Math.SQRT1_2);
    close(centre.b, Math.SQRT1_2);

    const right = crossfaderGains(1);
    close(right.a, 0);
    close(right.b, 1);
  });

  it('keeps constant power across the sweep', () => {
    for (const position of [-1, -0.5, 0, 0.5, 1]) {
      const { a, b } = crossfaderGains(position);
      close(a * a + b * b, 1);
    }
  });

  it('is monotonic and clamps out-of-range input', () => {
    expect(crossfaderGains(-0.5).a).toBeGreaterThan(crossfaderGains(0).a);
    expect(crossfaderGains(0.5).b).toBeGreaterThan(crossfaderGains(0).b);
    expect(crossfaderGains(-4)).toEqual(crossfaderGains(-1));
    expect(crossfaderGains(9)).toEqual(crossfaderGains(1));
    expect(crossfaderGains(Number.NaN)).toEqual(crossfaderGains(0));
  });
});

describe('clampTempo', () => {
  it('clamps to the allowed range', () => {
    expect(clampTempo(0.5)).toBe(0.92);
    expect(clampTempo(1.08)).toBe(1.08);
    expect(clampTempo(2)).toBe(1.08);
  });

  it('falls back to 1 for non-finite input', () => {
    expect(clampTempo(Number.NaN)).toBe(1);
    expect(clampTempo(Number.POSITIVE_INFINITY)).toBe(1);
  });
});
