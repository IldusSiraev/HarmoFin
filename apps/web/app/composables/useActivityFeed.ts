import type { Ref } from 'vue';
import { useState } from '#imports';

import { useApiClient } from './useApiClient.js';
import type { PersonRef } from './useEnvelopePlanV2.js';

// Thin typed client over the v2 activity feed. Amounts are minor-unit strings from the server;
// nothing here computes money.

export type ActivityKind =
  | 'TRANSACTION_CREATED'
  | 'TRANSACTION_UPDATED'
  | 'TRANSACTION_DELETED'
  | 'TRANSACTION_RESTORED'
  | 'TRANSFER_CREATED'
  | 'TRANSFER_DELETED'
  | 'ENVELOPE_FUNDED'
  | 'ENVELOPE_MOVED'
  | 'PLAN_PAID'
  | 'PLAN_CREATED'
  | 'CALENDAR_EVENT_CREATED'
  | 'CALENDAR_EVENT_UPDATED'
  | 'CALENDAR_EVENT_DELETED'
  | 'MEMBER_JOINED'
  | 'MEMBER_LEFT'
  | 'MEMBER_REMOVED';

export type ActivityLinkType =
  'TRANSACTION' | 'TRANSFER' | 'ENVELOPE' | 'PLAN_OCCURRENCE' | 'PLAN' | 'CALENDAR_EVENT';

export interface ActivityItem {
  id: string;
  occurredAt: string;
  kind: ActivityKind;
  isNew: boolean;
  actor: PersonRef;
  amountMinor: string | null;
  currency: string;
  transactionType: 'INCOME' | 'EXPENSE' | null;
  title: string | null;
  details: string[];
  target: PersonRef | null;
  link: { type: ActivityLinkType; id: string; date: string | null } | null;
}

export interface ActivityFeedResponse {
  seenAt: string | null;
  newSince: string;
  unseenCount: number;
  people: PersonRef[];
  items: ActivityItem[];
  nextCursor: string | null;
}

export interface ActivityFeedQuery {
  limit?: number | undefined;
  actorId?: string | undefined;
  cursor?: string | undefined;
}

export function useActivityFeed(): {
  unseenCount: Ref<number | null>;
  list(budgetId: string, query?: ActivityFeedQuery): Promise<ActivityFeedResponse>;
  markSeen(budgetId: string): Promise<{ seenAt: string }>;
} {
  const api = useApiClient();
  // One count for the dashboard card, the feed page and the navigation badge; null until read.
  const unseenCount = useState<number | null>('activity-unseen', () => null) as Ref<number | null>;
  const base = (budgetId: string) => `/api/v2/budgets/${encodeURIComponent(budgetId)}/activity`;

  return {
    unseenCount,
    async list(budgetId, query = {}) {
      const params = new URLSearchParams();
      if (query.limit !== undefined) params.set('limit', String(query.limit));
      if (query.actorId) params.set('actorId', query.actorId);
      if (query.cursor) params.set('cursor', query.cursor);
      const search = params.toString();
      const feed = await api.request<ActivityFeedResponse>(
        search ? `${base(budgetId)}?${search}` : base(budgetId),
      );
      unseenCount.value = feed.unseenCount;
      return feed;
    },
    async markSeen(budgetId) {
      const result = await api.request<{ seenAt: string }>(`${base(budgetId)}/seen`, {
        method: 'POST',
      });
      unseenCount.value = 0;
      return result;
    },
  };
}
