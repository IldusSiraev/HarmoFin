import { describe, expect, it } from 'vitest';

import { parseAuditRow, type FeedAuditRow } from './feed-parsers.js';

const ids = {
  row: '0195f0a0-0000-7000-8000-0000000000a1',
  actor: '0195f0a0-0000-7000-8000-0000000000b1',
  entity: '0195f0a0-0000-7000-8000-0000000000c1',
  account: '0195f0a0-0000-7000-8000-0000000000d1',
  account2: '0195f0a0-0000-7000-8000-0000000000d2',
  category: '0195f0a0-0000-7000-8000-0000000000e1',
  envelope: '0195f0a0-0000-7000-8000-0000000000f1',
  envelope2: '0195f0a0-0000-7000-8000-0000000000f2',
};
const at = new Date('2026-10-30T11:20:00.000Z');

const row = (overrides: Partial<FeedAuditRow>): FeedAuditRow => ({
  id: ids.row,
  createdAt: at,
  actorUserId: ids.actor,
  entityType: 'transaction',
  entityId: ids.entity,
  action: 'CREATED',
  oldValues: null,
  newValues: null,
  ...overrides,
});

const transactionValues = {
  transactionType: 'EXPENSE',
  status: 'CONFIRMED',
  amountMinor: '120000',
  occurredOn: '2026-10-30',
  accountId: ids.account,
  categoryId: ids.category,
  envelopeId: ids.envelope,
  isPlanned: false,
  confirmedAt: '2026-10-30T11:20:00.000Z',
  cancelledAt: null,
  deletedAt: null,
  preDeleteStatus: null,
};

