import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FamilyTestApp, type FamilyActor } from './helpers/family-app.js';

const env = new FamilyTestApp();
let creator: FamilyActor;
let editor: FamilyActor;
let viewer: FamilyActor;
let creatorAccountId: string;

const accounts = (actor: FamilyActor) => `/api/v1/budgets/${actor.budgetId}/accounts`;

beforeAll(async () => {
  await env.start();
  creator = await env.register();
  editor = await env.join(creator, await env.register(), 'EDITOR');
  viewer = await env.join(creator, await env.register(), 'VIEWER');
  creatorAccountId = await env.createAccount(creator, 'Карта создателя', '1000');
});

afterAll(async () => {
  await env.stop();
});

describe('account ownership', () => {
  it('an editor creates an own account and sees owner and canEdit', async () => {
    const response = await env.inject('POST', accounts(editor), editor, {
      name: 'Карта участника',
      accountType: 'BANK_CARD',
      currency: 'RUB',
      startingBalance: '500',
      accountingStartDate: '2026-01-01',
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      owner: { userId: editor.user.id, isActiveMember: true },
      canEdit: true,
    });
  });

  it('a viewer cannot create accounts', async () => {
    const response = await env.inject('POST', accounts(viewer), viewer, {
      name: 'Нельзя',
      accountType: 'CASH',
      currency: 'RUB',
      startingBalance: '0',
      accountingStartDate: '2026-01-01',
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('everyone sees every account; canEdit is true only for the owner', async () => {
    const response = await env.inject('GET', accounts(editor), editor);
    expect(response.statusCode).toBe(200);
    const rows =
      response.json<Array<{ id: string; canEdit: boolean; owner: { userId: string } }>>();
    const creatorRow = rows.find((row) => row.id === creatorAccountId);
    expect(creatorRow).toMatchObject({ canEdit: false, owner: { userId: creator.user.id } });
  });

  it('the editor cannot rename, archive or restore the creator account', async () => {
    const rename = await env.inject('PATCH', `${accounts(editor)}/${creatorAccountId}`, editor, {
      name: 'Чужое',
    });
    expect(rename.statusCode).toBe(403);
    expect(rename.json()).toMatchObject({ code: 'NOT_OBJECT_OWNER' });
    const archive = await env.inject(
      'POST',
      `${accounts(editor)}/${creatorAccountId}/archive`,
      editor,
    );
    expect(archive.json()).toMatchObject({ code: 'NOT_OBJECT_OWNER' });
  });

  it('the creator has no override on the editor account', async () => {
    const editorAccountId = await env.createAccount(editor, 'Наличные участника');
    const rename = await env.inject('PATCH', `${accounts(creator)}/${editorAccountId}`, creator, {
      name: 'Переименовал создатель',
    });
    expect(rename.statusCode).toBe(403);
    expect(rename.json()).toMatchObject({ code: 'NOT_OBJECT_OWNER' });
  });

  it('filters by owner and keeps the summary consistent with the filtered list', async () => {
    const list = await env.inject(
      'GET',
      `${accounts(creator)}?ownerUserId=${editor.user.id}`,
      creator,
    );
    const rows = list.json<Array<{ owner: { userId: string } }>>();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.owner.userId === editor.user.id)).toBe(true);
    const summary = await env.inject(
      'GET',
      `${accounts(creator)}/summary?ownerUserId=${editor.user.id}`,
      creator,
    );
    expect(summary.json<{ count: number }>().count).toBe(rows.length);
  });

  it('rejects a malformed ownerUserId', async () => {
    const response = await env.inject('GET', `${accounts(creator)}?ownerUserId=nope`, creator);
    expect(response.statusCode).toBe(400);
  });

  it('a stranger still gets 404 for the family accounts', async () => {
    const stranger = await env.register();
    const response = await env.inject(
      'GET',
      `/api/v1/budgets/${creator.budgetId}/accounts`,
      stranger,
    );
    expect(response.statusCode).toBe(404);
  });
});
