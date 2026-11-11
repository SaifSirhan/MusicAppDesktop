export type AppearancePreset = 'default' | 'docker' | 'phosphor';

export function parseAppearancePreset(value: unknown): AppearancePreset {
  if (value === 'phosphor') return 'phosphor';
  if (value === 'docker') return 'docker';
  return 'default';
}

export function buildAppearanceCss(
  preset: AppearancePreset,
  phosphorCss: string,
  dockerCss: string,
): string {
  if (preset === 'phosphor') return phosphorCss;
  if (preset === 'docker') return dockerCss;
  return '';
}