describe('parseAuditRow', () => {
  it('transaction created: amount, type, category title, account and envelope details, link', () => {
    expect(parseAuditRow(row({ newValues: transactionValues }))).toEqual({
      auditEventId: ids.row,
      occurredAt: at,
      kind: 'TRANSACTION_CREATED',
      actorUserId: ids.actor,
      amountMinor: 120000n,
      transactionType: 'EXPENSE',
      title: { type: 'CATEGORY', id: ids.category },
      details: [
        { type: 'ACCOUNT', id: ids.account },
        { type: 'ENVELOPE', id: ids.envelope },
      ],
      link: { type: 'TRANSACTION', id: ids.entity },
      eventStart: null,
      targetMembershipId: null,
    });
  });

  it('transaction deleted reads the state before deletion', () => {
    const draft = parseAuditRow(
      row({
        action: 'DELETED',
        oldValues: { ...transactionValues, envelopeId: null },
        newValues: { ...transactionValues, status: 'DELETED', envelopeId: null },
      }),
    );
    expect(draft).toMatchObject({
      kind: 'TRANSACTION_DELETED',
      amountMinor: 120000n,
      details: [{ type: 'ACCOUNT', id: ids.account }],
    });
  });

  it('transaction updated and restored read the state after the change', () => {
    const updated = parseAuditRow(
      row({
        action: 'UPDATED',
        oldValues: { ...transactionValues, amountMinor: '100000' },
        newValues: { ...transactionValues, amountMinor: '150000' },
      }),
    );
    expect(updated).toMatchObject({
      kind: 'TRANSACTION_UPDATED',
      amountMinor: 150000n,
      title: { type: 'CATEGORY', id: ids.category },
      link: { type: 'TRANSACTION', id: ids.entity },
    });

    const restored = parseAuditRow(
      row({
        action: 'RESTORED',
        oldValues: { ...transactionValues, status: 'DELETED' },
        newValues: { ...transactionValues, accountId: ids.account2, envelopeId: null },
      }),
    );
    expect(restored).toMatchObject({
      kind: 'TRANSACTION_RESTORED',
      amountMinor: 120000n,
      details: [{ type: 'ACCOUNT', id: ids.account2 }],
    });
  });

  it('transfer created and deleted: total and both accounts', () => {
    const created = parseAuditRow(
      row({
        entityType: 'transfer',
        newValues: {
          mode: 'ACCOUNT_ONLY',
          sourceAccountId: ids.account,
          destinationAccountId: ids.account2,
          totalMinor: '500000',
          occurredOn: '2026-10-30',
        },
      }),
    );
    expect(created).toMatchObject({
      kind: 'TRANSFER_CREATED',
      amountMinor: 500000n,
      transactionType: null,
      title: null,
      details: [
        { type: 'ACCOUNT', id: ids.account },
        { type: 'ACCOUNT', id: ids.account2 },
      ],
      link: { type: 'TRANSFER', id: ids.entity },
    });
    const deleted = parseAuditRow(
      row({
        entityType: 'transfer',
        action: 'DELETED',
        oldValues: {
          status: 'CONFIRMED',
          sourceAccountId: ids.account,
          destinationAccountId: ids.account2,
          totalMinor: '500000',
          occurredOn: '2026-10-30',
          comment: null,
          deletedAt: null,
        },
        newValues: { status: 'DELETED' },
      }),
    );
    expect(deleted).toMatchObject({ kind: 'TRANSFER_DELETED', amountMinor: 500000n });
  });

  it('envelope funded and moved', () => {
    expect(
      parseAuditRow(
        row({
          entityType: 'envelope-assignment',
          newValues: {
            envelopeId: ids.envelope,
            periodId: ids.entity,
            type: 'FREE',
            sourceIncomeTransactionId: null,
            amountMinor: '300000',
            effectiveOn: '2026-10-30T00:00:00.000Z',
          },
        }),
      ),
    ).toMatchObject({
      kind: 'ENVELOPE_FUNDED',
      amountMinor: 300000n,
      title: { type: 'ENVELOPE', id: ids.envelope },
      details: [],
      link: { type: 'ENVELOPE', id: ids.envelope },
    });
    expect(
      parseAuditRow(
        row({
          entityType: 'envelope-movement',
          newValues: {
            sourceEnvelopeId: ids.envelope,
            sourcePeriodId: ids.entity,
            destinationEnvelopeId: ids.envelope2,
            destinationPeriodId: ids.entity,
            amountMinor: '150000',
            effectiveOn: '2026-10-30T00:00:00.000Z',
          },
        }),
      ),
    ).toMatchObject({
      kind: 'ENVELOPE_MOVED',
      amountMinor: 150000n,
      title: null,
      details: [
        { type: 'ENVELOPE', id: ids.envelope },
        { type: 'ENVELOPE', id: ids.envelope2 },
      ],
      link: { type: 'ENVELOPE', id: ids.envelope2 },
    });
  });

  it('plan paid has no amount and resolves its title through the occurrence', () => {
    expect(
      parseAuditRow(
        row({
          entityType: 'plan_occurrence',
          action: 'COMPLETED',
          oldValues: { status: 'DUE' },
          newValues: { status: 'COMPLETED' },
        }),
      ),
    ).toMatchObject({
      kind: 'PLAN_PAID',
      amountMinor: null,
      title: { type: 'OCCURRENCE', id: ids.entity },
      link: { type: 'PLAN_OCCURRENCE', id: ids.entity },
    });
  });

  it('plan created keeps the planned amount', () => {
    expect(
      parseAuditRow(
        row({
          entityType: 'regular_plan',
          newValues: { name: 'Интернет', planType: 'EXPENSE', amountMinor: '70000' },
        }),
      ),
    ).toMatchObject({
      kind: 'PLAN_CREATED',
      amountMinor: 70000n,
      title: { type: 'PLAN', id: ids.entity },
      link: { type: 'PLAN', id: ids.entity },
    });
  });

  it('calendar event: all-day date or timed instant, title from the event row', () => {
    expect(
      parseAuditRow(
        row({
          entityType: 'calendar_event',
          newValues: { allDay: true, startsOn: '2026-11-05T00:00:00.000Z', startsAt: null },
        }),
      ),
    ).toMatchObject({
      kind: 'CALENDAR_EVENT_CREATED',
      title: { type: 'CALENDAR_EVENT', id: ids.entity },
      link: { type: 'CALENDAR_EVENT', id: ids.entity },
      eventStart: { date: '2026-11-05' },
    });
    expect(
      parseAuditRow(
        row({
          entityType: 'calendar_event',
          action: 'DELETED',
          oldValues: { allDay: false, startsOn: null, startsAt: '2026-11-05T14:00:00.000Z' },
        }),
      ),
    ).toMatchObject({
      kind: 'CALENDAR_EVENT_DELETED',
      eventStart: { instant: '2026-11-05T14:00:00.000Z' },
    });
  });

  it('family membership events carry no amount; removal names the membership', () => {
    expect(
      parseAuditRow(row({ entityType: 'workspace_invitation', action: 'ACCEPTED' })),
    ).toMatchObject({ kind: 'MEMBER_JOINED', amountMinor: null, link: null, title: null });
    expect(
      parseAuditRow(row({ entityType: 'workspace_membership', action: 'LEFT' })),
    ).toMatchObject({ kind: 'MEMBER_LEFT', link: null });
    expect(
      parseAuditRow(row({ entityType: 'workspace_membership', action: 'REMOVED' })),
    ).toMatchObject({ kind: 'MEMBER_REMOVED', targetMembershipId: ids.entity });
  });

  it('returns null for unknown pairs and for incomplete or legacy payloads', () => {
    expect(parseAuditRow(row({ entityType: 'auth', action: 'LOGIN' }))).toBeNull();
    expect(parseAuditRow(row({ newValues: null }))).toBeNull();
    expect(parseAuditRow(row({ newValues: { ...transactionValues, amountMinor: 12 } }))).toBeNull();
    expect(
      parseAuditRow(row({ newValues: { ...transactionValues, amountMinor: '-5' } })),
    ).toBeNull();
    expect(
      parseAuditRow(row({ newValues: { ...transactionValues, transactionType: 'TRANSFER' } })),
    ).toBeNull();
    expect(parseAuditRow(row({ newValues: { ...transactionValues, accountId: 'x' } }))).toBeNull();
    expect(parseAuditRow(row({ entityId: null, newValues: transactionValues }))).toBeNull();
    expect(
      parseAuditRow(row({ entityType: 'transfer', newValues: { totalMinor: '100' } })),
    ).toBeNull();
    expect(
      parseAuditRow(row({ entityType: 'workspace_membership', action: 'REMOVED', entityId: null })),
    ).toBeNull();
  });
});
