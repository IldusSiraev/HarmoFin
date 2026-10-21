# Переводы в журнале операций — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Показать переводы между счетами в журнале операций и дать возможность изменять, удалять и восстанавливать их там же; убрать отдельную страницу переводов.

**Architecture:** Новый read-only эндпоинт `GET /api/v2/budgets/:budgetId/journal` (модуль `v2-journal`) сливает два keyset-запроса (операции и переводы `ACCOUNT_ONLY`) в одну ленту с общим курсором. В модуль `v2-transfers` добавляются `PATCH`/`DELETE`/`restore` по образцу операций v2: транзакция, блокировки, idempotency, аудит, проверка баланса затронутых счетов. Web-журнал читает ленту, рисует перевод отдельной строкой и управляет им через диалог `TransferDialog`.

**Tech Stack:** NestJS 11 + Fastify, Prisma, PostgreSQL 18, Zod, Vitest (+ `server.inject`), Nuxt 4 / Vue 3.5, @vue/test-utils, Playwright (только CI).

**Spec:** [docs/superpowers/specs/2026-10-20-transfers-in-operations-journal-design.md](../specs/2026-10-20-transfers-in-operations-journal-design.md)

## Global Constraints

- Деньги — только `bigint` минорных единиц на сервере; на входе API — десятичная строка `^\d+(\.\d{1,2})?$`, парсинг `parseDecimalToMinorUnits(value, 2, false)`; на выходе — строка `formatMinorUnits`.
- Каждый запрос к данным фильтрует `budgetId` в самом запросе; переводы — только `mode: 'ACCOUNT_ONLY'`.
- Мутации: `CsrfGuard`, обязательный `Idempotency-Key` (`validKey`), одна `prisma.$transaction`, блокировки: бюджет → idempotency → строка перевода → счета по id.
- Контроллеры только переводят HTTP; правила — в application service; данные — в repository.
- Существующие `GET/POST /api/v2/.../transfers` и `GET /transactions` не меняются по смыслу.
- UI-тексты и документация — на русском; идентификаторы — на английском.
- Визуальные правила — [Calm Fintech visual guidelines](../specs/2026-09-17-calm-fintech-visual-guidelines.md); иконки — `@lucide/vue`.
- Локальный Playwright не запускать; e2e-сценарий проверяется в CI.
- Не создавать worktree; коммит каждой задачи — только с разрешения владельца (по правилам проекта коммитит основная сессия после ревью).
- Не трогать `identity/logo_description.png`.

## Структура файлов

API (`apps/api`):

- Create `src/v2-transfers/direct-transfer.domain.ts` — чистая функция изменения балансов счетов при смене состояния перевода.
- Create `src/v2-transfers/direct-transfer.domain.test.ts`.
- Modify `src/v2-transfers/direct-transfer.repository.ts` — `findForMutation`, `updateTransfer`, `setLifecycle` + аудит.
- Modify `src/v2-transfers/direct-transfer.application.service.ts` — `update`, `remove`, `restore`, тип `TransferJournalItem`, `toTransferJournalItem`.
- Modify `src/v2-transfers/direct-transfer.schemas.ts` — `updateDirectTransferSchema`.
- Modify `src/v2-transfers/direct-transfer.dto.ts` — `UpdateDirectTransferInput`, `TransferJournalItemResponse`.
- Modify `src/v2-transfers/direct-transfer.controller.ts` — три новых маршрута.
- Create `test/v2-transfer-lifecycle.integration.test.ts`.
- Create `src/v2-journal/journal.schemas.ts`, `journal.cursor.ts`, `journal.cursor.test.ts`, `journal.merge.ts`, `journal.merge.test.ts`, `journal.repository.ts`, `journal.application.service.ts`, `journal.dto.ts`, `journal.controller.ts`, `journal.module.ts`.
- Modify `src/app.module.ts` — регистрация `JournalModule`.
- Modify `src/v2-transactions/transaction-v2.application.service.ts` — экспорт `toJournalItem`.
- Create `test/v2-journal.integration.test.ts`.
- Modify `test/v2-openapi.integration.test.ts` — новые пути.

Web (`apps/web/app`):

- Modify `composables/useEnvelopePlanV2.ts` — типы ленты и перевода, методы `listJournal`, `updateTransfer`, `deleteTransfer`, `restoreTransfer`; удалить `listDirectTransfers`, `DirectTransferListResponse`.
- Modify `composables/useOperationFilters.ts` (+ test) — `type: 'TRANSFER'`, `toListInput(): JournalQuery`.
- Modify `components/operations/OperationsToolbar.vue` (+ test) — вкладка «Переводы».
- Modify `composables/useTransferForm.ts` (+ test) — поле `comment`, `transferFormFrom`, `toTransferPatch`.
- Modify `components/transfers/DirectTransferForm.vue` (+ test) — поле комментария, проп `submitLabel`.
- Create `composables/useTransferMutations.ts` (+ test).
- Create `components/operations/TransferRow.vue` (+ test).
- Create `components/operations/TransferDialog.vue` (+ test).
- Modify `pages/app/operations.vue` (+ test) — лента, строки переводов, `TransferDialog`.
- Modify `composables/useOperationDialogs.ts` (+ test) — `openTransfer(sourceAccountId?)`, `transferSourceAccountId`.
- Modify `components/app/AppOperationEntryDialog.vue`, `components/app/AppOperationDialogs.vue` — заполненный счёт-источник.
- Modify `components/accounts/AccountDialog.vue` (+ test) — кнопка открывает диалог перевода.
- Modify `components/app/AppSidebar.vue` (+ test), `components/app/AppMobileMenu.vue` — без пункта «Переводы».
- Delete `pages/app/transfers.vue`, `pages/app/transfers.test.ts`, `components/transfers/DirectTransferCard.vue`.

E2E: Create `e2e/envelope-v2-transfers-journal.spec.ts`.

---

### Task 1: Сервис мутаций перевода (API, без HTTP)

**Files:**
- Create: `apps/api/src/v2-transfers/direct-transfer.domain.ts`
- Create: `apps/api/src/v2-transfers/direct-transfer.domain.test.ts`
- Modify: `apps/api/src/v2-transfers/direct-transfer.repository.ts`
- Modify: `apps/api/src/v2-transfers/direct-transfer.application.service.ts`
- Modify: `apps/api/src/v2-transfers/direct-transfer.schemas.ts`
- Test: `apps/api/test/v2-transfer-lifecycle.integration.test.ts`

**Interfaces:**
- Produces:
  - `type TransferJournalItem = { kind: 'TRANSFER'; id: string; budgetId: string; status: 'CONFIRMED' | 'DELETED'; amountMinor: string; currency: string; occurredOn: string; sourceAccountId: string; destinationAccountId: string; comment: string | null; createdAt: string; deletedAt: string | null }` (экспорт из `direct-transfer.application.service.ts`).
  - `function toTransferJournalItem(row: TransferRow): TransferJournalItem` (там же).
  - `type TransferRow` и `const transferRowSelect` (экспорт из `direct-transfer.repository.ts`).
  - `DirectTransferApplicationService.update(userId, budgetId, transferId, input: UpdateDirectTransferInput, idempotencyKey, requestId?) => Promise<TransferJournalItem>`
  - `DirectTransferApplicationService.remove(userId, budgetId, transferId, idempotencyKey, requestId?) => Promise<TransferJournalItem>`
  - `DirectTransferApplicationService.restore(userId, budgetId, transferId, idempotencyKey, requestId?) => Promise<TransferJournalItem>`
  - `updateDirectTransferSchema`, `type UpdateDirectTransferInput` (из `direct-transfer.schemas.ts`).

- [ ] **Step 1: Unit-тест чистой функции дельт балансов**

`apps/api/src/v2-transfers/direct-transfer.domain.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { balanceDecreases, type TransferEffect } from './direct-transfer.domain.js';

const confirmed = (source: string, destination: string, amount: bigint): TransferEffect => ({
  confirmed: true,
  sourceAccountId: source,
  destinationAccountId: destination,
  amountMinor: amount,
});
const deleted = (source: string, destination: string, amount: bigint): TransferEffect => ({
  ...confirmed(source, destination, amount),
  confirmed: false,
});

describe('balanceDecreases', () => {
  it('удаление уменьшает только счёт назначения', () => {
    expect(balanceDecreases(confirmed('a', 'b', 100n), deleted('a', 'b', 100n))).toEqual(
      new Map([['b', 100n]]),
    );
  });

  it('восстановление уменьшает только счёт-источник', () => {
    expect(balanceDecreases(deleted('a', 'b', 100n), confirmed('a', 'b', 100n))).toEqual(
      new Map([['a', 100n]]),
    );
  });

  it('рост суммы уменьшает источник на разницу', () => {
    expect(balanceDecreases(confirmed('a', 'b', 100n), confirmed('a', 'b', 250n))).toEqual(
      new Map([['a', 150n]]),
    );
  });

  it('уменьшение суммы уменьшает назначение на разницу', () => {
    expect(balanceDecreases(confirmed('a', 'b', 100n), confirmed('a', 'b', 40n))).toEqual(
      new Map([['b', 60n]]),
    );
  });

  it('смена назначения уменьшает старое назначение и не трогает новое', () => {
    expect(balanceDecreases(confirmed('a', 'b', 100n), confirmed('a', 'c', 100n))).toEqual(
      new Map([['b', 100n]]),
    );
  });

  it('смена источника уменьшает новый источник', () => {
    expect(balanceDecreases(confirmed('a', 'b', 100n), confirmed('c', 'b', 100n))).toEqual(
      new Map([['c', 100n]]),
    );
  });

  it('разворот направления уменьшает старое назначение на двойную сумму', () => {
    expect(balanceDecreases(confirmed('a', 'b', 100n), confirmed('b', 'a', 100n))).toEqual(
      new Map([['b', 200n]]),
    );
  });

  it('смена только комментария или даты ничего не уменьшает', () => {
    expect(balanceDecreases(confirmed('a', 'b', 100n), confirmed('a', 'b', 100n))).toEqual(
      new Map(),
    );
  });
});
```

- [ ] **Step 2: Запустить — тест падает**

Run: `pnpm --filter @harmofin/api test -- src/v2-transfers/direct-transfer.domain.test.ts`
Expected: FAIL — `Cannot find module './direct-transfer.domain.js'`.

- [ ] **Step 3: Реализовать функцию**

`apps/api/src/v2-transfers/direct-transfer.domain.ts`:

```ts
/** Effect of one transfer state on account balances: only CONFIRMED moves money. */
export type TransferEffect = {
  confirmed: boolean;
  sourceAccountId: string;
  destinationAccountId: string;
  amountMinor: bigint;
};

function effects(state: TransferEffect): Map<string, bigint> {
  const result = new Map<string, bigint>();
  if (!state.confirmed) return result;
  result.set(state.sourceAccountId, -state.amountMinor);
  result.set(
    state.destinationAccountId,
    (result.get(state.destinationAccountId) ?? 0n) + state.amountMinor,
  );
  return result;
}

/**
 * Accounts whose balance goes down when a transfer moves from `before` to `after`,
 * with the positive size of the decrease. Only these need the non-negative check.
 */
export function balanceDecreases(
  before: TransferEffect,
  after: TransferEffect,
): Map<string, bigint> {
  const was = effects(before);
  const will = effects(after);
  const decreases = new Map<string, bigint>();
  for (const accountId of new Set([...was.keys(), ...will.keys()])) {
    const delta = (will.get(accountId) ?? 0n) - (was.get(accountId) ?? 0n);
    if (delta < 0n) decreases.set(accountId, -delta);
  }
  return decreases;
}
```

- [ ] **Step 4: Запустить — тест проходит**

Run: `pnpm --filter @harmofin/api test -- src/v2-transfers/direct-transfer.domain.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Схема PATCH**

Добавить в конец `apps/api/src/v2-transfers/direct-transfer.schemas.ts`:

```ts
/** Partial edit of a direct transfer; status changes only through delete/restore. */
export const updateDirectTransferSchema = z
  .object({
    sourceAccountId: uuid.optional(),
    destinationAccountId: uuid.optional(),
    amount: z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/)
      .refine((v) => Number(v) > 0, { message: 'Сумма должна быть больше нуля.' })
      .optional(),
    occurredOn: occurredOnSchema.optional(),
    comment: z.string().max(500).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'Укажите хотя бы одно поле.' });

export type UpdateDirectTransferInput = z.infer<typeof updateDirectTransferSchema>;
```

- [ ] **Step 6: Repository — чтение для мутации, обновление, жизненный цикл**

В `apps/api/src/v2-transfers/direct-transfer.repository.ts` добавить экспорт выборки и типа строки над классом:

```ts
export const transferRowSelect = {
  id: true,
  budgetId: true,
  status: true,
  totalMinor: true,
  currency: true,
  occurredOn: true,
  comment: true,
  sourceAccountId: true,
  destinationAccountId: true,
  createdAt: true,
  deletedAt: true,
} as const;

export type TransferRow = Prisma.TransferGetPayload<{ select: typeof transferRowSelect }>;

export type TransferChanges = {
  sourceAccountId: string;
  destinationAccountId: string;
  totalMinor: bigint;
  occurredOn: Date;
  comment: string | null;
};

function transferAuditValues(row: TransferRow) {
  return {
    status: row.status,
    sourceAccountId: row.sourceAccountId,
    destinationAccountId: row.destinationAccountId,
    totalMinor: row.totalMinor.toString(),
    occurredOn: row.occurredOn.toISOString().slice(0, 10),
    comment: row.comment,
    deletedAt: row.deletedAt?.toISOString() ?? null,
  };
}

function changedOnly(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): { oldValues: Record<string, unknown>; newValues: Record<string, unknown> } {
  const oldValues: Record<string, unknown> = {};
  const newValues: Record<string, unknown> = {};
  for (const key of Object.keys(after)) {
    if (before[key] !== after[key]) {
      oldValues[key] = before[key];
      newValues[key] = after[key];
    }
  }
  return { oldValues, newValues };
}
```

И методы класса `DirectTransferRepository`:

```ts
  /** Locks the transfer row of this budget; only ACCOUNT_ONLY transfers are mutable. */
  async findForMutation(
    tx: Prisma.TransactionClient,
    budgetId: string,
    transferId: string,
  ): Promise<TransferRow | null> {
    await tx.$queryRaw`
      SELECT "id" FROM "transfers"
      WHERE "id" = ${transferId}::uuid AND "budget_id" = ${budgetId}::uuid
      FOR UPDATE
    `;
    return tx.transfer.findFirst({
      where: { id: transferId, budgetId, mode: 'ACCOUNT_ONLY' },
      select: transferRowSelect,
    });
  }

  async updateTransfer(
    tx: Prisma.TransactionClient,
    current: TransferRow,
    changes: TransferChanges,
    audit: { workspaceId: string; actorUserId: string; requestId?: string | undefined },
  ): Promise<TransferRow> {
    const updated = await tx.transfer.update({
      where: { id: current.id },
      data: {
        sourceAccountId: changes.sourceAccountId,
        destinationAccountId: changes.destinationAccountId,
        totalMinor: changes.totalMinor,
        occurredOn: changes.occurredOn,
        comment: changes.comment,
        updatedByUserId: audit.actorUserId,
      },
      select: transferRowSelect,
    });
    const diff = changedOnly(transferAuditValues(current), transferAuditValues(updated));
    await this.audit(tx, current, 'UPDATED', audit, diff.oldValues, diff.newValues);
    return updated;
  }

  async setLifecycle(
    tx: Prisma.TransactionClient,
    current: TransferRow,
    status: 'CONFIRMED' | 'DELETED',
    audit: { workspaceId: string; actorUserId: string; requestId?: string | undefined },
  ): Promise<TransferRow> {
    const updated = await tx.transfer.update({
      where: { id: current.id },
      data: {
        status,
        deletedAt: status === 'DELETED' ? new Date() : null,
        updatedByUserId: audit.actorUserId,
      },
      select: transferRowSelect,
    });
    await this.audit(
      tx,
      current,
      status === 'DELETED' ? 'DELETED' : 'RESTORED',
      audit,
      transferAuditValues(current),
      transferAuditValues(updated),
    );
    return updated;
  }

  private async audit(
    tx: Prisma.TransactionClient,
    current: TransferRow,
    action: 'UPDATED' | 'DELETED' | 'RESTORED',
    audit: { workspaceId: string; actorUserId: string; requestId?: string | undefined },
    oldValues: Record<string, unknown>,
    newValues: Record<string, unknown>,
  ): Promise<void> {
    await tx.auditEvent.create({
      data: {
        id: createUuidV7(),
        actorUserId: audit.actorUserId,
        workspaceId: audit.workspaceId,
        budgetId: current.budgetId,
        entityType: 'transfer',
        entityId: current.id,
        action,
        source: 'API',
        requestId: audit.requestId ?? null,
        oldValues: oldValues as Prisma.InputJsonValue,
        newValues: newValues as Prisma.InputJsonValue,
      },
    });
  }
