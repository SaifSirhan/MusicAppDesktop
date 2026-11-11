import {
  createEffect,
  createResource,
  createSignal,
  For,
  onCleanup,
  Show,
  type JSX,
} from 'solid-js';
import { css } from 'solid-styled-components';

import { cacheNoArgs } from '@/providers/decorators';

import {
  nearestStop,
  settingsSections,
  type SettingOption,
  type SettingRow,
  type SettingsSnapshot,
} from '../settings-schema';

const backdropStyle = cacheNoArgs(
  () => css`
    position: fixed;
    inset: 0;
    z-index: 10000010;
    background: transparent;
    -webkit-app-region: none;
  `,
);

const panelStyle = cacheNoArgs(
  () => css`
    position: fixed;
    top: calc(var(--menu-bar-height, 32px) + 8px);
    left: 8px;
    z-index: 10000011;

    width: 460px;
    max-width: calc(100vw - 16px);
    max-height: calc(100vh - var(--menu-bar-height, 32px) - 24px);
    overflow-y: auto;

    box-sizing: border-box;
    padding: 4px 0 8px;
    border-radius: 12px;
    border: 1px solid color-mix(in srgb, var(--ma-ink, #ffffff) 12%, transparent);

    background-color: color-mix(
      in srgb,
      var(--ma-surface, var(--titlebar-background-color, #0a0a0a)) 93%,
      transparent
    );
    backdrop-filter: blur(14px);
    box-shadow:
      0 0 0 1px rgba(0, 0, 0, 0.4),
      0 12px 40px rgba(0, 0, 0, 0.55);

    color: var(--ma-ink, #f1f1f1);
    font-family: Roboto, Arial, sans-serif;
    user-select: none;
    -webkit-app-region: none;
  `,
);

const headerStyle = cacheNoArgs(
  () => css`
    position: sticky;
    top: 0;
    z-index: 1;

    display: flex;
    align-items: center;
    justify-content: space-between;

    padding: 10px 14px 8px;

    background-color: inherit;
    border-bottom: 1px solid color-mix(in srgb, var(--ma-ink, #ffffff) 10%, transparent);

    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.01em;
  `,
);

const sectionTitleStyle = cacheNoArgs(
  () => css`
    padding: 12px 14px 4px;

    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;

    color: color-mix(in srgb, var(--ma-ink, #ffffff) 48%, transparent);
  `,
);

const rowStyle = cacheNoArgs(
  () => css`
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 12px;

    padding: 8px 14px;

    &:hover {
      background-color: color-mix(in srgb, var(--ma-ink, #ffffff) 5%, transparent);
    }
  `,
);

const labelStyle = cacheNoArgs(
  () => css`
    font-size: 12.5px;
    font-weight: 500;
    color: var(--ma-ink, #f1f1f1);
  `,
);

const descriptionStyle = cacheNoArgs(
  () => css`
    margin-top: 2px;

    font-size: 11px;
    line-height: 1.35;
    color: color-mix(in srgb, var(--ma-ink, #ffffff) 56%, transparent);
  `,
);

const hintStyle = cacheNoArgs(
  () => css`
    display: inline-block;
    margin-left: 6px;
    padding: 1px 5px;

    border-radius: 4px;
    background-color: color-mix(in srgb, var(--ma-ink, #ffffff) 10%, transparent);

    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    color: color-mix(in srgb, var(--ma-ink, #ffffff) 58%, transparent);
    vertical-align: 1px;
  `,
);

const switchStyle = cacheNoArgs(
  () => css`
    position: relative;

    width: 34px;
    height: 20px;
    padding: 0;

    border: none;
    border-radius: 999px;
    outline: none;
    cursor: pointer;

    background-color: color-mix(in srgb, var(--ma-ink, #ffffff) 20%, transparent);
    transition: background-color 160ms ease;

    &::after {
      content: '';
      position: absolute;
      top: 3px;
      left: 3px;

      width: 14px;
      height: 14px;

      border-radius: 50%;
      background-color: #fff;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
      transition: transform 160ms cubic-bezier(0.2, 0, 0, 1);
    }

    &[data-on='true'] {
      background-color: var(--tm-accent, #1d63ed);
    }

    &[data-on='true']::after {
      transform: translateX(14px);
    }
  `,
);

