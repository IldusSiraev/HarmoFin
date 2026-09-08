import { describe, expect, it, vi } from 'vitest';

import { PlanOccurrenceHandler } from './plan-occurrence.handler.js';

describe('PlanOccurrenceHandler', () => {
  it('does not open a transaction when no active budgets exist', async () => {
    const prisma = {
      budget: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn(),
    };
    const handler = new PlanOccurrenceHandler(prisma as never);

    await handler.execute(new Date('2026-02-28T12:00:00.000Z'));

    expect(prisma.budget.findMany).toHaveBeenCalledWith({
      where: { status: 'ACTIVE', workspace: { status: 'ACTIVE' } },
      select: { id: true, workspaceId: true, timezone: true },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
