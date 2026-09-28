# План: Прозрачность баланса конверта (План A)

Дата: 2026-09-27
Ветка: `feature/enelope-rellocation` (продолжить ту же) или new `feature/envelope-balance-breakdown` с main
Дизайн согласован в чате (опция A). Требование пользователя: весь текст UI — без жаргона, понятен с первого чтения; подсказки — через тултипы.

## Цель

В карточке конверта (EnvelopeDrawer) показать, **из чего сложился текущий остаток**, и **список переносов между конвертами** (envelope reallocations). В диалоге редактирования — честный текст поля «Начальный баланс» и предпросмотр результата.

Опция B («Коррекция баланса» / rebalance) — вне этого плана, отдельный спеки/план позже.

## Формула (единственный источник — `financial-balance.repository.ts:61-129`)

```
current = starting
        + incomeAllocated       (CONFIRMED income_allocations, +)
        − expenses              (CONFIRMED EXPENSE transactions, −)
        + envelopeTransfersNet  (CONFIRMED transfer_parts: приход − расход, знак произвольный)
        + reallocationsNet      (CONFIRMED envelope_reallocations: приход − расход, знак произвольный)
```

Всё через BIGINT минорные единицы, только `status='CONFIRMED'`, фильтр `budget_id` в SQL. Новый эндпоинт повторяет формулу пословно (каждый терм отдельным подзапросом), итог считает JS — инвариант выдерживается конструктивно.

## Что меняется

| Файл | Действие |
|---|---|
| `apps/api/src/envelopes/envelope.repository.ts` | + метод `balanceSummary` (2 raw-запроса) и типы |
| `apps/api/src/envelopes/envelope.application.service.ts` | + `EnvelopeReallocationSummaryRow`, `EnvelopeBalanceSummaryView`, метод `balanceSummary` |
| `apps/api/src/envelopes/envelope.dto.ts` | + `EnvelopeReallocationSummaryResponse`, `EnvelopeBalanceSummaryResponse` |
| `apps/api/src/envelopes/envelope.controller.ts` | + `GET budgets/:budgetId/envelopes/:envelopeId/balance-summary` |
| `apps/api/src/envelopes/envelope.application.service.test.ts` | + 2 юнит-теста |
| `apps/api/test/envelope-balance-summary.integration.test.ts` | новый файл |
| `apps/web/app/composables/useBudgetReferenceData.ts` | + типы и `getEnvelopeBalanceSummary` |
| `apps/web/app/components/envelopes/EnvelopeDrawer.vue` | + секция «Откуда остаток» + список переносов + тултип |
| `apps/web/app/pages/app/envelopes.vue` | + fetch summary при открытии карточки; + текст диалога и предпросмотр |
| `apps/web/app/components/envelopes/EnvelopeDrawer.test.ts` | + 3 теста |
| `apps/web/app/pages/app/envelopes.test.ts` | + mock и 2 теста |
| `e2e/envelope-balance-breakdown.spec.ts` | новый файл |

Безопасность/авторизация: эндпоинт — read-only, `SessionAuthGuard`; проверка доступа — `activeBudgetWhere` (workspace membership + активный бюджет) в `WHERE`, как у `find`. Чужой/несуществующий конверт → `404 RESOURCE_NOT_FOUND`.

Порядок: API (1–4) → web (5–8) → e2e (9) → гейты (10).

---

## Task 1: API repository — `balanceSummary`

`apps/api/src/envelopes/envelope.repository.ts`

1) Добавить после `EnvelopeUpdateData` (строка ~55) типы:

```ts
export interface EnvelopeBalanceTerms {
  startingBalanceMinor: bigint;
  incomeAllocatedMinor: bigint;
  expensesMinor: bigint;
  envelopeTransfersNetMinor: bigint;
  reallocationsNetMinor: bigint;
}

export interface EnvelopeReallocationRow {
  reallocationId: string;
  direction: 'IN' | 'OUT';
  otherEnvelopeId: string;
  otherEnvelopeName: string | null;
  amountMinor: bigint;
  occurredOn: string;
  comment: string | null;
}

export interface EnvelopeBalanceSummaryRecord {
  envelope: Omit<EnvelopeRecord, 'currentBalanceMinor'>;
  terms: EnvelopeBalanceTerms;
  reallocations: EnvelopeReallocationRow[];
}
```

2) В классе `EnvelopeRepository` (после `archive`, перед `private withCurrentBalances`, ~строка 252) метод:

