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

  // Real bot checks surface as LOGIN_REQUIRED with a bot-guard reason, so they
  // must be classified before the generic UNPLAYABLE/login branch.
  if (/sign in to confirm|not a bot|po.?token|botguard/i.test(message)) {
    return 'PO_TOKEN';
  }

  if (/UNPLAYABLE|LOGIN_REQUIRED/i.test(message)) return 'UNPLAYABLE';

  const code = asRecord(error)?.code;
  const haystack = `${typeof code === 'string' ? code : ''} ${message}`;

  if (/\b(ENOSPC|EACCES|EPERM|EROFS)\b/i.test(haystack)) return 'WRITE';

  return 'NETWORK';
};
