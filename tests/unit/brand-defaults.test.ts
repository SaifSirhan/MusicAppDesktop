import { expect, test } from 'vitest';

import { brandPluginDefaults } from '../../src/config/brand-plugin-defaults';

test('adblocker and QoL plugins are enabled by default', () => {
  expect(brandPluginDefaults['do-not-track'].enabled).toBe(true);
  expect(brandPluginDefaults['precise-volume'].enabled).toBe(true);
  expect(brandPluginDefaults['playback-speed'].enabled).toBe(true);
  expect(brandPluginDefaults.shortcuts.enabled).toBe(true);
  expect(brandPluginDefaults['taskbar-mediacontrol'].enabled).toBe(true);
  expect(brandPluginDefaults.notifications.enabled).toBe(true);
});

test('crossfade and skip-silences stay off', () => {
  expect('crossfade' in brandPluginDefaults).toBe(false);
  expect('skip-silences' in brandPluginDefaults).toBe(false);
});
