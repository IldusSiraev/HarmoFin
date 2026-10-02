import { describe, expect, it } from 'vitest';

import { ApiRequestError } from './useApiClient.js';
import { v2ErrorMessage } from './useV2Error.js';

function problem(status: number, code: string) {
  return new ApiRequestError(status, { code, detail: 'technical' });
}

describe('v2ErrorMessage cycle codes', () => {
  it.each([
    [409, 'CYCLE_CHANGE_PENDING', 'ещё не вступила в силу'],
    [422, 'CYCLE_SETTINGS_UNCHANGED', 'уже действуют'],
    [409, 'PREVIEW_STALE', 'Обновите последствия'],
    [409, 'TIMEZONE_CHANGE_REQUIRES_RECONCILIATION', 'Часовой пояс нельзя менять'],
  ])('maps %i %s to Russian text', (status, code, text) => {
    expect(v2ErrorMessage(problem(status, code), 'fallback')).toContain(text);
  });
});
