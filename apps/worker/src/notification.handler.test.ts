import { describe, expect, it, vi } from 'vitest';

import { NotificationRuleHandler } from './notification.handler.js';

describe('NotificationRuleHandler', () => {
  it('does not evaluate notifications when no active budgets exist', async () => {
    const prisma = {
      budget: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn(),
    };
    const handler = new NotificationRuleHandler(prisma as never);

    await handler.execute(new Date('2026-09-10T12:00:00.000Z'));

    expect(prisma.budget.findMany).toHaveBeenCalledWith({
      where: { status: 'ACTIVE', workspace: { status: 'ACTIVE' } },
      select: {
        id: true,
        workspaceId: true,
        timezone: true,
        workspace: { select: { ownerId: true } },
      },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