const selectStyle = cacheNoArgs(
  () => css`
    max-width: 170px;
    padding: 4px 6px;

    border: 1px solid color-mix(in srgb, var(--ma-ink, #ffffff) 18%, transparent);
    border-radius: 6px;
    outline: none;

    background-color: color-mix(in srgb, var(--ma-ink, #ffffff) 7%, transparent);
    color: var(--ma-ink, #f1f1f1);
    font-family: inherit;
    font-size: 11.5px;

    cursor: pointer;

    &:hover {
      border-color: color-mix(in srgb, var(--ma-ink, #ffffff) 30%, transparent);
    }

    option {
      background-color: var(--ma-surface-2, #202020);
      color: var(--ma-ink, #f1f1f1);
    }
  `,
);

const inputStyle = cacheNoArgs(
  () => css`
    width: 150px;
    padding: 4px 6px;

    border: 1px solid color-mix(in srgb, var(--ma-ink, #ffffff) 18%, transparent);
    border-radius: 6px;
    outline: none;

    background-color: color-mix(in srgb, var(--ma-ink, #ffffff) 7%, transparent);
    color: var(--ma-ink, #f1f1f1);
    font-family: inherit;
    font-size: 11.5px;

    &:focus {
      border-color: var(--tm-accent, #1d63ed);
    }
  `,
);

const colorWrapStyle = cacheNoArgs(
  () => css`
    display: flex;
    align-items: center;
    gap: 6px;
  `,
);

const colorInputStyle = cacheNoArgs(
  () => css`
    width: 34px;
    height: 22px;
    padding: 0;

    border: 1px solid color-mix(in srgb, var(--ma-ink, #ffffff) 18%, transparent);
    border-radius: 6px;
    background: transparent;
    cursor: pointer;

    &::-webkit-color-swatch-wrapper {
      padding: 2px;
    }
    &::-webkit-color-swatch {
      border: none;
      border-radius: 4px;
    }
  `,
);

const colorValueStyle = cacheNoArgs(
  () => css`
    min-width: 62px;

    font-family: Consolas, monospace;
    font-size: 10.5px;
    letter-spacing: 0.03em;
    color: color-mix(in srgb, var(--ma-ink, #ffffff) 64%, transparent);

    cursor: default;
    user-select: text;
  `,
);

const rangeWrapStyle = cacheNoArgs(
  () => css`
    display: flex;
    align-items: center;
    gap: 8px;
    width: 176px;
  `,
);

const rangeStyle = cacheNoArgs(
  () => css`
    flex: 1;
    height: 4px;
    margin: 0;

    accent-color: var(--tm-accent, #1d63ed);
    cursor: pointer;
  `,
);

const rangeValueStyle = cacheNoArgs(
  () => css`
    min-width: 34px;

    font-family: Consolas, monospace;
    font-size: 11px;
    text-align: right;
    color: var(--ma-ink, #f1f1f1);
  `,
);

const swatchStripStyle = cacheNoArgs(
  () => css`
    display: flex;
    height: 34px;
    margin: 4px 14px 8px;
    overflow: hidden;

    border-radius: 8px;
    border: 1px solid color-mix(in srgb, var(--ma-ink, #ffffff) 16%, transparent);
  `,
);

const swatchCellStyle = cacheNoArgs(
  () => css`
    flex: 1;
    transition: background-color 160ms ease;
  `,
);

const closeStyle = cacheNoArgs(
  () => css`
    width: 22px;
    height: 22px;
    padding: 0;

    border: none;
    border-radius: 4px;
    background: transparent;
    color: color-mix(in srgb, var(--ma-ink, #ffffff) 62%, transparent);

    cursor: pointer;
    font-size: 15px;
    line-height: 1;

    &:hover {
      background-color: color-mix(in srgb, var(--ma-ink, #ffffff) 10%, transparent);
      color: var(--ma-ink, #ffffff);
    }
  `,
);

const applyHint = (row: SettingRow): string | undefined => {
  if (row.apply === 'restart') return 'Restart';
  if (row.apply === 'reload') return 'Reload';
  return undefined;
};

const textValue = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return '';
};

export type SettingsPanelProps = {
  ipc: {
    invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
  };
  open: boolean;
  onClose: () => void;
};

