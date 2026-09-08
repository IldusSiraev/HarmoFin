import { describe, expect, it, vi } from 'vitest';

import { ReportApplicationService } from './report.application.service.js';

describe('ReportApplicationService', () => {
  const userId = '00000000-0000-4000-8000-000000000001';
  const budgetId = '00000000-0000-4000-8000-000000000002';

  it('calculates net cash flow from confirmed income and expense rows only', async () => {
    const repository = {
      findAccessible: vi.fn().mockResolvedValue({
        id: budgetId,
        cycleStartDay: 10,
        periodBoundaryOffset: 15,
        timezone: 'Europe/Moscow',
      }),
      validateReferences: vi.fn().mockResolvedValue(true),
      transactions: vi.fn().mockResolvedValue([
        {
          id: 'income-id',
          transactionType: 'INCOME',
          amountMinor: 10_000n,
          occurredOn: new Date('2026-08-10T00:00:00.000Z'),
          accountId: 'account-id',
          categoryId: 'income-category-id',
          envelopeId: null,
          category: { name: 'Зарплата' },
        },
        {
          id: 'expense-id',
          transactionType: 'EXPENSE',
          amountMinor: 2_500n,
          occurredOn: new Date('2026-08-11T00:00:00.000Z'),
          accountId: 'account-id',
          categoryId: 'expense-category-id',
          envelopeId: 'envelope-id',
          category: { name: 'Продукты' },
        },
      ]),
      transferParts: vi.fn().mockResolvedValue([]),
      accountBalances: vi.fn().mockResolvedValue([]),
      envelopeBalances: vi.fn().mockResolvedValue([]),
      savingsGoals: vi.fn().mockResolvedValue([]),
    };
    const service = new ReportApplicationService(repository as never);

    await expect(
      service.get(userId, budgetId, 'net-cash-flow', { from: '2026-08-10', to: '2026-09-09' }),
    ).resolves.toMatchObject({
      key: 'net-cash-flow',
      rows: [
        expect.objectContaining({
          incomeMinor: '10000',
          expenseMinor: '2500',
          netCashFlowMinor: '7500',
        }),
      ],
    });
  });
});
