import { randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiApp } from '../src/app.js';
import { loadApiConfig } from '../src/config/env.js';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin';
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const origin = 'http://localhost:3000';
const password = 'correct-password-10';
const ownerEmail = `template-owner-${randomUUID()}@harmofin.test`;
const otherEmail = `template-other-${randomUUID()}@harmofin.test`;

let app: NestFastifyApplication;
let server: FastifyInstance;
let ownerId: string;
let otherId: string;
let ownerCookie: string;
let ownerCsrf: string;
let ownerWorkspaceId: string;
let ownerBudgetId: string;
let otherBudgetId: string;

const incomeKeys = [
  'income-salary',
  'income-advance',
  'income-bonus',
  'income-cashback',
  'income-deposit-interest',
];
const envelopeKeys = [
  'envelope-current-10-24',
  'envelope-current-25-9',
  'envelope-mandatory',
  'envelope-vacation',
  'envelope-car',
  'envelope-free',
];

describe('reference template API', () => {
  beforeAll(async () => {
    app = await createApiApp(
      loadApiConfig({
        ...process.env,
        NODE_ENV: 'test',
        DATABASE_URL: databaseUrl,
        WEB_ORIGIN: origin,
        AUTH_TOKEN_HASH_SECRET: 'test-only-secret-with-at-least-32-bytes',
        SMTP_HOST: '127.0.0.1',
        SMTP_PORT: '1025',
        MAIL_FROM: 'no-reply@harmofin.test',
        WEB_BASE_URL: origin,
        LOG_LEVEL: 'silent',
      }),
    );
    await app.init();
    server = app.getHttpAdapter().getInstance() as FastifyInstance;
    await server.ready();

    const owner = await register(ownerEmail);
    ownerId = owner.user.id;
    ownerWorkspaceId = owner.workspace.id;
    ownerBudgetId = owner.budget.id;
    ownerCookie = owner.cookie;
    ownerCsrf = owner.csrfToken;
    const other = await register(otherEmail);
    otherId = other.user.id;
    otherBudgetId = other.budget.id;
  });

  afterAll(async () => {
    await cleanupUser(ownerId);
    await cleanupUser(otherId);
    await app.close();
    await prisma.$disconnect();
  });

  it('documents exact Stage 2 paths, authenticated contracts and Problem Details errors in OpenAPI', async () => {
    const response = await server.inject({ method: 'GET', url: '/openapi.json' });
    const document = response.json<OpenApiDocument>();

    expect(document.components.securitySchemes.session).toEqual({
      type: 'apiKey',
      in: 'cookie',
      name: 'harmofin_session',
    });
    expect(document.components.schemas.ProblemDetailsResponse).toBeDefined();

    const template = operation(document, '/api/v1/budgets/{budgetId}/reference-template', 'post');
    expectAuthenticated(template);
    expectResponseSchema(template, '200', reference('ReferenceTemplateResponse'));
    expectProblemDetails(template, ['401', '403', '404']);

    for (const resource of [
      {
        collectionPath: '/api/v1/budgets/{budgetId}/accounts',
        itemPath: '/api/v1/budgets/{budgetId}/accounts/{accountId}',
        response: 'AccountResponse',
        create: 'CreateAccountRequest',
        update: 'UpdateAccountRequest',
        archiveErrors: ['401', '403', '404'],
      },
      {
        collectionPath: '/api/v1/budgets/{budgetId}/categories',
        itemPath: '/api/v1/budgets/{budgetId}/categories/{categoryId}',
        response: 'CategoryResponse',
        create: 'CreateCategoryRequest',
        update: 'UpdateCategoryRequest',
        archiveErrors: ['400', '401', '403', '404'],
      },
      {
        collectionPath: '/api/v1/budgets/{budgetId}/envelopes',
        itemPath: '/api/v1/budgets/{budgetId}/envelopes/{envelopeId}',
        response: 'EnvelopeResponse',
        create: 'CreateEnvelopeRequest',
        update: 'UpdateEnvelopeRequest',
        archiveErrors: ['401', '403', '404'],
      },
    ] as const) {
      const list = operation(document, resource.collectionPath, 'get');
      expectAuthenticated(list);
      expectResponseSchema(list, '200', arrayOf(reference(resource.response)));
      expectProblemDetails(list, ['401', '404']);

      const create = operation(document, resource.collectionPath, 'post');
      expectAuthenticated(create);
      expectRequestBodySchema(create, reference(resource.create));
      expectResponseSchema(create, '201', reference(resource.response));
      expectProblemDetails(create, ['400', '401', '403', '404', '409']);

      const get = operation(document, resource.itemPath, 'get');
      expectAuthenticated(get);
      expectResponseSchema(get, '200', reference(resource.response));
      expectProblemDetails(get, ['401', '404']);

      const update = operation(document, resource.itemPath, 'patch');
      expectAuthenticated(update);
      expectRequestBodySchema(update, reference(resource.update));
      expectResponseSchema(update, '200', reference(resource.response));
      expectProblemDetails(update, ['400', '401', '403', '404', '409']);

      const archive = operation(document, `${resource.itemPath}/archive`, 'post');
      expectAuthenticated(archive);
      expectResponseSchema(archive, '200', reference(resource.response));
      expectProblemDetails(archive, resource.archiveErrors);
    }
  });

  it('creates exact defaults and a safe template audit event', async () => {
    const response = await initializeTemplate(ownerBudgetId, ownerCookie, ownerCsrf);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      createdCategoryKeys: expect.arrayContaining(incomeKeys),
      createdEnvelopeKeys: expect.arrayContaining(envelopeKeys),
      existingCategoryKeys: [],
      existingEnvelopeKeys: [],
    });
    expect(
      await prisma.category.findMany({
        where: { budgetId: ownerBudgetId },
        orderBy: { displayOrder: 'asc' },
      }),
    ).toHaveLength(58);
    expect(
      await prisma.category.findFirst({
        where: { budgetId: ownerBudgetId, name: 'Кэшбэк', categoryType: 'INCOME' },
      }),
    ).not.toBeNull();
    expect(
      await prisma.category.findFirst({
        where: { budgetId: ownerBudgetId, name: 'Проценты по вкладам', categoryType: 'INCOME' },
      }),
    ).not.toBeNull();
    expect(await prisma.envelope.count({ where: { budgetId: ownerBudgetId } })).toBe(6);
    const audit = await prisma.auditEvent.findFirst({
      where: { budgetId: ownerBudgetId, action: 'REFERENCE_TEMPLATE_INITIALIZED' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit?.newValues).toMatchObject({
      createdCategoryKeys: expect.arrayContaining(['income-cashback']),
    });
    expect(JSON.stringify(audit?.newValues)).not.toContain('comment');
  });

  it('lists default categories by type and archive status', async () => {
    const income = await listCategories('INCOME', 'active');
    const expense = await listCategories('EXPENSE', 'active');
    const all = await listCategories(undefined, 'all');

    expect(income.statusCode).toBe(200);
    expect(income.json()).toHaveLength(10);
    expect(expense.statusCode).toBe(200);
    expect(expense.json()).toHaveLength(48);
    expect(all.statusCode).toBe(200);
    expect(all.json()).toHaveLength(58);
  });

  it('creates, updates, archives and scopes accounts', async () => {
    const invalidDigits = await createAccount({ lastFourDigits: '12' });
    const negativeWhenDisabled = await createAccount({ startingBalance: '-0.01' });

    expect(invalidDigits.statusCode).toBe(400);
    expect(invalidDigits.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(negativeWhenDisabled.statusCode).toBe(400);

    const created = await createAccount({ startingBalance: '90071992547409.93' });
    const account = created.json<{
      id: string;
      startingBalanceMinor: string;
      currentBalanceMinor: string;
    }>();

    expect(created.statusCode).toBe(201);
    expect(account).toMatchObject({
      startingBalanceMinor: '9007199254740993',
      currentBalanceMinor: '9007199254740993',
    });
    expect((await listAccounts('active')).json()).toHaveLength(1);
    expect((await getAccount(account.id)).statusCode).toBe(200);

    const duplicate = await createAccount({ name: 'Основной счёт' });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({ code: 'REFERENCE_NAME_CONFLICT' });

    const noOrigin = await server.inject({
      method: 'PATCH',
      url: `/api/v1/budgets/${ownerBudgetId}/accounts/${account.id}`,
      cookies: { harmofin_session: ownerCookie },
      payload: { name: 'Переименованный счёт' },
    });
    const missingCsrf = await server.inject({
      method: 'PATCH',
      url: `/api/v1/budgets/${ownerBudgetId}/accounts/${account.id}`,
      headers: { origin },
      cookies: { harmofin_session: ownerCookie },
      payload: { name: 'Переименованный счёт' },
    });
    expect(noOrigin.json()).toMatchObject({ code: 'ORIGIN_REQUIRED' });
    expect(missingCsrf.json()).toMatchObject({ code: 'CSRF_INVALID' });

    const settings = await server.inject({
      method: 'PATCH',
      url: `/api/v1/budgets/${ownerBudgetId}`,
      headers: { origin, 'x-csrf-token': ownerCsrf },
      cookies: { harmofin_session: ownerCookie },
      payload: { allowNegativeBalance: true },
    });
    expect(settings.statusCode).toBe(200);

    const updated = await updateAccount(account.id, { startingBalance: '-1.00' });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      startingBalanceMinor: '-100',
      currentBalanceMinor: '-100',
    });

    const editorRole = await prisma.workspaceMembership.updateMany({
      where: { userId: ownerId, workspaceId: ownerWorkspaceId },
      data: { role: 'EDITOR' },
    });
    expect(editorRole.count).toBe(1);
    const editorResponse = await createAccount({ name: 'Недоступный счёт' });
    await prisma.workspaceMembership.updateMany({
      where: { userId: ownerId, workspaceId: ownerWorkspaceId },
      data: { role: 'OWNER' },
    });
    expect(editorResponse.statusCode).toBe(403);

    const other = await login(otherEmail);
    const foreign = await server.inject({
      method: 'GET',
      url: `/api/v1/budgets/${ownerBudgetId}/accounts/${account.id}`,
      cookies: { harmofin_session: other.cookie },
    });
    const foreignList = await server.inject({
      method: 'GET',
      url: `/api/v1/budgets/${ownerBudgetId}/accounts`,
      cookies: { harmofin_session: other.cookie },
    });
    expect(foreign.statusCode).toBe(404);
    expect(foreignList.statusCode).toBe(404);

    const archived = await archiveAccount(account.id);
    const archivedAgain = await archiveAccount(account.id);
    expect(archived.statusCode).toBe(200);
    expect(archivedAgain.statusCode).toBe(200);
    expect((await listAccounts('active')).json()).toHaveLength(0);
    expect((await listAccounts('archived')).json()).toHaveLength(1);
    expect((await listAccounts('all')).json()).toHaveLength(1);
    expect(
      await prisma.auditEvent.count({
        where: {
          budgetId: ownerBudgetId,
          entityType: 'account',
          entityId: account.id,
          action: 'ARCHIVED',
        },
      }),
    ).toBe(1);

    const reused = await createAccount({
      name: 'Основной счёт',
      lastFourDigits: null,
      comment: null,
    });
    expect(reused.statusCode).toBe(201);
    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { budgetId: ownerBudgetId, entityType: 'account', action: 'CREATED' },
      orderBy: { createdAt: 'desc' },
    });
    expect(JSON.stringify(audit.newValues)).not.toContain('lastFourDigits');
    expect(JSON.stringify(audit.newValues)).not.toContain('comment');
  });

  it('creates, updates, archives and scopes categories', async () => {
    const income = await createCategory({
      name: 'Доход API',
      categoryType: 'INCOME',
      displayOrder: 100,
    });
    const expense = await createCategory({
      name: 'Расход API',
      categoryType: 'EXPENSE',
      displayOrder: 101,
    });
    const incomeCategory = income.json<{ id: string }>();
    const expenseCategory = expense.json<{ id: string }>();

    expect(income.statusCode).toBe(201);
    expect(expense.statusCode).toBe(201);
    expect((await listCategories('INCOME', 'active')).json()).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: incomeCategory.id })]),
    );
    expect((await listCategories('EXPENSE', 'active')).json()).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: expenseCategory.id })]),
    );

    const duplicate = await createCategory({
      name: 'Доход API',
      categoryType: 'INCOME',
      displayOrder: 102,
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({ code: 'REFERENCE_NAME_CONFLICT' });

    const sameNameOtherType = await createCategory({
      name: 'Доход API',
      categoryType: 'EXPENSE',
      displayOrder: 102,
    });
    expect(sameNameOtherType.statusCode).toBe(201);
    expect((await getCategory(expenseCategory.id)).statusCode).toBe(200);

    const foreignParent = await prisma.category.create({
      data: {
        id: randomUUID(),
        budgetId: otherBudgetId,
        name: 'Чужой родитель API',
        categoryType: 'EXPENSE',
        displayOrder: 0,
      },
    });
    const invalidForeignParent = await createCategory({
      name: 'Чужая связь API',
      categoryType: 'EXPENSE',
      parentId: foreignParent.id,
      displayOrder: 103,
    });
    expect(invalidForeignParent.statusCode).toBe(400);
    expect(invalidForeignParent.json()).toMatchObject({ code: 'REFERENCE_INVALID' });

    const invalidParentType = await createCategory({
      name: 'Неверный родитель API',
      categoryType: 'EXPENSE',
      parentId: incomeCategory.id,
      displayOrder: 103,
    });
    expect(invalidParentType.statusCode).toBe(400);
    expect(invalidParentType.json()).toMatchObject({ code: 'REFERENCE_INVALID' });

    const child = await createCategory({
      name: 'Дочерний расход API',
      categoryType: 'EXPENSE',
      parentId: expenseCategory.id,
      displayOrder: 104,
    });
    const childCategory = child.json<{ id: string }>();
    expect(child.statusCode).toBe(201);

    const archiveWithChild = await archiveCategory(expenseCategory.id);
    expect(archiveWithChild.statusCode).toBe(400);
    expect(archiveWithChild.json()).toMatchObject({ code: 'REFERENCE_INVALID' });

    const cycle = await updateCategory(expenseCategory.id, { parentId: childCategory.id });
    expect(cycle.statusCode).toBe(400);
    expect(cycle.json()).toMatchObject({ code: 'REFERENCE_INVALID' });

    const selfReference = await updateCategory(childCategory.id, { parentId: childCategory.id });
    expect(selfReference.statusCode).toBe(400);
    expect(selfReference.json()).toMatchObject({ code: 'REFERENCE_INVALID' });

    const archivedParent = await createCategory({
      name: 'Архивный родитель API',
      categoryType: 'EXPENSE',
      displayOrder: 105,
    });
    const archivedParentCategory = archivedParent.json<{ id: string }>();
    expect((await archiveCategory(archivedParentCategory.id)).statusCode).toBe(200);
    const archivedParentReference = await createCategory({
      name: 'Связь с архивным API',
      categoryType: 'EXPENSE',
      parentId: archivedParentCategory.id,
      displayOrder: 106,
    });
    expect(archivedParentReference.statusCode).toBe(400);
    expect(archivedParentReference.json()).toMatchObject({ code: 'REFERENCE_INVALID' });

    const updated = await updateCategory(childCategory.id, {
      name: 'Обновлённый дочерний расход API',
      comment: 'Не попадёт в аудит',
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ name: 'Обновлённый дочерний расход API' });

    const other = await login(otherEmail);
    const foreign = await server.inject({
      method: 'GET',
      url: `/api/v1/budgets/${ownerBudgetId}/categories/${childCategory.id}`,
      cookies: { harmofin_session: other.cookie },
    });
    const foreignList = await server.inject({
      method: 'GET',
      url: `/api/v1/budgets/${ownerBudgetId}/categories`,
      cookies: { harmofin_session: other.cookie },
    });
    expect(foreign.statusCode).toBe(404);
    expect(foreignList.statusCode).toBe(404);

    const editorRole = await prisma.workspaceMembership.updateMany({
      where: { userId: ownerId, workspaceId: ownerWorkspaceId },
      data: { role: 'EDITOR' },
    });
    expect(editorRole.count).toBe(1);
    const editorResponse = await createCategory({
      name: 'Недоступная категория API',
      categoryType: 'EXPENSE',
      displayOrder: 105,
    });
    await prisma.workspaceMembership.updateMany({
      where: { userId: ownerId, workspaceId: ownerWorkspaceId },
      data: { role: 'OWNER' },
    });
    expect(editorResponse.statusCode).toBe(403);

    const viewerRole = await prisma.workspaceMembership.updateMany({
      where: { userId: ownerId, workspaceId: ownerWorkspaceId },
      data: { role: 'VIEWER' },
    });
    expect(viewerRole.count).toBe(1);
    const viewerResponse = await createCategory({
      name: 'Категория только для просмотра API',
      categoryType: 'EXPENSE',
      displayOrder: 107,
    });
    await prisma.workspaceMembership.updateMany({
      where: { userId: ownerId, workspaceId: ownerWorkspaceId },
      data: { role: 'OWNER' },
    });
    expect(viewerResponse.statusCode).toBe(403);

    const noOrigin = await server.inject({
      method: 'PATCH',
      url: `/api/v1/budgets/${ownerBudgetId}/categories/${childCategory.id}`,
      cookies: { harmofin_session: ownerCookie },
      payload: { displayOrder: 106 },
    });
    const missingCsrf = await server.inject({
      method: 'PATCH',
      url: `/api/v1/budgets/${ownerBudgetId}/categories/${childCategory.id}`,
      headers: { origin },
      cookies: { harmofin_session: ownerCookie },
      payload: { displayOrder: 106 },
    });
    expect(noOrigin.json()).toMatchObject({ code: 'ORIGIN_REQUIRED' });
    expect(missingCsrf.json()).toMatchObject({ code: 'CSRF_INVALID' });

    const archivedChild = await archiveCategory(childCategory.id);
    const archivedChildAgain = await archiveCategory(childCategory.id);
    expect(archivedChild.statusCode).toBe(200);
    expect(archivedChildAgain.statusCode).toBe(200);
    expect((await listCategories('EXPENSE', 'archived')).json()).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: childCategory.id })]),
    );
    expect((await listCategories('EXPENSE', 'all')).json()).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: childCategory.id })]),
    );
    expect(
      await prisma.auditEvent.count({
        where: {
          budgetId: ownerBudgetId,
          entityType: 'category',
          entityId: childCategory.id,
          action: 'ARCHIVED',
        },
      }),
    ).toBe(1);

    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { budgetId: ownerBudgetId, entityType: 'category', entityId: childCategory.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(JSON.stringify(audit.oldValues)).not.toContain('comment');
    expect(JSON.stringify(audit.newValues)).not.toContain('comment');

    const reused = await createCategory({
      name: 'Обновлённый дочерний расход API',
      categoryType: 'EXPENSE',
      displayOrder: 107,
    });
    expect(reused.statusCode).toBe(201);
  });

  it('creates, updates, archives and scopes envelopes', async () => {
    const defaults = await listEnvelopes('active');
    expect(defaults.statusCode).toBe(200);
    expect(defaults.json()).toHaveLength(6);

    const negativePlanned = await createEnvelope({ monthlyPlannedAmount: '-0.01' });
    const negativeTarget = await createEnvelope({ targetAmount: '-0.01' });
    const dateWithoutTarget = await createEnvelope({ targetDate: '2027-01-01' });
    expect(negativePlanned.statusCode).toBe(400);
    expect(negativePlanned.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(negativeTarget.statusCode).toBe(400);
    expect(dateWithoutTarget.statusCode).toBe(400);
    expect(dateWithoutTarget.json()).toMatchObject({ code: 'VALIDATION_FAILED' });

    const types = [
      'CURRENT_EXPENSES',
      'MANDATORY_EXPENSES',
      'SAVINGS_GOAL',
      'RESERVE',
      'FREE_MONEY',
      'CUSTOM',
    ];
    const created = await Promise.all(
      types.map((envelopeType, index) =>
        createEnvelope({
          name: `Конверт API ${envelopeType}`,
          envelopeType,
          startingBalance: index === 0 ? '-90071992547409.93' : '0.01',
          monthlyPlannedAmount: index === 0 ? '500.50' : null,
          targetAmount: index === 0 ? '1000.00' : null,
          targetDate: index === 0 ? '2027-01-01' : null,
          displayOrder: 100 + index,
        }),
      ),
    );
    for (const response of created) expect(response.statusCode).toBe(201);

    const envelope = created[0]!.json<{
      id: string;
      startingBalanceMinor: string;
      currentBalanceMinor: string;
      monthlyPlannedAmountMinor: string | null;
      targetAmountMinor: string | null;
      targetDate: string | null;
    }>();
    expect(envelope).toMatchObject({
      startingBalanceMinor: '-9007199254740993',
      currentBalanceMinor: '-9007199254740993',
      monthlyPlannedAmountMinor: '50050',
      targetAmountMinor: '100000',
      targetDate: '2027-01-01',
    });
    expect((await getEnvelope(envelope.id)).statusCode).toBe(200);
    expect((await listEnvelopes('active')).json()).toEqual(
      expect.arrayContaining(
        types.map((envelopeType) => expect.objectContaining({ envelopeType })),
      ),
    );

    const duplicate = await createEnvelope({
      name: 'Конверт API CURRENT_EXPENSES',
      envelopeType: 'CUSTOM',
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({ code: 'REFERENCE_NAME_CONFLICT' });

    const targetDateRemoved = await updateEnvelope(envelope.id, { targetDate: null });
    expect(targetDateRemoved.statusCode).toBe(200);
    expect(targetDateRemoved.json()).toMatchObject({
      targetAmountMinor: '100000',
      targetDate: null,
    });
    const targetDateRestored = await updateEnvelope(envelope.id, { targetDate: '2028-01-01' });
    expect(targetDateRestored.statusCode).toBe(200);
    const targetAmountRemovedTooSoon = await updateEnvelope(envelope.id, { targetAmount: null });
    expect(targetAmountRemovedTooSoon.statusCode).toBe(400);
    expect(targetAmountRemovedTooSoon.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
    const targetDateRemovedAgain = await updateEnvelope(envelope.id, { targetDate: null });
    expect(targetDateRemovedAgain.statusCode).toBe(200);
    const targetAmountRemoved = await updateEnvelope(envelope.id, { targetAmount: null });
    expect(targetAmountRemoved.statusCode).toBe(200);
    expect(targetAmountRemoved.json()).toMatchObject({ targetAmountMinor: null, targetDate: null });

    const noOrigin = await server.inject({
      method: 'PATCH',
      url: `/api/v1/budgets/${ownerBudgetId}/envelopes/${envelope.id}`,
      cookies: { harmofin_session: ownerCookie },
      payload: { displayOrder: 200 },
    });
    const missingCsrf = await server.inject({
      method: 'PATCH',
      url: `/api/v1/budgets/${ownerBudgetId}/envelopes/${envelope.id}`,
      headers: { origin },
      cookies: { harmofin_session: ownerCookie },
      payload: { displayOrder: 200 },
    });
    expect(noOrigin.json()).toMatchObject({ code: 'ORIGIN_REQUIRED' });
    expect(missingCsrf.json()).toMatchObject({ code: 'CSRF_INVALID' });

    const foreignEnvelope = await prisma.envelope.create({
      data: {
        id: randomUUID(),
        budgetId: otherBudgetId,
        name: 'Чужой конверт API',
        envelopeType: 'CUSTOM',
        startingBalanceMinor: 0n,
        displayOrder: 0,
      },
    });
    const foreignId = await getEnvelope(foreignEnvelope.id);
    const other = await login(otherEmail);
    const foreignBudget = await server.inject({
      method: 'GET',
      url: `/api/v1/budgets/${ownerBudgetId}/envelopes/${envelope.id}`,
      cookies: { harmofin_session: other.cookie },
    });
    const foreignList = await server.inject({
      method: 'GET',
      url: `/api/v1/budgets/${ownerBudgetId}/envelopes`,
      cookies: { harmofin_session: other.cookie },
    });
    expect(foreignId.statusCode).toBe(404);
    expect(foreignBudget.statusCode).toBe(404);
    expect(foreignList.statusCode).toBe(404);

    const editorRole = await prisma.workspaceMembership.updateMany({
      where: { userId: ownerId, workspaceId: ownerWorkspaceId },
      data: { role: 'EDITOR' },
    });
    expect(editorRole.count).toBe(1);
    const editorResponse = await createEnvelope({ name: 'Недоступный конверт API' });
    await prisma.workspaceMembership.updateMany({
      where: { userId: ownerId, workspaceId: ownerWorkspaceId },
      data: { role: 'OWNER' },
    });
    expect(editorResponse.statusCode).toBe(403);

    const viewerRole = await prisma.workspaceMembership.updateMany({
      where: { userId: ownerId, workspaceId: ownerWorkspaceId },
      data: { role: 'VIEWER' },
    });
    expect(viewerRole.count).toBe(1);
    const viewerResponse = await createEnvelope({ name: 'Конверт только для просмотра API' });
    await prisma.workspaceMembership.updateMany({
      where: { userId: ownerId, workspaceId: ownerWorkspaceId },
      data: { role: 'OWNER' },
    });
    expect(viewerResponse.statusCode).toBe(403);

    const archived = await archiveEnvelope(envelope.id);
    const archivedAgain = await archiveEnvelope(envelope.id);
    expect(archived.statusCode).toBe(200);
    expect(archivedAgain.statusCode).toBe(200);
    expect((await listEnvelopes('archived')).json()).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: envelope.id })]),
    );
    expect((await listEnvelopes('all')).json()).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: envelope.id })]),
    );
    expect(
      await prisma.auditEvent.count({
        where: {
          budgetId: ownerBudgetId,
          entityType: 'envelope',
          entityId: envelope.id,
          action: 'ARCHIVED',
        },
      }),
    ).toBe(1);

    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { budgetId: ownerBudgetId, entityType: 'envelope', entityId: envelope.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(JSON.stringify(audit.oldValues)).not.toContain('comment');
    expect(JSON.stringify(audit.newValues)).not.toContain('comment');
    expect(JSON.stringify(audit.newValues)).not.toContain('currentBalanceMinor');

    const reused = await createEnvelope({
      name: 'Конверт API CURRENT_EXPENSES',
      envelopeType: 'CURRENT_EXPENSES',
    });
    expect(reused.statusCode).toBe(201);
  });

  it('never duplicates or resurrects manually archived defaults', async () => {
    const vacation = await prisma.envelope.findFirstOrThrow({
      where: { budgetId: ownerBudgetId, templateKey: 'envelope-vacation' },
    });
    await prisma.envelope.update({ where: { id: vacation.id }, data: { archivedAt: new Date() } });

    const response = await initializeTemplate(ownerBudgetId, ownerCookie, ownerCsrf);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      createdCategoryKeys: [],
      existingCategoryKeys: expect.arrayContaining(incomeKeys),
      createdEnvelopeKeys: [],
      existingEnvelopeKeys: expect.arrayContaining(envelopeKeys),
    });
    expect(
      await prisma.envelope.count({
        where: { budgetId: ownerBudgetId, templateKey: 'envelope-vacation' },
      }),
    ).toBe(1);
    expect(
      (await prisma.envelope.findUniqueOrThrow({ where: { id: vacation.id } })).archivedAt,
    ).not.toBeNull();
  });

  it('returns 403 for an accessible non-owner and 404 for another budget', async () => {
    await prisma.workspaceMembership.updateMany({
      where: { userId: ownerId, workspaceId: ownerWorkspaceId },
      data: { role: 'EDITOR' },
    });
    const editorResponse = await initializeTemplate(ownerBudgetId, ownerCookie, ownerCsrf);
    await prisma.workspaceMembership.updateMany({
      where: { userId: ownerId, workspaceId: ownerWorkspaceId },
      data: { role: 'OWNER' },
    });
    const other = await login(otherEmail);
    const foreignResponse = await initializeTemplate(ownerBudgetId, other.cookie, other.csrfToken);

    expect(editorResponse.statusCode).toBe(403);
    expect(editorResponse.json()).toMatchObject({ code: 'FORBIDDEN' });
    expect(foreignResponse.statusCode).toBe(404);
    expect(foreignResponse.json()).toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

  it('adopts a pre-existing category or envelope with a default name instead of duplicating it', async () => {
    // The database enforces case-insensitive name uniqueness per budget, so a default whose
    // name the user (or an older template revision) already used must reuse that row rather
    // than fail the whole transaction.
    const conflictBudget = await prisma.budget.create({
      data: { id: randomUUID(), workspaceId: ownerWorkspaceId, name: `Конфликт ${randomUUID()}` },
    });
    const preexistingCategory = await prisma.category.create({
      data: {
        id: randomUUID(),
        budgetId: conflictBudget.id,
        name: 'Зарплата',
        categoryType: 'INCOME',
        displayOrder: 0,
      },
    });
    const preexistingEnvelope = await prisma.envelope.create({
      data: {
        id: randomUUID(),
        budgetId: conflictBudget.id,
        name: 'Отпуск',
        envelopeType: 'SAVINGS_GOAL',
        startingBalanceMinor: 0n,
        displayOrder: 0,
      },
    });

    const response = await initializeTemplate(conflictBudget.id, ownerCookie, ownerCsrf);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      createdCategoryKeys: expect.not.arrayContaining(['income-group-salary']),
      existingCategoryKeys: expect.arrayContaining(['income-group-salary']),
      createdEnvelopeKeys: expect.not.arrayContaining(['envelope-vacation']),
      existingEnvelopeKeys: expect.arrayContaining(['envelope-vacation']),
    });
    expect(
      await prisma.category.count({ where: { budgetId: conflictBudget.id, name: 'Зарплата' } }),
    ).toBe(1);
    expect(
      await prisma.category.findUniqueOrThrow({ where: { id: preexistingCategory.id } }),
    ).toMatchObject({ templateKey: 'income-group-salary' });
    expect(
      await prisma.envelope.count({ where: { budgetId: conflictBudget.id, name: 'Отпуск' } }),
    ).toBe(1);
    expect(
      await prisma.envelope.findUniqueOrThrow({ where: { id: preexistingEnvelope.id } }),
    ).toMatchObject({ templateKey: 'envelope-vacation' });
    const advance = await prisma.category.findFirstOrThrow({
      where: { budgetId: conflictBudget.id, templateKey: 'income-advance' },
    });
    expect(advance.parentId).toBe(preexistingCategory.id);
  });

  it('persists an icon value directly on the category row', async () => {
    const created = await prisma.category.create({
      data: {
        id: randomUUID(),
        budgetId: ownerBudgetId,
        name: `Иконка-тест ${randomUUID()}`,
        categoryType: 'EXPENSE',
        displayOrder: 999,
        icon: 'shopping-cart',
      },
    });
    expect(created.icon).toBe('shopping-cart');

    const withoutIcon = await prisma.category.create({
      data: {
        id: randomUUID(),
        budgetId: ownerBudgetId,
        name: `Без иконки-тест ${randomUUID()}`,
        categoryType: 'EXPENSE',
        displayOrder: 998,
      },
    });
    expect(withoutIcon.icon).toBeNull();
  });
});

