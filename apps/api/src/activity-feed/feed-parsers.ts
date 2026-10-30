import { kindOf, type FeedKind } from './feed-kinds.js';

/** The audit columns the feed reads. Values stay inside the server: only parsed fields go out. */
export interface FeedAuditRow {
  id: string;
  createdAt: Date;
  actorUserId: string;
  entityType: string;
  entityId: string | null;
  action: string;
  oldValues: unknown;
  newValues: unknown;
}

export type RefType =
  'ACCOUNT' | 'ENVELOPE' | 'CATEGORY' | 'PLAN' | 'OCCURRENCE' | 'CALENDAR_EVENT';

export interface Ref {
  type: RefType;
  id: string;
}

export type LinkType =
  'TRANSACTION' | 'TRANSFER' | 'ENVELOPE' | 'PLAN_OCCURRENCE' | 'PLAN' | 'CALENDAR_EVENT';

export interface FeedDraft {
  auditEventId: string;
  occurredAt: Date;
  kind: FeedKind;
  actorUserId: string;
  amountMinor: bigint | null;
  transactionType: 'INCOME' | 'EXPENSE' | null;
  /** Main label of the row (category, envelope, plan or event name). */
  title: Ref | null;
  /** Secondary labels in display order (accounts, envelopes). */
  details: Ref[];
  /** Object the row opens; dropped later when the object no longer exists. */
  link: { type: LinkType; id: string } | null;
  /** Calendar only: event start as stored in the audit row. */
  eventStart: { date: string } | { instant: string } | null;
  /** MEMBER_REMOVED only: membership of the removed person. */
  targetMembershipId: string | null;
}

type Body = Omit<FeedDraft, 'auditEventId' | 'occurredAt' | 'kind' | 'actorUserId'>;
type Values = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMPTY: Body = {
  amountMinor: null,
  transactionType: null,
  title: null,
  details: [],
  link: null,
  eventStart: null,
  targetMembershipId: null,
};

function objectOf(value: unknown): Values | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Values)
    : null;
}

/** Deletions describe the object before the change; everything else after it. */
function valuesOf(row: FeedAuditRow, kind: FeedKind): Values | null {
  return kind.endsWith('_DELETED') ? objectOf(row.oldValues) : objectOf(row.newValues);
}

function idOf(values: Values, key: string): string | null {
  const value = values[key];
  return typeof value === 'string' && UUID.test(value) ? value : null;
}

function minorOf(values: Values, key: string): bigint | null {
  const value = values[key];
  return typeof value === 'string' && /^\d+$/.test(value) ? BigInt(value) : null;
}

function transaction(row: FeedAuditRow, values: Values | null): Body | null {
  if (!values || !row.entityId) return null;
  const amountMinor = minorOf(values, 'amountMinor');
  const type = values['transactionType'];
  const accountId = idOf(values, 'accountId');
  const categoryId = idOf(values, 'categoryId');
  if (amountMinor === null || (type !== 'INCOME' && type !== 'EXPENSE')) return null;
  if (!accountId || !categoryId) return null;
  const envelopeId = idOf(values, 'envelopeId');
  return {
    ...EMPTY,
    amountMinor,
    transactionType: type,
    title: { type: 'CATEGORY', id: categoryId },
    details: [
      { type: 'ACCOUNT', id: accountId },
      ...(envelopeId ? [{ type: 'ENVELOPE' as const, id: envelopeId }] : []),
    ],
    link: { type: 'TRANSACTION', id: row.entityId },
  };
}

function transfer(row: FeedAuditRow, values: Values | null): Body | null {
  if (!values || !row.entityId) return null;
  const amountMinor = minorOf(values, 'totalMinor');
  const source = idOf(values, 'sourceAccountId');
  const destination = idOf(values, 'destinationAccountId');
  if (amountMinor === null || !source || !destination) return null;
  return {
    ...EMPTY,
    amountMinor,
    details: [
      { type: 'ACCOUNT', id: source },
      { type: 'ACCOUNT', id: destination },
    ],
    link: { type: 'TRANSFER', id: row.entityId },
  };
}

