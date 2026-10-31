import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FamilyTestApp, type FamilyActor } from './helpers/family-app.js';

const env = new FamilyTestApp();
let creator: FamilyActor;
let editor: FamilyActor;
let viewer: FamilyActor;
let stranger: FamilyActor;

const base = (actor: FamilyActor) => `/api/v2/budgets/${actor.budgetId}/calendar/events`;

const weekly = (participantUserIds: string[] = []) => ({
  title: 'Кружок рисования',
  allDay: false,
  date: '2026-11-03',
  startTime: '17:00',
  endTime: '18:30',
  recurrence: 'WEEKLY',
  weekdays: [2],
  participantUserIds,
  reminderMinutes: 60,
});

beforeAll(async () => {
  await env.start();
  creator = await env.register();
  editor = await env.join(creator, await env.register(), 'EDITOR');
  viewer = await env.join(creator, await env.register(), 'VIEWER');
  stranger = await env.register();
});

afterAll(async () => {
  // Calendar events are removed by FamilyTestApp.cleanup().
  await env.stop();
});

async function create(actor: FamilyActor, body: Record<string, unknown> = weekly()) {
  const response = await env.inject('POST', base(actor), actor, body);
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ id: string; canEdit: boolean }>();
}

function keyed(actor: FamilyActor, key: string | null, payload: Record<string, unknown>) {
  return env.server.inject({
    method: 'POST',
    url: base(actor),
    headers: {
      origin: 'http://localhost:3000',
      'x-csrf-token': actor.csrfToken,
      ...(key ? { 'idempotency-key': key } : {}),
    },
    cookies: { harmofin_session: actor.cookie },
    payload,
  });
}

function keyedAt(
  method: 'PATCH' | 'DELETE',
  actor: FamilyActor,
  eventId: string,
  key: string,
  payload?: Record<string, unknown>,
) {
  return env.server.inject({
    method,
    url: `${base(actor)}/${eventId}`,
    headers: {
      origin: 'http://localhost:3000',
      'x-csrf-token': actor.csrfToken,
      'idempotency-key': key,
    },
    cookies: { harmofin_session: actor.cookie },
    ...(payload ? { payload } : {}),
  });
}

describe('calendar events: create and read', () => {
  it('a member creates an event; it comes back in local time with people refs', async () => {
    const created = await create(editor, weekly([creator.user.id]));
    const response = await env.inject('GET', `${base(editor)}/${created.id}`, editor);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      title: 'Кружок рисования',
      allDay: false,
      date: '2026-11-03',
      startTime: '17:00',
      endTime: '18:30',
      recurrence: 'WEEKLY',
      weekdays: [2],
      reminderMinutes: 60,
      createdBy: { userId: editor.user.id, isActiveMember: true },
      participants: [{ userId: creator.user.id, isActiveMember: true }],
      canEdit: true,
    });
  });

  it('a viewer reads the event but cannot edit it', async () => {
    const created = await create(editor);
    const response = await env.inject('GET', `${base(viewer)}/${created.id}`, viewer);
    expect(response.json()).toMatchObject({ canEdit: false });
  });

  it('a viewer cannot create: 403 FORBIDDEN', async () => {
    const response = await env.inject('POST', base(viewer), viewer, weekly());
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('records an audit event without the description', async () => {
    const created = await create(editor, { ...weekly(), description: 'Взять альбом' });
    const audit = await env.prisma.auditEvent.findFirst({
      where: { entityType: 'calendar_event', entityId: created.id, action: 'CREATED' },
    });
    expect(audit).toMatchObject({ actorUserId: editor.user.id, budgetId: editor.budgetId });
    expect(JSON.stringify(audit?.newValues)).not.toContain('альбом');
  });
});

describe('calendar events: isolation', () => {
  it('another family gets 404 for the budget and for the event', async () => {
    const created = await create(editor);
    const foreignBudget = await env.inject('GET', `${base(creator)}/${created.id}`, stranger);
    expect(foreignBudget.statusCode).toBe(404);
    const ownBudget = await env.inject('GET', `${base(stranger)}/${created.id}`, stranger);
    expect(ownBudget.statusCode).toBe(404);
  });

  it('a participant must be an active member of this family: 422', async () => {
    const response = await env.inject('POST', base(editor), editor, weekly([stranger.user.id]));
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ code: 'PARTICIPANT_NOT_MEMBER' });
  });
});

