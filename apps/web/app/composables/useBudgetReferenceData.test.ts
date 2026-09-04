import { describe, expect, it, vi } from 'vitest';

import { ApiRequestError } from './useApiClient.js';
import { createBudgetReferenceData } from './useBudgetReferenceData.js';
import { createReferenceDataForm } from './useReferenceDataForm.js';

const account = {
  id: 'account-id',
  budgetId: 'budget-id',
  name: 'Основной счёт',
  accountType: 'BANK_ACCOUNT' as const,
  bankName: null,
  lastFourDigits: null,
  currency: 'RUB' as const,
  scale: 2 as const,
  startingBalanceMinor: '12345',
  currentBalanceMinor: '12345',
  accountingStartDate: '2026-09-03',
  comment: null,
  archivedAt: null,
};

describe('useBudgetReferenceData', () => {
  it('sends account decimal string unchanged to API client', async () => {
    const request = vi.fn().mockResolvedValue(account);
    const data = createBudgetReferenceData({ request });

    await data.createAccount('budget-id', {
      name: 'Основной счёт',
      accountType: 'BANK_ACCOUNT',
      currency: 'RUB',
      startingBalance: '123.45',
      accountingStartDate: '2026-09-03',
    });

    expect(request).toHaveBeenCalledWith('/api/v1/budgets/budget-id/accounts', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Основной счёт',
        accountType: 'BANK_ACCOUNT',
        currency: 'RUB',
        startingBalance: '123.45',
        accountingStartDate: '2026-09-03',
      }),
    });
  });
});

describe('useReferenceDataForm', () => {
  it('normalizes Russian decimal input without parsing it', () => {
    const form = createReferenceDataForm(['startingBalance']);

    expect(form.normalizeDecimal('1 234,50')).toBe('1234.50');
  });

  it('keeps known field errors and replaces unknown API details', () => {
    const form = createReferenceDataForm(['name']);
    const known = new ApiRequestError(400, {
      code: 'VALIDATION_FAILED',
      detail: 'Серверная деталь',
      fieldErrors: [{ field: 'name', message: 'Укажите название.', code: 'too_small' }],
    });
    const unknown = new ApiRequestError(400, {
      code: 'VALIDATION_FAILED',
      detail: 'Не доверять этой детали.',
      fieldErrors: [{ field: 'other', message: 'Не доверять.', code: 'custom' }],
    });

    expect(form.errorMessage(known)).toEqual({
      summary: 'Укажите данные формы.',
      fields: { name: 'Укажите название.' },
    });
    expect(form.errorMessage(unknown)).toEqual({
      summary: 'Не удалось выполнить действие. Повторите попытку.',
      fields: {},
    });
  });
});
