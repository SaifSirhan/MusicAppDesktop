import { createEffect, on, onCleanup, onMount, type JSX } from 'solid-js';
import { css } from 'solid-styled-components';

import { cacheNoArgs } from '@/providers/decorators';

import { barsFromPeaks } from './waveform';

const canvasStyle: () => string = cacheNoArgs(
  () => css`
    display: block;
    width: 100%;
    height: 72px;
    border-radius: 6px;
    background: color-mix(
      in srgb,
      var(--titlebar-background-color, #030303) 60%,
      transparent
    );
    cursor: pointer;
    outline: none;

    &:focus-visible {
      box-shadow: 0 0 0 2px var(--ma-accent, #ffffff);
    }
  `,
);

type WaveformCanvasProps = {
  peaks: Float32Array;
  position: number;
  duration: number;
  onSeek: (seconds: number) => void;
};

export const WaveformCanvas = (props: WaveformCanvasProps) => {
  let canvas: HTMLCanvasElement | undefined;

  const setCanvas = (element: HTMLCanvasElement) => {
    canvas = element;
  };

  const draw = () => {
    const element = canvas;
    const context = element?.getContext('2d');
    if (!element || !context) return;

    const width = element.clientWidth;
    const height = element.clientHeight;
    if (width === 0 || height === 0) return;

    const scale = window.devicePixelRatio || 1;
    const pixelWidth = Math.floor(width * scale);
    const pixelHeight = Math.floor(height * scale);
    if (element.width !== pixelWidth || element.height !== pixelHeight) {
      element.width = pixelWidth;
      element.height = pixelHeight;
    }

    context.setTransform(scale, 0, 0, scale, 0, 0);
    context.clearRect(0, 0, width, height);

    const bars = barsFromPeaks(props.peaks, Math.max(1, Math.floor(width / 2)));
    const played =
      props.duration > 0
        ? Math.min(1, Math.max(0, props.position / props.duration))
        : 0;

    bars.forEach((bar, index) => {
      const barHeight = Math.max(1, bar * (height - 4));
      const ratio = index / Math.max(1, bars.length);

      context.fillStyle =
        ratio <= played ? 'rgba(255, 255, 255, 0.95)' : 'rgba(255, 255, 255, 0.3)';
      context.fillRect(index * 2, (height - barHeight) / 2, 1.5, barHeight);
    });

    context.fillStyle = 'rgba(255, 255, 255, 0.9)';
    context.fillRect(played * width, 0, 1, height);
  };

  const seekFromClientX = (clientX: number) => {
    const element = canvas;
    if (!element || props.duration <= 0) return;

    const rect = element.getBoundingClientRect();
    if (rect.width === 0) return;

    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    props.onSeek(ratio * props.duration);
  };

  onMount(() => {
    const element = canvas;
    if (!element) return;

    const observer = new ResizeObserver(() => draw());
    observer.observe(element);
    onCleanup(() => observer.disconnect());
  });

  createEffect(
    on(
      () => [props.peaks, props.position, props.duration] as const,
      () => draw(),
    ),
  );

  const onCanvasClick: JSX.EventHandler<HTMLCanvasElement, MouseEvent> = (
    event,
  ) => seekFromClientX(event.clientX);

  const onCanvasKeyDown: JSX.EventHandler<HTMLCanvasElement, KeyboardEvent> = (
    event,
  ) => {
    if (event.key === 'ArrowRight') props.onSeek(props.position + 5);
    if (event.key === 'ArrowLeft') props.onSeek(props.position - 5);
  };

  return (
    <canvas
      aria-label="Track waveform, click to seek"
      aria-valuemax={props.duration}
      aria-valuemin={0}
      aria-valuenow={props.position}
      class={canvasStyle()}
      onClick={onCanvasClick}
      onKeyDown={onCanvasKeyDown}
      ref={setCanvas}
      role="slider"
      tabindex="0"
    />
  );
};
