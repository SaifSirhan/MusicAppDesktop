import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import { onMainLoad } from './backend';
import { defaultMixerConfig } from './types';

export default createPlugin({
  name: () => t('plugins.mixer.name'),
  description: () => t('plugins.mixer.description'),
  restartNeeded: true,
  config: { ...defaultMixerConfig },
  backend: {
    start: onMainLoad,
  },
});
