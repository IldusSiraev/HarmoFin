import { describe, expect, it, vi } from 'vitest';

import { RegularPlanApplicationService } from './regular-plan.application.service.js';

const ownerId = '00000000-0000-4000-8000-000000000001';
const budgetId = '00000000-0000-4000-8000-000000000002';
const planId = '00000000-0000-4000-8000-000000000003';
const occurrenceId = '00000000-0000-4000-8000-000000000004';

function createRepository() {
  const plan = {
    id: planId,
    budgetId,
    workspaceId: '00000000-0000-4000-8000-000000000005',
    name: 'Расход',
    planType: 'EXPENSE' as const,
    amountMinor: 1_000n,
    currency: 'RUB',
    scale: 2,
    anchorOn: new Date('2026-09-10T00:00:00.000Z'),
    startOn: new Date('2026-09-10T00:00:00.000Z'),
    endOn: null,
    recurrence: 'MONTHLY' as const,
    intervalMonths: null,
    accountId: null,
    categoryId: '00000000-0000-4000-8000-000000000006',
    envelopeId: '00000000-0000-4000-8000-000000000007',
    comment: null,
    isActive: true,
    disabledAt: null,
    deletedAt: null,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
  };
  return {
    findAccessibleWithRole: vi.fn().mockResolvedValue({
      id: budgetId,
      workspaceId: plan.workspaceId,
      timezone: 'Europe/Moscow',
      workspace: { memberships: [{ role: 'OWNER' }] },
    }),
    runTransaction: vi.fn(async (write: (tx: object) => Promise<unknown>) => write({})),
    findPlanForMutation: vi.fn().mockResolvedValue(plan),
    updatePlan: vi.fn().mockImplementation(async (_tx, current, data) => ({ ...current, ...data })),
    cancelFuturePendingOccurrences: vi.fn().mockResolvedValue([]),
    findActiveReferences: vi.fn().mockResolvedValue({
      account: null,
      category: { id: plan.categoryId, categoryType: 'EXPENSE' },
      envelope: {
        id: plan.envelopeId,
        envelopeType: 'MANDATORY_EXPENSES',
        currency: 'RUB',
        scale: 2,
      },
    }),
    findOccurrenceForMutation: vi.fn().mockResolvedValue({
      id: occurrenceId,
      budgetId,
      planType: 'SAVINGS',
      status: 'DUE',
      transactionId: null,
    }),
  };
}

function createIdempotency() {
  return {
    execute: vi.fn(
      async (
        _tx: object,
        _input: object,
        write: () => Promise<{ status: number; body: Record<string, unknown> }>,
      ) => write(),
    ),
  };
}

describe('RegularPlanApplicationService', () => {
  it('cancels only future pending occurrences when plan changes', async () => {
    const repository = createRepository();
    const service = new RegularPlanApplicationService(
      repository as never,
      {} as never,
      createIdempotency() as never,
      () => new Date('2026-09-10T12:00:00.000Z'),
    );

    await service.update(ownerId, budgetId, planId, { amount: '15.00' }, 'plan-update-key');

    expect(repository.cancelFuturePendingOccurrences).toHaveBeenCalledWith(
      expect.anything(),
      ownerId,
      budgetId,
      planId,
      new Date('2026-09-10T00:00:00.000Z'),
      'PLAN_CHANGED',
      undefined,
    );
  });

  it('rejects creating a transaction draft for savings occurrence', async () => {
    const repository = createRepository();
    const service = new RegularPlanApplicationService(
      repository as never,
      {} as never,
      createIdempotency() as never,
      () => new Date('2026-09-10T12:00:00.000Z'),
    );

    await expect(
      service.createDraftFromOccurrence(ownerId, budgetId, occurrenceId, 'plan-draft-key'),
    ).rejects.toMatchObject({ response: { code: 'PLAN_TYPE_NOT_TRANSACTIONAL' } });
  });
});