```ts
  async balanceSummary(
    userId: string,
    budgetId: string,
    envelopeId: string,
  ): Promise<EnvelopeBalanceSummaryRecord | null> {
    const envelope = await this.prisma.envelope.findFirst({
      where: { id: envelopeId, budgetId, budget: activeBudgetWhere(userId, budgetId) },
      select: envelopeSelect,
    });
    if (!envelope) return null;

    const [termsRow] = await this.prisma.$queryRaw<{
      startingBalanceMinor: bigint;
      incomeAllocatedMinor: bigint;
      expensesMinor: bigint;
      envelopeTransfersNetMinor: bigint;
      reallocationsNetMinor: bigint;
    }[]>`
      SELECT
        envelope."starting_balance_minor" AS "startingBalanceMinor",
        COALESCE((
          SELECT SUM(allocation."amount_minor")
          FROM "income_allocations" AS allocation
          WHERE allocation."budget_id" = ${budgetId}::uuid
            AND allocation."envelope_id" = ${envelopeId}::uuid
            AND allocation."status" = 'CONFIRMED'
        ), 0)::BIGINT AS "incomeAllocatedMinor",
        COALESCE((
          SELECT SUM(transaction."amount_minor")
          FROM "transactions" AS transaction
          WHERE transaction."budget_id" = ${budgetId}::uuid
            AND transaction."envelope_id" = ${envelopeId}::uuid
            AND transaction."transaction_type" = 'EXPENSE'
            AND transaction."status" = 'CONFIRMED'
        ), 0)::BIGINT AS "expensesMinor",
        COALESCE((
          SELECT SUM(part."amount_minor")
          FROM "transfer_parts" AS part
          INNER JOIN "transfers" AS transfer
            ON transfer."id" = part."transfer_id"
            AND transfer."budget_id" = part."budget_id"
          WHERE part."budget_id" = ${budgetId}::uuid
            AND transfer."budget_id" = ${budgetId}::uuid
            AND part."destination_envelope_id" = ${envelopeId}::uuid
            AND transfer."status" = 'CONFIRMED'
        ), 0)::BIGINT
        - COALESCE((
          SELECT SUM(part."amount_minor")
          FROM "transfer_parts" AS part
          INNER JOIN "transfers" AS transfer
            ON transfer."id" = part."transfer_id"
            AND transfer."budget_id" = part."budget_id"
          WHERE part."budget_id" = ${budgetId}::uuid
            AND transfer."budget_id" = ${budgetId}::uuid
            AND part."source_envelope_id" = ${envelopeId}::uuid
            AND transfer."status" = 'CONFIRMED'
        ), 0)::BIGINT AS "envelopeTransfersNetMinor",
        COALESCE((
          SELECT SUM(reallocation."amount_minor")
          FROM "envelope_reallocations" AS reallocation
          WHERE reallocation."budget_id" = ${budgetId}::uuid
            AND reallocation."destination_envelope_id" = ${envelopeId}::uuid
            AND reallocation."status" = 'CONFIRMED'
        ), 0)::BIGINT
        - COALESCE((
          SELECT SUM(reallocation."amount_minor")
          FROM "envelope_reallocations" AS reallocation
          WHERE reallocation."budget_id" = ${budgetId}::uuid
            AND reallocation."source_envelope_id" = ${envelopeId}::uuid
            AND reallocation."status" = 'CONFIRMED'
        ), 0)::BIGINT AS "reallocationsNetMinor"
      FROM "envelopes" AS envelope
      WHERE envelope."id" = ${envelopeId}::uuid
        AND envelope."budget_id" = ${budgetId}::uuid
    `;

    if (!termsRow) return null;

    const reallocations = await this.prisma.$queryRaw<
      Array<Omit<EnvelopeReallocationRow, 'direction'> & { direction: 'IN' | 'OUT' }>
    >`
      SELECT
        reallocation."id" AS "reallocationId",
        CASE
          WHEN reallocation."source_envelope_id" = ${envelopeId}::uuid THEN 'OUT'
          ELSE 'IN'
        END::text AS "direction",
        CASE
          WHEN reallocation."source_envelope_id" = ${envelopeId}::uuid
            THEN reallocation."destination_envelope_id"
          ELSE reallocation."source_envelope_id"
        END AS "otherEnvelopeId",
        other."name" AS "otherEnvelopeName",
        reallocation."amount_minor" AS "amountMinor",
        reallocation."occurred_on"::text AS "occurredOn",
        reallocation."comment"
      FROM "envelope_reallocations" AS reallocation
      LEFT JOIN "envelopes" AS other
        ON other."id" = CASE
          WHEN reallocation."source_envelope_id" = ${envelopeId}::uuid
            THEN reallocation."destination_envelope_id"
          ELSE reallocation."source_envelope_id"
        END
        AND other."budget_id" = reallocation."budget_id"
      WHERE reallocation."budget_id" = ${budgetId}::uuid
        AND reallocation."status" = 'CONFIRMED'
        AND (
          reallocation."source_envelope_id" = ${envelopeId}::uuid
          OR reallocation."destination_envelope_id" = ${envelopeId}::uuid
        )
      ORDER BY reallocation."occurred_on" DESC, reallocation."created_at" DESC
      LIMIT 100
    `;

    return {
      envelope,
      terms: {
        startingBalanceMinor: termsRow.startingBalanceMinor,
        incomeAllocatedMinor: termsRow.incomeAllocatedMinor,
        expensesMinor: termsRow.expensesMinor,
        envelopeTransfersNetMinor: termsRow.envelopeTransfersNetMinor,
        reallocationsNetMinor: termsRow.reallocationsNetMinor,
      },
      reallocations: reallocations.map((row) => ({
        reallocationId: row.reallocationId,
        direction: row.direction,
        otherEnvelopeId: row.otherEnvelopeId,
        otherEnvelopeName: row.otherEnvelopeName,
        amountMinor: row.amountMinor,
        occurredOn: row.occurredOn,
        comment: row.comment,
      })),
    };
  }
```

Примечания:
- Термы — дословно та же формула, что в `FinancialBalanceRepository.envelopeBalance` (financial-balance.repository.ts:66-125), только разнесённая по строкам ответа.
- `occurred_on` — `@db.Date`, `::text` даёт `YYYY-MM-DD`.
- `otherEnvelopeName` резолвится на сервере (LEFT JOIN), т.к. контрагент может быть архивным.

Verify: `pnpm typecheck` (в root, см. команду ниже) и `pnpm lint`.
Commit: `feat(api): envelope balance summary repository projection`

---

## Task 2: API service + юнит-тесты

`apps/api/src/envelopes/envelope.application.service.ts`

1) После `EnvelopeSummaryView` (~строка 61) добавить:

```ts
export interface EnvelopeReallocationSummaryRow {
  reallocationId: string;
  direction: 'IN' | 'OUT';
  otherEnvelopeId: string;
  otherEnvelopeName: string | null;
  amountMinor: string;
  occurredOn: string;
  comment: string | null;
}

export interface EnvelopeBalanceSummaryView {
  envelope: EnvelopeView;
  currency: 'RUB';
  scale: 2;
  startingBalanceMinor: string;
  incomeAllocatedMinor: string;
  expensesMinor: string;
  envelopeTransfersNetMinor: string;
  reallocationsNetMinor: string;
  currentBalanceMinor: string;
  reallocations: EnvelopeReallocationSummaryRow[];
}
```

2) В классе, после метода `get` (~строка 120):

```ts
  async balanceSummary(
    userId: string,
    budgetId: string,
    envelopeId: string,
  ): Promise<EnvelopeBalanceSummaryView> {
    const record = await this.repository.balanceSummary(userId, budgetId, envelopeId);
    if (!record) throw resourceNotFound();
    const { envelope, terms, reallocations } = record;
    const currentBalanceMinor =
      terms.startingBalanceMinor +
      terms.incomeAllocatedMinor -
      terms.expensesMinor +
      terms.envelopeTransfersNetMinor +
      terms.reallocationsNetMinor;

    return {
      envelope: this.toView({ ...envelope, currentBalanceMinor }),
      currency: 'RUB',
      scale: 2,
      startingBalanceMinor: formatMinorUnits(terms.startingBalanceMinor),
      incomeAllocatedMinor: formatMinorUnits(terms.incomeAllocatedMinor),
      expensesMinor: formatMinorUnits(terms.expensesMinor),
      envelopeTransfersNetMinor: formatMinorUnits(terms.envelopeTransfersNetMinor),
      reallocationsNetMinor: formatMinorUnits(terms.reallocationsNetMinor),
      currentBalanceMinor: formatMinorUnits(currentBalanceMinor),
      reallocations: reallocations.map((row) => ({
        reallocationId: row.reallocationId,
        direction: row.direction,
        otherEnvelopeId: row.otherEnvelopeId,
        otherEnvelopeName: row.otherEnvelopeName,
        amountMinor: formatMinorUnits(row.amountMinor),
        occurredOn: row.occurredOn.slice(0, 10),
        comment: row.comment,
      })),
    };
  }
```

`apps/api/src/envelopes/envelope.application.service.test.ts`

1) В `repositoryDouble()` добавить `balanceSummary: vi.fn(),` (строка ~124).
2) В конце `describe` (перед `function createService`) добавить:

