import { describe, expect, it } from 'vitest';

import {
  paletteById,
  paletteSelectValue,
  THEME_PALETTES,
} from '../../src/appearance/palettes';
import { normalizeHex, relativeLuminance } from '../../src/appearance/theme';

const contrastRatio = (a: string, b: string): number => {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  return (
    (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
  );
};

describe('theme palettes', () => {
  it('has unique ids and names', () => {
    expect(new Set(THEME_PALETTES.map((palette) => palette.id)).size).toBe(
      THEME_PALETTES.length,
    );
    expect(new Set(THEME_PALETTES.map((palette) => palette.name)).size).toBe(
      THEME_PALETTES.length,
    );
  });

  it('uses valid six digit colours', () => {
    for (const palette of THEME_PALETTES) {
      for (const color of [
        palette.background,
        palette.accent,
        palette.accent2,
      ]) {
        expect(normalizeHex(color, '')).toBe(color);
      }
    }
  });

  it('keeps the accent readable on its background', () => {
    for (const palette of THEME_PALETTES) {
      expect(
        contrastRatio(palette.accent, palette.background),
        palette.name,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it('resolves ids and select values', () => {
    expect(paletteById('deep-field')?.name).toBe('Deep Field');
    expect(paletteById('nope')).toBeUndefined();
    expect(paletteSelectValue('noir')).toBe('palette:noir');
  });
});
