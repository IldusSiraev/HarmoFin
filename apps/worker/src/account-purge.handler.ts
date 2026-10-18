import { PrismaClient } from '@prisma/client';

import { purgeUserData } from './account-purge.js';
import type { WorkerJobHandler } from './job-runner.js';

const PURGE_BATCH_SIZE = 20;
const PURGE_TRANSACTION_TIMEOUT_MS = 60_000;

export class AccountPurgeHandler implements WorkerJobHandler {
  constructor(private readonly prisma: PrismaClient) {}

  async execute(now: Date): Promise<void> {
    const due = await this.prisma.accountDeletion.findMany({
      where: { purgeAfter: { lte: now }, restoredAt: null, purgedAt: null },
      select: { id: true },
      orderBy: { purgeAfter: 'asc' },
      take: PURGE_BATCH_SIZE,
    });
    for (const { id } of due) await this.purgeOne(id, now);
  }

  /** Re-checks the request under a row lock, so a concurrent restore cannot interleave. */
  purgeOne(deletionId: string, now: Date): Promise<boolean> {
    return this.prisma.$transaction(
      async (tx) => {
        const locked = await tx.$queryRaw<Array<{ userId: string }>>`
          SELECT d."user_id" AS "userId"
          FROM "account_deletions" d
          JOIN "users" u ON u."id" = d."user_id"
          WHERE d."id" = ${deletionId}::uuid
            AND d."restored_at" IS NULL
            AND d."purged_at" IS NULL
            AND d."purge_after" <= ${now}
            AND u."status" = 'PENDING_DELETION'
          FOR UPDATE OF d`;
        const target = locked[0];
        if (!target) return false;
        await purgeUserData(tx, target.userId);
        await tx.accountDeletion.update({ where: { id: deletionId }, data: { purgedAt: now } });
        return true;
      },
      { timeout: PURGE_TRANSACTION_TIMEOUT_MS },
    );
  }
}
