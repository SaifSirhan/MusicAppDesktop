import {
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
  untrack,
  type JSX,
} from 'solid-js';
import { css } from 'solid-styled-components';

import { t } from '@/i18n';
import { cacheNoArgs } from '@/providers/decorators';

import { DeckCard } from './DeckCard';
import {
  formatTime,
  loadTrack,
  type CacheProgress,
  type MixerClient,
  type MixerQueueItem,
} from './session';
import { bufferPeaks } from './waveform';

import type { DeckId, MixerEngine } from './engine';

const overlayStyle: () => string = cacheNoArgs(
  () => css`
    position: fixed;
    inset: 0;
    z-index: 10000010;

    display: flex;
    justify-content: center;
    align-items: flex-start;

    box-sizing: border-box;
    padding: 24px 16px;
    overflow-y: auto;
    outline: none;

    background-color: color-mix(
      in srgb,
      var(--titlebar-background-color, #030303) 90%,
      transparent
    );
    backdrop-filter: blur(14px);

    color: var(--ma-ink, #f1f1f1);
    font-family: Roboto, Arial, sans-serif;
    user-select: none;
    -webkit-app-region: none;
  `,
);

const contentStyle: () => string = cacheNoArgs(
  () => css`
    display: flex;
    flex-direction: column;
    gap: 14px;

    width: 100%;
    max-width: 1100px;
  `,
);

