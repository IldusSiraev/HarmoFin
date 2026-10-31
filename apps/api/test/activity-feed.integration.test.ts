import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createUuidV7 } from '../src/common/identifiers/uuid-v7.js';
import { FamilyTestApp, type FamilyActor } from './helpers/family-app.js';

type Person = { userId: string; displayName: string | null; isActiveMember: boolean };
type Item = {
  id: string;
  occurredAt: string;
  kind: string;
  isNew: boolean;
  actor: Person;
  amountMinor: string | null;
  currency: string;
  transactionType: string | null;
  title: string | null;
  details: string[];
  target: Person | null;
  link: { type: string; id: string; date: string | null } | null;
};
type Feed = {
  seenAt: string | null;
  newSince: string;
  unseenCount: number;
  people: Person[];
  items: Item[];
  nextCursor: string | null;
};

const env = new FamilyTestApp();
const MINUTE = 60_000;
const DAY = 86_400_000;

beforeAll(async () => {
  await env.start();
});

afterAll(async () => {
  await env.stop();
});

async function family() {
  const creator = await env.register();
  const editor = await env.join(creator, await env.register(), 'EDITOR');
  const viewer = await env.join(creator, await env.register(), 'VIEWER');
  return { creator, editor, viewer };
}

const feedUrl = (actor: FamilyActor, query = '') =>
  `/api/v2/budgets/${actor.budgetId}/activity${query}`;

async function feed(actor: FamilyActor, query = ''): Promise<Feed> {
  const response = await env.inject('GET', feedUrl(actor, query), actor);
  expect(response.statusCode, response.body).toBe(200);
  return response.json<Feed>();
}

const markSeen = (actor: FamilyActor) =>
  env.inject('POST', `/api/v2/budgets/${actor.budgetId}/activity/seen`, actor);

/** A calendar audit row written directly, for window and paging cases. */
async function auditRow(
  actor: FamilyActor,
  createdAt: Date,
  overrides: { actorUserId?: string | null; entityType?: string; action?: string } = {},
): Promise<string> {
  const id = createUuidV7(createdAt);
  await env.prisma.auditEvent.create({
    data: {
      id,
      actorUserId: overrides.actorUserId === undefined ? actor.user.id : overrides.actorUserId,
      workspaceId: actor.workspaceId,
      budgetId: actor.budgetId,
      entityType: overrides.entityType ?? 'calendar_event',
      entityId: randomUUID(),
      action: overrides.action ?? 'CREATED',
      newValues: { allDay: true, startsOn: '2026-11-05T00:00:00.000Z', startsAt: null },
      source: 'test',
      createdAt,
    },
  });
  return id;
}

