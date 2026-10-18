import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./account-purge.js', () => ({ purgeUserData: vi.fn().mockResolvedValue(undefined) }));

import { purgeUserData } from './account-purge.js';
import { AccountPurgeHandler } from './account-purge.handler.js';

const NOW = new Date('2026-11-18T00:00:00.000Z');

function setup(locked: Array<{ userId: string }>, due: Array<{ id: string }> = [{ id: 'd1' }, { id: 'd2' }]) {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue(locked),
    accountDeletion: { update: vi.fn().mockResolvedValue({}) },
  };
  const prisma = {
    accountDeletion: { findMany: vi.fn().mockResolvedValueOnce(due).mockResolvedValue([]) },
    $transaction: vi.fn((callback: (t: typeof tx) => unknown) => callback(tx)),
  };
  return { handler: new AccountPurgeHandler(prisma as never), prisma, tx };
}

describe('AccountPurgeHandler', () => {
  beforeEach(() => {
    vi.mocked(purgeUserData).mockReset().mockResolvedValue(undefined);
  });

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
    const { handler, tx } = setup([]);

    await expect(handler.purgeOne('d1', NOW)).resolves.toBe(false);
    expect(purgeUserData).not.toHaveBeenCalled();
    expect(tx.accountDeletion.update).not.toHaveBeenCalled();
  });

  it('continues after a failed purge, excludes it from the next query and reports its id and error name only', async () => {
    const tx = {
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce([{ userId: 'u1' }])
        .mockResolvedValueOnce([{ userId: 'u2' }]),
      accountDeletion: { update: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      accountDeletion: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([{ id: 'd1' }, { id: 'd2' }])
          .mockResolvedValueOnce([]),
      },
      $transaction: vi.fn((callback: (t: typeof tx) => unknown) => callback(tx)),
    };
    vi.mocked(purgeUserData).mockRejectedValueOnce(new Error('boom detail')).mockResolvedValue(undefined);
    const onFailure = vi.fn();
    const handler = new AccountPurgeHandler(prisma as never, onFailure);

    await handler.execute(NOW);

    expect(purgeUserData).toHaveBeenCalledTimes(2);
    expect(tx.accountDeletion.update).toHaveBeenCalledTimes(1);
    expect(tx.accountDeletion.update).toHaveBeenCalledWith({ where: { id: 'd2' }, data: { purgedAt: NOW } });
    expect(onFailure).toHaveBeenCalledWith({ deletionId: 'd1', errorName: 'Error' });
    expect(onFailure).toHaveBeenCalledTimes(1);
    // The second query excludes the id that failed in this run.
    expect(prisma.accountDeletion.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: { notIn: ['d1'] } }) }),
    );
  });

  it('stops starting new purges once the time budget is spent', async () => {
    const clock = vi
      .fn()
      .mockReturnValueOnce(0) // deadline computed at t=0 (deadline=200_000)
      .mockReturnValueOnce(0) // loop-top check before first query
      .mockReturnValueOnce(1_000) // before purging d1: still under budget
      .mockReturnValueOnce(250_000); // before purging d2: over budget, stop
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ userId: 'u1' }]),
      accountDeletion: { update: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      accountDeletion: { findMany: vi.fn().mockResolvedValue([{ id: 'd1' }, { id: 'd2' }]) },
      $transaction: vi.fn((callback: (t: typeof tx) => unknown) => callback(tx)),
    };
    const handler = new AccountPurgeHandler(prisma as never, undefined, clock);

    await handler.execute(NOW);

    expect(purgeUserData).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.accountDeletion.findMany).toHaveBeenCalledTimes(1);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });
});
