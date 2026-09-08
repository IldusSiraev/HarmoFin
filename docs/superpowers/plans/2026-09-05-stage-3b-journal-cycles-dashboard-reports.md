# Stage 3b — Implementation Plan

> **Для agentic workers:** выполняйте inline строго по одному Task. После каждого Task остановитесь и ждите явного подтверждения пользователя. Не используйте subagents или worktree.

**Goal:** Завершить жизненный цикл операций, cycles/periods, полный journal, server dashboard summary и отчёты Stage 3b без нарушения финансовых инвариантов Stage 3a/4.

**Architecture:** Добавить additive persistence для restore metadata и period slots. Cycle calculations будут pure server domain service; lifecycle, journal, dashboard и reports используют budget-scoped PostgreSQL queries и existing transaction/financial-balance boundaries. Web получает typed API responses и никогда не вычисляет денежные итоги.

**Tech Stack:** TypeScript strict, NestJS/Fastify, Prisma/PostgreSQL, Zod, Swagger/OpenAPI, Vue 3/Nuxt 4, Vitest, Supertest, ECharts, Playwright CI.

**Spec:** `docs/superpowers/specs/2026-09-05-stage-3b-journal-cycles-dashboard-reports-design.md`

## Global Constraints

- Read `CLAUDE.md`, Stage 3b design, functional specification sections 9, 14.2–14.4, 14.7 and 16, and development specification sections 5.2–5.5 and 6 before each affected milestone.
- Add only migration `20260906000000_stage_3b_lifecycle_cycles`; never modify migrations Stage 1–4.
- Use PostgreSQL `BIGINT` and decimal-safe backend handling; API amounts are decimal strings and responses use canonical integer strings.
- Only `CONFIRMED` records affect account/envelope balances, limits, summary or reports.
- Every user-data repository query filters active membership, `workspace_id` path and `budget_id` in SQL. Foreign object IDs return `404 RESOURCE_NOT_FOUND`.
- `OWNER` and `EDITOR` may change operations; only `OWNER` may restore and view deleted/audit history. `VIEWER` receives `403` for mutations.
- Every financial mutation requires and reuses one `Idempotency-Key`; frontend retries never generate a new key.
- Financial mutations lock affected transaction, account, envelope, income and allocation subjects in deterministic order inside one database transaction.
- Controllers do not access Prisma or calculate money. Document every new/changed route, request, response and Problem Details outcome in OpenAPI.
- Audit payloads include only allowlisted structural fields, never comment, source description, merchant/recipient or other sensitive free text.
- Keep Russian UI and user-facing errors. Do not run Playwright locally; add E2E scenarios for CI only.
- Do not add transfer edit/restore, plans, notifications, worker jobs, imports, export, multi-currency conversion, billing, AI, collaboration or deployment work.

---

### Task 1: Add Stage 3b persistence and period-slot contract

**Files:**
- Modify: `prisma/schema.prisma:52-59,243-269,272-338`
- Create: `prisma/migrations/20260906000000_stage_3b_lifecycle_cycles/migration.sql`
- Modify: `apps/api/src/budgets/budget.repository.ts:367-374`
- Modify: `apps/api/src/envelopes/envelope.schemas.ts`
- Modify: `apps/api/src/envelopes/envelope.dto.ts`
- Modify: `apps/api/src/envelopes/envelope.application.service.ts`
- Modify: `apps/api/src/envelopes/envelope.repository.ts`
- Modify: `apps/web/app/composables/useBudgetReferenceData.ts`
- Modify: `apps/web/app/pages/app/envelopes.vue`
- Modify: `apps/api/src/envelopes/envelope.application.service.test.ts`
- Modify: `apps/web/app/pages/app/envelopes.test.ts`
- Create: `apps/api/test/stage-3b.migration.integration.test.ts`

**Interfaces:**
- Consumes existing `TransactionStatus`, `IncomeAllocationStatus`, `EnvelopeType`, active reference-data policies and `FinancialBalanceRepository`.
- Produces `PeriodSlot = FIRST | SECOND`; `EnvelopeView.periodSlot: PeriodSlot | null`; nullable `Transaction.preDeleteStatus` and `IncomeAllocation.preDeleteStatus`; `UpdateEnvelopeInput.periodSlot?: PeriodSlot | null`.
- `EnvelopeApplicationService.update()` atomically permits a slot only for an active `CURRENT_EXPENSES` envelope and rejects a conflict with `409 PERIOD_SLOT_ALREADY_ASSIGNED`.

- [ ] **Step 1: Write failing persistence and service tests**

```ts
it('assigns template current envelopes to distinct period slots', async () => {
  await budgetService.initializeReferenceTemplate(ownerId, budgetId);
  const envelopes = await envelopeService.list(ownerId, budgetId, 'active');
  expect(envelopes.find((item) => item.templateKey === 'envelope-current-10-24')?.periodSlot)
    .toBe('FIRST');
  expect(envelopes.find((item) => item.templateKey === 'envelope-current-25-9')?.periodSlot)
    .toBe('SECOND');
});

it('rejects a second active envelope for the same period slot', async () => {
  await service.update(ownerId, budgetId, first.id, { periodSlot: 'FIRST' });
  await expect(service.update(ownerId, budgetId, second.id, { periodSlot: 'FIRST' }))
    .rejects.toMatchObject({ response: { code: 'PERIOD_SLOT_ALREADY_ASSIGNED' } });
});
```

Migration integration must assert:

```ts
await expect(db.$executeRawUnsafe(`
  UPDATE "envelopes" SET "period_slot" = 'FIRST'
  WHERE "id" = '${mandatoryEnvelopeId}'
`)).rejects.toThrow();

await expect(db.$executeRawUnsafe(`
  UPDATE "transactions"
  SET "status" = 'DELETED', "pre_delete_status" = NULL
  WHERE "id" = '${transactionId}'
