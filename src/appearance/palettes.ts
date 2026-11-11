import type { SolidColors } from './theme';

export interface ThemePalette extends SolidColors {
  id: string;
  name: string;
}

/**
 * Premade solid palettes. The token engine derives surfaces, ink and borders
 * from these three colours, so every palette needs a background with enough
 * contrast for its accent pair.
 */
export const THEME_PALETTES: ThemePalette[] = [
  {
    id: 'deep-field',
    name: 'Deep Field',
    background: '#05070f',
    accent: '#4f7cff',
    accent2: '#9d7bff',
  },
  {
    id: 'distant-galaxy',
    name: 'Distant Galaxy',
    background: '#0f0a24',
    accent: '#a78bfa',
    accent2: '#22d3ee',
  },
  {
    id: 'sakura-pop',
    name: 'Sakura Pop',
    background: '#1b0e17',
    accent: '#ff7ab6',
    accent2: '#8ab4ff',
  },
  {
    id: 'hud',
    name: 'HUD',
    background: '#060b0e',
    accent: '#22d3ee',
    accent2: '#fbbf24',
  },
  {
    id: 'sunset-arcade',
    name: 'Sunset Arcade',
    background: '#1a0b1e',
    accent: '#ff7a45',
    accent2: '#ff4fa3',
  },
  {
    id: 'amp-black',
    name: 'Amp Black',
    background: '#0a0a0a',
    accent: '#ef4444',
    accent2: '#f97316',
  },
  {
    id: 'chrome-blood',
    name: 'Chrome & Blood',
    background: '#14161a',
    accent: '#c3cad6',
    accent2: '#b91c1c',
  },
  {
    id: 'blackout',
    name: 'Blackout',
    background: '#000000',
    accent: '#dc2626',
    accent2: '#9ca3af',
  },
  {
    id: 'noir',
    name: 'Noir',
    background: '#0d0d0d',
    accent: '#f5f5f5',
    accent2: '#a3a3a3',
  },
  {
    id: 'cape-comic',
    name: 'Cape Comic',
    background: '#0b1026',
    accent: '#e11d48',
    accent2: '#facc15',
  },
  {
    id: 'cotton-candy',
    name: 'Cotton Candy',
    background: '#fdf2f8',
    accent: '#ec4899',
    accent2: '#38bdf8',
  },
  {
    id: 'beige-machine',
    name: 'Beige Machine',
    background: '#efe7d8',
    accent: '#b45309',
    accent2: '#78716c',
  },
  {
    id: 'daylight-amber',
    name: 'Daylight Amber',
    background: '#fff8e7',
    accent: '#b45309',
    accent2: '#f59e0b',
  },
  {
    id: 'level-zero',
    name: 'Level 0',
    background: '#e9dfae',
    accent: '#7c6f2e',
    accent2: '#3f6212',
  },
];

export const paletteById = (id: string): ThemePalette | undefined =>
  THEME_PALETTES.find((palette) => palette.id === id);

export const paletteSelectValue = (id: string): string => `palette:${id}`;