type OpenApiSchema = {
  $ref?: string;
  type?: string;
  items?: OpenApiSchema;
};

type OpenApiResponse = {
  content?: Record<string, { schema?: OpenApiSchema }>;
};

type OpenApiOperation = {
  security?: Array<Record<string, string[]>>;
  requestBody?: { content?: Record<string, { schema?: OpenApiSchema }> };
  responses?: Record<string, OpenApiResponse>;
};

type OpenApiDocument = {
  paths: Record<string, Partial<Record<'get' | 'post' | 'patch', OpenApiOperation>>>;
  components: {
    securitySchemes: Record<string, { type?: string; in?: string; name?: string }>;
    schemas: Record<string, OpenApiSchema>;
  };
};

function operation(
  document: OpenApiDocument,
  path: string,
  method: 'get' | 'post' | 'patch',
): OpenApiOperation {
  const result = document.paths[path]?.[method];
  expect(result).toBeDefined();
  return result!;
}

function reference(name: string): OpenApiSchema {
  return { $ref: `#/components/schemas/${name}` };
}

function arrayOf(items: OpenApiSchema): OpenApiSchema {
  return { type: 'array', items };
}

function expectAuthenticated(operation: OpenApiOperation): void {
  expect(operation.security).toEqual([{ session: [] }]);
}