`)).rejects.toThrow();
```

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```bash
pnpm --filter @harmofin/api exec vitest run --config vitest.config.ts src/envelopes/envelope.application.service.test.ts
pnpm --filter @harmofin/web exec vitest run --config vitest.config.ts app/pages/app/envelopes.test.ts
pnpm --filter @harmofin/api exec vitest run --config vitest.integration.config.ts test/stage-3b.migration.integration.test.ts
```

Expected: FAIL because Prisma models, migration, `periodSlot` DTO fields and UI control do not exist.

- [ ] **Step 3: Add schema, migration and period-slot rules**

Add Prisma enum and fields:

```prisma
enum PeriodSlot {
  FIRST
  SECOND
}

model Envelope {
  // existing fields
  periodSlot PeriodSlot? @map("period_slot")
}

model Transaction {
  // existing fields
  preDeleteStatus TransactionStatus? @map("pre_delete_status")
}

model IncomeAllocation {
  // existing fields
  preDeleteStatus IncomeAllocationStatus? @map("pre_delete_status")
}
```

Migration requirements:

```sql
CREATE TYPE "PeriodSlot" AS ENUM ('FIRST', 'SECOND');

ALTER TABLE "envelopes" ADD COLUMN "period_slot" "PeriodSlot";
ALTER TABLE "transactions" ADD COLUMN "pre_delete_status" "TransactionStatus";
ALTER TABLE "income_allocations" ADD COLUMN "pre_delete_status" "IncomeAllocationStatus";

ALTER TABLE "envelopes" ADD CONSTRAINT "envelopes_period_slot_current_expenses_check"
  CHECK ("period_slot" IS NULL OR "envelope_type" = 'CURRENT_EXPENSES');
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_pre_delete_status_check"
  CHECK (("status" = 'DELETED') = ("pre_delete_status" IS NOT NULL));
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_pre_delete_status_value_check"
  CHECK ("pre_delete_status" IS NULL OR "pre_delete_status" IN ('DRAFT', 'CONFIRMED', 'CANCELLED'));
CREATE UNIQUE INDEX "envelopes_active_period_slot_key"
  ON "envelopes" ("budget_id", "period_slot")
  WHERE "archived_at" IS NULL AND "period_slot" IS NOT NULL;
```

Set `FIRST` and `SECOND` for existing template keys in migration. Update default template tuple data so newly initialized budgets get same slots. Extend envelope input/output/client/page with select options `Не относится к периоду`, `Первый период`, `Второй период`; only show it for `CURRENT_EXPENSES` and clear it when type changes. Repository must query conflict inside its write transaction before update and return documented conflict.

- [ ] **Step 4: Run focused tests and migration**

Run:

```bash
pnpm db:generate
pnpm db:migrate
pnpm --filter @harmofin/api exec vitest run --config vitest.config.ts src/envelopes/envelope.application.service.test.ts
pnpm --filter @harmofin/api exec vitest run --config vitest.integration.config.ts test/stage-3b.migration.integration.test.ts
pnpm --filter @harmofin/web exec vitest run --config vitest.config.ts app/pages/app/envelopes.test.ts
pnpm --filter @harmofin/api typecheck
pnpm --filter @harmofin/web typecheck
```

Expected: PASS. Migration preserves Stage 1–4 data; only active current-expenses envelopes receive unique period slots.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260906000000_stage_3b_lifecycle_cycles apps/api/src/budgets/budget.repository.ts apps/api/src/envelopes apps/api/test/stage-3b.migration.integration.test.ts apps/web/app/composables/useBudgetReferenceData.ts apps/web/app/pages/app/envelopes.vue apps/web/app/pages/app/envelopes.test.ts
git diff --cached --check
git commit -m "feat: add period slots and lifecycle metadata"
```

### Task 2: Implement transaction and allocation restore lifecycle

**Files:**
- Modify: `apps/api/src/transactions/transaction.schemas.ts`
- Modify: `apps/api/src/transactions/transaction.dto.ts`
- Modify: `apps/api/src/transactions/transaction.repository.ts`
- Modify: `apps/api/src/transactions/transaction.application.service.ts`
- Modify: `apps/api/src/transactions/transaction.controller.ts`
- Modify: `apps/api/src/transactions/transaction.module.ts`
- Modify: `apps/api/src/allocations/income-allocation.repository.ts`
- Modify: `apps/api/src/allocations/income-allocation.application.service.ts`
- Modify: `apps/api/src/allocations/income-allocation.controller.ts`
- Modify: `apps/api/src/allocations/income-allocation.dto.ts`
- Modify: `apps/api/src/transactions/transaction.application.service.test.ts`
- Modify: `apps/api/src/allocations/income-allocation.application.service.test.ts`

**Interfaces:**
- Consumes `IdempotencyService`, `FinancialBalanceRepository`, transaction/allocations repositories, active reference validation and audit allowlists.
- Produces `TransactionApplicationService.restore()`, `.deleteWithAllocations()` and `IncomeAllocationApplicationService.restore()`.
- Produces routes:

```text
POST /api/v1/budgets/:budgetId/transactions/:transactionId/restore
POST /api/v1/budgets/:budgetId/transactions/:transactionId/delete-with-allocations
POST /api/v1/budgets/:budgetId/allocations/:allocationId/restore
```

- `deleteWithAllocations` body is `{ allocationResolution: 'CANCEL' | 'DELETE' }` and only accepts confirmed income with confirmed allocations.

- [ ] **Step 1: Write failing lifecycle tests**

```ts
it('restores a deleted confirmed expense to confirmed state', async () => {
  const deleted = await service.delete(ownerId, budgetId, expense.id, 'delete-key');
  expect(deleted.status).toBe('DELETED');

  const restored = await service.restore(ownerId, budgetId, expense.id, 'restore-key');
  expect(restored.status).toBe('CONFIRMED');
  expect(restored.deletedAt).toBeNull();
});

