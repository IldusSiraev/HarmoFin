import type { Prisma } from '@prisma/client';

import { createUuidV7 } from '../common/identifiers/uuid-v7.js';
import type { FeedCursor } from './feed-cursor.js';
import { FEED_SOURCES } from './feed-kinds.js';
import type { FeedAuditRow, LinkType, Ref, RefType } from './feed-parsers.js';

type Db = Prisma.TransactionClient;

export const refKey = (type: RefType | LinkType, id: string): string => `${type}:${id}`;

export interface FeedFilter {
  budgetId: string;
  userId: string;
  /** Start of the 30-day window, inclusive. */
  from: Date;
  /** Only rows strictly after this moment (unseen count). */
  after?: Date | undefined;
  actorId?: string | undefined;
  cursor?: FeedCursor | undefined;
}

/** Budget, window, whitelist and "not mine, has an author" — all inside the SQL query. */
export function feedWhere(filter: FeedFilter): Prisma.AuditEventWhereInput {
  return {
    budgetId: filter.budgetId,
    createdAt: { gte: filter.from, ...(filter.after ? { gt: filter.after } : {}) },
    OR: FEED_SOURCES.map(({ entityType, action }) => ({ entityType, action })),
    AND: [
      { actorUserId: { not: null } },
      { actorUserId: { not: filter.userId } },
      ...(filter.actorId ? [{ actorUserId: filter.actorId }] : []),
      ...(filter.cursor
        ? [
            {
              OR: [
                { createdAt: { lt: filter.cursor.createdAt } },
                { createdAt: filter.cursor.createdAt, id: { lt: filter.cursor.id } },
              ],
            },
          ]
        : []),
    ],
  };
}

function idsOf(refs: ReadonlyArray<{ type: string; id: string }>, type: string): string[] {
  return [...new Set(refs.filter((ref) => ref.type === type).map((ref) => ref.id))];
}

export class ActivityFeedRepository {
  async budgetSettings(db: Db, budgetId: string): Promise<{ timezone: string; currency: string }> {
    const budget = await db.budget.findUniqueOrThrow({
      where: { id: budgetId },
      select: { timezone: true, primaryCurrency: true },
    });
    return { timezone: budget.timezone, currency: budget.primaryCurrency };
  }

  async findSeenAt(db: Db, budgetId: string, userId: string): Promise<Date | null> {
    const row = await db.activityFeedCursor.findUnique({
      where: { budgetId_userId: { budgetId, userId } },
      select: { seenAt: true },
    });
    return row?.seenAt ?? null;
  }

  /** Upsert that only moves forward: a stale tab cannot push the marker back. */
  async markSeen(
    db: Db,
    input: { workspaceId: string; budgetId: string; userId: string; now: Date },
  ): Promise<Date> {
    const rows = await db.$queryRaw<Array<{ seen_at: Date | string }>>`
      INSERT INTO "activity_feed_cursors"
        ("id", "workspace_id", "budget_id", "user_id", "seen_at", "updated_at")
      VALUES (${createUuidV7(input.now)}::uuid, ${input.workspaceId}::uuid, ${input.budgetId}::uuid,
        ${input.userId}::uuid, ${input.now}, ${input.now})
      ON CONFLICT ("budget_id", "user_id") DO UPDATE
        SET "seen_at" = GREATEST("activity_feed_cursors"."seen_at", EXCLUDED."seen_at"),
            "updated_at" = EXCLUDED."updated_at"
      RETURNING "seen_at"`;
    return new Date(rows[0]!.seen_at);
  }

  count(db: Db, where: Prisma.AuditEventWhereInput): Promise<number> {
    return db.auditEvent.count({ where });
  }

