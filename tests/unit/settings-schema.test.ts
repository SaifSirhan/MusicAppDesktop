import { describe, expect, it } from 'vitest';

import {
  settingsSections,
  trayFlagsFromMode,
  trayModeFromFlags,
} from '../../src/plugins/in-app-menu/settings-schema';

describe('settings schema', () => {
  const rows = settingsSections.flatMap((section) => section.rows);

  it('has unique setting keys', () => {
    const keys = rows.map((row) => row.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('gives every row a label and description', () => {
    for (const row of rows) {
      expect(row.label.length).toBeGreaterThan(0);
      expect(row.description.length).toBeGreaterThan(0);
    }
  });

  it('offers options for every select', () => {
    for (const row of rows) {
      if (row.kind !== 'select') continue;
      if (row.dynamicOptions === 'languages') continue;
      expect(row.options?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('maps tray flags to a mode and back', () => {
    expect(trayModeFromFlags(false, true)).toBe('off');
    expect(trayModeFromFlags(true, true)).toBe('show');
    expect(trayModeFromFlags(true, false)).toBe('hide');

    expect(trayFlagsFromMode('off')).toEqual({
      tray: false,
      appVisible: true,
    });
    expect(trayFlagsFromMode('show')).toEqual({
      tray: true,
      appVisible: true,
    });
    expect(trayFlagsFromMode('hide')).toEqual({
      tray: true,
      appVisible: false,
    });
    expect(trayFlagsFromMode('nonsense')).toEqual({
      tray: true,
      appVisible: true,
    });
  });
});