it('rejects deleting confirmed income with confirmed allocations without resolution', async () => {
  await expect(service.delete(ownerId, budgetId, income.id, 'delete-key')).rejects.toMatchObject({
    response: { code: 'INCOME_HAS_CONFIRMED_ALLOCATIONS' },
  });
});

it('deletes linked allocations and income atomically with one resolution intent', async () => {
  const result = await service.deleteWithAllocations(ownerId, budgetId, income.id, {
    allocationResolution: 'DELETE',
  }, 'resolution-key');
  expect(result.status).toBe('DELETED');
  expect(await allocations.listForIncome(ownerId, budgetId, income.id)).toEqual(
    expect.arrayContaining([expect.objectContaining({ status: 'DELETED' })]),
  );
});
```

Cover confirmed update capacity after changed account/envelope/amount, deletion pre-status, restore active references, allocation cap, source confirmed state, owner/editor/viewer matrix, duplicate replay and same-key conflict.

- [ ] **Step 2: Run unit tests and verify failure**

Run:

```bash
pnpm --filter @harmofin/api exec vitest run --config vitest.config.ts src/transactions/transaction.application.service.test.ts src/allocations/income-allocation.application.service.test.ts
```

Expected: FAIL because restore/resolution APIs and state metadata handling do not exist.

- [ ] **Step 3: Implement state machine, locks and documented HTTP contract**

Implement lifecycle guard with exact allowed transitions:

```ts
function restoredStatus(value: TransactionStatus | null): 'DRAFT' | 'CONFIRMED' | 'CANCELLED' {
  if (value === 'DRAFT' || value === 'CONFIRMED' || value === 'CANCELLED') return value;
  throw invalidTransactionState();
}
```

Repository operations must:

1. acquire `FOR UPDATE` on transaction then involved financial subjects sorted by UUID;
2. store `preDeleteStatus` before deletion;
3. validate restored/updated confirmed references and capacity while locks held;
4. update lifecycle fields and actor in one transaction;
5. write allowlisted audit events for every transaction and affected allocation.

For resolution, lock income and confirmed allocations; reject a non-income/non-confirmed source; cancel/delete every confirmed allocation according to body; then delete income. `restore()` requires `OWNER`; edit/delete resolution accept `OWNER`/`EDITOR`; use unique idempotency operation strings per action and target. Add Zod schemas, Swagger DTOs, CSRF guards, Problem Details statuses and controller delegation only.

- [ ] **Step 4: Run focused tests and typecheck**

Run:

```bash
pnpm --filter @harmofin/api exec vitest run --config vitest.config.ts src/transactions/transaction.application.service.test.ts src/allocations/income-allocation.application.service.test.ts
pnpm --filter @harmofin/api typecheck
```

Expected: PASS. Restore returns exact state, no inactive/foreign reference can activate, and resolution leaves no partial rows.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/transactions apps/api/src/allocations
git diff --cached --check
git commit -m "feat: add operation restore lifecycle"
```

### Task 3: Verify lifecycle through real PostgreSQL API

**Files:**
- Modify: `apps/api/test/operations.integration.test.ts`
- Create: `apps/api/test/transaction-lifecycle.integration.test.ts`

**Interfaces:**
- Consumes Stage 3b lifecycle HTTP routes and real migration.
- Produces PostgreSQL evidence for public API behavior, role/budget isolation, audit safety, idempotency and financial rollback.

- [ ] **Step 1: Write failing Supertest scenarios**

```ts
const restored = await request(app)
  .post(`/api/v1/budgets/${budgetId}/transactions/${transactionId}/restore`)
  .set(authHeaders(owner))
  .set('Idempotency-Key', 'restore-confirmed-income')
  .send()
  .expect(200);

expect(restored.body.status).toBe('CONFIRMED');
expect(restored.body.deletedAt).toBeNull();
```

Add cases for editor rejected on restore, viewer rejected on all mutations, foreign IDs returning `404`, archive/reference rejection during restore, update below confirmed allocation total, delete income conflict data, successful `CANCEL` and `DELETE` resolution, transaction rollback when one allocation cannot change, replay/body conflict and audit values excluding `comment`, `sourceDescription`, `merchantName`.

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
pnpm --filter @harmofin/api exec vitest run --config vitest.integration.config.ts test/transaction-lifecycle.integration.test.ts
```

Expected: FAIL until application routes run against migrated PostgreSQL and all authorization/state cases are wired.

- [ ] **Step 3: Fix only integration-exposed production boundaries**

Correct repository predicates, locks, transaction scope, response DTO/OpenAPI metadata, error codes or audit allowlists exposed by scenarios. Do not mock PostgreSQL, weaken capacity checks or bypass CSRF/session guards.

- [ ] **Step 4: Run lifecycle and regression integration suites**

Run:

```bash
pnpm db:migrate
pnpm --filter @harmofin/api exec vitest run --config vitest.integration.config.ts test/transaction-lifecycle.integration.test.ts test/operations.integration.test.ts test/transfers.integration.test.ts
```

Expected: PASS. Existing confirmed transaction/allocation/transfer behavior remains unchanged except documented lifecycle additions.

- [ ] **Step 5: Commit**

```bash
git add apps/api/test/transaction-lifecycle.integration.test.ts apps/api/test/operations.integration.test.ts apps/api/src
git diff --cached --check
git commit -m "test: cover operation lifecycle API"
```

### Task 4: Add pure cycle and period domain service

**Files:**
- Create: `apps/api/src/cycles/cycle-period.domain.ts`
- Create: `apps/api/src/cycles/cycle-period.domain.test.ts`
- Create: `apps/api/src/cycles/cycle.dto.ts`
- Create: `apps/api/src/cycles/cycle.schemas.ts`
- Create: `apps/api/src/cycles/cycle.repository.ts`
- Create: `apps/api/src/cycles/cycle.application.service.ts`
- Create: `apps/api/src/cycles/cycle.controller.ts`
- Create: `apps/api/src/cycles/cycle.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Create: `apps/api/test/cycles.integration.test.ts`