```

- [ ] **Step 7: Написать падающие интеграционные тесты сервиса**

Создать `apps/api/test/v2-transfer-lifecycle.integration.test.ts`. Каркас (импорты, `databaseUrl`, `prisma`, `origin`, `password`, `d()`, `beforeAll` с `createApiApp`, `afterAll`, и функции `register`, `createRawAccount`, `cleanupUser`, `expectError`) скопировать дословно из `apps/api/test/v2-direct-transfers.integration.test.ts` (строки 1–122 и 1000–1117), заменив префиксы e-mail на `v2-transfer-life-…`. Пользователи: `owner`, `editor` (membership `EDITOR` в workspace владельца), `viewer` (`VIEWER`), `outsider`. Сервис создаётся как в исходном файле:

```ts
service = new DirectTransferApplicationService(
  new PrismaService(databaseUrl),
  new IdempotencyService(),
  new PlanModelPolicy(new PrismaService(databaseUrl)),
);
```

Хелперы внутри `describe`:

```ts
const today = todayInTimezone(new Date(), 'UTC');
const yesterday = new Date(Date.now() - dayMs).toISOString().slice(0, 10);
const tomorrow = new Date(Date.now() + dayMs).toISOString().slice(0, 10);
const budgetId = () => ctx.owner!.budgetId;
const balance = (accountId: string) =>
  prisma.$transaction((tx) => balances.accountBalance(tx, budgetId(), accountId));

async function strict(allow: boolean): Promise<void> {
  await prisma.budget.update({ where: { id: budgetId() }, data: { allowNegativeBalance: !allow } });
}

async function newTransfer(source: string, destination: string, amount: string) {
  return service.create(
    ctx.owner!.userId,
    budgetId(),
    { sourceAccountId: source, destinationAccountId: destination, amount, occurredOn: today },
    randomUUID(),
  );
}
```

В `beforeAll` после регистрации: бюджеты `owner` и `outsider` переводятся в модель 2 (как в исходном файле), создаются счета владельца `a` (10 000 ₽ = `1_000_000n`), `b` (`0n`), `c` (`0n`), архивный `archived` (`0n`, `archivedAt`), чужой счёт `foreign` в бюджете `outsider`. `allowNegativeBalance` по умолчанию — вызывать `strict(true)` в начале каждого теста про баланс.

Тесты:

```ts
it('изменяет сумму, дату, счета и комментарий; балансы и аудит отражают изменение', async () => {
  await strict(true);
  const created = await newTransfer(a, b, '100.00');
  const view = await service.update(
    ctx.owner!.userId,
    budgetId(),
    created.id,
    { amount: '250.00', destinationAccountId: c, occurredOn: yesterday, comment: 'Отпуск' },
    randomUUID(),
  );
  expect(view).toMatchObject({
    kind: 'TRANSFER',
    id: created.id,
    status: 'CONFIRMED',
    amountMinor: '25000',
    sourceAccountId: a,
    destinationAccountId: c,
    occurredOn: yesterday,
    comment: 'Отпуск',
    deletedAt: null,
  });
  expect(await balance(b)).toBe(0n);
  expect(await balance(c)).toBe(25_000n);
  const event = await prisma.auditEvent.findFirstOrThrow({
    where: { entityType: 'transfer', entityId: created.id, action: 'UPDATED' },
  });
  expect(event.oldValues).toMatchObject({ totalMinor: '10000', destinationAccountId: b, comment: null });
  expect(event.newValues).toMatchObject({ totalMinor: '25000', destinationAccountId: c, comment: 'Отпуск' });
  expect(Object.keys(event.newValues as object)).not.toContain('sourceAccountId');
});

it('удаляет логически и восстанавливает; балансы возвращаются', async () => {
  const created = await newTransfer(a, b, '100.00');
  const bBefore = await balance(b);
  const removed = await service.remove(ctx.owner!.userId, budgetId(), created.id, randomUUID());
  expect(removed.status).toBe('DELETED');
  expect(removed.deletedAt).not.toBeNull();
  expect(await balance(b)).toBe(bBefore - 10_000n);
  const restored = await service.restore(ctx.owner!.userId, budgetId(), created.id, randomUUID());
  expect(restored).toMatchObject({ status: 'CONFIRMED', deletedAt: null });
  expect(await balance(b)).toBe(bBefore);
  const actions = await prisma.auditEvent.findMany({
    where: { entityType: 'transfer', entityId: created.id },
    select: { action: true },
    orderBy: { createdAt: 'asc' },
  });
  expect(actions.map((e) => e.action)).toEqual(['CREATED', 'DELETED', 'RESTORED']);
});

it('строгий бюджет: удаление, уводящее счёт назначения в минус, — 409 INSUFFICIENT_BALANCE без изменений', async () => {
  await strict(true);
  const created = await newTransfer(a, c, '100.00');
  // c тратит полученное: переводим всё обратно на a
  await newTransfer(c, a, '100.00');
  expect(await expectError(service.remove(ctx.owner!.userId, budgetId(), created.id, randomUUID())))
    .toEqual({ status: 409, code: 'INSUFFICIENT_BALANCE' });
  expect((await prisma.transfer.findUniqueOrThrow({ where: { id: created.id } })).status).toBe('CONFIRMED');
});

it('строгий бюджет: восстановление и рост суммы проверяют счёт-источник', async () => {
  await strict(true);
  const all = (await balance(a)).toString();
  const amount = `${all.slice(0, -2) || '0'}.${all.slice(-2).padStart(2, '0')}`;
  const big = await newTransfer(a, b, amount); // a = 0
  expect(
    await expectError(
      service.update(ctx.owner!.userId, budgetId(), big.id, { amount: `${Number(amount) + 1}.00` }, randomUUID()),
    ),
  ).toEqual({ status: 409, code: 'INSUFFICIENT_BALANCE' });
  await service.remove(ctx.owner!.userId, budgetId(), big.id, randomUUID()); // a снова полный
  await newTransfer(a, c, '1.00'); // a < суммы big
  expect(await expectError(service.restore(ctx.owner!.userId, budgetId(), big.id, randomUUID())))
    .toEqual({ status: 409, code: 'INSUFFICIENT_BALANCE' });
});

it('нестрогий бюджет разрешает уход в минус', async () => {
  await strict(false);
  const created = await newTransfer(a, c, '1.00');
  await newTransfer(c, a, '1.00');
  const removed = await service.remove(ctx.owner!.userId, budgetId(), created.id, randomUUID());
  expect(removed.status).toBe('DELETED');
  await strict(true);
});

it('валидация PATCH: одинаковые счета, будущая дата, архивный, чужой счёт', async () => {
  const created = await newTransfer(a, b, '1.00');
  const call = (input: Parameters<typeof service.update>[3]) =>
    expectError(service.update(ctx.owner!.userId, budgetId(), created.id, input, randomUUID()));
  expect(await call({ destinationAccountId: a })).toEqual({ status: 400, code: 'TRANSFER_ACCOUNTS_MUST_DIFFER' });
  expect(await call({ occurredOn: tomorrow })).toEqual({ status: 400, code: 'VALIDATION_FAILED' });
  expect(await call({ destinationAccountId: archived })).toEqual({ status: 400, code: 'INVALID_REFERENCE' });
  expect(await call({ destinationAccountId: foreign })).toEqual({ status: 404, code: 'RESOURCE_NOT_FOUND' });
});

it('удалённый перевод не изменяется и не удаляется повторно; восстановить можно только удалённый', async () => {
  const created = await newTransfer(a, b, '1.00');
  expect(await expectError(service.restore(ctx.owner!.userId, budgetId(), created.id, randomUUID())))
    .toEqual({ status: 409, code: 'TRANSFER_NOT_DELETED' });
  await service.remove(ctx.owner!.userId, budgetId(), created.id, randomUUID());
  expect(await expectError(service.remove(ctx.owner!.userId, budgetId(), created.id, randomUUID())))
    .toEqual({ status: 409, code: 'TRANSFER_ALREADY_DELETED' });
  expect(
    await expectError(service.update(ctx.owner!.userId, budgetId(), created.id, { comment: 'x' }, randomUUID())),
  ).toEqual({ status: 409, code: 'TRANSFER_NOT_EDITABLE' });
});

it('восстановление с архивным счётом — 409 INVALID_REFERENCE', async () => {
  const temp = await createRawAccount(budgetId(), 'RUB', 0n);
  const created = await newTransfer(a, temp, '1.00');
  await service.remove(ctx.owner!.userId, budgetId(), created.id, randomUUID());
  await prisma.account.update({ where: { id: temp }, data: { archivedAt: new Date() } });
  expect(await expectError(service.restore(ctx.owner!.userId, budgetId(), created.id, randomUUID())))
    .toEqual({ status: 409, code: 'INVALID_REFERENCE' });
});

it('роли: viewer — 403 на всё; editor изменяет и удаляет, но не восстанавливает; чужой бюджет — 404', async () => {
  const created = await newTransfer(a, b, '1.00');
  expect(await expectError(service.update(ctx.viewer!.userId, budgetId(), created.id, { comment: 'v' }, randomUUID())))
    .toEqual({ status: 403, code: 'FORBIDDEN' });
  expect(await expectError(service.remove(ctx.viewer!.userId, budgetId(), created.id, randomUUID())))
    .toEqual({ status: 403, code: 'FORBIDDEN' });
  await service.update(ctx.editor!.userId, budgetId(), created.id, { comment: 'e' }, randomUUID());
  await service.remove(ctx.editor!.userId, budgetId(), created.id, randomUUID());
  expect(await expectError(service.restore(ctx.editor!.userId, budgetId(), created.id, randomUUID())))
    .toEqual({ status: 403, code: 'FORBIDDEN' });
  expect(
    (await expectError(service.remove(ctx.outsider!.userId, budgetId(), created.id, randomUUID()))).status,
  ).toBe(404);
  expect(
    await expectError(service.remove(ctx.owner!.userId, ctx.outsider!.budgetId, created.id, randomUUID())),
  ).toEqual({ status: 404, code: 'RESOURCE_NOT_FOUND' });
});

it('idempotency: тот же ключ и тело — тот же ответ без второго аудита; другое тело — 409', async () => {
  const created = await newTransfer(a, b, '1.00');
  const key = randomUUID();
  const first = await service.update(ctx.owner!.userId, budgetId(), created.id, { comment: 'k' }, key);
  const second = await service.update(ctx.owner!.userId, budgetId(), created.id, { comment: 'k' }, key);
  expect(second).toEqual(first);
  expect(
    await prisma.auditEvent.count({ where: { entityId: created.id, action: 'UPDATED' } }),
  ).toBe(1);
  expect(
    (await expectError(service.update(ctx.owner!.userId, budgetId(), created.id, { comment: 'z' }, key))).status,
  ).toBe(409);
});
```

Перед тестом ролей проверить фактический `code` у `forbidden()` из `src/common/reference-data/reference-data.errors.ts` и использовать его (ожидается `FORBIDDEN`). Чтобы `outsider` получил 404, а не 403: `PlanModelPolicy.requireModel` отвечает 404 для бюджета без членства — проверить в `src/common/plan-model/plan-model.policy.ts`; при другом коде скорректировать ожидание только статусом 404.

- [ ] **Step 8: Запустить — тесты падают**

Run: `pnpm infra:up` (если Postgres не запущен), затем `pnpm --filter @harmofin/api test:integration -- test/v2-transfer-lifecycle.integration.test.ts`
Expected: FAIL — `service.update is not a function`.

- [ ] **Step 9: Реализовать сервис**

В `apps/api/src/v2-transfers/direct-transfer.application.service.ts`:

Импорты: добавить `balanceDecreases` из `./direct-transfer.domain.js`, `type TransferRow` из `./direct-transfer.repository.js`, `type UpdateDirectTransferInput` из `./direct-transfer.schemas.js`.

Ошибки рядом с существующими:

```ts
function notEditable(): ConflictException {
  return new ConflictException({
    code: 'TRANSFER_NOT_EDITABLE',
    detail: 'Удалённый перевод изменить нельзя.',
  });
}

function alreadyDeleted(): ConflictException {
  return new ConflictException({ code: 'TRANSFER_ALREADY_DELETED', detail: 'Перевод уже удалён.' });
}

function notDeleted(): ConflictException {
  return new ConflictException({
    code: 'TRANSFER_NOT_DELETED',
    detail: 'Восстановить можно только удалённый перевод.',
  });
}

function insufficientForChange(): ConflictException {
  return new ConflictException({
    code: 'INSUFFICIENT_BALANCE',
    detail: 'На счёте недостаточно средств для этого изменения.',
  });
}

function archivedReference(): ConflictException {
  return new ConflictException({
    code: 'INVALID_REFERENCE',
    detail: 'Счёт перевода в архиве. Верните счёт из архива, чтобы восстановить перевод.',
  });
}
```

Тип и маппер:

```ts
export type TransferJournalItem = {
  kind: 'TRANSFER';
  id: string;
  budgetId: string;
  status: 'CONFIRMED' | 'DELETED';
  amountMinor: string;
  currency: string;
  occurredOn: string;
  sourceAccountId: string;
  destinationAccountId: string;
  comment: string | null;
  createdAt: string;
  deletedAt: string | null;
};

