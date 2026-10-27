import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { todayInTimezone } from '../src/cycles/cycle-period.domain.js';
import { FamilyTestApp, type FamilyActor } from './helpers/family-app.js';

const dayMs = 86_400_000;
const d = (delta: number) => new Date(Date.now() + delta * dayMs);
const iso = (delta: number) => todayInTimezone(d(delta), 'UTC');
const currentMonth = () => new Date().toISOString().slice(0, 7);

describe('family plans ownership (stage B): планы, оплаты и календарь', () => {
  let app: FamilyTestApp;
  let creator: FamilyActor;
  let editor: FamilyActor;
  let viewer: FamilyActor;
  let creatorAccountId: string;
  let editorAccountId: string;
  let expenseCategoryId: string;
  let incomeCategoryId: string;
  let editorPlanId = '';
  let editorPlanOccurrenceId = '';
  let creatorPlanOccurrenceId = '';

  const v2 = (actor: FamilyActor) => `/api/v2/budgets/${actor.budgetId}`;
  const planBody = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    name: `План ${randomUUID().slice(0, 6)}`,
    amount: '3000.00',
    scheduledOn: iso(0),
    categoryId: expenseCategoryId,
    recurrence: 'MONTHLY',
    ...over,
  });
  const oneBody = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    name: `Взнос ${randomUUID().slice(0, 8)}`,
    plannedAmount: '40000.00',
    actualAmount: '38500.50',
    occurredOn: iso(0),
    categoryId: expenseCategoryId,
    ...over,
  });
  const incomePlanBody = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    name: `Доход ${randomUUID().slice(0, 6)}`,
    amount: '100000.00',
    scheduledOn: iso(0),
    categoryId: incomeCategoryId,
    recurrence: 'MONTHLY',
    ...over,
  });
  const pay = (actor: FamilyActor, occurrenceId: string, accountId: string) =>
    app.inject('POST', `${v2(actor)}/obligations/${occurrenceId}/pay`, actor, {
    amount: '3000.00',
    categoryId: expenseCategoryId,
    accountId,
    occurredOn: iso(0),
    willPayMore: false,
  });
  const recordIncome = (actor: FamilyActor, occurrenceId: string, accountId: string) =>
    app.inject(
      'POST',
      `${v2(actor)}/income-plans/occurrences/${occurrenceId}/record`,
      actor,
      { accountId, amount: '87000.00', occurredOn: iso(0) },
    );
  const planIds = (response: { json(): { items: Array<{ id: string }> } }) =>
    response.json().items.map((plan) => plan.id);

  beforeAll(async () => {
    app = new FamilyTestApp();
    await app.start();
    creator = await app.register();
    editor = await app.join(creator, await app.register(), 'EDITOR');
    viewer = await app.join(creator, await app.register(), 'VIEWER');
    // v2 plan model on the family budget.
    await app.prisma.budget.update({
      where: { id: creator.budgetId },
      data: { planModelVersion: 2, planModelActivatedOn: d(-60), timezone: 'UTC' },
    });
    // Obligation plans bind to the MANDATORY envelope (others archived).
    await app.prisma.envelope.updateMany({
      where: { budgetId: creator.budgetId },
      data: { archivedAt: new Date() },
    });
    await app.prisma.envelope.create({
      data: {
        id: randomUUID(),
        budgetId: creator.budgetId,
        ownerUserId: creator.user.id,
        name: 'Обязательные',
        envelopeType: 'MANDATORY_EXPENSES',
        startingBalanceMinor: 0n,
        displayOrder: 1,
      },
    });
    creatorAccountId = await app.createAccount(creator, 'Счёт создателя');
    editorAccountId = await app.createAccount(editor, 'Счёт участника');
    expenseCategoryId = await app.categoryId(creator.budgetId, 'EXPENSE');
    incomeCategoryId = await app.categoryId(creator.budgetId, 'INCOME');
    // Fund both zero-balance accounts so pay checks reach ownership/balance logic.
    await app.record(creator, { type: 'INCOME', accountId: creatorAccountId, amount: '10000.00' });
    await app.record(editor, { type: 'INCOME', accountId: editorAccountId, amount: '40000.00' });
  });

  afterAll(async () => {
    await app.stop();
  });

  it('A: EDITOR создаёт свой план; ownerUserId-фильтр показывает планы каждого владельца', async () => {
    const created = await app.inject('POST', `${v2(editor)}/obligations/plans`, editor, planBody());
    expect(created.statusCode).toBe(201);
    const plan = created.json<{ id: string; occurrenceId: string }>();
    editorPlanId = plan.id;
    editorPlanOccurrenceId = plan.occurrenceId;
    expect(created.json()).toMatchObject({ owner: { userId: editor.user.id }, canEdit: true });

    const mine = await app.inject(
      'GET',
      `${v2(editor)}/obligations/plans?ownerUserId=${editor.user.id}`,
      editor,
    );
    expect(mine.statusCode).toBe(200);
    expect(planIds(mine)).toContain(editorPlanId);
    expect(mine.json<{ items: Array<{ id: string }> }>().items.find((p) => p.id === editorPlanId))
      .toMatchObject({ owner: { userId: editor.user.id }, canEdit: true });

    const others = await app.inject(
      'GET',
      `${v2(editor)}/obligations/plans?ownerUserId=${creator.user.id}`,
      editor,
    );
    expect(planIds(others)).not.toContain(editorPlanId);
  });

  it('B: управление чужим планом: NOT_OBJECT_OWNER у writer, FORBIDDEN у viewer', async () => {
    const patch = await app.inject(
      'PATCH',
      `${v2(creator)}/obligations/plans/${editorPlanId}`,
      creator,
      { name: 'X' },
    );
    expect(patch.statusCode).toBe(403);
    expect(patch.json<{ code: string }>().code).toBe('NOT_OBJECT_OWNER');

    const payRes = await pay(creator, editorPlanOccurrenceId, creatorAccountId);
    expect(payRes.statusCode).toBe(403);
    expect(payRes.json<{ code: string }>().code).toBe('NOT_OBJECT_OWNER');

    const viewerPatch = await app.inject(
      'PATCH',
      `${v2(viewer)}/obligations/plans/${editorPlanId}`,
      viewer,
      { name: 'X' },
    );
    expect(viewerPatch.statusCode).toBe(403);
    expect(viewerPatch.json<{ code: string }>().code).toBe('FORBIDDEN');
  });

  it('C: оплата с чужого счёта — NOT_ACCOUNT_OWNER; с чужого плана — NOT_OBJECT_OWNER; владелец платит — 201', async () => {
    const created = await app.inject('POST', `${v2(creator)}/obligations/plans`, creator, planBody());
    expect(created.statusCode).toBe(201);
    const plan = created.json<{ id: string; occurrenceId: string }>();
    creatorPlanOccurrenceId = plan.occurrenceId;
    expect(created.json()).toMatchObject({ owner: { userId: creator.user.id }, canEdit: true });

    // Own plan + foreign account.
    const foreignAccount = await pay(editor, editorPlanOccurrenceId, creatorAccountId);
    expect(foreignAccount.statusCode).toBe(403);
    expect(foreignAccount.json<{ code: string }>().code).toBe('NOT_ACCOUNT_OWNER');

    // Foreign plan + own account (plan check comes before the account check).
    const foreignPlan = await pay(editor, creatorPlanOccurrenceId, editorAccountId);
    expect(foreignPlan.statusCode).toBe(403);
    expect(foreignPlan.json<{ code: string }>().code).toBe('NOT_OBJECT_OWNER');

    const own = await pay(creator, creatorPlanOccurrenceId, creatorAccountId);
    expect(own.statusCode).toBe(200);
  });

  it('D: one-time-pay — EDITOR создаёт план себе', async () => {
    const response = await app.inject(
      'POST',
      `${v2(editor)}/obligations/one-time-pay`,
      editor,
      oneBody({ accountId: editorAccountId }),
    );
    expect(response.statusCode).toBe(201);
  });

  it('E: income-plans — EDITOR создаёт свой план; record — только владелец плана', async () => {
    const created = await app.inject('POST', `${v2(editor)}/income-plans`, editor, incomePlanBody());
    expect(created.statusCode).toBe(201);
    const editorPlan = created.json<{ id: string; occurrenceId: string }>();

    const patch = await app.inject(
      'PATCH',
      `${v2(creator)}/income-plans/${editorPlan.id}`,
      creator,
      { amount: '50000.00' },
    );
    expect(patch.statusCode).toBe(403);
    expect(patch.json<{ code: string }>().code).toBe('NOT_OBJECT_OWNER');

    const creatorIncome = await app.inject(
      'POST',
      `${v2(creator)}/income-plans`,
      creator,
      incomePlanBody(),
    );
    expect(creatorIncome.statusCode).toBe(201);
    const creatorPlan = creatorIncome.json<{ id: string; occurrenceId: string }>();

    // Editor on the creator's plan occurrence.
    const foreignRecord = await recordIncome(editor, creatorPlan.occurrenceId, editorAccountId);
    expect(foreignRecord.statusCode).toBe(403);
    expect(foreignRecord.json<{ code: string }>().code).toBe('NOT_OBJECT_OWNER');

    // Editor on their own plan occurrence with their own income account.
    const ownRecord = await recordIncome(editor, editorPlan.occurrenceId, editorAccountId);
    expect(ownRecord.statusCode).toBe(201);
  });

  it('F: календарь — owner и canEdit на планах', async () => {
    const created = await app.inject('POST', `${v2(creator)}/obligations/plans`, creator, planBody());
    expect(created.statusCode).toBe(201);
    const calendarCreatorPlanId = created.json<{ id: string }>().id;

    const response = await app.inject(
      'GET',
      `${v2(editor)}/plans/calendar?month=${currentMonth()}`,
      editor,
    );
    expect(response.statusCode).toBe(200);
    const items = response.json<{
      items: Array<{ planId?: string; owner?: { id: string }; canEdit?: boolean }>;
    }>().items;

    const creatorItem = items.find((item) => item.planId === calendarCreatorPlanId);
    expect(creatorItem).toBeDefined();
    expect(creatorItem?.owner?.id).toBe(creator.user.id);
    expect(creatorItem?.canEdit).toBe(false);

    const editorItem = items.find((item) => item.planId === editorPlanId);
    expect(editorItem).toBeDefined();
    expect(editorItem?.canEdit).toBe(true);
  });

  it('G: VIEWER — FORBIDDEN на всех плановых мутациях', async () => {
    const plan = await app.inject('POST', `${v2(viewer)}/obligations/plans`, viewer, planBody());
    expect(plan.statusCode).toBe(403);
    expect(plan.json<{ code: string }>().code).toBe('FORBIDDEN');

    const one = await app.inject(
      'POST',
      `${v2(viewer)}/obligations/one-time-pay`,
      viewer,
      oneBody({ accountId: editorAccountId }),
    );
    expect(one.statusCode).toBe(403);
    expect(one.json<{ code: string }>().code).toBe('FORBIDDEN');

    const income = await app.inject('POST', `${v2(viewer)}/income-plans`, viewer, incomePlanBody());
    expect(income.statusCode).toBe(403);
    expect(income.json<{ code: string }>().code).toBe('FORBIDDEN');
  });

  it('H: skip чужого плана — NOT_OBJECT_OWNER (owner-only, как pay)', async () => {
    const skip = await app.inject(
      'POST',
      `${v2(editor)}/obligations/${creatorPlanOccurrenceId}/skip`,
      editor,
    );
    expect(skip.statusCode).toBe(403);
    expect(skip.json<{ code: string }>().code).toBe('NOT_OBJECT_OWNER');
  });

  it('I: 404 на несуществующие id — без утечки существования', async () => {
    const ghost = randomUUID();

    const payGhost = await pay(editor, ghost, editorAccountId);
    expect(payGhost.statusCode).toBe(404);

    const recordGhost = await recordIncome(editor, ghost, editorAccountId);
    expect(recordGhost.statusCode).toBe(404);

    const patchGhost = await app.inject(
      'PATCH',
      `${v2(editor)}/obligations/plans/${ghost}`,
      editor,
      { name: 'X' },
    );
    expect(patchGhost.statusCode).toBe(404);

    const patchIncomeGhost = await app.inject(
      'PATCH',
      `${v2(editor)}/income-plans/${ghost}`,
      editor,
      { amount: '1000.00' },
    );
    expect(patchIncomeGhost.statusCode).toBe(404);
  });
});
