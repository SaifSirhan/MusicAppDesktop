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

export type SettingRow = SwitchRow | SelectRow | TextRow;

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
      {
        kind: 'select',
        key: 'appearance.preset',
        label: 'Appearance',
        description: 'Accent colours over the native YouTube Music layout.',
        apply: 'live',
        options: [
          { value: 'docker', label: 'Docker Blue' },
          { value: 'default', label: 'Default (native)' },
          { value: 'phosphor', label: 'Phosphor' },
        ],
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
