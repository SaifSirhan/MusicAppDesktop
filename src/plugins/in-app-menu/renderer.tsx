import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';

import { APPLICATION_NAME } from '@/i18n';

import { defaultInAppMenuConfig, type InAppMenuConfig } from './constants';
import { TitleBar } from './renderer/TitleBar';

import type { RendererContext } from '@/types/contexts';

const isMacOS = navigator.userAgent.includes('Macintosh');
const isNotWindowsOrMacOS =
  !navigator.userAgent.includes('Windows') && !isMacOS;

const [config, setConfig] = createSignal<InAppMenuConfig>(
  defaultInAppMenuConfig,
);
export const onRendererLoad = async ({
  getConfig,
  ipc,
}: RendererContext<InAppMenuConfig>) => {
  setConfig(await getConfig());

  document.title = APPLICATION_NAME;

  render(
    () => (
      <TitleBar
        enableController={
          isNotWindowsOrMacOS && !config().hideDOMWindowControls
        }
        initialCollapsed={window.mainConfig.get('options.hideMenu')}
        ipc={ipc}
        isMacOS={isMacOS}
      />
    ),
    document.body,
  );
};

export const onPlayerApiReady = () => {
  // NOT WORKING AFTER YTM UPDATE (last checked 2024-02-04)
  //
  // const htmlHeadStyle = document.querySelector('head > div > style');
  // if (htmlHeadStyle) {
  //   // HACK: This is a hack to remove the scrollbar width
  //   htmlHeadStyle.innerHTML = htmlHeadStyle.innerHTML.replace(
  //     'html::-webkit-scrollbar {width: var(--ytmusic-scrollbar-width);',
  //     'html::-webkit-scrollbar { width: 0;',
  //   );
  // }
};

export const onConfigChange = (newConfig: InAppMenuConfig) => {
  setConfig(newConfig);
};
