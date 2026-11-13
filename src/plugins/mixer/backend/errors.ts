import type { MixerErrorCode } from '../types';

const asRecord = (error: unknown): Record<string, unknown> | undefined =>
  typeof error === 'object' && error !== null
    ? (error as Record<string, unknown>)
    : undefined;

const messageOf = (error: unknown): string => {
  if (error instanceof Error) return error.message;

  const message = asRecord(error)?.message;

  return typeof message === 'string' ? message : String(error);
};

export const toCacheErrorCode = (error: unknown): MixerErrorCode => {
  const message = messageOf(error);

  if (/UNPLAYABLE|LOGIN_REQUIRED/i.test(message)) return 'UNPLAYABLE';

  const code = asRecord(error)?.code;
  const haystack = `${typeof code === 'string' ? code : ''} ${message}`;

  if (/\b(ENOSPC|EACCES|EPERM|EROFS)\b/i.test(haystack)) return 'WRITE';
  if (/po.?token|botguard/i.test(message)) return 'PO_TOKEN';

  return 'NETWORK';
};
