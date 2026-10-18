import { describe, expect, it, vi } from 'vitest';

vi.mock('./account-purge.js', () => ({ purgeUserData: vi.fn().mockResolvedValue(undefined) }));

import { purgeUserData } from './account-purge.js';
import { AccountPurgeHandler } from './account-purge.handler.js';

const NOW = new Date('2026-11-18T00:00:00.000Z');

function setup(locked: Array<{ userId: string }>) {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue(locked),
    accountDeletion: { update: vi.fn().mockResolvedValue({}) },
  };
  const prisma = {
    accountDeletion: { findMany: vi.fn().mockResolvedValue([{ id: 'd1' }, { id: 'd2' }]) },
    $transaction: vi.fn((callback: (t: typeof tx) => unknown) => callback(tx)),
  };
  return { handler: new AccountPurgeHandler(prisma as never), prisma, tx };
}

describe('AccountPurgeHandler', () => {
  it('selects only due, open requests and purges each in its own transaction', async () => {
    const { handler, prisma, tx } = setup([{ userId: 'u1' }]);

    await handler.execute(NOW);

    expect(prisma.accountDeletion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { purgeAfter: { lte: NOW }, restoredAt: null, purgedAt: null },
      }),
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(purgeUserData).toHaveBeenCalledWith(tx, 'u1');
    expect(tx.accountDeletion.update).toHaveBeenCalledWith({ where: { id: 'd1' }, data: { purgedAt: NOW } });
  });

  it('skips a request that was restored or purged after selection', async () => {
    vi.mocked(purgeUserData).mockClear();
    const { handler, tx } = setup([]);

    await expect(handler.purgeOne('d1', NOW)).resolves.toBe(false);
    expect(purgeUserData).not.toHaveBeenCalled();
    expect(tx.accountDeletion.update).not.toHaveBeenCalled();
  });
});