```ts
  it('maps the balance summary and reallocation rows to decimal-safe strings', async () => {
    const repository = repositoryDouble();
    const service = createService(repository);
    repository.balanceSummary.mockResolvedValue({
      envelope: { ...envelope() },
      terms: {
        startingBalanceMinor: 10_000n,
        incomeAllocatedMinor: 5_000n,
        expensesMinor: 1_500n,
        envelopeTransfersNetMinor: -700n,
        reallocationsNetMinor: 5_000n,
      },
      reallocations: [
        {
          reallocationId: '00000000-0000-4000-8000-000000000005',
          direction: 'IN' as const,
          otherEnvelopeId: '00000000-0000-4000-8000-000000000006',
          otherEnvelopeName: 'Первая половина',
          amountMinor: 5_000n,
          occurredOn: '2026-09-01',
          comment: null,
        },
      ],
    });

    const summary = await service.balanceSummary(ownerId, budgetId, envelope().id);

    expect(summary).toMatchObject({
      currency: 'RUB',
      scale: 2,
      startingBalanceMinor: '10000',
      incomeAllocatedMinor: '5000',
      expensesMinor: '1500',
      envelopeTransfersNetMinor: '-700',
      reallocationsNetMinor: '5000',
      currentBalanceMinor: '18800',
      reallocations: [
        expect.objectContaining({
          reallocationId: '00000000-0000-4000-8000-000000000005',
          direction: 'IN',
          otherEnvelopeName: 'Первая половина',
          amountMinor: '5000',
          occurredOn: '2026-09-01',
        }),
      ],
    });
    expect(summary.envelope.currentBalanceMinor).toBe('18800');
  });

  it('hides the balance summary of a budget the user cannot reach', async () => {
    const repository = repositoryDouble();
    const service = createService(repository);
    repository.balanceSummary.mockResolvedValue(null);

    await expect(
      service.balanceSummary(ownerId, budgetId, '00000000-0000-4000-8000-000000000007'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'RESOURCE_NOT_FOUND' }),
    });
  });
```

Запуск: в `apps/api` `npx vitest run src/envelopes/envelope.application.service.test.ts` (или в root: `pnpm test --filter @harmofin/api` — сверить с package.json script; точная команда в разделе «Гейты»).
Commit: `feat(api): envelope balance summary service with invariant total`

---

## Task 3: API controller + DTO

`apps/api/src/envelopes/envelope.dto.ts` — в конец файла:

```ts
export class EnvelopeReallocationSummaryResponse {
  @ApiProperty({ type: String, format: 'uuid' })
  reallocationId!: string;

  @ApiProperty({ enum: ['IN', 'OUT'] })
  direction!: 'IN' | 'OUT';

  @ApiProperty({ type: String, format: 'uuid' })
  otherEnvelopeId!: string;

  @ApiProperty({ type: String, nullable: true })
  otherEnvelopeName!: string | null;

  @ApiProperty({ type: String, pattern: '^\\d+$' })
  amountMinor!: string;

  @ApiProperty({ type: String, format: 'date' })
  occurredOn!: string;

  @ApiProperty({ type: String, nullable: true })
  comment!: string | null;
}

export class EnvelopeBalanceSummaryResponse {
  @ApiProperty({ type: EnvelopeResponse })
  envelope!: EnvelopeResponse;

  @ApiProperty({ enum: ['RUB'] })
  currency!: 'RUB';

  @ApiProperty({ type: Number, enum: [2] })
  scale!: 2;

  @ApiProperty({ type: String, pattern: '^-?\\d+$' })
  startingBalanceMinor!: string;

  @ApiProperty({ type: String, pattern: '^-?\\d+$' })
  incomeAllocatedMinor!: string;

  @ApiProperty({ type: String, pattern: '^-?\\d+$' })
  expensesMinor!: string;

  @ApiProperty({ type: String, pattern: '^-?\\d+$' })
  envelopeTransfersNetMinor!: string;

  @ApiProperty({ type: String, pattern: '^-?\\d+$' })
  reallocationsNetMinor!: string;

  @ApiProperty({ type: String, pattern: '^-?\\d+$' })
  currentBalanceMinor!: string;

  @ApiProperty({ type: [EnvelopeReallocationSummaryResponse] })
  reallocations!: EnvelopeReallocationSummaryResponse[];
}
```

`apps/api/src/envelopes/envelope.controller.ts`

1) Импорт DTO: в списке из `./envelope.dto.js` добавить `EnvelopeBalanceSummaryResponse`.
2) После метода `get` (~строка 109) вставить:

```ts
  @Get('budgets/:budgetId/envelopes/:envelopeId/balance-summary')
  @ApiOkResponse({ type: EnvelopeBalanceSummaryResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  balanceSummary(
    @Param('budgetId') budgetId: string,
    @Param('envelopeId') envelopeId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.balanceSummary(contextOf(request).userId, budgetId, envelopeId);
  }
```

Маршрут на 4 сегмента — не конфликтует с `.../envelopes/:envelopeId`.
Commit: `feat(api): expose envelope balance summary endpoint in OpenAPI`

---

## Task 4: API integration-тест

Новый файл `apps/api/test/envelope-balance-summary.integration.test.ts`.
Бутстрап (`createApiApp`/`loadApiConfig`/`register`/`cleanup`) скопировать из `apps/api/test/envelope-reallocations.integration.test.ts` (строки 1-60 и 298-345), включая `createEnvelope` и `expectEnvelopeBalance` (282-289, 267-280).

Полный файл:

