import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FamilyTestApp, type FamilyActor } from './helpers/family-app.js';

const env = new FamilyTestApp();
let creator: FamilyActor;
let editor: FamilyActor;
let kidsEnvelopeId: string;
let vacationEnvelopeId: string;
let expenseId: string;

const v2 = (actor: FamilyActor) => `/api/v2/budgets/${actor.budgetId}`;

type Item = {
  kind: string;
  id: string;
  direction: 'IN' | 'OUT';
  amountMinor: string;
  createdBy: { userId: string };
  counterpartName: string | null;
  assignmentType: string | null;
};

async function history(envelopeId: string, status?: 'DELETED'): Promise<Item[]> {
  const query = status ? `?status=${status}` : '';
  const response = await env.inject(
    'GET',
    `${v2(creator)}/envelopes/${envelopeId}/history${query}`,
    creator,
  );
  expect(response.statusCode).toBe(200);
  return response.json<{ items: Item[] }>().items;
}

beforeAll(async () => {
  await env.start();
  creator = await env.register();
  editor = await env.join(creator, await env.register(), 'EDITOR');
  const creatorAccountId = await env.createAccount(creator, 'Счёт создателя');
  const editorAccountId = await env.createAccount(editor, 'Счёт участника', '5000');
  kidsEnvelopeId = await env.createEnvelope(editor, 'Расходы на детей');
  vacationEnvelopeId = await env.createEnvelope(creator, 'Отпуск');
  const incomeId = await env.record(creator, {
    type: 'INCOME',
    accountId: creatorAccountId,
    amount: '10000',
  });
  await env.inject('POST', `${v2(creator)}/assignments`, creator, {
    incomeTransactionId: incomeId,
    envelopeId: kidsEnvelopeId,
    amount: '10000',
    sourceKind: 'INCOME',
  });
  expenseId = await env.record(editor, {
    type: 'EXPENSE',
    accountId: editorAccountId,
    amount: '2300',
    envelopeId: kidsEnvelopeId,
  });
  await env.inject('POST', `${v2(editor)}/movements`, editor, {
    sourceEnvelopeId: kidsEnvelopeId,
    destinationEnvelopeId: vacationEnvelopeId,
    amount: '1000',
  });
});

afterAll(async () => {
  await env.stop();
});

describe('envelope history', () => {
  it('shows author, direction and counterpart of every entry', async () => {
    const items = await history(kidsEnvelopeId);
    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'ASSIGNMENT',
          direction: 'IN',
          amountMinor: '1000000',
          assignmentType: 'INCOME',
          createdBy: expect.objectContaining({ userId: creator.user.id }),
        }),
        expect.objectContaining({
          kind: 'SPENDING',
          direction: 'OUT',
          amountMinor: '230000',
          createdBy: expect.objectContaining({ userId: editor.user.id }),
        }),
        expect.objectContaining({
          kind: 'MOVEMENT',
          direction: 'OUT',
          amountMinor: '100000',
          counterpartName: 'Отпуск',
          createdBy: expect.objectContaining({ userId: editor.user.id }),
        }),
      ]),
    );
  });

  it('shows an incoming movement as IN in the destination envelope', async () => {
    const movement = (await history(vacationEnvelopeId)).find((item) => item.kind === 'MOVEMENT');
    expect(movement).toMatchObject({ direction: 'IN', counterpartName: 'Расходы на детей' });
  });

  it('a deleted spending leaves the confirmed history and appears among deleted', async () => {
    const removed = await env.inject('DELETE', `${v2(editor)}/transactions/${expenseId}`, editor);
    expect(removed.statusCode).toBe(200);
    expect((await history(kidsEnvelopeId)).some((item) => item.id === expenseId)).toBe(false);
    expect((await history(kidsEnvelopeId, 'DELETED')).some((item) => item.id === expenseId)).toBe(
      true,
    );
  });
});
