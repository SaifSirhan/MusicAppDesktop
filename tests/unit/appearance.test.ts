import { expect, test } from 'vitest';

import {
  buildAppearanceCss,
  parseAppearancePreset,
} from '../../src/appearance/buildCss';

test('default preset injects no CSS', () => {
  expect(buildAppearanceCss('default', '.p{}', '.d{}')).toBe('');
});

test('docker preset injects the Docker accent CSS', () => {
  expect(buildAppearanceCss('docker', '.p{}', '.d{}')).toBe('.d{}');
});

test('phosphor preset injects the bundled CSS verbatim', () => {
  expect(buildAppearanceCss('phosphor', '.p{}', '.d{}')).toBe('.p{}');
});

test('unknown preset values fall back to default', () => {
  expect(parseAppearancePreset('neon')).toBe('default');
  expect(parseAppearancePreset(undefined)).toBe('default');
  expect(parseAppearancePreset('phosphor')).toBe('phosphor');
  expect(parseAppearancePreset('docker')).toBe('docker');
  expect(parseAppearancePreset('custom')).toBe('custom');
});

test('custom preset builds CSS from the solid colours', () => {
  const css = buildAppearanceCss('custom', '.p{}', '.d{}', {
    background: '#ffffff',
    accent: '#ff0000',
    accent2: '#00ff00',
  });
  expect(css).toContain('color-scheme: light');
  expect(css).toContain('--ma-accent: #ff0000');
  expect(css).toContain('--ma-bg: #ffffff');
});