```ts
import { randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiApp } from '../src/app.js';
import { loadApiConfig } from '../src/config/env.js';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin';
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const origin = 'http://localhost:3000';
const password = 'correct-password-10';

type Session = {
  userId: string;
  workspaceId: string;
  budgetId: string;
  cookie: string;
};

let app: NestFastifyApplication;
let server: FastifyInstance;
let owner: Session;
let foreign: Session;

describe('envelope balance summary API', () => {
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
    owner = await register(`balance-summary-owner-${randomUUID()}@harmofin.test`);
    foreign = await register(`balance-summary-foreign-${randomUUID()}@harmofin.test`);
    await seedBreakdownData();
  });

  afterAll(async () => {
    if (owner) await cleanup(owner);
    if (foreign) await cleanup(foreign);
    await app.close();
    await prisma.$disconnect();
  });

  it('documents the balance summary route in OpenAPI', async () => {
    const document = (await server.inject({ method: 'GET', url: '/openapi.json' })).json<{
      paths: Record<string, Record<string, unknown>>;
    }>();

    expect(document.paths['/api/v1/budgets/{budgetId}/envelopes/{envelopeId}/balance-summary']?.get).toBeDefined();
  });

  it('splits the current balance into five terms that add up exactly', async () => {
    const response = await server.inject({
      method: 'GET',
      url: `/api/v1/budgets/${owner.budgetId}/envelopes/${envelopeA}/balance-summary`,
      cookies: { harmofin_session: owner.cookie },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      startingBalanceMinor: string;
      incomeAllocatedMinor: string;
      expensesMinor: string;
      envelopeTransfersNetMinor: string;
      reallocationsNetMinor: string;
      currentBalanceMinor: string;
      reallocations: Array<{ direction: string; otherEnvelopeName: string | null }>;
    }>();

    expect(body).toMatchObject({
      startingBalanceMinor: '10000',
      incomeAllocatedMinor: '50000',
      expensesMinor: '15000',
      envelopeTransfersNetMinor: '-70000',
      reallocationsNetMinor: '20000',
      currentBalanceMinor: '-30000',
    });
    const total =
      BigInt(body.startingBalanceMinor) +
      BigInt(body.incomeAllocatedMinor) -
      BigInt(body.expensesMinor) +
      BigInt(body.envelopeTransfersNetMinor) +
      BigInt(body.reallocationsNetMinor);
    expect(total.toString()).toBe(body.currentBalanceMinor);
    expect(body.reallocations).toEqual([
      expect.objectContaining({ direction: 'IN', otherEnvelopeName: `Назначение ${suffix}` }),
    ]);
  });

  it('hides the summary of a foreign budget and a missing envelope', async () => {
    const foreignResponse = await server.inject({
      method: 'GET',
      url: `/api/v1/budgets/${owner.budgetId}/envelopes/${envelopeA}/balance-summary`,
      cookies: { harmofin_session: foreign.cookie },
    });
    const missingResponse = await server.inject({
      method: 'GET',
      url: `/api/v1/budgets/${owner.budgetId}/envelopes/${randomUUID()}/balance-summary`,
      cookies: { harmofin_session: owner.cookie },
    });

    expect(foreignResponse.statusCode).toBe(404);
    expect(foreignResponse.json()).toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    expect(missingResponse.statusCode).toBe(404);
    expect(missingResponse.json()).toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

  async function seedBreakdownData() {
    const budget = await prisma.budget.findUniqueOrThrow({ where: { id: owner.budgetId } });
    const today = new Date().toISOString().slice(0, 10);
    const accountId = randomUUID();
    const incomeCategoryId = randomUUID();
    const expenseCategoryId = randomUUID();
    const envelopeB = randomUUID();
    const incomeId = randomUUID();

    await prisma.account.create({
      data: {
        id: accountId,
        budgetId: owner.budgetId,
        name: 'Счёт breakdown',
        accountType: 'CASH',
        startingBalanceMinor: 1_000_000n,
        accountingStartDate: new Date(`${today}T00:00:00.000Z`),
      },
    });
    await prisma.category.createMany({
      data: [
        {
          id: incomeCategoryId,
          budgetId: owner.budgetId,
          name: 'Доход breakdown',
          categoryType: 'INCOME',
          displayOrder: 0,
        },
        {
          id: expenseCategoryId,
          budgetId: owner.budgetId,
          name: 'Расход breakdown',
          categoryType: 'EXPENSE',
          displayOrder: 1,
        },
      ],
    });
    await prisma.envelope.create({
      data: {
        id: envelopeA,
        budgetId: owner.budgetId,
        name: `Источник ${suffix}`,
        envelopeType: 'CUSTOM',
        startingBalanceMinor: 10_000n,
        displayOrder: 0,
      },
    });
    await prisma.envelope.create({
      data: {
        id: envelopeB,
        budgetId: owner.budgetId,
        name: `Назначение ${suffix}`,
        envelopeType: 'CUSTOM',
        startingBalanceMinor: 0n,
        displayOrder: 1,
      },
    });

    const income = await prisma.transaction.create({
      data: {
        id: incomeId,
        budgetId: owner.budgetId,
        transactionType: 'INCOME',
        status: 'CONFIRMED',
        amountMinor: 50_000n,
        occurredOn: new Date(`${today}T00:00:00.000Z`),
        accountId,
        categoryId: incomeCategoryId,
        confirmedAt: new Date(),
        createdByUserId: owner.userId,
        updatedByUserId: owner.userId,
      },
    });
    await prisma.incomeAllocation.create({
      data: {
        id: randomUUID(),
        budgetId: owner.budgetId,
        incomeTransactionId: income.id,
        status: 'CONFIRMED',
        amountMinor: 50_000n,
        occurredOn: new Date(`${today}T00:00:00.000Z`),
        accountId,
        envelopeId: envelopeA,
        createdByUserId: owner.userId,
        updatedByUserId: owner.userId,
      },
    });
    await prisma.transaction.create({
      data: {
        id: randomUUID(),
        budgetId: owner.budgetId,
        transactionType: 'EXPENSE',
        status: 'CONFIRMED',
        amountMinor: 15_000n,
        occurredOn: new Date(`${today}T00:00:00.000Z`),
        accountId,
        categoryId: expenseCategoryId,
        envelopeId: envelopeA,
        confirmedAt: new Date(),
        createdByUserId: owner.userId,
        updatedByUserId: owner.userId,
      },
    });

    const transferFromB = randomUUID();
    await prisma.transfer.create({
      data: {
        id: transferFromB,
        budgetId: owner.budgetId,
        status: 'CONFIRMED',
        sourceAccountId: accountId,
        destinationAccountId: accountId,
        occurredOn: new Date(`${today}T00:00:00.000Z`),
        createdByUserId: owner.userId,
        updatedByUserId: owner.userId,
      },
    });
```

СТОП. Проверка перед продолжением: у `transfers` источник и назначение — разные СЧЕТА (доменное правило). В seed выше source=destination=`accountId` — нарушение. Нужно два счёта:

    const secondAccountId = randomUUID();
    // второй счёт создать до transfer:
    await prisma.account.create({
      data: {
        id: secondAccountId,
        budgetId: owner.budgetId,
        name: 'Счёт breakdown 2',
        accountType: 'CASH',
        startingBalanceMinor: 0n,
        accountingStartDate: new Date(`${today}T00:00:00.000Z`),
      },
    });
    // transfer:
    await prisma.transfer.create({
      data: {
        id: transferFromB,
        budgetId: owner.budgetId,
        status: 'CONFIRMED',
        sourceAccountId: accountId,
        destinationAccountId: secondAccountId,
        occurredOn: new Date(`${today}T00:00:00.000Z`),
        createdByUserId: owner.userId,
        updatedByUserId: owner.userId,
      },
    });
    await prisma.transferPart.create({
      data: {
        transferId: transferFromB,
        budgetId: owner.budgetId,
        status: 'CONFIRMED',
        amountMinor: 70_000n,
        sourceEnvelopeId: envelopeB,
        destinationEnvelopeId: envelopeA,
        createdByUserId: owner.userId,
        updatedByUserId: owner.userId,
      },
    });

ПЕРЕПРОВЕРКА: transfer B→A 700.00. Для A это ПРИХОД → `envelopeTransfersNetMinor` должен быть `+70000`, а не `−70000`. Итог по A: 10 000 + 50 000 − 15 000 + 70 000 + 20 000 = `135 000` → `'135000'`. Исправить ожидания в тесте:

    expect(body).toMatchObject({
      startingBalanceMinor: '10000',
      incomeAllocatedMinor: '50000',
      expensesMinor: '15000',
      envelopeTransfersNetMinor: '70000',
      reallocationsNetMinor: '20000',
      currentBalanceMinor: '135000',
    });

Дальше seed: reallocation B→A 200.00 (для A это `IN`, +20000; имя контрагента — `Назначение ${suffix}`):

