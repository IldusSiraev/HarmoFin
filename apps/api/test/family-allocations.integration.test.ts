import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { cycleAndPeriodFor, todayInTimezone } from '../src/cycles/cycle-period.domain.js';
import { FamilyTestApp, type FamilyActor } from './helpers/family-app.js';

const env = new FamilyTestApp();
let creator: FamilyActor;
let editor: FamilyActor;
let viewer: FamilyActor;
let creatorEnvelopeId: string; // «Отпуск»
let editorEnvelopeId: string; // «Расходы на детей»
let creatorIncomeId: string;
let editorIncomeId: string;

const v2 = (actor: FamilyActor) => `/api/v2/budgets/${actor.budgetId}`;

async function envelopeBalance(envelopeId: string): Promise<bigint> {
  const response = await env.inject('GET', `${v2(creator)}/envelopes/${envelopeId}`, creator);
  return BigInt(response.json<{ balanceMinor: string }>().balanceMinor);
}

async function totalEnvelopeMoney(): Promise<bigint> {
  const response = await env.inject('GET', `${v2(creator)}/envelopes`, creator);
  return response
    .json<{ items: Array<{ balanceMinor: string }> }>()
    .items.reduce((sum, item) => sum + BigInt(item.balanceMinor), 0n);
}

beforeAll(async () => {
  await env.start();
  creator = await env.register();
  editor = await env.join(creator, await env.register(), 'EDITOR');
  viewer = await env.join(creator, await env.register(), 'VIEWER');
  const creatorAccountId = await env.createAccount(creator, 'Счёт создателя');
  const editorAccountId = await env.createAccount(editor, 'Счёт участника');
  creatorEnvelopeId = await env.createEnvelope(creator, 'Отпуск');
  editorEnvelopeId = await env.createEnvelope(editor, 'Расходы на детей');
  creatorIncomeId = await env.record(creator, {
    type: 'INCOME',
    accountId: creatorAccountId,
    amount: '50000',
  });
  editorIncomeId = await env.record(editor, {
    type: 'INCOME',
    accountId: editorAccountId,
    amount: '30000',
  });
});

afterAll(async () => {
  await env.stop();
});

