import { describe, expect, it } from 'vitest';

import { toCacheErrorCode } from '../../src/plugins/mixer/backend/errors';

describe('toCacheErrorCode', () => {
  it('maps unplayable and login-required errors', () => {
    expect(toCacheErrorCode(new Error('[UNPLAYABLE] nope'))).toBe('UNPLAYABLE');
    expect(toCacheErrorCode(new Error('[LOGIN_REQUIRED] sign in'))).toBe(
      'UNPLAYABLE',
    );
    expect(
      toCacheErrorCode(new Error('[LOGIN_REQUIRED] Music Premium members only')),
    ).toBe('UNPLAYABLE');
  });

  it('maps the bot check to PO_TOKEN', () => {
    expect(
      toCacheErrorCode(
        new Error("[LOGIN_REQUIRED] Sign in to confirm you're not a bot"),
      ),
    ).toBe('PO_TOKEN');
  });

  it('maps filesystem write errors', () => {
    expect(toCacheErrorCode(new Error('EACCES: permission denied'))).toBe(
      'WRITE',
    );
    expect(toCacheErrorCode(new Error('ENOSPC: no space left'))).toBe('WRITE');
    expect(
      toCacheErrorCode({ code: 'EACCES', message: 'permission denied' }),
    ).toBe('WRITE');
  });

  it('maps token/botguard failures', () => {
    expect(toCacheErrorCode(new Error('BotGuard challenge failed'))).toBe(
      'PO_TOKEN',
    );
    expect(toCacheErrorCode(new Error('po_token missing'))).toBe('PO_TOKEN');
  });

  it('falls back to network on anything else', () => {
    expect(toCacheErrorCode(new Error('fetch failed'))).toBe('NETWORK');
    expect(toCacheErrorCode(new Error('HTTP 403: challenge page'))).toBe(
      'NETWORK',
    );
    expect(toCacheErrorCode('boom')).toBe('NETWORK');
  });
});