```ts
    const reallocated = await server.inject({
      method: 'POST',
      url: `/api/v1/budgets/${owner.budgetId}/envelope-reallocations`,
      headers: {
        origin,
        'x-csrf-token': (
          await server.inject({
            method: 'GET',
            url: '/api/v1/auth/csrf',
            cookies: { harmofin_session: owner.cookie },
          })
        ).json<{ csrfToken: string }>().csrfToken,
        'idempotency-key': 'balance-summary-realloc',
      },
      cookies: { harmofin_session: owner.cookie },
      payload: {
        sourceEnvelopeId: envelopeB,
        destinationEnvelopeId: envelopeA,
        amount: '200.00',
        occurredOn: today,
      },
    });
    expect(reallocated.statusCode).toBe(201);
  }

  async function register(email: string): Promise<Session> {
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
    }>();
    const cookie = response.cookies.find((item) => item.name === 'harmofin_session')?.value;
    if (!cookie) throw new Error('Missing session cookie');
    return {
      userId: body.user.id,
      workspaceId: body.workspace.id,
      budgetId: body.budget.id,
      cookie,
    };
  }

  async function cleanup(session: Session) {
    if (!session) return;
    const budgetIds = (
      await prisma.budget.findMany({
        where: { workspaceId: session.workspaceId },
        select: { id: true },
      })
    ).map((budget) => budget.id);
    await prisma.auditEvent.deleteMany({ where: { workspaceId: session.workspaceId } });
    await prisma.idempotencyRecord.deleteMany({ where: { budgetId: { in: budgetIds } } });
    await prisma.transferPart.deleteMany({ where: { budgetId: { in: budgetIds } } });
    await prisma.envelopeReallocation.deleteMany({ where: { budgetId: { in: budgetIds } } });
    await prisma.transfer.deleteMany({ where: { budgetId: { in: budgetIds } } });
    await prisma.incomeAllocation.deleteMany({ where: { budgetId: { in: budgetIds } } });
    await prisma.transaction.deleteMany({ where: { budgetId: { in: budgetIds } } });
    await prisma.account.deleteMany({ where: { budgetId: { in: budgetIds } } });
    await prisma.category.deleteMany({ where: { budgetId: { in: budgetIds } } });
    await prisma.envelope.deleteMany({ where: { budgetId: { in: budgetIds } } });
    await prisma.workspaceMembership.deleteMany({ where: { workspaceId: session.workspaceId } });
    await prisma.budget.deleteMany({ where: { id: { in: budgetIds } } });
    await prisma.workspace.deleteMany({ where: { id: session.workspaceId } });
    await prisma.session.deleteMany({ where: { userId: session.userId } });
    await prisma.user.deleteMany({ where: { id: session.userId } });
  }
});

const suffix = Date.now().toString(36);
let envelopeA = '';
```

ПАМЯТКА ПЕРЕД ЗАПИСЬЮ ФАЙЛА (обработать при реализации):
1. `envelopeA`, `suffix`, `envelopeB` поднять в верхний scope файла: `const suffix = Date.now().toString(36); let envelopeA = '';` — объявить ДО `describe`; в seed `envelopeA = randomUUID()` и вернуть его; в тесте `.../envelopes/${envelopeA}/...`.
2. Порядок delete в cleanup: `envelopeReallocation` — ДО `transfer.deleteMany` (FK), как в референционном файле (строка 332-333: transferPart → transfer; reallocation раньше transferPart). Сверять с cleanup в `envelope-reallocations.integration.test.ts` (322-345): `envelopeReallocation` там идёт ПЕРЕД `transferPart`/`transfer`? В оригинале: auditEvent, idempotencyRecord, envelopeReallocation, transferPart, transfer, ... — да, reallocation → transfer. Использовать тот же порядок.
3. Поля `transferPart`/`transfer` в БД: точный набор обязательных полей — сверить с Prisma-моделью (`prisma/schema.prisma`, модели `Transfer`/`TransferPart`); если нужны `currency`/`scale`/`updatedAt` — дописать. `transfer.status` — CONFIRMED; у `transferPart` может быть `sourceAccountId`/`destinationAccountId` — сверить с моделью.
4. `prisma.session` — модели называется `session`/`Session` (как в референсном cleanup) — ок.

Запуск: в `apps/api` `npx vitest run test/envelope-balance-summary.integration.test.ts` (БД через infra уже поднята).
Commit: `test(api): envelope balance summary integration coverage`

---

## Task 5: Web client — тип + метод

`apps/web/app/composables/useBudgetReferenceData.ts`

1) Рядом с `EnvelopeSummaryDto` (область ~строк 600-620, где лежат DTO) добавить:

```ts
export type EnvelopeReallocationSummaryDto = {
  reallocationId: string;
  direction: 'IN' | 'OUT';
  otherEnvelopeId: string;
  otherEnvelopeName: string | null;
  amountMinor: string;
  occurredOn: string;
  comment: string | null;
};

export type EnvelopeBalanceSummaryDto = {
  envelope: EnvelopeDto;
  currency: 'RUB';
  scale: 2;
  startingBalanceMinor: string;
  incomeAllocatedMinor: string;
  expensesMinor: string;
  envelopeTransfersNetMinor: string;
  reallocationsNetMinor: string;
  currentBalanceMiniR: string;
  reallocations: EnvelopeReallocationSummaryDto[];
};
```
ОПЕЧАТКА `currentBalanceMiniR` → `currentBalanceMinor: string;` (сверить при вставке).

2) В `BudgetReferenceDataApi` (строка 654) после `getEnvelope` строку:

```ts
  getEnvelopeBalanceSummary(budgetId: string, envelopeId: string): Promise<EnvelopeBalanceSummaryDto>;
```

3) В реализации (строки 934-935) после `getEnvelope`:

```ts
    getEnvelopeBalanceSummary: (budgetId, envelopeId) =>
      api.request<EnvelopeBalanceSummaryDto>(`${envelopePath(budgetId, envelopeId)}/balance-summary`),
```

Commit: `feat(web): envelope balance summary client`

---

## Task 6: EnvelopeDrawer — «Откуда остаток» + переносы

`apps/web/app/components/envelopes/EnvelopeDrawer.vue`

1) Импорт: `import UiInfoTooltip from '../ui/InfoTooltip.vue';` (имя экспорта/prop `text` — сверить с компонентом: `docs` в каталоге `ui`; если prop называется иначе — подстроить).

Скрипт:

```ts
const props = defineProps<{
  envelope: EnvelopeDto | null;
  balanceSummary?: EnvelopeBalanceSummaryDto | null;
  balanceSummaryLoading?: boolean;
  balanceSummaryError?: string;
}>();
```
+ импорты типов: `EnvelopeBalanceSummaryDto` из `../../composables/useBudgetReferenceData.js`.

Компьюты/хелперы:

```ts
const currency = computed(() => props.envelope?.currency ?? 'RUB');
const scale = computed(() => props.envelope?.scale ?? 2);

function money(minor: string): string {
  return formatMinorUnits(minor, currency.value, scale.value);
}

function signedMoney(minor: string, fallbackPositive = false): string {
  const value = BigInt(minor);
  if (value === 0n) return money('0');
  const text = money(value < 0n ? (-value).toString() : value.toString());
  const positive = value > 0n || fallbackPositive;
  return `${positive ? '+' : '−'}${text}`;
}

const movementsNet = computed<string | null>(() => {
  const summary = props.balanceSummary;
  if (!summary) return null;
  const net = BigInt(summary.envelopeTransfersNetMinor) + BigInt(summary.reallocationsNetMinor);
  return net.toString();
});

function reallocationAmount(row: EnvelopeReallocationSummaryDto): string {
  const text = money(row.amountMinor);
  return row.direction === 'OUT' ? `−${text}` : `+${text}`;
}
```
(импортировать `EnvelopeReallocationSummaryDto`).

