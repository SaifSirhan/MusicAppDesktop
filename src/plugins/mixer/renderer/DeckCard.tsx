import {
  createSignal,
  onCleanup,
  onMount,
  Show,
  untrack,
  type JSX,
} from 'solid-js';
import { css } from 'solid-styled-components';

import { cacheNoArgs } from '@/providers/decorators';

import {
  TEMPO_MAX,
  TEMPO_MIN,
  type Deck,
  type DeckCore,
  type DeckId,
} from './engine';
import { formatTime, progressLabel, type MixerQueueItem } from './session';
import { WaveformCanvas } from './WaveformCanvas';

import type { CacheProgress } from '../types';

const cardStyle: () => string = cacheNoArgs(
  () => css`
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: 0;

    padding: 14px;
    border-radius: 12px;
    border: 1px solid
      color-mix(in srgb, var(--ma-ink, #ffffff) 12%, transparent);

    background-color: color-mix(
      in srgb,
      var(--ma-surface-2, #161616) 72%,
      transparent
    );
  `,
);

const headerStyle: () => string = cacheNoArgs(
  () => css`
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  `,
);

const artStyle: () => string = cacheNoArgs(
  () => css`
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 48px;
    height: 48px;
    overflow: hidden;

    border-radius: 6px;
    background-color: color-mix(
      in srgb,
      var(--ma-ink, #ffffff) 8%,
      transparent
    );
  `,
);

const artImageStyle: () => string = cacheNoArgs(
  () => css`
    width: 100%;
    height: 100%;
    object-fit: cover;
  `,
);

const artFallbackStyle: () => string = cacheNoArgs(
  () => css`
    font-size: 16px;
    font-weight: 700;
    color: var(--ma-accent, #ffffff);
  `,
);

const metaStyle: () => string = cacheNoArgs(
  () => css`
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
  `,
);

const titleStyle: () => string = cacheNoArgs(
  () => css`
    overflow: hidden;
    font-size: 13px;
    font-weight: 600;
    color: var(--ma-ink, #f1f1f1);

    text-overflow: ellipsis;
    white-space: nowrap;
  `,
);

const artistStyle: () => string = cacheNoArgs(
  () => css`
    overflow: hidden;
    font-size: 11.5px;
    color: color-mix(in srgb, var(--ma-ink, #ffffff) 56%, transparent);

    text-overflow: ellipsis;
    white-space: nowrap;
  `,
);

const loadButtonStyle: () => string = cacheNoArgs(
  () => css`
    flex-shrink: 0;

    padding: 6px 10px;
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

    &:hover:not(:disabled) {
      border-color: color-mix(in srgb, var(--ma-ink, #ffffff) 32%, transparent);
    }

    &:focus-visible {
      box-shadow: 0 0 0 2px var(--ma-accent, #ffffff);
    }

    &:disabled {
      opacity: 0.5;
      cursor: default;
    }
  `,
);

const loadingRowStyle: () => string = cacheNoArgs(
  () => css`
    display: flex;
    align-items: center;
    gap: 8px;

    font-size: 11.5px;
    color: color-mix(in srgb, var(--ma-ink, #ffffff) 64%, transparent);
  `,
);

const spinnerStyle: () => string = cacheNoArgs(
  () => css`
    width: 12px;
    height: 12px;
    box-sizing: border-box;

    border: 2px solid color-mix(in srgb, var(--ma-ink, #ffffff) 22%, transparent);
    border-top-color: var(--ma-accent, #ffffff);
    border-radius: 50%;

    animation: mixer-deck-spin 0.8s linear infinite;

    @keyframes mixer-deck-spin {
      to {
        transform: rotate(360deg);
      }
    }
  `,
);

