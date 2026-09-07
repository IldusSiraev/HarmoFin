import { describe, expect, it, vi } from 'vitest';

import { DashboardApplicationService } from './dashboard.application.service.js';

describe('DashboardApplicationService', () => {
  const userId = '00000000-0000-4000-8000-000000000001';
  const budgetId = '00000000-0000-4000-8000-000000000002';

  it('returns server computed period limit and balance projections', async () => {
    const repository = {
      findAccessible: vi.fn().mockResolvedValue({
        id: budgetId,
        cycleStartDay: 10,
        periodBoundaryOffset: 15,
        timezone: 'Europe/Moscow',
      }),
      summary: vi.fn().mockResolvedValue({
        totalAccountMoneyMinor: 100_000n,
        accounts: [{ id: 'account-id', name: 'Наличные', balanceMinor: 100_000n }],
        envelopes: [{ id: 'envelope-id', name: 'Текущие 10–24', balanceMinor: 8_000n }],
        unallocatedIncomeMinor: 0n,
        periodEnvelope: {
          id: 'envelope-id',
          openingMinor: 10_000n,
          allocatedMinor: 500n,
          reallocatedMinor: 0n,
          spentMinor: 2_500n,
        },
        warnings: [],
      }),
    };
    const service = new DashboardApplicationService(repository as never);

    await expect(service.summary(userId, budgetId, '2026-08-12')).resolves.toMatchObject({
      totalAccountMoneyMinor: '100000',
      periodLimit: {
        state: 'available',
        envelopeId: 'envelope-id',
        limitMinor: '10500',
        spentMinor: '2500',
        remainingMinor: '8000',
        daysUntilBoundary: 13,
        averageRemainingDailyLimitMinor: '615',
      },
    });
  });

  it('does not invent a period limit when configured slot is missing', async () => {
    const repository = {
      findAccessible: vi.fn().mockResolvedValue({
        id: budgetId,
        cycleStartDay: 10,
        periodBoundaryOffset: 15,
        timezone: 'Europe/Moscow',
      }),
      summary: vi.fn().mockResolvedValue({
        totalAccountMoneyMinor: 0n,
        accounts: [],
        envelopes: [],
        unallocatedIncomeMinor: 0n,
        periodEnvelope: null,
        warnings: [],
      }),
    };
    const service = new DashboardApplicationService(repository as never);

    await expect(service.summary(userId, budgetId, '2026-08-12')).resolves.toMatchObject({
      periodLimit: { state: 'unavailable' },
    });
  });
});