2) В шаблоне, после `</dl>` (строка 121), внутри `<div v-if="envelope"`:

```html
      <template v-if="balanceSummary">
        <section class="envelope-drawer__breakdown" data-testid="envelope-drawer-breakdown">
          <h3 class="envelope-drawer__section-title">Откуда остаток</h3>
          <dl class="envelope-drawer__breakdown-rows">
            <div>
              <dt>Начальный остаток</dt>
              <dd>{{ money(balanceSummary.startingBalanceMinor) }}</dd>
            </div>
            <div>
              <dt>Добавили доходы</dt>
              <dd class="envelope-drawer__positive">
                {{ signedMoney(balanceSummary.incomeAllocatedMinor, true) }}
              </dd>
            </div>
            <div>
              <dt>Потратили на расходы</dt>
              <dd class="envelope-drawer__negative">
                {{ signedMoney(`-${balanceSummary.expensesMinor}`, true) }}
              </dd>
            </div>
            <div>
              <dt>
                Движения между конвертами
                <UiInfoTooltip
                  text="Все операции, где деньги ушли из других конвертов или пришли в другие. Пришедшие суммы — со знаком плюс, ушедшие — с минусом."
                />
              </dt>
              <dd>
                {{ movementsNet !== null ? signedMoney(movementsNet, true) : '' }}
              </dd>
            </div>
            <div class="envelope-drawer__bottom-row">
              <dt>Текущий остаток</dt>
              <dd>{{ money(balanceSummary.currentBalanceMinor) }}</dd>
            </div>
          </dl>
        </section>

        <section class="envelope-drawer__reallocations" data-testid="envelope-drawer-reallocations">
          <h3 class="envelope-drawer__section-title">Переносы между конвертами</h3>
          <ul v-if="balanceSummary.reallocations.length > 0" class="envelope-drawer__reallocation-list">
            <li v-for="row in balanceSummary.reallocations" :key="row.reallocationId">
              <span data-testid="reallocation-amount">
                {{ reallocationAmount(row) }}
              </span>
              <span v-if="row.direction === 'OUT'">в «{{ row.otherEnvelopeName ?? 'конверт' }}»</span>
              <span v-else>из «{{ row.otherEnvelopeName ?? 'конверт' }}»</span>
              <time :datetime="row.occurredOn">{{ row.occurredOn }}</time>
            </li>
          </ul>
          <p v-else class="envelope-drawer__empty" data-testid="envelope-drawer-reallocations-empty">
            Переносов пока не было.
          </p>
        </section>
      </template>

      <UiSkeleton v-else-if="balanceSummaryLoading" :count="3" />

      <p
        v-else-if="balanceSummaryError"
        class="envelope-drawer__error"
        data-testid="envelope-drawer-summary-error"
      >
        {{ balanceSummaryError }}
      </p>
```

Подписи строк (простой язык, без «база/формула»):
- «Начальный остаток» — сколько положили до начала учёта.
- «Добавили доходы» — сумма доходов, которые перевели в этот конверт.
- «Потратили на расходы» — всё, что потрачено из конверта.
- «Движения между конвертами» — тултип объясняет (выше).
- «Текущий остаток» — то, что показано в шапке карточки.

3) Стиль (в конец `<style scoped>`):

```css
.envelope-drawer__section-title {
  margin: 0 0 var(--hf-space-2);
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
  font-weight: var(--hf-font-weight-semibold);
}

.envelope-drawer__breakdown-rows {
  display: grid;
  gap: var(--hf-space-2);
  margin: 0;
}

.envelope-drawer__breakdown-rows > div {
  display: flex;
  gap: var(--hf-space-3);
  justify-content: space-between;
}

.envelope-drawer__breakdown-rows dt {
  color: var(--hf-color-text-muted);
}

.envelope-drawer__breakdown-rows dd {
  margin: 0;
  text-align: right;
}

.envelope-drawer__positive {
  color: var(--hf-color-text-success);
}

.envelope-drawer__negative {
  color: var(--hf-color-text-danger);
}

.envelope-drawer__bottom-row {
  margin-top: var(--hf-space-2);
  padding-top: var(--hf-space-2);
  border-top: 1px solid var(--hf-color-border);
}

.envelope-drawer__bottom-row dt,
.envelope-drawer__bottom-row dd {
  font-weight: var(--hf-font-weight-semibold);
}

.envelope-drawer__reallocation-list {
  display: grid;
  gap: var(--hf-space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.envelope-drawer__reallocation-list li {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-2);
  align-items: baseline;
}

.envelope-drawer__reallocation-list [data-testid='reallocation-amount'] {
  font-weight: var(--hf-font-weight-medium);
  color: var(--hf-color-text);
}

.envelope-drawer__reallocation-list time {
  margin-left: auto;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
}

.envelope-drawer__empty,
.envelope-drawer__error {
  margin: 0;
  color: var(--hf-color-text-muted);
}
```
Проверить наличие токенов `--hf-color-text-success`/`danger` в design-системе; если нет — использовать `--hf-color-text-muted` и различать знаком, НЕ цветом (a11y: «non-color-only status»). Если токены цветных статусов есть — ок, но знак «+/−» остаётся обязательным.

Commit: `feat(web): envelope drawer balance breakdown and reallocation list`

---

## Task 7: envelopes.vue — подгрузка summary + текст диалога + предпросмотр

`apps/web/app/pages/app/envelopes.vue`

1) Импорты: в `import { computed, onMounted, reactive, ref } from 'vue';` добавить `watch`.
   С `useBudgetReferenceData.js` добавить `type EnvelopeBalanceSummaryDto`.
   Добавить `import { formatMinorUnits } from '../../components/finance/money-format.js';`.

2) Состояние (после `const hydrated = ref(false);`, ~строка 71):

```ts
const balanceSummary = ref<EnvelopeBalanceSummaryDto | null>(null);
const balanceSummaryLoading = ref(false);
const balanceSummaryError = ref('');
const editingEnvelope = ref<EnvelopeDto | null>(null);
```

3) `startEdit` (строка 125) — добавить `editingEnvelope.value = envelope;` (до `detailed.value = null;`).
`startCreate`, `cancelForm` — `editingEnvelope.value = null;`.

4) Загрузка (после `loadPage`):

```ts
async function loadBalanceSummary(envelope: EnvelopeDto) {
  const id = budgetId.value;
  balanceSummary.value = null;
  balanceSummaryError.value = '';
  if (!id) return;
  balanceSummaryLoading.value = true;
  try {
    balanceSummary.value = await api.getEnvelopeBalanceSummary(id, envelope.id);
  } catch {
    balanceSummaryError.value =
      'Не удалось показать, из чего сложился остаток. Закройте карточку и откройте её снова.';
  } finally {
    balanceSummaryLoading.value = false;
  }
}

watch(detailed, (envelope) => {
  if (!envelope) {
    balanceSummary.value = null;
    balanceSummaryLoading.value = false;
    balanceSummaryError.value = '';
    return;
  }
  void loadBalanceSummary(envelope);
});
```

5) В шаблоне `<EnvelopeDrawer` (строки 431-436):

