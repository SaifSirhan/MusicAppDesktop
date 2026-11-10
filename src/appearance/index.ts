import * as config from '@/config';
import { LoggerPrefix } from '@/utils';

import { buildAppearanceCss, parseAppearancePreset } from './buildCss';
import phosphorCss from './phosphor.css?inline';

import type { BrowserWindow, WebContents } from 'electron';

const injected = new WeakMap<WebContents, string>();

export async function applyAppearance(win: BrowserWindow): Promise<void> {
  if (win.isDestroyed() || win.webContents.isDestroyed()) return;

  const webContents = win.webContents;
  const existingKey = injected.get(webContents);

  if (existingKey) {
    try {
      await webContents.removeInsertedCSS(existingKey);
    } catch (error) {
      // The document (and its stylesheet) is already gone with the window.
      console.warn(LoggerPrefix, 'Failed to remove appearance CSS', error);
    }
    injected.delete(webContents);
  }

  const preset = parseAppearancePreset(config.get('appearance.preset'));
  const css = buildAppearanceCss(preset, phosphorCss);
  if (!css) return;

  const key = await webContents.insertCSS(css);
  injected.set(webContents, key);
}

export function initAppearance(win: BrowserWindow): void {
  win.webContents.on('did-finish-load', () => {
    injected.delete(win.webContents);
    applyAppearance(win).catch((error) => {
      console.warn(LoggerPrefix, 'Failed to apply appearance CSS', error);
    });
  });
}