function expectRequestBodySchema(operation: OpenApiOperation, schema: OpenApiSchema): void {
  expect(operation.requestBody?.content?.['application/json']?.schema).toEqual(schema);
}

function expectResponseSchema(
  operation: OpenApiOperation,
  status: string,
  schema: OpenApiSchema,
): void {
  expect(operation.responses?.[status]?.content?.['application/json']?.schema).toEqual(schema);
}

function expectProblemDetails(operation: OpenApiOperation, statuses: readonly string[]): void {
  for (const status of statuses) {
    expectResponseSchema(operation, status, reference('ProblemDetailsResponse'));
  }
}

async function createCategory(overrides: Record<string, unknown> = {}) {
  return server.inject({
    method: 'POST',
    url: `/api/v1/budgets/${ownerBudgetId}/categories`,
    headers: { origin, 'x-csrf-token': ownerCsrf },
    cookies: { harmofin_session: ownerCookie },
    payload: {
      name: 'Категория API',
      categoryType: 'EXPENSE',
      displayOrder: 0,
      comment: 'Личный комментарий',
      ...overrides,
    },
  });
}

async function listCategories(
  type: 'INCOME' | 'EXPENSE' | undefined,
  status: 'active' | 'archived' | 'all',
) {
  const query = new URLSearchParams({ status });
  if (type) query.set('type', type);
  return server.inject({
    method: 'GET',
    url: `/api/v1/budgets/${ownerBudgetId}/categories?${query.toString()}`,
    cookies: { harmofin_session: ownerCookie },
  });
}