const errorRowStyle: () => string = cacheNoArgs(
  () => css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;

    font-size: 11.5px;
    color: #ff8a80;
  `,
);

const retryButtonStyle: () => string = cacheNoArgs(
  () => css`
    flex-shrink: 0;

    padding: 4px 10px;
    border-radius: 6px;
    border: 1px solid
      color-mix(in srgb, var(--ma-ink, #ffffff) 22%, transparent);

    background: transparent;
    color: var(--ma-ink, #f1f1f1);
    font-family: inherit;
    font-size: 11.5px;

    cursor: pointer;
    outline: none;

    &:focus-visible {
      box-shadow: 0 0 0 2px var(--ma-accent, #ffffff);
    }
  `,
);

const transportStyle: () => string = cacheNoArgs(
  () => css`
    display: flex;
    align-items: center;
    gap: 8px;
  `,
);

const controlButtonStyle: () => string = cacheNoArgs(
  () => css`
    display: flex;
    align-items: center;
    justify-content: center;

    width: 32px;
    height: 32px;
    padding: 0;
    border-radius: 8px;
    border: 1px solid
      color-mix(in srgb, var(--ma-ink, #ffffff) 16%, transparent);

    background-color: color-mix(
      in srgb,
      var(--ma-ink, #ffffff) 7%,
      transparent
    );
    color: var(--ma-ink, #f1f1f1);

    cursor: pointer;
    outline: none;

    &:hover:not(:disabled) {
      background-color: color-mix(
        in srgb,
        var(--ma-ink, #ffffff) 14%,
        transparent
      );
    }

    &:focus-visible {
      box-shadow: 0 0 0 2px var(--ma-accent, #ffffff);
    }

    &:disabled {
      opacity: 0.4;
      cursor: default;
    }
  `,
);

const timeStyle: () => string = cacheNoArgs(
  () => css`
    margin-left: auto;

    font-family: Consolas, monospace;
    font-size: 11.5px;
    font-variant-numeric: tabular-nums;
    color: color-mix(in srgb, var(--ma-ink, #ffffff) 64%, transparent);
  `,
);

const sliderRowStyle: () => string = cacheNoArgs(
  () => css`
    display: flex;
    align-items: center;
    gap: 8px;
  `,
);

const sliderLabelStyle: () => string = cacheNoArgs(
  () => css`
    width: 72px;
    flex-shrink: 0;

    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: color-mix(in srgb, var(--ma-ink, #ffffff) 48%, transparent);
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

const sliderValueStyle: () => string = cacheNoArgs(
  () => css`
    width: 42px;
    flex-shrink: 0;

    font-family: Consolas, monospace;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    text-align: right;
    color: color-mix(in srgb, var(--ma-ink, #ffffff) 72%, transparent);
  `,
);

const hintStyle: () => string = cacheNoArgs(
  () => css`
    font-size: 11px;
    color: #ffd479;
  `,
);

const PlayIcon = () => (
  <svg height={16} viewBox={'0 0 24 24'} width={16}>
    <path d="M8 5v14l11-7z" fill="currentColor" />
  </svg>
);

const PauseIcon = () => (
  <svg height={16} viewBox={'0 0 24 24'} width={16}>
    <path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor" />
  </svg>
);

const CueIcon = () => (
  <svg height={16} viewBox={'0 0 24 24'} width={16}>
    <path d="M6 5h2v14H6zM19 5v14l-9-7z" fill="currentColor" />
  </svg>
);

type DeckCardProps = {
  deck: Deck;
  id: DeckId;
  item?: MixerQueueItem;
  onLoad: () => void;
  onRetry: () => void;
  peaks: Float32Array;
  position: number;
  progress: CacheProgress | null;
};

export const DeckCard = (props: DeckCardProps) => {
  const [core, setCore] = createSignal<DeckCore>(
    untrack(() => props.deck.getCore()),
  );
  const [rate, setRate] = createSignal(untrack(() => props.deck.getRate()));
  const [volume, setVolume] = createSignal(
    untrack(() => props.deck.getVolume()),
  );
  const [hint, setHint] = createSignal<string | null>(null);

  onMount(() => {
    const unsubscribe = props.deck.subscribe(setCore);
    onCleanup(unsubscribe);
  });

  const loading = () => core().status === 'loading';
  const ready = () => {
    const { status } = core();

    return status === 'ready' || status === 'playing' || status === 'paused'
      || status === 'ended';
  };
  const transportDisabled = () => !ready();

  const loadLabel = () => {
    if (loading()) return 'Loading…';
    if (ready()) return 'Loaded';

    return `Load ${props.id}`;
  };

  const togglePlay = () => {
    if (core().status === 'playing') {
      props.deck.pause();

      return;
    }

    props.deck.play().then(
      (started) => {
        setHint(started ? null : 'Click play again to start audio.');
      },
      () => setHint('Click play again to start audio.'),
    );
  };

  const setTempo = (value: number) => {
    props.deck.setRate(value);
    setRate(props.deck.getRate());
  };

  const setDeckVolume = (value: number) => {
    props.deck.setVolume(value);
    setVolume(props.deck.getVolume());
  };

  const tempoLabel = () => {
    const percent = Math.round((rate() - 1) * 100);

    return percent > 0 ? `+${percent}%` : `${percent}%`;
  };

  const onTempoInput: JSX.EventHandler<HTMLInputElement, InputEvent> = (
    event,
  ) => setTempo(Number(event.currentTarget.value));

  const onTempoReset = () => setTempo(1);

  const onVolumeInput: JSX.EventHandler<HTMLInputElement, InputEvent> = (
    event,
  ) => setDeckVolume(Number(event.currentTarget.value));

  return (
    <section class={cardStyle()}>
      <header class={headerStyle()}>
        <div class={artStyle()}>
          <Show
            fallback={<span class={artFallbackStyle()}>{props.id}</span>}
            when={props.item?.thumbnail}
          >
            {(thumbnail) => (
              <img alt="" class={artImageStyle()} src={thumbnail()} />
            )}
          </Show>
        </div>
        <div class={metaStyle()}>
          <span class={titleStyle()}>
            {props.item?.title ?? 'No track loaded'}
          </span>
          <span class={artistStyle()}>
            {props.item?.artist || `Deck ${props.id}`}
          </span>
        </div>
        <button
          aria-label={`Load deck ${props.id}`}
          class={loadButtonStyle()}
          disabled={!props.item || loading()}
          onClick={() => props.onLoad()}
          type="button"
        >
          {loadLabel()}
        </button>
      </header>
      <WaveformCanvas
        duration={core().duration}
        onSeek={(seconds) => props.deck.seek(seconds)}
        peaks={props.peaks}
        position={props.position}
      />
      <Show when={loading()}>
        <div aria-live="polite" class={loadingRowStyle()}>
          <span class={spinnerStyle()} />
          <span>
            {props.progress ? progressLabel(props.progress) : 'Starting…'}
          </span>
        </div>
      </Show>
      <Show when={core().error}>
        {(message) => (
          <div class={errorRowStyle()}>
            <span>{message()}</span>
            <button
              aria-label={`Retry deck ${props.id}`}
              class={retryButtonStyle()}
              onClick={() => props.onRetry()}
              type="button"
            >
              Retry
            </button>
          </div>
        )}
      </Show>
      <div class={transportStyle()}>
        <button
          aria-label={`${core().status === 'playing' ? 'Pause' : 'Play'} deck ${props.id}`}
          class={controlButtonStyle()}
          disabled={transportDisabled()}
          onClick={togglePlay}
          type="button"
        >
          <Show fallback={<PlayIcon />} when={core().status === 'playing'}>
            <PauseIcon />
          </Show>
        </button>
        <button
          aria-label={`Cue deck ${props.id}`}
          class={controlButtonStyle()}
          disabled={!ready()}
          onClick={() => props.deck.cue()}
          type="button"
        >
          <CueIcon />
        </button>
        <span class={timeStyle()}>
          {`${formatTime(props.position)} / ${formatTime(core().duration)}`}
        </span>
      </div>
      <Show when={hint()}>
        {(message) => (
          <div aria-live="polite" class={hintStyle()}>
            {message()}
          </div>
        )}
      </Show>
      <div class={sliderRowStyle()}>
        <span class={sliderLabelStyle()}>Tempo</span>
        <input
          aria-label={`Deck ${props.id} tempo`}
          class={sliderStyle()}
          max={TEMPO_MAX}
          min={TEMPO_MIN}
          onDblClick={onTempoReset}
          onInput={onTempoInput}
          step={0.01}
          type="range"
          value={rate()}
        />
        <span class={sliderValueStyle()}>{tempoLabel()}</span>
      </div>
      <div class={sliderRowStyle()}>
        <span class={sliderLabelStyle()}>Volume</span>
        <input
          aria-label={`Deck ${props.id} volume`}
          class={sliderStyle()}
          max={1}
          min={0}
          onInput={onVolumeInput}
          step={0.01}
          type="range"
          value={volume()}
        />
        <span class={sliderValueStyle()}>
          {`${Math.round(volume() * 100)}%`}
        </span>
      </div>
    </section>
  );
};
