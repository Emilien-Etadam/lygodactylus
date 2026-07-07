import { describe, expect, it } from 'vitest';
import { isLikelyAuthFailure } from '../../main/config/api-diagnostics';

describe('api diagnostics auth failure detection', () => {
  it('detects likely credential failures from status and message', () => {
    expect(isLikelyAuthFailure({ status: 401, message: 'unauthorized' })).toBe(true);
    expect(isLikelyAuthFailure({ status: 403, message: 'forbidden' })).toBe(true);

    const invalidKey = {
      status: 400,
      message: 'API key not valid. Please pass a valid API key.',
    };
    expect(isLikelyAuthFailure(invalidKey)).toBe(true);
  });

  it('does not flag generic network errors as auth failures', () => {
    expect(isLikelyAuthFailure({ message: 'fetch failed' })).toBe(false);
  });
});
