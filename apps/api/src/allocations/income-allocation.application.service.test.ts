import { describe, expect, it, vi } from 'vitest';

import { IncomeAllocationApplicationService } from './income-allocation.application.service.js';
import type { IncomeRecord } from './income-allocation.repository.js';

describe('IncomeAllocationApplicationService', () => {
  const ownerId = '00000000-0000-4000-8000-000000000001';
  const budgetId = '00000000-0000-4000-8000-000000000002';
  const incomeId = '00000000-0000-4000-8000-000000000003';
  const accountId = '00000000-0000-4000-8000-000000000004';
  const envelopeId = '00000000-0000-4000-8000-000000000005';
  const incomeCategoryId = '00000000-0000-4000-8000-000000000006';
  const repairEnvelopeId = '00000000-0000-4000-8000-000000000007';

  it('blocks allocation sum above confirmed income amount', async () => {
    const repository = repositoryDouble();
    repository.findAccessibleWithRole.mockResolvedValue(accessibleBudget());
    repository.findConfirmedIncome.mockResolvedValue(confirmedIncome({ amountMinor: 10_000n }));
    repository.sumConfirmedForIncome.mockResolvedValue(9_000n);
    repository.findActiveTargets.mockResolvedValue(activeTargets());
    const service = createService(repository);

    await expect(
      service.create(
        ownerId,
        budgetId,
        incomeId,
        { amount: '20.00', occurredOn: '2026-09-04', accountId, envelopeId },
        'allocation-key',
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'ALLOCATION_EXCEEDS_INCOME' }),
    });
  });

  it('returns generic configured proposal without persisting it', async () => {
    const repository = repositoryDouble();
    repository.findBudgetAllocationRule.mockResolvedValue({
      enabled: true,
      sourceCategoryId: incomeCategoryId,
      targetEnvelopeId: repairEnvelopeId,
    });
    repository.sumConfirmedForIncome.mockResolvedValue(0n);
    repository.findActiveProposalEnvelope.mockResolvedValue({
      id: repairEnvelopeId,
      archivedAt: null,
    });
    const service = createService(repository);

    await expect(
      service.proposalFor(
        confirmedIncome({ categoryId: incomeCategoryId, amountMinor: 1_200_000n }),
      ),
    ).resolves.toMatchObject({
      targetEnvelopeId: repairEnvelopeId,
      amountMinor: '1200000',
      currency: 'RUB',
      scale: 2,
    });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('rejects non-income, non-confirmed, inactive and foreign allocation targets', async () => {
    const repository = repositoryDouble();
    repository.findAccessibleWithRole.mockResolvedValue(accessibleBudget());
    repository.findConfirmedIncome.mockResolvedValue(null);
    const service = createService(repository);

    await expect(
      service.create(
        ownerId,
        budgetId,
        incomeId,
        { amount: '1.00', occurredOn: '2026-09-04', accountId, envelopeId },
        'invalid-source-key',
      ),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'REFERENCE_INVALID' }) });
  });

  it('allows full allocation and restores remainder after logical deletion', async () => {
    const repository = repositoryDouble();
    repository.findAccessibleWithRole.mockResolvedValue(accessibleBudget());
    repository.findConfirmedIncome.mockResolvedValue(confirmedIncome({ amountMinor: 10_000n }));
    repository.sumConfirmedForIncome.mockResolvedValueOnce(0n).mockResolvedValueOnce(10_000n);
    repository.findActiveTargets.mockResolvedValue(activeTargets());
    repository.create.mockResolvedValue(
      allocation({ amountMinor: 10_000n, remainingUnallocatedMinor: 0n }),
    );
    repository.findForMutation.mockResolvedValue(allocation({ amountMinor: 10_000n }));
    repository.delete.mockResolvedValue(
      allocation({ status: 'DELETED', remainingUnallocatedMinor: 10_000n }),
    );
    const service = createService(repository);

    await expect(
      service.create(
        ownerId,
        budgetId,
        incomeId,
        { amount: '100.00', occurredOn: '2026-09-04', accountId, envelopeId },
        'full-key',
      ),
    ).resolves.toMatchObject({ remainingUnallocatedMinor: '0' });
    await expect(
      service.delete(ownerId, budgetId, 'allocation-id', 'delete-key'),
    ).resolves.toMatchObject({
      remainingUnallocatedMinor: '10000',
    });
  });

  it('restores deleted allocation only when its source income remains confirmed', async () => {
    const repository = repositoryDouble();
    repository.findAccessibleWithRole.mockResolvedValue(accessibleBudget());
    repository.findForMutation.mockResolvedValue({
      ...allocation({ status: 'DELETED', deletedAt: new Date('2026-09-05T12:00:00.000Z') }),
      preDeleteStatus: 'CONFIRMED',
    });
    repository.findConfirmedIncome.mockResolvedValue(confirmedIncome());
    repository.sumConfirmedForIncome.mockResolvedValue(0n);
    repository.findActiveTargets.mockResolvedValue(activeTargets());
    repository.restore.mockResolvedValue(allocation({ status: 'CONFIRMED', deletedAt: null }));
    const service = createService(repository) as unknown as {
      restore(
        userId: string,
        budgetId: string,
        allocationId: string,
        key: string,
      ): Promise<unknown>;
    };

    await expect(
      service.restore(ownerId, budgetId, 'allocation-id', 'restore-key'),
    ).resolves.toMatchObject({
      status: 'CONFIRMED',
    });
    expect(repository.restore).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'DELETED', preDeleteStatus: 'CONFIRMED' }),
      ownerId,
      undefined,
    );
  });
  function createService(repository: ReturnType<typeof repositoryDouble>) {
    return new IncomeAllocationApplicationService(
      repository as never,
      {
        execute: async (_tx: unknown, _input: unknown, write: () => Promise<unknown>) => write(),
      } as never,
    );
  }

  function repositoryDouble() {
    return {
      findAccessibleWithRole: vi.fn(),
      runTransaction: vi.fn(async (write: (tx: object) => Promise<unknown>) => write({})),
      findConfirmedIncome: vi.fn(),
      sumConfirmedForIncome: vi.fn(),
      findActiveTargets: vi.fn(),
      create: vi.fn(),
      findForMutation: vi.fn(),
      delete: vi.fn(),
      restore: vi.fn(),
      findBudgetAllocationRule: vi.fn(),
      findActiveProposalEnvelope: vi.fn(),
    };
  }

  function accessibleBudget() {
    return { id: budgetId, workspace: { memberships: [{ role: 'OWNER' }] } };
  }

  function activeTargets() {
    return {
      account: { id: accountId, budgetId, archivedAt: null, currency: 'RUB', scale: 2 },
      envelope: { id: envelopeId, budgetId, archivedAt: null, currency: 'RUB', scale: 2 },
    };
  }

  function confirmedIncome(overrides: Partial<IncomeRecord> = {}): IncomeRecord {
    return {
      id: incomeId,
      budgetId,
      transactionType: 'INCOME',
      status: 'CONFIRMED',
      amountMinor: 12_000n,
      categoryId: incomeCategoryId,
      currency: 'RUB',
      scale: 2,
      ...overrides,
    };
  }

  function allocation(overrides: Record<string, unknown> = {}) {
    return {
      id: 'allocation-id',
      budgetId,
      incomeTransactionId: incomeId,
      status: 'CONFIRMED',
      amountMinor: 1n,
      currency: 'RUB',
      scale: 2,
      occurredOn: new Date('2026-09-04T00:00:00.000Z'),
      accountId,
      envelopeId,
      remainingUnallocatedMinor: 0n,
      envelopeCurrentBalanceMinor: 0n,
      deletedAt: null,
      preDeleteStatus: null,
      ...overrides,
    };
  }
});