**Interfaces:**
- Consumes budget settings `{ cycleStartDay, periodBoundaryOffset, timezone }` and active budget access query.
- Produces:

```ts
export type CycleRange = { start: string; end: string };
export type PeriodRange = { id: 'FIRST' | 'SECOND'; start: string; end: string };
export function cycleAndPeriodFor(settings: CycleSettings, date: string): {
  cycle: CycleRange;
  period: PeriodRange;
  daysUntilNextBoundary: number;
};
```

- Produces `GET /api/v1/budgets/:budgetId/cycles/current` and `GET /api/v1/budgets/:budgetId/cycles?date=YYYY-MM-DD`.

- [ ] **Step 1: Write table-driven failing domain tests**

```ts
it.each([
  ['2026-08-24', '2026-08-10', '2026-09-09', 'FIRST', '2026-08-10', '2026-08-24'],
  ['2026-08-25', '2026-08-10', '2026-09-09', 'SECOND', '2026-08-25', '2026-09-09'],
  ['2026-09-09', '2026-08-10', '2026-09-09', 'SECOND', '2026-08-25', '2026-09-09'],
  ['2026-09-10', '2026-09-10', '2026-10-09', 'FIRST', '2026-09-10', '2026-09-24'],
])('%s resolves configured cycle and period', (date, cycleStart, cycleEnd, id, periodStart, periodEnd) => {
  expect(cycleAndPeriodFor(settings, date)).toMatchObject({
    cycle: { start: cycleStart, end: cycleEnd },
    period: { id, start: periodStart, end: periodEnd },
  });
});
```

Add leap-year, February/month-end, year rollover, `Europe/Moscow` boundary and invalid settings tests.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm --filter @harmofin/api exec vitest run --config vitest.config.ts src/cycles/cycle-period.domain.test.ts
pnpm --filter @harmofin/api exec vitest run --config vitest.integration.config.ts test/cycles.integration.test.ts
```

Expected: FAIL because cycle module and routes do not exist.

- [ ] **Step 3: Implement date-only domain logic and read contract**

Use calendar dates in budget timezone; never parse user date via browser timezone. Implement dates by constructing `YYYY-MM-DD` and applying calendar increments. Validate `cycleStartDay` within `1..28` and `periodBoundaryOffset` within `1..cycleLength - 1`. `current` derives `asOf` server date in budget timezone. Repository reads only active accessible budget settings; controller only maps validated query to service.

- [ ] **Step 4: Run unit/integration tests and typecheck**

Run:

```bash
pnpm --filter @harmofin/api exec vitest run --config vitest.config.ts src/cycles/cycle-period.domain.test.ts
pnpm --filter @harmofin/api exec vitest run --config vitest.integration.config.ts test/cycles.integration.test.ts
pnpm --filter @harmofin/api typecheck
```

Expected: PASS. Boundary dates are timezone-stable and cross-budget route IDs return `404`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/cycles apps/api/src/app.module.ts apps/api/test/cycles.integration.test.ts
git diff --cached --check
git commit -m "feat: add financial cycle projections"
```

### Task 5: Add complete journal query and owner audit API

**Files:**
- Create: `apps/api/src/audit/audit.dto.ts`
- Create: `apps/api/src/audit/audit.repository.ts`
- Create: `apps/api/src/audit/audit.application.service.ts`
- Create: `apps/api/src/audit/audit.controller.ts`
- Create: `apps/api/src/audit/audit.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/transactions/transaction.schemas.ts`
- Modify: `apps/api/src/transactions/transaction.dto.ts`
- Modify: `apps/api/src/transactions/transaction.repository.ts`
- Modify: `apps/api/src/transactions/transaction.application.service.ts`
- Modify: `apps/api/src/transactions/transaction.controller.ts`
- Modify: `apps/api/src/transactions/transaction.repository.test.ts`
- Create: `apps/api/test/journal.integration.test.ts`

**Interfaces:**
- Consumes `cycleAndPeriodFor`, current financial rows and active membership SQL predicates.
- Extends `ListTransactionsInput`:

```ts
type TransactionListInput = {
  limit: number;
  cursor?: string;
  search?: string;
  from?: string;
  to?: string;
  cycleStart?: string;
  periodStart?: string;
  accountId?: string;
  categoryId?: string;
  envelopeId?: string;
  type?: 'INCOME' | 'EXPENSE';
  status?: 'DRAFT' | 'CONFIRMED' | 'CANCELLED' | 'DELETED' | 'all';
  sortBy?: 'occurredOn' | 'amount';
  sortDirection?: 'asc' | 'desc';
};
```

- Produces owner-only `GET /budgets/:budgetId/transactions/:transactionId/audit` and detail allocation data without leaking sensitive audit values.

- [ ] **Step 1: Write failing query/audit tests**

```ts
const result = await service.list(ownerId, budgetId, {
  search: 'market',
  cycleStart: '2026-08-10',
  periodStart: '2026-08-25',
  accountId,
  sortBy: 'amount',
  sortDirection: 'asc',
  limit: 2,
});

expect(result.items.map((item) => item.id)).toEqual([smallerExpense.id, largerExpense.id]);
expect(result.nextCursor).toEqual(expect.any(String));
```

