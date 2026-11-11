import * as config from '@/config';
import { LoggerPrefix } from '@/utils';

import brandCss from './brand.css?inline';
import { buildAppearanceCss, parseAppearancePreset } from './buildCss';
import dockerCss from './docker.css?inline';
import phosphorCss from './phosphor.css?inline';

import type { BrowserWindow, WebContents } from 'electron';

const injected = new WeakMap<WebContents, string>();

// YouTube Music re-applies its own theme variables after page load, which can
// beat injected author CSS. These are pinned inline (highest priority) for the
// solid theme so text and surfaces stay readable.
const PINNED_TOKENS: Record<string, string> = {
  '--yt-spec-base-background': 'var(--ma-bg)',
  '--yt-spec-general-background-a': 'var(--ma-bg)',
  '--yt-spec-general-background-b': 'var(--ma-bg)',
  '--yt-spec-general-background-c': 'var(--ma-bg)',
  '--yt-spec-text-primary': 'var(--ma-ink)',
  '--yt-spec-text-secondary': 'var(--ma-ink-dim)',
  '--yt-spec-text-disabled': 'var(--ma-ink-faint)',
  '--yt-spec-icon-active-other': 'var(--ma-accent)',
  '--yt-spec-icon-inactive': 'var(--ma-ink-dim)',
  '--yt-spec-call-to-action': 'var(--ma-accent)',
  '--yt-spec-call-to-action-hover': 'var(--ma-accent-hot)',
  '--yt-spec-brand-link-text': 'var(--ma-accent-2)',
  '--ytmusic-text-primary': 'var(--ma-ink)',
  '--ytmusic-text-secondary': 'var(--ma-ink-dim)',
  '--ytmusic-general-background-a': 'var(--ma-bg)',
  '--ytmusic-general-background-b': 'var(--ma-bg)',
  '--ytmusic-player-bar-background': 'var(--ma-surface)',
  '--ytmusic-nav-bar-background': 'var(--ma-surface)',
  '--ytmusic-background': 'var(--ma-bg)',
};

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
  const css =
    brandCss +
    buildAppearanceCss(preset, phosphorCss, dockerCss, {
      background: config.get('appearance.background'),
      accent: config.get('appearance.accent'),
      accent2: config.get('appearance.accent2'),
    });
  if (!css) return;

  const key = await webContents.insertCSS(css);
  injected.set(webContents, key);

  // Pin body background and the timing-sensitive YTM tokens inline. Cleared
  // for every other preset so native/Docker/Phosphor keep their own values.
  const tokens = JSON.stringify(PINNED_TOKENS);
  await webContents
    .executeJavaScript(
      `(() => {
        const body = document.body;
        const root = document.documentElement;
        if (!body || !root) return;
        const tokens = ${tokens};
        if ('${preset}' === 'custom') {
          body.style.setProperty('background-color', 'var(--ma-bg)', 'important');
          for (const [name, value] of Object.entries(tokens)) {
            root.style.setProperty(name, value, 'important');
          }
        } else {
          body.style.removeProperty('background-color');
          for (const name of Object.keys(tokens)) {
            root.style.removeProperty(name);
          }
        }
      })()`,
      true,
    )
    .catch(() => undefined);
}

export function initAppearance(win: BrowserWindow): void {
  win.webContents.on('did-finish-load', () => {
    injected.delete(win.webContents);
    applyAppearance(win).catch((error) => {
      console.warn(LoggerPrefix, 'Failed to apply appearance CSS', error);
    });
  });
}