function envelopeFunded(_row: FeedAuditRow, values: Values | null): Body | null {
  if (!values) return null;
  const amountMinor = minorOf(values, 'amountMinor');
  const envelopeId = idOf(values, 'envelopeId');
  if (amountMinor === null || !envelopeId) return null;
  return {
    ...EMPTY,
    amountMinor,
    title: { type: 'ENVELOPE', id: envelopeId },
    link: { type: 'ENVELOPE', id: envelopeId },
  };
}

function envelopeMoved(_row: FeedAuditRow, values: Values | null): Body | null {
  if (!values) return null;
  const amountMinor = minorOf(values, 'amountMinor');
  const source = idOf(values, 'sourceEnvelopeId');
  const destination = idOf(values, 'destinationEnvelopeId');
  if (amountMinor === null || !source || !destination) return null;
  return {
    ...EMPTY,
    amountMinor,
    details: [
      { type: 'ENVELOPE', id: source },
      { type: 'ENVELOPE', id: destination },
    ],
    link: { type: 'ENVELOPE', id: destination },
  };
}

// v2 payments record only the status change: no amount, the name comes through the occurrence.
function planPaid(row: FeedAuditRow): Body | null {
  if (!row.entityId) return null;
  return {
    ...EMPTY,
    title: { type: 'OCCURRENCE', id: row.entityId },
    link: { type: 'PLAN_OCCURRENCE', id: row.entityId },
  };
}

function planCreated(row: FeedAuditRow, values: Values | null): Body | null {
  if (!row.entityId) return null;
  return {
    ...EMPTY,
    amountMinor: values ? minorOf(values, 'amountMinor') : null,
    title: { type: 'PLAN', id: row.entityId },
    link: { type: 'PLAN', id: row.entityId },
  };
}

// Calendar audit rows hold rule fields only (no title): the name comes from the event row.
function calendarEvent(row: FeedAuditRow, values: Values | null): Body | null {
  if (!row.entityId) return null;
  const startsOn = values?.['startsOn'];
  const startsAt = values?.['startsAt'];
  const eventStart =
    typeof startsOn === 'string' && /^\d{4}-\d{2}-\d{2}/.test(startsOn)
      ? { date: startsOn.slice(0, 10) }
      : typeof startsAt === 'string' && !Number.isNaN(Date.parse(startsAt))
        ? { instant: startsAt }
        : null;
  return {
    ...EMPTY,
    title: { type: 'CALENDAR_EVENT', id: row.entityId },
    link: { type: 'CALENDAR_EVENT', id: row.entityId },
    eventStart,
  };
}

function memberRemoved(row: FeedAuditRow): Body | null {
  return row.entityId ? { ...EMPTY, targetMembershipId: row.entityId } : null;
}

const PARSERS: Record<FeedKind, (row: FeedAuditRow, values: Values | null) => Body | null> = {
  TRANSACTION_CREATED: transaction,
  TRANSACTION_UPDATED: transaction,
  TRANSACTION_DELETED: transaction,
  TRANSACTION_RESTORED: transaction,
  TRANSFER_CREATED: transfer,
  TRANSFER_DELETED: transfer,
  ENVELOPE_FUNDED: envelopeFunded,
  ENVELOPE_MOVED: envelopeMoved,
  PLAN_PAID: planPaid,
  PLAN_CREATED: planCreated,
  CALENDAR_EVENT_CREATED: calendarEvent,
  CALENDAR_EVENT_UPDATED: calendarEvent,
  CALENDAR_EVENT_DELETED: calendarEvent,
  MEMBER_JOINED: () => ({ ...EMPTY }),
  MEMBER_LEFT: () => ({ ...EMPTY }),
  MEMBER_REMOVED: memberRemoved,
};

/** Null for pairs outside the whitelist and for payloads the parser cannot trust. */
export function parseAuditRow(row: FeedAuditRow): FeedDraft | null {
  const kind = kindOf(row.entityType, row.action);
  if (!kind) return null;
  const body = PARSERS[kind](row, valuesOf(row, kind));
  if (!body) return null;
  return {
    auditEventId: row.id,
    occurredAt: row.createdAt,
    kind,
    actorUserId: row.actorUserId,
    ...body,
  };
}