Add tests for each filter, AND composition, `ILIKE` source/merchant match, date range, stable cursor across equal amounts/dates, invalid base64/shape/sort mismatch cursor, foreign filter ID `404`, deleted default exclusion, owner-only deleted/all and audit access. Assert audit values never contain text fields.

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
pnpm --filter @harmofin/api exec vitest run --config vitest.config.ts src/transactions/transaction.repository.test.ts
pnpm --filter @harmofin/api exec vitest run --config vitest.integration.config.ts test/journal.integration.test.ts
```

Expected: FAIL because filters, cursor version validation and audit routes are absent.

- [ ] **Step 3: Implement budget-scoped journal and audit repositories**

Create cursor type and strict decoding before query:

```ts
type JournalCursor = {
  v: 1;
  sortBy: 'occurredOn' | 'amount';
  sortDirection: 'asc' | 'desc';
  value: string;
  createdAt: string;
  id: string;
};
```

Build matching lexicographic predicates for both sortable fields/directions with `createdAt` then `id` tie breakers. Use SQL or Prisma conditions with `budgetId` and active membership in the query. Validate each optional ID with budget-scoped `findFirst` before main query. Resolve cycle/period to date ranges via cycles service. Audit repository must select only `id`, `createdAt`, actor display identity, entity identity/action/source and already allowlisted JSON values; filter entity and budget in SQL.

- [ ] **Step 4: Run server tests and typecheck**

Run:

```bash
pnpm --filter @harmofin/api exec vitest run --config vitest.config.ts src/transactions/transaction.repository.test.ts
pnpm --filter @harmofin/api exec vitest run --config vitest.integration.config.ts test/journal.integration.test.ts
pnpm --filter @harmofin/api typecheck
```

Expected: PASS. Pagination is stable, malformed input returns `400 VALIDATION_FAILED`, and no non-owner sees deleted/audit data.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/audit apps/api/src/transactions apps/api/src/app.module.ts apps/api/test/journal.integration.test.ts
git diff --cached --check
git commit -m "feat: add filtered operations journal API"
```

### Task 6: Add lifecycle actions and complete journal web UI

**Files:**
- Modify: `apps/web/app/composables/useBudgetReferenceData.ts`
- Modify: `apps/web/app/composables/useOperationForm.ts`
- Modify: `apps/web/app/composables/useOperationForm.test.ts`
- Modify: `apps/web/app/components/operations/OperationForm.vue`
- Create: `apps/web/app/components/operations/OperationDetails.vue`
- Create: `apps/web/app/components/operations/OperationDetails.test.ts`
- Modify: `apps/web/app/pages/app/operations.vue`
- Modify: `apps/web/app/pages/app/operations.test.ts`
- Modify: `apps/web/app/pages/app/accounts.vue`
- Modify: `apps/web/app/pages/app/accounts.test.ts`
- Modify: `apps/web/app/pages/app/envelopes.vue`
- Modify: `apps/web/app/pages/app/envelopes.test.ts`

**Interfaces:**
- Consumes extended `TransactionDto`, `TransactionListInput`, allocation/audit DTOs, `ApiRequestError`, `UiConfirmDialog`, `OperationForm` and server cursor responses.
- Produces methods `restoreTransaction`, `deleteTransactionWithAllocations`, `restoreIncomeAllocation`, `listTransactionAudit` and `listTransactionAllocations`.
- `createOperationForm(current)` preloads editable values; `toUpdateTransactionInput(model, confirmed)` returns only valid changed request fields with `{ confirm: true }` for confirmed edit.

- [ ] **Step 1: Write failing web tests**

```ts
it('preloads edit form and confirms confirmed-operation update', async () => {
  await wrapper.get('[data-action="edit-operation"]').trigger('click');
  expect(wrapper.get('input[name="amount"]').element.value).toBe('1250.00');

  await wrapper.get('[data-action="save-operation"]').trigger('click');
  expect(wrapper.getComponent(UiConfirmDialog).props('open')).toBe(true);
  await wrapper.getComponent(UiConfirmDialog).vm.$emit('confirm');
  expect(api.updateTransaction).toHaveBeenCalledWith(budgetId, transaction.id, expect.objectContaining({ confirm: true }), expect.any(String));
});

it('does not apply stale filtered-journal response', async () => {
  firstRequest.resolve(oldResult);
  secondRequest.resolve(newResult);
  await flushPromises();
  expect(wrapper.text()).toContain('Новая операция');
  expect(wrapper.text()).not.toContain('Старая операция');
});
```

Cover URL hydrate/reset, all controls, exact Problem Details field mapping and accessible summary, detail allocations, owner audit, delete resolution dialog, owner restore, retry preserving original key, mobile class layout and encoded account/envelope journal links.

- [ ] **Step 2: Run web tests and verify failure**

Run:

```bash
pnpm --filter @harmofin/web exec vitest run --config vitest.config.ts app/composables/useOperationForm.test.ts app/components/operations/OperationDetails.test.ts app/pages/app/operations.test.ts app/pages/app/accounts.test.ts app/pages/app/envelopes.test.ts
```

Expected: FAIL because edit lifecycle actions, details, URL-complete filters and stale-response protection are missing.

- [ ] **Step 3: Implement typed client, form modes and journal behavior**

Implement request coordination without relying on request timing:

```ts
let requestVersion = 0;
async function load(append = false) {
  const version = ++requestVersion;
  const result = await api.listTransactions(budgetId, query);
  if (version !== requestVersion) return;
  transactions.value = append ? [...transactions.value, ...result.items] : result.items;
}
```

Parse `route.query` into validated local filter state and update URL with `navigateTo({ query }, { replace: true })`; reset removes all journal keys. Debounce search only. Add accessible sort buttons with `aria-sort`, filter labels, active reset and one-column responsive CSS. `OperationDetails` renders role-allowed allocation and audit records. All confirmation submit handlers create one UUID before request and retain it until success/error retry; reload API state after every mutation.

- [ ] **Step 4: Run web tests and typecheck**

Run:

```bash
pnpm --filter @harmofin/web exec vitest run --config vitest.config.ts app/composables/useOperationForm.test.ts app/components/operations/OperationDetails.test.ts app/pages/app/operations.test.ts app/pages/app/accounts.test.ts app/pages/app/envelopes.test.ts
pnpm --filter @harmofin/web typecheck
```