async function getCategory(categoryId: string) {
  return server.inject({
    method: 'GET',
    url: `/api/v1/budgets/${ownerBudgetId}/categories/${categoryId}`,
    cookies: { harmofin_session: ownerCookie },
  });
}

async function updateCategory(categoryId: string, payload: Record<string, unknown>) {
  return server.inject({
    method: 'PATCH',
    url: `/api/v1/budgets/${ownerBudgetId}/categories/${categoryId}`,
    headers: { origin, 'x-csrf-token': ownerCsrf },
    cookies: { harmofin_session: ownerCookie },
    payload,
  });
}

async function archiveCategory(categoryId: string) {
  return server.inject({
    method: 'POST',
    url: `/api/v1/budgets/${ownerBudgetId}/categories/${categoryId}/archive`,
    headers: { origin, 'x-csrf-token': ownerCsrf },
    cookies: { harmofin_session: ownerCookie },
  });
}

async function createAccount(overrides: Record<string, unknown> = {}) {
  return server.inject({
    method: 'POST',
    url: `/api/v1/budgets/${ownerBudgetId}/accounts`,
    headers: { origin, 'x-csrf-token': ownerCsrf },
    cookies: { harmofin_session: ownerCookie },
    payload: {
      name: 'Основной счёт',
      accountType: 'BANK_ACCOUNT',
      bankName: 'Банк',
      lastFourDigits: '1234',
      currency: 'RUB',
      startingBalance: '0.00',
      accountingStartDate: '2026-09-01',
      comment: 'Личный комментарий',
      ...overrides,
    },
  });
}