const headerStyle: () => string = cacheNoArgs(
  () => css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;

    padding-bottom: 10px;
    border-bottom: 1px solid
      color-mix(in srgb, var(--ma-ink, #ffffff) 10%, transparent);
  `,
);

const titleStyle: () => string = cacheNoArgs(
  () => css`
    margin: 0;

    font-size: 15px;
    font-weight: 700;
    letter-spacing: 0.02em;
  `,
);

const closeButtonStyle: () => string = cacheNoArgs(
  () => css`
    display: flex;
    align-items: center;
    justify-content: center;

    width: 30px;
    height: 30px;
    padding: 0;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--ma-ink, #f1f1f1);

    cursor: pointer;
    outline: none;

    &:hover {
      background-color: color-mix(
        in srgb,
        var(--ma-ink, #ffffff) 12%,
        transparent
      );
    }

    &:focus-visible {
      box-shadow: 0 0 0 2px var(--ma-accent, #ffffff);
    }
  `,
);

const decksStyle: () => string = cacheNoArgs(
  () => css`
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px;

    @media (max-width: 900px) {
      grid-template-columns: minmax(0, 1fr);
    }
  `,
);

const stripStyle: () => string = cacheNoArgs(
  () => css`
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
    gap: 20px;

    padding: 12px 14px;
    border-radius: 12px;
    border: 1px solid
      color-mix(in srgb, var(--ma-ink, #ffffff) 12%, transparent);
    background-color: color-mix(
      in srgb,
      var(--ma-ink, #ffffff) 4%,
      transparent
    );

    @media (max-width: 900px) {
      grid-template-columns: minmax(0, 1fr);
    }
  `,
);

const stripGroupStyle: () => string = cacheNoArgs(
  () => css`
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  `,
);

const stripLabelStyle: () => string = cacheNoArgs(
  () => css`
    display: flex;
    align-items: center;
    justify-content: space-between;

    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: color-mix(in srgb, var(--ma-ink, #ffffff) 52%, transparent);
  `,
);

const crossfaderRowStyle: () => string = cacheNoArgs(
  () => css`
    display: flex;
    align-items: center;
    gap: 10px;

    font-size: 11px;
    font-weight: 600;
    color: color-mix(in srgb, var(--ma-ink, #ffffff) 72%, transparent);
  `,
);

const sliderStyle: () => string = cacheNoArgs(
  () => css`
    flex: 1;
    height: 4px;
    margin: 0;

    accent-color: var(--ma-accent, #ffffff);
    cursor: pointer;

    &:focus-visible {
      outline: 2px solid var(--ma-accent, #ffffff);
      outline-offset: 2px;
    }
  `,
);

const queueSectionStyle: () => string = cacheNoArgs(
  () => css`
    display: flex;
    flex-direction: column;
    gap: 8px;

    padding: 12px 14px;
    border-radius: 12px;
    border: 1px solid
      color-mix(in srgb, var(--ma-ink, #ffffff) 12%, transparent);
    background-color: color-mix(
      in srgb,
      var(--ma-ink, #ffffff) 4%,
      transparent
    );
  `,
);

const queueHeaderStyle: () => string = cacheNoArgs(
  () => css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  `,
);

const refreshButtonStyle: () => string = cacheNoArgs(
  () => css`
    padding: 5px 10px;
    border-radius: 6px;
    border: 1px solid
      color-mix(in srgb, var(--ma-ink, #ffffff) 18%, transparent);
    background-color: color-mix(
      in srgb,
      var(--ma-ink, #ffffff) 7%,
      transparent
    );
    color: var(--ma-ink, #f1f1f1);
    font-family: inherit;
    font-size: 11.5px;

    cursor: pointer;
    outline: none;

    &:hover {
      border-color: color-mix(in srgb, var(--ma-ink, #ffffff) 32%, transparent);
    }

    &:focus-visible {
      box-shadow: 0 0 0 2px var(--ma-accent, #ffffff);
    }
  `,
);

const queueListStyle: () => string = cacheNoArgs(
  () => css`
    display: flex;
    flex-direction: column;
    gap: 2px;

    max-height: 34vh;
    margin: 0;
    padding: 0;
    overflow-y: auto;

    list-style: none;
  `,
);

const queueRowStyle: () => string = cacheNoArgs(
  () => css`
    display: flex;
    align-items: center;
    gap: 10px;

    padding: 6px 8px;
    border-radius: 8px;

    &:hover {
      background-color: color-mix(
        in srgb,
        var(--ma-ink, #ffffff) 6%,
        transparent
      );
    }
  `,
);

const queueMetaStyle: () => string = cacheNoArgs(
  () => css`
    display: flex;
    flex-direction: column;
    gap: 1px;
    flex: 1;
    min-width: 0;
  `,
);

const queueTitleStyle: () => string = cacheNoArgs(
  () => css`
    overflow: hidden;
    font-size: 12.5px;
    font-weight: 500;

    text-overflow: ellipsis;
    white-space: nowrap;
  `,
);

const queueArtistStyle: () => string = cacheNoArgs(
  () => css`
    overflow: hidden;
    font-size: 11px;
    color: color-mix(in srgb, var(--ma-ink, #ffffff) 52%, transparent);

    text-overflow: ellipsis;
    white-space: nowrap;
  `,
);

const queueDurationStyle: () => string = cacheNoArgs(
  () => css`
    flex-shrink: 0;

    font-family: Consolas, monospace;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    color: color-mix(in srgb, var(--ma-ink, #ffffff) 56%, transparent);
  `,
);

const deckChipStyle: () => string = cacheNoArgs(
  () => css`
    width: 26px;
    height: 26px;
    padding: 0;
    border-radius: 6px;
    border: 1px solid
      color-mix(in srgb, var(--ma-ink, #ffffff) 20%, transparent);
    background-color: color-mix(
      in srgb,
      var(--ma-ink, #ffffff) 7%,
      transparent
    );
    color: var(--ma-ink, #f1f1f1);
    font-family: inherit;
    font-size: 11.5px;
    font-weight: 700;

    cursor: pointer;
    outline: none;

    &:hover {
      border-color: var(--ma-accent, #ffffff);
    }

    &:focus-visible {
      box-shadow: 0 0 0 2px var(--ma-accent, #ffffff);
    }
  `,
);

const noticeStyle: () => string = cacheNoArgs(
  () => css`
    margin: 0;
    padding: 8px 12px;

    border-radius: 8px;
    background-color: rgba(255, 212, 121, 0.12);

    font-size: 12px;
    color: #ffd479;
  `,
);

const emptyStyle: () => string = cacheNoArgs(
  () => css`
    margin: 8px 0;
    padding: 14px;

    border-radius: 8px;
    border: 1px dashed
      color-mix(in srgb, var(--ma-ink, #ffffff) 16%, transparent);

    font-size: 12px;
    text-align: center;
    color: color-mix(in srgb, var(--ma-ink, #ffffff) 56%, transparent);
  `,
);

const footerStyle: () => string = cacheNoArgs(
  () => css`
    margin: 0;

    font-size: 11px;
    text-align: center;
    color: color-mix(in srgb, var(--ma-ink, #ffffff) 40%, transparent);
  `,
);

const CloseIcon = () => (
  <svg height={16} viewBox={'0 0 24 24'} width={16}>
    <path
      d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"
      fill="currentColor"
    />
  </svg>
);

const clampVolume = (value: number): number =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;

type MixerPanelProps = {
  audioBlocked?: boolean;
  client: Pick<
    MixerClient,
    'cacheTrack' | 'onCacheProgress' | 'readTrack' | 'removeTrack'
  >;
  engine: MixerEngine;
  items: MixerQueueItem[];
  onClose: () => void;
  onRefreshQueue: () => void;
  savedVolume: number;
};

export const MixerPanel = (props: MixerPanelProps) => {
  let root: HTMLDivElement | undefined;

  const setRoot = (element: HTMLDivElement) => {
    root = element;
  };

  const initialMaster = untrack(() => clampVolume(props.savedVolume));

  const [master, setMaster] = createSignal(initialMaster);
  const [crossfader, setCrossfader] = createSignal(
    untrack(() => props.engine.getCrossfader()),
  );
  const [progressA, setProgressA] = createSignal<CacheProgress | null>(null);
  const [progressB, setProgressB] = createSignal<CacheProgress | null>(null);
  const [peaksA, setPeaksA] = createSignal<Float32Array>(new Float32Array());
  const [peaksB, setPeaksB] = createSignal<Float32Array>(new Float32Array());
  const [itemA, setItemA] = createSignal<MixerQueueItem>();
  const [itemB, setItemB] = createSignal<MixerQueueItem>();
  const [posA, setPosA] = createSignal(0);
  const [posB, setPosB] = createSignal(0);

  const current: Record<DeckId, string> = { A: '', B: '' };

  onMount(() => {
    props.engine.setMasterVolume(master());
    const unsubscribe = props.client.onCacheProgress((progress) => {
      if (progress.videoId === current.A) setProgressA(progress);
      if (progress.videoId === current.B) setProgressB(progress);
    });
    const timer = window.setInterval(() => {
      setPosA(untrack(() => props.engine.decks.A.position()));
      setPosB(untrack(() => props.engine.decks.B.position()));
    }, 200);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') props.onClose();
    };

    window.addEventListener('keydown', onKeyDown);
    root?.focus();

    onCleanup(() => {
      unsubscribe();
      window.clearInterval(timer);
      window.removeEventListener('keydown', onKeyDown);
    });
  });

  const decodeFor =
    (setPeaks: (peaks: Float32Array) => void) =>
    async (data: ArrayBuffer): Promise<AudioBuffer> => {
      const context = untrack(() => props.engine.context);
      const buffer = await context.decodeAudioData(data.slice(0));
      setPeaks(bufferPeaks(buffer, 900));

      return buffer;
    };

  const loadDeck = (id: DeckId, item: MixerQueueItem) => {
    current[id] = item.videoId;

    if (id === 'A') {
      setItemA(item);
      setPeaksA(new Float32Array());
      setProgressA(null);
    } else {
      setItemB(item);
      setPeaksB(new Float32Array());
      setProgressB(null);
    }

    loadTrack(
      {
        client: props.client,
        decode: decodeFor(id === 'A' ? setPeaksA : setPeaksB),
        onProgress: id === 'A' ? setProgressA : setProgressB,
      },
      props.engine.decks[id],
      item,
    );
  };

  const retryDeck = (id: DeckId) => {
    const item = id === 'A' ? itemA() : itemB();

    if (item) loadDeck(id, item);
  };

  const onCrossfaderInput: JSX.EventHandler<HTMLInputElement, InputEvent> = (
    event,
  ) => {
    const value = Number(event.currentTarget.value);
    setCrossfader(value);
    props.engine.setCrossfader(value);
  };

  const onMasterInput: JSX.EventHandler<HTMLInputElement, InputEvent> = (
    event,
  ) => {
    const value = Number(event.currentTarget.value);
    setMaster(value);
    props.engine.setMasterVolume(value);
  };

  const crossfaderLabel = () => {
    const value = crossfader();

    if (value < -0.05) return 'A';
    if (value > 0.05) return 'B';

    return 'Centre';
  };

  return (
    <div
      aria-label="Mixer panel"
      aria-modal="true"
      class={overlayStyle()}
      ref={setRoot}
      role="dialog"
      tabindex="-1"
    >
      <div class={contentStyle()}>
        <header class={headerStyle()}>
          <h2 class={titleStyle()}>{t('plugins.mixer.title')}</h2>
          <button
            aria-label={t('plugins.mixer.panel.close')}
            class={closeButtonStyle()}
            onClick={() => props.onClose()}
            type="button"
          >
            <CloseIcon />
          </button>
        </header>
        <Show when={props.audioBlocked}>
          <p aria-live="polite" class={noticeStyle()}>
            Click play to start audio.
          </p>
        </Show>
        <div class={decksStyle()}>
          <DeckCard
            deck={props.engine.decks.A}
            id="A"
            item={itemA()}
            onLoad={() => {
              const item = itemA();
              if (item) loadDeck('A', item);
            }}
            onRetry={() => retryDeck('A')}
            peaks={peaksA()}
            position={posA()}
            progress={progressA()}
          />
          <DeckCard
            deck={props.engine.decks.B}
            id="B"
            item={itemB()}
            onLoad={() => {
              const item = itemB();
              if (item) loadDeck('B', item);
            }}
            onRetry={() => retryDeck('B')}
            peaks={peaksB()}
            position={posB()}
            progress={progressB()}
          />
        </div>
        <div class={stripStyle()}>
          <div class={stripGroupStyle()}>
            <span class={stripLabelStyle()}>
              Crossfader
              <span>{crossfaderLabel()}</span>
            </span>
            <div class={crossfaderRowStyle()}>
              <span>A</span>
              <input
                aria-label="Crossfader"
                class={sliderStyle()}
                max={1}
                min={-1}
                onInput={onCrossfaderInput}
                step={0.01}
                type="range"
                value={crossfader()}
              />
              <span>B</span>
            </div>
          </div>
          <div class={stripGroupStyle()}>
            <span class={stripLabelStyle()}>
              Master
              <span>{`${Math.round(master() * 100)}%`}</span>
            </span>
            <input
              aria-label="Master volume"
              class={sliderStyle()}
              max={1}
              min={0}
              onInput={onMasterInput}
              step={0.01}
              type="range"
              value={master()}
            />
          </div>
        </div>
        <section class={queueSectionStyle()}>
          <div class={queueHeaderStyle()}>
            <span class={stripLabelStyle()}>YouTube Music queue</span>
            <button
              class={refreshButtonStyle()}
              onClick={() => props.onRefreshQueue()}
              type="button"
            >
              Refresh queue
            </button>
          </div>
          <Show
            fallback={
              <p class={emptyStyle()}>
                Play something in YouTube Music to see its queue here.
              </p>
            }
            when={props.items.length > 0}
          >
            <ul class={queueListStyle()}>
              <For each={props.items}>
                {(item) => (
                  <li class={queueRowStyle()}>
                    <div class={queueMetaStyle()}>
                      <span class={queueTitleStyle()}>{item.title}</span>
                      <span class={queueArtistStyle()}>
                        {item.artist || 'Unknown artist'}
                      </span>
                    </div>
                    <span class={queueDurationStyle()}>
                      {formatTime(item.duration)}
                    </span>
                    <button
                      aria-label={`Load ${item.title} on deck A`}
                      class={deckChipStyle()}
                      onClick={() => loadDeck('A', item)}
                      type="button"
                    >
                      A
                    </button>
                    <button
                      aria-label={`Load ${item.title} on deck B`}
                      class={deckChipStyle()}
                      onClick={() => loadDeck('B', item)}
                      type="button"
                    >
                      B
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </section>
        <p class={footerStyle()}>Press Esc to close</p>
      </div>
    </div>
  );
};
