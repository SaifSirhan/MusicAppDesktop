import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';

import { t } from '@/i18n';

import { createMixerClient } from './client';
import { MixerEngine } from './engine';
import { MixerPanel } from './MixerPanel';
import { toQueueItems, type MixerQueueItem } from './session';
import { installDevHook } from './state';

import type { RendererContext } from '@/types/contexts';
import type { PluginConfig } from '@/types/plugins';
import type { QueueElement } from '@/types/queue';

type VideoState = {
  paused: boolean;
  video: HTMLVideoElement;
  volume: number;
};

type ToggleWindow = { __mixerToggle?: () => void };

let context: RendererContext<PluginConfig> | undefined;
let engine: MixerEngine | undefined;
let host: HTMLDivElement | undefined;
let dispose: (() => void) | undefined;
let removeDevHook: (() => void) | undefined;
let videoState: VideoState | undefined;
let opening = false;

const [items, setItems] = createSignal<MixerQueueItem[]>([]);

const readQueue = (): MixerQueueItem[] => {
  const queue = document.querySelector<QueueElement>('#queue');
  if (!queue) return [];

  try {
    return toQueueItems(queue.queue.getItems());
  } catch {
    return [];
  }
};

const restoreVideo = () => {
  const state = videoState;
  videoState = undefined;
  if (!state) return;

  state.video.volume = state.volume;
  if (!state.paused) {
    state.video.play().catch(() => {});
  }
};

export const openMixer = async (): Promise<void> => {
  if (engine || opening || !context) return;

  opening = true;
  let next: MixerEngine | undefined;

  try {
    const created = new MixerEngine();
    const running = await created.resume();
    next = created;
    const video = document.querySelector('video');

    if (video) {
      videoState = { paused: video.paused, video, volume: video.volume };
      video.pause();
      video.volume = 0;
    }

    setItems(readQueue());

    const client = createMixerClient(context.ipc);

    engine = created;
    host = document.createElement('div');
    host.setAttribute('data-mixer-host', '');
    document.body.appendChild(host);

    dispose = render(
      () => (
        <MixerPanel
          audioBlocked={!running}
          client={client}
          engine={created}
          items={items()}
          onClose={() => {
            closeMixer();
          }}
          onRefreshQueue={() => setItems(readQueue())}
          savedVolume={videoState?.volume ?? 1}
        />
      ),
      host,
    );
    removeDevHook = installDevHook(created);
  } catch (error) {
    console.error('[mixer] failed to open the panel', error);
    engine = undefined;
    host?.remove();
    host = undefined;
    restoreVideo();
    next?.close().catch(() => {});
  } finally {
    opening = false;
  }
};

export const closeMixer = async (): Promise<void> => {
  const current = engine;
  if (!current) return;

  engine = undefined;
  removeDevHook?.();
  removeDevHook = undefined;
  dispose?.();
  dispose = undefined;
  host?.remove();
  host = undefined;
  restoreVideo();

  try {
    await current.close();
  } catch (error) {
    console.error('[mixer] failed to close the audio engine', error);
  }
};

export const toggleMixer = (): void => {
  if (engine) {
    closeMixer();

    return;
  }

  openMixer();
};

const createTitleBarButton = (): HTMLButtonElement => {
  const button = document.createElement('button');
  const label = t('plugins.mixer.title');

  button.type = 'button';
  button.setAttribute('aria-label', label);
  button.textContent = label;

  button.style.display = 'flex';
  button.style.alignItems = 'center';
  button.style.justifyContent = 'center';
  button.style.height = '24px';
  button.style.padding = '0 8px';
  button.style.marginLeft = '2px';
  button.style.border = 'none';
  button.style.borderRadius = '4px';
  button.style.background = 'transparent';
  button.style.color = 'var(--ma-ink, #f1f1f1)';
  button.style.fontFamily = 'inherit';
  button.style.fontSize = '11px';
  button.style.fontWeight = '600';
  button.style.letterSpacing = '0.02em';
  button.style.cursor = 'pointer';
  button.style.outline = 'none';
  button.style.setProperty('-webkit-app-region', 'no-drag');

  button.addEventListener('mouseenter', () => {
    button.style.background = 'rgba(255, 255, 255, 0.1)';
  });
  button.addEventListener('mouseleave', () => {
    button.style.background = 'transparent';
  });
  button.addEventListener('click', toggleMixer);

  return button;
};

const injectTitleBarButton = (): void => {
  if (document.querySelector('button[aria-label="Mixer"]')) return;

  const button = createTitleBarButton();
  let frames = 0;

  const place = () => {
    const gear = document.querySelector('[aria-label="Settings"]');
    const container = gear?.parentElement;

    if (gear && container) {
      gear.insertAdjacentElement('afterend', button);

      return;
    }

    // The title bar mounts from its own onPlayerApiReady hook; give it a
    // moment before falling back to the player bar.
    if (frames < 120) {
      frames += 1;
      window.requestAnimationFrame(place);

      return;
    }

    const bar = document.querySelector('ytmusic-player-bar');

    if (bar) {
      bar.appendChild(button);

      return;
    }

    console.warn('[mixer] no title-bar entry point found; skipping button');
  };

  place();
};

export const onRendererLoad = (ctx: RendererContext<PluginConfig>): void => {
  context = ctx;
  (window as unknown as ToggleWindow).__mixerToggle = toggleMixer;
};

export const onPlayerApiReady = (): void => {
  injectTitleBarButton();
};

export const onConfigChange = (config: PluginConfig): void => {
  if (!config.enabled) closeMixer();
};