```html
    <EnvelopeDrawer
      :envelope="detailed"
      :balance-summary="balanceSummary"
      :balance-summary-loading="balanceSummaryLoading"
      :balance-summary-error="balanceSummaryError"
      @close="detailed = null"
      @edit="startEdit"
      @archive="requestArchive"
    />
```

6) Поле «Начальный баланс» (строки 473-481) → заменить на:

```html
        <FinanceMoneyInput
          v-model="form.startingBalance"
          name="startingBalance"
          label="Начальный баланс"
          :tooltip="startingBalanceTooltip"
          :hint="startingBalanceHint"
          :error="getFieldError('startingBalance')"
          :required="!editingId"
        />
        <p
          v-if="startingBalancePreview !== null"
          class="reference-form__note"
          data-testid="starting-balance-preview"
        >
          После сохранения останется: {{ startingBalancePreview }}
        </p>
```

7) Компуты/хелпер (рядом с `optionalMoney`):

```ts
const startingBalanceTooltip = computed(() =>
  editingId.value
    ? 'Если изменить эту сумму, остаток конверта станет больше или меньше на ту же разницу — прошедшие операции не удалятся. Прозрачнее изменить остаток доходом или переносом между конвертами.'
    : 'Сумма, с которой конверт начинает жизнь. Дальше остаток меняется только операциями: доход, расходы, переносы между конвертами.',
);

const startingBalanceHint = computed(() =>
  editingId.value ? 'Можно оставить пустым — остаток конверта не изменится.' : '',
);

function parseMoneyInput(value: string): bigint | null {
  const match = /^([+-]?)(\d+)(?:[.,](\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const fraction = (match[3] ?? '').padEnd(2, '0');
  const sign = match[1] === '-' ? '-' : '';
  return BigInt(`${sign}${match[2]}${fraction}`);
}

const startingBalancePreview = computed<string | null>(() => {
  const envelope = editingEnvelope.value;
  const input = form.startingBalance.trim();
  if (!envelope || !input) return null;
  const requested = parseMoneyInput(input);
  if (requested === null) return null;
  const nextCurrent =
    BigInt(envelope.currentBalanceMinor) + requested - BigInt(envelope.startingBalanceMinor);
  return formatMinorUnits(nextCurrent, envelope.currency, envelope.scale);
});
```

Поведение «пусто = не менять» сохранить без изменений (`saveEnvelope` уже так работает, строки 230-232).

Commit: `feat(web): fetch envelope balance summary on drawer open, plain-language starting-balance help and preview`

---

## Task 8: Web unit-тесты

`apps/web/app/components/envelopes/EnvelopeDrawer.test.ts`

Добавить импорты/факс:

```ts
import type { EnvelopeBalanceSummaryDto } from '../../composables/useBudgetReferenceData.js';

const balanceSummary: EnvelopeBalanceSummaryDto = {
  envelope,
  currency: 'RUB',
  scale: 2,
  startingBalanceMinor: '1000',
  incomeAllocatedMinor: '20000',
  expensesMinor: '5000',
  envelopeTransfersNetMinor: '0',
  reallocationsNetMinor: '1500',
  currentBalanceMinor: '20500',
  reallocations: [
    {
      reallocationId: 'reallocation-id',
      direction: 'IN',
      otherEnvelopeId: 'other-id',
      otherEnvelopeName: 'Первая половина',
      amountMinor: '1500',
      occurredOn: '2026-09-01',
      comment: null,
    },
  ],
};
```

`mountDrawer` расширить:

```ts
const mountDrawer = (
  overrides: Partial<EnvelopeDto> = {},
  extra: Record<string, unknown> = {},
) =>
  mount(EnvelopeDrawer, {
    props: { envelope: { ...envelope, ...overrides }, ...extra },
    attachTo: document.body,
    global: { stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } },
  });
```

Новые тесты:

```ts
  it('explains where the balance comes from with additive terms', () => {
    const wrapper = mountDrawer({}, { balanceSummary });

    expect(wrapper.text()).toContain('Откуда остаток');
    expect(wrapper.text()).toContain('Добавили доходы');
    expect(wrapper.text()).toContain('Потратили на расходы');
    expect(wrapper.text()).toContain('Движения между конвертами');
    expect(wrapper.text()).toContain('Текущий остаток');
    wrapper.unmount();
  });

  it('lists reallocation movements with direction and counterparty', () => {
    const wrapper = mountDrawer({}, { balanceSummary });

    const amounts = wrapper
      .findAll('[data-testid="reallocation-amount"]')
      .map((node) => node.text());
    expect(amounts).toHaveLength(1);
    expect(wrapper.text()).toContain('в «Первая половина»');
    wrapper.unmount();
  });

  it('shows a loading skeleton and an error line when the summary is unavailable', () => {
    const loading = mountDrawer({}, { balanceSummaryLoading: true });
    expect(loading.find('[data-testid="envelope-drawer-breakdown"]').exists()).toBe(false);
    loading.unmount();

    const errored = mountDrawer({}, { balanceSummaryError: 'Не удалось загрузить.' });
    expect(
      errored.get('[data-testid="envelope-drawer-summary-error"]').text(),
    ).toContain('Не удалось загрузить.');
    errored.unmount();
  });
```

`apps/web/app/pages/app/envelopes.test.ts`

1) В `mocks.api` (строки 6-13) добавить `getEnvelopeBalanceSummary: vi.fn(),`.
2) Новый тест в конце `describe`:

```ts
  it('loads the balance breakdown when the envelope drawer opens', async () => {
    mocks.api.getEnvelopeBalanceSummary.mockResolvedValue({
      envelope,
      currency: 'RUB',
      scale: 2,
      startingBalanceMinor: '0',
      incomeAllocatedMinor: '12345',
      expensesMinor: '0',
      envelopeTransfersNetMinor: '0',
      reallocationsNetMinor: '0',
      currentBalanceMinor: '12345',
      reallocations: [],
    });
    // seed listEnvelopes/getEnvelopesSummary по шаблону соседних тестов (sm. L81+)
    const wrapper = mountPage();
    await flushPromises();

    await wrapper.get('[role="button"]') ... 
```

ВАРИАНТ: точный селектор клика по строке — сверить с соседним тестом открытия drawer в том же файле (поиск `detailed`/`select` в `envelopes.test.ts` L81-243). Если соседний тест уже открывает строк — дописать туда/рядом ассерты `getEnvelopeBalanceSummary` вызван + текст «Откуда остаток» в DOM.

3) Тест предпросмотра:

```ts
  it('previews the resulting balance when the starting balance is changed', async () => {
    mocks.api.getEnvelopesSummary.mockResolvedValue(summaryFixture...);
    mocks.api.listEnvelopes.mockResolvedValue([envelope]);
    // открыть карточку конверта → menu «Изменить» (data-testid="row-edit")
    // вставить в field startingBalance '50' (через label 'Начальный баланс')
    // expect getByTestId('starting-balance-preview') toContainText с форматированной суммой 12345 + 5000 = '17 345' (normalize NBSP)
  });
```
Точные шаги — по реальному флюу формы в файле (UI-поле `name="startingBalance"`, `UiActionMenu` открыть: trigger `row-actions-${id}`).

Commit: `test(web): envelope drawer breakdown and starting-balance preview coverage`

---

## Task 9: E2E

