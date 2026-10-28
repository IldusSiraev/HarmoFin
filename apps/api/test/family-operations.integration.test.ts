import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FamilyTestApp, type FamilyActor } from './helpers/family-app.js';

const env = new FamilyTestApp();
let creator: FamilyActor;
let editor: FamilyActor;
let viewer: FamilyActor;
let creatorAccountId: string;
let editorAccountId: string;
let creatorEnvelopeId: string;

const v2 = (actor: FamilyActor) => `/api/v2/budgets/${actor.budgetId}`;
const today = () => new Date().toISOString().slice(0, 10);

async function familyCash(): Promise<bigint> {
  const response = await env.inject(
    'GET',
    `/api/v1/budgets/${creator.budgetId}/accounts/summary`,
    creator,
  );
  return BigInt(response.json<{ totalMinor: string }>().totalMinor);
}

async function envelopeBalance(envelopeId: string): Promise<bigint> {
  const response = await env.inject('GET', `${v2(creator)}/envelopes/${envelopeId}`, creator);
  return BigInt(response.json<{ balanceMinor: string }>().balanceMinor);
}

beforeAll(async () => {
  await env.start();
  creator = await env.register();
  editor = await env.join(creator, await env.register(), 'EDITOR');
  viewer = await env.join(creator, await env.register(), 'VIEWER');
  creatorAccountId = await env.createAccount(creator, 'Счёт создателя', '10000');
  editorAccountId = await env.createAccount(editor, 'Счёт участника', '10000');
  creatorEnvelopeId = await env.createEnvelope(creator, 'Продукты');
  const funded = await env.inject('POST', `${v2(creator)}/assignments`, creator, {
    envelopeId: creatorEnvelopeId,
    amount: '5000',
    sourceKind: 'FREE',
  });
  expect(funded.statusCode).toBe(201);
});

afterAll(async () => {
  await env.stop();
});

describe('recording on an account', () => {
  it('rejects an expense on someone else’s account', async () => {
    const response = await env.inject('POST', `${v2(editor)}/transactions`, editor, {
      transactionType: 'EXPENSE',
      status: 'CONFIRMED',
      amount: '100',
      occurredOn: today(),
      accountId: creatorAccountId,
      categoryId: await env.categoryId(editor.budgetId, 'EXPENSE'),
      envelopeId: null,
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'NOT_ACCOUNT_OWNER' });
  });

  it('spending from a foreign envelope with an own account reduces that envelope', async () => {
    const before = await envelopeBalance(creatorEnvelopeId);
    await env.record(editor, {
      type: 'EXPENSE',
      accountId: editorAccountId,
      amount: '2300',
      envelopeId: creatorEnvelopeId,
    });
    expect(await envelopeBalance(creatorEnvelopeId)).toBe(before - 230_000n);
  });

  it('a viewer cannot record', async () => {
    const response = await env.inject('POST', `${v2(viewer)}/transactions`, viewer, {
      transactionType: 'INCOME',
      status: 'CONFIRMED',
      amount: '1',
      occurredOn: today(),
      accountId: editorAccountId,
      categoryId: await env.categoryId(viewer.budgetId, 'INCOME'),
      envelopeId: null,
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('changing operations', () => {
  it('only the author edits, deletes and restores; the card shows the author', async () => {
    const id = await env.record(editor, {
      type: 'EXPENSE',
      accountId: editorAccountId,
      amount: '10',
    });
    const card = await env.inject('GET', `${v2(creator)}/transactions/${id}`, creator);
    expect(card.json()).toMatchObject({
      createdBy: { userId: editor.user.id, isActiveMember: true },
    });

    const edit = await env.inject('PATCH', `${v2(creator)}/transactions/${id}`, creator, {
      amount: '20',
    });
    expect(edit.statusCode).toBe(403);
    expect(edit.json()).toMatchObject({ code: 'NOT_OPERATION_AUTHOR' });

    const remove = await env.inject('DELETE', `${v2(editor)}/transactions/${id}`, editor);
    expect(remove.statusCode).toBe(200);
    const deleted = await env.inject('GET', `${v2(editor)}/transactions?status=DELETED`, editor);
    expect(deleted.statusCode).toBe(200);
    const restore = await env.inject('POST', `${v2(creator)}/transactions/${id}/restore`, creator);
    expect(restore.json()).toMatchObject({ code: 'NOT_OPERATION_AUTHOR' });
  });

  it('the author cannot move an own operation onto someone else’s account', async () => {
    const id = await env.record(editor, {
      type: 'EXPENSE',
      accountId: editorAccountId,
      amount: '10',
    });
    const edit = await env.inject('PATCH', `${v2(editor)}/transactions/${id}`, editor, {
      accountId: creatorAccountId,
    });
    expect(edit.statusCode).toBe(403);
    expect(edit.json()).toMatchObject({ code: 'NOT_ACCOUNT_OWNER' });
  });
});

describe('transfers', () => {
  it('rejects a transfer from someone else’s account', async () => {
    const response = await env.inject('POST', `${v2(editor)}/transfers`, editor, {
      sourceAccountId: creatorAccountId,
      destinationAccountId: editorAccountId,
      amount: '100',
      occurredOn: today(),
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'NOT_ACCOUNT_OWNER' });
  });

  it('a transfer to a foreign account keeps the family total; only its author changes it', async () => {
    const totalBefore = await familyCash();
    const created = await env.inject('POST', `${v2(editor)}/transfers`, editor, {
      sourceAccountId: editorAccountId,
      destinationAccountId: creatorAccountId,
      amount: '1000',
      occurredOn: today(),
    });
    expect(created.statusCode).toBe(201);
    expect(await familyCash()).toBe(totalBefore);
    const transferId = created.json<{ id: string }>().id;
    const card = await env.inject('GET', `${v2(creator)}/transfers/${transferId}`, creator);
    expect(card.json()).toMatchObject({ createdBy: { userId: editor.user.id } });
    const remove = await env.inject('DELETE', `${v2(creator)}/transfers/${transferId}`, creator);
    expect(remove.statusCode).toBe(403);
    expect(remove.json()).toMatchObject({ code: 'NOT_OPERATION_AUTHOR' });
  });
});
