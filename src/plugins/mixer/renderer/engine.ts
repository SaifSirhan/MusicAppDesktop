export const TEMPO_MIN = 0.92;
export const TEMPO_MAX = 1.08;

export const crossfaderGains = (position: number): { a: number; b: number } => {
  const clamped = Number.isFinite(position)
    ? Math.min(1, Math.max(-1, position))
    : 0;
  const angle = ((clamped + 1) * Math.PI) / 4;

  return { a: Math.cos(angle), b: Math.sin(angle) };
};

export const clampTempo = (rate: number): number => {
  if (!Number.isFinite(rate)) return 1;

  return Math.min(TEMPO_MAX, Math.max(TEMPO_MIN, rate));
};
