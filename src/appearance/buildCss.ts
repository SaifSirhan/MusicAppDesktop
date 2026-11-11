import { buildSolidThemeCss, SOLID_DEFAULTS, type SolidColors } from './theme';

export type AppearancePreset = 'default' | 'docker' | 'phosphor' | 'custom';

export function parseAppearancePreset(value: unknown): AppearancePreset {
  if (value === 'phosphor') return 'phosphor';
  if (value === 'docker') return 'docker';
  if (value === 'custom') return 'custom';
  return 'default';
}

export function buildAppearanceCss(
  preset: AppearancePreset,
  phosphorCss: string,
  dockerCss: string,
  solidColors: SolidColors = SOLID_DEFAULTS,
): string {
  if (preset === 'phosphor') return phosphorCss;
  if (preset === 'docker') return dockerCss;
  if (preset === 'custom') return buildSolidThemeCss(solidColors);
  return '';
}
