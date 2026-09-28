import { EnvelopeType } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { RolePolicy } from '../common/policies/role-policy.js';
import { EnvelopeApplicationService } from './envelope.application.service.js';
import type { EnvelopeRecord, EnvelopeRepository } from './envelope.repository.js';
import type { CreateEnvelopeInput } from './envelope.schemas.js';

describe('EnvelopeApplicationService', () => {
  const ownerId = '00000000-0000-4000-8000-000000000001';
  const budgetId = '00000000-0000-4000-8000-000000000002';

  it('rejects negative monthly planned amount', async () => {
    const repository = repositoryDouble();
    const service = createService(repository);
    repository.findAccessibleWithRole.mockResolvedValue(ownerBudget());

    await expect(
      service.create(ownerId, budgetId, envelopeInput({ monthlyPlannedAmount: '-1.00' })),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'VALIDATION_FAILED' }) });
  });

  it('rejects negative target amount', async () => {
    const repository = repositoryDouble();
    const service = createService(repository);
    repository.findAccessibleWithRole.mockResolvedValue(ownerBudget());

    await expect(
      service.create(ownerId, budgetId, envelopeInput({ targetAmount: '-1.00' })),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'VALIDATION_FAILED' }) });
  });

  it('rejects target date without target amount', async () => {
    const repository = repositoryDouble();
    const service = createService(repository);
    repository.findAccessibleWithRole.mockResolvedValue(ownerBudget());

    await expect(
      service.create(ownerId, budgetId, envelopeInput({ targetDate: '2027-01-01' })),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'VALIDATION_FAILED' }) });
  });

  it('maps current balance from server projection without losing precision', () => {
    const service = createService(repositoryDouble());

    expect(
      service.toView(
        envelope({
          startingBalanceMinor: -9_007_199_254_740_993n,
          currentBalanceMinor: -9_007_199_254_740_994n,
        }),
      ),
    ).toMatchObject({
      startingBalanceMinor: '-9007199254740993',
      currentBalanceMinor: '-9007199254740994',
    });
  });

  it('exposes configured period slot', () => {
    const service = createService(repositoryDouble());
    const record = { ...envelope(), periodSlot: 'FIRST' } as EnvelopeRecord & {
      periodSlot: 'FIRST';
    };

    expect((service.toView(record) as { periodSlot?: string }).periodSlot).toBe('FIRST');
  });

  it('groups envelope balances by type in domain order and skips empty types', async () => {
    const repository = repositoryDouble();
    const service = createService(repository);
    repository.findAccessibleWithRole.mockResolvedValue(ownerBudget());
    repository.list.mockResolvedValue([
      envelope({ envelopeType: 'SAVINGS_GOAL', currentBalanceMinor: 500000n }),
      envelope({ envelopeType: 'CURRENT_EXPENSES', currentBalanceMinor: 210000n }),
      envelope({ envelopeType: 'CURRENT_EXPENSES', currentBalanceMinor: 100000n }),
    ]);

    await expect(service.summary(ownerId, budgetId, 'active')).resolves.toEqual({
      currency: 'RUB',
      scale: 2,
      totalMinor: '810000',
      count: 3,
      byType: [
        { envelopeType: 'CURRENT_EXPENSES', totalMinor: '310000', count: 2 },
        { envelopeType: 'SAVINGS_GOAL', totalMinor: '500000', count: 1 },
      ],
    });
  });

  it('reports zero and an empty breakdown for a budget without envelopes', async () => {
    const repository = repositoryDouble();
    const service = createService(repository);
    repository.findAccessibleWithRole.mockResolvedValue(ownerBudget());
    repository.list.mockResolvedValue([]);

    await expect(service.summary(ownerId, budgetId, 'archived')).resolves.toEqual({
      currency: 'RUB',
      scale: 2,
      totalMinor: '0',
      count: 0,
      byType: [],
    });
  });

  it('hides the summary of a budget the user cannot reach', async () => {
    const repository = repositoryDouble();
    const service = createService(repository);
    repository.findAccessibleWithRole.mockResolvedValue(null);

    await expect(service.summary(ownerId, budgetId, 'active')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'RESOURCE_NOT_FOUND' }),
    });
    expect(repository.list).not.toHaveBeenCalled();
  });

  it('maps the balance summary and reallocation rows to decimal-safe strings', async () => {
    const repository = repositoryDouble();
    const service = createService(repository);
    repository.balanceSummary.mockResolvedValue({
      envelope: { ...envelope() },
      terms: {
        startingBalanceMinor: 10_000n,
        incomeAllocatedMinor: 5_000n,
        expensesMinor: 1_500n,
        envelopeTransfersNetMinor: -700n,
        reallocationsNetMinor: 5_000n,
      },
      reallocations: [
        {
          reallocationId: '00000000-0000-4000-8000-000000000005',
          direction: 'IN' as const,
          otherEnvelopeId: '00000000-0000-4000-8000-000000000006',
          otherEnvelopeName: 'Первая половина',
          amountMinor: 5_000n,
          occurredOn: '2026-09-01',
          comment: null,
        },
      ],
    });

    const summary = await service.balanceSummary(ownerId, budgetId, envelope().id);

    expect(summary).toMatchObject({
      currency: 'RUB',
      scale: 2,
      startingBalanceMinor: '10000',
      incomeAllocatedMinor: '5000',
      expensesMinor: '1500',
      envelopeTransfersNetMinor: '-700',
      reallocationsNetMinor: '5000',
      currentBalanceMinor: '17800',
      reallocations: [
        expect.objectContaining({
          reallocationId: '00000000-0000-4000-8000-000000000005',
          direction: 'IN',
          otherEnvelopeName: 'Первая половина',
          amountMinor: '5000',
          occurredOn: '2026-09-01',
        }),
      ],
    });
    expect(summary.envelope.currentBalanceMinor).toBe('17800');
  });

  it('hides the balance summary of a budget the user cannot reach', async () => {
    const repository = repositoryDouble();
    const service = createService(repository);
    repository.balanceSummary.mockResolvedValue(null);

    await expect(
      service.balanceSummary(ownerId, budgetId, '00000000-0000-4000-8000-000000000007'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'RESOURCE_NOT_FOUND' }),
    });
  });

  function createService(repository: ReturnType<typeof repositoryDouble>) {
    return new EnvelopeApplicationService(
      repository as unknown as EnvelopeRepository,
      new RolePolicy(),
    );
  }

  function repositoryDouble() {
    return {
      findAccessibleWithRole: vi.fn(),
      list: vi.fn(),
      balanceSummary: vi.fn(),
    };
  }

  function ownerBudget(overrides: Partial<{ allowNegativeBalance: boolean }> = {}) {
    return {
      id: budgetId,
      workspaceId: '00000000-0000-4000-8000-000000000003',
      allowNegativeBalance: false,
      workspace: { memberships: [{ role: 'OWNER' }] },
      ...overrides,
    };
  }

  function envelopeInput(overrides: Partial<CreateEnvelopeInput> = {}): CreateEnvelopeInput {
    return {
      name: 'Резерв',
      envelopeType: 'RESERVE',
      currency: 'RUB',
      startingBalance: '0.00',
      displayOrder: 0,
      ...overrides,
    };
  }

  function envelope(overrides: Partial<EnvelopeRecord> = {}): EnvelopeRecord {
    return {
      id: '00000000-0000-4000-8000-000000000004',
      budgetId,
      templateKey: null,
      name: 'Резерв',
      envelopeType: EnvelopeType.RESERVE,
      currency: 'RUB',
      scale: 2,
      startingBalanceMinor: 0n,
      monthlyPlannedAmountMinor: null,
      targetAmountMinor: null,
      targetDate: null,
      periodSlot: null,
      displayOrder: 0,
      comment: 'Не попадёт в аудит',
      archivedAt: null,
      currentBalanceMinor: 0n,
      ...overrides,
    };
  }
});
