import { describe, expect, it, vi } from 'vitest';

import { EnvelopeReallocationApplicationService } from './envelope-reallocation.application.service.js';
import type { CreateEnvelopeReallocationInput } from './envelope-reallocation.schemas.js';

const ownerId = '00000000-0000-4000-8000-000000000001';
const viewerId = '00000000-0000-4000-8000-000000000002';
const budgetId = '00000000-0000-4000-8000-000000000003';
const recordId = '00000000-0000-4000-8000-000000000004';
const sourceEnvelopeId = '00000000-0000-4000-8000-000000000005';
const destinationEnvelopeId = '00000000-0000-4000-8000-000000000006';

describe('EnvelopeReallocationApplicationService', () => {
  it('creates a confirmed reallocation with canonical minor units', async () => {
    const repository = repositoryDouble();
    repository.findAccessibleWithRole.mockResolvedValue(accessibleBudget(false));
    repository.findActiveReferences.mockResolvedValue(activeReferences());
    repository.create.mockResolvedValue(record());
    const service = createService(repository);

    await expect(
      service.create(ownerId, budgetId, reallocationInput(), 'create-key'),
    ).resolves.toMatchObject({ status: 'CONFIRMED', amountMinor: '3500' });
    expect(repository.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ amountMinor: 3_500n, sourceEnvelopeId, destinationEnvelopeId }),
      ownerId,
      undefined,
    );
  });

  it('rejects identical source and destination envelopes', async () => {
    const repository = repositoryDouble();
    repository.findAccessibleWithRole.mockResolvedValue(accessibleBudget(false));

    const service = createService(repository);

    await expect(
      service.create(
        ownerId,
        budgetId,
        reallocationInput({ destinationEnvelopeId: sourceEnvelopeId }),
        'same-envelope-key',
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'ENVELOPE_REALLOCATION_ENVELOPES_MUST_DIFFER' }),
    });
  });

  it('rejects archived or foreign envelope references', async () => {
    const repository = repositoryDouble();
    repository.findAccessibleWithRole.mockResolvedValue(accessibleBudget(false));
    repository.findActiveReferences.mockResolvedValue({
      ...activeReferences(),
      destinationEnvelope: null,
    });
    const service = createService(repository);

    await expect(
      service.create(ownerId, budgetId, reallocationInput(), 'foreign-reference-key'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'REFERENCE_INVALID' }),
    });
  });

  it('blocks a reallocation that exceeds source envelope capacity', async () => {
    const repository = repositoryDouble();
    repository.findAccessibleWithRole.mockResolvedValue(accessibleBudget(false));
    repository.findActiveReferences.mockResolvedValue(activeReferences());
    repository.assertReallocationCapacity.mockResolvedValue(false);
    const service = createService(repository);

    await expect(
      service.create(ownerId, budgetId, reallocationInput(), 'capacity-key'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'INSUFFICIENT_BALANCE' }),
    });
  });

  it('allows a negative source envelope when the budget allows negative balances', async () => {
    const repository = repositoryDouble();
    repository.findAccessibleWithRole.mockResolvedValue(accessibleBudget(true));
    repository.findActiveReferences.mockResolvedValue(activeReferences());
    repository.create.mockResolvedValue(record());
    const service = createService(repository);

    await expect(
      service.create(ownerId, budgetId, reallocationInput(), 'allow-negative-key'),
    ).resolves.toMatchObject({ status: 'CONFIRMED' });
    expect(repository.assertReallocationCapacity).not.toHaveBeenCalled();
  });

  it('rejects viewer financial mutations', async () => {
    const repository = repositoryDouble();
    repository.findAccessibleWithRole.mockResolvedValue({
      id: budgetId,
      allowNegativeBalance: false,
      workspace: { memberships: [{ role: 'VIEWER' }] },
    });
    const service = createService(repository);

    await expect(
      service.create(viewerId, budgetId, reallocationInput(), 'viewer-key'),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'FORBIDDEN' }) });
  });

  it('deletes a confirmed reallocation and blocks a second delete', async () => {
    const repository = repositoryDouble();
    repository.findAccessibleWithRole.mockResolvedValue(accessibleBudget(false));
    repository.findForMutation.mockResolvedValueOnce(record());
    repository.markDeleted.mockResolvedValueOnce(record({ status: 'DELETED' }));
    repository.findForMutation.mockResolvedValueOnce(record({ status: 'DELETED' }));
    const service = createService(repository);

    await expect(service.delete(ownerId, budgetId, recordId, 'delete-key')).resolves.toMatchObject({
      status: 'DELETED',
    });
    await expect(
      service.delete(ownerId, budgetId, recordId, 'delete-again-key'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'ENVELOPE_REALLOCATION_STATE_INVALID' }),
    });
  });

  function createService(repository: ReturnType<typeof repositoryDouble>) {
    return new EnvelopeReallocationApplicationService(
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
      findActiveReferences: vi.fn(),
      assertReallocationCapacity: vi.fn().mockResolvedValue(true),
      create: vi.fn(),
      findForMutation: vi.fn(),
      markDeleted: vi.fn(),
      list: vi.fn(),
      find: vi.fn(),
    };
  }

  function accessibleBudget(allowNegativeBalance: boolean) {
    return {
      id: budgetId,
      allowNegativeBalance,
      workspace: { memberships: [{ role: 'OWNER' }] },
    };
  }

  function activeReferences() {
    return {
      sourceEnvelope: {
        id: sourceEnvelopeId,
        budgetId,
        archivedAt: null,
        currency: 'RUB',
        scale: 2,
      },
      destinationEnvelope: {
        id: destinationEnvelopeId,
        budgetId,
        archivedAt: null,
        currency: 'RUB',
        scale: 2,
      },
    };
  }

  function reallocationInput(
    overrides: Partial<CreateEnvelopeReallocationInput> = {},
  ): CreateEnvelopeReallocationInput {
    return {
      sourceEnvelopeId,
      destinationEnvelopeId,
      amount: '35.00',
      occurredOn: '2026-09-26',
      ...overrides,
    };
  }

  function record(overrides: Record<string, unknown> = {}) {
    return {
      id: recordId,
      budgetId,
      status: 'CONFIRMED',
      sourceEnvelopeId,
      destinationEnvelopeId,
      amountMinor: 3_500n,
      currency: 'RUB',
      scale: 2,
      occurredOn: new Date('2026-09-26T00:00:00.000Z'),
      comment: null,
      deletedAt: null,
      createdAt: new Date('2026-09-26T00:00:00.000Z'),
      sourceEnvelopeCurrentBalanceMinor: 0n,
      destinationEnvelopeCurrentBalanceMinor: 0n,
      ...overrides,
    };
  }
});