Expected: PASS. Client has no balance math, actions use confirmation and stale API results cannot replace current filter state.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/composables/useBudgetReferenceData.ts apps/web/app/composables/useOperationForm.ts apps/web/app/composables/useOperationForm.test.ts apps/web/app/components/operations apps/web/app/pages/app/operations.vue apps/web/app/pages/app/operations.test.ts apps/web/app/pages/app/accounts.vue apps/web/app/pages/app/accounts.test.ts apps/web/app/pages/app/envelopes.vue apps/web/app/pages/app/envelopes.test.ts
git diff --cached --check
git commit -m "feat: complete operations journal interface"
```

### Task 7: Implement server dashboard summary

**Files:**
- Create: `apps/api/src/dashboard/dashboard.dto.ts`
- Create: `apps/api/src/dashboard/dashboard.repository.ts`
- Create: `apps/api/src/dashboard/dashboard.application.service.ts`
- Create: `apps/api/src/dashboard/dashboard.controller.ts`
- Create: `apps/api/src/dashboard/dashboard.module.ts`
- Create: `apps/api/src/dashboard/dashboard.application.service.test.ts`
- Modify: `apps/api/src/app.module.ts`
- Create: `apps/api/test/dashboard-summary.integration.test.ts`

**Interfaces:**
- Consumes `cycleAndPeriodFor`, `FinancialBalanceRepository`, active budget/references and confirmed transaction/allocation/transfer rows.
- Produces `GET /api/v1/budgets/:budgetId/summary` and response:

```ts
type DashboardSummary = {
  cycle: CycleRange;
  period: PeriodRange;
  totalAccountMoneyMinor: string;
  accounts: AccountBalanceView[];
  envelopes: EnvelopeBalanceView[];
  unallocatedIncomeMinor: string;
  periodLimit: { state: 'available'; envelopeId: string; limitMinor: string; spentMinor: string; remainingMinor: string; daysUntilBoundary: number; averageRemainingDailyLimitMinor: string } | { state: 'unavailable' };
  warnings: Array<{ subject: 'ACCOUNT' | 'ENVELOPE'; id: string; balanceMinor: string }>;
};
```

- [ ] **Step 1: Write failing summary calculation tests**

```ts
it('uses opening balance, confirmed allocations and reallocation, never planned income', async () => {
  await createConfirmedAllocation({ envelopeId: firstPeriodEnvelope.id, amountMinor: 10_000n, occurredOn: '2026-08-10' });
  await createConfirmedExpense({ envelopeId: firstPeriodEnvelope.id, amountMinor: 2_500n, occurredOn: '2026-08-11' });
  await createConfirmedReallocation({ destinationEnvelopeId: firstPeriodEnvelope.id, amountMinor: 500n, occurredOn: '2026-08-12' });
  await createDraftIncome({ amountMinor: 99_999n, occurredOn: '2026-08-12' });

  await expect(service.summary(ownerId, budgetId, '2026-08-12')).resolves.toMatchObject({
    periodLimit: { limitMinor: '10500', spentMinor: '2500', remainingMinor: '8000' },
  });
});
```

Cover missing slot state, opening balance carry-over, confirmed-only source data, transfer preservation neutrality, negative warnings, integer daily truncation, archived data history and foreign budget isolation.

- [ ] **Step 2: Run summary tests and verify failure**

Run:

```bash
pnpm --filter @harmofin/api exec vitest run --config vitest.config.ts src/dashboard/dashboard.application.service.test.ts
pnpm --filter @harmofin/api exec vitest run --config vitest.integration.config.ts test/dashboard-summary.integration.test.ts
```

Expected: FAIL because dashboard module and summary route do not exist.

- [ ] **Step 3: Implement server-only summary projections**

Calculate date ranges with cycles domain service. In repository, use one transaction and confirmed-only SQL aggregates. Compute slot opening balance from all confirmed movements strictly before period start; add allocations and only transfer parts with different source/destination envelope from period start through `asOf`; calculate period expenses separately. Sum server-derived account and envelope balances; calculate unallocated income as confirmed income minus confirmed allocations. Use integer division helper with explicit truncation toward zero. Do not persist results or trust browser date.

- [ ] **Step 4: Run summary unit/integration tests and typecheck**

Run:

```bash
pnpm --filter @harmofin/api exec vitest run --config vitest.config.ts src/dashboard/dashboard.application.service.test.ts
pnpm --filter @harmofin/api exec vitest run --config vitest.integration.config.ts test/dashboard-summary.integration.test.ts
pnpm --filter @harmofin/api typecheck
```

Expected: PASS. Response has only server-computed canonical strings and no draft/deleted data affects it.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/dashboard apps/api/src/app.module.ts apps/api/test/dashboard-summary.integration.test.ts
git diff --cached --check
git commit -m "feat: add server dashboard summary"
```

### Task 8: Implement bounded server reports

**Files:**
- Create: `apps/api/src/reports/report.schemas.ts`
- Create: `apps/api/src/reports/report.dto.ts`
- Create: `apps/api/src/reports/report.repository.ts`
- Create: `apps/api/src/reports/report.application.service.ts`
- Create: `apps/api/src/reports/report.controller.ts`
- Create: `apps/api/src/reports/report.module.ts`
- Create: `apps/api/src/reports/report.application.service.test.ts`
- Modify: `apps/api/src/app.module.ts`
- Create: `apps/api/test/reports.integration.test.ts`

**Interfaces:**
- Consumes cycle ranges, server confirmed financial records and budget-scoped reference filters.
- Produces `GET /api/v1/budgets/:budgetId/reports/:reportKey` for:

```ts
type ReportKey =
  | 'expenses-by-category'
  | 'expenses-by-period'
  | 'expenses-by-cycle'
  | 'incomes-by-cycle'
  | 'savings-reallocation-by-cycle'
  | 'net-cash-flow'
  | 'account-balances'
  | 'envelope-balances'
  | 'savings-goals';
```

- Each row contains canonical `BIGINT` strings, dimension labels/IDs and `journalFilters` matching source records.

- [ ] **Step 1: Write failing report tests**

