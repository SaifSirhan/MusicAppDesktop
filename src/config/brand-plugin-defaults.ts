export const brandPluginDefaults = {
  'do-not-track': {
    enabled: true,
    cache: true,
    blocker: 'In player',
    additionalBlockLists: [],
    disableDefaultLists: false,
  },
  'precise-volume': { enabled: true },
  'playback-speed': { enabled: true },
  'shortcuts': { enabled: true },
  'taskbar-mediacontrol': { enabled: true },
  'notifications': { enabled: true },
  'spotify-import': { enabled: true },
} as const;
