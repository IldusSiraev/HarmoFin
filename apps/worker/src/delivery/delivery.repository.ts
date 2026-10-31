import { Prisma, type PrismaClient } from '@prisma/client';

export type ClaimedDelivery = {
  id: string;
  workspaceId: string;
  budgetId: string;
  userId: string;
  kind: 'URGENT' | 'DIGEST';
  notificationId: string | null;
  digestPeriodStart: Date | null;
  digestPeriodEnd: Date | null;
  dedupeKey: string;
  attempts: number;
};

/** A claimed letter is hidden for this long; a crashed run is retried after the lease. */
export const DELIVERY_LEASE_MS = 600_000;
export const MAX_DELIVERY_ATTEMPTS = 5;
const RETRY_DELAYS_MS: readonly number[] = [60_000, 300_000, 1_800_000, 7_200_000];

export function retryDelayMs(attempts: number): number | null {
  if (attempts >= MAX_DELIVERY_ATTEMPTS) return null;
  const index = Math.min(Math.max(0, attempts - 1), RETRY_DELAYS_MS.length - 1);
  return RETRY_DELAYS_MS[index] ?? null;
}

export class DeliveryRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Claims due letters with SKIP LOCKED, like worker_jobs: two workers never take the same row.
   * The attempt is counted and the row is leased by pushing next_attempt_at forward. `budgetId`
   * narrows the claim to one budget, as NotificationRuleHandler does (used by tests).
   */
  claim(limit: number, now: Date, budgetId?: string): Promise<ClaimedDelivery[]> {
    const scope = budgetId ? Prisma.sql`AND "budget_id" = ${budgetId}::uuid` : Prisma.empty;
    const leaseUntil = new Date(now.getTime() + DELIVERY_LEASE_MS);
    return this.prisma.$transaction(
      (tx) =>
        tx.$queryRaw<ClaimedDelivery[]>`
        WITH selected AS (
          SELECT "id"
          FROM "notification_deliveries"
          WHERE "status" = 'PENDING'
            AND "channel" = 'EMAIL'
            AND "next_attempt_at" <= ${now}
            ${scope}
          ORDER BY "next_attempt_at" ASC, "id" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT ${limit}
        )
        UPDATE "notification_deliveries" AS delivery
        SET
          "attempts" = delivery."attempts" + 1,
          "next_attempt_at" = ${leaseUntil},
          "updated_at" = ${now}
        FROM selected
        WHERE delivery."id" = selected."id"
        RETURNING
          delivery."id" AS "id",
          delivery."workspace_id" AS "workspaceId",
          delivery."budget_id" AS "budgetId",
          delivery."user_id" AS "userId",
          delivery."kind"::text AS "kind",
          delivery."notification_id" AS "notificationId",
          delivery."digest_period_start" AS "digestPeriodStart",
          delivery."digest_period_end" AS "digestPeriodEnd",
          delivery."dedupe_key" AS "dedupeKey",
          delivery."attempts" AS "attempts"
      `,
    );
  }

  /** Stored before sending, so the link in a delivered letter works even if markSent fails. */
  async prepareToken(id: string, tokenHash: string): Promise<void> {
    await this.prisma.notificationDelivery.update({
      where: { id },
      data: { unsubscribeTokenHash: tokenHash },
    });
  }

  async markSent(id: string, now: Date): Promise<void> {
    await this.prisma.notificationDelivery.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'SENT', sentAt: now, lastError: null },
    });
  }

  async cancel(id: string, reason: string): Promise<void> {
    await this.prisma.notificationDelivery.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'CANCELLED', lastError: reason.slice(0, 200) },
    });
  }

  /** Returns true when the letter reached its last attempt and is now FAILED. */
  async retryOrFail(id: string, attempts: number, now: Date, error: string): Promise<boolean> {
    const delay = retryDelayMs(attempts);
    await this.prisma.notificationDelivery.updateMany({
      where: { id, status: 'PENDING' },
      data:
        delay === null
          ? { status: 'FAILED', lastError: error.slice(0, 200) }
          : { nextAttemptAt: new Date(now.getTime() + delay), lastError: error.slice(0, 200) },
    });
    return delay === null;
  }
}
