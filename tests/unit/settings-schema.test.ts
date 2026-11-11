import { describe, expect, it } from 'vitest';

import {
  nearestStop,
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

  it('gives every range row ascending stops starting at 0', () => {
    for (const row of rows) {
      if (row.kind !== 'range') continue;
      expect(row.stops.length).toBeGreaterThan(1);
      expect(row.stops[0]).toBe(0);
      const sorted = [...row.stops].sort((a, b) => a - b);
      expect(row.stops).toEqual(sorted);
    }
  });

  it('snaps a stored crossfade value to the closest stop', () => {
    const stops = [0, 5, 10, 20, 30, 50];
    expect(nearestStop(stops, 0)).toBe(0);
    expect(nearestStop(stops, 7)).toBe(5);
    expect(nearestStop(stops, 20)).toBe(20);
    expect(nearestStop(stops, 34)).toBe(30);
    expect(nearestStop(stops, 80)).toBe(50);
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