export function toTransferJournalItem(row: TransferRow): TransferJournalItem {
  return {
    kind: 'TRANSFER',
    id: row.id,
    budgetId: row.budgetId,
    status: row.status === 'DELETED' ? 'DELETED' : 'CONFIRMED',
    amountMinor: formatMinorUnits(row.totalMinor),
    currency: row.currency,
    occurredOn: row.occurredOn.toISOString().slice(0, 10),
    // ACCOUNT_ONLY rows always carry both accounts (create writes them).
    sourceAccountId: row.sourceAccountId ?? '',
    destinationAccountId: row.destinationAccountId ?? '',
    comment: row.comment,
    createdAt: row.createdAt.toISOString(),
    deletedAt: row.deletedAt?.toISOString() ?? null,
  };
}
```

Методы класса:

```ts
  async update(
    userId: string,
    budgetId: string,
    transferId: string,
    input: UpdateDirectTransferInput,
    idempotencyKey: string,
    requestId?: string,
  ): Promise<TransferJournalItem> {
    const amount =
      input.amount === undefined ? undefined : parseDecimalToMinorUnits(input.amount, RUB_SCALE, false);
    if (amount !== undefined && amount <= 0n) {
      throw validationFailed('Сумма перевода должна быть больше нуля.');
    }
    const occurredOn = input.occurredOn === undefined ? undefined : parseOccurredOn(input.occurredOn);
    return this.mutate('update', userId, budgetId, transferId, input, idempotencyKey, ['OWNER', 'EDITOR'],
      async (tx, current, ctx) => {
        if (current.status !== 'CONFIRMED') throw notEditable();
        const next = {
          sourceAccountId: input.sourceAccountId ?? current.sourceAccountId ?? '',
          destinationAccountId: input.destinationAccountId ?? current.destinationAccountId ?? '',
          totalMinor: amount ?? current.totalMinor,
          occurredOn: occurredOn ?? current.occurredOn,
          comment: input.comment === undefined ? current.comment : input.comment,
        };
        if (next.sourceAccountId === next.destinationAccountId) throw accountsMustDiffer();
        if (occurredOnKey(next.occurredOn) > ctx.today) {
          throw validationFailed('Нельзя подтвердить факт с будущей датой.');
        }
        const moneyChanged =
          next.sourceAccountId !== current.sourceAccountId ||
          next.destinationAccountId !== current.destinationAccountId ||
          next.totalMinor !== current.totalMinor ||
          next.occurredOn.getTime() !== current.occurredOn.getTime();
        if (moneyChanged) {
          await this.requireActiveAccounts(tx, budgetId, [next.sourceAccountId, next.destinationAccountId]);
        }
        await this.lockAndCheck(tx, budgetId, ctx.allowNegativeBalance, current, {
          confirmed: true,
          sourceAccountId: next.sourceAccountId,
          destinationAccountId: next.destinationAccountId,
          amountMinor: next.totalMinor,
        });
        return this.repository.updateTransfer(tx, current, next, {
          workspaceId: ctx.workspaceId,
          actorUserId: userId,
          requestId,
        });
      },
    );
  }

  async remove(
    userId: string,
    budgetId: string,
    transferId: string,
    idempotencyKey: string,
    requestId?: string,
  ): Promise<TransferJournalItem> {
    return this.mutate('delete', userId, budgetId, transferId, {}, idempotencyKey, ['OWNER', 'EDITOR'],
      async (tx, current, ctx) => {
        if (current.status === 'DELETED') throw alreadyDeleted();
        await this.lockAndCheck(tx, budgetId, ctx.allowNegativeBalance, current, {
          ...effectOf(current),
          confirmed: false,
        });
        return this.repository.setLifecycle(tx, current, 'DELETED', {
          workspaceId: ctx.workspaceId,
          actorUserId: userId,
          requestId,
        });
      },
    );
  }

  async restore(
    userId: string,
    budgetId: string,
    transferId: string,
    idempotencyKey: string,
    requestId?: string,
  ): Promise<TransferJournalItem> {
    return this.mutate('restore', userId, budgetId, transferId, {}, idempotencyKey, ['OWNER'],
      async (tx, current, ctx) => {
        if (current.status !== 'DELETED') throw notDeleted();
        const accounts = await Promise.all([
          this.repository.findAccount(tx, budgetId, current.sourceAccountId ?? ''),
          this.repository.findAccount(tx, budgetId, current.destinationAccountId ?? ''),
        ]);
        if (accounts.some((account) => !account || account.archivedAt)) throw archivedReference();
        await this.lockAndCheck(tx, budgetId, ctx.allowNegativeBalance, current, {
          ...effectOf(current),
          confirmed: true,
        });
        return this.repository.setLifecycle(tx, current, 'CONFIRMED', {
          workspaceId: ctx.workspaceId,
          actorUserId: userId,
          requestId,
        });
      },
    );
  }

  private async mutate(
    kind: 'update' | 'delete' | 'restore',
    userId: string,
    budgetId: string,
    transferId: string,
    hashInput: Record<string, unknown>,
    idempotencyKey: string,
    roles: ReadonlyArray<'OWNER' | 'EDITOR'>,
    body: (
      tx: Prisma.TransactionClient,
      current: TransferRow,
      ctx: { workspaceId: string; allowNegativeBalance: boolean; today: string },
    ) => Promise<TransferRow>,
  ): Promise<TransferJournalItem> {
    const model = await this.planModelPolicy.requireModel(userId, budgetId, 2);
    const requestHash = createHash('sha256')
      .update(JSON.stringify({ budgetId, transferId, kind, ...hashInput }))
      .digest('hex');
    const result = await this.prisma.$transaction(async (tx) => {
      await this.repository.lockBudget(tx, budgetId);
      return this.idempotency.execute<TransferJournalItem>(
        tx,
        { budgetId, actorUserId: userId, key: idempotencyKey, operation: `directTransfer.${kind}`, requestHash },
        async () => {
          const membership = await tx.workspaceMembership.findFirst({
            where: { workspaceId: model.workspaceId, userId, isActive: true },
            select: { role: true },
          });
          if (!membership || !(roles as ReadonlyArray<string>).includes(membership.role)) throw forbidden();
          const budget = await this.repository.requireBudget(tx, budgetId);
          const current = await this.repository.findForMutation(tx, budgetId, transferId);
          if (!current) throw resourceNotFound();
          const row = await body(tx, current, {
            workspaceId: model.workspaceId,
            allowNegativeBalance: budget.allowNegativeBalance,
            today: todayInTimezone(new Date(), budget.timezone),
          });
          return { status: 200, body: toTransferJournalItem(row) };
        },
      );
    });
    return result.body;
  }

  private async requireActiveAccounts(
    tx: Prisma.TransactionClient,
    budgetId: string,
    accountIds: string[],
  ): Promise<void> {
    for (const accountId of accountIds) {
      const account = await this.repository.findAccount(tx, budgetId, accountId);
      if (!account) throw resourceNotFound();
      if (account.archivedAt || account.currency !== 'RUB' || account.scale !== RUB_SCALE) {
        throw invalidReference();
      }
    }
  }

  /** Locks every touched account in id order, then rejects a change that drives one below zero. */
  private async lockAndCheck(
    tx: Prisma.TransactionClient,
    budgetId: string,
    allowNegativeBalance: boolean,
    current: TransferRow,
    after: TransferEffect,
  ): Promise<void> {
    const before = effectOf(current);
    await this.repository.lockAccounts(tx, budgetId, [
      before.sourceAccountId,
      before.destinationAccountId,
      after.sourceAccountId,
      after.destinationAccountId,
    ]);
    if (allowNegativeBalance) return;
    for (const [accountId, decrease] of balanceDecreases(before, after)) {
      const balance = await this.balances.accountBalance(tx, budgetId, accountId);
      if (balance - decrease < 0n) throw insufficientForChange();
    }
  }
```

Вспомогательная функция модуля:

```ts
function effectOf(row: TransferRow): TransferEffect {
  return {
    confirmed: row.status === 'CONFIRMED',
    sourceAccountId: row.sourceAccountId ?? '',
    destinationAccountId: row.destinationAccountId ?? '',
    amountMinor: row.totalMinor,
  };
}
```

Добавить импорты `type { Prisma } from '@prisma/client'` и `type TransferEffect` из `./direct-transfer.domain.js`. Блокировка строки перевода (`findForMutation`) идёт после блокировки бюджета и idempotency, а блокировки счетов — после неё, что соответствует порядку из Global Constraints.

Примечание о проверке баланса: условие `balance - decrease < 0n` проверяется по текущему балансу (`accountBalance` без даты), как в `create`.

- [ ] **Step 10: Запустить — тесты проходят**

Run: `pnpm --filter @harmofin/api test:integration -- test/v2-transfer-lifecycle.integration.test.ts test/v2-direct-transfers.integration.test.ts`
Expected: PASS (новые тесты и прежние тесты создания/списка).

- [ ] **Step 11: Typecheck и lint**

Run: `pnpm --filter @harmofin/api typecheck && pnpm --filter @harmofin/api lint`
Expected: без ошибок.

- [ ] **Step 12: Commit** (после ревью и разрешения владельца)

```bash
git add apps/api/src/v2-transfers apps/api/test/v2-transfer-lifecycle.integration.test.ts
git commit -m "feat(api): изменение, удаление и восстановление прямого перевода"
```

---

### Task 2: HTTP-маршруты мутаций перевода и OpenAPI

**Files:**
- Modify: `apps/api/src/v2-transfers/direct-transfer.dto.ts`
- Modify: `apps/api/src/v2-transfers/direct-transfer.controller.ts`
- Modify: `apps/api/test/v2-transfer-lifecycle.integration.test.ts`
- Modify: `apps/api/test/v2-openapi.integration.test.ts:93-99`

**Interfaces:**
- Consumes: `DirectTransferApplicationService.update/remove/restore`, `updateDirectTransferSchema` (Task 1).
- Produces: `PATCH|DELETE /api/v2/budgets/{budgetId}/transfers/{transferId}`, `POST /api/v2/budgets/{budgetId}/transfers/{transferId}/restore`; DTO-класс `TransferJournalItemResponse` (экспорт из `direct-transfer.dto.ts`, используется в Task 3).

- [ ] **Step 1: Падающие HTTP-тесты**

Добавить в `apps/api/test/v2-transfer-lifecycle.integration.test.ts` второй `describe('HTTP-контракт мутаций перевода')`. Логин и заголовки — как в `describe('v2 прямого перевод — HTTP-контракт')` файла `v2-direct-transfers.integration.test.ts` (функции `authCookieHeaders`, `mutationHeaders`, получение `cookie` и `csrfToken` из ответа регистрации — скопировать оттуда, строки 453–647).

```ts
it('PATCH → 200 с kind TRANSFER; без Idempotency-Key → 400; без CSRF → 403', async () => {
  const created = await createViaHttp('3.00');
  const url = `/api/v2/budgets/${owner.budgetId}/transfers/${created.id}`;
  const ok = await server.inject({
    method: 'PATCH', url, headers: mutationHeaders(owner, randomUUID()), payload: { comment: 'HTTP' },
  });
  expect(ok.statusCode).toBe(200);
  expect(ok.json()).toMatchObject({ kind: 'TRANSFER', id: created.id, comment: 'HTTP' });

  const noKey = await server.inject({
    method: 'PATCH', url,
    headers: { ...authCookieHeaders(owner), 'x-csrf-token': owner.csrfToken },
    payload: { comment: 'x' },
  });
  expect(noKey.statusCode).toBe(400);

  const noCsrf = await server.inject({
    method: 'PATCH', url,
    headers: { ...authCookieHeaders(owner), 'idempotency-key': randomUUID() },
    payload: { comment: 'x' },
  });
  expect(noCsrf.statusCode).toBe(403);
});

it('PATCH с пустым телом или лишним полем → 400; transferId не uuid → 400', async () => {
  const created = await createViaHttp('1.00');
  const url = `/api/v2/budgets/${owner.budgetId}/transfers/${created.id}`;
  for (const payload of [{}, { status: 'DELETED' }]) {
    const response = await server.inject({ method: 'PATCH', url, headers: mutationHeaders(owner, randomUUID()), payload });
    expect(response.statusCode).toBe(400);
  }
  const bad = await server.inject({
    method: 'PATCH', url: `/api/v2/budgets/${owner.budgetId}/transfers/not-a-uuid`,
    headers: mutationHeaders(owner, randomUUID()), payload: { comment: 'x' },
  });
  expect(bad.statusCode).toBe(400);
});

it('DELETE → 200 DELETED; POST restore → 200 CONFIRMED', async () => {
  const created = await createViaHttp('1.00');
  const url = `/api/v2/budgets/${owner.budgetId}/transfers/${created.id}`;
  const removed = await server.inject({ method: 'DELETE', url, headers: mutationHeaders(owner, randomUUID()) });
  expect(removed.statusCode).toBe(200);
  expect(removed.json()).toMatchObject({ status: 'DELETED' });
  const restored = await server.inject({
    method: 'POST', url: `${url}/restore`, headers: mutationHeaders(owner, randomUUID()), payload: {},
  });
  expect(restored.statusCode).toBe(200);
  expect(restored.json()).toMatchObject({ status: 'CONFIRMED', deletedAt: null });
});
```

`createViaHttp(amount)` — `POST /api/v2/budgets/{owner.budgetId}/transfers` с `mutationHeaders(owner, randomUUID())` и телом `{ sourceAccountId, destinationAccountId, amount, occurredOn: today }`, возвращает `response.json()`.

В `apps/api/test/v2-openapi.integration.test.ts` после строки `['get', '/api/v2/budgets/{budgetId}/transfers/{transferId}'],` добавить:

```ts
  ['patch', '/api/v2/budgets/{budgetId}/transfers/{transferId}'],
  ['delete', '/api/v2/budgets/{budgetId}/transfers/{transferId}'],
  ['post', '/api/v2/budgets/{budgetId}/transfers/{transferId}/restore'],
```

- [ ] **Step 2: Запустить — тесты падают**

Run: `pnpm --filter @harmofin/api test:integration -- test/v2-transfer-lifecycle.integration.test.ts test/v2-openapi.integration.test.ts`
Expected: FAIL — 404 на `PATCH`, OpenAPI не содержит новых путей.

- [ ] **Step 3: DTO**

В `apps/api/src/v2-transfers/direct-transfer.dto.ts` добавить:

```ts
export class UpdateDirectTransferInput {
  @ApiProperty({ type: String, required: false, example: '0195f3c3-aaaa-bbbb-cccc-000000000003' })
  sourceAccountId?: string;

  @ApiProperty({ type: String, required: false, example: '0195f3c3-aaaa-bbbb-cccc-000000000004' })
  destinationAccountId?: string;

  @ApiProperty({ type: String, required: false, example: '1500.00' })
  amount?: string;

  @ApiProperty({ type: String, required: false, example: '2026-10-20' })
  occurredOn?: string;

  @ApiProperty({ type: String, required: false, nullable: true, maxLength: 500, example: 'Отпуск' })
  comment?: string | null;
}

export class TransferJournalItemResponse {
  @ApiProperty({ type: String, enum: ['TRANSFER'], example: 'TRANSFER' })
  kind!: 'TRANSFER';

  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  budgetId!: string;

  @ApiProperty({ type: String, enum: ['CONFIRMED', 'DELETED'] })
  status!: 'CONFIRMED' | 'DELETED';

  @ApiProperty({ type: String, example: '150000' })
  amountMinor!: string;

  @ApiProperty({ type: String, example: 'RUB' })
  currency!: string;

  @ApiProperty({ type: String, example: '2026-10-20' })
  occurredOn!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  sourceAccountId!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  destinationAccountId!: string;

