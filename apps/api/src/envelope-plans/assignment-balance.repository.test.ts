import type { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { AssignmentBalanceRepository } from './assignment-balance.repository.js';

const budgetId = '11111111-1111-4111-8111-111111111111';
const envelopeId = '22222222-2222-4222-8222-222222222222';
const periodId = '33333333-3333-4333-8333-333333333333';

function serializeSqlValue(value: unknown): string {
  const fragment = value as { strings?: unknown; values?: unknown } | null;
  if (fragment && Array.isArray(fragment.strings)) {
    const parts = Array.isArray(fragment.values)
      ? fragment.values.map(serializeSqlValue)
      : [];
    return fragment.strings
      .map((chunk: string, index: number) => chunk + (parts[index] ?? ''))
      .join('');
  }
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function makeMockTx(resultRows: unknown[]) {
  const captured: string[] = [];
  const budgetFindUnique = vi.fn();
  const periodFindUnique = vi.fn();
  const queryRaw = vi.fn((...args: unknown[]) => {
    const first = args[0] as string[] | { strings: string[] };
    const strings = Array.isArray(first) ? first : first.strings;
    captured.push(`${strings.join(' ')} ${args.slice(1).map(serializeSqlValue).join(' ')}`);
    return Promise.resolve(resultRows);
  });
  const tx = {
    budget: { findUnique: budgetFindUnique },
    envelopePeriod: { findUnique: periodFindUnique },
    $queryRaw: queryRaw,
  } as unknown as Prisma.TransactionClient;
  return { tx, queryRaw, budgetFindUnique, periodFindUnique, captured };
}

describe('AssignmentBalanceRepository', () => {
  it('counters only confirmed v2 facts in budget scoped subqueries and parses bigint', async () => {
    const mock = makeMockTx([{ funded: '6500000', spent: '2000000' }]);
    mock.budgetFindUnique.mockResolvedValue({ timezone: 'UTC' });
    const repository = new AssignmentBalanceRepository();

    const result = await repository.balance(
      mock.tx,
      budgetId,
      envelopeId,
      null,
      new Date('2026-10-20T00:00:00Z'),
    );

    expect(result).toEqual({ funded: 6_500_000n, spent: 2_000_000n, balance: 4_500_000n });
    expect(typeof result.funded).toBe('bigint');

    const sql = mock.captured.join('\n');
    expect(mock.budgetFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: budgetId } }),
    );
    expect(mock.periodFindUnique).not.toHaveBeenCalled();
    expect((sql.match(/"budget_id" = /g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(sql).toContain('"envelope_assignments"');
    expect(sql).toContain('"envelope_movements"');
    expect(sql).toContain('"transactions"');
    expect(sql).toContain("'CONFIRMED'");
    expect(sql).toContain('"accounting_model_version" = 2');
    expect(sql).toContain('"deleted_at" IS NULL');
    expect(sql).toContain('"period_id" IS NULL');
  });

  it('filters assignments, movements and expenses by the concrete period window', async () => {
    const mock = makeMockTx([{ funded: '6500000', spent: '2000000' }]);
    mock.budgetFindUnique.mockResolvedValue({ timezone: 'UTC' });
    mock.periodFindUnique.mockResolvedValue({
      envelopeId,
      startsOn: new Date('2026-10-01T00:00:00Z'),
      endsOn: new Date('2026-10-31T00:00:00Z'),
    });
    const repository = new AssignmentBalanceRepository();

    await repository.balance(
      mock.tx,
      budgetId,
      envelopeId,
      periodId,
      new Date('2026-10-20T00:00:00Z'),
    );

    expect(mock.periodFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: periodId, budgetId } }),
    );
    const sql = mock.captured.join('\n');
    expect(sql).toContain('"period_id"');
    expect(sql).toContain('"destination_period_id"');
    expect(sql).toContain('"source_period_id"');
    expect(sql).toContain('BETWEEN');
  });

  it('rejects a period that does not belong to the budget and envelope', async () => {
    const noPeriod = makeMockTx([]);
    noPeriod.budgetFindUnique.mockResolvedValue({ timezone: 'UTC' });
    noPeriod.periodFindUnique.mockResolvedValue(null);
    const wrongEnvelope = makeMockTx([]);
    wrongEnvelope.budgetFindUnique.mockResolvedValue({ timezone: 'UTC' });
    wrongEnvelope.periodFindUnique.mockResolvedValue({
      envelopeId: '99999999-9999-4999-8999-999999999999',
      startsOn: new Date('2026-10-01T00:00:00Z'),
      endsOn: new Date('2026-10-31T00:00:00Z'),
    });

    const repository = new AssignmentBalanceRepository();
    await expect(
      repository.balance(noPeriod.tx, budgetId, envelopeId, periodId, new Date('2026-10-20T00:00:00Z')),
    ).rejects.toThrow();
    await expect(
      repository.balance(
        wrongEnvelope.tx,
        budgetId,
        envelopeId,
        periodId,
        new Date('2026-10-20T00:00:00Z'),
      ),
    ).rejects.toThrow();
    expect(noPeriod.queryRaw).not.toHaveBeenCalled();
    expect(wrongEnvelope.queryRaw).not.toHaveBeenCalled();
  });

  it('projects every budget envelope or period row in one query with bigints', async () => {
    const mock = makeMockTx([
      { envelope_id: envelopeId, period_id: null, funded: '3000000', spent: '1000000' },
      { envelope_id: envelopeId, period_id: periodId, funded: '1000000', spent: '400000' },
    ]);
    mock.budgetFindUnique.mockResolvedValue({ timezone: 'UTC' });
    const repository = new AssignmentBalanceRepository();

    const result = await repository.allBalances(
      mock.tx,
      budgetId,
      new Date('2026-11-10T00:00:00Z'),
    );

    expect(result).toEqual([
      {
        envelopeId,
        periodId: null,
        funded: 3_000_000n,
        spent: 1_000_000n,
        balance: 2_000_000n,
      },
      {
        envelopeId,
        periodId,
        funded: 1_000_000n,
        spent: 400_000n,
        balance: 600_000n,
      },
    ]);
    const sql = mock.captured.join('\n');
    expect(sql).toContain('UNION');
    expect(sql).toContain('"period_id" IS NOT DISTINCT FROM');
    expect(sql).toContain('"budget_id" = ');
    expect(mock.queryRaw).toHaveBeenCalledTimes(1);
  });
});
