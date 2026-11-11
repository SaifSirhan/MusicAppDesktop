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
    border: 1px solid rgba(255, 255, 255, 0.12);

    background-color: color-mix(
      in srgb,
      var(--titlebar-background-color, #030303) 78%,
      rgba(0, 0, 0, 0.6)
    );
    backdrop-filter: blur(14px);
    box-shadow:
      0 0 0 1px rgba(0, 0, 0, 0.4),
      0 12px 40px rgba(0, 0, 0, 0.55);

    color: #f1f1f1;
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
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);

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

    color: rgba(255, 255, 255, 0.45);
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
      background-color: rgba(255, 255, 255, 0.04);
    }
  `,
);

const labelStyle = cacheNoArgs(
  () => css`
    font-size: 12.5px;
    font-weight: 500;
    color: #f1f1f1;
  `,
);

const descriptionStyle = cacheNoArgs(
  () => css`
    margin-top: 2px;

    font-size: 11px;
    line-height: 1.35;
    color: rgba(255, 255, 255, 0.52);
  `,
);

const hintStyle = cacheNoArgs(
  () => css`
    display: inline-block;
    margin-left: 6px;
    padding: 1px 5px;

    border-radius: 4px;
    background-color: rgba(255, 255, 255, 0.1);

    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.55);
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

    background-color: rgba(255, 255, 255, 0.18);
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

    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: 6px;
    outline: none;

    background-color: rgba(255, 255, 255, 0.06);
    color: #f1f1f1;
    font-family: inherit;
    font-size: 11.5px;

    cursor: pointer;

    &:hover {
      border-color: rgba(255, 255, 255, 0.28);
    }

    option {
      background-color: #202020;
      color: #f1f1f1;
    }
  `,
);

const inputStyle = cacheNoArgs(
  () => css`
    width: 150px;
    padding: 4px 6px;

    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: 6px;
    outline: none;

    background-color: rgba(255, 255, 255, 0.06);
    color: #f1f1f1;
    font-family: inherit;
    font-size: 11.5px;

    &:focus {
      border-color: var(--tm-accent, #1d63ed);
    }
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
    color: rgba(255, 255, 255, 0.6);

    cursor: pointer;
    font-size: 15px;
    line-height: 1;

    &:hover {
      background-color: rgba(255, 255, 255, 0.1);
      color: #fff;
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
  const [snapshot] = createResource(async () =>
    (await props.ipc.invoke('settings:get')) as SettingsSnapshot,
  );
  const [values, setValues] = createSignal<Record<string, unknown>>({});

  createEffect(() => {
    const data = snapshot();
    if (data) setValues(data.values);
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
