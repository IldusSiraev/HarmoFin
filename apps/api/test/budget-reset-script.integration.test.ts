import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiApp } from '../src/app.js';
import { loadApiConfig } from '../src/config/env.js';
import { todayInTimezone } from '../src/cycles/cycle-period.domain.js';
import { assertDisposableDatabase } from './helpers/disposable-db.js';

const databaseUrl = assertDisposableDatabase(
  process.env.DATABASE_URL ??
    'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin_v22_test',
);
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const origin = 'http://localhost:3000';
const password = 'correct-password-10';
const sqlTemplate = readFileSync(
  new URL('../../../docs/runbooks/budget-reset.sql', import.meta.url),
  'utf8',
);

type Fixture = {
  email: string;
  userId: string;
  workspaceId: string;
  budgetId: string;
  cookie: string;
  csrfToken: string;
};

const emails = {
  a: `reset-a-${randomUUID()}@harmofin.test`,
  b: `reset-b-${randomUUID()}@harmofin.test`,
  c: `reset-c-${randomUUID()}@harmofin.test`,
  d: `reset-d-${randomUUID()}@harmofin.test`,
  e: `reset-e-${randomUUID()}@harmofin.test`,
  f: `reset-f-${randomUUID()}@harmofin.test`,
};
const ctx = {} as Record<keyof typeof emails, Fixture>;
let app: NestFastifyApplication;
let server: FastifyInstance;
let extraBudgetId = '';
const budgetTimezone = 'Asia/Vladivostok';

function buildSql(email: string, commit: boolean): string {
  const sql = sqlTemplate
    .replace(/target_email\s+text\s+:=\s+'[^']*';/, `target_email   text    := '${email}';`)
    .replace(
      /commit_changes\s+boolean\s+:=\s+(true|false);/,
      `commit_changes boolean := ${commit};`,
    );
  expect(sql).toContain(`'${email}'`);
  expect(sql).toContain(`commit_changes boolean := ${commit};`);
  return sql;
}

async function budgetTables(): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ table_name: string }>>`
    SELECT DISTINCT c.table_name FROM information_schema.columns c
      JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
     WHERE c.table_schema = 'public' AND c.column_name = 'budget_id' AND t.table_type = 'BASE TABLE'
     ORDER BY 1`;
  return rows.map((row) => row.table_name);
}

async function counts(budgetId: string): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const table of await budgetTables()) {
    const rows = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
      `SELECT count(*)::int AS n FROM "${table}" WHERE budget_id = $1::uuid`,
      budgetId,
    );
    result[table] = rows[0]!.n;
  }
  return result;
}

async function rowJson(table: string, column: string, value: string): Promise<unknown> {
  return prisma.$queryRawUnsafe(
    `SELECT to_jsonb(t) AS j FROM "${table}" t WHERE ${column} = $1::uuid ORDER BY id`,
    value,
  );
}

async function identity(f: Fixture): Promise<unknown> {
  return {
    user: await rowJson('users', 'id', f.userId),
    sessions: await rowJson('sessions', 'user_id', f.userId),
    workspace: await rowJson('workspaces', 'id', f.workspaceId),
    memberships: await rowJson('workspace_memberships', 'workspace_id', f.workspaceId),
  };
}

async function register(email: string): Promise<Fixture> {
  const response = await server.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    headers: { origin },
    payload: { email, password },
  });
  expect(response.statusCode).toBe(201);
  const body = response.json<{
    user: { id: string };
    workspace: { id: string };
    budget: { id: string };
    csrfToken: string;
  }>();
  return {
    email,
    userId: body.user.id,
    workspaceId: body.workspace.id,
    budgetId: body.budget.id,
    csrfToken: body.csrfToken,
    cookie: response.cookies.find((item) => item.name === 'harmofin_session')?.value ?? '',
  };
}