  @ApiProperty({ type: String, nullable: true })
  comment!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  deletedAt!: string | null;
}
```

- [ ] **Step 4: Маршруты контроллера**

В `apps/api/src/v2-transfers/direct-transfer.controller.ts`: добавить в импорт `@nestjs/common` `Delete`, `HttpCode`, `Patch`; импортировать `updateDirectTransferSchema`, `type UpdateDirectTransferInput` из схем и `TransferJournalItemResponse`, `UpdateDirectTransferInput as UpdateDirectTransferInputDto` из DTO; добавить в класс:

```ts
  @Patch(':transferId')
  @UseGuards(CsrfGuard)
  @ApiHeader(idempotencyHeader)
  @ApiBody({ type: UpdateDirectTransferInputDto })
  @ApiOkResponse({ type: TransferJournalItemResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({
    status: 409,
    type: ProblemDetailsResponse,
    description: 'TRANSFER_NOT_EDITABLE, INSUFFICIENT_BALANCE или конфликт ключа идемпотентности.',
  })
  @ApiResponse({ status: 422, type: ProblemDetailsResponse })
  update(
    @Param('budgetId') budgetId: string,
    @Param('transferId', new ZodValidationPipe(transferIdParamSchema)) transferId: string,
    @Body(new ZodValidationPipe(updateDirectTransferSchema)) input: UpdateDirectTransferInput,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.update(contextOf(request).userId, budgetId, transferId, input, validKey(key), request.id);
  }

  @Delete(':transferId')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @ApiHeader(idempotencyHeader)
  @ApiOkResponse({ type: TransferJournalItemResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({
    status: 409,
    type: ProblemDetailsResponse,
    description: 'TRANSFER_ALREADY_DELETED, INSUFFICIENT_BALANCE или конфликт ключа идемпотентности.',
  })
  remove(
    @Param('budgetId') budgetId: string,
    @Param('transferId', new ZodValidationPipe(transferIdParamSchema)) transferId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.remove(contextOf(request).userId, budgetId, transferId, validKey(key), request.id);
  }

  @Post(':transferId/restore')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @ApiHeader(idempotencyHeader)
  @ApiOkResponse({ type: TransferJournalItemResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({
    status: 409,
    type: ProblemDetailsResponse,
    description: 'TRANSFER_NOT_DELETED, INVALID_REFERENCE, INSUFFICIENT_BALANCE или конфликт ключа идемпотентности.',
  })
  restore(
    @Param('budgetId') budgetId: string,
    @Param('transferId', new ZodValidationPipe(transferIdParamSchema)) transferId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.restore(contextOf(request).userId, budgetId, transferId, validKey(key), request.id);
  }
```

Порядок маршрутов не важен: `POST /` и `POST /:transferId/restore` не пересекаются.

- [ ] **Step 5: Запустить — тесты проходят**

Run: `pnpm --filter @harmofin/api test:integration -- test/v2-transfer-lifecycle.integration.test.ts test/v2-openapi.integration.test.ts`
Expected: PASS. Если OpenAPI-тест проверяет обязательный `Idempotency-Key` или набор кодов по списку мутаций — добавить новые пути и туда.

- [ ] **Step 6: Typecheck и lint**

Run: `pnpm --filter @harmofin/api typecheck && pnpm --filter @harmofin/api lint`

- [ ] **Step 7: Commit** (после ревью и разрешения владельца)

```bash
git add apps/api/src/v2-transfers apps/api/test/v2-transfer-lifecycle.integration.test.ts apps/api/test/v2-openapi.integration.test.ts
git commit -m "feat(api): маршруты PATCH, DELETE и restore для прямого перевода"
```

---

### Task 3: Эндпоинт общей ленты журнала

**Files:**
- Create: `apps/api/src/v2-journal/journal.schemas.ts`
- Create: `apps/api/src/v2-journal/journal.cursor.ts`, `journal.cursor.test.ts`
- Create: `apps/api/src/v2-journal/journal.merge.ts`, `journal.merge.test.ts`
- Create: `apps/api/src/v2-journal/journal.repository.ts`
- Create: `apps/api/src/v2-journal/journal.application.service.ts`
- Create: `apps/api/src/v2-journal/journal.dto.ts`
- Create: `apps/api/src/v2-journal/journal.controller.ts`
- Create: `apps/api/src/v2-journal/journal.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/v2-transactions/transaction-v2.application.service.ts:1025` (export `toJournalItem`)
- Test: `apps/api/test/v2-journal.integration.test.ts`
- Modify: `apps/api/test/v2-openapi.integration.test.ts`

**Interfaces:**
- Consumes: `toTransferJournalItem`, `transferRowSelect`, `TransferJournalItem` (Task 1); `TransferJournalItemResponse` (Task 2); `TransactionRepository.findAccessibleWithRole`, `validateJournalReferences`, `findPlanOccurrenceLinks`; `toJournalItem` из `transaction-v2.application.service.ts`.
- Produces: `GET /api/v2/budgets/{budgetId}/journal` → `{ items: JournalItem[]; nextCursor: string | null }`, где `JournalItem = ({ kind: 'TRANSACTION' } & TransactionJournalV2Item) | TransferJournalItem`.

- [ ] **Step 1: Unit-тесты курсора и слияния**

`apps/api/src/v2-journal/journal.cursor.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { decodeFeedCursor, encodeFeedCursor } from './journal.cursor.js';

const position = {
  occurredOn: '2026-10-20',
  createdAt: '2026-10-20T10:00:00.000Z',
  id: '0195f3c3-aaaa-7bbb-8ccc-000000000001',
};

describe('journal cursor', () => {
  it('кодирует и декодирует позицию', () => {
    expect(decodeFeedCursor(encodeFeedCursor(position))).toEqual(position);
  });

  it.each(['garbage', Buffer.from('{"v":2}').toString('base64url'),
    encodeFeedCursor({ ...position, id: 'not-uuid' }),
    encodeFeedCursor({ ...position, occurredOn: '20-10-2026' })])(
    'некорректный курсор %s — 400 VALIDATION_FAILED',
    (value) => {
      expect(() => decodeFeedCursor(value)).toThrowError(
        expect.objectContaining({ response: expect.objectContaining({ code: 'VALIDATION_FAILED' }) }),
      );
    },
  );
});
```

`apps/api/src/v2-journal/journal.merge.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { comparePositions, mergeNewestFirst, type FeedPosition } from './journal.merge.js';

const p = (occurredOn: string, createdAt: string, id: string): FeedPosition => ({
  occurredOn, createdAt, id,
});

describe('journal merge', () => {
  it('новые раньше: дата, затем время создания, затем id', () => {
    expect(comparePositions(p('2026-10-20', 'a', '1'), p('2026-10-19', 'z', '9'))).toBeLessThan(0);
    expect(comparePositions(p('2026-10-20', '2026-10-20T10:00:00.000Z', '1'),
      p('2026-10-20', '2026-10-20T09:00:00.000Z', '9'))).toBeLessThan(0);
    expect(comparePositions(p('2026-10-20', 't', 'b'), p('2026-10-20', 't', 'a'))).toBeLessThan(0);
  });

  it('сливает два отсортированных списка и обрезает до limit', () => {
    const left = [p('2026-10-20', 't', 'c'), p('2026-10-18', 't', 'a')];
    const right = [p('2026-10-19', 't', 'b'), p('2026-10-17', 't', 'd')];
    expect(mergeNewestFirst(left, right, (x) => x, 3).map((x) => x.id)).toEqual(['c', 'b', 'a']);
  });
});
```

- [ ] **Step 2: Запустить — падают**

Run: `pnpm --filter @harmofin/api test -- src/v2-journal`
Expected: FAIL — модули не найдены.

- [ ] **Step 3: Реализовать курсор и слияние**

`apps/api/src/v2-journal/journal.merge.ts`:

```ts
/** Feed order key shared by transactions and transfers: newest first. */
export type FeedPosition = { occurredOn: string; createdAt: string; id: string };

/** Negative when `a` comes before `b` in the feed (occurredOn, createdAt, id — all desc). */
export function comparePositions(a: FeedPosition, b: FeedPosition): number {
  if (a.occurredOn !== b.occurredOn) return a.occurredOn > b.occurredOn ? -1 : 1;
  if (a.createdAt !== b.createdAt) return a.createdAt > b.createdAt ? -1 : 1;
  if (a.id !== b.id) return a.id > b.id ? -1 : 1;
  return 0;
}

export function mergeNewestFirst<T>(
  left: ReadonlyArray<T>,
  right: ReadonlyArray<T>,
  positionOf: (item: T) => FeedPosition,
  limit: number,
): T[] {
  const result: T[] = [];
  let i = 0;
  let j = 0;
  while (result.length < limit && (i < left.length || j < right.length)) {
    const takeLeft =
      j >= right.length ||
      (i < left.length && comparePositions(positionOf(left[i]!), positionOf(right[j]!)) <= 0);
    result.push(takeLeft ? left[i++]! : right[j++]!);
  }
  return result;
}
```

`createdAt` сравнивается строками ISO с миллисекундами (`toISOString()`), `id` — строками в нижнем регистре; оба порядка совпадают с порядком PostgreSQL для `timestamptz(3)` и `uuid`.

`apps/api/src/v2-journal/journal.cursor.ts`:

```ts
import { BadRequestException } from '@nestjs/common';

import type { FeedPosition } from './journal.merge.js';

type Encoded = FeedPosition & { v: 1 };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeFeedCursor(position: FeedPosition): string {
  const value: Encoded = { v: 1, ...position };
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function decodeFeedCursor(value: string): FeedPosition {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<Encoded>;
    if (
      parsed.v !== 1 ||
      typeof parsed.occurredOn !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(parsed.occurredOn) ||
      typeof parsed.createdAt !== 'string' ||
      Number.isNaN(new Date(parsed.createdAt).getTime()) ||
      typeof parsed.id !== 'string' ||
      !UUID.test(parsed.id)
    ) {
      throw new Error('invalid');
    }
    return { occurredOn: parsed.occurredOn, createdAt: parsed.createdAt, id: parsed.id.toLowerCase() };
  } catch {
    throw new BadRequestException({ code: 'VALIDATION_FAILED', detail: 'Некорректный курсор журнала.' });
  }
}
```

- [ ] **Step 4: Запустить — unit-тесты проходят**

Run: `pnpm --filter @harmofin/api test -- src/v2-journal`
Expected: PASS.

- [ ] **Step 5: Падающие интеграционные тесты ленты**

`apps/api/test/v2-journal.integration.test.ts`. Каркас и хелперы (`register`, `createRawAccount`, `createEnvelope`, `cleanupUser`, логин с cookie/CSRF) — скопировать из `v2-direct-transfers.integration.test.ts`; пользователи `owner`, `editor` (EDITOR), `outsider`. В `beforeAll`: бюджеты в модель 2, timezone `UTC`; счета `a` (1 000 000), `b` (0); категория расхода `food` и доходная `salary` (создать через `prisma.category.create` с `budgetId`, `name`, `categoryType: 'EXPENSE'|'INCOME'`, — поля сверить с `model Category` в `prisma/schema.prisma`); конверт `env`.

Данные создавать напрямую через Prisma, чтобы контролировать `occurredOn` и `createdAt`:

```ts
async function tx(type: 'INCOME' | 'EXPENSE', on: string, createdAt: string, extra: Partial<{
  accountId: string; categoryId: string; envelopeId: string | null; status: 'CONFIRMED' | 'DRAFT' | 'DELETED';
}> = {}) {
  return prisma.transaction.create({
    data: {
      id: randomUUID(), budgetId: owner.budgetId, accountingModelVersion: 2,
      transactionType: type, status: extra.status ?? 'CONFIRMED', amountMinor: 100n,
      currency: 'RUB', scale: 2, occurredOn: new Date(`${on}T00:00:00Z`),
      accountId: extra.accountId ?? a, categoryId: extra.categoryId ?? (type === 'INCOME' ? salary : food),
      envelopeId: extra.envelopeId ?? null, createdAt: new Date(createdAt),
      createdByUserId: owner.userId, updatedByUserId: owner.userId,
      ...(extra.status === 'DELETED' ? { deletedAt: new Date() } : {}),
    },
  });
}

async function transfer(on: string, createdAt: string, extra: Partial<{
  source: string; destination: string; status: 'CONFIRMED' | 'DELETED';
}> = {}) {
  return prisma.transfer.create({
    data: {
      id: randomUUID(), budgetId: owner.budgetId, mode: 'ACCOUNT_ONLY', status: extra.status ?? 'CONFIRMED',
      totalMinor: 100n, occurredOn: new Date(`${on}T00:00:00Z`),
      sourceAccountId: extra.source ?? a, destinationAccountId: extra.destination ?? b,
      createdAt: new Date(createdAt), createdByUserId: owner.userId, updatedByUserId: owner.userId,
      ...(extra.status === 'DELETED' ? { deletedAt: new Date() } : {}),
    },
  });
}

async function page(user: Session, query: Record<string, string>) {
  const search = new URLSearchParams(query).toString();
  const response = await server.inject({
    method: 'GET',
    url: `/api/v2/budgets/${owner.budgetId}/journal${search ? `?${search}` : ''}`,
    headers: authCookieHeaders(user),
  });
  return response;
}

async function all(user: Session, query: Record<string, string>) {
  const ids: string[] = [];
  let cursor: string | null = null;
  do {
    const response = await page(user, { ...query, limit: '2', ...(cursor ? { cursor } : {}) });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ items: Array<{ id: string; kind: string }>; nextCursor: string | null }>();
    ids.push(...body.items.map((item) => item.id));
    cursor = body.nextCursor;
  } while (cursor);
  return ids;
}
```

Поля `transaction.create` сверить с `model Transaction` в `prisma/schema.prisma` (обязательные поля могут отличаться; недостающие обязательные — заполнить так же, как в `v2-transaction-journal.integration.test.ts`).

Тесты (каждый очищает `transaction` и `transfer` бюджета владельца в начале):

```ts
it('общий порядок и пагинация без потерь и дублей, включая одинаковые дату и время создания', async () => {
  const t1 = await tx('EXPENSE', '2026-10-10', '2026-10-10T10:00:00.000Z');
  const r1 = await transfer('2026-10-10', '2026-10-10T10:00:00.000Z');
  const t2 = await tx('INCOME', '2026-10-11', '2026-10-11T08:00:00.000Z');
  const r2 = await transfer('2026-10-09', '2026-10-12T08:00:00.000Z');
  const r3 = await transfer('2026-10-11', '2026-10-11T09:00:00.000Z');
  const sameTime = [t1.id, r1.id].sort().reverse();
  expect(await all(owner, {})).toEqual([r3.id, t2.id, ...sameTime, r2.id]);
});

it('элементы имеют kind и форму по спецификации', async () => {
  const r = await transfer('2026-10-10', '2026-10-10T10:00:00.000Z');
  await tx('EXPENSE', '2026-10-09', '2026-10-09T10:00:00.000Z');
  const body = (await page(owner, {})).json<{ items: Array<Record<string, unknown>> }>();
  expect(body.items[0]).toEqual({
    kind: 'TRANSFER', id: r.id, budgetId: owner.budgetId, status: 'CONFIRMED', amountMinor: '100',
    currency: 'RUB', occurredOn: '2026-10-10', sourceAccountId: a, destinationAccountId: b, comment: null,
    createdAt: '2026-10-10T10:00:00.000Z', deletedAt: null,
  });
  expect(body.items[1]).toMatchObject({ kind: 'TRANSACTION', transactionType: 'EXPENSE', planOccurrenceIds: [] });
});

it('type: TRANSFER — только переводы; INCOME/EXPENSE — без переводов', async () => {
  const r = await transfer('2026-10-10', '2026-10-10T10:00:00.000Z');
  const e = await tx('EXPENSE', '2026-10-10', '2026-10-10T11:00:00.000Z');
  expect(await all(owner, { type: 'TRANSFER' })).toEqual([r.id]);
  expect(await all(owner, { type: 'EXPENSE' })).toEqual([e.id]);
});

it('accountId находит перевод по источнику и по назначению', async () => {
  const c = await createRawAccount(owner.budgetId, 'RUB', 0n);
  const out = await transfer('2026-10-10', '2026-10-10T10:00:00.000Z', { source: c, destination: b });
  const inn = await transfer('2026-10-09', '2026-10-09T10:00:00.000Z', { source: a, destination: c });
  await transfer('2026-10-08', '2026-10-08T10:00:00.000Z');
  expect(await all(owner, { accountId: c })).toEqual([out.id, inn.id]);
});

it('categoryId и envelopeId исключают переводы', async () => {
  await transfer('2026-10-10', '2026-10-10T10:00:00.000Z');
  const e = await tx('EXPENSE', '2026-10-10', '2026-10-10T11:00:00.000Z', { envelopeId: env });
  expect(await all(owner, { categoryId: food })).toEqual([e.id]);
  expect(await all(owner, { envelopeId: env })).toEqual([e.id]);
});

it('статусы: по умолчанию без удалённых; DRAFT исключает переводы; DELETED — только владелец', async () => {
  const live = await transfer('2026-10-10', '2026-10-10T10:00:00.000Z');
  const gone = await transfer('2026-10-09', '2026-10-09T10:00:00.000Z', { status: 'DELETED' });
  const draft = await tx('EXPENSE', '2026-10-08', '2026-10-08T10:00:00.000Z', { status: 'DRAFT' });
  expect(await all(owner, {})).toEqual([live.id, draft.id]);
  expect(await all(owner, { status: 'DRAFT' })).toEqual([draft.id]);
  expect(await all(owner, { status: 'DELETED' })).toEqual([gone.id]);
  expect((await page(editor, { status: 'DELETED' })).statusCode).toBe(403);
});

it('from/to по дате операции', async () => {
  await transfer('2026-10-01', '2026-10-01T10:00:00.000Z');
  const mid = await transfer('2026-10-05', '2026-10-05T10:00:00.000Z');
  await tx('EXPENSE', '2026-10-09', '2026-10-09T10:00:00.000Z');
  expect(await all(owner, { from: '2026-10-02', to: '2026-10-08' })).toEqual([mid.id]);
});

it('изоляция: чужой бюджет — 404, чужие ссылки в фильтре — 404, чужие строки не попадают', async () => {
  const foreignAccount = await createRawAccount(outsider.budgetId, 'RUB', 0n);
  expect((await page(outsider, {})).statusCode).toBe(404);
  expect((await page(owner, { accountId: foreignAccount })).statusCode).toBe(404);
  await prisma.transfer.create({ data: {
    id: randomUUID(), budgetId: outsider.budgetId, mode: 'ACCOUNT_ONLY', status: 'CONFIRMED', totalMinor: 1n,
    occurredOn: new Date('2026-10-10T00:00:00Z'), sourceAccountId: foreignAccount,
    destinationAccountId: await createRawAccount(outsider.budgetId, 'RUB', 0n),
    createdByUserId: outsider.userId, updatedByUserId: outsider.userId,
  } });
  expect(await all(owner, {})).toEqual([]);
});

it('некорректный курсор — 400; лишний параметр — 400', async () => {
  expect((await page(owner, { cursor: 'garbage' })).statusCode).toBe(400);
  expect((await page(owner, { sortBy: 'amount' })).statusCode).toBe(400);
});
```

В OpenAPI-тест добавить `['get', '/api/v2/budgets/{budgetId}/journal'],` в список ожидаемых v2-путей.

- [ ] **Step 6: Запустить — падают**

Run: `pnpm --filter @harmofin/api test:integration -- test/v2-journal.integration.test.ts`
Expected: FAIL — 404 на `/journal`.

- [ ] **Step 7: Схема запроса**

`apps/api/src/v2-journal/journal.schemas.ts`:

```ts
import { z } from 'zod';

const uuid = z.string().uuid();

/** Feed filters; the order is fixed: occurredOn desc, createdAt desc, id desc. */
export const listJournalSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.string().min(1).max(512).optional(),
    type: z.enum(['INCOME', 'EXPENSE', 'TRANSFER']).optional(),
    status: z.enum(['DRAFT', 'CONFIRMED', 'CANCELLED', 'DELETED']).optional(),
    from: z.string().date().optional(),
    to: z.string().date().optional(),
    accountId: uuid.optional(),
    categoryId: uuid.optional(),
    envelopeId: uuid.optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.from && input.to && input.from > input.to) {
      context.addIssue({ code: 'custom', path: ['to'], message: 'Дата окончания не может быть раньше даты начала.' });
    }
  });

export type ListJournalInput = z.output<typeof listJournalSchema>;
```

- [ ] **Step 8: Repository ленты**

Экспортировать `toJournalItem` в `apps/api/src/v2-transactions/transaction-v2.application.service.ts` (заменить `function toJournalItem(` на `export function toJournalItem(`). Его параметр `TransactionRecord` содержит `accountCurrentBalanceMinor`, который маппер не читает — сузить тип параметра:

```ts
export function toJournalItem(
  row: Omit<TransactionRecord, 'accountCurrentBalanceMinor'>,
  planOccurrenceIds: string[],
): TransactionJournalV2Item {
```

`apps/api/src/v2-journal/journal.repository.ts`:

```ts
import type { Prisma, PrismaClient } from '@prisma/client';

import { transferRowSelect, type TransferRow } from '../v2-transfers/direct-transfer.repository.js';
import type { FeedPosition } from './journal.merge.js';

export type FeedFilter = {
  limit: number;
  cursor: FeedPosition | null;
  type?: 'INCOME' | 'EXPENSE' | 'TRANSFER' | undefined;
  status?: 'DRAFT' | 'CONFIRMED' | 'CANCELLED' | 'DELETED' | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  accountId?: string | undefined;
  categoryId?: string | undefined;
  envelopeId?: string | undefined;
};

// Same fields the transaction journal maps (transactionSelect in transaction.repository.ts).
const transactionFeedSelect = {
  id: true, budgetId: true, transactionType: true, status: true, amountMinor: true, currency: true,
  scale: true, occurredOn: true, accountId: true, categoryId: true, envelopeId: true,
  sourceDescription: true, merchantName: true, isPlanned: true, comment: true, confirmedAt: true,
  cancelledAt: true, deletedAt: true, preDeleteStatus: true, createdAt: true, accountingModelVersion: true,
} as const;

export type TransactionFeedRow = Prisma.TransactionGetPayload<{ select: typeof transactionFeedSelect }>;

function dateRange(filter: FeedFilter) {
  return filter.from || filter.to
    ? { occurredOn: { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lte: filter.to } : {}) } }
    : {};
}

/** Strictly after the cursor in feed order (all three keys descending). */
function after(cursor: FeedPosition | null) {
  if (!cursor) return {};
  const occurredOn = new Date(`${cursor.occurredOn}T00:00:00.000Z`);
  const createdAt = new Date(cursor.createdAt);
  return {
    OR: [
      { occurredOn: { lt: occurredOn } },
      { occurredOn, createdAt: { lt: createdAt } },
      { occurredOn, createdAt, id: { lt: cursor.id } },
    ],
  };
}

const order = [{ occurredOn: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }] as const;

export class JournalRepository {
  constructor(private readonly prisma: PrismaClient) {}

  includesTransactions(filter: FeedFilter): boolean {
    return filter.type !== 'TRANSFER';
  }

  /** Transfers have no category or envelope and are only CONFIRMED or DELETED. */
  includesTransfers(filter: FeedFilter): boolean {
    if (filter.type === 'INCOME' || filter.type === 'EXPENSE') return false;
    if (filter.categoryId || filter.envelopeId) return false;
    return filter.status === undefined || filter.status === 'CONFIRMED' || filter.status === 'DELETED';
  }

  async transactions(budgetId: string, filter: FeedFilter): Promise<TransactionFeedRow[]> {
    if (!this.includesTransactions(filter)) return [];
    return this.prisma.transaction.findMany({
      where: {
        budgetId,
        ...(filter.type ? { transactionType: filter.type as 'INCOME' | 'EXPENSE' } : {}),
        ...(filter.accountId ? { accountId: filter.accountId } : {}),
        ...(filter.categoryId ? { categoryId: filter.categoryId } : {}),
        ...(filter.envelopeId ? { envelopeId: filter.envelopeId } : {}),
        AND: [
          filter.status ? { status: filter.status } : { status: { not: 'DELETED' } },
          dateRange(filter),
          after(filter.cursor),
        ],
      },
      select: transactionFeedSelect,
      orderBy: [...order],
      take: filter.limit + 1,
    });
  }

  async transfers(budgetId: string, filter: FeedFilter): Promise<TransferRow[]> {
    if (!this.includesTransfers(filter)) return [];
    return this.prisma.transfer.findMany({
      where: {
        budgetId,
        mode: 'ACCOUNT_ONLY',
        AND: [
          filter.status
            ? { status: filter.status as 'CONFIRMED' | 'DELETED' }
            : { status: { in: ['CONFIRMED'] } },
          filter.accountId
            ? { OR: [{ sourceAccountId: filter.accountId }, { destinationAccountId: filter.accountId }] }
            : {},
          dateRange(filter),
          after(filter.cursor),
        ],
      },
      select: transferRowSelect,
      orderBy: [...order],
      take: filter.limit + 1,
    });
  }
}
```

Без явного статуса переводы ограничены `CONFIRMED` (у прямых переводов нет `DRAFT`/`CANCELLED`, `DELETED` скрыт по умолчанию).

- [ ] **Step 9: Application service**

`apps/api/src/v2-journal/journal.application.service.ts`:

```ts
import { Injectable } from '@nestjs/common';

import { forbidden, resourceNotFound } from '../common/reference-data/reference-data.errors.js';
import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import { TransactionRepository } from '../transactions/transaction.repository.js';
import {
  toJournalItem,
  type TransactionJournalV2Item,
} from '../v2-transactions/transaction-v2.application.service.js';
import {
  toTransferJournalItem,
  type TransferJournalItem,
} from '../v2-transfers/direct-transfer.application.service.js';
import { decodeFeedCursor, encodeFeedCursor } from './journal.cursor.js';
import { mergeNewestFirst, type FeedPosition } from './journal.merge.js';
import { JournalRepository } from './journal.repository.js';
import type { ListJournalInput } from './journal.schemas.js';

export type JournalItem = ({ kind: 'TRANSACTION' } & TransactionJournalV2Item) | TransferJournalItem;
export type JournalPage = { items: JournalItem[]; nextCursor: string | null };

const positionOf = (item: JournalItem): FeedPosition => ({
  occurredOn: item.occurredOn,
  createdAt: item.createdAt,
  id: item.id.toLowerCase(),
});

/** Read-only feed of v2 transactions and direct transfers in one order. */
@Injectable()
export class JournalApplicationService {
  constructor(
    private readonly transactions: TransactionRepository,
    private readonly feed: JournalRepository,
    private readonly planModelPolicy: PlanModelPolicy,
  ) {}

  async list(userId: string, budgetId: string, input: ListJournalInput): Promise<JournalPage> {
    await this.planModelPolicy.requireModel(userId, budgetId, 2);
    const budget = await this.transactions.findAccessibleWithRole(userId, budgetId);
    if (!budget) throw resourceNotFound();
    if (input.status === 'DELETED' && budget.workspace.memberships[0]?.role !== 'OWNER') {
      throw forbidden();
    }
    const referencesExist = await this.transactions.validateJournalReferences(budgetId, input);
    if (!referencesExist) throw resourceNotFound();

    const filter = {
      limit: input.limit,
      cursor: input.cursor ? decodeFeedCursor(input.cursor) : null,
      type: input.type,
      status: input.status,
      from: input.from ? new Date(`${input.from}T00:00:00.000Z`) : undefined,
      to: input.to ? new Date(`${input.to}T00:00:00.000Z`) : undefined,
      accountId: input.accountId,
      categoryId: input.categoryId,
      envelopeId: input.envelopeId,
    };
    const [transactionRows, transferRows] = await Promise.all([
      this.feed.transactions(budgetId, filter),
      this.feed.transfers(budgetId, filter),
    ]);
    const links = await this.transactions.findPlanOccurrenceLinks(
      budgetId,
      transactionRows.map((row) => row.id),
    );
    const left: JournalItem[] = transactionRows.map((row) => ({
      kind: 'TRANSACTION' as const,
      ...toJournalItem(row, links.get(row.id) ?? []),
    }));
    const right: JournalItem[] = transferRows.map(toTransferJournalItem);
    const merged = mergeNewestFirst(left, right, positionOf, input.limit + 1);
    const hasNext = merged.length > input.limit;
    const items = merged.slice(0, input.limit);
    const last = items.at(-1);
    return { items, nextCursor: hasNext && last ? encodeFeedCursor(positionOf(last)) : null };
  }
}
```

Если `TransactionJournalV2Item` не экспортирован из `transaction-v2.application.service.ts` как тип — он экспортирован (`export type TransactionJournalV2Item`, строка 48). Если `findPlanOccurrenceLinks` выполняется для пустого списка, он уже возвращает пустую карту.

- [ ] **Step 10: DTO, controller, module, регистрация**

`apps/api/src/v2-journal/journal.dto.ts`:

```ts
import { ApiExtraModels, ApiProperty, getSchemaPath } from '@nestjs/swagger';

import { TransferJournalItemResponse } from '../v2-transfers/direct-transfer.dto.js';
import { TransactionJournalV2ItemResponse } from '../v2-transactions/transaction-v2.dto.js';

export class TransactionFeedItemResponse extends TransactionJournalV2ItemResponse {
  @ApiProperty({ type: String, enum: ['TRANSACTION'], example: 'TRANSACTION' })
  kind!: 'TRANSACTION';
}

@ApiExtraModels(TransactionFeedItemResponse, TransferJournalItemResponse)
export class JournalPageResponse {
  @ApiProperty({
    type: 'array',
    items: {
      oneOf: [
        { $ref: getSchemaPath(TransactionFeedItemResponse) },
        { $ref: getSchemaPath(TransferJournalItemResponse) },
      ],
      discriminator: { propertyName: 'kind' },
    },
  })
  items!: Array<TransactionFeedItemResponse | TransferJournalItemResponse>;

  @ApiProperty({ type: String, nullable: true, example: null })
  nextCursor!: string | null;
}
```

Имя DTO-класса элемента журнала операций сверить в `apps/api/src/v2-transactions/transaction-v2.dto.ts` (класс, указанный в `@ApiOkResponse` у `GET /transactions/:transactionId`); использовать его.

`apps/api/src/v2-journal/journal.controller.ts`:

```ts
import { Controller, Get, Inject, Param, Query, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { ApiCookieAuth, ApiOkResponse, ApiResponse, ApiTags } from '@nestjs/swagger';

import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { ProblemDetailsResponse } from '../common/errors/problem-details.dto.js';
import type { RequestContext } from '../common/request-context/request-context.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { budgetIdParamSchema } from '../v2-transactions/transaction-v2.schemas.js';
import { JournalApplicationService } from './journal.application.service.js';
import { JournalPageResponse } from './journal.dto.js';
import { listJournalSchema, type ListJournalInput } from './journal.schemas.js';

type AuthenticatedRequest = FastifyRequest & { authContext?: RequestContext };

function contextOf(request: AuthenticatedRequest): RequestContext {
  if (!request.authContext) throw new Error('Missing authenticated request context.');
  return request.authContext;
}

@ApiTags('journal (v2)')
@Controller({ path: 'budgets/:budgetId/journal', version: '2' })
@UseGuards(SessionAuthGuard)
@ApiCookieAuth('session')
export class JournalController {
  constructor(@Inject(JournalApplicationService) private readonly service: JournalApplicationService) {}

  @Get()
  @ApiOkResponse({ type: JournalPageResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  list(
    @Param('budgetId', new ZodValidationPipe(budgetIdParamSchema)) budgetId: string,
    @Query(new ZodValidationPipe(listJournalSchema)) query: ListJournalInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.list(contextOf(request).userId, budgetId, query);
  }
}
```

`apps/api/src/v2-journal/journal.module.ts` — по образцу `direct-transfer.module.ts`; конструктор `TransactionRepository` сверить в `src/v2-transactions/transaction-v2.module.ts` и создать так же:

```ts
import { DynamicModule, Module } from '@nestjs/common';

import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import { PrismaService } from '../database/prisma.service.js';
import { TransactionRepository } from '../transactions/transaction.repository.js';
import { JournalApplicationService } from './journal.application.service.js';
import { JournalController } from './journal.controller.js';
import { JournalRepository } from './journal.repository.js';

@Module({})
export class JournalModule {
  static register(): DynamicModule {
    return {
      module: JournalModule,
      controllers: [JournalController],
      providers: [
        {
          provide: JournalApplicationService,
          useFactory: (prisma: PrismaService) =>
            new JournalApplicationService(
              new TransactionRepository(prisma),
              new JournalRepository(prisma),
              new PlanModelPolicy(prisma),
            ),
          inject: [PrismaService],
        },
      ],
    };
  }
}
```

В `apps/api/src/app.module.ts` импортировать `JournalModule` и добавить `JournalModule.register(),` рядом с `DirectTransferModule.register(),`.

- [ ] **Step 11: Запустить — тесты проходят**

Run: `pnpm --filter @harmofin/api test:integration -- test/v2-journal.integration.test.ts test/v2-openapi.integration.test.ts test/v2-transaction-journal.integration.test.ts`
Expected: PASS (включая прежний журнал операций).

- [ ] **Step 12: Unit, typecheck, lint**

Run: `pnpm --filter @harmofin/api test && pnpm --filter @harmofin/api typecheck && pnpm --filter @harmofin/api lint`

- [ ] **Step 13: Commit** (после ревью и разрешения владельца)

```bash
git add apps/api/src/v2-journal apps/api/src/app.module.ts apps/api/src/v2-transactions/transaction-v2.application.service.ts apps/api/test/v2-journal.integration.test.ts apps/api/test/v2-openapi.integration.test.ts
git commit -m "feat(api): общая лента журнала операций и переводов"
```

---

### Task 4: Клиент API, фильтр «Переводы», composable мутаций

**Files:**
- Modify: `apps/web/app/composables/useEnvelopePlanV2.ts`
- Modify: `apps/web/app/composables/useOperationFilters.ts`, `useOperationFilters.test.ts`
- Modify: `apps/web/app/components/operations/OperationsToolbar.vue`, `OperationsToolbar.test.ts`
- Create: `apps/web/app/composables/useTransferMutations.ts`, `useTransferMutations.test.ts`

**Interfaces:**
- Consumes: API из Tasks 2–3.
- Produces (из `useEnvelopePlanV2.ts`):
  - `type TransferJournalItem` (поля как в API Task 1), `type TransactionFeedItem = { kind: 'TRANSACTION' } & TransactionJournalV2Item`, `type JournalItem = TransactionFeedItem | TransferJournalItem`, `interface JournalResponse { items: JournalItem[]; nextCursor: string | null }`, `type JournalQuery = Omit<TransactionJournalV2Query, 'type'> & { type?: 'INCOME' | 'EXPENSE' | 'TRANSFER' }`, `interface UpdateDirectTransferRequest { sourceAccountId?: string; destinationAccountId?: string; amount?: string; occurredOn?: string; comment?: string | null }`.
  - методы `listJournal(budgetId, filter?: JournalQuery)`, `updateTransfer(budgetId, id, input, key)`, `deleteTransfer(budgetId, id, key)`, `restoreTransfer(budgetId, id, key)` → `Promise<TransferJournalItem>` (кроме `listJournal` → `JournalResponse`).
  - `OperationFilters['type']` = `'' | 'INCOME' | 'EXPENSE' | 'TRANSFER'`; `toListInput(): JournalQuery`.
  - `useTransferMutations(): { pending: Readonly<Ref<boolean>>; update(budgetId: string, transferId: string, input: UpdateDirectTransferRequest): Promise<TransferJournalItem>; remove(budgetId: string, transfer: TransferJournalItem): Promise<TransferJournalItem | null>; restore(budgetId: string, transfer: TransferJournalItem): Promise<TransferJournalItem | null> }`.

- [ ] **Step 1: Падающие тесты фильтров и toolbar**

В `useOperationFilters.test.ts`: в тесте `'drops values from old links that the v2 API would reject'` удалить `type: 'TRANSFER'` из `route.query` (значение больше не устаревшее) и добавить новый тест:

```ts
  it('keeps the transfer type as a journal filter', () => {
    route.query = { type: 'TRANSFER' };

    const { filters, toListInput } = useOperationFilters();

    expect(filters.value.type).toBe('TRANSFER');
    expect(toListInput()).toEqual({ type: 'TRANSFER' });
  });
```

В `OperationsToolbar.test.ts` добавить (смонтировать так же, как существующие тесты файла):

```ts
  it('offers a transfers tab', () => {
    const wrapper = mountToolbar();
    expect(wrapper.find('[data-testid="type-tab-TRANSFER"]').text()).toBe('Переводы');
  });
```

Имя функции монтирования и формат `data-testid` вкладки сверить с существующими тестами файла (`testid-prefix="type-tab"`).

- [ ] **Step 2: Падающий тест useTransferMutations**

`apps/web/app/composables/useTransferMutations.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = {
  updateTransfer: vi.fn(),
  deleteTransfer: vi.fn(),
  restoreTransfer: vi.fn(),
};
const push = vi.fn();

vi.mock('./useEnvelopePlanV2.js', () => ({ useEnvelopePlanV2: () => api }));
vi.mock('./useToast.js', () => ({ useToast: () => ({ push }) }));

import { useTransferMutations } from './useTransferMutations.js';
import type { TransferJournalItem } from './useEnvelopePlanV2.js';

const transfer: TransferJournalItem = {
  kind: 'TRANSFER', id: 't1', budgetId: 'b1', status: 'CONFIRMED', amountMinor: '10000', currency: 'RUB',
  occurredOn: '2026-10-20', sourceAccountId: 'a', destinationAccountId: 'b', comment: null,
  createdAt: '2026-10-20T10:00:00.000Z', deletedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useTransferMutations', () => {
  it('reuses the idempotency key when the same edit is retried', async () => {
    api.updateTransfer.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(transfer);
    const { update } = useTransferMutations();

    await expect(update('b1', 't1', { comment: 'x' })).rejects.toThrow('network');
    await update('b1', 't1', { comment: 'x' });

    const [first, second] = api.updateTransfer.mock.calls;
    expect(first?.[3]).toBe(second?.[3]);
  });

  it('uses a new key for a different edit', async () => {
    api.updateTransfer.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(transfer);
    const { update } = useTransferMutations();

    await expect(update('b1', 't1', { comment: 'x' })).rejects.toThrow();
    await update('b1', 't1', { comment: 'y' });

    const [first, second] = api.updateTransfer.mock.calls;
    expect(first?.[3]).not.toBe(second?.[3]);
  });

  it('shows a toast on delete and returns the deleted transfer', async () => {
    api.deleteTransfer.mockResolvedValueOnce({ ...transfer, status: 'DELETED' });
    const { remove } = useTransferMutations();

    const result = await remove('b1', transfer);

    expect(result?.status).toBe('DELETED');
    expect(push).toHaveBeenCalledWith(expect.objectContaining({ tone: 'success', title: 'Перевод удалён' }));
  });

  it('explains an insufficient balance on restore', async () => {
    const { ApiRequestError } = await import('./useApiClient.js');
    api.restoreTransfer.mockRejectedValueOnce(
      new ApiRequestError(409, { code: 'INSUFFICIENT_BALANCE', detail: 'x', status: 409, title: 'Conflict' }),
    );
    const { restore } = useTransferMutations();

    expect(await restore('b1', { ...transfer, status: 'DELETED' })).toBeNull();
    expect(push).toHaveBeenCalledWith(
      expect.objectContaining({
        tone: 'error',
        title: 'Не удалось восстановить перевод',
        description: 'На счёте недостаточно средств для этого изменения.',
      }),
    );
  });
});
```

Конструктор `ApiRequestError` сверить в `composables/useApiClient.ts` и в существующих тестах (`useOperationMutations.test.ts`) — использовать ту же форму.

- [ ] **Step 3: Запустить — падают**

Run: `pnpm --filter @harmofin/web test -- app/composables/useOperationFilters.test.ts app/composables/useTransferMutations.test.ts app/components/operations/OperationsToolbar.test.ts`
Expected: FAIL.

- [ ] **Step 4: Клиентские типы и методы**

В `useEnvelopePlanV2.ts` после `TransactionJournalV2Query` добавить:

```ts
// Shared journal feed: v2 transactions and direct transfers in one order.
export interface TransferJournalItem {
  kind: 'TRANSFER';
  id: string;
  budgetId: string;
  status: 'CONFIRMED' | 'DELETED';
  amountMinor: string;
  currency: string;
  occurredOn: string;
  sourceAccountId: string;
  destinationAccountId: string;
  comment: string | null;
  createdAt: string;
  deletedAt: string | null;
}

export type TransactionFeedItem = { kind: 'TRANSACTION' } & TransactionJournalV2Item;
export type JournalItem = TransactionFeedItem | TransferJournalItem;

export interface JournalResponse {
  items: JournalItem[];
  nextCursor: string | null;
}

export type JournalQuery = Omit<TransactionJournalV2Query, 'type'> & {
  type?: 'INCOME' | 'EXPENSE' | 'TRANSFER';
};

// Only the fields that change; status moves through delete/restore.
export interface UpdateDirectTransferRequest {
  sourceAccountId?: string;
  destinationAccountId?: string;
  /** Decimal rubles, e.g. "1250.00". */
  amount?: string;
  occurredOn?: string;
  comment?: string | null;
}
```

Удалить `DirectTransferListResponse` и метод `listDirectTransfers` с комментарием над ним. После `createTransfer` добавить:

```ts
    updateTransfer: (
      budgetId: string,
      transferId: string,
      input: UpdateDirectTransferRequest,
      idempotencyKey: string,
    ) =>
      patchKeyed<TransferJournalItem>(
        `${base(budgetId)}/transfers/${encodeURIComponent(transferId)}`,
        input,
        idempotencyKey,
      ),
    deleteTransfer: (budgetId: string, transferId: string, idempotencyKey: string) =>
      api.request<TransferJournalItem>(
        `${base(budgetId)}/transfers/${encodeURIComponent(transferId)}`,
        { method: 'DELETE', headers: { 'Idempotency-Key': idempotencyKey } },
      ),
    restoreTransfer: (budgetId: string, transferId: string, idempotencyKey: string) =>
      postKeyed<TransferJournalItem>(
        `${base(budgetId)}/transfers/${encodeURIComponent(transferId)}/restore`,
        {},
        idempotencyKey,
      ),
```

После `listTransactions` добавить:

```ts
    listJournal: (budgetId: string, filter: JournalQuery = {}) =>
      get<JournalResponse>(
        `${base(budgetId)}/journal${query({
          ...filter,
          limit: filter.limit === undefined ? undefined : String(filter.limit),
        })}`,
      ),
```

- [ ] **Step 5: Фильтры и вкладка**

В `useOperationFilters.ts`: импорт `type JournalQuery` вместо `TransactionJournalV2Query`; `type: '' | 'INCOME' | 'EXPENSE' | 'TRANSFER';`; `const TYPES = ['INCOME', 'EXPENSE', 'TRANSFER']`; сигнатура `toListInput: () => JournalQuery` и `function toListInput(): JournalQuery`; комментарий над интерфейсом: `// Exactly the filters GET /api/v2/budgets/:id/journal accepts.`

В `OperationsToolbar.vue` в `typeTabs` добавить `{ value: 'TRANSFER', label: 'Переводы' },` после «Расходы».

- [ ] **Step 6: useTransferMutations**

`apps/web/app/composables/useTransferMutations.ts`:

```ts
import { readonly, ref, type Ref } from 'vue';

import {
  useEnvelopePlanV2,
  type TransferJournalItem,
  type UpdateDirectTransferRequest,
} from './useEnvelopePlanV2.js';
import { useToast } from './useToast.js';
import { v2ErrorMessage } from './useV2Error.js';

const OVERRIDES: Record<string, string> = {
  RESOURCE_NOT_FOUND: 'Перевод не найден. Обновите журнал.',
  INSUFFICIENT_BALANCE: 'На счёте недостаточно средств для этого изменения.',
  INVALID_REFERENCE: 'Счёт перевода в архиве. Верните счёт из архива, чтобы восстановить перевод.',
};

const COPY = {
  delete: { success: 'Перевод удалён', failure: 'Не удалось удалить перевод' },
  restore: { success: 'Перевод восстановлен', failure: 'Не удалось восстановить перевод' },
} as const;

export interface TransferMutations {
  pending: Readonly<Ref<boolean>>;
  /** Throws the API error so the edit form can show field errors. */
  update: (
    budgetId: string,
    transferId: string,
    input: UpdateDirectTransferRequest,
  ) => Promise<TransferJournalItem>;
  remove: (budgetId: string, transfer: TransferJournalItem) => Promise<TransferJournalItem | null>;
  restore: (budgetId: string, transfer: TransferJournalItem) => Promise<TransferJournalItem | null>;
}

export function useTransferMutations(): TransferMutations {
  const api = useEnvelopePlanV2();
  const { push } = useToast();
  const pending = ref(false);
  // A retry of the same request must carry the same key, or the server would
  // treat it as a second money movement.
  const keys = new Map<string, string>();

  function keyFor(operation: string): string {
    const existing = keys.get(operation);
    if (existing) return existing;
    const created = crypto.randomUUID();
    keys.set(operation, created);
    return created;
  }

  async function update(
    budgetId: string,
    transferId: string,
    input: UpdateDirectTransferRequest,
  ): Promise<TransferJournalItem> {
    const operation = `update:${transferId}:${JSON.stringify(input)}`;
    pending.value = true;
    try {
      const result = await api.updateTransfer(budgetId, transferId, input, keyFor(operation));
      keys.delete(operation);
      push({ tone: 'success', title: 'Перевод обновлён' });
      return result;
    } finally {
      pending.value = false;
    }
  }

  async function lifecycle(
    action: 'delete' | 'restore',
    budgetId: string,
    transfer: TransferJournalItem,
  ): Promise<TransferJournalItem | null> {
    if (pending.value) return null;
    const operation = `${action}:${transfer.id}`;
    pending.value = true;
    try {
      const key = keyFor(operation);
      const result =
        action === 'delete'
          ? await api.deleteTransfer(budgetId, transfer.id, key)
          : await api.restoreTransfer(budgetId, transfer.id, key);
      keys.delete(operation);
      push({ tone: 'success', title: COPY[action].success });
      return result;
    } catch (error) {
      push({
        tone: 'error',
        title: COPY[action].failure,
        description: v2ErrorMessage(error, 'Повторите попытку.', OVERRIDES),
      });
      return null;
    } finally {
      pending.value = false;
    }
  }

  return {
    pending: readonly(pending),
    update,
    remove: (budgetId, transfer) => lifecycle('delete', budgetId, transfer),
    restore: (budgetId, transfer) => lifecycle('restore', budgetId, transfer),
  };
}
```

Проверить, что `v2ErrorMessage(error, fallback, overrides)` отдаёт override по `code` (как в `useOperationMutations.ts`); если сигнатура иная — повторить её использование оттуда.

- [ ] **Step 7: Запустить — тесты проходят**

Run: `pnpm --filter @harmofin/web test -- app/composables/useOperationFilters.test.ts app/composables/useTransferMutations.test.ts app/components/operations/OperationsToolbar.test.ts`
Expected: PASS. `pages/app/transfers.vue` ещё вызывает `listDirectTransfers` — typecheck на этом шаге не запускать; страница удаляется в Task 7, typecheck — в конце Task 6 и 7.

- [ ] **Step 8: Commit** (после ревью и разрешения владельца)

```bash
git add apps/web/app/composables apps/web/app/components/operations/OperationsToolbar.vue apps/web/app/components/operations/OperationsToolbar.test.ts
git commit -m "feat(web): клиент ленты журнала, фильтр переводов и мутации перевода"
```

---

### Task 5: Строка и диалог перевода, форма с комментарием

**Files:**
- Modify: `apps/web/app/composables/useTransferForm.ts`, `useTransferForm.test.ts`
- Modify: `apps/web/app/components/transfers/DirectTransferForm.vue`, `DirectTransferForm.test.ts`
- Create: `apps/web/app/components/operations/TransferRow.vue`, `TransferRow.test.ts`
- Create: `apps/web/app/components/operations/TransferDialog.vue`, `TransferDialog.test.ts`

**Interfaces:**
- Consumes: `TransferJournalItem`, `UpdateDirectTransferRequest`, `useTransferMutations` (Task 4).
- Produces:
  - `TransferFormModel` получает поле `comment: string`; `transferFormFrom(item: TransferJournalItem): TransferFormModel`; `toTransferPatch(original: TransferJournalItem, model: TransferFormModel): UpdateDirectTransferRequest`.
  - `DirectTransferForm` — новый проп `submitLabel?: string` (по умолчанию «Сохранить перевод»); `submit` по-прежнему эмитит `CreateDirectTransferRequest` (теперь с `comment`, если не пустой).
  - `<TransferRow :transfer :source-name :destination-name @select>` + слот `actions`.
  - `<TransferDialog :transfer="TransferJournalItem | null" :budget-id :accounts="Array<{ value; label }>" :account-names="Map<string, string>" :can-restore="boolean" @close @changed>`; `changed` эмитится после успешного изменения, удаления или восстановления.

- [ ] **Step 1: Падающие тесты формы перевода**

В `useTransferForm.test.ts` добавить:

```ts
import { toTransferPatch, transferFormFrom } from './useTransferForm.js';

const item = {
  kind: 'TRANSFER' as const, id: 't1', budgetId: 'b1', status: 'CONFIRMED' as const, amountMinor: '150050',
  currency: 'RUB', occurredOn: '2026-10-20', sourceAccountId: 'a', destinationAccountId: 'b', comment: null,
  createdAt: '2026-10-20T10:00:00.000Z', deletedAt: null,
};

describe('transfer edit form', () => {
  it('fills the form from a journal transfer', () => {
    expect(transferFormFrom(item)).toEqual({
      total: '1500.50', occurredOn: '2026-10-20', sourceAccountId: 'a', destinationAccountId: 'b', comment: '',
    });
  });

  it('sends only the changed fields', () => {
    const model = { ...transferFormFrom(item), total: '1 600,00', comment: 'Отпуск' };
    expect(toTransferPatch(item, model)).toEqual({ amount: '1600.00', comment: 'Отпуск' });
  });

  it('clears a comment with null', () => {
    const model = { ...transferFormFrom({ ...item, comment: 'x' }), comment: '  ' };
    expect(toTransferPatch({ ...item, comment: 'x' }, model)).toEqual({ comment: null });
  });

  it('treats an equal amount written differently as unchanged', () => {
    const model = { ...transferFormFrom(item), total: '1500,5' };
    expect(toTransferPatch(item, model)).toEqual({});
  });
});
```

В `DirectTransferForm.test.ts` добавить тест: при вводе комментария «Отпуск» и отправке событие `submit` содержит `comment: 'Отпуск'`; проп `submitLabel="Сохранить изменения"` меняет текст кнопки. Монтирование — как в существующих тестах файла.

- [ ] **Step 2: Запустить — падают**

Run: `pnpm --filter @harmofin/web test -- app/composables/useTransferForm.test.ts app/components/transfers/DirectTransferForm.test.ts`

- [ ] **Step 3: Реализация формы**

`useTransferForm.ts` целиком:

```ts
import type {
  CreateDirectTransferRequest,
  TransferJournalItem,
  UpdateDirectTransferRequest,
} from './useEnvelopePlanV2.js';

// Envelope Plan v2.2: a transfer only moves money between two different
// accounts, so the form carries an amount, a date, the two accounts and a note.
export type TransferFormModel = {
  total: string;
  occurredOn: string;
  sourceAccountId: string;
  destinationAccountId: string;
  comment: string;
};

export function createTransferForm(sourceAccountId = ''): TransferFormModel {
  return {
    total: '',
    occurredOn: new Date().toISOString().slice(0, 10),
    sourceAccountId,
    destinationAccountId: '',
    comment: '',
  };
}

export function transferFormFrom(item: TransferJournalItem): TransferFormModel {
  return {
    total: minorToDecimal(item.amountMinor),
    occurredOn: item.occurredOn,
    sourceAccountId: item.sourceAccountId,
    destinationAccountId: item.destinationAccountId,
    comment: item.comment ?? '',
  };
}

export function toDirectTransferInput(model: TransferFormModel): CreateDirectTransferRequest {
  const comment = model.comment.trim();
  return {
    sourceAccountId: model.sourceAccountId,
    destinationAccountId: model.destinationAccountId,
    amount: normalizeDecimal(model.total),
    occurredOn: model.occurredOn,
    ...(comment ? { comment } : {}),
  };
}

/** Only the fields that differ from the saved transfer; the server confirms the rest. */
export function toTransferPatch(
  original: TransferJournalItem,
  model: TransferFormModel,
): UpdateDirectTransferRequest {
  const patch: UpdateDirectTransferRequest = {};
  const amount = normalizeDecimal(model.total);
  if (decimalToMinor(amount) !== original.amountMinor) patch.amount = withCents(amount);
  if (model.occurredOn !== original.occurredOn) patch.occurredOn = model.occurredOn;
  if (model.sourceAccountId !== original.sourceAccountId) patch.sourceAccountId = model.sourceAccountId;
  if (model.destinationAccountId !== original.destinationAccountId) {
    patch.destinationAccountId = model.destinationAccountId;
  }
  const comment = model.comment.trim() || null;
  if (comment !== original.comment) patch.comment = comment;
  return patch;
}

function normalizeDecimal(value: string): string {
  return value.replaceAll(/(?:\s|\xA0)/g, '').replace(',', '.');
}

// String arithmetic only: money never goes through floating point.
function decimalToMinor(value: string): string {
  const [whole = '0', fraction = ''] = value.split('.');
  const minor = `${whole}${fraction.padEnd(2, '0').slice(0, 2)}`.replace(/^0+(?=\d)/, '');
  return minor === '' ? '0' : minor;
}

function withCents(value: string): string {
  const [whole = '0', fraction = ''] = value.split('.');
  return `${whole}.${fraction.padEnd(2, '0').slice(0, 2)}`;
}

function minorToDecimal(minor: string): string {
  const padded = minor.padStart(3, '0');
  return `${padded.slice(0, -2)}.${padded.slice(-2)}`;
}
```

Если `CreateDirectTransferRequest` в `useEnvelopePlanV2.ts` не содержит `comment?: string` — добавить это поле.

`DirectTransferForm.vue`: импорт `UiInput from '../ui/Input.vue'`; проп `submitLabel?: string` с дефолтом `'Сохранить перевод'` в `withDefaults`; перед кнопкой:

```vue
    <UiInput
      v-model="form.comment"
      name="comment"
      label="Комментарий"
      :error="errors.comment"
      maxlength="500"
    />
```

и текст кнопки `{{ submitLabel }}`. Поддерживает ли `UiInput` атрибут `maxlength` — сверить в `components/ui/Input.vue`; если нет, атрибут не передавать (сервер ограничит 500).

Глобальный диалог ввода (`AppOperationEntryDialog.vue`) использует `createTransferForm()` — поле `comment: ''` в модели ему не мешает; поле комментария там не добавляется (вне области).

- [ ] **Step 4: Запустить — тесты формы проходят**

Run: `pnpm --filter @harmofin/web test -- app/composables/useTransferForm.test.ts app/components/transfers/DirectTransferForm.test.ts`

- [ ] **Step 5: Падающие тесты TransferRow**

`apps/web/app/components/operations/TransferRow.test.ts`:

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import TransferRow from './TransferRow.vue';
import type { TransferJournalItem } from '../../composables/useEnvelopePlanV2.js';

const transfer: TransferJournalItem = {
  kind: 'TRANSFER', id: 't1', budgetId: 'b1', status: 'CONFIRMED', amountMinor: '150000', currency: 'RUB',
  occurredOn: '2026-10-20', sourceAccountId: 'a', destinationAccountId: 'b', comment: 'Отпуск',
  createdAt: '2026-10-20T10:00:00.000Z', deletedAt: null,
};

function mountRow(overrides: Partial<TransferJournalItem> = {}) {
  return mount(TransferRow, {
    props: { transfer: { ...transfer, ...overrides }, sourceName: 'Карта', destinationName: 'Вклад' },
  });
}

describe('TransferRow', () => {
  it('shows the route between accounts and the note', () => {
    const wrapper = mountRow();
    expect(wrapper.text()).toContain('Перевод');
    expect(wrapper.text()).toContain('Карта → Вклад');
    expect(wrapper.text()).toContain('Отпуск');
  });

  it('shows the amount without a sign', () => {
    const text = mountRow().find('.transfer-row__amount').text();
    expect(text).not.toMatch(/^[-−+]/);
  });

  it('marks a deleted transfer with text, not only colour', () => {
    expect(mountRow({ status: 'DELETED' }).find('[data-testid="transfer-row-status"]').text()).toBe('Удалён');
  });

  it('emits select', async () => {
    const wrapper = mountRow();
    await wrapper.find('button, [role="button"]').trigger('click');
    expect(wrapper.emitted('select')).toHaveLength(1);
  });
});
```

Как `UiListRow` рендерит кликабельный элемент — сверить в `OperationRow.test.ts` и использовать тот же селектор для клика.

- [ ] **Step 6: Реализация TransferRow**

`apps/web/app/components/operations/TransferRow.vue`:

```vue
<script setup lang="ts">
import { computed } from 'vue';
import { ArrowLeftRight } from '@lucide/vue';

import FinanceMoney from '../finance/FinanceMoney.vue';
import UiListRow from '../ui/ListRow.vue';
import UiStatus from '../ui/Status.vue';
import type { TransferJournalItem } from '../../composables/useEnvelopePlanV2.js';
import { formatPlainDate } from '../obligations/format-plain-date.js';

defineOptions({ name: 'TransferRow' });

const props = defineProps<{
  transfer: TransferJournalItem;
  sourceName: string;
  destinationName: string;
}>();

defineEmits<{ select: [] }>();

// The journal money scale is fixed: the API serves RUB in minor units.
const SCALE = 2;

const route = computed(() => `${props.sourceName} → ${props.destinationName}`);

const rowLabel = computed(
  () => `Открыть перевод ${route.value} от ${formatPlainDate(props.transfer.occurredOn)}`,
);
</script>

<template>
  <UiListRow :label="rowLabel" @select="$emit('select')">
    <template #leading><ArrowLeftRight :size="20" aria-hidden="true" /></template>

    <span class="transfer-row__title">Перевод</span>
    <span class="transfer-row__subtitle">{{ route }}</span>
    <span v-if="transfer.comment" class="transfer-row__subtitle">{{ transfer.comment }}</span>
    <span v-if="transfer.status === 'DELETED'" class="transfer-row__meta">
      <UiStatus data-testid="transfer-row-status" label="Удалён" tone="danger" />
    </span>

    <template #trailing>
      <!-- A transfer is neither income nor spending: no sign, neutral colour. -->
      <FinanceMoney
        class="transfer-row__amount"
        :minor-units="transfer.amountMinor"
        :currency="transfer.currency"
        :scale="SCALE"
      />
    </template>

    <template v-if="$slots.actions" #actions><slot name="actions" /></template>
  </UiListRow>
</template>

<style scoped>
.transfer-row__title {
  overflow: hidden;
  font-weight: var(--hf-font-weight-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.transfer-row__subtitle {
  overflow: hidden;
  max-width: 100%;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
  line-height: var(--hf-line-height-caption);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.transfer-row__meta {
  display: flex;
  gap: var(--hf-space-1);
  align-items: center;
}

.transfer-row__amount {
  color: var(--hf-color-text);
  font-weight: var(--hf-font-weight-semibold);
  white-space: nowrap;
}
</style>
```

- [ ] **Step 7: Падающие тесты TransferDialog**

`apps/web/app/components/operations/TransferDialog.test.ts` (мок `useTransferMutations` через `vi.mock('../../composables/useTransferMutations.js', …)` с `pending: ref(false)`, `update`, `remove`, `restore` — `vi.fn()`; монтирование с `attachTo: document.body` и стабами `UiModal`/`UiConfirmDialog` — как в `OperationDialog.test.ts`):

```ts
it('shows amount, accounts, date and comment', () => {
  const wrapper = mountDialog();
  expect(wrapper.text()).toContain('Карта');
  expect(wrapper.text()).toContain('Вклад');
  expect(wrapper.text()).toContain('Отпуск');
});

it('edits: submits only changed fields and emits changed', async () => {
  mutations.update.mockResolvedValueOnce({ ...transfer, comment: 'Новое' });
  const wrapper = mountDialog();
  await wrapper.find('[data-testid="transfer-dialog-edit"]').trigger('click');
  await wrapper.find('input[name="comment"]').setValue('Новое');
  await wrapper.find('[data-testid="direct-transfer-form"]').trigger('submit');
  await flushPromises();
  expect(mutations.update).toHaveBeenCalledWith('b1', 't1', { comment: 'Новое' });
  expect(wrapper.emitted('changed')).toHaveLength(1);
});

it('edit with no changes does not call the API', async () => {
  const wrapper = mountDialog();
  await wrapper.find('[data-testid="transfer-dialog-edit"]').trigger('click');
  await wrapper.find('[data-testid="direct-transfer-form"]').trigger('submit');
  await flushPromises();
  expect(mutations.update).not.toHaveBeenCalled();
});

it('shows server field errors in the edit form', async () => {
  mutations.update.mockRejectedValueOnce(
    new ApiRequestError(400, {
      code: 'VALIDATION_FAILED', detail: 'x', status: 400, title: 'Bad Request',
      fieldErrors: [{ field: 'amount', message: 'Сумма должна быть больше нуля.', code: 'invalid' }],
    }),
  );
  const wrapper = mountDialog();
  await wrapper.find('[data-testid="transfer-dialog-edit"]').trigger('click');
  await wrapper.find('input[name="comment"]').setValue('x');
  await wrapper.find('[data-testid="direct-transfer-form"]').trigger('submit');
  await flushPromises();
  expect(wrapper.text()).toContain('Сумма должна быть больше нуля.');
});

it('delete asks for confirmation, then removes and emits changed', async () => {
  mutations.remove.mockResolvedValueOnce({ ...transfer, status: 'DELETED' });
  const wrapper = mountDialog();
  await wrapper.find('[data-testid="transfer-dialog-delete"]').trigger('click');
  expect(wrapper.text()).toContain('Удалить перевод?');
  expect(wrapper.text()).toContain('Перевод останется в истории, но перестанет влиять на балансы счетов.');
  await wrapper.find('[data-testid="confirm-dialog-confirm"]').trigger('click');
  await flushPromises();
  expect(mutations.remove).toHaveBeenCalledWith('b1', transfer);
  expect(wrapper.emitted('changed')).toHaveLength(1);
});

it('a deleted transfer offers restore only to the owner and no edit', () => {
  const deleted = { ...transfer, status: 'DELETED' as const };
  expect(mountDialog({ transfer: deleted, canRestore: true }).find('[data-testid="transfer-dialog-restore"]').exists()).toBe(true);
  expect(mountDialog({ transfer: deleted, canRestore: false }).find('[data-testid="transfer-dialog-restore"]').exists()).toBe(false);
  expect(mountDialog({ transfer: deleted, canRestore: true }).find('[data-testid="transfer-dialog-edit"]').exists()).toBe(false);
});
```

`data-testid` кнопки подтверждения сверить в `components/ui/ConfirmDialog.vue`.

- [ ] **Step 8: Реализация TransferDialog**

`apps/web/app/components/operations/TransferDialog.vue`:

```vue
<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import DirectTransferForm from '../transfers/DirectTransferForm.vue';
import FinanceMoney from '../finance/FinanceMoney.vue';
import UiButton from '../ui/Button.vue';
import UiConfirmDialog from '../ui/ConfirmDialog.vue';
import UiModal from '../ui/Modal.vue';
import UiStatus from '../ui/Status.vue';
import { ApiRequestError } from '../../composables/useApiClient.js';
import type {
  CreateDirectTransferRequest,
  TransferJournalItem,
} from '../../composables/useEnvelopePlanV2.js';
import {
  toTransferPatch,
  transferFormFrom,
  type TransferFormModel,
} from '../../composables/useTransferForm.js';
import { useTransferMutations } from '../../composables/useTransferMutations.js';
import { v2ErrorMessage } from '../../composables/useV2Error.js';
import { formatPlainDate } from '../obligations/format-plain-date.js';

defineOptions({ name: 'TransferDialog' });

const props = defineProps<{
  transfer: TransferJournalItem | null;
  budgetId: string;
  accounts: ReadonlyArray<{ value: string; label: string }>;
  accountNames: ReadonlyMap<string, string>;
  canRestore: boolean;
}>();

const emit = defineEmits<{ close: []; changed: [] }>();

const SCALE = 2;
const mutations = useTransferMutations();
const editing = ref(false);
const form = ref<TransferFormModel | null>(null);
const formErrors = ref<Partial<Record<string, string>>>({});
const formError = ref('');
const confirming = ref<null | 'delete' | 'restore'>(null);

watch(
  () => props.transfer?.id,
  () => {
    editing.value = false;
    confirming.value = null;
  },
);

const deleted = computed(() => props.transfer?.status === 'DELETED');

function name(accountId: string): string {
  return props.accountNames.get(accountId) ?? 'Счёт';
}

const confirmCopy = computed(() =>
  confirming.value === 'restore'
    ? { title: 'Восстановить перевод?', description: 'Перевод снова начнёт влиять на балансы счетов.' }
    : {
        title: 'Удалить перевод?',
        description: 'Перевод останется в истории, но перестанет влиять на балансы счетов.',
      },
);

function startEdit(): void {
  if (!props.transfer) return;
  form.value = transferFormFrom(props.transfer);
  formErrors.value = {};
  formError.value = '';
  editing.value = true;
}

async function save(input: CreateDirectTransferRequest): Promise<void> {
  const current = props.transfer;
  if (!current) return;
  const patch = toTransferPatch(current, {
    total: input.amount,
    occurredOn: input.occurredOn,
    sourceAccountId: input.sourceAccountId,
    destinationAccountId: input.destinationAccountId,
    comment: input.comment ?? '',
  });
  if (Object.keys(patch).length === 0) {
    editing.value = false;
    return;
  }
  try {
    await mutations.update(props.budgetId, current.id, patch);
    editing.value = false;
    emit('changed');
  } catch (exception) {
    formErrors.value =
      exception instanceof ApiRequestError
        ? Object.fromEntries((exception.problem.fieldErrors ?? []).map((f) => [f.field, f.message]))
        : {};
    formError.value = v2ErrorMessage(exception, 'Не удалось сохранить перевод. Повторите попытку.', {
      INSUFFICIENT_BALANCE: 'На счёте недостаточно средств для этого изменения.',
    });
  }
}

async function confirm(): Promise<void> {
  const current = props.transfer;
  const action = confirming.value;
  confirming.value = null;
  if (!current || !action) return;
  const result =
    action === 'delete'
      ? await mutations.remove(props.budgetId, current)
      : await mutations.restore(props.budgetId, current);
  if (result) emit('changed');
}
</script>

<template>
  <UiModal
    :open="transfer !== null && !editing"
    title="Перевод"
    size="sm"
    @close="emit('close')"
  >
    <div v-if="transfer" class="transfer-dialog">
      <p class="transfer-dialog__amount">
        <FinanceMoney :minor-units="transfer.amountMinor" :currency="transfer.currency" :scale="SCALE" />
      </p>
      <p v-if="deleted"><UiStatus label="Удалён" tone="danger" /></p>
      <dl class="transfer-dialog__rows">
        <div><dt>Дата</dt><dd>{{ formatPlainDate(transfer.occurredOn) }}</dd></div>
        <div><dt>Со счёта</dt><dd>{{ name(transfer.sourceAccountId) }}</dd></div>
        <div><dt>На счёт</dt><dd>{{ name(transfer.destinationAccountId) }}</dd></div>
        <div v-if="transfer.comment"><dt>Комментарий</dt><dd>{{ transfer.comment }}</dd></div>
      </dl>
      <div class="transfer-dialog__actions">
        <UiButton
          v-if="!deleted"
          data-testid="transfer-dialog-edit"
          variant="secondary"
          :disabled="mutations.pending.value"
          @click="startEdit"
        >Изменить</UiButton>
        <UiButton
          v-if="!deleted"
          data-testid="transfer-dialog-delete"
          variant="tertiary"
          :disabled="mutations.pending.value"
          @click="confirming = 'delete'"
        >Удалить</UiButton>
        <UiButton
          v-if="deleted && canRestore"
          data-testid="transfer-dialog-restore"
          variant="secondary"
          :disabled="mutations.pending.value"
          @click="confirming = 'restore'"
        >Восстановить</UiButton>
      </div>
    </div>
  </UiModal>

  <UiModal :open="editing" title="Изменить перевод" @close="editing = false">
    <p v-if="formError" class="transfer-dialog__error" role="alert">{{ formError }}</p>
    <DirectTransferForm
      v-if="form"
      :model="form"
      :accounts="accounts"
      :errors="formErrors"
      :pending="mutations.pending.value"
      submit-label="Сохранить изменения"
      @submit="save"
    />
  </UiModal>

  <UiConfirmDialog
    :open="confirming !== null"
    :title="confirmCopy.title"
    :description="confirmCopy.description"
    confirm-label="Подтвердить"
    cancel-label="Отмена"
    :variant="confirming === 'delete' ? 'danger' : 'primary'"
    :loading="mutations.pending.value"
    @confirm="confirm"
    @cancel="confirming = null"
  />
</template>

<style scoped>
.transfer-dialog {
  display: grid;
  gap: var(--hf-space-4);
}

.transfer-dialog__amount {
  font-size: var(--hf-font-size-title);
  font-weight: var(--hf-font-weight-semibold);
}

.transfer-dialog__rows {
  display: grid;
  gap: var(--hf-space-2);
}

.transfer-dialog__rows > div {
  display: flex;
  justify-content: space-between;
  gap: var(--hf-space-3);
}

.transfer-dialog__rows dt {
  color: var(--hf-color-text-muted);
}

.transfer-dialog__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-2);
}

.transfer-dialog__error {
  margin-bottom: var(--hf-space-4);
  color: var(--hf-color-text-danger);
}
</style>
```

Токены (`--hf-font-size-title` и т. п.) сверить со стилями `OperationDialog.vue` и использовать те же, что там для суммы и строк.
- [ ] **Step 9: Запустить — тесты проходят**

Run: `pnpm --filter @harmofin/web test -- app/components/operations/TransferRow.test.ts app/components/operations/TransferDialog.test.ts app/composables/useTransferForm.test.ts app/components/transfers/DirectTransferForm.test.ts`

- [ ] **Step 10: Commit** (после ревью и разрешения владельца)

```bash
git add apps/web/app/composables/useTransferForm.ts apps/web/app/composables/useTransferForm.test.ts apps/web/app/composables/useEnvelopePlanV2.ts apps/web/app/components/transfers/DirectTransferForm.vue apps/web/app/components/transfers/DirectTransferForm.test.ts apps/web/app/components/operations/TransferRow.vue apps/web/app/components/operations/TransferRow.test.ts apps/web/app/components/operations/TransferDialog.vue apps/web/app/components/operations/TransferDialog.test.ts
git commit -m "feat(web): строка и диалог перевода в журнале"
```

---

### Task 6: Журнал читает общую ленту

**Files:**
- Modify: `apps/web/app/pages/app/operations.vue`
- Modify: `apps/web/app/pages/app/operations.test.ts`

**Interfaces:**
- Consumes: `listJournal`, `JournalItem`, `TransactionFeedItem`, `TransferJournalItem` (Task 4); `TransferRow`, `TransferDialog` (Task 5).
- Produces: журнал без новых публичных API.

- [ ] **Step 1: Падающие тесты страницы**

В `operations.test.ts` мок `useEnvelopePlanV2` сейчас отдаёт `listTransactions`. Переименовать мок в `listJournal` и обернуть существующие фикстуры операций в `{ kind: 'TRANSACTION', ...item }`. Добавить тесты:

```ts
it('renders a transfer from the feed as a transfer row', async () => {
  api.listJournal.mockResolvedValueOnce({
    items: [{ ...transferFixture }, { kind: 'TRANSACTION', ...expenseFixture }],
    nextCursor: null,
  });
  const wrapper = await mountPage();
  expect(wrapper.text()).toContain('Перевод');
  expect(wrapper.text()).toContain(`${accountA} → ${accountB}`);
});

it('opens the transfer dialog on a transfer row and reloads after a change', async () => {
  api.listJournal.mockResolvedValue({ items: [{ ...transferFixture }], nextCursor: null });
  const wrapper = await mountPage();
  await wrapper.findComponent({ name: 'TransferRow' }).vm.$emit('select');
  await nextTick();
  const dialog = wrapper.findComponent({ name: 'TransferDialog' });
  expect(dialog.props('transfer')).toMatchObject({ id: transferFixture.id });
  const calls = api.listJournal.mock.calls.length;
  dialog.vm.$emit('changed');
  await flushPromises();
  expect(api.listJournal.mock.calls.length).toBe(calls + 1);
  expect(wrapper.findComponent({ name: 'TransferDialog' }).props('transfer')).toBeNull();
});

it('passes the transfer type filter to the feed', async () => {
  route.query = { type: 'TRANSFER' };
  await mountPage();
  expect(api.listJournal).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ type: 'TRANSFER' }));
});
```

`transferFixture`, `accountA`/`accountB` (имена счетов из мока справочников), `mountPage`, `route` — по образцу существующих фикстур и хелперов файла.

- [ ] **Step 2: Запустить — падают**

Run: `pnpm --filter @harmofin/web test -- app/pages/app/operations.test.ts`

- [ ] **Step 3: Изменить страницу**

В `pages/app/operations.vue`:

1. Импорты: добавить `TransferRow`, `TransferDialog`; из `useEnvelopePlanV2.js` — `type JournalItem`, `type TransactionFeedItem`, `type TransferJournalItem`.
2. Состояние: `const items = ref<JournalItem[]>([]);` вместо `transactions`; `const detailedTransfer = ref<TransferJournalItem | null>(null);`.
3. Хелперы:

```ts
function isTransfer(item: JournalItem): item is TransferJournalItem {
  return item.kind === 'TRANSFER';
}

function transferRoute(item: TransferJournalItem) {
  return {
    sourceName: accountNameById.value.get(item.sourceAccountId) ?? 'Счёт',
    destinationName: accountNameById.value.get(item.destinationAccountId) ?? 'Счёт',
  };
}

function onTransferChanged(): void {
  detailedTransfer.value = null;
  void load();
}
```

4. `sections`: `computed(() => groupByDay(items.value, today))`.
5. `load()`: `planV2.listJournal(budget.value.id, { ...toListInput(), ...(append && nextCursor.value ? { cursor: nextCursor.value } : {}) })`; `items.value = append ? [...items.value, ...result.items] : result.items;`.
6. Остальные функции операций (`categoryName`, `accountName`, `openEdit`, `ask`, `confirmation`, `detailed`, `selectedTransaction`) продолжают принимать `TransactionJournalV2Item`; `TransactionFeedItem` совместим с ним структурно, менять их сигнатуры не нужно.
7. Шаблон: везде `transactions.length` → `items.length`; тело `<li>`:

```vue
            <li v-for="item in section.items" :key="item.id">
              <TransferRow
                v-if="isTransfer(item)"
                :transfer="item"
                v-bind="transferRoute(item)"
                @select="detailedTransfer = item"
              />
              <OperationRow
                v-else
                :transaction="item"
                ...существующие пропсы и слот actions с `transaction` → `item`...
              />
            </li>
```

8. Пустое состояние без фильтров: описание «Добавьте доход, расход или перевод, чтобы начать журнал.».
9. После `<OperationDialog …/>`:

```vue
    <TransferDialog
      v-if="budget"
      :transfer="detailedTransfer"
      :budget-id="budget.id"
      :accounts="accounts"
      :account-names="accountNameById"
      :can-restore="isOwner"
      @close="detailedTransfer = null"
      @changed="onTransferChanged"
    />
```

10. Обновить комментарий над `load`/`watch(globalOperationDialog…)`, если он упоминает только операции; `preloadDetailed` (переход с дашборда по `operationId`) остаётся только для операций.

- [ ] **Step 4: Запустить — тесты проходят**

Run: `pnpm --filter @harmofin/web test -- app/pages/app/operations.test.ts app/components/operations`

- [ ] **Step 5: Commit** (после ревью и разрешения владельца)

```bash
git add apps/web/app/pages/app/operations.vue apps/web/app/pages/app/operations.test.ts
git commit -m "feat(web): журнал операций показывает переводы"
```

---

### Task 7: Удалить страницу переводов, перевод со счёта через глобальный диалог

**Files:**
- Delete: `apps/web/app/pages/app/transfers.vue`, `apps/web/app/pages/app/transfers.test.ts`, `apps/web/app/components/transfers/DirectTransferCard.vue`
- Modify: `apps/web/app/components/app/AppSidebar.vue`, `AppSidebar.test.ts`, `AppMobileMenu.vue` (и его тест, если проверяет пункты)
- Modify: `apps/web/app/composables/useOperationDialogs.ts`, `useOperationDialogs.test.ts`
- Modify: `apps/web/app/components/app/AppOperationEntryDialog.vue`, `AppOperationDialogs.vue`
- Modify: `apps/web/app/components/accounts/AccountDialog.vue`, `AccountDialog.test.ts`
- Modify: `apps/web/app/pages/app/accounts.vue:140`, `categories.vue:125` (комментарии про страницу переводов)

**Interfaces:**
- Consumes: —
- Produces: `useOperationDialogs().openTransfer(sourceAccountId?: string)`; `useOperationDialogs().transferSourceAccountId: Readonly<Ref<string>>`; `AppOperationEntryDialog` — проп `initialSourceAccountId?: string`.

- [ ] **Step 1: Падающие тесты**

`useOperationDialogs.test.ts`:

```ts
  it('remembers the source account of a transfer opened from an account', () => {
    const dialogs = useOperationDialogs();
    dialogs.openTransfer('account-id');
    expect(dialogs.entryType.value).toBe('TRANSFER');
    expect(dialogs.transferSourceAccountId.value).toBe('account-id');
    dialogs.close();
    expect(dialogs.transferSourceAccountId.value).toBe('');
  });
```

`AccountDialog.test.ts`: заменить ожидание `href` на:

```ts
    const dialogs = useOperationDialogs();
    await wrapper.get('[data-testid="account-dialog-transfer"]').trigger('click');
    expect(dialogs.entryType.value).toBe('TRANSFER');
    expect(dialogs.transferSourceAccountId.value).toBe('account-id');
    expect(wrapper.emitted('close')).toHaveLength(1);
```

(импорт `useOperationDialogs` из `../../composables/useOperationDialogs.js`; сбрасывать `dialogs.close()` в `afterEach`.)

`AppSidebar.test.ts`: убрать `'/app/transfers'` из ожидаемого списка ссылок.

Для `AppOperationEntryDialog` добавить тест (в существующий файл тестов `AppOperationDialogs.test.ts`): при `openTransfer('account-id')` поле `transferSource` получает значение `account-id` — проверка через `wrapper.find('[name="transferSource"]')` по образцу соседних тестов файла.

- [ ] **Step 2: Запустить — падают**

Run: `pnpm --filter @harmofin/web test -- app/composables/useOperationDialogs.test.ts app/components/accounts/AccountDialog.test.ts app/components/app`

- [ ] **Step 3: Реализация**

`useOperationDialogs.ts`: добавить модульный `const transferSourceAccountId = ref('');`, в тип возврата `transferSourceAccountId: Readonly<Ref<string>>;` и `openTransfer: (sourceAccountId?: string) => void;`, реализация:

```ts
    transferSourceAccountId: readonly(transferSourceAccountId) as Readonly<Ref<string>>,
    openTransfer: (sourceAccountId = '') => {
      transferSourceAccountId.value = sourceAccountId;
      entryType.value = 'TRANSFER';
      openDialog.value = 'entry';
    },
```

и в `openChoose`, `openOperation`, `close` — `transferSourceAccountId.value = '';`.

`AppOperationEntryDialog.vue`: проп `initialSourceAccountId?: string` (дефолт `''`), в `watch(() => props.open…)` заменить `Object.assign(transfer, createTransferForm());` на `Object.assign(transfer, createTransferForm(props.initialSourceAccountId));`.

`AppOperationDialogs.vue`: взять `transferSourceAccountId` из `useOperationDialogs()` и передать `:initial-source-account-id="transferSourceAccountId"` в `<AppOperationEntryDialog>`. В `chooseType` вызов `openTransfer()` без аргумента не меняется.

`AccountDialog.vue`: удалить `transferLink`; добавить

```ts
import { useOperationDialogs } from '../../composables/useOperationDialogs.js';

const { openTransfer } = useOperationDialogs();

function transferFromAccount(): void {
  if (!props.account) return;
  emit('close');
  openTransfer(props.account.id);
}
```

и у кнопки `data-testid="account-dialog-transfer"` заменить `:to="transferLink"` на `@click="transferFromAccount"`.

`AppSidebar.vue` и `AppMobileMenu.vue`: удалить `<NuxtLink to="/app/transfers" …>Переводы</NuxtLink>` и неиспользуемый импорт `ArrowLeftRight`.

Удалить файлы:

```bash
git rm apps/web/app/pages/app/transfers.vue apps/web/app/pages/app/transfers.test.ts apps/web/app/components/transfers/DirectTransferCard.vue
```

В `accounts.vue:140` и `categories.vue:125` заменить в комментарии «the transfers page» на «the journal».

Проверить, что больше нет ссылок:

Run: `rg -n "app/transfers|DirectTransferCard|listDirectTransfers" apps/web/app e2e`
Expected: пусто.

- [ ] **Step 4: Все web-проверки**

Run: `pnpm --filter @harmofin/web test && pnpm --filter @harmofin/web typecheck && pnpm --filter @harmofin/web lint`
Expected: без ошибок.

- [ ] **Step 5: Commit** (после ревью и разрешения владельца)

```bash
git add -A apps/web/app
git commit -m "feat(web): убрать страницу переводов, перевод со счёта из глобального диалога"
```

---

### Task 8: E2E-сценарий (выполняется в CI)

**Files:**
- Create: `e2e/envelope-v2-transfers-journal.spec.ts`

**Interfaces:**
- Consumes: весь UI из Tasks 4–7.

- [ ] **Step 1: Написать сценарий**

Хелперы `registerAndReachApp`, `budgetIdOf`, `getJson`, `mutate` скопировать из `e2e/envelope-v2-payments.spec.ts` (те же импорты `apiMutate`, `apiOrigin`). Сценарий:

```ts
test('v2: перевод в журнале — создать, изменить, удалить и восстановить', async ({ page }) => {
  test.setTimeout(180_000);
  await registerAndReachApp(page);
  const budgetId = await budgetIdOf(page);
  const base = `${API_V2}/budgets/${budgetId}`;

  // SETUP (API): два счёта, на первом 10 000 ₽.
  const card = await mutate<{ id: string }>(page, `${base}/accounts`, {
    name: 'Карта', accountType: 'BANK_CARD', startingBalance: '10000.00',
  });
  const deposit = await mutate<{ id: string }>(page, `${base}/accounts`, {
    name: 'Вклад', accountType: 'BANK_ACCOUNT', startingBalance: '0.00',
  });

  // Создать перевод из карточки счёта.
  await page.goto('/app/accounts');
  await page.getByRole('button', { name: /Карта/ }).click();
  await page.getByTestId('account-dialog-transfer').click();
  const entry = page.getByRole('dialog');
  await entry.getByLabel('Сумма').fill('1 500,00');
  await entry.locator('[name="transferDestination"]').click();
  await page.getByRole('option', { name: 'Вклад' }).click();
  await entry.getByRole('button', { name: /Сохранить/ }).click();

  // Журнал: вкладка «Переводы».
  await page.goto('/app/operations');
  await page.getByTestId('type-tab-TRANSFER').click();
  const row = page.getByRole('button', { name: /Открыть перевод Карта → Вклад/ });
  await expect(row).toBeVisible();

  // Изменить сумму и комментарий.
  await row.click();
  await page.getByTestId('transfer-dialog-edit').click();
  await page.getByLabel('Сумма').fill('2 000,00');
  await page.getByLabel('Комментарий').fill('Отпуск');
  await page.getByRole('button', { name: 'Сохранить изменения' }).click();
  await expect(page.getByText('Отпуск')).toBeVisible();
  const accounts = await getJson<{ items: Array<{ id: string; currentBalanceMinor: string }> }>(page, `${base}/accounts`);
  expect(accounts.items.find((a) => a.id === deposit.id)?.currentBalanceMinor).toBe('200000');

  // Удалить: строка пропадает, баланс вклада возвращается к нулю.
  await page.getByRole('button', { name: /Открыть перевод Карта → Вклад/ }).click();
  await page.getByTestId('transfer-dialog-delete').click();
  await page.getByRole('button', { name: 'Подтвердить' }).click();
  await expect(page.getByRole('button', { name: /Открыть перевод Карта → Вклад/ })).toHaveCount(0);

  // Восстановить из фильтра «Удалённые».
  await page.goto('/app/operations?type=TRANSFER&status=DELETED');
  await page.getByRole('button', { name: /Открыть перевод Карта → Вклад/ }).click();
  await page.getByTestId('transfer-dialog-restore').click();
  await page.getByRole('button', { name: 'Подтвердить' }).click();
  await page.goto('/app/operations?type=TRANSFER');
  await expect(page.getByRole('button', { name: /Открыть перевод Карта → Вклад/ })).toBeVisible();
  void card;
});
```

Тело `POST /accounts` (имена полей, тип счёта, формат начального остатка), имя поля баланса в ответе `GET /accounts`, роль и подпись кнопки счёта на странице `/app/accounts` и способ выбора значения в `UiSelect` — сверить с `e2e/reference-lists.spec.ts` / `e2e/envelope-v2-payments.spec.ts` и использовать те же приёмы. Строку `void card;` убрать, если `card.id` используется в проверке баланса.

- [ ] **Step 2: Статические проверки**

Run: `pnpm lint && pnpm format:check`
Expected: без ошибок. Локально Playwright не запускать — сценарий выполняет CI.

- [ ] **Step 3: Commit** (после ревью и разрешения владельца)

```bash
git add e2e/envelope-v2-transfers-journal.spec.ts
git commit -m "test(e2e): перевод в журнале операций"
```

---

### Финальная проверка

- [ ] Run: `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test`
- [ ] Run: `pnpm test:integration` (нужен `pnpm infra:up`)
- [ ] Ревью по routing matrix: Financial (Task 1), Security (Tasks 1–3), API (Tasks 2–3), UI/UX (Tasks 5–7), QA, Final.
- [ ] Инспекция итогового diff: `git diff main...HEAD --stat`.
