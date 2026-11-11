import { startingPages } from '../../providers/extracted-data';

export type SettingApply = 'live' | 'reload' | 'restart';

export interface SettingOption {
  value: string;
  label: string;
}

interface SettingRowBase {
  key: string;
  label: string;
  description: string;
}

export interface SwitchRow extends SettingRowBase {
  kind: 'switch';
  apply: SettingApply;
}

export interface SelectRow extends SettingRowBase {
  kind: 'select';
  apply: SettingApply;
  options?: SettingOption[];
  dynamicOptions?: 'languages';
}

export interface TextRow extends SettingRowBase {
  kind: 'text';
  apply: SettingApply;
  placeholder?: string;
}

export interface ColorRow extends SettingRowBase {
  kind: 'color';
  apply: SettingApply;
  fallback: string;
}

export interface RangeRow extends SettingRowBase {
  kind: 'range';
  apply: SettingApply;
  stops: number[];
}

export type SettingRow = SwitchRow | SelectRow | TextRow | ColorRow | RangeRow;

export const nearestStop = (stops: number[], value: number): number =>
  stops.reduce(
    (closest, stop) =>
      Math.abs(stop - value) < Math.abs(closest - value) ? stop : closest,
    stops[0],
  );

export interface SettingSection {
  id: string;
  title: string;
  rows: SettingRow[];
}

const startingPageOptions: SettingOption[] = Object.keys(startingPages)
  .filter((name) => name !== 'Default')
  .map((name) => ({ value: name, label: name }));

