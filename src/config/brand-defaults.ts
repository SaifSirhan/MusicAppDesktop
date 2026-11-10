import { brandPluginDefaults } from './brand-plugin-defaults';
import { store } from './store';

export function applyBrandDefaults(): void {
  for (const [pluginId, pluginConfig] of Object.entries(brandPluginDefaults)) {
    if (store.get(`plugins.${pluginId}`) === undefined) {
      store.set(`plugins.${pluginId}`, pluginConfig);
    }
  }
}
