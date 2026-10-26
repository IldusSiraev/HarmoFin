import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FamilyTestApp, type FamilyActor } from './helpers/family-app.js';

const env = new FamilyTestApp();
let creator: FamilyActor;
let editor: FamilyActor;
let viewer: FamilyActor;
let creatorEnvelopeId: string;
let editorEnvelopeId: string;

const v2 = (actor: FamilyActor) => `/api/v2/budgets/${actor.budgetId}`;

beforeAll(async () => {
  await env.start();
  creator = await env.register();
  editor = await env.join(creator, await env.register(), 'EDITOR');
  viewer = await env.join(creator, await env.register(), 'VIEWER');
  creatorEnvelopeId = await env.createEnvelope(creator, 'Отпуск');
  editorEnvelopeId = await env.createEnvelope(editor, 'Расходы на детей');
});

afterAll(async () => {
  await env.stop();
});

describe('envelope ownership', () => {
  it('an editor creates an envelope that belongs to the editor', async () => {
    const response = await env.inject('GET', `${v2(editor)}/envelopes/${editorEnvelopeId}`, editor);
    expect(response.json()).toMatchObject({ owner: { userId: editor.user.id }, canEdit: true });
  });

  it('a viewer cannot create envelopes', async () => {
    const response = await env.inject('POST', `${v2(viewer)}/envelopes`, viewer, {
      name: 'Нельзя',
      envelopeType: 'CUSTOM',
    });
    expect(response.statusCode).toBe(403);
  });

  it('list shows all envelopes with canEdit per owner and filters by owner', async () => {
    const all = await env.inject('GET', `${v2(creator)}/envelopes`, creator);
    const items = all.json<{ items: Array<{ id: string; canEdit: boolean }> }>().items;
    expect(items.find((item) => item.id === creatorEnvelopeId)?.canEdit).toBe(true);
    expect(items.find((item) => item.id === editorEnvelopeId)?.canEdit).toBe(false);
    const filtered = await env.inject(
      'GET',
      `${v2(creator)}/envelopes?ownerUserId=${editor.user.id}`,
      creator,
    );
    const ids = filtered.json<{ items: Array<{ id: string }> }>().items.map((item) => item.id);
    expect(ids).toEqual([editorEnvelopeId]);
  });

  it('the creator gets NOT_OBJECT_OWNER renaming the editor envelope', async () => {
    const response = await env.inject('PATCH', `${v2(creator)}/envelopes/${editorEnvelopeId}`, creator, {
      name: 'Чужой',
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'NOT_OBJECT_OWNER' });
  });

  it('the creator gets NOT_OBJECT_OWNER archiving the editor envelope', async () => {
    const response = await env.inject(
      'POST',
      `${v2(creator)}/envelopes/${editorEnvelopeId}/archive`,
      creator,
    );
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'NOT_OBJECT_OWNER' });
  });

  it('only the creator changes the income category suggestion', async () => {
    const response = await env.inject('PUT', `${v2(editor)}/income-category-suggestion`, editor, {
      enabled: false,
      sourceCategoryId: null,
      targetEnvelopeId: null,
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('PUT funding-rule: NOT_OBJECT_OWNER for the creator, 200 for the member', async () => {
    const foreign = await env.inject(
      'PUT',
      `${v2(creator)}/envelopes/${editorEnvelopeId}/funding-rule`,
      creator,
      { type: 'MANUAL', priority: 1 },
    );
    expect(foreign.statusCode).toBe(403);
    expect(foreign.json()).toMatchObject({ code: 'NOT_OBJECT_OWNER' });

    const own = await env.inject(
      'PUT',
      `${v2(editor)}/envelopes/${editorEnvelopeId}/funding-rule`,
      editor,
      { type: 'MANUAL', priority: 1 },
    );
    expect(own.statusCode).toBe(200);
  });

  it('PUT period target of a foreign envelope: NOT_OBJECT_OWNER for the creator', async () => {
    const response = await env.inject(
      'PUT',
      `${v2(creator)}/envelopes/${editorEnvelopeId}/periods/2026-01-01/target`,
      creator,
      { target: '100' },
    );
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'NOT_OBJECT_OWNER' });
  });

  it('PUT funding-rules: own envelope 200, foreign envelope rule NOT_OBJECT_OWNER, incomeSuggestion change FORBIDDEN', async () => {
    const ownOnly = await env.inject('PUT', `${v2(editor)}/funding-rules`, editor, {
      queue: [{ envelopeId: editorEnvelopeId, type: 'FIXED_PER_PERIOD', fixedAmount: '100' }],
      outside: [],
      incomeSuggestion: { enabled: false, sourceCategoryId: null, targetEnvelopeId: null },
    });
    expect(ownOnly.statusCode).toBe(200);

    const foreignRule = await env.inject('PUT', `${v2(editor)}/funding-rules`, editor, {
      queue: [{ envelopeId: editorEnvelopeId, type: 'FIXED_PER_PERIOD', fixedAmount: '100' }],
      outside: [{ envelopeId: creatorEnvelopeId, type: 'MANUAL' }],
      incomeSuggestion: { enabled: false, sourceCategoryId: null, targetEnvelopeId: null },
    });
    expect(foreignRule.statusCode).toBe(403);
    expect(foreignRule.json()).toMatchObject({ code: 'NOT_OBJECT_OWNER' });

    const incomeCategoryId = await env.categoryId(editor.budgetId, 'INCOME');
    const changeSuggestion = await env.inject('PUT', `${v2(editor)}/funding-rules`, editor, {
      queue: [],
      outside: [],
      incomeSuggestion: {
        enabled: true,
        sourceCategoryId: incomeCategoryId,
        targetEnvelopeId: editorEnvelopeId,
      },
    });
    expect(changeSuggestion.statusCode).toBe(403);
    expect(changeSuggestion.json()).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('POST confirm-target of a foreign envelope period: NOT_OBJECT_OWNER', async () => {
    const period = await env.prisma.envelopePeriod.create({
      data: {
        id: randomUUID(),
        budgetId: creator.budgetId,
        envelopeId: creatorEnvelopeId,
        startsOn: new Date('2026-01-01T00:00:00.000Z'),
        endsOn: new Date('2026-01-14T00:00:00.000Z'),
        targetMinor: 1000n,
        targetStatus: 'DRAFT',
        createdByUserId: creator.user.id,
        updatedByUserId: creator.user.id,
      },
      select: { id: true },
    });
    const response = await env.inject(
      'POST',
      `${v2(editor)}/periods/${period.id}/confirm-target`,
      editor,
    );
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'NOT_OBJECT_OWNER' });
  });
});