describe('calendar events: only the author edits', () => {
  it('the author updates the whole series', async () => {
    const created = await create(editor);
    const response = await env.inject('PATCH', `${base(editor)}/${created.id}`, editor, {
      ...weekly(),
      title: 'Кружок лепки',
      weekdays: [2, 4],
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({ title: 'Кружок лепки', weekdays: [2, 4] });
  });

  it('the family creator gets 403 NOT_EVENT_AUTHOR on a member event', async () => {
    const created = await create(editor);
    const patch = await env.inject('PATCH', `${base(creator)}/${created.id}`, creator, weekly());
    expect(patch.statusCode).toBe(403);
    expect(patch.json()).toMatchObject({ code: 'NOT_EVENT_AUTHOR' });
    const remove = await env.inject('DELETE', `${base(creator)}/${created.id}`, creator);
    expect(remove.statusCode).toBe(403);
    expect(remove.json()).toMatchObject({ code: 'NOT_EVENT_AUTHOR' });
  });

  it('a viewer gets 403 FORBIDDEN before the author check', async () => {
    const created = await create(editor);
    const response = await env.inject('DELETE', `${base(viewer)}/${created.id}`, viewer);
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('delete is logical and hides the event', async () => {
    const created = await create(editor);
    const removed = await env.inject('DELETE', `${base(editor)}/${created.id}`, editor);
    expect(removed.statusCode).toBe(204);
    const row = await env.prisma.calendarEvent.findUnique({ where: { id: created.id } });
    expect(row?.deletedAt).not.toBeNull();
    expect((await env.inject('GET', `${base(editor)}/${created.id}`, editor)).statusCode).toBe(404);
    expect((await env.inject('DELETE', `${base(editor)}/${created.id}`, editor)).statusCode).toBe(
      404,
    );
  });
});

describe('calendar events: former member', () => {
  it('their events stay visible and nobody can edit them', async () => {
    const leaving = await env.join(creator, await env.register(), 'EDITOR');
    const created = await create(leaving, weekly([editor.user.id]));
    await env.prisma.workspaceMembership.updateMany({
      where: { workspaceId: creator.workspaceId, userId: leaving.user.id },
      data: { isActive: false },
    });
    const read = await env.inject('GET', `${base(creator)}/${created.id}`, creator);
    expect(read.json()).toMatchObject({
      createdBy: { userId: leaving.user.id, isActiveMember: false },
      canEdit: false,
    });
    const own = await env.inject('PATCH', `${base(leaving)}/${created.id}`, leaving, weekly());
    // Stage-B mutations: requireModel rejects a former member before the transaction (404).
    expect(own.statusCode).toBe(404);
    expect(own.json()).toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });
});

describe('calendar events: validation and idempotency', () => {
  it('returns field errors', async () => {
    const response = await env.inject('POST', base(editor), editor, {
      ...weekly(),
      endTime: '16:30',
      weekdays: [],
    });
    expect(response.statusCode).toBe(400);
    const fields = response
      .json<{ fieldErrors: Array<{ field: string }> }>()
      .fieldErrors.map((item) => item.field);
    expect(fields).toEqual(expect.arrayContaining(['endTime', 'weekdays']));
  });

  it('replays the same key and refuses the same key with another body', async () => {
    const key = `calendar-${randomUUID()}`;
    const first = await keyed(editor, key, weekly());
    const second = await keyed(editor, key, weekly());
    expect(second.json<{ id: string }>().id).toBe(first.json<{ id: string }>().id);
    const conflict = await keyed(editor, key, { ...weekly(), title: 'Другое' });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('requires the Idempotency-Key header', async () => {
    expect((await keyed(editor, null, weekly())).statusCode).toBe(400);
  });
});

describe('calendar events: PATCH and DELETE idempotency and audit', () => {
  it('replays PATCH with the same key and refuses another body', async () => {
    const created = await create(editor);
    const key = `calendar-${randomUUID()}`;
    const body = { ...weekly(), title: 'Кружок лепки' };
    const first = await keyedAt('PATCH', editor, created.id, key, body);
    expect(first.statusCode, first.body).toBe(200);
    const second = await keyedAt('PATCH', editor, created.id, key, body);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual(first.json());
    const conflict = await keyedAt('PATCH', editor, created.id, key, {
      ...body,
      title: 'Другое',
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('replays DELETE with the same key: 204, still deleted, one audit row', async () => {
    const created = await create(editor);
    const key = `calendar-${randomUUID()}`;
    expect((await keyedAt('DELETE', editor, created.id, key)).statusCode).toBe(204);
    expect((await keyedAt('DELETE', editor, created.id, key)).statusCode).toBe(204);
    const row = await env.prisma.calendarEvent.findUnique({ where: { id: created.id } });
    expect(row?.deletedAt).not.toBeNull();
    const deletions = await env.prisma.auditEvent.count({
      where: { entityType: 'calendar_event', entityId: created.id, action: 'DELETED' },
    });
    expect(deletions).toBe(1);
  });

  it('audits UPDATED and DELETED without title or description', async () => {
    const created = await create(editor, { ...weekly(), description: 'Взять альбом' });
    const updated = await env.inject('PATCH', `${base(editor)}/${created.id}`, editor, {
      ...weekly(),
      title: 'Кружок лепки',
      description: 'Взять пластилин',
    });
    expect(updated.statusCode, updated.body).toBe(200);
    expect((await env.inject('DELETE', `${base(editor)}/${created.id}`, editor)).statusCode).toBe(
      204,
    );
    const rows = await env.prisma.auditEvent.findMany({
      where: { entityType: 'calendar_event', entityId: created.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    expect(rows.map((row) => row.action)).toEqual(['CREATED', 'UPDATED', 'DELETED']);
    for (const row of rows) {
      expect(row).toMatchObject({ actorUserId: editor.user.id, budgetId: editor.budgetId });
      const payload = JSON.stringify([row.oldValues, row.newValues]);
      for (const text of ['Кружок', 'лепки', 'рисования', 'альбом', 'пластилин']) {
        expect(payload).not.toContain(text);
      }
    }
  });
});
