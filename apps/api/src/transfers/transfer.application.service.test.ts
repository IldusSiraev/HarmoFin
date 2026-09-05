import { describe, expect, it, vi } from 'vitest';

import { TransferApplicationService } from './transfer.application.service.js';
import type { CreateTransferInput } from './transfer.schemas.js';

const ownerId = '00000000-0000-4000-8000-000000000001';
const editorId = '00000000-0000-4000-8000-000000000002';
const viewerId = '00000000-0000-4000-8000-000000000003';
const budgetId = '00000000-0000-4000-8000-000000000004';
const transferId = '00000000-0000-4000-8000-000000000005';
const sourceAccountId = '00000000-0000-4000-8000-000000000006';
const destinationAccountId = '00000000-0000-4000-8000-000000000007';
const sourceEnvelopeId = '00000000-0000-4000-8000-000000000008';
const destinationEnvelopeId = '00000000-0000-4000-8000-000000000009';

describe('TransferApplicationService', () => {
  it('creates a confirmed multipart transfer with canonical minor units', async () => {
    const repository = repositoryDouble();
    repository.findAccessibleWithRole.mockResolvedValue(accessibleBudget('OWNER'));
    repository.findActiveReferences.mockResolvedValue(activeReferences());
    repository.create.mockResolvedValue(transfer({ status: 'CONFIRMED' }));
    const service = createService(repository);

    await expect(
      service.create(ownerId, budgetId, transferInput(), 'create-key'),
    ).resolves.toMatchObject({
      status: 'CONFIRMED',
      totalMinor: '3000',
    });
    expect(repository.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: 'CONFIRMED',
        totalMinor: 3_000n,
        parts: [
          expect.objectContaining({ amountMinor: 2_000n, destinationEnvelopeId: sourceEnvelopeId }),
          expect.objectContaining({ amountMinor: 1_000n, destinationEnvelopeId }),
        ],
      }),
      ownerId,
      undefined,
    );
  });

  it('rejects a total that differs from its positive parts', async () => {
    const repository = repositoryDouble();
    repository.findAccessibleWithRole.mockResolvedValue(accessibleBudget('OWNER'));
    const service = createService(repository);

    await expect(
      service.create(ownerId, budgetId, transferInput({ total: '30.01' }), 'mismatch-key'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'TRANSFER_PARTS_TOTAL_MISMATCH' }),
    });
  });

  it('rejects identical accounts and inactive or foreign references', async () => {
    const repository = repositoryDouble();
    repository.findAccessibleWithRole.mockResolvedValue(accessibleBudget('OWNER'));
    const service = createService(repository);

    await expect(
      service.create(
        ownerId,
        budgetId,
        transferInput({ destinationAccountId: sourceAccountId }),
        'same-account-key',
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'TRANSFER_ACCOUNTS_MUST_DIFFER' }),
    });

    repository.findActiveReferences.mockResolvedValue({
      ...activeReferences(),
      destinationAccount: null,
    });
    await expect(
      service.create(ownerId, budgetId, transferInput(), 'foreign-reference-key'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'REFERENCE_INVALID' }),
    });
  });

  it('blocks confirmed transfers that exceed source account or envelope capacity', async () => {
    const repository = repositoryDouble();
    repository.findAccessibleWithRole.mockResolvedValue(accessibleBudget('OWNER'));
    repository.findActiveReferences.mockResolvedValue(activeReferences());
    repository.assertConfirmedTransferCapacity.mockResolvedValue(false);
    const service = createService(repository);

    await expect(
      service.create(ownerId, budgetId, transferInput(), 'capacity-key'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'INSUFFICIENT_BALANCE' }),
    });
  });

  it('allows editor and rejects viewer financial mutations', async () => {
    const repository = repositoryDouble();
    repository.findAccessibleWithRole.mockResolvedValue(accessibleBudget('EDITOR'));
    repository.findActiveReferences.mockResolvedValue(activeReferences());
    repository.create.mockResolvedValue(transfer());
    const service = createService(repository);

    await expect(
      service.create(editorId, budgetId, transferInput({ status: 'DRAFT' }), 'editor-key'),
    ).resolves.toMatchObject({
      status: 'DRAFT',
    });

    repository.findAccessibleWithRole.mockResolvedValue(accessibleBudget('VIEWER'));
    await expect(
      service.create(viewerId, budgetId, transferInput({ status: 'DRAFT' }), 'viewer-key'),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'FORBIDDEN' }) });
  });

  it('revalidates active references before confirming a draft transfer', async () => {
    const repository = repositoryDouble();
    repository.findAccessibleWithRole.mockResolvedValue(accessibleBudget('OWNER'));
    repository.findForMutation.mockResolvedValue(transfer({ status: 'DRAFT' }));
    repository.findActiveReferences.mockResolvedValue({
      ...activeReferences(),
      sourceAccount: null,
    });
    const service = createService(repository);

    await expect(
      service.confirm(ownerId, budgetId, transferId, 'confirm-key'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'REFERENCE_INVALID' }),
    });
    expect(repository.updateLifecycle).not.toHaveBeenCalled();
  });

  it('confirms drafts, cancels drafts, deletes non-deleted transfers and blocks terminal transitions', async () => {
    const repository = repositoryDouble();
    repository.findAccessibleWithRole.mockResolvedValue(accessibleBudget('OWNER'));
    repository.findActiveReferences.mockResolvedValue(activeReferences());
    repository.findForMutation.mockResolvedValueOnce(transfer({ status: 'DRAFT' }));
    repository.assertConfirmedTransferCapacity.mockResolvedValue(true);
    repository.updateLifecycle.mockResolvedValueOnce(transfer({ status: 'CONFIRMED' }));
    repository.findForMutation.mockResolvedValueOnce(transfer({ status: 'DRAFT' }));
    repository.updateLifecycle.mockResolvedValueOnce(transfer({ status: 'CANCELLED' }));
    repository.findForMutation.mockResolvedValueOnce(transfer({ status: 'CONFIRMED' }));
    repository.updateLifecycle.mockResolvedValueOnce(transfer({ status: 'DELETED' }));
    repository.findForMutation.mockResolvedValueOnce(transfer({ status: 'DELETED' }));
    const service = createService(repository);

    await expect(
      service.confirm(ownerId, budgetId, transferId, 'confirm-key'),
    ).resolves.toMatchObject({
      status: 'CONFIRMED',
    });
    await expect(
      service.cancel(ownerId, budgetId, transferId, 'cancel-key'),
    ).resolves.toMatchObject({
      status: 'CANCELLED',
    });
    await expect(
      service.delete(ownerId, budgetId, transferId, 'delete-key'),
    ).resolves.toMatchObject({
      status: 'DELETED',
    });
    await expect(
      service.confirm(ownerId, budgetId, transferId, 'deleted-key'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'TRANSFER_STATE_INVALID' }),
    });
  });

  function createService(repository: ReturnType<typeof repositoryDouble>) {
    return new TransferApplicationService(
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
      assertConfirmedTransferCapacity: vi.fn().mockResolvedValue(true),
      create: vi.fn(),
      findForMutation: vi.fn(),
      updateLifecycle: vi.fn(),
    };
  }

  function accessibleBudget(role: 'OWNER' | 'EDITOR' | 'VIEWER') {
    return { id: budgetId, allowNegativeBalance: false, workspace: { memberships: [{ role }] } };
  }

  function activeReferences() {
    return {
      sourceAccount: { id: sourceAccountId, budgetId, archivedAt: null, currency: 'RUB', scale: 2 },
      destinationAccount: {
        id: destinationAccountId,
        budgetId,
        archivedAt: null,
        currency: 'RUB',
        scale: 2,
      },
      envelopes: [
        { id: sourceEnvelopeId, budgetId, archivedAt: null, currency: 'RUB', scale: 2 },
        { id: destinationEnvelopeId, budgetId, archivedAt: null, currency: 'RUB', scale: 2 },
      ],
    };
  }

  function transferInput(overrides: Partial<CreateTransferInput> = {}): CreateTransferInput {
    return {
      status: 'CONFIRMED',
      total: '30.00',
      occurredOn: '2026-09-05',
      sourceAccountId,
      destinationAccountId,
      parts: [
        { sourceEnvelopeId, amount: '20.00' },
        { sourceEnvelopeId, destinationEnvelopeId, amount: '10.00' },
      ],
      ...overrides,
    };
  }

  function transfer(overrides: Record<string, unknown> = {}) {
    return {
      id: transferId,
      budgetId,
      status: 'DRAFT',
      totalMinor: 3_000n,
      currency: 'RUB',
      scale: 2,
      occurredOn: new Date('2026-09-05T00:00:00.000Z'),
      comment: null,
      confirmedAt: null,
      cancelledAt: null,
      deletedAt: null,
      createdAt: new Date('2026-09-05T00:00:00.000Z'),
      parts: [
        {
          id: '00000000-0000-4000-8000-000000000010',
          transferId,
          budgetId,
          sourceAccountId,
          destinationAccountId,
          sourceEnvelopeId,
          destinationEnvelopeId: sourceEnvelopeId,
          amountMinor: 3_000n,
          comment: null,
          sourceAccountCurrentBalanceMinor: 0n,
          destinationAccountCurrentBalanceMinor: 0n,
          sourceEnvelopeCurrentBalanceMinor: 0n,
          destinationEnvelopeCurrentBalanceMinor: 0n,
        },
      ],
      ...overrides,
    };
  }
});