export const SettingsPanel = (props: SettingsPanelProps) => {
  const [snapshot, { refetch }] = createResource(async () =>
    (await props.ipc.invoke('settings:get')) as SettingsSnapshot,
  );
  const [values, setValues] = createSignal<Record<string, unknown>>({});

  createEffect(() => {
    const data = snapshot();
    if (data) setValues(data.values);
  });

  // Config can change outside the panel (menus, plugins); refresh on open.
  createEffect(() => {
    if (!props.open) return;
    Promise.resolve(refetch()).catch(() => undefined);
  });

  const langOptions = (): SettingOption[] =>
    (snapshot()?.languages ?? []).map((lang) => ({
      value: lang.code,
      label: lang.name,
    }));

  const update = (key: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    props.ipc.invoke('settings:set', key, value).catch((error: unknown) => {
      console.error('Failed to apply setting', key, error);
    });
  };

  createEffect(() => {
    if (!props.open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') props.onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    onCleanup(() => window.removeEventListener('keydown', onKeyDown));
  });

  const control = (row: SettingRow): JSX.Element => {
    const value = () => values()[row.key];

    if (row.kind === 'switch') {
      return (
        <button
          aria-checked={Boolean(value())}
          class={switchStyle()}
          data-on={Boolean(value())}
          onClick={() => update(row.key, !value())}
          role="switch"
          type="button"
        />
      );
    }

    if (row.kind === 'color') {
      const color = textValue(value()) || row.fallback;
      return (
        <div class={colorWrapStyle()}>
          <input
            aria-label={row.label}
            class={colorInputStyle()}
            onChange={(event) => update(row.key, event.currentTarget.value)}
            type="color"
            value={color}
          />
          <span class={colorValueStyle()}>{color.toUpperCase()}</span>
        </div>
      );
    }

    if (row.kind === 'range') {
      const stops = row.stops;
      const current = () => nearestStop(stops, Number(value()) || 0);
      const index = () => Math.max(0, stops.indexOf(current()));

      return (
        <div class={rangeWrapStyle()}>
          <input
            aria-label={row.label}
            class={rangeStyle()}
            max={stops.length - 1}
            min={0}
            onInput={(event) =>
              update(row.key, stops[Number(event.currentTarget.value)])
            }
            step={1}
            type="range"
            value={index()}
          />
          <span class={rangeValueStyle()}>
            {current() === 0 ? 'Off' : `${current()} s`}
          </span>
        </div>
      );
    }

    if (row.kind === 'select') {
      const options =
        row.dynamicOptions === 'languages' && row.key === 'options.language'
          ? langOptions()
          : (row.options ?? []);

      return (
        <select
          class={selectStyle()}
          onChange={(event) => update(row.key, event.currentTarget.value)}
          ref={(element) => {
            createEffect(() => {
              element.value = textValue(value());
            });
          }}
        >
          <For each={options}>
            {(option) => <option value={option.value}>{option.label}</option>}
          </For>
        </select>
      );
    }

    return (
      <input
        class={inputStyle()}
        onChange={(event) =>
          update(row.key, event.currentTarget.value.trim())
        }
        placeholder={row.placeholder}
        type="text"
        value={textValue(value())}
      />
    );
  };

  return (
    <Show when={props.open}>
      <div class={backdropStyle()} onClick={() => props.onClose()} />
      <div class={panelStyle()} data-ytmd-settings-panel={true}>
        <div class={headerStyle()}>
          <span>Settings</span>
          <button
            aria-label="Close settings"
            class={closeStyle()}
            onClick={() => props.onClose()}
            type="button"
          >
            ×
          </button>
        </div>
        <For each={settingsSections}>
          {(section) => (
            <>
              <div class={sectionTitleStyle()}>{section.title}</div>
              <Show when={section.id === 'appearance'}>
                <div class={swatchStripStyle()}>
                  <For
                    each={[
                      'appearance.background',
                      'appearance.accent',
                      'appearance.accent2',
                    ]}
                  >
                    {(key) => {
                      const row = section.rows.find((item) => item.key === key);
                      const fallback =
                        row?.kind === 'color' ? row.fallback : '#000000';
                      const color = textValue(values()[key]) || fallback;
                      return (
                        <div
                          class={swatchCellStyle()}
                          style={{ 'background-color': color }}
                          title={color.toUpperCase()}
                        />
                      );
                    }}
                  </For>
                </div>
              </Show>
              <For each={section.rows}>
                {(row) => (
                  <div class={rowStyle()}>
                    <div>
                      <div class={labelStyle()}>
                        {row.label}
                        <Show when={applyHint(row)}>
                          <span class={hintStyle()}>{applyHint(row)}</span>
                        </Show>
                      </div>
                      <div class={descriptionStyle()}>{row.description}</div>
                    </div>
                    {control(row)}
                  </div>
                )}
              </For>
            </>
          )}
        </For>
      </div>
    </Show>
  );
};
