import type { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { legacyEnvelopeBalance } from './legacy-envelope-balance.js';

describe('legacyEnvelopeBalance (migration-only)', () => {
  const budgetId = '00000000-0000-4000-8000-000000000001';
  const envelopeId = '00000000-0000-4000-8000-000000000003';

  it('sums only confirmed v1 sources and scopes by budget', async () => {
    const queryRaw = vi.fn().mockResolvedValueOnce([{ balanceMinor: 3_000n }]);
    const tx = { $queryRaw: queryRaw } as unknown as Prisma.TransactionClient;
    expect(await legacyEnvelopeBalance(tx, budgetId, envelopeId)).toBe(3_000n);
    const sql = (queryRaw.mock.calls[0]?.[0] as unknown as TemplateStringsArray).raw.join('?');
    for (const part of [
      '"income_allocations"',
      '"transfer_parts"',
      '"envelope_reallocations"',
      '"source_envelope_id"',
      '"destination_envelope_id"',
      '"status" = \'CONFIRMED\'',
      '"budget_id" = ',
      '::uuid',
    ]) {
      expect(sql).toContain(part);
    }
  });

  it('returns zero when no scoped source exists', async () => {
    const tx = { $queryRaw: vi.fn().mockResolvedValue([]) } as unknown as Prisma.TransactionClient;
    await expect(legacyEnvelopeBalance(tx, budgetId, envelopeId)).resolves.toBe(0n);
  });
});