async function listAccounts(status: 'active' | 'archived' | 'all') {
  return server.inject({
    method: 'GET',
    url: `/api/v1/budgets/${ownerBudgetId}/accounts?status=${status}`,
    cookies: { harmofin_session: ownerCookie },
  });
}

async function getAccount(accountId: string) {
  return server.inject({
    method: 'GET',
    url: `/api/v1/budgets/${ownerBudgetId}/accounts/${accountId}`,
    cookies: { harmofin_session: ownerCookie },
  });
}

async function updateAccount(accountId: string, payload: Record<string, unknown>) {
  return server.inject({
    method: 'PATCH',
    url: `/api/v1/budgets/${ownerBudgetId}/accounts/${accountId}`,
    headers: { origin, 'x-csrf-token': ownerCsrf },
    cookies: { harmofin_session: ownerCookie },
    payload,
  });
}

async function archiveAccount(accountId: string) {
  return server.inject({
    method: 'POST',
    url: `/api/v1/budgets/${ownerBudgetId}/accounts/${accountId}/archive`,
    headers: { origin, 'x-csrf-token': ownerCsrf },
    cookies: { harmofin_session: ownerCookie },
  });
}

async function createEnvelope(overrides: Record<string, unknown> = {}) {
  return server.inject({
    method: 'POST',
    url: `/api/v1/budgets/${ownerBudgetId}/envelopes`,
    headers: { origin, 'x-csrf-token': ownerCsrf },
    cookies: { harmofin_session: ownerCookie },
    payload: {
      name: 'Конверт API',
      envelopeType: 'CUSTOM',
      currency: 'RUB',
      startingBalance: '0.00',
      displayOrder: 0,
      comment: 'Личный комментарий',
      ...overrides,
    },
  });
}

