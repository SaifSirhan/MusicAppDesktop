import { type Menu, type MenuItem } from 'electron';
import {
  createEffect,
  createResource,
  createSignal,
  Index,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import { css } from 'solid-styled-components';
import { TransitionGroup } from 'solid-transition-group';

import { cacheNoArgs } from '@/providers/decorators';

import { IconButton } from './IconButton';
import { MenuButton } from './MenuButton';
import { Panel } from './Panel';
import { PanelItem } from './PanelItem';
import { SettingsPanel } from './SettingsPanel';
import { WindowController } from './WindowController';

import type { InAppMenuConfig } from '../constants';
import type { RendererContext } from '@/types/contexts';

const titleStyle = cacheNoArgs(
  () => css`
    -webkit-app-region: drag;
    box-sizing: border-box;

    position: fixed;
    top: 0;
    z-index: 10000000;

    width: 100%;
    height: var(--menu-bar-height, 32px);

    display: flex;
    flex-flow: row;
    justify-content: flex-start;
    align-items: center;
    gap: 4px;

    color: var(--ma-ink, #f1f1f1);
    font-size: 12px;
    padding: 4px 4px 4px var(--offset-left, 4px);
    background-color: var(--titlebar-background-color, #030303);
    user-select: none;

    transition:
      opacity 200ms ease 0s,
      transform 300ms cubic-bezier(0.2, 0, 0.6, 1) 0s,
      background-color 300ms cubic-bezier(0.2, 0, 0.6, 1) 0s;

    &[data-macos='true'] {
      padding: 4px 4px 4px 74px;
    }
  `,
);

const separatorStyle = cacheNoArgs(
  () => css`
    min-height: 1px;
    height: 1px;
    margin: 4px 0;

    background-color: color-mix(in srgb, var(--ma-ink, #ffffff) 22%, transparent);
  `,
);

const animationStyle = cacheNoArgs(() => ({
  enter: css`
    opacity: 0;
    transform: translateX(-50%) scale(0.8);
  `,
  enterActive: css`
    transition:
      opacity 0.1s cubic-bezier(0.33, 1, 0.68, 1),
      transform 0.1s cubic-bezier(0.33, 1, 0.68, 1);
  `,
  exitTo: css`
    opacity: 0;
    transform: translateX(-50%) scale(0.8);
  `,
  exitActive: css`
    transition:
      opacity 0.1s cubic-bezier(0.32, 0, 0.67, 0),
      transform 0.1s cubic-bezier(0.32, 0, 0.67, 0);
  `,
  move: css`
    transition: all 0.1s cubic-bezier(0.65, 0, 0.35, 1);
  `,
  fakeTarget: css`
    position: absolute;
    opacity: 0;
  `,
  fake: css`
    transition: all 0.00000000001s;
  `,
}));

export type PanelRendererProps = {
  items: Electron.Menu['items'];
  level?: number[];
  onClick?: (commandId: number, radioGroup?: MenuItem[]) => void;
};
const PanelRenderer = (props: PanelRendererProps) => {
  const radioGroup = () => props.items.filter((it) => it.type === 'radio');

  return (
    <Index each={props.items}>
      {(subItem) => (
        <Show when={subItem().visible}>
          <Switch>
            <Match when={subItem().type === 'normal'}>
              <PanelItem
                chip={subItem().sublabel}
                commandId={subItem().commandId}
                name={subItem().label}
                onClick={() => props.onClick?.(subItem().commandId)}
                toolTip={subItem().toolTip}
                type={'normal'}
              />
            </Match>
            <Match when={subItem().type === 'submenu'}>
              <PanelItem
                chip={subItem().sublabel}
                commandId={subItem().commandId}
                level={[...(props.level ?? []), subItem().commandId]}
                name={subItem().label}
                toolTip={subItem().toolTip}
                type={'submenu'}
              >
                <PanelRenderer
                  items={subItem().submenu?.items ?? []}
                  level={[...(props.level ?? []), subItem().commandId]}
                  onClick={props.onClick}
                />
              </PanelItem>
            </Match>
            <Match when={subItem().type === 'checkbox'}>
              <PanelItem
                checked={subItem().checked}
                chip={subItem().sublabel}
                commandId={subItem().commandId}
                name={subItem().label}
                onChange={() => props.onClick?.(subItem().commandId)}
                toolTip={subItem().toolTip}
                type={'checkbox'}
              />
            </Match>
            <Match when={subItem().type === 'radio'}>
              <PanelItem
                checked={subItem().checked}
                chip={subItem().sublabel}
                commandId={subItem().commandId}
                name={subItem().label}
                onChange={() =>
                  props.onClick?.(subItem().commandId, radioGroup())
                }
                toolTip={subItem().toolTip}
                type={'radio'}
              />
            </Match>
            <Match when={subItem().type === 'separator'}>
              <hr class={separatorStyle()} />
            </Match>
          </Switch>
        </Show>
      )}
    </Index>
  );
};

export type TitleBarProps = {
  ipc: RendererContext<InAppMenuConfig>['ipc'];
  isMacOS?: boolean;
  enableController?: boolean;
  initialCollapsed?: boolean;
};
export const TitleBar = (props: TitleBarProps) => {
  const [collapsed, setCollapsed] = createSignal(props.initialCollapsed);
  const [ignoreTransition, setIgnoreTransition] = createSignal(false);
  const [openTarget, setOpenTarget] = createSignal<HTMLElement | null>(null);
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [menu, setMenu] = createSignal<Menu | null>(null);
  const [mouseY, setMouseY] = createSignal(0);

  const [data, { refetch }] = createResource(
    async () => (await props.ipc.invoke('get-menu')) as Promise<Menu | null>,
  );
  const [isMaximized, { refetch: refetchMaximize }] = createResource(
    async () =>
      (await props.ipc.invoke('window-is-maximized')) as Promise<boolean>,
  );

  const handleToggleMaximize = async () => {
    if (isMaximized()) {
      await props.ipc.invoke('window-unmaximize');
    } else {
      await props.ipc.invoke('window-maximize');
    }
    await refetchMaximize();
  };
  const handleMinimize = async () => {
    await props.ipc.invoke('window-minimize');
  };
  const handleClose = async () => {
    await props.ipc.invoke('window-close');
  };

  const refreshMenuItem = async (originalMenu: Menu, commandId: number) => {
    const menuItem = (await window.ipcRenderer.invoke(
      'get-menu-by-id',
      commandId,
    )) as MenuItem | null;

    const newMenu = structuredClone(originalMenu);
    const stack = [...(newMenu?.items ?? [])];
    let now: MenuItem | undefined = stack.pop();
    while (now) {
      const index =
        now?.submenu?.items?.findIndex((it) => it.commandId === commandId) ??
        -1;

      if (index >= 0) {
        if (menuItem) now?.submenu?.items?.splice(index, 1, menuItem);
        else now?.submenu?.items?.splice(index, 1);
      }
      if (now?.submenu) {
        stack.push(...now.submenu.items);
      }

      now = stack.pop();
    }

    return newMenu;
  };

  const handleItemClick = async (
    commandId: number,
    radioGroup?: MenuItem[],
  ) => {
    const menuData = menu();
    if (!menuData) return;

    if (Array.isArray(radioGroup)) {
      let newMenu = menuData;
      for (const item of radioGroup) {
        newMenu = await refreshMenuItem(newMenu, item.commandId);
      }

      setMenu(newMenu);
      return;
    }

    setMenu(await refreshMenuItem(menuData, commandId));
  };

  const listener = (e: MouseEvent) => {
    setMouseY(e.clientY);
  };

  onMount(() => {
    props.ipc.on('close-all-in-app-menu-panel', async () => {
      setIgnoreTransition(true);
      setMenu(null);
      await refetch();
      setMenu(data() ?? null);
      setIgnoreTransition(false);
    });
    props.ipc.on('refresh-in-app-menu', async () => {
      setIgnoreTransition(true);
      await refetch();
      setMenu(data() ?? null);
      setIgnoreTransition(false);
    });
    props.ipc.on('set-in-app-menu-collapsed', (value: unknown) => {
      setCollapsed(Boolean(value));
    });

    props.ipc.on('window-maximize', refetchMaximize);
    props.ipc.on('window-unmaximize', refetchMaximize);

    // close menu when the outside of the panel or sub-panel is clicked
    document.body.addEventListener('click', (e) => {
      if (
        e.target instanceof HTMLElement &&
        !(
          e.target.closest('nav[data-ytmd-main-panel]') ||
          e.target.closest('ul[data-ytmd-sub-panel]')
        )
      ) {
        setOpenTarget(null);
      }
    });

    // tracking mouse position
    window.addEventListener('mousemove', listener);
    const ytmusicAppLayout = document.querySelector<HTMLElement>('#layout');
    ytmusicAppLayout?.addEventListener('scroll', () => {
      const scrollValue = ytmusicAppLayout.scrollTop;
      if (scrollValue > 20) {
        ytmusicAppLayout.classList.add('content-scrolled');
      } else {
        ytmusicAppLayout.classList.remove('content-scrolled');
      }
    });
  });

  createEffect(() => {
    if (!menu() && data()) {
      setMenu(data() ?? null);
    }
  });

  createEffect(() => {
    if (collapsed()) setOpenTarget(null);
  });

  onCleanup(() => {
    window.removeEventListener('mousemove', listener);
  });

  return (
    <nav
      class={titleStyle()}
      data-collapsed={collapsed()}
      data-macos={props.isMacOS}
      data-show={mouseY() < 32}
      data-ytmd-main-panel={true}
      id={'ytmd-title-bar-main-panel'}
    >
      <IconButton
        onClick={() => setCollapsed(!collapsed())}
        style={{
          'border-top-left-radius': '4px',
        }}
      >
        <svg height={16} viewBox={'0 0 24 24'} width={16}>
          <path
            d="M3 17h12a1 1 0 0 1 .117 1.993L15 19H3a1 1 0 0 1-.117-1.993L3 17h12H3Zm0-6h18a1 1 0 0 1 .117 1.993L21 13H3a1 1 0 0 1-.117-1.993L3 11h18H3Zm0-6h15a1 1 0 0 1 .117 1.993L18 7H3a1 1 0 0 1-.117-1.993L3 5h15H3Z"
            fill="currentColor"
          />
        </svg>
      </IconButton>
      <IconButton
        aria-label="Settings"
        onClick={() => {
          setOpenTarget(null);
          setSettingsOpen(!settingsOpen());
        }}
      >
        <svg height={16} viewBox={'0 0 24 24'} width={16}>
          <path
            d="M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.61-.22l-2.39.96a7.1 7.1 0 0 0-1.62-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.5.5 0 0 0-.61.22L2.74 8.87a.5.5 0 0 0 .12.64l2.03 1.58c-.04.3-.06.61-.06.94s.02.64.06.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.13.22.39.3.61.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.25.42.5.42h3.84c.25 0 .46-.18.5-.42l.36-2.54c.59-.24 1.13-.57 1.62-.94l2.39.96c.22.08.48 0 .61-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2Z"
            fill="currentColor"
          />
        </svg>
      </IconButton>
      <TransitionGroup
        enterActiveClass={
          ignoreTransition()
            ? animationStyle().fake
            : animationStyle().enterActive
        }
        enterClass={
          ignoreTransition()
            ? animationStyle().fakeTarget
            : animationStyle().enter
        }
        exitActiveClass={
          ignoreTransition()
            ? animationStyle().fake
            : animationStyle().exitActive
        }
        exitToClass={
          ignoreTransition()
            ? animationStyle().fakeTarget
            : animationStyle().exitTo
        }
        onAfterEnter={(element) => {
          (element as HTMLElement).style.removeProperty('transition-delay');
        }}
        onBeforeEnter={(element) => {
          if (ignoreTransition()) return;
          const index = Number(element.getAttribute('data-index') ?? 0);

          (element as HTMLElement).style.setProperty(
            'transition-delay',
            `${index * 0.025}s`,
          );
        }}
        onBeforeExit={(element) => {
          if (ignoreTransition()) return;
          const index = Number(element.getAttribute('data-index') ?? 0);
          const length = Number(element.getAttribute('data-length') ?? 1);

          (element as HTMLElement).style.setProperty(
            'transition-delay',
            `${(length * 0.025) - (index * 0.025)}s`,
          );
        }}
      >
        <Index each={menu()?.items}>
          {(item, index) => {
            const [anchor, setAnchor] = createSignal<HTMLElement | null>(null);

            const handleClick = () => {
              if (collapsed()) return;
              if (openTarget() === anchor()) {
                setOpenTarget(null);
              } else {
                setOpenTarget(anchor());
              }
            };

            return (
              <>
                <MenuButton
                  data-index={index}
                  data-length={data()?.items.length}
                  onClick={handleClick}
                  ref={setAnchor}
                  selected={openTarget() === anchor()}
                  text={item().label}
                />
                <Panel
                  anchor={anchor()}
                  offset={{ mainAxis: 8 }}
                  open={openTarget() === anchor()}
                  placement={'bottom-start'}
                >
                  <PanelRenderer
                    items={item().submenu?.items ?? []}
                    onClick={handleItemClick}
                  />
                </Panel>
              </>
            );
          }}
        </Index>
      </TransitionGroup>
      <SettingsPanel
        ipc={props.ipc}
        onClose={() => setSettingsOpen(false)}
        open={settingsOpen()}
      />
      <Show when={props.enableController}>
        <div style={{ flex: 1 }} />
        <WindowController
          isMaximize={isMaximized()}
          onClose={handleClose}
          onMinimize={handleMinimize}
          onToggleMaximize={handleToggleMaximize}
        />
      </Show>
    </nav>
  );
};
