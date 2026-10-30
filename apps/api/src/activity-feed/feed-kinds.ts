/**
 * Family-relevant audit pairs shown in the activity feed. Technical events (sign-in, settings,
 * reference data, notifications, demo seed) are deliberately absent. A pair is listed only when a
 * v2 write path records it; see the design doc for the source repositories.
 */
export const FEED_KINDS = [
  'TRANSACTION_CREATED',
  'TRANSACTION_UPDATED',
  'TRANSACTION_DELETED',
  'TRANSACTION_RESTORED',
  'TRANSFER_CREATED',
  'TRANSFER_DELETED',
  'ENVELOPE_FUNDED',
  'ENVELOPE_MOVED',
  'PLAN_PAID',
  'PLAN_CREATED',
  'CALENDAR_EVENT_CREATED',
  'CALENDAR_EVENT_UPDATED',
  'CALENDAR_EVENT_DELETED',
  'MEMBER_JOINED',
  'MEMBER_LEFT',
  'MEMBER_REMOVED',
] as const;

export type FeedKind = (typeof FEED_KINDS)[number];

export const FEED_SOURCES: ReadonlyArray<{ entityType: string; action: string; kind: FeedKind }> = [
  { entityType: 'transaction', action: 'CREATED', kind: 'TRANSACTION_CREATED' },
  { entityType: 'transaction', action: 'UPDATED', kind: 'TRANSACTION_UPDATED' },
  { entityType: 'transaction', action: 'DELETED', kind: 'TRANSACTION_DELETED' },
  { entityType: 'transaction', action: 'RESTORED', kind: 'TRANSACTION_RESTORED' },
  { entityType: 'transfer', action: 'CREATED', kind: 'TRANSFER_CREATED' },
  { entityType: 'transfer', action: 'DELETED', kind: 'TRANSFER_DELETED' },
  { entityType: 'envelope-assignment', action: 'CREATED', kind: 'ENVELOPE_FUNDED' },
  { entityType: 'envelope-movement', action: 'CREATED', kind: 'ENVELOPE_MOVED' },
  { entityType: 'plan_occurrence', action: 'COMPLETED', kind: 'PLAN_PAID' },
  { entityType: 'regular_plan', action: 'CREATED', kind: 'PLAN_CREATED' },
  { entityType: 'calendar_event', action: 'CREATED', kind: 'CALENDAR_EVENT_CREATED' },
  { entityType: 'calendar_event', action: 'UPDATED', kind: 'CALENDAR_EVENT_UPDATED' },
  { entityType: 'calendar_event', action: 'DELETED', kind: 'CALENDAR_EVENT_DELETED' },
  { entityType: 'workspace_invitation', action: 'ACCEPTED', kind: 'MEMBER_JOINED' },
  { entityType: 'workspace_membership', action: 'LEFT', kind: 'MEMBER_LEFT' },
  { entityType: 'workspace_membership', action: 'REMOVED', kind: 'MEMBER_REMOVED' },
];

export function kindOf(entityType: string, action: string): FeedKind | null {
  return (
    FEED_SOURCES.find((source) => source.entityType === entityType && source.action === action)
      ?.kind ?? null
  );
}
