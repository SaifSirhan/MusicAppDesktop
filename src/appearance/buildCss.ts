export type AppearancePreset = 'default' | 'phosphor';

export function parseAppearancePreset(value: unknown): AppearancePreset {
  return value === 'phosphor' ? 'phosphor' : 'default';
}

export function buildAppearanceCss(
  preset: AppearancePreset,
  phosphorCss: string,
): string {
  return preset === 'phosphor' ? phosphorCss : '';
}
