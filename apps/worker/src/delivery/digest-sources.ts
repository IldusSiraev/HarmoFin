import type { DigestGroup } from '../mail/templates.js';

/**
 * Copy of the activity feed whitelist (apps/api/src/activity-feed/feed-kinds.ts, FEED_SOURCES),
 * grouped for the digest. The worker does not import API code; apps/api/test/email-digest
 * .integration.test.ts checks that both lists hold the same 16 pairs. Change them together.
 */
export const DIGEST_SOURCES: ReadonlyArray<{
  entityType: string;
  action: string;
  group: DigestGroup;
}> = [
  { entityType: 'transaction', action: 'CREATED', group: 'operations' },
  { entityType: 'transaction', action: 'UPDATED', group: 'operations' },
  { entityType: 'transaction', action: 'DELETED', group: 'operations' },
  { entityType: 'transaction', action: 'RESTORED', group: 'operations' },
  { entityType: 'transfer', action: 'CREATED', group: 'transfers' },
  { entityType: 'transfer', action: 'DELETED', group: 'transfers' },
  { entityType: 'envelope-assignment', action: 'CREATED', group: 'envelopes' },
  { entityType: 'envelope-movement', action: 'CREATED', group: 'envelopes' },
  { entityType: 'plan_occurrence', action: 'COMPLETED', group: 'plans' },
  { entityType: 'regular_plan', action: 'CREATED', group: 'plans' },
  { entityType: 'calendar_event', action: 'CREATED', group: 'calendar' },
  { entityType: 'calendar_event', action: 'UPDATED', group: 'calendar' },
  { entityType: 'calendar_event', action: 'DELETED', group: 'calendar' },
  { entityType: 'workspace_invitation', action: 'ACCEPTED', group: 'family' },
  { entityType: 'workspace_membership', action: 'LEFT', group: 'family' },
  { entityType: 'workspace_membership', action: 'REMOVED', group: 'family' },
];

export function groupOf(entityType: string, action: string): DigestGroup | null {
  return (
    DIGEST_SOURCES.find((source) => source.entityType === entityType && source.action === action)
      ?.group ?? null
  );
}
