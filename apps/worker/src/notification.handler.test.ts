import { describe, expect, it, vi } from 'vitest';

import { NotificationRuleHandler } from './notification.handler.js';

const budgetSelect = {
  id: true,
  workspaceId: true,
  timezone: true,
  workspace: {
    select: {
      memberships: {
        where: { isActive: true, role: { in: ['OWNER', 'EDITOR'] } },
        select: { userId: true },
      },
    },
  },
};

function budget() {
  return {
    id: 'budget-1',
    workspaceId: 'workspace-1',
    timezone: 'UTC',
    workspace: { memberships: [{ userId: 'owner-1' }] },
  };
}

function makeTx(overrides: Record<string, unknown> = {}) {
  return {
    $queryRaw: vi.fn().mockResolvedValue([]),
    planOccurrence: {
      findMany: vi.fn().mockResolvedValue([]),
      aggregate: vi.fn().mockResolvedValue({ _sum: { amountMinor: 0n } }),
    },
    notification: {
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    account: { findMany: vi.fn().mockResolvedValue([]) },
    envelope: { findMany: vi.fn().mockResolvedValue([]) },
    auditEvent: { create: vi.fn().mockResolvedValue({}) },
    ...overrides,
  };
}

function makePrisma(budgets: unknown[], tx: ReturnType<typeof makeTx>) {
  return {
    budget: { findMany: vi.fn().mockResolvedValue(budgets) },
    $transaction: vi.fn(async (callback: (client: unknown) => unknown) => callback(tx)),
  };
}

const now = new Date('2026-09-10T12:00:00.000Z');

function occurrence(id: string, scheduledOn: string, amount: bigint, paid: bigint[] = [], ownerId = 'owner-1') {
  return {
    id,
    planName: 'Аренда',
    planType: 'EXPENSE',
    scheduledOn: new Date(`${scheduledOn}T00:00:00.000Z`),
    amountMinor: amount,
    plan: { ownerUserId: ownerId },
    payments: paid.map((value) => ({ transaction: { amountMinor: value } })),
  };
}

describe('NotificationRuleHandler', () => {
  it('does not evaluate notifications when no active budgets exist', async () => {
    const prisma = {
      budget: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn(),
    };
    const handler = new NotificationRuleHandler(prisma as never);

    await handler.execute(now);

    expect(prisma.budget.findMany).toHaveBeenCalledWith({
      where: { status: 'ACTIVE', planModelVersion: 2, workspace: { status: 'ACTIVE' } },
      select: budgetSelect,
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('never runs balance SQL or old state rules', async () => {
    const tx = makeTx();
    tx.planOccurrence.findMany.mockResolvedValue([occurrence('occ-today', '2026-09-10', 100n)]);
    await new NotificationRuleHandler(makePrisma([budget()], tx) as never).execute(now);

    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.account.findMany).not.toHaveBeenCalled();
    expect(tx.envelope.findMany).not.toHaveBeenCalled();
    expect(tx.planOccurrence.aggregate).not.toHaveBeenCalled();
    const created = tx.notification.createMany.mock.calls.map(
      ([args]) => (args as { data: { notificationType: string } }).data.notificationType,
    );
    expect(created).toEqual(['PLAN_TODAY']);
    expect(created).not.toContain('INSUFFICIENT_MANDATORY_OBLIGATIONS');
  });

  it('creates exactly one overdue notification per occurrence and relies on the key for reruns', async () => {
    const tx = makeTx();
    tx.planOccurrence.findMany.mockResolvedValue([occurrence('occ-late', '2026-09-09', 100n)]);
    const handler = new NotificationRuleHandler(makePrisma([budget()], tx) as never);
    await handler.execute(now);
    tx.notification.createMany.mockResolvedValue({ count: 0 });
    await handler.execute(now);

    const calls = tx.notification.createMany.mock.calls.map(
      ([args]) => args as { data: { notificationKey: string }; skipDuplicates: boolean },
    );
    expect(calls).toHaveLength(2);
    expect(new Set(calls.map((call) => call.data.notificationKey))).toEqual(
      new Set(['occurrence:occ-late:PLAN_OVERDUE']),
    );
    expect(calls.every((call) => call.skipDuplicates)).toBe(true);
    // the audit event is written only for the insert that actually created a row
    expect(tx.auditEvent.create).toHaveBeenCalledTimes(1);
  });

  it('creates due and overdue notifications once per occurrence with a stable key', async () => {
    const tx = makeTx();
    tx.planOccurrence.findMany.mockResolvedValue([
      occurrence('occ-today', '2026-09-10', 100n),
      occurrence('occ-late', '2026-09-09', 100n),
    ]);
    await new NotificationRuleHandler(makePrisma([budget()], tx) as never).execute(now);

    expect(tx.planOccurrence.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          budgetId: 'budget-1',
          status: { in: ['PENDING', 'DUE'] },
        }),
      }),
    );
    const data = tx.notification.createMany.mock.calls.map(
      ([args]) => (args as { data: Record<string, unknown>; skipDuplicates: boolean }).data,
    );
    expect(data.map((item) => item.notificationKey)).toEqual([
      'occurrence:occ-today:PLAN_TODAY',
      'occurrence:occ-late:PLAN_OVERDUE',
    ]);
    expect(data.map((item) => item.actionPath)).toEqual([
      '/app/plans?occurrence=occ-today',
      '/app/plans?occurrence=occ-late',
    ]);
    expect(JSON.stringify(data)).not.toMatch(/\b100\b/);
  });

  it('skips fully paid occurrences and uses the remainder for partial payments', async () => {
    const tx = makeTx();
    tx.planOccurrence.findMany.mockResolvedValue([
      occurrence('occ-paid', '2026-09-09', 100n, [60n, 40n]),
      occurrence('occ-partial', '2026-09-09', 100n, [60n]),
    ]);
    await new NotificationRuleHandler(makePrisma([budget()], tx) as never).execute(now);

    const keys = tx.notification.createMany.mock.calls.map(
      ([args]) => (args as { data: { notificationKey: string } }).data.notificationKey,
    );
    expect(keys).toEqual(['occurrence:occ-partial:PLAN_OVERDUE']);
  });

  it('resolves notifications of occurrences that are no longer open or whose period passed', async () => {
    const tx = makeTx();
    tx.planOccurrence.findMany.mockResolvedValue([occurrence('occ-late', '2026-09-09', 100n)]);
    tx.notification.findMany
      .mockResolvedValueOnce([
        {
          id: 'n-done',
          userId: 'owner-1',
          notificationType: 'PLAN_OVERDUE',
          occurrenceId: 'occ-done',
          actionPath: 'x',
        },
        {
          id: 'n-stale',
          userId: 'owner-1',
          notificationType: 'PLAN_TODAY',
          occurrenceId: 'occ-late',
          actionPath: 'x',
        },
        {
          id: 'n-keep',
          userId: 'owner-1',
          notificationType: 'PLAN_OVERDUE',
          occurrenceId: 'occ-late',
          actionPath: 'x',
        },
      ])
      .mockResolvedValueOnce([]);
    await new NotificationRuleHandler(makePrisma([budget()], tx) as never).execute(now);

    const resolvedIds = tx.notification.updateMany.mock.calls.map(
      ([args]) => (args as { where: { id: string } }).where.id,
    );
    expect(resolvedIds.sort()).toEqual(['n-done', 'n-stale']);
  });

  it('resolves open notifications of ex-recipients (demoted or deactivated) with an audit event, leaving current recipients untouched', async () => {
    const tx = makeTx();
    const multiMember = {
      id: 'budget-1',
      workspaceId: 'workspace-1',
      timezone: 'UTC',
      workspace: { memberships: [{ userId: 'owner-1' }, { userId: 'editor-1' }] },
    };
    tx.planOccurrence.findMany.mockResolvedValue([occurrence('occ-late', '2026-09-09', 100n)]);
    tx.notification.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: 'n-ex-viewer',
        userId: 'viewer-1',
        notificationType: 'PLAN_OVERDUE',
        occurrenceId: 'occ-late',
        actionPath: '/app/plans?occurrence=occ-late',
      },
    ]);

    await new NotificationRuleHandler(makePrisma([multiMember], tx) as never).execute(now);

    // The occurrence belongs to owner-1, so only the plan owner is notified, not every writer.
    const createdFor = tx.notification.createMany.mock.calls.map(
      ([args]) => (args as { data: { userId: string } }).data.userId,
    );
    expect(createdFor).toEqual(['owner-1']);

    expect(tx.notification.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: { notIn: ['owner-1', 'editor-1'] },
        }),
      }),
    );
    expect(tx.notification.updateMany).toHaveBeenCalledWith({
      where: { id: 'n-ex-viewer', budgetId: 'budget-1', resolvedAt: null },
      data: { resolvedAt: expect.any(Date) },
    });
    const auditPayloads = tx.auditEvent.create.mock.calls.map(
      ([args]) => (args as { data: Record<string, unknown> }).data,
    );
    expect(
      auditPayloads.some(
        (data) =>
          data.entityId === 'n-ex-viewer' &&
          (data.newValues as { state: string }).state === 'RESOLVED',
      ),
    ).toBe(true);
  });

  it('does not create a notification when the plan owner is not an active writer', async () => {
    const tx = makeTx();
    tx.planOccurrence.findMany.mockResolvedValue([
      occurrence('occ-late', '2026-09-09', 100n, [], 'ex-member-1'),
    ]);
    await new NotificationRuleHandler(makePrisma([budget()], tx) as never).execute(now);

    expect(tx.notification.createMany).not.toHaveBeenCalled();
    expect(tx.auditEvent.create).not.toHaveBeenCalled();
  });

  it('resolves open plan notifications of a writer who does not own the plan', async () => {
    const tx = makeTx();
    const multiMember = {
      id: 'budget-1',
      workspaceId: 'workspace-1',
      timezone: 'UTC',
      workspace: { memberships: [{ userId: 'owner-1' }, { userId: 'editor-1' }] },
    };
    tx.planOccurrence.findMany.mockResolvedValue([occurrence('occ-late', '2026-09-09', 100n)]);
    tx.notification.findMany
      .mockResolvedValueOnce([
        {
          id: 'n-non-owner',
          userId: 'editor-1',
          notificationType: 'PLAN_OVERDUE',
          occurrenceId: 'occ-late',
          actionPath: '/app/plans?occurrence=occ-late',
        },
      ])
      .mockResolvedValueOnce([]);

    await new NotificationRuleHandler(makePrisma([multiMember], tx) as never).execute(now);

    expect(tx.notification.updateMany).toHaveBeenCalledWith({
      where: { id: 'n-non-owner', budgetId: 'budget-1', resolvedAt: null },
      data: { resolvedAt: expect.any(Date) },
    });
  });
});