Новый файл `e2e/envelope-balance-breakdown.spec.ts`. Шаблон — `e2e/period-leftover.spec.ts` (register → `page.evaluate(fetch)` seed → UI).

```ts
import { expect, test, type Page } from '@playwright/test';
import { apiV1 } from './env';

const password = 'e2e-password-10';

test('explains where the envelope balance comes from and lists reallocation movements', async ({
  page,
}) => {
  await registerAndSeedBreakdown(page);

  await page.goto('/app/envelopes');
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();

  await page.getByRole('button', { name: 'Ремонт breakdown' }).click();
  await expect(page.getByTestId('envelope-drawer-breakdown')).toBeVisible();
  await expect(page.getByTestId('envelope-drawer-breakdown')).toContainText('Откуда остаток');
  await expect(page.getByTestId('envelope-drawer-breakdown')).toContainText('Текущий остаток');

  const reallocations = page.getByTestId('envelope-drawer-reallocations');
  await expect(reallocations).toBeVisible();
  await expect(reallocations).toContainText('из «Ресерва breakdown»');
  await expect(reallocations.locator('[data-testid="reallocation-amount"]')).toContainText('500');
});

async function registerAndSeedBreakdown(page: Page) {
  const email = `balance-breakdown-${Date.now()}-${Math.random().toString(16).slice(2)}@harmofin.test`;
  await page.goto('/register');
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page).toHaveURL(/\/app$/);

  await page.evaluate(
    async ({ api }) => {
      const me = (await fetch(`${api}/me`, { credentials: 'include' }).then((response) =>
        response.json(),
      )) as { workspaces: Array<{ budgets: Array<{ id: string }> }> };
      const budgetId = me.workspaces[0]?.budgets[0]?.id ?? '';
      const csrf = (
        await fetch(`${api}/auth/csrf`, { credentials: 'include' }).then((response) =>
          response.json(),
        )
      ) as { csrfToken: string };

      const reserve = await fetch(`${api}/budgets/${budgetId}/envelopes`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf.csrfToken },
        body: JSON.stringify({
          name: 'Резерва breakdown',
          envelopeType: 'RESERVE',
          currency: 'RUB',
          startingBalance: '0.00',
          displayOrder: 0,
        }),
      }).then((response) => response.json() as { id: string });

      const target = await fetch(`${api}/budgets/${budgetId}/envelopes`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf.csrfToken },
        body: JSON.stringify({
          name: 'Ремонт breakdown',
          envelopeType: 'SAVINGS_GOAL',
          currency: 'RUB',
          startingBalance: '100.00',
          displayOrder: 1,
        }),
      }).then((response) => response.json() as { id: string });

      await fetch(`${api}/budgets/${budgetId}/envelope-reallocations`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf.csrfToken },
        body: JSON.stringify({
          sourceEnvelopeId: reserve.id,
          destinationEnvelopeId: target.id,
          amount: '500.00',
          occurredOn: new Date().toISOString().slice(0, 10),
        }),
      });
    },
    { api: apiV1 },
  );
}
```

ПАМЯТКА:
- Имя конверта «Резерва breakdown» — опечаточный риск, выбрать правильное слово («Резерв breakdown») и синхронно поправить `toContainText('из «Резерв breakdown»')` в ассерте.
- Клик по строке: сверить, как `EnvelopeRow` в e2e открывается (в `period-leftover` строки не кликают; если `EnvelopeRow` — это `<button>` — `getByRole('button', { name: 'Ремонт breakdown' })`; иначе `getByTestId` на строке — глянуть `EnvelopeRow.vue`).
- Сумма «500» в `reallocation-amount` — форматирование `formatMinorUnits('50000','RUB',2)` = `500,00 ₽` (с NBSP/запятой) — ассерт `toContainText('500')` устойчив.
- У reallocation через API нет `idempotency-key`? По спеке мутации — с ключом; в `period-leftover.spec` seed без ключа проходит (стр. 137-153 envelopes POST; reallocation там через UI). Если API требует `Idempotency-Key` — добавить `Idempotency-Key` в headers seed'а (проверить `envelope-reallocation` controler: у reallocations ключ ОБЯЗАТЕЛЕН — в OpenAPI он required; добавить `'Idempotency-Key': 'e2e-breakdown-move'`).

Commit: `test(e2e): envelope balance breakdown journey`

---

## Задача 10: Гейты (из root `C:\Projects\SANDBOX\HarmoFin`)

PowerShell (PS 5.1, `&&` нельзя). Путь к pnpm (из предыдущей сессии):

```powershell
$env:Path = "C:\Users\iisiraev\AppData\Local\Programs\DockerDesktop\resources\bin;C:\Users\iisiraev\AppData\Local\Programs\DockerDesktop\resources\cli-plugins;" + $env:Path
$env:npm_config_manage_package_manager_versions='false'
& "C:\Users\iisiraev\AppData\Roaming\npm\pnpm.cmd" lint
& "C:\Users\iisiraev\AppData\Roaming\npm\pnpm.cmd" format:check
& "C:\Users\iisiraev\AppData\Roaming\npm\pnpm.cmd" typecheck
& "C:\Users\iisiraev\AppData\Roaming\npm\pnpm.cmd" test
& "C:\Users\iisiraev\AppData\Roaming\npm\pnpm.cmd" test:integration
& "C:\Users\iisiraev\AppData\Roaming\npm\pnpm.cmd" build
& "C:\Users\iisiraev\AppData\Roaming\npm\pnpm.cmd" test:e2e
```

Ожидаемые:
- `lint` — 0 ошибок (172 warnings из ранее существовавших — ок).
- `format:check` — только `docs/.kilo/worktrees/plume-run` (не трогать).
- `typecheck` — 0.
- `test` (web) — рост на ~5 тестов (3 drawer + 2 page), все зелёные.
- `test:integration` — +1 файл (2-3 теста), зелёные.
- `build` — 0.
- `e2e` — 2/2 → 3/3.

Не запускать: `pnpm infra:up` (БД уже поднята), `db:migrate:dev`/rollbacks.

---

## Опечатки/риск-чеклист перед коммитом (проверить в коде)

1. Task 5: `currentBalanceMiniR` → `currentBalanceMinor`.
2. Task 4: `envelopeA`/`suffix` — верхний scope; `envelopeB` — локальный в seed; порядок `cleanup`; поля `Transfer`/`TransferPart` — сверить с `prisma/schema.prisma`.
3. Task 4: `transfer` с двумя РАЗНЫМИ счётами (source ≠ destination!) — см. поправку в seed в Task 4.
4. Task 4: ожидаемые суммы A: start 100.00, income 500.00, expense 150.00, transfer +700.00 (B→A), realloc +200.00 (B→A) → current = 100+500−150+700+200 = **1350,00** → `'135000'`. Реаллокации в списке A: 1 строка `IN`, other `Назначение {suffix}`.
5. Task 9: `Idempotency-Key` в reallocation seed; правильное имя конверта; селектор клика по строке.
6. Task 6: имя/prop `UiInfoTooltip` (стр. `ui/InfoTooltip.vue`); токены цветов.
7. Task 8: точные шаги UI — по коду формы/меню в `envelopes.test.ts`.
