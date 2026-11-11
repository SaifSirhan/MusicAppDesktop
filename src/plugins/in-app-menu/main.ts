import {
  BrowserWindow,
  Menu,
  type MenuItem,
  ipcMain,
  nativeImage,
  type WebContents,
} from 'electron';
import { languageResources } from 'virtual:i18n';

import { applyAppearance } from '@/appearance';
import * as config from '@/config';
import { setLanguage } from '@/i18n';

import {
  trayFlagsFromMode,
  trayModeFromFlags,
  type SettingsSnapshot,
} from './settings-schema';

import type { InAppMenuConfig } from './constants';
import type { BackendContext } from '@/types/contexts';

export const onMainLoad = ({
  window: win,
  ipc: { handle, send },
}: BackendContext<InAppMenuConfig>) => {
  win.on('close', () => {
    send('close-all-in-app-menu-panel');
  });

  handle('get-menu', () =>
    JSON.parse(
      JSON.stringify(Menu.getApplicationMenu(), (key: string, value: unknown) =>
        key !== 'commandsMap' && key !== 'menu' ? value : undefined,
      ),
    ),
  );

  const getMenuItemById = (commandId: number): MenuItem | null => {
    const menu = Menu.getApplicationMenu();

    let target: MenuItem | null = null;
    const stack = [...(menu?.items ?? [])];
    while (stack.length > 0) {
      const now = stack.shift();
      now?.submenu?.items.forEach((item) => stack.push(item));

      if (now?.commandId === commandId) {
        target = now;
        break;
      }
    }

    return target;
  };

  ipcMain.handle('peard:menu-event', (event, commandId: number) => {
    const target = getMenuItemById(commandId);
    if (target)
      (
        target.click as (
          args0: unknown,
          args1: BrowserWindow | null,
          args3: WebContents,
        ) => void
      )(undefined, BrowserWindow.fromWebContents(event.sender), event.sender);
  });

  handle('get-menu-by-id', (commandId: number) => {
    const result = getMenuItemById(commandId);

    return JSON.parse(
      JSON.stringify(result, (key: string, value: unknown) =>
        key !== 'commandsMap' && key !== 'menu' ? value : undefined,
      ),
    );
  });

  handle('window-is-maximized', () => win.isMaximized());

  handle('window-close', () => win.close());
  handle('window-minimize', () => win.minimize());
  handle('window-maximize', () => win.maximize());
  win.on('maximize', () => send('window-maximize'));
  handle('window-unmaximize', () => win.unmaximize());
  win.on('unmaximize', () => send('window-unmaximize'));

  handle('image-path-to-data-url', (imagePath: string) => {
    const nativeImageIcon = nativeImage.createFromPath(imagePath);
    return nativeImageIcon?.toDataURL();
  });

  const trayMode = (): string =>
    trayModeFromFlags(
      config.get('options.tray'),
      config.get('options.appVisible'),
    );

  const discoveryDefaults = {
    enabled: true,
    undergroundOnly: false,
    lastfmApiKey: '',
  };
  type DiscoverySettings = { undergroundOnly?: boolean; lastfmApiKey?: string };
  const discoveryConfig = (): DiscoverySettings =>
    (config.get('plugins.discovery') ?? {}) as DiscoverySettings;

  handle('settings:get', async (): Promise<SettingsSnapshot> => {
    const langResources = await languageResources();
    const languages = Object.keys(langResources)
      .map((code) => ({
        code,
        name:
          langResources[code].translation.language?.name ??
          langResources[code].translation.language?.['local-name'] ??
          code,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      values: {
        'options.autoUpdates': config.get('options.autoUpdates'),
        'options.resumeOnStart': config.get('options.resumeOnStart'),
        'options.startingPage': config.get('options.startingPage'),
        'options.language': config.get('options.language') ?? 'en',
        'options.startAtLogin': config.get('options.startAtLogin'),
        'trayMode': trayMode(),
        'options.trayClickPlayPause': config.get(
          'options.trayClickPlayPause',
        ),
        'options.alwaysOnTop': config.get('options.alwaysOnTop'),
        'options.hideMenu': config.get('options.hideMenu'),
        'options.customWindowTitle': config.get('options.customWindowTitle'),
        'appearance.preset': config.get('appearance.preset'),
        'options.removeUpgradeButton': config.get(
          'options.removeUpgradeButton',
        ),
        'options.likeButtons': config.get('options.likeButtons'),
        'options.swapLikeButtonsOrder': config.get(
          'options.swapLikeButtonsOrder',
        ),
        'options.proxy': config.get('options.proxy'),
        'options.overrideUserAgent': config.get('options.overrideUserAgent'),
        'options.disableHardwareAcceleration': config.get(
          'options.disableHardwareAcceleration',
        ),
        'options.restartOnConfigChanges': config.get(
          'options.restartOnConfigChanges',
        ),
        'plugins.discovery.undergroundOnly':
          discoveryConfig().undergroundOnly ?? false,
        'plugins.discovery.lastfmApiKey': discoveryConfig().lastfmApiKey ?? '',
      },
      languages,
    };
  });

  handle('settings:set', async (key: string, value: unknown) => {
    switch (key) {
      case 'trayMode': {
        const flags = trayFlagsFromMode(value);
        config.setMenuOption('options.tray', flags.tray);
        config.setMenuOption('options.appVisible', flags.appVisible);
        return;
      }
      case 'appearance.preset': {
        config.set('appearance.preset', value);
        await applyAppearance(win);
        return;
      }
      case 'options.language': {
        config.setMenuOption('options.language', value);
        await setLanguage(String(value));
        const { refreshMenu } = await import('@/menu');
        await refreshMenu(win);
        return;
      }
      case 'options.alwaysOnTop': {
        config.setMenuOption('options.alwaysOnTop', value);
        win.setAlwaysOnTop(Boolean(value));
        return;
      }
      case 'options.hideMenu': {
        config.setMenuOption('options.hideMenu', value);
        send('set-in-app-menu-collapsed', Boolean(value));
        return;
      }
      case 'plugins.discovery.undergroundOnly': {
        config.setPartial(
          'plugins.discovery',
          { undergroundOnly: Boolean(value) },
          discoveryDefaults,
        );
        return;
      }
      case 'plugins.discovery.lastfmApiKey': {
        config.setPartial(
          'plugins.discovery',
          { lastfmApiKey: String(value).trim() },
          discoveryDefaults,
        );
        return;
      }
      case 'options.autoUpdates':
      case 'options.resumeOnStart':
      case 'options.startingPage':
      case 'options.startAtLogin':
      case 'options.trayClickPlayPause':
      case 'options.customWindowTitle':
      case 'options.removeUpgradeButton':
      case 'options.likeButtons':
      case 'options.swapLikeButtonsOrder':
      case 'options.proxy':
      case 'options.overrideUserAgent':
      case 'options.disableHardwareAcceleration':
      case 'options.restartOnConfigChanges':
        config.setMenuOption(key, value);
        return;
      default:
        throw new Error(`Unknown setting key: ${key}`);
    }
  });
};