export const settingsSections: SettingSection[] = [
  {
    id: 'general',
    title: 'General',
    rows: [
      {
        kind: 'switch',
        key: 'options.autoUpdates',
        label: 'Auto update',
        description: 'Check GitHub for a newer build when the app starts.',
        apply: 'restart',
      },
      {
        kind: 'switch',
        key: 'options.resumeOnStart',
        label: 'Resume last song',
        description: 'Restore the last played song and position on launch.',
        apply: 'reload',
      },
      {
        kind: 'select',
        key: 'options.startingPage',
        label: 'Starting page',
        description: 'Page opened when the app launches.',
        apply: 'reload',
        options: [
          { value: '', label: 'Default' },
          ...startingPageOptions,
        ],
      },
      {
        kind: 'select',
        key: 'options.language',
        label: 'Language',
        description: 'Menu language. Page text follows YouTube Music.',
        apply: 'reload',
        dynamicOptions: 'languages',
      },
      {
        kind: 'switch',
        key: 'options.startAtLogin',
        label: 'Start at login',
        description: 'Open MusicApp when you sign in to Windows.',
        apply: 'restart',
      },
      {
        kind: 'select',
        key: 'trayMode',
        label: 'Tray',
        description: 'Where the app lives when you close the window.',
        apply: 'restart',
        options: [
          { value: 'off', label: 'Off' },
          { value: 'show', label: 'Tray + window' },
          { value: 'hide', label: 'Tray only' },
        ],
      },
      {
        kind: 'switch',
        key: 'options.trayClickPlayPause',
        label: 'Tray click toggles playback',
        description: 'Clicking the tray icon plays or pauses.',
        apply: 'restart',
      },
    ],
  },
  {
    id: 'appearance',
    title: 'Appearance',
    rows: [
      {
        kind: 'select',
        key: 'appearance.preset',
        label: 'Theme',
        description: 'Preset look, or Custom solid to use the colours below.',
        apply: 'live',
        options: [
          { value: 'docker', label: 'Docker Blue' },
          { value: 'default', label: 'Default (native)' },
          { value: 'phosphor', label: 'Phosphor' },
          { value: 'custom', label: 'Custom solid' },
        ],
      },
      {
        kind: 'color',
        key: 'appearance.background',
        label: 'Background',
        description: 'Base canvas colour. Edits switch the theme to Custom solid.',
        apply: 'live',
        fallback: '#0f0f0f',
      },
      {
        kind: 'color',
        key: 'appearance.accent',
        label: 'Accent',
        description: 'Play button, links, seek bar and active icons.',
        apply: 'live',
        fallback: '#1d63ed',
      },
      {
        kind: 'color',
        key: 'appearance.accent2',
        label: 'Secondary accent',
        description: 'Highlights, badges and secondary controls.',
        apply: 'live',
        fallback: '#5b8bff',
      },
    ],
  },
  {
    id: 'crossfade',
    title: 'Crossfade',
    rows: [
      {
        kind: 'range',
        key: 'plugins.crossfade.transitionSeconds',
        label: 'Transition length',
        description:
          'Fade the current song out and the next one in. Slide to Off to skip transitions.',
        apply: 'live',
        stops: [0, 5, 10, 20, 30, 50],
      },
    ],
  },
  {
    id: 'window',
    title: 'Window',
    rows: [
      {
        kind: 'switch',
        key: 'options.alwaysOnTop',
        label: 'Always on top',
        description: 'Keep the window above other apps.',
        apply: 'live',
      },
      {
        kind: 'switch',
        key: 'options.hideMenu',
        label: 'Hide menu text',
        description:
          'Collapse the menus to a single icon. The settings gear stays visible.',
        apply: 'live',
      },
      {
        kind: 'text',
        key: 'options.customWindowTitle',
        label: 'Window title',
        description: 'Title shown in the window frame. Empty = MusicApp.',
        apply: 'restart',
        placeholder: 'MusicApp',
      },
    ],
  },
  {
    id: 'playback',
    title: 'Playback',
    rows: [
      {
        kind: 'switch',
        key: 'options.removeUpgradeButton',
        label: 'Remove upgrade button',
        description: 'Hide the YouTube Music Premium upsell.',
        apply: 'reload',
      },
      {
        kind: 'select',
        key: 'options.likeButtons',
        label: 'Like buttons',
        description: 'Default follows the player; force or hide overrides it.',
        apply: 'reload',
        options: [
          { value: '', label: 'Default' },
          { value: 'force', label: 'Force show' },
          { value: 'hide', label: 'Hide' },
        ],
      },
      {
        kind: 'switch',
        key: 'options.swapLikeButtonsOrder',
        label: 'Swap like buttons',
        description: 'Put dislike before like.',
        apply: 'reload',
      },
    ],
  },
  {
    id: 'advanced',
    title: 'Advanced',
    rows: [
      {
        kind: 'text',
        key: 'options.proxy',
        label: 'Proxy',
        description: 'HTTP proxy as host:port. Empty = direct connection.',
        apply: 'restart',
        placeholder: '127.0.0.1:8080',
      },
      {
        kind: 'switch',
        key: 'options.overrideUserAgent',
        label: 'Override user agent',
        description: 'Use a desktop Chrome user agent.',
        apply: 'restart',
      },
      {
        kind: 'switch',
        key: 'options.disableHardwareAcceleration',
        label: 'Disable hardware acceleration',
        description: 'Use software rendering if the app flickers or crashes.',
        apply: 'restart',
      },
      {
        kind: 'switch',
        key: 'plugins.discovery.undergroundOnly',
        label: 'Underground artists only',
        description:
          'Discovery queues only artists under 100k Last.fm listeners.',
        apply: 'live',
      },
      {
        kind: 'text',
        key: 'plugins.discovery.lastfmApiKey',
        label: 'Last.fm API key',
        description:
          'Free key from last.fm/api/account/create. Required for the underground filter.',
        apply: 'live',
        placeholder: 'Last.fm API key',
      },
      {
        kind: 'switch',
        key: 'options.restartOnConfigChanges',
        label: 'Restart on settings changes',
        description: 'Restart automatically when a setting changes.',
        apply: 'live',
      },
    ],
  },
];

export type TrayMode = 'off' | 'show' | 'hide';

export const trayModeFromFlags = (
  tray: unknown,
  appVisible: unknown,
): TrayMode => {
  if (!tray) return 'off';
  return appVisible ? 'show' : 'hide';
};

export const trayFlagsFromMode = (
  mode: unknown,
): { tray: boolean; appVisible: boolean } => {
  const parsed: TrayMode =
    mode === 'off' || mode === 'hide' || mode === 'show' ? mode : 'show';
  return {
    tray: parsed !== 'off',
    appVisible: parsed !== 'hide',
  };
};

export interface SettingsLanguage {
  code: string;
  name: string;
}

export interface SettingsSnapshot {
  values: Record<string, unknown>;
  languages: SettingsLanguage[];
}