describe('activity feed: content', () => {
  it('shows what other members did, never own actions, with labels from the budget', async () => {
    const { creator, editor } = await family();
    const accountId = await env.createAccount(editor, 'Карта Алии', '5000.00');
    const expenseId = await env.record(editor, {
      type: 'EXPENSE',
      accountId,
      amount: '1200.00',
    });
    const ownAccount = await env.createAccount(creator, 'Наличные', '100.00');
    await env.record(creator, { type: 'EXPENSE', accountId: ownAccount, amount: '10.00' });
    const category = await env.prisma.transaction.findUniqueOrThrow({
      where: { id: expenseId },
      select: { category: { select: { name: true } } },
    });

    const response = await env.inject('GET', feedUrl(creator), creator);
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toMatch(/oldValues|newValues|requestId/);
    const body = response.json<Feed>();
    expect(body.items.every((item) => item.actor.userId !== creator.user.id)).toBe(true);
    expect(body.items.map((item) => item.kind)).toEqual(['TRANSACTION_CREATED']);
    expect(body.items[0]).toMatchObject({
      isNew: true,
      actor: { userId: editor.user.id, isActiveMember: true },
      amountMinor: '120000',
      currency: 'RUB',
      transactionType: 'EXPENSE',
      title: category.category.name,
      details: ['Карта Алии'],
      target: null,
      link: { type: 'TRANSACTION', id: expenseId, date: null },
    });
    expect(body.people.some((person) => person.userId === editor.user.id)).toBe(true);
    expect(body.people.some((person) => person.userId === creator.user.id)).toBe(false);
  });

  it('takes the calendar title from the event row and drops the link once deleted', async () => {
    const { creator, editor } = await family();
    const created = await env.inject(
      'POST',
      `/api/v2/budgets/${editor.budgetId}/calendar/events`,
      editor,
      { title: 'Родительское собрание', allDay: true, date: '2026-11-05', recurrence: 'NONE' },
    );
    expect(created.statusCode, created.body).toBe(201);
    const eventId = created.json<{ id: string }>().id;

    expect((await feed(creator)).items[0]).toMatchObject({
      kind: 'CALENDAR_EVENT_CREATED',
      title: 'Родительское собрание',
      amountMinor: null,
      link: { type: 'CALENDAR_EVENT', id: eventId, date: '2026-11-05' },
    });

    const deleted = await env.inject(
      'DELETE',
      `/api/v2/budgets/${editor.budgetId}/calendar/events/${eventId}`,
      editor,
    );
    expect(deleted.statusCode, deleted.body).toBe(204);
    const items = (await feed(creator)).items;
    expect(items.map((item) => item.kind)).toEqual([
      'CALENDAR_EVENT_DELETED',
      'CALENDAR_EVENT_CREATED',
    ]);
    expect(items.every((item) => item.title === 'Родительское собрание')).toBe(true);
    expect(items.every((item) => item.link === null)).toBe(true);
  });

  it('falls back to neutral labels when referenced objects are missing', async () => {
    const { creator, editor } = await family();
    await env.prisma.auditEvent.create({
      data: {
        id: createUuidV7(),
        actorUserId: editor.user.id,
        workspaceId: editor.workspaceId,
        budgetId: editor.budgetId,
        entityType: 'transaction',
        entityId: randomUUID(),
        action: 'CREATED',
        newValues: {
          transactionType: 'EXPENSE',
          amountMinor: '4500',
          accountId: randomUUID(),
          categoryId: randomUUID(),
          envelopeId: null,
        },
        source: 'test',
      },
    });
    expect((await feed(creator)).items[0]).toMatchObject({
      title: 'без категории',
      details: ['удалённый счёт'],
      link: null,
    });
  });

  it('labels a former member and names the removed person', async () => {
    const { creator, editor, viewer } = await family();
    const accountId = await env.createAccount(editor, 'Карта', '1000.00');
    await env.record(editor, { type: 'EXPENSE', accountId, amount: '300.00' });
    const membership = await env.prisma.workspaceMembership.update({
      where: { workspaceId_userId: { workspaceId: creator.workspaceId, userId: editor.user.id } },
      data: { isActive: false, removedAt: new Date() },
      select: { id: true },
    });
    await env.prisma.auditEvent.create({
      data: {
        id: createUuidV7(),
        actorUserId: creator.user.id,
        workspaceId: creator.workspaceId,
        budgetId: creator.budgetId,
        entityType: 'workspace_membership',
        entityId: membership.id,
        action: 'REMOVED',
        source: 'test',
      },
    });

    const items = (await feed(viewer)).items;
    expect(items[0]).toMatchObject({
      kind: 'MEMBER_REMOVED',
      actor: { userId: creator.user.id },
      target: { userId: editor.user.id, isActiveMember: false },
    });
    expect(items[1]).toMatchObject({
      kind: 'TRANSACTION_CREATED',
      actor: { userId: editor.user.id, isActiveMember: false },
    });
  });
});

