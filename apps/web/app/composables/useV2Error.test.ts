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

describe('v2ErrorMessage journal codes', () => {
  it.each([
    [409, 'TRANSACTION_NOT_EDITABLE', 'нельзя изменить'],
    [409, 'TRANSACTION_ALREADY_DELETED', 'уже удалена'],
    [409, 'TRANSACTION_NOT_DELETED', 'только удалённую'],
    [409, 'PERIOD_AMBIGUOUS', 'несколько периодов'],
    [404, 'RESOURCE_NOT_FOUND', 'Не найдено'],
  ])('maps %i %s to Russian text', (status, code, text) => {
    expect(v2ErrorMessage(problem(status, code), 'fallback')).toContain(text);
  });

  it('lets the caller override one code without touching the shared table', () => {
    const error = problem(409, 'SOURCE_EXHAUSTED');
    expect(v2ErrorMessage(error, 'fallback', { SOURCE_EXHAUSTED: 'свой текст' })).toBe(
      'свой текст',
    );
    expect(v2ErrorMessage(error, 'fallback')).toContain('Источник уже полностью назначен');
  });
});