```ts
const report = await service.get(ownerId, budgetId, 'net-cash-flow', {
  from: '2026-08-10',
  to: '2026-09-09',
});

expect(report.rows).toEqual([
  expect.objectContaining({ incomeMinor: '10000', expenseMinor: '2500', netCashFlowMinor: '7500' }),
]);
```

Add one representative aggregate for every key. Assert draft/deleted rows excluded; transfers excluded from income/expense/net flow; only changed-envelope transfer parts appear in savings/reallocation; all filters are AND-ed and budget isolated; row journal filters reproduce source list.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm --filter @harmofin/api exec vitest run --config vitest.config.ts src/reports/report.application.service.test.ts
pnpm --filter @harmofin/api exec vitest run --config vitest.integration.config.ts test/reports.integration.test.ts
```

Expected: FAIL because reports module, schemas and aggregate queries do not exist.

- [ ] **Step 3: Implement filter validation and report aggregates**

Validate report key, bounded date range (maximum 36 calendar months), `RUB`, and each budget-scoped optional ID. Use one query builder per source type with base condition `budget_id`, confirmed status and requested time/reference filters. Aggregate with PostgreSQL `SUM(... )::BIGINT`; cycle/period group keys derive through cycle service date ranges, not stored memberships. For balance history, return end-of-date-bucket server projections. For goals, return target/current/progress numerator values, not floating percentage as source of truth.

- [ ] **Step 4: Run tests and typecheck**

Run:

```bash
pnpm --filter @harmofin/api exec vitest run --config vitest.config.ts src/reports/report.application.service.test.ts
pnpm --filter @harmofin/api exec vitest run --config vitest.integration.config.ts test/reports.integration.test.ts
pnpm --filter @harmofin/api typecheck
```

Expected: PASS. Reports have no cross-budget rows and preserve transfer neutrality rules.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/reports apps/api/src/app.module.ts apps/api/test/reports.integration.test.ts
git diff --cached --check
git commit -m "feat: add financial reports API"
```

### Task 9: Build protected dashboard page

**Files:**
- Modify: `apps/web/app/composables/useBudgetReferenceData.ts`
- Create: `apps/web/app/components/dashboard/PeriodLimitCard.vue`
- Create: `apps/web/app/components/dashboard/PeriodLimitCard.test.ts`
- Create: `apps/web/app/components/dashboard/BalanceList.vue`
- Create: `apps/web/app/components/dashboard/BalanceList.test.ts`
- Modify: `apps/web/app/pages/app/index.vue`
- Create: `apps/web/app/pages/app/index.test.ts`

**Interfaces:**
- Consumes `DashboardSummary` typed client method `getDashboardSummary(budgetId)`.
- Produces protected `/app` dashboard with no financial arithmetic in Vue.

- [ ] **Step 1: Write failing dashboard tests**

```ts
it('renders summary values returned by server', async () => {
  api.getDashboardSummary.mockResolvedValue(summary);
  const wrapper = mount(DashboardPage);
  await flushPromises();

  expect(wrapper.text()).toContain('Остаток: 8 000,00 ₽');
  expect(wrapper.text()).toContain('До следующей границы: 12 дней');
});

it('renders unavailable period limit without guessing value', async () => {
  api.getDashboardSummary.mockResolvedValue({ ...summary, periodLimit: { state: 'unavailable' } });
  const wrapper = mount(DashboardPage);
  await flushPromises();
  expect(wrapper.text()).toContain('Конверт текущего периода не настроен');
});
```

Cover loading, transport error/retry, empty account/envelope lists, negative warnings with text/icon, mobile layout and dashboard navigation.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm --filter @harmofin/web exec vitest run --config vitest.config.ts app/components/dashboard/PeriodLimitCard.test.ts app/components/dashboard/BalanceList.test.ts app/pages/app/index.test.ts
```

Expected: FAIL because summary client/types/components do not exist and current page is placeholder.

- [ ] **Step 3: Implement dashboard UI from response-only data**

Add typed client fetch. Replace placeholder copy with summary loading/error/empty/content states. `PeriodLimitCard` receives canonical minor strings and formats only for display; it does not add/subtract. `BalanceList` shows account/envelope name, formatted balance and negative warning text plus icon. Add navigation links to operations, accounts, envelopes and analytics. Use grid layout that collapses to one column under `47.9375rem`.

- [ ] **Step 4: Run dashboard tests and typecheck**

Run:

```bash
pnpm --filter @harmofin/web exec vitest run --config vitest.config.ts app/components/dashboard/PeriodLimitCard.test.ts app/components/dashboard/BalanceList.test.ts app/pages/app/index.test.ts
pnpm --filter @harmofin/web typecheck
```

Expected: PASS. Dashboard only renders server values and states are keyboard/screen-reader accessible.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/composables/useBudgetReferenceData.ts apps/web/app/components/dashboard apps/web/app/pages/app/index.vue apps/web/app/pages/app/index.test.ts
git diff --cached --check
git commit -m "feat: add budget dashboard"
```

### Task 10: Build reports and analytics UI

**Files:**
- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/web/app/composables/useBudgetReferenceData.ts`
- Create: `apps/web/app/components/analytics/ReportFilters.vue`
- Create: `apps/web/app/components/analytics/ReportFilters.test.ts`
- Create: `apps/web/app/components/analytics/ReportTable.vue`
- Create: `apps/web/app/components/analytics/ReportTable.test.ts`
- Create: `apps/web/app/components/analytics/ReportChart.vue`
- Create: `apps/web/app/components/analytics/ReportChart.test.ts`
- Create: `apps/web/app/pages/app/analytics.vue`
- Create: `apps/web/app/pages/app/analytics.test.ts`

**Interfaces:**
- Consumes typed `getReport(budgetId, key, filters)` API client, reference-data lists and server-provided `journalFilters`.
- Produces protected `/app/analytics`; filter URL state; table equivalent for every report; one chart per report purpose.
- Adds `echarts` as web dependency using lockfile-resolved version.

- [ ] **Step 1: Write failing analytics component/page tests**

```ts
it('uses server journal filters for report-row navigation', async () => {
  const wrapper = mount(ReportTable, { props: { rows: [row] } });
  expect(wrapper.get('[data-journal-link]').attributes('href'))
    .toContain('categoryId=category-id');
});

