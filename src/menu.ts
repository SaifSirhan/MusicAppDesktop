import {
  app,
  type BrowserWindow,
  clipboard,
  dialog,
  Menu,
  type MenuItem,
} from 'electron';
import is from 'electron-is';
import { satisfies } from 'semver';
import { allPlugins } from 'virtual:plugins';

import { t } from '@/i18n';

import * as config from './config';
import { getAllMenuTemplate, loadAllMenuPlugins } from './loader/menu';
import { restart } from './providers/app-controls';

import packageJson from '../package.json';

export type MenuTemplate = Electron.MenuItemConstructorOptions[];

// True only if in-app-menu was loaded on launch
const inAppMenuActive = await config.plugins.isEnabled('in-app-menu');

const pluginEnabledMenu = async (
  plugin: string,
  label = '',
  description?: string ,
  isNew = false,
  hasSubmenu = false,
  refreshMenu?: (() => void) ,
): Promise<Electron.MenuItemConstructorOptions> => ({
  label: label || plugin,
  sublabel: isNew ? t('main.menu.plugins.new') : undefined,
  toolTip: description,
  type: 'checkbox',
  checked: await config.plugins.isEnabled(plugin),
  click(item: Electron.MenuItem) {
    if (item.checked) {
      config.plugins.enable(plugin);
    } else {
      config.plugins.disable(plugin);
    }

    if (hasSubmenu) {
      refreshMenu?.();
    }
  },
});

export const refreshMenu = async (win: BrowserWindow) => {
  await setApplicationMenu(win);
  if (inAppMenuActive) {
    win.webContents.send('refresh-in-app-menu');
  }
};

