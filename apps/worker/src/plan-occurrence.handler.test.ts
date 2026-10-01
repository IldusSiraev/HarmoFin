import { describe, expect, it, vi } from 'vitest';

import { PlanOccurrenceHandler } from './plan-occurrence.handler.js';

type Row = { scheduledOn: Date; status?: string; planId: string };

function setup(options: {
  budget: { planModelVersion: number; planModelActivatedOn: Date | null };
  plans: Array<Record<string, unknown>>;
  existing?: Row[];
}) {
  const created: Row[] = [];
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    regularPlan: { findMany: vi.fn().mockResolvedValue(options.plans) },
    planOccurrence: {
      findMany: vi
        .fn()
        .mockImplementation((args: { where: { status?: string } }) =>
          Promise.resolve(args.where.status === 'PENDING' ? [] : (options.existing ?? [])),
        ),
      updateMany: vi.fn(),
      createMany: vi.fn().mockImplementation((args: { data: Row | Row[] }) => {
        const rows = Array.isArray(args.data) ? args.data : [args.data];
        created.push(...rows);
        return Promise.resolve({ count: rows.length });
      }),
    },
    auditEvent: { create: vi.fn().mockResolvedValue({}) },
  };
  const prisma = {
    budget: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'b1',
          workspaceId: 'w1',
          timezone: 'UTC',
          ...options.budget,
        },
      ]),
    },
    $transaction: vi.fn().mockImplementation((cb: (t: typeof tx) => unknown) => cb(tx)),
  };
  return { handler: new PlanOccurrenceHandler(prisma as never), tx, prisma, created };
}

const iso = (value: Date) => value.toISOString().slice(0, 10);
const d = (value: string) => new Date(`${value}T00:00:00.000Z`);

const plan = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  name: 'Аренда',
  planType: 'EXPENSE',
  amountMinor: 4_000_000n,
  currency: 'RUB',
  scale: 2,
  anchorOn: d('2026-07-15'),
  startOn: d('2026-07-01'),
  endOn: null,
  recurrence: 'MONTHLY',
  intervalMonths: null,
  accountId: null,
  categoryId: null,
  envelopeId: 'e1',
  comment: null,
  ...over,
});

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
      select: {
        id: true,
        workspaceId: true,
        timezone: true,
        planModelVersion: true,
        planModelActivatedOn: true,
      },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('keeps the v1 window today-7..today+60 for model 1 budgets', async () => {
    const { handler, tx, created } = setup({
      budget: { planModelVersion: 1, planModelActivatedOn: null },
      plans: [plan({ anchorOn: d('2026-05-15'), startOn: d('2026-05-01') })],
    });

    await handler.execute(new Date('2026-10-01T12:00:00.000Z'));

    expect(created.map((row) => iso(row.scheduledOn))).toEqual(['2026-10-15', '2026-11-15']);
    expect(tx.regularPlan.findMany.mock.calls[0]?.[0].where.planType).toBeUndefined();
  });

  it('after long downtime creates missing past-due v2 occurrences from activation, none before cutover', async () => {
    const { handler, tx, created } = setup({
      budget: { planModelVersion: 2, planModelActivatedOn: d('2026-08-01') },
      plans: [plan()],
    });

    await handler.execute(new Date('2026-10-20T12:00:00.000Z'));

    expect(created.map((row) => iso(row.scheduledOn))).toEqual([
      '2026-08-15',
      '2026-09-15',
      '2026-10-15',
      '2026-11-15',
      '2026-12-15',
    ]);
    // today = 2026-10-20: past-due rows are DUE at creation, future rows stay PENDING.
    expect(created.map((row) => row.status ?? 'PENDING')).toEqual([
      'DUE',
      'DUE',
      'DUE',
      'PENDING',
      'PENDING',
    ]);
    expect(tx.regularPlan.findMany.mock.calls[0]?.[0].where).toMatchObject({
      budgetId: 'b1',
      planType: 'EXPENSE',
      envelope: { is: expect.objectContaining({ envelopeType: 'MANDATORY_EXPENSES' }) },
    });
  });

  it('does not duplicate or overwrite occurrences that already exist', async () => {
    const { handler, tx, created } = setup({
      budget: { planModelVersion: 2, planModelActivatedOn: d('2026-08-01') },
      plans: [plan()],
      existing: [
        { planId: 'p1', scheduledOn: d('2026-08-15'), status: 'COMPLETED' },
        { planId: 'p1', scheduledOn: d('2026-09-15'), status: 'SKIPPED' },
      ],
    });

    await handler.execute(new Date('2026-10-20T12:00:00.000Z'));

    expect(created.map((row) => iso(row.scheduledOn))).toEqual([
      '2026-10-15',
      '2026-11-15',
      '2026-12-15',
    ]);
    expect(tx.planOccurrence.updateMany).not.toHaveBeenCalled();
    expect(tx.planOccurrence.findMany.mock.calls.some(([a]) => a.where.budgetId === 'b1')).toBe(
      true,
    );
  });
});