async function listEnvelopes(status: 'active' | 'archived' | 'all') {
  return server.inject({
    method: 'GET',
    url: `/api/v1/budgets/${ownerBudgetId}/envelopes?status=${status}`,
    cookies: { harmofin_session: ownerCookie },
  });
}

async function getEnvelope(envelopeId: string) {
  return server.inject({
    method: 'GET',
    url: `/api/v1/budgets/${ownerBudgetId}/envelopes/${envelopeId}`,
    cookies: { harmofin_session: ownerCookie },
  });
}

async function updateEnvelope(envelopeId: string, payload: Record<string, unknown>) {
  return server.inject({
    method: 'PATCH',
    url: `/api/v1/budgets/${ownerBudgetId}/envelopes/${envelopeId}`,
    headers: { origin, 'x-csrf-token': ownerCsrf },
    cookies: { harmofin_session: ownerCookie },
    payload,
  });
}

async function archiveEnvelope(envelopeId: string) {
  return server.inject({
    method: 'POST',
    url: `/api/v1/budgets/${ownerBudgetId}/envelopes/${envelopeId}/archive`,
    headers: { origin, 'x-csrf-token': ownerCsrf },
    cookies: { harmofin_session: ownerCookie },
  });
}

async function initializeTemplate(budgetId: string, cookie: string, csrfToken: string) {
  return server.inject({
    method: 'POST',
    url: `/api/v1/budgets/${budgetId}/reference-template`,
    headers: { origin, 'x-csrf-token': csrfToken },
    cookies: { harmofin_session: cookie },
  });
}