export const mainMenuTemplate = async (
  win: BrowserWindow,
): Promise<MenuTemplate> => {
  const innerRefreshMenu = () => refreshMenu(win);
  const { navigationHistory } = win.webContents;
  await loadAllMenuPlugins(win);

  const allPluginsStubs = await allPlugins();

  const menuResult = await Promise.all(
    Object.entries(getAllMenuTemplate()).map(async ([id, template]) => {
      const plugin = allPluginsStubs[id];
      const pluginLabel = plugin?.name?.() ?? id;
      const pluginDescription = plugin?.description?.() ?? undefined;
      const isNew = plugin?.addedVersion
        ? satisfies(packageJson.version, plugin.addedVersion)
        : false;

      if (!(await config.plugins.isEnabled(id))) {
        return [
          id,
          await pluginEnabledMenu(
            id,
            pluginLabel,
            pluginDescription,
            isNew,
            true,
            innerRefreshMenu,
          ),
        ] as const;
      }

      return [
        id,
        {
          label: pluginLabel,
          sublabel: isNew ? t('main.menu.plugins.new') : undefined,
          toolTip: pluginDescription,
          submenu: [
            await pluginEnabledMenu(
              id,
              t('main.menu.plugins.enabled'),
              undefined,
              false,
              true,
              innerRefreshMenu,
            ),
            { type: 'separator' },
            ...template,
          ],
        } satisfies Electron.MenuItemConstructorOptions,
      ] as const;
    }),
  );

  const availablePlugins = Object.keys(await allPlugins());
  const pluginMenus = await Promise.all(
    availablePlugins
      .sort((a, b) => {
        const aPluginLabel = allPluginsStubs[a]?.name?.() ?? a;
        const bPluginLabel = allPluginsStubs[b]?.name?.() ?? b;

        return aPluginLabel.localeCompare(bPluginLabel);
      })
      .map(async (id) => {
        const predefinedTemplate = menuResult.find((it) => it[0] === id);
        if (predefinedTemplate) return predefinedTemplate[1];

        const plugin = allPluginsStubs[id];
        const pluginLabel = plugin?.name?.() ?? id;
        const pluginDescription = plugin?.description?.() ?? undefined;
        const isNew = plugin?.addedVersion
          ? satisfies(packageJson.version, plugin.addedVersion)
          : false;

        return pluginEnabledMenu(
          id,
          pluginLabel,
          pluginDescription,
          isNew,
          true,
          innerRefreshMenu,
        );
      }),
  );

  return [
    {
      label: t('main.menu.plugins.label'),
      submenu: pluginMenus,
    },
    {
      label: t('main.menu.options.label'),
      submenu: [
        {
          label: t(
            'main.menu.options.submenu.single-instance-lock',
          ),
          type: 'checkbox' as const,
          checked: true,
          click(item: MenuItem) {
            if (!item.checked && app.hasSingleInstanceLock()) {
              app.releaseSingleInstanceLock();
            } else if (item.checked && !app.hasSingleInstanceLock()) {
              app.requestSingleInstanceLock();
            }
          },
        },
        {
          label: t(
            'main.menu.options.submenu.visual-tweaks.submenu.theme.label',
          ),
          submenu: [
            ...((config.get('options.themes')?.length ?? 0) === 0
              ? [
                  {
                    label: t(
                      'main.menu.options.submenu.visual-tweaks.submenu.theme.submenu.no-theme',
                    ),
                  },
                ]
              : []),
            ...(config.get('options.themes')?.map((theme: string) => ({
              type: 'normal' as const,
              label: theme,
              async click() {
                const { response } = await dialog.showMessageBox(win, {
                  type: 'question',
                  defaultId: 1,
                  title: t(
                    'main.menu.options.submenu.visual-tweaks.submenu.theme.dialog.remove-theme',
                  ),
                  message: t(
                    'main.menu.options.submenu.visual-tweaks.submenu.theme.dialog.remove-theme-message',
                    { theme },
                  ),
                  buttons: [
                    t(
                      'main.menu.options.submenu.visual-tweaks.submenu.theme.dialog.button.cancel',
                    ),
                    t(
                      'main.menu.options.submenu.visual-tweaks.submenu.theme.dialog.button.remove',
                    ),
                  ],
                });
                if (response === 1) {
                  config.set(
                    'options.themes',
                    config.get('options.themes')?.filter((t) => t !== theme) ??
                      [],
                  );
                  innerRefreshMenu();
                }
              },
            })) ?? []),
            { type: 'separator' as const },
            {
              label: t(
                'main.menu.options.submenu.visual-tweaks.submenu.theme.submenu.import-css-file',
              ),
              type: 'normal' as const,
              async click() {
                const { filePaths } = await dialog.showOpenDialog({
                  filters: [{ name: 'CSS Files', extensions: ['css'] }],
                  properties: ['openFile', 'multiSelections'],
                });
                if (filePaths) {
                  config.set('options.themes', filePaths);
                  innerRefreshMenu();
                }
              },
            },
          ],
        },
        {
          label: t(
            'main.menu.options.submenu.advanced-options.label',
          ),
          submenu: [
            {
              label: t(
                'main.menu.options.submenu.advanced-options.submenu.auto-reset-app-cache',
              ),
              type: 'checkbox' as const,
              checked: config.get('options.autoResetAppCache'),
              click(item: MenuItem) {
                config.setMenuOption(
                  'options.autoResetAppCache',
                  item.checked,
                );
              },
            },
            { type: 'separator' as const },
            {
              label: t(
                'main.menu.options.submenu.advanced-options.submenu.toggle-dev-tools',
              ),
              ...(is.macOS()
                ? {
                    click() {
                      const { webContents } = win;
                      if (webContents.isDevToolsOpened()) {
                        webContents.closeDevTools();
                      } else {
                        webContents.openDevTools();
                      }
                    },
                  }
                : { role: 'toggleDevTools' as const }),
            },
            {
              label: t(
                'main.menu.options.submenu.advanced-options.submenu.edit-config-json',
              ),
              click() {
                config.edit();
              },
            },
          ],
        },
      ],
    },
    {
      label: t('main.menu.view.label'),
      submenu: [
        {
          label: t('main.menu.view.submenu.reload'),
          role: 'reload',
        },
        {
          label: t('main.menu.view.submenu.force-reload'),
          role: 'forceReload',
        },
        { type: 'separator' },
        {
          label: t('main.menu.view.submenu.zoom-in'),
          role: 'zoomIn',
          accelerator: 'CmdOrCtrl+=',
          visible: false,
        },
        {
          label: t('main.menu.view.submenu.zoom-in'),
          role: 'zoomIn',
          accelerator: 'CmdOrCtrl+Plus',
        },
        {
          label: t('main.menu.view.submenu.zoom-out'),
          role: 'zoomOut',
          accelerator: 'CmdOrCtrl+-',
        },
        {
          label: t('main.menu.view.submenu.zoom-out'),
          role: 'zoomOut',
          accelerator: 'CmdOrCtrl+Shift+-',
          visible: false,
        },
        {
          label: t('main.menu.view.submenu.reset-zoom'),
          role: 'resetZoom',
        },
        { type: 'separator' },
        {
          label: t('main.menu.view.submenu.toggle-fullscreen'),
          role: 'togglefullscreen',
        },
      ],
    },
    {
      label: t('main.menu.navigation.label'),
      submenu: [
        {
          label: t('main.menu.navigation.submenu.go-back'),
          click() {
            if (navigationHistory.canGoBack()) {
              navigationHistory.goBack();
            }
          },
        },
        {
          label: t('main.menu.navigation.submenu.go-forward'),
          click() {
            if (navigationHistory.canGoForward()) {
              navigationHistory.goForward();
            }
          },
        },
        {
          label: t('main.menu.navigation.submenu.copy-current-url'),
          click() {
            const currentURL = win.webContents.getURL();
            clipboard.writeText(currentURL);
          },
        },
        {
          label: t('main.menu.navigation.submenu.restart'),
          click: restart,
        },
        {
          label: t('main.menu.navigation.submenu.quit'),
          role: 'quit',
        },
      ],
    },
    {
      label: t('main.menu.about'),
      submenu: [{ role: 'about' }],
    },
  ];
};
export const setApplicationMenu = async (win: Electron.BrowserWindow) => {
  const menuTemplate: MenuTemplate = [...(await mainMenuTemplate(win))];
  if (process.platform === 'darwin') {
    const { name } = app;
    menuTemplate.unshift({
      label: name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'selectAll' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { type: 'separator' },
        { role: 'minimize' },
        { role: 'close' },
        { role: 'quit' },
      ],
    });
  }

  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);
};

