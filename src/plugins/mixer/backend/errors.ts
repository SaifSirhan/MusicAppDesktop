import type { MixerErrorCode } from '../types';

export const toCacheErrorCode = (error: unknown): MixerErrorCode => {
  const message = error instanceof Error ? error.message : String(error);

  if (/UNPLAYABLE|LOGIN_REQUIRED/i.test(message)) return 'UNPLAYABLE';
  if (/\b(ENOSPC|EACCES|EPERM|EROFS)\b/.test(message)) return 'WRITE';
  if (/po.?token|botguard|challenge/i.test(message)) return 'PO_TOKEN';

  return 'NETWORK';
};
