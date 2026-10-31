import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FamilyTestApp, type FamilyActor } from './helpers/family-app.js';

const env = new FamilyTestApp();
let creator: FamilyActor;
let editor: FamilyActor;

const events = (actor: FamilyActor) => `/api/v2/budgets/${actor.budgetId}/calendar/events`;
const feed = (actor: FamilyActor, query: string) =>
  `/api/v2/budgets/${actor.budgetId}/calendar?${query}`;

type FeedBody = { items: Array<Record<string, unknown> & { kind: string; title: string }> };

async function createObligation(
  actor: FamilyActor,
  name: string,
  amount: string,
  scheduledOn: string,
): Promise<void> {
  // Obligation plans bind to an active MANDATORY envelope, as in family-plans-ownership.
  const mandatory = await env.prisma.envelope.findFirst({
    where: { budgetId: actor.budgetId, envelopeType: 'MANDATORY_EXPENSES', archivedAt: null },
    select: { id: true },
  });
  if (!mandatory) {
    await env.prisma.envelope.create({
      data: {
        id: randomUUID(),
        budgetId: actor.budgetId,
        ownerUserId: actor.user.id,
        name: 'Обязательные',
        envelopeType: 'MANDATORY_EXPENSES',
        startingBalanceMinor: 0n,
        displayOrder: 1,
      },
    });
  }
  const response = await env.inject(
    'POST',
    `/api/v2/budgets/${actor.budgetId}/obligations/plans`,
    actor,
    {
      name,
      amount,
      scheduledOn,
      categoryId: await env.categoryId(actor.budgetId, 'EXPENSE'),
      recurrence: 'ONE_TIME',
    },
  );
  expect(response.statusCode, response.body).toBe(201);
}

const sortedById = <T>(rows: T[], id: (row: T) => string): T[] =>
  [...rows].sort((left, right) => id(left).localeCompare(id(right)));

beforeAll(async () => {
  await env.start();
  creator = await env.register();
  editor = await env.join(creator, await env.register(), 'EDITOR');
  await env.prisma.budget.update({
    where: { id: creator.budgetId },
    data: { timezone: 'Europe/Moscow' },
  });
  const weekly = await env.inject('POST', events(editor), editor, {
    title: 'Кружок',
    allDay: false,
    date: '2026-11-03',
    startTime: '17:00',
    endTime: '18:30',
    recurrence: 'WEEKLY',
    weekdays: [2],
    participantUserIds: [creator.user.id],
  });
  expect(weekly.statusCode, weekly.body).toBe(201);
  const birthday = await env.inject('POST', events(creator), creator, {
    title: 'День рождения',
    allDay: true,
    date: '2026-11-10',
    recurrence: 'NONE',
    participantUserIds: [],
  });
  expect(birthday.statusCode, birthday.body).toBe(201);
});

afterAll(async () => {
  await env.stop();
});

