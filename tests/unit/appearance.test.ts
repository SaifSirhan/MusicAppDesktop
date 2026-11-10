import { expect, test } from 'vitest';

import {
  buildAppearanceCss,
  parseAppearancePreset,
} from '../../src/appearance/buildCss';

test('default preset injects no CSS', () => {
  expect(buildAppearanceCss('default', '.x { color: red; }')).toBe('');
});

test('phosphor preset injects the bundled CSS verbatim', () => {
  expect(buildAppearanceCss('phosphor', '.x { color: red; }')).toBe(
    '.x { color: red; }',
  );
});

test('unknown preset values fall back to default', () => {
  expect(parseAppearancePreset('neon')).toBe('default');
  expect(parseAppearancePreset(undefined)).toBe('default');
  expect(parseAppearancePreset('phosphor')).toBe('phosphor');
});
