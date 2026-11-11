export interface SolidColors {
  background: string;
  accent: string;
  accent2: string;
}

export const SOLID_DEFAULTS: SolidColors = {
  background: '#0f0f0f',
  accent: '#1d63ed',
  accent2: '#5b8bff',
};

const HEX_PATTERN = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

export const normalizeHex = (value: unknown, fallback: string): string => {
  if (typeof value !== 'string') return fallback;
  const match = value.trim().match(HEX_PATTERN);
  if (!match) return fallback;
  const raw = match[1];
  const expanded =
    raw.length === 3
      ? raw
          .split('')
          .map((char) => char + char)
          .join('')
      : raw;
  return `#${expanded.toLowerCase()}`;
};

const channelToLinear = (channel: number): number => {
  const value = channel / 255;
  return value <= 0.04045
    ? value / 12.92
    : Math.pow((value + 0.055) / 1.055, 2.4);
};

export const relativeLuminance = (hex: string): number => {
  const normalized = normalizeHex(hex, '#000000');
  const r = Number.parseInt(normalized.slice(1, 3), 16);
  const g = Number.parseInt(normalized.slice(3, 5), 16);
  const b = Number.parseInt(normalized.slice(5, 7), 16);
  const red = 0.2126 * channelToLinear(r);
  const green = 0.7152 * channelToLinear(g);
  const blue = 0.0722 * channelToLinear(b);
  return red + (green + blue);
};

/** Dark ink on bright surfaces, light ink on dark surfaces. */
export const readableInk = (background: string): string =>
  relativeLuminance(background) > 0.42 ? '#141414' : '#f5f7fa';

export const isLightTheme = (background: string): boolean =>
  relativeLuminance(background) > 0.42;

const mix = (base: string, toward: string, percent: number): string =>
  `color-mix(in srgb, ${base} ${100 - percent}%, ${toward} ${percent}%)`;

export function buildSolidThemeCss(colors: SolidColors): string {
  const bg = normalizeHex(colors.background, SOLID_DEFAULTS.background);
  const accent = normalizeHex(colors.accent, SOLID_DEFAULTS.accent);
  const accent2 = normalizeHex(colors.accent2, SOLID_DEFAULTS.accent2);

  const light = isLightTheme(bg);
  const ink = readableInk(bg);
  const surface = light ? mix(bg, '#000000', 6) : mix(bg, '#ffffff', 8);
  const surface2 = light ? mix(bg, '#000000', 12) : mix(bg, '#ffffff', 15);
  const inkDim = mix(ink, bg, 25);
  const inkFaint = mix(ink, bg, 48);
  const line = mix(ink, bg, 76);
  const accentHot = mix(accent, '#ffffff', 22);
  const accentDim = mix(accent, '#000000', 40);
  const accentInk = readableInk(accent);
  const accent2Ink = readableInk(accent2);
  const scheme = light ? 'light' : 'dark';

  return `/* MusicApp solid theme: ${bg} / ${accent} / ${accent2} */
:root,
body,
ytmusic-app {
  color-scheme: ${scheme};

  --ma-bg: ${bg};
  --ma-surface: ${surface};
  --ma-surface-2: ${surface2};
  --ma-ink: ${ink};
  --ma-ink-dim: ${inkDim};
  --ma-ink-faint: ${inkFaint};
  --ma-line: ${line};
  --ma-accent: ${accent};
  --ma-accent-hot: ${accentHot};
  --ma-accent-dim: ${accentDim};
  --ma-accent-2: ${accent2};
  --ma-accent-ink: ${accentInk};
  --ma-accent-2-ink: ${accent2Ink};

  /* app chrome (titlebar + settings studio) */
  --tm-accent: var(--ma-accent);
  --tm-accent-hot: var(--ma-accent-hot);
  --tm-accent-dim: var(--ma-accent-dim);
  --titlebar-background-color: var(--ma-surface);

  /* YouTube Music design tokens */
  --yt-spec-base-background: var(--ma-bg);
  --yt-spec-raised-background: var(--ma-surface);
  --yt-spec-menu-background: var(--ma-surface-2);
  --yt-spec-inverted-background: var(--ma-ink);
  --yt-spec-general-background-a: var(--ma-bg);
  --yt-spec-general-background-b: var(--ma-bg);
  --yt-spec-general-background-c: var(--ma-bg);
  --yt-spec-text-primary: var(--ma-ink);
  --yt-spec-text-primary-inverse: var(--ma-accent-ink);
  --yt-spec-text-secondary: var(--ma-ink-dim);
  --yt-spec-text-disabled: var(--ma-ink-faint);
  --yt-spec-icon-active-other: var(--ma-accent);
  --yt-spec-icon-inactive: var(--ma-ink-dim);
  --yt-spec-icon-disabled: var(--ma-ink-faint);
  --yt-spec-call-to-action: var(--ma-accent);
  --yt-spec-call-to-action-hover: var(--ma-accent-hot);
  --yt-spec-call-to-action-inverse: var(--ma-accent-ink);
  --yt-spec-brand-link-text: var(--ma-accent-2);
  --yt-spec-static-brand-red: var(--ma-accent);
  --yt-spec-static-brand-white: var(--ma-ink);
  --yt-spec-themed-blue: var(--ma-accent);
  --yt-spec-themed-green: var(--ma-accent-2);
  --yt-spec-badge-chip-background: color-mix(in srgb, var(--ma-accent) 14%, transparent);
  --yt-spec-10-percent-layer: color-mix(in srgb, var(--ma-ink) 8%, transparent);
  --yt-spec-touch-response: color-mix(in srgb, var(--ma-accent) 16%, transparent);
  --yt-spec-button-chip-background-hover: color-mix(in srgb, var(--ma-ink) 12%, transparent);
  --yt-spec-wordmark-text: var(--ma-ink);
  --yt-spec-static-overlay-background-heavy: color-mix(in srgb, var(--ma-bg) 94%, transparent);
  --yt-spec-static-overlay-background-medium: color-mix(in srgb, var(--ma-bg) 72%, transparent);
  --yt-spec-static-overlay-text-primary: var(--ma-ink);
  --ytmusic-text-primary: var(--ma-ink);
  --ytmusic-text-secondary: var(--ma-ink-dim);
  --ytmusic-general-background-a: var(--ma-bg);
  --ytmusic-general-background-b: var(--ma-bg);
  --ytmusic-brand-background-solid: var(--ma-surface);
  --ytmusic-player-bar-background: var(--ma-surface);
  --ytmusic-nav-bar-background: var(--ma-surface);

  /* seek bar */
  --paper-slider-active-color: var(--ma-accent);
  --paper-slider-knob-color: var(--ma-accent);
  --paper-slider-knob-start-color: var(--ma-accent);
  --paper-slider-pin-color: var(--ma-accent);
  --paper-slider-secondary-color: var(--ma-accent-2);
  --paper-slider-container-color: var(--ma-line);
}

html,
body,
body.transparent-background-color,
body.transparent-player {
  background-color: var(--ma-bg) !important;
  color: var(--ma-ink);
}

ytmusic-app,
ytmusic-app-layout,
#content,
#main-panel,
ytmusic-browse-response,
ytmusic-player-page,
ytmusic-section-list-renderer {
  background-color: var(--ma-bg) !important;
}

ytmusic-player-bar,
ytmusic-nav-bar,
#nav-bar-background {
  background-color: var(--ma-surface) !important;
}
`;
}