describe('income allocation', () => {
  it('rejects allocating someone else’s income', async () => {
    const response = await env.inject('POST', `${v2(editor)}/assignments`, editor, {
      incomeTransactionId: creatorIncomeId,
      envelopeId: editorEnvelopeId,
      amount: '100',
      sourceKind: 'INCOME',
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'NOT_INCOME_AUTHOR' });
  });

  it('own income into a foreign envelope changes only that envelope', async () => {
    const otherBefore = await envelopeBalance(creatorEnvelopeId);
    const targetBefore = await envelopeBalance(editorEnvelopeId);
    const response = await env.inject('POST', `${v2(creator)}/assignments`, creator, {
      incomeTransactionId: creatorIncomeId,
      envelopeId: editorEnvelopeId,
      amount: '10000',
      sourceKind: 'INCOME',
    });
    expect(response.statusCode).toBe(201);
    expect(await envelopeBalance(editorEnvelopeId)).toBe(targetBefore + 1_000_000n);
    expect(await envelopeBalance(creatorEnvelopeId)).toBe(otherBefore);
    const row = await env.prisma.envelopeAssignment.findFirstOrThrow({
      where: { budgetId: creator.budgetId, sourceIncomeTransactionId: creatorIncomeId },
      select: { createdByUserId: true },
    });
    expect(row.createdByUserId).toBe(creator.user.id);
  });

  it('the income limit still holds for the author', async () => {
    const response = await env.inject('POST', `${v2(creator)}/assignments`, creator, {
      incomeTransactionId: creatorIncomeId,
      envelopeId: creatorEnvelopeId,
      amount: '40000.01',
      sourceKind: 'INCOME',
    });
    expect(response.statusCode).toBe(409);
  });

  it('a viewer cannot allocate', async () => {
    const response = await env.inject('POST', `${v2(viewer)}/assignments`, viewer, {
      envelopeId: editorEnvelopeId,
      amount: '1',
      sourceKind: 'FREE',
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('free money', () => {
  it('any editor allocates free money into any envelope', async () => {
    const response = await env.inject('POST', `${v2(editor)}/assignments`, editor, {
      envelopeId: creatorEnvelopeId,
      amount: '500',
      sourceKind: 'FREE',
    });
    expect(response.statusCode).toBe(201);
    const body = response.json<{ freeToAssignMinor: string; balanceMinor: string }>();
    const row = await env.prisma.envelopeAssignment.findUniqueOrThrow({
      where: { id: response.json<{ assignmentId: string }>().assignmentId },
      select: { createdByUserId: true, type: true },
    });
    expect(row).toEqual({ createdByUserId: editor.user.id, type: 'FREE' });
    expect(BigInt(body.balanceMinor)).toBe(await envelopeBalance(creatorEnvelopeId));
  });
});

describe('changing an allocation', () => {
  it('only its author revises or cancels it', async () => {
    const created = await env.inject('POST', `${v2(editor)}/assignments`, editor, {
      incomeTransactionId: editorIncomeId,
      envelopeId: editorEnvelopeId,
      amount: '300',
      sourceKind: 'INCOME',
    });
    expect(created.statusCode).toBe(201);
    const assignmentId = created.json<{ assignmentId: string }>().assignmentId;
    const revise = await env.inject(
      'PATCH',
      `${v2(creator)}/assignments/${assignmentId}`,
      creator,
      {
        amount: '100',
      },
    );
    expect(revise.statusCode).toBe(403);
    expect(revise.json()).toMatchObject({ code: 'NOT_OPERATION_AUTHOR' });
    const cancel = await env.inject(
      'DELETE',
      `${v2(creator)}/assignments/${assignmentId}`,
      creator,
    );
    expect(cancel.json()).toMatchObject({ code: 'NOT_OPERATION_AUTHOR' });
    const own = await env.inject('DELETE', `${v2(editor)}/assignments/${assignmentId}`, editor);
    expect(own.statusCode).toBe(200);
  });
});

describe('moving money between envelopes', () => {
  it('rejects moving out of a foreign envelope', async () => {
    const response = await env.inject('POST', `${v2(creator)}/movements`, creator, {
      sourceEnvelopeId: editorEnvelopeId,
      destinationEnvelopeId: creatorEnvelopeId,
      amount: '100',
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'NOT_OBJECT_OWNER' });
  });

  it('moves out of an own envelope into a foreign one; total envelope money unchanged', async () => {
    const totalBefore = await totalEnvelopeMoney();
    const sourceBefore = await envelopeBalance(editorEnvelopeId);
    const targetBefore = await envelopeBalance(creatorEnvelopeId);
    const response = await env.inject('POST', `${v2(editor)}/movements`, editor, {
      sourceEnvelopeId: editorEnvelopeId,
      destinationEnvelopeId: creatorEnvelopeId,
      amount: '100',
    });
    expect(response.statusCode).toBe(201);
    expect(await envelopeBalance(editorEnvelopeId)).toBe(sourceBefore - 10_000n);
    expect(await envelopeBalance(creatorEnvelopeId)).toBe(targetBefore + 10_000n);
    expect(await totalEnvelopeMoney()).toBe(totalBefore);
    const movement = await env.prisma.envelopeMovement.findUniqueOrThrow({
      where: { id: response.json<{ movementId: string }>().movementId },
      select: { createdByUserId: true },
    });
    expect(movement.createdByUserId).toBe(editor.user.id);
  });
});

describe('funding by rules', () => {
  it('preview refuses someone else’s income', async () => {
    const preview = await env.inject('POST', `${v2(creator)}/funding/preview`, creator, {
      sourceKind: 'INCOME',
      incomeTransactionId: editorIncomeId,
    });
    expect(preview.statusCode).toBe(403);
    expect(preview.json()).toMatchObject({ code: 'NOT_INCOME_AUTHOR' });
  });

  it('an editor previews their own income with overrides into both owners’ envelopes, then confirms', async () => {
    const preview = await env.inject('POST', `${v2(editor)}/funding/preview`, editor, {
      sourceKind: 'INCOME',
      incomeTransactionId: editorIncomeId,
      overrides: [
        { envelopeId: editorEnvelopeId, amount: '50' },
        { envelopeId: creatorEnvelopeId, amount: '25' },
      ],
    });
    expect(preview.statusCode).toBe(200);
    const previewBody = preview.json<{ previewHash: string }>();

    const confirm = await env.inject('POST', `${v2(editor)}/funding/confirm`, editor, {
      sourceKind: 'INCOME',
      incomeTransactionId: editorIncomeId,
      previewHash: previewBody.previewHash,
      confirmPeriodTargets: [],
      lines: [
        { envelopeId: editorEnvelopeId, amount: '50' },
        { envelopeId: creatorEnvelopeId, amount: '25' },
      ],
    });
    expect(confirm.statusCode).toBe(200);
    const confirmBody = confirm.json<{
      assignedMinor: string;
      assignments: Array<{ id: string }>;
    }>();
    expect(BigInt(confirmBody.assignedMinor)).toBeLessThanOrEqual(3_000_000n);
    for (const assignment of confirmBody.assignments) {
      const row = await env.prisma.envelopeAssignment.findUniqueOrThrow({
        where: { id: assignment.id },
        select: { createdByUserId: true },
      });
      expect(row.createdByUserId).toBe(editor.user.id);
    }
  });

  it('confirm refuses someone else’s income', async () => {
    const confirm = await env.inject('POST', `${v2(editor)}/funding/confirm`, editor, {
      sourceKind: 'INCOME',
      incomeTransactionId: creatorIncomeId,
      previewHash: 'a'.repeat(64),
      confirmPeriodTargets: [],
      lines: [{ envelopeId: editorEnvelopeId, amount: '1' }],
    });
    expect(confirm.statusCode).toBe(403);
    expect(confirm.json()).toMatchObject({ code: 'NOT_INCOME_AUTHOR' });
  });
});

describe('funding confirm guards foreign envelopes and periods', () => {
  it('OPENING confirm into a foreign envelope is blocked; into an own envelope passes the gate', async () => {
    // A fresh family: no confirmed facts yet, so OPENING stays available.
    const freshOwner = await env.register();
    const freshEditor = await env.join(freshOwner, await env.register(), 'EDITOR');
    await env.createAccount(freshEditor, 'Счёт участника новой семьи', '1000');
    const ownerEnvelopeId = await env.createEnvelope(freshOwner, 'Копилка создателя');
    const editorEnvelopeId2 = await env.createEnvelope(freshEditor, 'Личный конверт участника');

    const foreignPreview = await env.inject(
      'POST',
      `${v2(freshEditor)}/funding/preview`,
      freshEditor,
      { sourceKind: 'OPENING', overrides: [{ envelopeId: ownerEnvelopeId, amount: '10' }] },
    );
    expect(foreignPreview.statusCode).toBe(200);
    const foreignConfirm = await env.inject(
      'POST',
      `${v2(freshEditor)}/funding/confirm`,
      freshEditor,
      {
        sourceKind: 'OPENING',
        previewHash: foreignPreview.json<{ previewHash: string }>().previewHash,
        confirmPeriodTargets: [],
        lines: [{ envelopeId: ownerEnvelopeId, amount: '10' }],
      },
    );
    expect(foreignConfirm.statusCode).toBe(403);
    expect(foreignConfirm.json()).toMatchObject({ code: 'NOT_OBJECT_OWNER' });

    const ownPreview = await env.inject('POST', `${v2(freshEditor)}/funding/preview`, freshEditor, {
      sourceKind: 'OPENING',
      overrides: [{ envelopeId: editorEnvelopeId2, amount: '10' }],
    });
    expect(ownPreview.statusCode).toBe(200);
    const ownConfirm = await env.inject('POST', `${v2(freshEditor)}/funding/confirm`, freshEditor, {
      sourceKind: 'OPENING',
      previewHash: ownPreview.json<{ previewHash: string }>().previewHash,
      confirmPeriodTargets: [],
      lines: [{ envelopeId: editorEnvelopeId2, amount: '10' }],
    });
    expect(ownConfirm.statusCode).toBe(200);
  });

  it('confirming a draft period target of a foreign envelope is blocked', async () => {
    const freshOwner = await env.register();
    const freshEditor = await env.join(freshOwner, await env.register(), 'EDITOR');
    const timezone = 'Europe/Moscow';
    const today = todayInTimezone(new Date(), timezone);
    const periodSlot = cycleAndPeriodFor(
      { cycleStartDay: 1, periodBoundaryOffset: 15, timezone },
      today,
    ).period.id;

    const envelopeResponse = await env.inject('POST', `${v2(freshOwner)}/envelopes`, freshOwner, {
      name: 'Текущие расходы',
      envelopeType: 'CURRENT_EXPENSES',
      periodSlot,
    });
    expect(envelopeResponse.statusCode).toBe(201);
    const ruleEnvelopeId = envelopeResponse.json<{ id: string }>().id;

    const ruleResponse = await env.inject(
      'PUT',
      `${v2(freshOwner)}/envelopes/${ruleEnvelopeId}/funding-rule`,
      freshOwner,
      { type: 'FIXED_PER_PERIOD', priority: 1, fixedAmount: '500' },
    );
    expect(ruleResponse.statusCode).toBe(200);

    // Materialize the DRAFT period target row from the saved rule.
    const materialize = await env.inject('POST', `${v2(freshOwner)}/funding/preview`, freshOwner, {
      sourceKind: 'FREE',
    });
    expect(materialize.statusCode).toBe(200);
    const draftPeriodId = materialize
      .json<{
        periodTargetDrafts: Array<{ periodId: string; targetMinor: string }>;
      }>()
      .periodTargetDrafts.find((draft) => draft.targetMinor === '50000')?.periodId;
    expect(draftPeriodId).toBeDefined();

    const editorPreview = await env.inject(
      'POST',
      `${v2(freshEditor)}/funding/preview`,
      freshEditor,
      { sourceKind: 'FREE', confirmPeriodTargets: [draftPeriodId] },
    );
    expect(editorPreview.statusCode).toBe(200);

    const editorConfirm = await env.inject(
      'POST',
      `${v2(freshEditor)}/funding/confirm`,
      freshEditor,
      {
        sourceKind: 'FREE',
        previewHash: editorPreview.json<{ previewHash: string }>().previewHash,
        confirmPeriodTargets: [draftPeriodId],
        lines: [],
      },
    );
    expect(editorConfirm.statusCode).toBe(403);
    expect(editorConfirm.json()).toMatchObject({ code: 'NOT_OBJECT_OWNER' });
  });
});
