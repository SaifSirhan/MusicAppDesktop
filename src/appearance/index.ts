import type { BrowserWindow, WebContents } from 'electron';

import * as config from '@/config';

import { buildAppearanceCss, parseAppearancePreset } from './buildCss';

import phosphorCss from './phosphor.css?inline';

const injected = new WeakMap<WebContents, string>();

export async function applyAppearance(win: BrowserWindow): Promise<void> {
  const webContents = win.webContents;
  const existingKey = injected.get(webContents);

  if (existingKey) {
    await webContents.removeInsertedCSS(existingKey);
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
    void applyAppearance(win);
  });
}
