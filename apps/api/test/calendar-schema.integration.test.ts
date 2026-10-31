import { Prisma } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createUuidV7 } from '../src/common/identifiers/uuid-v7.js';
import { FamilyTestApp, type FamilyActor } from './helpers/family-app.js';

const env = new FamilyTestApp();
let creator: FamilyActor;

beforeAll(async () => {
  await env.start();
  creator = await env.register();
});

afterAll(async () => {
  await env.stop();
});

function base(overrides: Partial<Prisma.CalendarEventUncheckedCreateInput> = {}) {
  return {
    id: createUuidV7(),
    workspaceId: creator.workspaceId,
    budgetId: creator.budgetId,
    createdByUserId: creator.user.id,
    title: 'Кружок',
    allDay: true,
    startsOn: new Date('2026-11-03T00:00:00Z'),
    endsOn: new Date('2026-11-03T00:00:00Z'),
    ...overrides,
  } satisfies Prisma.CalendarEventUncheckedCreateInput;
}

async function rejects(data: Prisma.CalendarEventUncheckedCreateInput): Promise<void> {
  // The Prisma Client query engine (unlike $executeRawUnsafe) does not surface the
  // PostgreSQL SQLSTATE in `.meta.code` for this error class; it is only present in
  // `.message`. See apps/api/test/family-ownership-schema.integration.test.ts for the
  // `.meta.code` form used with raw queries.
  await expect(env.prisma.calendarEvent.create({ data })).rejects.toMatchObject({
    message: expect.stringContaining('code: "23514"'),
  });
}

describe('calendar_events constraints', () => {
  it('stores an all-day event and a timed weekly event', async () => {
    await env.prisma.calendarEvent.create({ data: base() });
    await env.prisma.calendarEvent.create({
      data: base({
        allDay: false,
        startsOn: null,
        endsOn: null,
        startsAt: new Date('2026-11-03T14:00:00Z'),
        endsAt: new Date('2026-11-03T15:30:00Z'),
        recurrence: 'WEEKLY',
        weekdays: [2],
        reminderMinutes: 60,
      }),
    });
  });

  it('rejects mixing day and time fields', async () => {
    await rejects(base({ startsAt: new Date('2026-11-03T14:00:00Z') }));
  });

  it('rejects an end before the start', async () => {
    await rejects(base({ endsOn: new Date('2026-11-02T00:00:00Z') }));
  });

  it('rejects weekdays outside WEEKLY and an empty WEEKLY', async () => {
    await rejects(base({ recurrence: 'DAILY', weekdays: [1] }));
    await rejects(base({ recurrence: 'WEEKLY', weekdays: [] }));
    await rejects(base({ recurrence: 'WEEKLY', weekdays: [8] }));
  });

  it('rejects an unsupported reminder and an interval out of range', async () => {
    await rejects(base({ reminderMinutes: 30 }));
    await rejects(base({ recurrence: 'DAILY', interval: 0 }));
  });

  it('rejects repeatUntil on a non-repeating event and a blank title', async () => {
    await rejects(base({ repeatUntil: new Date('2026-12-01T00:00:00Z') }));
    await rejects(base({ title: '   ' }));
  });

  it('allows an all-day span of exactly 30 days and rejects 31', async () => {
    await env.prisma.calendarEvent.create({
      data: base({ endsOn: new Date('2026-12-03T00:00:00Z') }),
    });
    await rejects(base({ endsOn: new Date('2026-12-04T00:00:00Z') }));
  });

  it('rejects a timed event longer than 24 hours', async () => {
    await rejects(
      base({
        allDay: false,
        startsOn: null,
        endsOn: null,
        startsAt: new Date('2026-11-03T14:00:00Z'),
        endsAt: new Date('2026-11-04T14:01:00Z'),
      }),
    );
  });
});
