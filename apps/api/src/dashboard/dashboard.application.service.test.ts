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
        unassignedStartingBalanceMinor: 0n,
        periodEnvelope: {
          id: 'envelope-id',
          openingMinor: 10_000n,
          allocatedMinor: 500n,
          reallocatedMinor: 0n,
          spentMinor: 2_500n,
        },
        previousPeriodLeftover: null,
        warnings: [],
        upcomingObligations: [],
        onboarding: {
          categoriesSeeded: false,
          hasAccounts: false,
          hasEnvelopeStartingBalances: false,
          hasAllocatedIncome: false,
        },
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

  it('serializes server-projected upcoming obligations', async () => {
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
        unassignedStartingBalanceMinor: 0n,
        periodEnvelope: null,
        previousPeriodLeftover: null,
        warnings: [],
        upcomingObligations: [
          {
            occurrenceId: '00000000-0000-4000-8000-000000000003',
            planName: 'Ипотека',
            scheduledOn: new Date('2026-09-10T00:00:00.000Z'),
            amountMinor: 3_600_000n,
            currency: 'RUB',
            scale: 2,
            status: 'DUE' as const,
            envelopeId: '00000000-0000-4000-8000-000000000004',
          },
        ],
        onboarding: {
          categoriesSeeded: false,
          hasAccounts: false,
          hasEnvelopeStartingBalances: false,
          hasAllocatedIncome: false,
        },
      }),
    };
    const service = new DashboardApplicationService(repository as never);

    await expect(service.summary(userId, budgetId, '2026-09-10')).resolves.toMatchObject({
      upcomingObligations: [
        {
          occurrenceId: '00000000-0000-4000-8000-000000000003',
          scheduledOn: '2026-09-10',
          amountMinor: '3600000',
          status: 'DUE',
          actionPath: '/app/plans?occurrence=00000000-0000-4000-8000-000000000003',
        },
      ],
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
        unassignedStartingBalanceMinor: 0n,
        periodEnvelope: null,
        previousPeriodLeftover: null,
        warnings: [],
        upcomingObligations: [],
        onboarding: {
          categoriesSeeded: false,
          hasAccounts: false,
          hasEnvelopeStartingBalances: false,
          hasAllocatedIncome: false,
        },
      }),
    };
    const service = new DashboardApplicationService(repository as never);

    await expect(service.summary(userId, budgetId, '2026-08-12')).resolves.toMatchObject({
      periodLimit: { state: 'unavailable' },
    });
  });

  it('serializes a negative unassigned starting balance as a signed string', async () => {
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
        unassignedStartingBalanceMinor: -3_000n,
        periodEnvelope: null,
        previousPeriodLeftover: null,
        warnings: [],
        upcomingObligations: [],
        onboarding: {
          categoriesSeeded: false,
          hasAccounts: false,
          hasEnvelopeStartingBalances: false,
          hasAllocatedIncome: false,
        },
      }),
    };
    const service = new DashboardApplicationService(repository as never);

    await expect(service.summary(userId, budgetId, '2026-08-12')).resolves.toMatchObject({
      unassignedStartingBalanceMinor: '-3000',
    });
  });

  it('reports onboarding progress from server-derived signals', async () => {
    const repository = {
      findAccessible: vi.fn().mockResolvedValue({
        id: budgetId,
        cycleStartDay: 1,
        periodBoundaryOffset: 15,
        timezone: 'Europe/Moscow',
      }),
      summary: vi.fn().mockResolvedValue({
        totalAccountMoneyMinor: 0n,
        accounts: [],
        envelopes: [],
        unallocatedIncomeMinor: 0n,
        unassignedStartingBalanceMinor: 0n,
        periodEnvelope: null,
        previousPeriodLeftover: null,
        warnings: [],
        upcomingObligations: [],
        onboarding: {
          categoriesSeeded: true,
          hasAccounts: true,
          hasEnvelopeStartingBalances: false,
          hasAllocatedIncome: false,
        },
      }),
    };
    const service = new DashboardApplicationService(repository as never);

    await expect(service.summary(userId, budgetId, '2026-08-12')).resolves.toMatchObject({
      onboarding: {
        categoriesSeeded: true,
        cycleConfigured: false,
        hasAccounts: true,
        hasEnvelopeStartingBalances: false,
        hasAllocatedIncome: false,
      },
    });
  });

  it('treats a cycle changed away from the calendar-month default as configured', async () => {
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
        unassignedStartingBalanceMinor: 0n,
        periodEnvelope: null,
        previousPeriodLeftover: null,
        warnings: [],
        upcomingObligations: [],
        onboarding: {
          categoriesSeeded: false,
          hasAccounts: false,
          hasEnvelopeStartingBalances: false,
          hasAllocatedIncome: false,
        },
      }),
    };
    const service = new DashboardApplicationService(repository as never);

    await expect(service.summary(userId, budgetId, '2026-08-12')).resolves.toMatchObject({
      onboarding: { cycleConfigured: true },
    });
  });

  it('surfaces a previous-period leftover that is worth moving', async () => {
    const repository = {
      findAccessible: vi.fn().mockResolvedValue({
        id: budgetId,
        cycleStartDay: 10,
        periodBoundaryOffset: 15,
        timezone: 'Europe/Moscow',
        allowNegativeBalance: false,
      }),
      summary: vi.fn().mockResolvedValue({
        totalAccountMoneyMinor: 0n,
        accounts: [],
        envelopes: [],
        unallocatedIncomeMinor: 0n,
        unassignedStartingBalanceMinor: 0n,
        periodEnvelope: null,
        previousPeriodLeftover: {
          envelopeId: 'previous-envelope-id',
          envelopeName: 'Текущие 10–24',
          balanceMinor: 3_500_00n,
          currentPeriodEnvelopeId: 'current-envelope-id',
          currentPeriodEnvelopeName: 'Текущие 25–9',
        },
        warnings: [],
        upcomingObligations: [],
        onboarding: {
          categoriesSeeded: false,
          hasAccounts: false,
          hasEnvelopeStartingBalances: false,
          hasAllocatedIncome: false,
        },
      }),
    };
    const service = new DashboardApplicationService(repository as never);

    await expect(service.summary(userId, budgetId, '2026-08-25')).resolves.toMatchObject({
      previousPeriodLeftover: {
        envelopeId: 'previous-envelope-id',
        envelopeName: 'Текущие 10–24',
        balanceMinor: '350000',
        currentPeriodEnvelopeId: 'current-envelope-id',
        currentPeriodEnvelopeName: 'Текущие 25–9',
      },
    });
  });

  it('hides a negative previous-period leftover unless the budget allows negative balances', async () => {
    const repositoryFor = (allowNegativeBalance: boolean) => ({
      findAccessible: vi.fn().mockResolvedValue({
        id: budgetId,
        cycleStartDay: 10,
        periodBoundaryOffset: 15,
        timezone: 'Europe/Moscow',
        allowNegativeBalance,
      }),
      summary: vi.fn().mockResolvedValue({
        totalAccountMoneyMinor: 0n,
        accounts: [],
        envelopes: [],
        unallocatedIncomeMinor: 0n,
        unassignedStartingBalanceMinor: 0n,
        periodEnvelope: null,
        previousPeriodLeftover: {
          envelopeId: 'previous-envelope-id',
          envelopeName: 'Текущие 10–24',
          balanceMinor: -1_000n,
          currentPeriodEnvelopeId: 'current-envelope-id',
          currentPeriodEnvelopeName: 'Текущие 25–9',
        },
        warnings: [],
        upcomingObligations: [],
        onboarding: {
          categoriesSeeded: false,
          hasAccounts: false,
          hasEnvelopeStartingBalances: false,
          hasAllocatedIncome: false,
        },
      }),
    });

    const hidden = new DashboardApplicationService(repositoryFor(false) as never);
    await expect(hidden.summary(userId, budgetId, '2026-08-25')).resolves.toMatchObject({
      previousPeriodLeftover: null,
    });

    const shown = new DashboardApplicationService(repositoryFor(true) as never);
    await expect(shown.summary(userId, budgetId, '2026-08-25')).resolves.toMatchObject({
      previousPeriodLeftover: { balanceMinor: '-1000' },
    });
  });
});
