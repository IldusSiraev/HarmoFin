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

  function createService(repository: ReturnType<typeof repositoryDouble>) {
    return new EnvelopeApplicationService(
      repository as unknown as EnvelopeRepository,
      new RolePolicy(),
    );
  }

  function repositoryDouble() {
    return {
      findAccessibleWithRole: vi.fn(),
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
