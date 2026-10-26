import { randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiApp } from '../src/app.js';
import { loadApiConfig } from '../src/config/env.js';
import { DEFAULT_CATEGORIES } from '../src/v2-template/default-categories.js';

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

describe('reference data API', () => {
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
    await seedDefaultCategories(ownerBudgetId);
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

    for (const resource of [
      {
        collectionPath: '/api/v1/budgets/{budgetId}/accounts',
        itemPath: '/api/v1/budgets/{budgetId}/accounts/{accountId}',
        response: 'AccountResponse',
        create: 'CreateAccountRequest',
        update: 'UpdateAccountRequest',
        archiveErrors: ['401', '403', '404', '409'],
      },
      {
        collectionPath: '/api/v1/budgets/{budgetId}/categories',
        itemPath: '/api/v1/budgets/{budgetId}/categories/{categoryId}',
        response: 'CategoryResponse',
        create: 'CreateCategoryRequest',
        update: 'UpdateCategoryRequest',
        archiveErrors: ['400', '401', '403', '404'],
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

    const restore = operation(
      document,
      '/api/v1/budgets/{budgetId}/accounts/{accountId}/restore',
      'post',
    );
    expectAuthenticated(restore);
    expectResponseSchema(restore, '200', reference('AccountResponse'));
    expectProblemDetails(restore, ['401', '403', '404', '409']);
  });

  it('assigns an icon to every default leaf category and none to groups', async () => {
    const groceries = await prisma.category.findFirstOrThrow({
      where: { budgetId: ownerBudgetId, templateKey: 'expense-groceries' },
    });
    expect(groceries.icon).toBe('shopping-cart');

    const salaryGroup = await prisma.category.findFirstOrThrow({
      where: { budgetId: ownerBudgetId, templateKey: 'income-group-salary' },
    });
    expect(salaryGroup.icon).toBeNull();

    // Scoped to templateKey (default) rows only — other tests in this shared-budget
    // file create their own custom child categories with no icon, which is legitimate
    // and must not be flagged here.
    const templateLeavesWithoutIcon = await prisma.category.count({
      where: {
        budgetId: ownerBudgetId,
        templateKey: { not: null },
        parentId: { not: null },
        icon: null,
      },
    });
    expect(templateLeavesWithoutIcon).toBe(0);
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

    await prisma.budget.update({
      where: { id: ownerBudgetId },
      data: { allowNegativeBalance: true },
    });

    const updated = await updateAccount(account.id, { startingBalance: '1.00' });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      startingBalanceMinor: '100',
      currentBalanceMinor: '100',
    });

    // Stage B: EDITOR may create accounts (owner.application.service.ts task 3); only a
    // non-writer (VIEWER) is rejected.
    const viewerRole = await prisma.workspaceMembership.updateMany({
      where: { userId: ownerId, workspaceId: ownerWorkspaceId },
      data: { role: 'VIEWER' },
    });
    expect(viewerRole.count).toBe(1);
    const viewerResponse = await createAccount({ name: 'Недоступный счёт' });
    await prisma.workspaceMembership.updateMany({
      where: { userId: ownerId, workspaceId: ownerWorkspaceId },
      data: { role: 'OWNER' },
    });
    expect(viewerResponse.statusCode).toBe(403);

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

    // Archiving a non-zero account is refused for model 2 budgets, so empty it first.
    await prisma.account.update({ where: { id: account.id }, data: { startingBalanceMinor: 0n } });
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

  it('validates icon against the allow-list and forbids it on categories with active children', async () => {
    const unknownIcon = await createCategory({
      name: `Неизвестная иконка ${randomUUID()}`,
      icon: 'not-a-real-icon',
    });
    expect(unknownIcon.statusCode).toBe(400);
    expect(unknownIcon.json()).toMatchObject({ code: 'VALIDATION_FAILED' });

    // A freshly created, childless category may have an icon even without a parent —
    // it isn't a group yet (mirrors the pre-existing standalone `expense-other` default).
    const rootWithIcon = await createCategory({
      name: `Корневая с иконкой ${randomUUID()}`,
      icon: 'shopping-cart',
    });
    expect(rootWithIcon.statusCode).toBe(201);
    expect(rootWithIcon.json()).toMatchObject({ icon: 'shopping-cart' });

    const parent = await createCategory({ name: `Родитель для иконки ${randomUUID()}` });
    const parentCategory = parent.json<{ id: string }>();

    // Keeps parentCategory "occupied" as a group with an active child through the rest
    // of this test, independent of what happens to the other leaf below.
    const keeper = await createCategory({
      name: `Хранитель родителя ${randomUUID()}`,
      parentId: parentCategory.id,
    });
    expect(keeper.statusCode).toBe(201);

    const leafWithIcon = await createCategory({
      name: `Лист с иконкой ${randomUUID()}`,
      parentId: parentCategory.id,
      icon: 'shopping-cart',
    });
    expect(leafWithIcon.statusCode).toBe(201);
    expect(leafWithIcon.json()).toMatchObject({ icon: 'shopping-cart' });

    const leafCategory = leafWithIcon.json<{ id: string }>();
    const updated = await updateCategory(leafCategory.id, { icon: 'wallet' });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ icon: 'wallet' });

    // Icon and parentId are independent: clearing this leaf's parent must not be blocked
    // by, or clear, its icon (it still has no children of its own).
    const clearParentKeepIcon = await updateCategory(leafCategory.id, { parentId: null });
    expect(clearParentKeepIcon.statusCode).toBe(200);
    expect(clearParentKeepIcon.json()).toMatchObject({ icon: 'wallet', parentId: null });

    const clearIcon = await updateCategory(leafCategory.id, { icon: null });
    expect(clearIcon.statusCode).toBe(200);
    expect(clearIcon.json()).toMatchObject({ icon: null });

    // parentCategory still has an active child (`keeper`), so it's a group in use —
    // giving it an icon must be rejected.
    const rejectIconOnGroup = await updateCategory(parentCategory.id, { icon: 'wallet' });
    expect(rejectIconOnGroup.statusCode).toBe(400);
    expect(rejectIconOnGroup.json()).toMatchObject({ code: 'REFERENCE_INVALID' });
  });

  it('allows updating the parentless default "Прочее" category without disturbing its icon', async () => {
    const other = await prisma.category.findFirstOrThrow({
      where: { budgetId: ownerBudgetId, templateKey: 'expense-other' },
    });
    expect(other.parentId).toBeNull();
    expect(other.icon).toBe('ellipsis');

    const response = await updateCategory(other.id, { comment: 'Обновлённый комментарий' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ icon: 'ellipsis', comment: 'Обновлённый комментарий' });
  });

  it('clears a category icon automatically when it gains a child', async () => {
    const futureParent = await createCategory({
      name: `Будущий родитель ${randomUUID()}`,
      icon: 'utensils',
    });
    const futureParentCategory = futureParent.json<{ id: string; icon: string }>();
    expect(futureParentCategory.icon).toBe('utensils');

    const child = await createCategory({
      name: `Новый ребёнок ${randomUUID()}`,
      parentId: futureParentCategory.id,
    });
    expect(child.statusCode).toBe(201);

    const parentAfter = await getCategory(futureParentCategory.id);
    expect(parentAfter.json()).toMatchObject({ icon: null });

    // The parent must now be freely updatable (no lockout) even without touching icon.
    const rename = await updateCategory(futureParentCategory.id, {
      name: `Переименован ${randomUUID()}`,
    });
    expect(rename.statusCode).toBe(200);
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

/** Test fixture: the default category tree the removed v1 template endpoint used to create. */
async function seedDefaultCategories(budgetId: string): Promise<void> {
  const ids = new Map<string, string>();
  for (const category of DEFAULT_CATEGORIES) {
    const id = randomUUID();
    ids.set(category.templateKey, id);
    await prisma.category.create({
      data: {
        id,
        budgetId,
        name: category.name,
        categoryType: category.categoryType,
        templateKey: category.templateKey,
        parentId: category.parentTemplateKey ? ids.get(category.parentTemplateKey)! : null,
        comment: category.comment,
        icon: category.icon,
        displayOrder: category.displayOrder,
      },
    });
  }
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