  async listRows(
    db: Db,
    where: Prisma.AuditEventWhereInput,
    take: number,
  ): Promise<FeedAuditRow[]> {
    const rows = await db.auditEvent.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
      select: {
        id: true,
        createdAt: true,
        actorUserId: true,
        entityType: true,
        entityId: true,
        action: true,
        oldValues: true,
        newValues: true,
      },
    });
    return rows.flatMap((row) =>
      row.actorUserId ? [{ ...row, actorUserId: row.actorUserId }] : [],
    );
  }

  /** Names of referenced objects, budget-scoped; archived and logically deleted rows included. */
  async labels(db: Db, budgetId: string, refs: ReadonlyArray<Ref>): Promise<Map<string, string>> {
    const labels = new Map<string, string>();
    const put = (type: RefType, rows: Array<{ id: string; name: string }>) => {
      for (const row of rows) labels.set(refKey(type, row.id), row.name);
    };
    const accounts = idsOf(refs, 'ACCOUNT');
    if (accounts.length > 0) {
      put(
        'ACCOUNT',
        await db.account.findMany({
          where: { budgetId, id: { in: accounts } },
          select: { id: true, name: true },
        }),
      );
    }
    const envelopes = idsOf(refs, 'ENVELOPE');
    if (envelopes.length > 0) {
      put(
        'ENVELOPE',
        await db.envelope.findMany({
          where: { budgetId, id: { in: envelopes } },
          select: { id: true, name: true },
        }),
      );
    }
    const categories = idsOf(refs, 'CATEGORY');
    if (categories.length > 0) {
      put(
        'CATEGORY',
        await db.category.findMany({
          where: { budgetId, id: { in: categories } },
          select: { id: true, name: true },
        }),
      );
    }
    const plans = idsOf(refs, 'PLAN');
    if (plans.length > 0) {
      put(
        'PLAN',
        await db.regularPlan.findMany({
          where: { budgetId, id: { in: plans } },
          select: { id: true, name: true },
        }),
      );
    }
    const occurrences = idsOf(refs, 'OCCURRENCE');
    if (occurrences.length > 0) {
      const rows = await db.planOccurrence.findMany({
        where: { budgetId, id: { in: occurrences } },
        select: { id: true, plan: { select: { name: true } } },
      });
      put(
        'OCCURRENCE',
        rows.map((row) => ({ id: row.id, name: row.plan.name })),
      );
    }
    const events = idsOf(refs, 'CALENDAR_EVENT');
    if (events.length > 0) {
      const rows = await db.calendarEvent.findMany({
        where: { budgetId, id: { in: events } },
        select: { id: true, title: true },
      });
      put(
        'CALENDAR_EVENT',
        rows.map((row) => ({ id: row.id, name: row.title })),
      );
    }
    return labels;
  }

  /** Link targets that can still be opened: present in the budget and not logically deleted. */
  async liveLinks(
    db: Db,
    budgetId: string,
    links: ReadonlyArray<{ type: LinkType; id: string }>,
  ): Promise<Set<string>> {
    const live = new Set<string>();
    const add = (type: LinkType, rows: Array<{ id: string }>) => {
      for (const row of rows) live.add(refKey(type, row.id));
    };
    const select = { id: true } as const;
    const transactions = idsOf(links, 'TRANSACTION');
    if (transactions.length > 0) {
      add(
        'TRANSACTION',
        await db.transaction.findMany({
          where: { budgetId, id: { in: transactions }, deletedAt: null },
          select,
        }),
      );
    }
    const transfers = idsOf(links, 'TRANSFER');
    if (transfers.length > 0) {
      add(
        'TRANSFER',
        await db.transfer.findMany({
          where: { budgetId, id: { in: transfers }, deletedAt: null },
          select,
        }),
      );
    }
    const envelopes = idsOf(links, 'ENVELOPE');
    if (envelopes.length > 0) {
      add(
        'ENVELOPE',
        await db.envelope.findMany({ where: { budgetId, id: { in: envelopes } }, select }),
      );
    }
    const occurrences = idsOf(links, 'PLAN_OCCURRENCE');
    if (occurrences.length > 0) {
      add(
        'PLAN_OCCURRENCE',
        await db.planOccurrence.findMany({ where: { budgetId, id: { in: occurrences } }, select }),
      );
    }
    const plans = idsOf(links, 'PLAN');
    if (plans.length > 0) {
      add(
        'PLAN',
        await db.regularPlan.findMany({
          where: { budgetId, id: { in: plans }, deletedAt: null },
          select,
        }),
      );
    }
    const events = idsOf(links, 'CALENDAR_EVENT');
    if (events.length > 0) {
      add(
        'CALENDAR_EVENT',
        await db.calendarEvent.findMany({
          where: { budgetId, id: { in: events }, deletedAt: null },
          select,
        }),
      );
    }
    return live;
  }

  /** membershipId → userId inside one workspace (removed members keep their row). */
  async membershipUsers(
    db: Db,
    workspaceId: string,
    membershipIds: string[],
  ): Promise<Map<string, string>> {
    if (membershipIds.length === 0) return new Map();
    const rows = await db.workspaceMembership.findMany({
      where: { workspaceId, id: { in: [...new Set(membershipIds)] } },
      select: { id: true, userId: true },
    });
    return new Map(rows.map((row) => [row.id, row.userId]));
  }

  async otherMemberIds(db: Db, workspaceId: string, userId: string): Promise<string[]> {
    const rows = await db.workspaceMembership.findMany({
      where: { workspaceId, userId: { not: userId } },
      select: { userId: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => row.userId);
  }
}