async function register(email: string) {
  const response = await server.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    headers: { origin },
    payload: { email, password },
  });
  const body = response.json<{
    user: { id: string };
    workspace: { id: string };
    budget: { id: string };
    csrfToken: string;
  }>();
  const cookie = response.cookies.find((item) => item.name === 'harmofin_session')?.value;
  if (!cookie) throw new Error('Missing session cookie');
  return { ...body, cookie };
}

async function login(email: string) {
  const response = await server.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { origin },
    payload: { email, password },
  });
  const body = response.json<{ csrfToken: string }>();
  const cookie = response.cookies.find((item) => item.name === 'harmofin_session')?.value;
  if (!cookie) throw new Error('Missing session cookie');
  return { ...body, cookie };
}

async function cleanupUser(userId: string) {
  if (!userId) return;
  await prisma.auditEvent.deleteMany({ where: { actorUserId: userId } });
  await prisma.session.deleteMany({ where: { userId } });
  await prisma.recoveryToken.deleteMany({ where: { userId } });
  const memberships = await prisma.workspaceMembership.findMany({
    where: { userId },
    select: { workspaceId: true },
  });
  await prisma.workspaceMembership.deleteMany({ where: { userId } });
  for (const { workspaceId } of memberships) {
    await prisma.budget.updateMany({
      where: { workspaceId },
      data: {
        incomeAllocationSourceCategoryId: null,
        incomeAllocationTargetEnvelopeId: null,
      },
    });
    await prisma.account.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.category.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.envelope.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.budget.deleteMany({ where: { workspaceId } });
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
  }
  await prisma.user.deleteMany({ where: { id: userId } });
}
