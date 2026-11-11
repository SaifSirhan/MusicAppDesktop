import { describe, expect, it } from 'vitest';

import {
  buildSolidThemeCss,
  isLightTheme,
  normalizeHex,
  readableInk,
  relativeLuminance,
} from '../../src/appearance/theme';

describe('normalizeHex', () => {
  it('expands shorthand and lowercases', () => {
    expect(normalizeHex('#ABC', '#000000')).toBe('#aabbcc');
    expect(normalizeHex('1D63ED', '#000000')).toBe('#1d63ed');
  });

  it('falls back on invalid input', () => {
    expect(normalizeHex('nope', '#112233')).toBe('#112233');
    expect(normalizeHex(undefined, '#112233')).toBe('#112233');
    expect(normalizeHex('#12345', '#112233')).toBe('#112233');
  });
});

describe('contrast', () => {
  it('picks light ink on dark and dark ink on light', () => {
    expect(readableInk('#000000')).toBe('#f5f7fa');
    expect(readableInk('#ffffff')).toBe('#141414');
    expect(readableInk('#0f0f0f')).toBe('#f5f7fa');
  });

  it('detects light themes', () => {
    expect(isLightTheme('#ffffff')).toBe(true);
    expect(isLightTheme('#d8cf9f')).toBe(true);
    expect(isLightTheme('#0f0f0f')).toBe(false);
  });

  it('luminance stays inside 0..1', () => {
    for (const hex of ['#000000', '#ffffff', '#1d63ed', '#ff5fae']) {
      const value = relativeLuminance(hex);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});

describe('buildSolidThemeCss', () => {
  it('maps custom colours onto YouTube Music tokens', () => {
    const css = buildSolidThemeCss({
      background: '#101820',
      accent: '#33ccaa',
      accent2: '#ffaa00',
    });
    expect(css).toContain('--ma-bg: #101820');
    expect(css).toContain('--ma-accent: #33ccaa');
    expect(css).toContain('--ma-accent-2: #ffaa00');
    expect(css).toContain('--yt-spec-call-to-action: var(--ma-accent)');
    expect(css).toContain('--paper-slider-knob-color: var(--ma-accent)');
    expect(css).toContain('color-scheme: dark');
  });

  it('switches colour-scheme for light backgrounds', () => {
    const css = buildSolidThemeCss({
      background: '#faf8f4',
      accent: '#c2410c',
      accent2: '#f59e0b',
    });
    expect(css).toContain('color-scheme: light');
    expect(css).toContain('--ma-ink: #141414');
  });

  it('sanitises invalid colours instead of emitting them', () => {
    const css = buildSolidThemeCss({
      background: 'javascript:alert(1)',
      accent: '#zzzzzz',
      accent2: '',
    });
    expect(css).toContain('--ma-bg: #0f0f0f');
    expect(css).toContain('--ma-accent: #1d63ed');
    expect(css).not.toContain('javascript');
  });
});
