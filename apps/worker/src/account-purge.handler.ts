import { PrismaClient } from '@prisma/client';

import { purgeUserData } from './account-purge.js';
import type { WorkerJobHandler } from './job-runner.js';

const PURGE_BATCH_SIZE = 20;
const PURGE_TRANSACTION_TIMEOUT_MS = 60_000;
/** Stay well under the job lease so a slow batch cannot be re-claimed concurrently. */
const PURGE_TIME_BUDGET_MS = 200_000;

export type AccountPurgeFailure = { deletionId: string; errorName: string };

export class AccountPurgeHandler implements WorkerJobHandler {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly onFailure?: (failure: AccountPurgeFailure) => void,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  /** Drains due requests in batches, skipping ids that failed in this run so the loop terminates. */
  async execute(now: Date): Promise<void> {
    const deadline = this.clock() + PURGE_TIME_BUDGET_MS;
    const failedIds = new Set<string>();

    for (;;) {
      if (this.clock() >= deadline) return;
      const due = await this.prisma.accountDeletion.findMany({
        where: {
          purgeAfter: { lte: now },
          restoredAt: null,
          purgedAt: null,
          ...(failedIds.size > 0 ? { id: { notIn: [...failedIds] } } : {}),
        },
        select: { id: true },
        orderBy: { purgeAfter: 'asc' },
        take: PURGE_BATCH_SIZE,
      });
      if (due.length === 0) return;

      for (const { id } of due) {
        if (this.clock() >= deadline) return;
        try {
          await this.purgeOne(id, now);
        } catch (error) {
          failedIds.add(id);
          this.onFailure?.({ deletionId: id, errorName: errorName(error) });
        }
      }
    }
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

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'Unknown error';
}