/** Rich fixture: v1-era and v2 rows in every table that has budget_id. */
async function seedBudget(f: Fixture, withRule: boolean): Promise<void> {
  const { budgetId, workspaceId, userId } = f;
  const id = () => randomUUID();
  const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
  const actor = { createdByUserId: userId, updatedByUserId: userId };
  const now = new Date();

  const [acc1, acc2] = [id(), id()];
  await prisma.account.createMany({
    data: [acc1, acc2].map((accId, i) => ({
      id: accId,
      budgetId,
      name: `Счёт ${i}`,
      accountType: 'BANK_CARD' as const,
      startingBalanceMinor: 500_000n,
      accountingStartDate: day('2026-01-01'),
    })),
  });

  const [root, child, grandchild, incomeCat] = [id(), id(), id(), id()];
  await prisma.category.create({
    data: { id: root, budgetId, name: 'Корень', categoryType: 'EXPENSE', displayOrder: 0 },
  });
  await prisma.category.create({
    data: {
      id: child,
      budgetId,
      name: 'Ребёнок',
      categoryType: 'EXPENSE',
      displayOrder: 1,
      parentId: root,
    },
  });
  await prisma.category.create({
    data: {
      id: grandchild,
      budgetId,
      name: 'Внук',
      categoryType: 'EXPENSE',
      displayOrder: 2,
      parentId: child,
    },
  });
  await prisma.category.create({
    data: { id: incomeCat, budgetId, name: 'Зарплата', categoryType: 'INCOME', displayOrder: 3 },
  });

  const [env1, env2] = [id(), id()];
  await prisma.envelope.createMany({
    data: [env1, env2].map((envId, i) => ({
      id: envId,
      budgetId,
      name: `Конверт ${i}`,
      envelopeType: 'CUSTOM' as const,
      startingBalanceMinor: 0n,
      displayOrder: i,
    })),
  });

  const [incomeTx, expenseV1, expenseV2] = [id(), id(), id()];
  const txBase = { budgetId, currency: 'RUB', status: 'CONFIRMED' as const, ...actor };
  await prisma.transaction.create({
    data: {
      ...txBase,
      id: incomeTx,
      transactionType: 'INCOME',
      accountingModelVersion: 1,
      amountMinor: 100_000n,
      occurredOn: day('2026-02-01'),
      accountId: acc1,
      categoryId: incomeCat,
      confirmedAt: now,
    },
  });
  await prisma.transaction.create({
    data: {
      ...txBase,
      id: expenseV1,
      transactionType: 'EXPENSE',
      accountingModelVersion: 1,
      amountMinor: 1_000n,
      occurredOn: day('2026-02-02'),
      accountId: acc1,
      categoryId: grandchild,
      envelopeId: env1,
      confirmedAt: now,
    },
  });
  await prisma.transaction.create({
    data: {
      ...txBase,
      id: expenseV2,
      transactionType: 'EXPENSE',
      accountingModelVersion: 2,
      amountMinor: 2_000n,
      occurredOn: day('2026-10-01'),
      accountId: acc2,
      categoryId: child,
      confirmedAt: now,
    },
  });

  await prisma.incomeAllocation.create({
    data: {
      id: id(),
      budgetId,
      incomeTransactionId: incomeTx,
      amountMinor: 50_000n,
      occurredOn: day('2026-02-01'),
      accountId: acc1,
      envelopeId: env1,
      ...actor,
    },
  });

  const legacyTransfer = id();
  await prisma.transfer.create({
    data: {
      id: legacyTransfer,
      budgetId,
      status: 'CONFIRMED',
      mode: 'LEGACY_PARTS',
      totalMinor: 3_000n,
      occurredOn: day('2026-02-03'),
      confirmedAt: now,
      ...actor,
    },
  });
  await prisma.transferPart.create({
    data: {
      id: id(),
      transferId: legacyTransfer,
      budgetId,
      sourceAccountId: acc1,
      destinationAccountId: acc2,
      sourceEnvelopeId: env1,
      destinationEnvelopeId: env2,
      amountMinor: 3_000n,
    },
  });
  await prisma.transfer.create({
    data: {
      id: id(),
      budgetId,
      status: 'CONFIRMED',
      mode: 'ACCOUNT_ONLY',
      totalMinor: 4_000n,
      occurredOn: day('2026-10-02'),
      confirmedAt: now,
      sourceAccountId: acc1,
      destinationAccountId: acc2,
      ...actor,
    },
  });

  await prisma.envelopeReallocation.create({
    data: {
      id: id(),
      budgetId,
      sourceEnvelopeId: env1,
      destinationEnvelopeId: env2,
      amountMinor: 700n,
      occurredOn: day('2026-02-04'),
      ...actor,
    },
  });

  const [period1, period2] = [id(), id()];
  await prisma.envelopePeriod.create({
    data: {
      id: period1,
      budgetId,
      envelopeId: env1,
      startsOn: day('2026-10-01'),
      endsOn: day('2026-10-14'),
      targetStatus: 'CONFIRMED',
      targetMinor: 10_000n,
      confirmedByUserId: userId,
      confirmedAt: now,
    },
  });
  await prisma.envelopePeriod.create({
    data: {
      id: period2,
      budgetId,
      envelopeId: env2,
      startsOn: day('2026-10-01'),
      endsOn: day('2026-10-14'),
    },
  });
  await prisma.envelopeFundingRule.create({
    data: { id: id(), budgetId, envelopeId: env1, type: 'MANUAL' },
  });
  await prisma.envelopeAssignment.create({
    data: {
      id: id(),
      budgetId,
      envelopeId: env1,
      type: 'INCOME',
      amountMinor: 5_000n,
      effectiveOn: day('2026-10-01'),
      periodId: period1,
      sourceIncomeTransactionId: incomeTx,
    },
  });
  await prisma.envelopeAssignment.create({
    data: {
      id: id(),
      budgetId,
      envelopeId: env2,
      type: 'OPENING',
      amountMinor: 1_000n,
      effectiveOn: day('2026-10-01'),
      periodId: period2,
    },
  });
  await prisma.envelopeMovement.create({
    data: {
      id: id(),
      budgetId,
      sourceEnvelopeId: env1,
      sourcePeriodId: period1,
      destinationEnvelopeId: env2,
      destinationPeriodId: period2,
      amountMinor: 500n,
      effectiveOn: day('2026-10-02'),
    },
  });
  await prisma.budgetCycleRevision.create({
    data: {
      id: id(),
      budgetId,
      effectiveOn: day('2026-01-01'),
      cycleStartDay: 5,
      periodBoundaryOffset: 10,
      timezone: budgetTimezone,
    },
  });

  const plan = id();
  await prisma.regularPlan.create({
    data: {
      id: plan,
      workspaceId,
      budgetId,
      name: 'Интернет',
      planType: 'EXPENSE',
      amountMinor: 900n,
      anchorOn: day('2026-01-10'),
      startOn: day('2026-01-10'),
      recurrence: 'MONTHLY',
      accountId: acc1,
      categoryId: child,
      envelopeId: env1,
      ...actor,
    },
  });
  const [occDone, occPending] = [id(), id()];
  await prisma.planOccurrence.create({
    data: {
      id: occDone,
      workspaceId,
      budgetId,
      planId: plan,
      scheduledOn: day('2026-02-10'),
      planName: 'Интернет',
      planType: 'EXPENSE',
      amountMinor: 900n,
      accountId: acc1,
      categoryId: child,
      envelopeId: env1,
      status: 'COMPLETED',
      completedAt: now,
      transactionId: expenseV1,
    },
  });
  await prisma.planOccurrence.create({
    data: {
      id: occPending,
      workspaceId,
      budgetId,
      planId: plan,
      scheduledOn: day('2026-11-10'),
      planName: 'Интернет',
      planType: 'EXPENSE',
      amountMinor: 900n,
    },
  });
  await prisma.planPayment.create({
    data: { id: id(), budgetId, occurrenceId: occPending, transactionId: expenseV2 },
  });
  await prisma.notification.create({
    data: {
      id: id(),
      workspaceId,
      budgetId,
      userId,
      notificationType: 'PLAN_UPCOMING',
      occurrenceId: occPending,
      title: 'Скоро платёж',
      body: 'Интернет',
      notificationKey: `reset-${randomUUID()}`,
    },
  });
  await prisma.auditEvent.create({
    data: {
      id: id(),
      actorUserId: userId,
      workspaceId,
      budgetId,
      entityType: 'transaction',
      entityId: expenseV2,
      action: 'create',
      source: 'test',
    },
  });
  await prisma.idempotencyRecord.create({
    data: {
      id: id(),
      budgetId,
      actorUserId: userId,
      key: randomUUID(),
      operation: 'test.operation',
      requestHash: 'a'.repeat(64),
      responseStatus: 201,
      responseBody: {},
    },
  });

  // v1-era budget settings that point at deleted objects.
  await prisma.budget.update({
    where: { id: budgetId },
    data: {
      name: 'Семейный бюджет',
      timezone: budgetTimezone,
      cycleStartDay: 5,
      periodBoundaryOffset: 10,
      allowNegativeBalance: true,
      planModelVersion: 1,
      planModelActivatedOn: null,
      incomeAllocationRuleEnabled: withRule,
      incomeAllocationSourceCategoryId: withRule ? incomeCat : null,
      incomeAllocationTargetEnvelopeId: withRule ? env1 : null,
    },
  });
}

