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
      planOccurrences: vi.fn().mockResolvedValue([]),
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

  it('returns plan/fact from non-cancelled income and expense snapshots only', async () => {
    const repository = {
      findAccessible: vi.fn().mockResolvedValue({
        id: budgetId,
        cycleStartDay: 10,
        periodBoundaryOffset: 15,
        timezone: 'Europe/Moscow',
      }),
      validateReferences: vi.fn().mockResolvedValue(true),
      transactions: vi.fn().mockResolvedValue([]),
      transferParts: vi.fn().mockResolvedValue([]),
      accountBalances: vi.fn().mockResolvedValue([]),
      envelopeBalances: vi.fn().mockResolvedValue([]),
      savingsGoals: vi.fn().mockResolvedValue([]),
      planOccurrences: vi.fn().mockResolvedValue([
        {
          planId: '00000000-0000-4000-8000-000000000010',
          planName: 'Ипотека',
          planType: 'EXPENSE',
          amountMinor: 150_000n,
          scheduledOn: new Date('2026-08-10T00:00:00.000Z'),
          status: 'COMPLETED',
          accountId: '00000000-0000-4000-8000-000000000011',
          categoryId: '00000000-0000-4000-8000-000000000012',
          envelopeId: '00000000-0000-4000-8000-000000000013',
          transaction: { status: 'CONFIRMED', amountMinor: 170_000n },
        },
        {
          planId: '00000000-0000-4000-8000-000000000010',
          planName: 'Ипотека',
          planType: 'EXPENSE',
          amountMinor: 150_000n,
          scheduledOn: new Date('2026-08-25T00:00:00.000Z'),
          status: 'SKIPPED',
          accountId: '00000000-0000-4000-8000-000000000011',
          categoryId: '00000000-0000-4000-8000-000000000012',
          envelopeId: '00000000-0000-4000-8000-000000000013',
          transaction: { status: 'DRAFT', amountMinor: 150_000n },
        },
        {
          planId: '00000000-0000-4000-8000-000000000010',
          planName: 'Ипотека',
          planType: 'EXPENSE',
          amountMinor: 300_000n,
          scheduledOn: new Date('2026-08-30T00:00:00.000Z'),
          status: 'CANCELLED',
          accountId: '00000000-0000-4000-8000-000000000011',
          categoryId: '00000000-0000-4000-8000-000000000012',
          envelopeId: '00000000-0000-4000-8000-000000000013',
          transaction: { status: 'CANCELLED', amountMinor: 300_000n },
        },
        {
          planId: '00000000-0000-4000-8000-000000000014',
          planName: 'Ремонт',
          planType: 'SAVINGS',
          amountMinor: 50_000n,
          scheduledOn: new Date('2026-08-20T00:00:00.000Z'),
          status: 'COMPLETED',
          accountId: null,
          categoryId: '00000000-0000-4000-8000-000000000015',
          envelopeId: '00000000-0000-4000-8000-000000000016',
          transaction: null,
        },
      ]),
    };
    const service = new ReportApplicationService(repository as never);

    await expect(
      service.get(userId, budgetId, 'plan-vs-actual' as never, {
        from: '2026-08-10',
        to: '2026-09-09',
      }),
    ).resolves.toEqual({
      key: 'plan-vs-actual',
      rows: [
        {
          planId: '00000000-0000-4000-8000-000000000010',
          planName: 'Ипотека',
          planType: 'EXPENSE',
          plannedMinor: '300000',
          actualMinor: '170000',
          varianceMinor: '-130000',
          plannedOccurrenceCount: 2,
          confirmedOccurrenceCount: 1,
          journalFilters: {
            planId: '00000000-0000-4000-8000-000000000010',
            status: 'CONFIRMED',
          },
        },
      ],
    });
  });
});