it('renders a table equivalent for category chart data', () => {
  const wrapper = mount(ReportChart, { props: { report: categoryReport } });
  expect(wrapper.get('table').text()).toContain('Продукты');
});
```

Cover loading/error/empty state, URL filter restoration, keyboard filters, chart selection per key, legend for multi-series, text/icon statuses and narrow responsive layout.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm --filter @harmofin/web exec vitest run --config vitest.config.ts app/components/analytics/ReportFilters.test.ts app/components/analytics/ReportTable.test.ts app/components/analytics/ReportChart.test.ts app/pages/app/analytics.test.ts
```

Expected: FAIL because analytics route/components/client and ECharts dependency do not exist.

- [ ] **Step 3: Add ECharts and implement accessible analytics**

Run only this dependency command:

```bash
pnpm --filter @harmofin/web add echarts
```

Implement chart selection: horizontal bar for `expenses-by-category`; single-series line/bar for cycle/period series; separate lines and legend for selected account/envelope balances; progress/numbers for goals. `ReportChart` creates a chart only after data exists, disposes it on unmount and renders `ReportTable` for equivalent data. No dual axes. Assign fixed entity colors by ID, use text legends/direct labels, never color alone. Use existing design tokens; validate any categorical palette in light/dark mode before chart code ships. Report rows navigate with `navigateTo({ path: '/app/operations', query: row.journalFilters })`.

- [ ] **Step 4: Run analytics tests, typecheck and build**

Run:

```bash
pnpm --filter @harmofin/web exec vitest run --config vitest.config.ts app/components/analytics/ReportFilters.test.ts app/components/analytics/ReportTable.test.ts app/components/analytics/ReportChart.test.ts app/pages/app/analytics.test.ts
pnpm --filter @harmofin/web typecheck
pnpm --filter @harmofin/web build
```

Expected: PASS. Every chart has table equivalent, filters work from URL and server remains aggregate authority.

- [ ] **Step 5: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/app/composables/useBudgetReferenceData.ts apps/web/app/components/analytics apps/web/app/pages/app/analytics.vue apps/web/app/pages/app/analytics.test.ts
git diff --cached --check
git commit -m "feat: add budget analytics"
```

### Task 11: Add CI-only browser coverage and final verification

**Files:**
- Create: `e2e/stage-3b.spec.ts`
- Modify: `e2e/playwright.config.ts` only if spec discovery requires it
- Modify: `docs/superpowers/specs/2026-09-05-stage-3b-journal-cycles-dashboard-reports-design.md` only for an approved design correction discovered by verification

**Interfaces:**
- Consumes real API/web, migrated PostgreSQL and completed Stage 3b routes.
- Produces CI browser scenarios; no local Playwright execution.

- [ ] **Step 1: Write Playwright scenarios without running them locally**

Add scenarios for:

```ts
test('owner edits, deletes and restores confirmed expense from journal', async ({ page }) => {
  await registerInitializeAndCreateConfirmedExpense(page);
  await page.goto('/app/operations');
  await page.getByRole('button', { name: 'Изменить' }).click();
  await page.getByLabel('Сумма').fill('1 250,00');
  await page.getByRole('button', { name: 'Сохранить изменения' }).click();
  await page.getByRole('button', { name: 'Подтвердить', exact: true }).click();
  await page.getByRole('button', { name: 'Удалить' }).click();
  await page.getByRole('button', { name: 'Подтвердить', exact: true }).click();
  await page.getByRole('button', { name: 'Восстановить' }).click();
  await page.getByRole('button', { name: 'Подтвердить', exact: true }).click();
  await expect(page.getByText('Подтверждённая')).toBeVisible();
});
```

Also cover income allocation resolution, journal filters/sort/reset/direct account/envelope link, owner audit history, summary values, analytics report-to-journal link, Escape/focus return and `375px` no horizontal overflow.

- [ ] **Step 2: Run all permitted local quality gates**

Do **not** run `pnpm test:e2e`, Playwright or manual local browser verification.

Run:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
docker compose -f infra/compose/local.yml config --quiet
pnpm db:migrate
```

Expected: every command exits `0`.

- [ ] **Step 3: Correct only failures exposed by permitted verification**

Use focused test reproduction for each failure. Preserve API compatibility, idempotency, budget isolation, server-owned finance and CI-only E2E restriction. Re-run failed command and then full permitted quality gate.

- [ ] **Step 4: Commit browser coverage and verified corrections**

```bash
git add e2e/stage-3b.spec.ts e2e/playwright.config.ts apps/api apps/web prisma docs/superpowers/specs/2026-09-05-stage-3b-journal-cycles-dashboard-reports-design.md
git diff --cached --check
git commit -m "test: cover Stage 3b flows"
```

---

## Plan Self-Review

- **Spec coverage:** Task 1 covers additive metadata/period slots. Tasks 2–3 cover lifecycle, atomic allocation resolution, audit payloads, roles, idempotency and real PostgreSQL behavior. Task 4 covers cycles/periods. Tasks 5–6 cover server/client journal and history. Tasks 7–10 cover summary, all report keys, dashboard and accessible analytics. Task 11 adds CI E2E and all permitted quality gates.
- **Placeholder scan:** No task defers behavior; migrations, routes, formulas, error codes, test cases, verification commands and commit scopes are specified.
- **Type consistency:** `PeriodSlot`, lifecycle service names, report keys, journal filters and dashboard response fields remain identical across producing and consuming tasks.
- **Execution gate:** Execute only Task 1 after explicit user confirmation. After its commit, report result and stop before Task 2.