describe('calendar feed', () => {
  it('expands occurrences in order with local and UTC times', async () => {
    const response = await env.inject(
      'GET',
      feed(creator, 'from=2026-11-01&to=2026-11-14&includePlans=false'),
      creator,
    );
    expect(response.statusCode, response.body).toBe(200);
    const items = response.json<FeedBody>().items;
    expect(items.map((item) => [item.title, item.occurrenceDate])).toEqual([
      ['Кружок', '2026-11-03'],
      ['День рождения', '2026-11-10'],
      ['Кружок', '2026-11-10'],
    ]);
    expect(items[0]).toMatchObject({
      kind: 'EVENT',
      startTime: '17:00',
      endTime: '18:30',
      startsAt: '2026-11-03T14:00:00.000Z',
      canEdit: false,
      createdBy: { userId: editor.user.id },
      participants: [{ userId: creator.user.id }],
    });
  });

  it('"mine" keeps events I created or take part in', async () => {
    const editorMine = await env.inject(
      'GET',
      feed(
        editor,
        `from=2026-11-01&to=2026-11-14&includePlans=false&participantUserId=${editor.user.id}`,
      ),
      editor,
    );
    expect(editorMine.json<FeedBody>().items.map((item) => item.title)).toEqual([
      'Кружок',
      'Кружок',
    ]);
    const creatorMine = await env.inject(
      'GET',
      feed(
        creator,
        `from=2026-11-01&to=2026-11-14&includePlans=false&participantUserId=${creator.user.id}`,
      ),
      creator,
    );
    expect(creatorMine.json<FeedBody>().items).toHaveLength(3);
  });

  it('rejects a range longer than 62 days', async () => {
    const response = await env.inject(
      'GET',
      feed(creator, 'from=2026-01-01&to=2026-03-04'),
      creator,
    );
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('plan items repeat the plans calendar of the same month', async () => {
    await createObligation(creator, 'Аренда', '45000.00', '2026-11-15');

    const calendarFeed = await env.inject(
      'GET',
      feed(creator, 'from=2026-11-01&to=2026-11-30'),
      creator,
    );
    expect(calendarFeed.statusCode, calendarFeed.body).toBe(200);
    const planItems = calendarFeed.json<FeedBody>().items.filter((item) => item.kind === 'PLAN');
    const plans = await env.inject(
      'GET',
      `/api/v2/budgets/${creator.budgetId}/plans/calendar?month=2026-11`,
      creator,
    );
    const expected = plans
      .json<{
        items: Array<{
          occurrenceId: string;
          expectedMinor: string;
          status: string;
          overdue: boolean;
        }>;
      }>()
      .items.filter((item) => item.status !== 'CANCELLED' && item.status !== 'SKIPPED');
    expect(planItems.length).toBeGreaterThan(0);
    expect(
      sortedById(planItems, (item) => String(item.occurrenceId)).map((item) => [
        item.occurrenceId,
        item.amountMinor,
        item.status,
        item.isOverdue,
      ]),
    ).toEqual(
      sortedById(expected, (item) => item.occurrenceId).map((item) => [
        item.occurrenceId,
        item.expectedMinor,
        item.status,
        item.overdue,
      ]),
    );
    expect(planItems.find((item) => item.title === 'Аренда')).toMatchObject({
      amountMinor: '4500000',
      planKind: 'OBLIGATION',
    });

    const hidden = await env.inject(
      'GET',
      feed(creator, 'from=2026-11-01&to=2026-11-30&includePlans=false'),
      creator,
    );
    expect(hidden.json<FeedBody>().items.some((item) => item.kind === 'PLAN')).toBe(false);
  });

  it('includes a weekly series that started a month before the window', async () => {
    const created = await env.inject('POST', events(creator), creator, {
      title: 'Бассейн',
      allDay: false,
      date: '2026-10-01',
      startTime: '08:00',
      endTime: '09:00',
      recurrence: 'WEEKLY',
      weekdays: [4],
      repeatUntil: null,
      participantUserIds: [],
    });
    expect(created.statusCode, created.body).toBe(201);
    const response = await env.inject(
      'GET',
      feed(creator, 'from=2026-11-01&to=2026-11-14&includePlans=false'),
      creator,
    );
    expect(response.statusCode, response.body).toBe(200);
    const pool = response
      .json<FeedBody>()
      .items.filter((item) => item.title === 'Бассейн')
      .map((item) => [item.occurrenceDate, item.startsAt]);
    expect(pool).toEqual([
      ['2026-11-05', '2026-11-05T05:00:00.000Z'],
      ['2026-11-12', '2026-11-12T05:00:00.000Z'],
    ]);
  });

  it('drops an event deleted through the API', async () => {
    const created = await env.inject('POST', events(creator), creator, {
      title: 'Удаляемое',
      allDay: true,
      date: '2026-11-07',
      recurrence: 'NONE',
      participantUserIds: [],
    });
    expect(created.statusCode, created.body).toBe(201);
    const { id } = created.json<{ id: string }>();
    const titles = async () =>
      (
        await env.inject(
          'GET',
          feed(creator, 'from=2026-11-01&to=2026-11-14&includePlans=false'),
          creator,
        )
      )
        .json<FeedBody>()
        .items.map((item) => item.title);
    expect(await titles()).toContain('Удаляемое');

    // env.inject sends a fresh Idempotency-Key and the CSRF token on non-GET requests.
    const removed = await env.inject('DELETE', `${events(creator)}/${id}`, creator);
    expect(removed.statusCode, removed.body).toBe(204);
    expect(await titles()).not.toContain('Удаляемое');
  });
});