describe('budget-reset.sql: чистый лист на модели v2', () => {
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
    for (const key of Object.keys(emails) as Array<keyof typeof emails>) {
      ctx[key] = await register(emails[key]);
    }
    await seedBudget(ctx.a, true);
    await seedBudget(ctx.b, true);
    // C: два бюджета в одном workspace, сброс должен отказаться гадать.
    await seedBudget(ctx.c, false);
    extraBudgetId = randomUUID();
    await prisma.budget.create({
      data: {
        id: extraBudgetId,
        workspaceId: ctx.c.workspaceId,
        name: 'Второй',
        planModelVersion: 1,
      },
    });
    await prisma.account.create({
      data: {
        id: randomUUID(),
        budgetId: extraBudgetId,
        name: 'Счёт второго бюджета',
        accountType: 'CASH',
        startingBalanceMinor: 1_000n,
        accountingStartDate: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    // D: активный OWNER в двух рабочих пространствах (два бюджета суммарно).
    const secondWorkspace = randomUUID();
    await prisma.workspace.create({
      data: { id: secondWorkspace, ownerId: ctx.d.userId, name: 'Второе пространство' },
    });
    await prisma.workspaceMembership.create({
      data: {
        id: randomUUID(),
        workspaceId: secondWorkspace,
        userId: ctx.d.userId,
        role: 'OWNER',
      },
    });
    await prisma.budget.create({
      data: {
        id: randomUUID(),
        workspaceId: secondWorkspace,
        name: 'Бюджет D2',
        planModelVersion: 1,
      },
    });
    // E: в рабочем пространстве два активных OWNER (второй - F).
    await prisma.workspaceMembership.create({
      data: {
        id: randomUUID(),
        workspaceId: ctx.e.workspaceId,
        userId: ctx.f.userId,
        role: 'OWNER',
      },
    });
    await prisma.account.create({
      data: {
        id: randomUUID(),
        budgetId: ctx.e.budgetId,
        name: 'Счёт E',
        accountType: 'CASH',
        startingBalanceMinor: 1_000n,
        accountingStartDate: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
  });

  afterAll(async () => {
    // Disposable database: fixture rows are left in place, like the other integration tests.
    await app?.close();
    await prisma.$disconnect();
  });

  it('фикстура богатая, а список таблиц берётся из information_schema', async () => {
    const tables = await budgetTables();
    // Явный нижний предел: потеря таблицы в схеме не должна сделать тест пустым.
    expect(tables.length).toBeGreaterThanOrEqual(19);
    const before = await counts(ctx.a.budgetId);
    for (const table of tables) {
      // Новая таблица с budget_id обязана попасть и в фикстуру, и в скрипт.
      expect(before[table], `fixture has no rows in ${table}`).toBeGreaterThan(0);
    }
  });

  it('неизвестный email и неединственный бюджет: ошибка без изменений', async () => {
    const beforeC = await counts(ctx.c.budgetId);
    const beforeExtra = await counts(extraBudgetId);

    await expect(
      prisma.$executeRawUnsafe(buildSql(`nobody-${randomUUID()}@harmofin.test`, true)),
    ).rejects.toThrow(/ожидается ровно один/);
    await expect(prisma.$executeRawUnsafe(buildSql(ctx.c.email, true))).rejects.toThrow(
      /ожидается ровно один/,
    );

    expect(await counts(ctx.c.budgetId)).toEqual(beforeC);
    expect(await counts(extraBudgetId)).toEqual(beforeExtra);
    const rows = await prisma.budget.findMany({ where: { workspaceId: ctx.c.workspaceId } });
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.id === ctx.c.budgetId)?.planModelVersion).toBe(1);
  });

  it('плейсхолдер owner@example.com, OWNER в двух пространствах и два OWNER: abort без изменений', async () => {
    await expect(prisma.$executeRawUnsafe(sqlTemplate.replace('false;', 'true;'))).rejects.toThrow(
      /не задан/,
    );
    const beforeD = await counts(ctx.d.budgetId);
    await expect(prisma.$executeRawUnsafe(buildSql(ctx.d.email, true))).rejects.toThrow(
      /ожидается ровно один/,
    );
    expect(await counts(ctx.d.budgetId)).toEqual(beforeD);

    const beforeE = await counts(ctx.e.budgetId);
    await expect(prisma.$executeRawUnsafe(buildSql(ctx.e.email, true))).rejects.toThrow(
      /активных OWNER: 2/,
    );
    expect(await counts(ctx.e.budgetId)).toEqual(beforeE);
    expect(beforeE.accounts).toBe(1);
    const budgetE = await prisma.budget.findUniqueOrThrow({ where: { id: ctx.e.budgetId } });
    expect(budgetE.planModelVersion).toBe(2);
  });

  it('dry-run (по умолчанию) откатывает всё и сообщает DRY RUN', async () => {
    const before = await counts(ctx.a.budgetId);
    const budgetBefore = await rowJson('budgets', 'id', ctx.a.budgetId);
    const idBefore = await identity(ctx.a);
    const auditBefore = await prisma.auditEvent.count({
      where: { workspaceId: ctx.a.workspaceId },
    });

    await expect(prisma.$executeRawUnsafe(buildSql(ctx.a.email, false))).rejects.toThrow(
      /DRY RUN: изменения откатены/,
    );

    expect(await counts(ctx.a.budgetId)).toEqual(before);
    expect(await rowJson('budgets', 'id', ctx.a.budgetId)).toEqual(budgetBefore);
    expect(await identity(ctx.a)).toEqual(idBefore);
    expect(await prisma.auditEvent.count({ where: { workspaceId: ctx.a.workspaceId } })).toBe(
      auditBefore,
    );
  });

  it('email сопоставляется без учёта регистра и пробелов по краям', async () => {
    await expect(
      prisma.$executeRawUnsafe(buildSql(`  ${ctx.a.email.toUpperCase()} `, false)),
    ).rejects.toThrow(/DRY RUN/);
  });

  it('commit: бюджет A очищен и на v2, всё остальное не тронуто', async () => {
    const beforeB = await counts(ctx.b.budgetId);
    const budgetB = await rowJson('budgets', 'id', ctx.b.budgetId);
    const identityB = await identity(ctx.b);
    const identityA = await identity(ctx.a);
    const budgetABefore = (await prisma.budget.findUniqueOrThrow({
      where: { id: ctx.a.budgetId },
    }))!;
    const beforeC = await counts(ctx.c.budgetId);
    const workerJobs = await prisma.workerJob.count();
    const auditTotalBefore = await prisma.auditEvent.count({
      where: { workspaceId: ctx.a.workspaceId },
    });
    const detachable = await prisma.auditEvent.count({ where: { budgetId: ctx.a.budgetId } });
    expect(detachable).toBeGreaterThan(0);
    const detachedBefore = await prisma.auditEvent.count({
      where: { workspaceId: ctx.a.workspaceId, budgetId: null },
    });

    await prisma.$executeRawUnsafe(buildSql(ctx.a.email, true));

    // Полнота: каждая таблица с budget_id, найденная в схеме, пуста для A.
    const afterA = await counts(ctx.a.budgetId);
    for (const table of await budgetTables()) {
      expect(afterA[table], `${table} still has rows of the reset budget`).toBe(0);
    }

    // Пользователь, сессии, workspace, membership сохранены побайтно.
    expect(await identity(ctx.a)).toEqual(identityA);

    const budgetA = await prisma.budget.findUniqueOrThrow({ where: { id: ctx.a.budgetId } });
    expect(budgetA.planModelVersion).toBe(2);
    expect(budgetA.planModelActivatedOn?.toISOString().slice(0, 10)).toBe(
      todayInTimezone(new Date(), budgetTimezone),
    );
    expect(budgetA).toMatchObject({
      name: budgetABefore.name,
      timezone: budgetTimezone,
      cycleStartDay: 5,
      periodBoundaryOffset: 10,
      allowNegativeBalance: true,
      status: budgetABefore.status,
      primaryCurrency: budgetABefore.primaryCurrency,
      workspaceId: ctx.a.workspaceId,
      incomeAllocationRuleEnabled: false,
      incomeAllocationSourceCategoryId: null,
      incomeAllocationTargetEnvelopeId: null,
    });

    // Аудит не удалён: история отвязана от бюджета, плюс одна запись budget.reset.
    expect(await prisma.auditEvent.count({ where: { workspaceId: ctx.a.workspaceId } })).toBe(
      auditTotalBefore + 1,
    );
    expect(
      await prisma.auditEvent.count({ where: { workspaceId: ctx.a.workspaceId, budgetId: null } }),
    ).toBe(detachedBefore + detachable + 1);

    // Единственный след: событие без budget_id и без сумм.
    const trace = await prisma.auditEvent.findMany({
      where: { workspaceId: ctx.a.workspaceId, action: 'budget.reset' },
    });
    expect(trace).toHaveLength(1);
    expect(trace[0]).toMatchObject({ budgetId: null, entityId: ctx.a.budgetId, source: 'runbook' });
    expect(Object.keys(trace[0]!.newValues as object).sort()).toEqual([
      'committed',
      'deletedRows',
      'planModelVersion',
    ]);

    // Чужие данные не изменились.
    expect(await counts(ctx.b.budgetId)).toEqual(beforeB);
    expect(await rowJson('budgets', 'id', ctx.b.budgetId)).toEqual(budgetB);
    expect(await identity(ctx.b)).toEqual(identityB);
    expect(await counts(ctx.c.budgetId)).toEqual(beforeC);
    expect((await counts(extraBudgetId)).accounts).toBe(1);
    expect(await prisma.workerJob.count()).toBe(workerJobs);
  });

  it('повторный запуск на пустом бюджете безопасен', async () => {
    await prisma.$executeRawUnsafe(buildSql(ctx.a.email, true));
    const afterA = await counts(ctx.a.budgetId);
    expect(Object.values(afterA).every((n) => n === 0)).toBe(true);
  });

  it('после сброса применяется шаблон v2 и создаётся счёт', async () => {
    const headers = {
      origin,
      cookie: `harmofin_session=${ctx.a.cookie}`,
    };
    const base = `/api/v2/budgets/${ctx.a.budgetId}`;
    const preview = await server.inject({
      method: 'GET',
      url: `${base}/reference-template/preview`,
      headers,
    });
    expect(preview.statusCode).toBe(200);
    const body = preview.json<{
      previewHash: string;
      envelopes: Array<{ role: string; status: string; suggestedAction: string }>;
    }>();
    const action = (role: string) => {
      const row = body.envelopes.find((item) => item.role === role)!;
      return row.status === 'COLLISION' ? 'SKIP' : row.suggestedAction;
    };
    const applied = await server.inject({
      method: 'POST',
      url: `${base}/reference-template/apply`,
      headers: {
        ...headers,
        'x-csrf-token': ctx.a.csrfToken,
        'idempotency-key': randomUUID(),
      },
      payload: {
        previewHash: body.previewHash,
        periods: [
          { role: 'FIRST', action: action('FIRST') },
          { role: 'SECOND', action: action('SECOND') },
        ],
        mandatory: { action: action('MANDATORY') },
        savings: [],
      },
    });
    expect(applied.statusCode).toBe(200);
    expect(await prisma.category.count({ where: { budgetId: ctx.a.budgetId } })).toBeGreaterThan(0);
    expect(await prisma.envelope.count({ where: { budgetId: ctx.a.budgetId } })).toBeGreaterThan(0);

    const account = await server.inject({
      method: 'POST',
      url: `/api/v1/budgets/${ctx.a.budgetId}/accounts`,
      headers: { ...headers, 'x-csrf-token': ctx.a.csrfToken },
      payload: {
        name: 'Новая карта',
        accountType: 'BANK_CARD',
        currency: 'RUB',
        startingBalance: '100.00',
        accountingStartDate: todayInTimezone(new Date(), budgetTimezone),
      },
    });
    expect(account.statusCode).toBe(201);
  });
});
