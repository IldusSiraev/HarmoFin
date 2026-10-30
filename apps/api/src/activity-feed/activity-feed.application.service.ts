import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { utcToLocal } from '../calendar/zoned-time.js';
import {
  findPersonRefs,
  personRefOf,
  type PersonRef,
} from '../common/people/person-ref.repository.js';
import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import { findAccessActor } from '../common/policies/access-actor.repository.js';
import { resourceNotFound } from '../common/reference-data/reference-data.errors.js';
import type { PrismaService } from '../database/prisma.service.js';
import { ActivityFeedRepository, feedWhere, refKey } from './activity-feed.repository.js';
import type { ActivityFeedQuery } from './activity-feed.schemas.js';
import { decodeCursor, encodeCursor } from './feed-cursor.js';
import type { FeedKind } from './feed-kinds.js';
import {
  parseAuditRow,
  type FeedDraft,
  type LinkType,
  type Ref,
  type RefType,
} from './feed-parsers.js';

type Tx = Prisma.TransactionClient;

const DAY_MS = 86_400_000;
export const FEED_WINDOW_DAYS = 30;
export const UNSEEN_DEFAULT_DAYS = 7;

const FALLBACK_LABELS: Record<RefType, string> = {
  ACCOUNT: 'удалённый счёт',
  ENVELOPE: 'удалённый конверт',
  CATEGORY: 'без категории',
  PLAN: 'удалённый план',
  OCCURRENCE: 'удалённый план',
  CALENDAR_EVENT: 'удалённое событие',
};

export interface ActivityItemView {
  id: string;
  occurredAt: string;
  kind: FeedKind;
  isNew: boolean;
  actor: PersonRef;
  amountMinor: string | null;
  currency: string;
  transactionType: 'INCOME' | 'EXPENSE' | null;
  title: string | null;
  details: string[];
  target: PersonRef | null;
  link: { type: LinkType; id: string; date: string | null } | null;
}

export interface ActivityFeedView {
  seenAt: string | null;
  /** Boundary of isNew: seenAt, or now minus 7 days without a marker. */
  newSince: string;
  unseenCount: number;
  people: PersonRef[];
  items: ActivityItemView[];
  nextCursor: string | null;
}

function eventDate(draft: FeedDraft, timezone: string): string | null {
  if (!draft.eventStart) return null;
  return 'date' in draft.eventStart
    ? draft.eventStart.date
    : utcToLocal(new Date(draft.eventStart.instant), timezone).date;
}

/**
 * Read-only view over the audit trail. Money is passed through as minor-unit strings from the
 * audit rows; nothing here sums or recalculates amounts.
 */
@Injectable()
export class ActivityFeedApplicationService {
  private readonly repository = new ActivityFeedRepository();
  private readonly logger = new Logger('ActivityFeedApplicationService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly planModelPolicy: PlanModelPolicy,
  ) {}

  async list(
    userId: string,
    budgetId: string,
    query: ActivityFeedQuery,
    now = new Date(),
  ): Promise<ActivityFeedView> {
    const model = await this.planModelPolicy.requireModel(userId, budgetId, 2);
    return this.prisma.$transaction(async (tx) => {
      if (!(await findAccessActor(tx, model.workspaceId, userId))) throw resourceNotFound();
      const from = new Date(now.getTime() - FEED_WINDOW_DAYS * DAY_MS);
      const seenAt = await this.repository.findSeenAt(tx, budgetId, userId);
      const since = seenAt ?? new Date(now.getTime() - UNSEEN_DEFAULT_DAYS * DAY_MS);

      const unseenCount = await this.repository.count(
        tx,
        feedWhere({ budgetId, userId, from, after: since }),
      );
      const rows = await this.repository.listRows(
        tx,
        feedWhere({
          budgetId,
          userId,
          from,
          actorId: query.actorId,
          cursor: query.cursor ? (decodeCursor(query.cursor) ?? undefined) : undefined,
        }),
        query.limit + 1,
      );
      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      const nextCursor =
        rows.length > query.limit && last
          ? encodeCursor({ createdAt: last.createdAt, id: last.id })
          : null;

      const drafts = page.flatMap((row) => {
        const draft = parseAuditRow(row);
        if (!draft) {
          this.logger.warn({ event: 'activity_feed_unparsed_row', auditEventId: row.id });
          return [];
        }
        return [draft];
      });
      const items = await this.assemble(tx, model.workspaceId, budgetId, drafts, since);
      const others = await this.repository.otherMemberIds(tx, model.workspaceId, userId);
      const people = await findPersonRefs(tx, model.workspaceId, others);
      return {
        seenAt: seenAt?.toISOString() ?? null,
        newSince: since.toISOString(),
        unseenCount,
        people: others.map((id) => personRefOf(people, id)),
        items,
        nextCursor,
      };
    });
  }

  async markSeen(userId: string, budgetId: string, now = new Date()): Promise<{ seenAt: string }> {
    const model = await this.planModelPolicy.requireModel(userId, budgetId, 2);
    return this.prisma.$transaction(async (tx) => {
      if (!(await findAccessActor(tx, model.workspaceId, userId))) throw resourceNotFound();
      const seenAt = await this.repository.markSeen(tx, {
        workspaceId: model.workspaceId,
        budgetId,
        userId,
        now,
      });
      return { seenAt: seenAt.toISOString() };
    });
  }

  private async assemble(
    tx: Tx,
    workspaceId: string,
    budgetId: string,
    drafts: FeedDraft[],
    since: Date,
  ): Promise<ActivityItemView[]> {
    if (drafts.length === 0) return [];
    const settings = await this.repository.budgetSettings(tx, budgetId);
    const refs = drafts.flatMap((draft) => [
      ...(draft.title ? [draft.title] : []),
      ...draft.details,
    ]);
    const labels = await this.repository.labels(tx, budgetId, refs);
    const live = await this.repository.liveLinks(
      tx,
      budgetId,
      drafts.flatMap((draft) => (draft.link ? [draft.link] : [])),
    );
    const targets = await this.repository.membershipUsers(
      tx,
      workspaceId,
      drafts.flatMap((draft) => (draft.targetMembershipId ? [draft.targetMembershipId] : [])),
    );
    const people = await findPersonRefs(tx, workspaceId, [
      ...drafts.map((draft) => draft.actorUserId),
      ...targets.values(),
    ]);
    const label = (ref: Ref) => labels.get(refKey(ref.type, ref.id)) ?? FALLBACK_LABELS[ref.type];

    return drafts.map((draft) => {
      const targetUserId = draft.targetMembershipId
        ? targets.get(draft.targetMembershipId)
        : undefined;
      return {
        id: draft.auditEventId,
        occurredAt: draft.occurredAt.toISOString(),
        kind: draft.kind,
        isNew: draft.occurredAt.getTime() > since.getTime(),
        actor: personRefOf(people, draft.actorUserId),
        amountMinor: draft.amountMinor?.toString() ?? null,
        currency: settings.currency,
        transactionType: draft.transactionType,
        title: draft.title ? label(draft.title) : null,
        details: draft.details.map(label),
        target: targetUserId ? personRefOf(people, targetUserId) : null,
        link:
          draft.link && live.has(refKey(draft.link.type, draft.link.id))
            ? { ...draft.link, date: eventDate(draft, settings.timezone) }
            : null,
      };
    });
  }
}