describe('activity feed: window and marker', () => {
  it('counts the last 7 days without a marker, then only what came after it', async () => {
    const { creator, editor } = await family();
    const now = Date.now();
    const old = await auditRow(editor, new Date(now - 10 * DAY));
    const recent = await auditRow(editor, new Date(now - 3 * DAY));

    const first = await feed(creator);
    expect(first.seenAt).toBeNull();
    expect(Date.parse(first.newSince)).toBeLessThan(now - 7 * DAY + MINUTE);
    expect(Date.parse(first.newSince)).toBeGreaterThan(now - 7 * DAY - MINUTE);
    expect(first.unseenCount).toBe(1);
    expect(first.items.map((item) => [item.id, item.isNew])).toEqual([
      [recent, true],
      [old, false],
    ]);

    const seen = await markSeen(creator);
    expect(seen.statusCode, seen.body).toBe(200);
    const seenAt = seen.json<{ seenAt: string }>().seenAt;
    const after = await feed(creator);
    expect(after.seenAt).toBe(seenAt);
    expect(after.newSince).toBe(seenAt);
    expect(after.unseenCount).toBe(0);
    expect(after.items.every((item) => !item.isNew)).toBe(true);

    const fresh = await auditRow(editor, new Date(Date.parse(seenAt) + MINUTE));
    const next = await feed(creator);
    expect(next.unseenCount).toBe(1);
    expect(next.items[0]).toMatchObject({ id: fresh, isNew: true });
  });

  it('never moves the marker back', async () => {
    const { creator } = await family();
    const future = new Date(Date.now() + 60 * MINUTE);
    await env.prisma.activityFeedCursor.create({
      data: {
        id: createUuidV7(),
        workspaceId: creator.workspaceId,
        budgetId: creator.budgetId,
        userId: creator.user.id,
        seenAt: future,
      },
    });
    const response = await markSeen(creator);
    expect(response.json<{ seenAt: string }>().seenAt).toBe(future.toISOString());
  });

  it('shows 30 days only and hides rows without an author', async () => {
    const { creator, editor } = await family();
    const now = Date.now();
    await auditRow(editor, new Date(now - 31 * DAY));
    await auditRow(editor, new Date(now - MINUTE), { actorUserId: null });
    const kept = await auditRow(editor, new Date(now - 29 * DAY));
    expect((await feed(creator)).items.map((item) => item.id)).toEqual([kept]);
  });

  it('ignores audit pairs outside the whitelist', async () => {
    const { creator, editor } = await family();
    await auditRow(editor, new Date(), { entityType: 'account', action: 'CREATED' });
    await auditRow(editor, new Date(), { entityType: 'auth', action: 'LOGIN' });
    expect((await feed(creator)).items).toEqual([]);
  });

  it('pages by cursor; the actor filter leaves unseenCount alone', async () => {
    const { creator, editor, viewer } = await family();
    const now = Date.now();
    const ids: string[] = [];
    for (let index = 0; index < 35; index += 1) {
      ids.push(await auditRow(editor, new Date(now - (index + 1) * MINUTE)));
    }

    const first = await feed(creator);
    expect(first.items).toHaveLength(30);
    expect(first.nextCursor).not.toBeNull();
    const second = await feed(creator, `?cursor=${encodeURIComponent(first.nextCursor!)}`);
    expect(second.items).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
    expect([...first.items, ...second.items].map((item) => item.id)).toEqual(ids);

    const filtered = await feed(creator, `?actorId=${viewer.user.id}`);
    expect(filtered.items).toEqual([]);
    expect(filtered.unseenCount).toBe(first.unseenCount);
    expect((await feed(creator, '?limit=5')).items).toHaveLength(5);

    const badCursor = await env.inject('GET', feedUrl(creator, '?cursor=garbage'), creator);
    expect(badCursor.statusCode).toBe(400);
    const badLimit = await env.inject('GET', feedUrl(creator, '?limit=31'), creator);
    expect(badLimit.statusCode).toBe(400);
  });
});

describe('activity feed: access', () => {
  it('any member reads and marks; a stranger gets 404 and other budgets never leak', async () => {
    const { creator, viewer } = await family();
    const stranger = await env.register();
    const foreign = await auditRow(stranger, new Date(), { actorUserId: stranger.user.id });

    expect((await env.inject('GET', feedUrl(creator), stranger)).statusCode).toBe(404);
    expect((await markSeen({ ...stranger, budgetId: creator.budgetId })).statusCode).toBe(404);
    expect((await feed(creator)).items.some((item) => item.id === foreign)).toBe(false);

    expect((await feed(viewer)).seenAt).toBeNull();
    expect((await markSeen(viewer)).statusCode).toBe(200);
    expect((await feed(viewer)).seenAt).not.toBeNull();
    expect((await feed(creator)).seenAt).toBeNull();
  });
});
