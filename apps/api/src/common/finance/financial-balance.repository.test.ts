import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { FinancialBalanceRepository } from './financial-balance.repository.js';

describe('FinancialBalanceRepository', () => {
  const budgetId = '00000000-0000-4000-8000-000000000001';
  const accountId = '00000000-0000-4000-8000-000000000002';
  const envelopeId = '00000000-0000-4000-8000-000000000003';

  it('includes only confirmed rows in account and envelope balances', async () => {
    const queryRaw = vi
      .fn()
      .mockResolvedValueOnce([{ balanceMinor: 12_500n }])
      .mockResolvedValueOnce([{ balanceMinor: 3_000n }]);
    const balances = new FinancialBalanceRepository();
    const tx = { $queryRaw: queryRaw } as unknown as Prisma.TransactionClient;

    expect(await balances.accountBalance(tx, budgetId, accountId)).toBe(12_500n);
    expect(await balances.envelopeBalance(tx, budgetId, envelopeId)).toBe(3_000n);

    const accountSql = sqlText(queryRaw.mock.calls[0]?.[0]);
    const envelopeSql = sqlText(queryRaw.mock.calls[1]?.[0]);
    expect(accountSql).toContain('"transaction_type" = \'INCOME\'');
    expect(accountSql).toContain('"transaction_type" = \'EXPENSE\'');
    expect(accountSql).toContain('"transfer_parts"');
    expect(accountSql).toContain('"source_account_id"');
    expect(accountSql).toContain('"destination_account_id"');
    expect(accountSql).toContain('"status" = \'CONFIRMED\'');
    expect(accountSql).toContain('::uuid');
    expect(envelopeSql).toContain('"income_allocations"');
    expect(envelopeSql).toContain('"transfer_parts"');
    expect(envelopeSql).toContain('"envelope_reallocations"');
    expect(envelopeSql).toContain('"source_envelope_id"');
    expect(envelopeSql).toContain('"destination_envelope_id"');
    expect(envelopeSql).toContain('"status" = \'CONFIRMED\'');
    expect(envelopeSql).toContain('::uuid');
  });

  it('returns zero when no scoped balance source exists', async () => {
    const balances = new FinancialBalanceRepository();
    const tx = { $queryRaw: vi.fn().mockResolvedValue([]) } as unknown as Prisma.TransactionClient;

    await expect(balances.accountBalance(tx, budgetId, accountId)).resolves.toBe(0n);
    await expect(balances.envelopeBalance(tx, budgetId, envelopeId)).resolves.toBe(0n);
  });

  function sqlText(value: unknown): string {
    return Array.isArray(value) ? (value as unknown as TemplateStringsArray).raw.join('?') : '';
  }
});
