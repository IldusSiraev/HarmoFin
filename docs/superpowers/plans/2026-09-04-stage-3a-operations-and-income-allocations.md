# Stage 3a: Operations and Income Allocations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add server-confirmed income, expense and income-allocation operations without transfers, cycles, dashboard or reports.

**Architecture:** A new additive PostgreSQL/Prisma contract stores operations, allocations and durable idempotency outcomes. NestJS transaction and allocation modules own financial validation and transactional writes; repositories retain budget-scoped queries. Nuxt receives typed server DTOs through `useApiClient`, shows a journal and explicit confirmation/allocation flows, and never computes financial truth locally.

**Tech Stack:** Node.js 24.20.0, pnpm 11.24.0, TypeScript strict, NestJS 11, Fastify 5, Prisma 6, PostgreSQL 18, Zod 4, Nuxt 4, Vue 3, Vitest, Playwright.

**Spec:** [docs/superpowers/specs/2026-09-04-stage-3a-operations-and-income-allocations-design.md](../specs/2026-09-04-stage-3a-operations-and-income-allocations-design.md)

## Global Constraints

- Read the Stage 3a design plus functional and development specifications before changing implementation decisions.
- This is only Stage 3a: include incomes, expenses and income allocations; exclude transfers, cycles, periods, dashboard, reports, plans, notifications, worker jobs, imports, multi-currency, collaboration, AI, billing and deployment.
- New migration is additive. Do not modify `prisma/migrations/20260831000000_init` or Stage 2 migration.
- Store all monetary truth in PostgreSQL `BIGINT` and TypeScript `bigint`; API receives decimal strings and responds with canonical integer strings. Never use `Number`, `parseFloat` or floating-point arithmetic for money.
- MVP uses only `RUB` and scale `2`; monetary response values match `^-?\d+$`.
- Only `CONFIRMED` transactions and allocations affect account/envelope calculations. `DRAFT`, `CANCELLED` and `DELETED` records do not.
- Expense amount and allocation amount must be strictly positive. Allocation sum cannot exceed its confirmed income amount.
- Every financial user-data query filters `budget_id` in Prisma/SQL itself and verifies authenticated user, active workspace, active membership, active budget, role, object ownership and state.
- Cross-budget substitution returns `404 RESOURCE_NOT_FOUND`; accessible role without mutation permission returns `403 FORBIDDEN`.
- Every mutation, audit event and idempotency result runs in one database transaction.
- Unsafe endpoints require existing OriginGuard, SessionAuthGuard and CsrfGuard. `Idempotency-Key` is mandatory for all financial mutations.
- Audit allowlists identifiers, type, state, minor-unit amount, date and reference IDs only. Never audit comments, source descriptions, merchant data, raw payload, cookie, token or secret.
- UI shows only server-confirmed balances and allocation remainder; no optimistic financial calculations.
- User-facing UI and documentation use Russian; code identifiers, database/API names and schema use English.
- Maintain labels, field errors, keyboard control, visible two-tone focus, non-color-only state and 44px controls. Compact breakpoint is `<768px`.
- Do not modify or stage `identity/logo_description.png`.

---

## File Map

### Database and API common

- `prisma/schema.prisma` — Stage 3a enums, `Transaction`, `IncomeAllocation`, `IdempotencyRecord` and same-budget relations.
- `prisma/migrations/20260904000000_stage_3a_operations/migration.sql` — additive DDL, checks, composite foreign keys, indexes and uniqueness.
- `apps/api/src/common/idempotency/idempotency.service.ts` — transaction-local durable replay/fingerprint handling.
- `apps/api/src/common/idempotency/idempotency.service.test.ts` — replay, conflict and concurrent-key tests.
- `apps/api/src/common/finance/financial-balance.repository.ts` — `BIGINT` SQL/Prisma balance projections for accounts and envelopes.
- `apps/api/src/common/finance/financial-balance.repository.test.ts` — confirmed-only balance projections and overflow-safe output tests.
- `apps/api/src/accounts/account.repository.ts` — include server-computed current balance in account views after Stage 3a records exist.
- `apps/api/src/accounts/account.application.service.ts` — map current balance from projection rather than starting balance.
- `apps/api/src/envelopes/envelope.repository.ts` — include server-computed current balance in envelope views.
- `apps/api/src/envelopes/envelope.application.service.ts` — map current balance from projection rather than starting balance.

### Transaction and allocation API

- `apps/api/src/transactions/transaction.repository.ts` — scoped reads and atomic transaction state writes.
- `apps/api/src/transactions/transaction.application.service.ts` — income/expense state machine, confirmed financial invariants and rule proposal.
- `apps/api/src/transactions/transaction.schemas.ts` — strict list/create/update/mutation Zod schemas.
- `apps/api/src/transactions/transaction.dto.ts` — Swagger request/response DTOs.
- `apps/api/src/transactions/transaction.controller.ts` — guarded HTTP endpoints.
- `apps/api/src/transactions/transaction.module.ts` — Nest module factory.
- `apps/api/src/transactions/transaction.application.service.test.ts` — unit coverage for state and account/envelope rules.
- `apps/api/src/allocations/income-allocation.repository.ts` — scoped allocation persistence and sum locking/query.
- `apps/api/src/allocations/income-allocation.application.service.ts` — allocation invariants and generic proposal acceptance.
- `apps/api/src/allocations/income-allocation.schemas.ts` — strict Zod schemas.
- `apps/api/src/allocations/income-allocation.dto.ts` — Swagger DTOs.
- `apps/api/src/allocations/income-allocation.controller.ts` — guarded allocation routes.
- `apps/api/src/allocations/income-allocation.module.ts` — Nest module factory.
- `apps/api/src/allocations/income-allocation.application.service.test.ts` — sum/type/state/rule tests.
- `apps/api/src/app.module.ts` — register transaction and allocation modules.
- `apps/api/test/operations.integration.test.ts` — real PostgreSQL HTTP/OpenAPI/isolation/RBAC/idempotency coverage.

### Web

- `apps/web/app/composables/useBudgetReferenceData.ts` — transaction/allocation DTOs and API methods.
- `apps/web/app/composables/useBudgetReferenceData.test.ts` — operation paths, headers and decimal payload tests.
- `apps/web/app/composables/useOperationForm.ts` — operation form defaults, safe field mapping and proposal normalization.
- `apps/web/app/components/operations/OperationCard.vue` — presentation-only transaction row/card.
- `apps/web/app/components/operations/OperationForm.vue` — income/expense fields and explicit draft/confirm actions.
- `apps/web/app/components/operations/IncomeAllocationForm.vue` — explicit allocation proposal/accept/change/reject UI.
- `apps/web/app/components/operations/*.test.ts` — focused component behavior/accessibility tests.
- `apps/web/app/pages/app/operations.vue` — protected paginated journal and mutation orchestration.
- `apps/web/app/pages/app/operations.test.ts` — page loading, errors, field errors, status filters and server refresh tests.
- `e2e/reference-data.spec.ts` — preserve Stage 2 flows.
- `e2e/operations.spec.ts` — Stage 3a browser scenarios.

---

### Task 1: Add Stage 3a persistence contract

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260904000000_stage_3a_operations/migration.sql`
- Create: `apps/api/test/operations.migration.integration.test.ts`

**Interfaces:**
- Produces Prisma enums `TransactionType`, `TransactionStatus`, `IncomeAllocationStatus`.
- Produces models `Transaction`, `IncomeAllocation`, `IdempotencyRecord`.
- Produces same-budget composite foreign-key support for account, category, envelope, transaction and allocation relations.

- [ ] **Step 1: Write failing migration integration tests.**

Create `apps/api/test/operations.migration.integration.test.ts`. Cover `RUB`/scale check, positive monetary checks, expense envelope requirement, same-budget composite foreign keys, allocation-income relation and idempotency uniqueness:

```ts
it('enforces Stage 3a financial SQL constraints', async () => {
  await expect(
    prisma.transaction.create({
      data: { ...incomeData, currency: 'USD' },
    }),
  ).rejects.toMatchObject({ code: 'P2004' });

  await expect(
    prisma.transaction.create({
      data: { ...expenseData, envelopeId: null },
    }),
  ).rejects.toMatchObject({ code: 'P2004' });

  await expect(
    prisma.incomeAllocation.create({
      data: { ...allocationData, amountMinor: 0n },
    }),
  ).rejects.toMatchObject({ code: 'P2004' });
});
```

Create two budgets. Attempt a transaction that combines `budgetId` from the first budget with account/category/envelope IDs from the second; assert a PostgreSQL FK violation. Insert two `IdempotencyRecord` rows with identical `budgetId`, `actorUserId`, `key`; assert the second fails.

- [ ] **Step 2: Run migration test to verify it fails.**

Run:

```bash
pnpm db:migrate
pnpm --filter @harmofin/api exec vitest run --config vitest.integration.config.ts test/operations.migration.integration.test.ts
```

Expected: FAIL because models, database objects and constraints do not exist.

- [ ] **Step 3: Extend Prisma schema with exact Stage 3a types.**

Add these enums after `EnvelopeType`:

```prisma
enum TransactionType {
  INCOME
  EXPENSE
}

enum TransactionStatus {
  DRAFT
  CONFIRMED
  CANCELLED
  DELETED
}

enum IncomeAllocationStatus {
  CONFIRMED
  CANCELLED
  DELETED
}
```

Add `@@unique([id, budgetId])` to `Account` and relations on `Budget`:

```prisma
transactions        Transaction[]
incomeAllocations   IncomeAllocation[]
idempotencyRecords  IdempotencyRecord[]
```

Define this model shape, preserving snake-case mapped columns and all created/updated actor data:

```prisma
model Transaction {
  id                  String            @id @db.Uuid
  budgetId            String            @map("budget_id") @db.Uuid
  transactionType     TransactionType   @map("transaction_type")
  status              TransactionStatus @default(DRAFT)
  amountMinor         BigInt            @map("amount_minor")
  currency            String            @default("RUB") @db.Char(3)
  scale               Int               @default(2) @db.SmallInt
  occurredOn          DateTime          @map("occurred_on") @db.Date
  accountId           String            @map("account_id") @db.Uuid
  categoryId          String            @map("category_id") @db.Uuid
  envelopeId          String?           @map("envelope_id") @db.Uuid
  sourceDescription   String?           @map("source_description") @db.VarChar(250)
  merchantName        String?           @map("merchant_name") @db.VarChar(250)
  isPlanned           Boolean           @default(false) @map("is_planned")
  comment             String?           @db.VarChar(500)
  confirmedAt         DateTime?         @map("confirmed_at") @db.Timestamptz(3)
  cancelledAt         DateTime?         @map("cancelled_at") @db.Timestamptz(3)
  deletedAt           DateTime?         @map("deleted_at") @db.Timestamptz(3)
  createdByUserId     String            @map("created_by_user_id") @db.Uuid
  updatedByUserId     String            @map("updated_by_user_id") @db.Uuid
  createdAt           DateTime          @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt           DateTime          @updatedAt @map("updated_at") @db.Timestamptz(3)

  budget       Budget             @relation(fields: [budgetId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  account      Account            @relation(fields: [accountId, budgetId], references: [id, budgetId], onDelete: Restrict, onUpdate: Cascade)
  category     Category           @relation(fields: [categoryId, budgetId], references: [id, budgetId], onDelete: Restrict, onUpdate: Cascade)
  envelope     Envelope?          @relation(fields: [envelopeId, budgetId], references: [id, budgetId], onDelete: Restrict, onUpdate: Cascade)
  allocations  IncomeAllocation[]

  @@unique([id, budgetId])
  @@index([budgetId, occurredOn, createdAt])
  @@index([budgetId, transactionType, status, occurredOn])
  @@index([budgetId, accountId, occurredOn])
  @@index([budgetId, categoryId, occurredOn])
  @@index([budgetId, envelopeId, occurredOn])
  @@map("transactions")
}
```

Define these exact remaining models:

```prisma
model IncomeAllocation {
  id                  String                 @id @db.Uuid
  budgetId            String                 @map("budget_id") @db.Uuid
  incomeTransactionId String                 @map("income_transaction_id") @db.Uuid
  status              IncomeAllocationStatus @default(CONFIRMED)
  amountMinor         BigInt                 @map("amount_minor")
  currency            String                 @default("RUB") @db.Char(3)
  scale               Int                    @default(2) @db.SmallInt
  occurredOn          DateTime               @map("occurred_on") @db.Date
  accountId           String                 @map("account_id") @db.Uuid
  envelopeId          String                 @map("envelope_id") @db.Uuid
  comment             String?                @db.VarChar(500)
  deletedAt           DateTime?              @map("deleted_at") @db.Timestamptz(3)
  createdByUserId     String                 @map("created_by_user_id") @db.Uuid
  updatedByUserId     String                 @map("updated_by_user_id") @db.Uuid
  createdAt           DateTime               @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt           DateTime               @updatedAt @map("updated_at") @db.Timestamptz(3)

  budget             Budget      @relation(fields: [budgetId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  incomeTransaction  Transaction @relation(fields: [incomeTransactionId, budgetId], references: [id, budgetId], onDelete: Restrict, onUpdate: Cascade)
  account            Account     @relation(fields: [accountId, budgetId], references: [id, budgetId], onDelete: Restrict, onUpdate: Cascade)
  envelope           Envelope    @relation(fields: [envelopeId, budgetId], references: [id, budgetId], onDelete: Restrict, onUpdate: Cascade)

  @@unique([id, budgetId])
  @@index([budgetId, incomeTransactionId, status])
  @@index([budgetId, envelopeId, occurredOn])
  @@map("income_allocations")
}

model IdempotencyRecord {
  id             String   @id @db.Uuid
  budgetId       String   @map("budget_id") @db.Uuid
  actorUserId    String   @map("actor_user_id") @db.Uuid
  key            String   @db.VarChar(128)
  operation      String   @db.VarChar(64)
  requestHash    String   @map("request_hash") @db.Char(64)
  responseStatus Int      @map("response_status") @db.SmallInt
  responseBody   Json     @map("response_body")
  createdAt      DateTime @default(now()) @map("created_at") @db.Timestamptz(3)

  budget Budget @relation(fields: [budgetId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  actor  User   @relation(fields: [actorUserId], references: [id], onDelete: Restrict, onUpdate: Cascade)

  @@unique([budgetId, actorUserId, key])
  @@index([createdAt])
  @@map("idempotency_records")
}
```

Add `incomeAllocations IncomeAllocation[]` and `idempotencyRecords IdempotencyRecord[]` relations to `Budget`, `allocations IncomeAllocation[]` to `Transaction`, and `idempotencyRecords IdempotencyRecord[]` to `User`.

- [ ] **Step 4: Write additive SQL migration.**

Create the migration. It must:

```sql
ALTER TABLE "accounts"
  ADD CONSTRAINT "accounts_id_budget_id_key" UNIQUE ("id", "budget_id");

CREATE TYPE "TransactionType" AS ENUM ('INCOME', 'EXPENSE');
CREATE TYPE "TransactionStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'CANCELLED', 'DELETED');
CREATE TYPE "IncomeAllocationStatus" AS ENUM ('CONFIRMED', 'CANCELLED', 'DELETED');
```

Create `transactions`, `income_allocations` and `idempotency_records` with the fields above. Add these checks:

```sql
CHECK ("currency" = 'RUB'),
CHECK ("scale" = 2),
CHECK ("amount_minor" > 0),
CHECK ("transaction_type" <> 'EXPENSE' OR "envelope_id" IS NOT NULL),
CHECK (
  ("status" <> 'CONFIRMED' OR "confirmed_at" IS NOT NULL)
  AND ("status" <> 'CANCELLED' OR "cancelled_at" IS NOT NULL)
  AND ("status" <> 'DELETED' OR "deleted_at" IS NOT NULL)
)
```

Use composite FKs `(account_id, budget_id)`, `(category_id, budget_id)`, `(envelope_id, budget_id)`, `(income_transaction_id, budget_id)` and same-budget composite relations exactly. Add indexes matching Prisma schema plus active transaction list index:

```sql
CREATE INDEX "transactions_active_budget_occurred_idx"
  ON "transactions" ("budget_id", "occurred_on" DESC, "created_at" DESC)
  WHERE "status" <> 'DELETED';
```

- [ ] **Step 5: Generate and verify migration.**

Run:

```bash
pnpm db:generate
pnpm db:migrate
pnpm --filter @harmofin/api exec vitest run --config vitest.integration.config.ts test/operations.migration.integration.test.ts
```

Expected: PASS. Stage 1/2 budgets receive no operation defaults, and constraints fail only at database boundaries.

- [ ] **Step 6: Commit persistence contract.**

```bash
git add prisma/schema.prisma prisma/migrations/20260904000000_stage_3a_operations apps/api/test/operations.migration.integration.test.ts
git diff --cached --check
git commit -m "feat: add operations persistence contract"
```

---

### Task 2: Add durable idempotency and confirmed balance projections

**Files:**
- Create: `apps/api/src/common/idempotency/idempotency.service.ts`
- Create: `apps/api/src/common/idempotency/idempotency.service.test.ts`
- Create: `apps/api/src/common/finance/financial-balance.repository.ts`
- Create: `apps/api/src/common/finance/financial-balance.repository.test.ts`
- Modify: `apps/api/src/accounts/account.repository.ts`
- Modify: `apps/api/src/accounts/account.application.service.ts`
- Modify: `apps/api/src/envelopes/envelope.repository.ts`
- Modify: `apps/api/src/envelopes/envelope.application.service.ts`

**Interfaces:**
- Produces `IdempotencyService.execute<T>(input, operation): Promise<T>` for transaction-local financial writes.
- Produces `FinancialBalanceRepository.accountBalance(tx, budgetId, accountId): Promise<bigint>` and `envelopeBalance(tx, budgetId, envelopeId): Promise<bigint>`.
- Existing account/envelope response `currentBalanceMinor` becomes confirmed-operation-derived server data.

- [ ] **Step 1: Write failing unit tests for replay and confirmed-only balances.**

```ts
it('returns saved result for a matching idempotency retry', async () => {
  const first = await service.execute(input, async () => ({ id: 'operation-id', status: 'CONFIRMED' }));
  const replay = await service.execute(input, async () => { throw new Error('must not run'); });

  expect(replay).toEqual(first);
});

it('rejects same idempotency key with different request fingerprint', async () => {
  await service.execute(input, async () => ({ id: 'first' }));
  await expect(service.execute({ ...input, requestHash: 'different' }, async () => ({ id: 'second' })))
    .rejects.toMatchObject({ response: expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }) });
});

it('includes only confirmed rows in account and envelope balances', async () => {
  expect(await balances.accountBalance(tx, budgetId, accountId)).toBe(12_500n);
  expect(await balances.envelopeBalance(tx, budgetId, envelopeId)).toBe(3_000n);
});
```

Fixture has account starting `10_000n`, confirmed income `5_000n`, confirmed expense `2_500n`, and draft/cancelled/deleted rows with large amounts. Envelope fixture has starting `1_000n`, confirmed allocation `4_000n`, confirmed expense `2_000n`, plus non-confirmed rows.

- [ ] **Step 2: Run tests to verify they fail.**

```bash
pnpm --filter @harmofin/api test -- idempotency.service financial-balance.repository
```

Expected: FAIL because service and projections are absent.

- [ ] **Step 3: Implement idempotency replay inside caller transaction.**

Expose:

```ts
export type IdempotencyInput = {
  budgetId: string;
  actorUserId: string;
  key: string;
  operation: string;
  requestHash: string;
};

export class IdempotencyService {
  async execute<T extends Record<string, unknown>>(
    tx: Prisma.TransactionClient,
    input: IdempotencyInput,
    write: () => Promise<{ status: number; body: T }>,
  ): Promise<{ status: number; body: T }>;
}
```

Validate header key in controller before calling the service: trim, `min(1)`, `max(128)`, ASCII printable value. Build `requestHash` with SHA-256 over canonical JSON `{ operation, method, path, body }`; do not hash or store cookies, CSRF token or raw authentication data.

Within `execute`, query unique `(budgetId, actorUserId, key)`. If found with same `operation` and `requestHash`, return saved `responseStatus`/`responseBody`; if different, throw `ConflictException` with `{ code: 'IDEMPOTENCY_CONFLICT', detail: 'Ключ идемпотентности уже использован для другого запроса.' }`. If absent, call `write`, persist safe response body and return it. Catch only `P2002`, re-read the row in the same transaction and apply the same matching/conflict behavior.

- [ ] **Step 4: Implement bigint projections.**

Use `$queryRaw` parameterized SQL or a Prisma aggregation that never converts a monetary value to `number`. Account projection must calculate:

```text
starting_balance_minor
+ SUM(CONFIRMED INCOME on account)
- SUM(CONFIRMED EXPENSE on account)
```

Envelope projection must calculate:

```text
starting_balance_minor
+ SUM(CONFIRMED income allocations to envelope)
- SUM(CONFIRMED EXPENSE on envelope)
```

Use `COALESCE(..., 0)` and PostgreSQL `BIGINT`; return `bigint`. In account/envelope repositories, fetch all projection values in the same scoped query/transaction used for response mapping. Do not load rows from another budget and filter in application code.

- [ ] **Step 5: Map current balances in existing views.**

Replace current Stage 2 equality mapping:

```ts
currentBalanceMinor: startingBalanceMinor,
```

with formatted projection result:

```ts
currentBalanceMinor: formatMinorUnits(currentBalanceMinor),
```

Keep `startingBalanceMinor` unchanged. Add a unit test mapping a value above `Number.MAX_SAFE_INTEGER` from balance projection.

- [ ] **Step 6: Run focused API suite and commit.**

```bash
pnpm --filter @harmofin/api test
pnpm --filter @harmofin/api typecheck
git add apps/api/src/common/idempotency apps/api/src/common/finance apps/api/src/accounts apps/api/src/envelopes
git diff --cached --check
git commit -m "feat: add confirmed balance projections"
```

Expected: PASS. Repeated mutation write callback runs once, and existing account/envelope responses show server-derived balance.

---

### Task 3: Implement income and expense transaction API

**Files:**
- Create: `apps/api/src/transactions/transaction.repository.ts`
- Create: `apps/api/src/transactions/transaction.application.service.ts`
- Create: `apps/api/src/transactions/transaction.schemas.ts`
- Create: `apps/api/src/transactions/transaction.dto.ts`
- Create: `apps/api/src/transactions/transaction.controller.ts`
- Create: `apps/api/src/transactions/transaction.module.ts`
- Create: `apps/api/src/transactions/transaction.application.service.test.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Produces `TransactionView` with amount as canonical integer string, references, status, dates and computed financial consequences.
- Produces `TransactionApplicationService.list`, `get`, `create`, `update`, `confirm`, `cancel`, `delete`.
- Produces routes under `/api/v1/budgets/:budgetId/transactions`.

- [ ] **Step 1: Write failing transaction service tests.**

Use repository/idempotency doubles with the real minor-unit parser. Cover:

```ts
it('does not change financial projection when creating a draft expense', async () => {
  await service.create(ownerId, budgetId, expenseInput({ status: 'DRAFT' }), key);
  expect(repository.create).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ status: 'DRAFT', amountMinor: 12_345n }),
    expect.anything(),
  );
  expect(repository.assertConfirmedExpenseCapacity).not.toHaveBeenCalled();
});

it('blocks confirmation when account or envelope would become negative', async () => {
  repository.assertConfirmedExpenseCapacity.mockResolvedValue(false);
  await expect(service.confirm(ownerId, budgetId, transactionId, key))
    .rejects.toMatchObject({ response: expect.objectContaining({ code: 'INSUFFICIENT_BALANCE' }) });
});

it('requires same-budget active references with correct category type', async () => {
  repository.findActiveReferences.mockResolvedValue({ account: activeAccount, category: activeIncomeCategory, envelope: null });
  await expect(service.create(ownerId, budgetId, expenseInput(), key))
    .rejects.toMatchObject({ response: expect.objectContaining({ code: 'REFERENCE_INVALID' }) });
});
```

Also cover allowed transitions `DRAFT -> CONFIRMED`, `DRAFT -> CANCELLED`, `CONFIRMED -> DELETED`; deny `CANCELLED -> CONFIRMED`, `DELETED -> update`, expense without envelope, income with expense category, inactive reference, editor/viewer behavior required by active policy, and direct `bigint` serialization.

- [ ] **Step 2: Run tests to verify they fail.**

```bash
pnpm --filter @harmofin/api test -- transaction.application.service.test.ts
```

Expected: FAIL because transactions module does not exist.

- [ ] **Step 3: Create strict schemas and DTOs.**

Create strict Zod input shapes:

```ts
const common = {
  transactionType: z.enum(['INCOME', 'EXPENSE']),
  amount: z.string().min(1).max(64),
  occurredOn: z.string().date(),
  accountId: z.string().uuid(),
  categoryId: z.string().uuid(),
  comment: z.string().trim().min(1).max(500).nullable().optional(),
};

export const createTransactionSchema = z.object({
  ...common,
  status: z.enum(['DRAFT', 'CONFIRMED']).default('DRAFT'),
  envelopeId: z.string().uuid().nullable().optional(),
  sourceDescription: z.string().trim().min(1).max(250).nullable().optional(),
  merchantName: z.string().trim().min(1).max(250).nullable().optional(),
  isPlanned: z.boolean().default(false),
}).strict();
```

Add a `superRefine`: income must not include `envelopeId` or `merchantName`; expense must include `envelopeId` and must not include `sourceDescription`. Update schema has optional editable properties plus `confirm: z.literal(true).optional()` and requires at least one editable property. It never accepts `transactionType`, `status`, `budgetId`, `currency`, `scale`, `createdByUserId`, `updatedByUserId` or audit columns. List schema accepts bounded `limit` `1..100`, opaque cursor, `type`, `status`, `from`, `to`, `accountId`, `categoryId`, `envelopeId`.

Create Swagger DTOs. `amount` request uses decimal-string pattern; `amountMinor`, `accountCurrentBalanceMinor`, `envelopeCurrentBalanceMinor` and `unallocatedMinor` response fields use `^-?\\d+$`. Document `Idempotency-Key` header for every financial mutation.

- [ ] **Step 4: Implement scoped repository.**

Repository read `where` must start from:

```ts
{
  budgetId,
  budget: {
    status: 'ACTIVE',
    workspace: {
      status: 'ACTIVE',
      memberships: { some: { userId, isActive: true } },
    },
  },
}
```

For mutation transaction lookup, additionally require active budget/workspace, active membership and role allowed by financial-operation policy. Implement `findActiveReferences` using `id`, `budgetId`, `archivedAt: null` for each related object in the same transaction client. Implement `assertConfirmedExpenseCapacity` by obtaining account/envelope projections before the new confirmed effect and comparing with `amountMinor` using `bigint`.

Use cursor `(occurredOn, createdAt, id)` for descending list pagination. Select only view fields, allocations summary and safe derived balances. Never query Prisma directly from controller.

- [ ] **Step 5: Implement service state machine and idempotent mutations.**

Create must parse `amount` with:

```ts
parseDecimalToMinorUnits(input.amount, 2, false)
```

before persistence. It validates active account/category/envelope, category type, `RUB`, scale and status. For initial `CONFIRMED` expense, call capacity check before write. For initial `CONFIRMED` income, return allocation proposal only; do not create allocation.

`confirm` validates current `DRAFT` state and confirmed expense capacity before updating status and `confirmedAt`. `cancel` only accepts `DRAFT`; it writes `CANCELLED` and `cancelledAt`. `delete` logical-deletes only non-deleted transaction by assigning status `DELETED` and `deletedAt`; confirmed deletion removes its effect solely because projections select `CONFIRMED` status.

Update does not allow `transactionType`, `status`, `budgetId`, `currency`, `scale`, `createdByUserId` or audit columns. For a confirmed update, require confirmation dialog intent field `confirm: true`, validate prospective expense capacity excluding current operation, then atomically update and audit. Audit values contain type, status, amount minor, occurredOn, account/category/envelope IDs, planned flag and lifecycle dates; exclude comment/source/merchant.

Call `IdempotencyService.execute` around every create/update/confirm/cancel/delete transaction. Use these error codes: `REFERENCE_INVALID`, `TRANSACTION_STATE_INVALID`, `INSUFFICIENT_BALANCE`, `IDEMPOTENCY_CONFLICT`, `RESOURCE_NOT_FOUND`, `FORBIDDEN`.

- [ ] **Step 6: Add guarded controller/module and register it.**

Follow existing account controller conventions:

```ts
@Post('budgets/:budgetId/transactions/:transactionId/confirm')
@HttpCode(200)
@UseGuards(CsrfGuard)
@ApiOkResponse({ type: TransactionResponse })
confirm(
  @Param('budgetId') budgetId: string,
  @Param('transactionId') transactionId: string,
  @Headers('idempotency-key') key: string | undefined,
  @Req() request: AuthenticatedRequest,
) {
  return this.service.confirm(contextOf(request).userId, budgetId, transactionId, key, request.id);
}
```

Create corresponding routes for list/get/create/update/cancel/delete and declare `400/401/403/404/409/422` Problem Details as applicable. Register `TransactionModule.register()` in `AppModule`.

- [ ] **Step 7: Run focused tests and commit.**

```bash
pnpm --filter @harmofin/api test -- transaction.application.service.test.ts
pnpm --filter @harmofin/api typecheck
git add apps/api/src/transactions apps/api/src/app.module.ts
git diff --cached --check
git commit -m "feat: add income and expense operations"
```

Expected: PASS. Only confirmed operation affects projection and every unsafe mutation requires idempotency.

---

### Task 4: Implement income allocations and generic rule proposal

**Files:**
- Create: `apps/api/src/allocations/income-allocation.repository.ts`
- Create: `apps/api/src/allocations/income-allocation.application.service.ts`
- Create: `apps/api/src/allocations/income-allocation.schemas.ts`
- Create: `apps/api/src/allocations/income-allocation.dto.ts`
- Create: `apps/api/src/allocations/income-allocation.controller.ts`
- Create: `apps/api/src/allocations/income-allocation.module.ts`
- Create: `apps/api/src/allocations/income-allocation.application.service.test.ts`
- Modify: `apps/api/src/transactions/transaction.application.service.ts`
- Modify: `apps/api/src/transactions/transaction.dto.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Produces `IncomeAllocationView` and `AllocationProposal`.
- Produces `IncomeAllocationApplicationService.create`, `update`, `delete`, `listForIncome`.
- Produces `POST /budgets/:budgetId/transactions/:transactionId/allocations`.

- [ ] **Step 1: Write failing allocation service tests.**

```ts
it('blocks allocation sum above confirmed income amount', async () => {
  repository.sumConfirmedForIncome.mockResolvedValue(9_000n);
  repository.findConfirmedIncome.mockResolvedValue(confirmedIncome({ amountMinor: 10_000n }));

  await expect(service.create(ownerId, budgetId, incomeId, { amount: '20.00', accountId, envelopeId }, key))
    .rejects.toMatchObject({ response: expect.objectContaining({ code: 'ALLOCATION_EXCEEDS_INCOME' }) });
});

it('returns a generic configured proposal without persisting it', async () => {
  repository.findBudgetAllocationRule.mockResolvedValue({
    enabled: true,
    sourceCategoryId: incomeCategoryId,
    targetEnvelopeId: repairEnvelopeId,
  });

  expect(await service.proposalFor(confirmedIncome({ categoryId: incomeCategoryId }))).toMatchObject({
    targetEnvelopeId: repairEnvelopeId,
    amountMinor: '1200000',
  });
  expect(repository.create).not.toHaveBeenCalled();
});
```

Also test non-income source, draft/cancelled/deleted source, archived target account/envelope, foreign IDs, zero/negative amount, exact full allocation, allocation update that would exceed sum and logical delete restoring remaining amount.

- [ ] **Step 2: Run tests to verify they fail.**

```bash
pnpm --filter @harmofin/api test -- income-allocation.application.service.test.ts
```

Expected: FAIL because allocation module is absent.

- [ ] **Step 3: Create strict allocation schemas and DTOs.**

```ts
export const createIncomeAllocationSchema = z.object({
  amount: z.string().min(1).max(64),
  occurredOn: z.string().date(),
  accountId: z.string().uuid(),
  envelopeId: z.string().uuid(),
  comment: z.string().trim().min(1).max(500).nullable().optional(),
}).strict();
```

Update allows only amount, date, account, envelope and comment; it requires one property. Do not accept status, income transaction ID, budget ID, currency, scale, ids or audit fields from request. Allocation DTO returns `amountMinor`, status, references, `remainingUnallocatedMinor` and server-computed target envelope current balance.

- [ ] **Step 4: Implement locked sum and transaction service.**

Inside same `prisma.$transaction`, lock/find the source transaction with budget scope. Source must be `INCOME` and `CONFIRMED`. Query confirmed allocation sum for the income using the transaction client; calculate with `bigint`:

```ts
const nextTotal = confirmedTotal - replacedAmountMinor + nextAmountMinor;
if (nextTotal > income.amountMinor) throw allocationExceedsIncome();
```

Validate active same-budget target account/envelope and `RUB`/scale. Persist only `CONFIRMED` allocation after user mutation. Write audit allowlisting amount minor, operation date, income ID, account ID, envelope ID and status. Never persist rule proposal. `delete` sets `DELETED` and `deletedAt`, preserving history.

- [ ] **Step 5: Add transaction proposal mapping.**

When mapping a confirmed income `TransactionView`, query existing Stage 2 budget rule and source category/envelope state. Return:

```ts
allocationProposal: ruleMatches
  ? { targetEnvelopeId, amountMinor: unallocatedMinor, currency: 'RUB', scale: 2 }
  : null,
```

A proposal is `null` if rule disabled, source category differs, target envelope archived/not found, or income has no positive unallocated amount. It never writes an allocation and remains configurable by the budget settings API.

- [ ] **Step 6: Add controller/module and commit.**

Use `SessionAuthGuard` for reads and `CsrfGuard` plus `Idempotency-Key` for create/update/delete. Add module registration. Run:

```bash
pnpm --filter @harmofin/api test -- income-allocation.application.service.test.ts transaction.application.service.test.ts
pnpm --filter @harmofin/api typecheck
git add apps/api/src/allocations apps/api/src/transactions apps/api/src/app.module.ts
git diff --cached --check
git commit -m "feat: add income allocations"
```

Expected: PASS. Generic configured rule provides a proposal only, while allocation remains explicit.

---

### Task 5: Add HTTP, OpenAPI, transactionality and isolation coverage

**Files:**
- Create: `apps/api/test/operations.integration.test.ts`
- Modify: `apps/api/test/reference-data.integration.test.ts` only when server-confirmed balance expectations must include operations.

**Interfaces:**
- Produces real PostgreSQL verification of every Stage 3a public operation and allocation contract.

- [ ] **Step 1: Write failing integration scenarios.**

Create owner, editor, viewer and foreign-budget fixtures through authenticated API flows. Add scenarios:

```ts
it('replays a confirmed expense only once for an idempotency key', async () => {
  const first = await createTransaction(expensePayload, 'expense-retry-key');
  const replay = await createTransaction(expensePayload, 'expense-retry-key');

  expect(first.statusCode).toBe(201);
  expect(replay.statusCode).toBe(201);
  expect(replay.json()).toEqual(first.json());
  expect(await prisma.transaction.count({ where: { budgetId: ownerBudgetId } })).toBe(1);
});

it('keeps draft and deleted records out of account and envelope totals', async () => {
  const draft = await createTransaction({ ...expensePayload, status: 'DRAFT' }, 'draft-key');
  const confirmed = await createTransaction({ ...expensePayload, status: 'CONFIRMED' }, 'confirmed-key');
  await deleteTransaction(confirmed.json().id, 'delete-key');

  expect((await getAccount(accountId)).json().currentBalanceMinor).toBe('100000');
  expect((await getEnvelope(envelopeId)).json().currentBalanceMinor).toBe('50000');
  expect(draft.statusCode).toBe(201);
});
```

Test OpenAPI header parameter and all response schemas; strict unknown field rejection; transaction rollback after forced audit/idempotency error; allocation sum conflict; proposal response; non-owner 403; foreign budget 404; archived account/category/envelope 400; no-negative 422; and audit payload excludes comments/source/merchant.

- [ ] **Step 2: Run focused integration test to verify it fails.**

```bash
pnpm db:migrate
pnpm --filter @harmofin/api exec vitest run --config vitest.integration.config.ts test/operations.integration.test.ts
```

Expected: FAIL before all Stage 3a routes/contracts exist.

- [ ] **Step 3: Implement only missing production behavior revealed by tests.**

Do not add controller business logic or UI work in this task. Correct repository/service code until every test observes:

- safe Problem Details with field errors where applicable;
- no duplicate financial movement after matching retry;
- atomic rollback on failed nested write;
- same-budget filtering in every query;
- only confirmed records in current balance;
- audit allowlist only.

- [ ] **Step 4: Run API verification and commit.**

```bash
pnpm --filter @harmofin/api exec vitest run --config vitest.integration.config.ts test/operations.integration.test.ts
pnpm --filter @harmofin/api test
pnpm --filter @harmofin/api typecheck
git add apps/api/test/operations.integration.test.ts apps/api/test/reference-data.integration.test.ts apps/api/src
git diff --cached --check
git commit -m "test: cover financial operations API"
```

Expected: PASS against real PostgreSQL with Stage 1/2 fixtures intact.

---

### Task 6: Extend typed web operation client and presentation components

**Files:**
- Modify: `apps/web/app/composables/useBudgetReferenceData.ts`
- Modify: `apps/web/app/composables/useBudgetReferenceData.test.ts`
- Create: `apps/web/app/composables/useOperationForm.ts`
- Create: `apps/web/app/components/operations/OperationCard.vue`
- Create: `apps/web/app/components/operations/OperationForm.vue`
- Create: `apps/web/app/components/operations/IncomeAllocationForm.vue`
- Create: `apps/web/app/components/operations/OperationCard.test.ts`
- Create: `apps/web/app/components/operations/OperationForm.test.ts`
- Create: `apps/web/app/components/operations/IncomeAllocationForm.test.ts`

**Interfaces:**
- Produces typed `TransactionDto`, `IncomeAllocationDto`, `AllocationProposal`, create/update/list inputs and `useBudgetReferenceData` methods.
- Produces forms that retain money as decimal strings until API request.

- [ ] **Step 1: Write failing client and component tests.**

```ts
it('sends an idempotency key and unchanged normalized decimal amount', async () => {
  const request = vi.fn().mockResolvedValue(transactionDto);
  const api = createBudgetReferenceData({ request });

  await api.createTransaction('budget-id', expenseInput({ amount: '123.45' }), 'key-1');

  expect(request).toHaveBeenCalledWith('/api/v1/budgets/budget-id/transactions', {
    method: 'POST',
    headers: { 'Idempotency-Key': 'key-1' },
    body: JSON.stringify(expect.objectContaining({ amount: '123.45' })),
  });
});

it('shows allocation proposal but emits no allocation until accept is clicked', async () => {
  const wrapper = mount(IncomeAllocationForm, { props: { proposal, remainingMinor: '1200000' } });
  expect(wrapper.text()).toContain('Предложить распределение');
  expect(wrapper.emitted('submit')).toBeUndefined();
  await wrapper.get('button').trigger('click');
  expect(wrapper.emitted('submit')).toHaveLength(1);
});
```

Test type-specific field visibility, visible labels, decimal `inputmode`, draft/confirm labels, error association, `FinanceMoney` rendering, disabled submit while request pending and safe unknown Problem Details mapping.

- [ ] **Step 2: Run tests to verify they fail.**

```bash
pnpm --filter @harmofin/web test -- useBudgetReferenceData OperationCard OperationForm IncomeAllocationForm
```

Expected: FAIL because operation DTOs, methods and components do not exist.

- [ ] **Step 3: Extend API facade.**

Add exact methods:

```ts
listTransactions(budgetId: string, input?: TransactionListInput): Promise<TransactionListResult>;
getTransaction(budgetId: string, transactionId: string): Promise<TransactionDto>;
createTransaction(budgetId: string, input: CreateTransactionInput, idempotencyKey: string): Promise<TransactionDto>;
updateTransaction(budgetId: string, transactionId: string, input: UpdateTransactionInput, idempotencyKey: string): Promise<TransactionDto>;
confirmTransaction(budgetId: string, transactionId: string, idempotencyKey: string): Promise<TransactionDto>;
cancelTransaction(budgetId: string, transactionId: string, idempotencyKey: string): Promise<TransactionDto>;
deleteTransaction(budgetId: string, transactionId: string, idempotencyKey: string): Promise<TransactionDto>;
createIncomeAllocation(budgetId: string, transactionId: string, input: CreateIncomeAllocationInput, idempotencyKey: string): Promise<IncomeAllocationDto>;
```

Pass only `{ 'Idempotency-Key': idempotencyKey }` in request headers. Existing `useApiClient` continues adding Origin, cookies, content type and CSRF. Generate a new UUID with `crypto.randomUUID()` at user action boundary; reuse the same value only when retrying that exact failed action.

- [ ] **Step 4: Implement components.**

`OperationCard` receives `TransactionDto` only, localizes type/status, displays server `amountMinor` using `FinanceMoney`, and renders no computed balance.

`OperationForm` receives `mode: 'create' | 'edit'`, reference-data options, current model and server field errors. It uses `FinanceMoneyInput`. Income displays date, amount, account, `INCOME` category, source description and planned checkbox. Expense displays date, amount, account, `EXPENSE` category, envelope and merchant. Submit events provide raw decimal-string model plus requested `DRAFT` or explicit `CONFIRMED` intent; the component never converts money to `number`.

`IncomeAllocationForm` receives confirmed income, proposal and server `remainingUnallocatedMinor`. It pre-fills a proposal but offers `Применить предложение`, `Изменить` and `Не распределять`. Only submit emits a create allocation request.

- [ ] **Step 5: Run web checks and commit.**

```bash
pnpm --filter @harmofin/web test
pnpm --filter @harmofin/web typecheck
git add apps/web/app/composables/useBudgetReferenceData.ts apps/web/app/composables/useBudgetReferenceData.test.ts apps/web/app/composables/useOperationForm.ts apps/web/app/components/operations
git diff --cached --check
git commit -m "feat: add operations web client"
```

Expected: PASS. Money remains decimal string before API and canonical server string after API.

---

### Task 7: Implement protected operations journal and mutation flows

**Files:**
- Create: `apps/web/app/pages/app/operations.vue`
- Create: `apps/web/app/pages/app/operations.test.ts`
- Modify: `apps/web/app/pages/app/index.vue` only to add a Russian navigation link to `/app/operations` without changing auth behavior.

**Interfaces:**
- Produces protected `/app/operations` journal.
- Uses server pagination/filter DTOs and explicit confirm/cancel/delete/allocation actions.

- [ ] **Step 1: Write failing page interaction tests.**

```ts
it('creates a draft, then confirms server-confirmed expense with one action key', async () => {
  api.listTransactions.mockResolvedValue({ items: [], nextCursor: null });
  api.createTransaction.mockResolvedValue(transactionDto({ status: 'DRAFT' }));
  api.confirmTransaction.mockResolvedValue(transactionDto({ status: 'CONFIRMED' }));
  const wrapper = mount(OperationsPage, { global: pageStubs });

  await flushPromises();
  await wrapper.get('[data-action="create-operation"]').trigger('click');
  await wrapper.get('[name="transactionType"]').setValue('EXPENSE');
  await wrapper.get('[name="amount"]').setValue('1 234,50');
  await wrapper.get('[data-action="save-draft"]').trigger('click');
  expect(api.createTransaction).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({ amount: '1234.50', status: 'DRAFT' }),
    expect.any(String),
  );
});
```

Also test type filters reference options, loading/error retry, no budget empty state, server field error beside money input, proposal visible but rejected allocation creates nothing, allocation acceptance refreshes server transaction, dialog confirmation required for confirm/cancel/delete, and `UiConfirmDialog` Escape/focus return integration.

- [ ] **Step 2: Run page test to verify it fails.**

```bash
pnpm --filter @harmofin/web test -- operations.test.ts
```

Expected: FAIL because route page does not exist.

- [ ] **Step 3: Implement journal and filters.**

Resolve active budget only from `useAuth().currentData.value?.workspaces[0]?.budgets[0]`. If absent, render `UiEmptyState`; never invent an ID. Load server page on mount. Provide explicit filters for operation type, status, account, category, envelope and dates; use server `nextCursor` for `Загрузить ещё` and append only DTOs returned by server.

Render `OperationCard` list, empty state and Russian transient statuses. Do not derive totals, balances, unallocated income or filter results in browser beyond displaying selected server page.

- [ ] **Step 4: Implement forms and confirmed mutations.**

Use `OperationForm` and `IncomeAllocationForm`. `Создать черновик` sends `DRAFT`. `Подтвердить операцию` opens `UiConfirmDialog`, then sends confirm endpoint and refetches journal/detail. Edit a confirmed transaction requires visible confirmation before sending `confirm: true` contract property. Cancel and delete require dialog confirmation; delete has Russian history-preserving explanation.

On every mutation, generate one `crypto.randomUUID()` action key, disable duplicate buttons during pending request, retain key only while retry UI is visible, then refetch current page and detail from API before success text. Never recalculate cards or balances locally.

- [ ] **Step 5: Preserve auth shell behavior and run web checks.**

Keep `data-hydrated`, login/register/recovery flow, wordmark and current protected page behavior. Run:

```bash
pnpm --filter @harmofin/web test
pnpm --filter @harmofin/web lint
pnpm --filter @harmofin/web typecheck
pnpm --filter @harmofin/web build
git add apps/web/app/pages/app/operations.vue apps/web/app/pages/app/operations.test.ts apps/web/app/pages/app/index.vue
git diff --cached --check
git commit -m "feat: add operations journal"
```

Expected: PASS. Page has one `h1`, content landmark, field errors, compact cards and no horizontal table.

---

### Task 8: Add Stage 3a browser coverage and final verification

**Files:**
- Create: `e2e/operations.spec.ts`
- Modify: `e2e/playwright.config.ts` only if test discovery/configuration needs a new explicit browser project; preserve existing `*.spec.ts` matching.

**Interfaces:**
- Playwright executes Stage 2 and Stage 3a browser flows against the API; no database bypass for financial actions.

- [ ] **Step 1: Write failing Playwright scenarios.**

```ts
test('owner creates, confirms, allocates and logically deletes financial records', async ({ page }) => {
  await registerAndInitializeTemplate(page);
  await createAccount(page, 'Основная карта', '10 000,00');

  await page.goto('/app/operations');
  await page.getByRole('button', { name: 'Добавить операцию' }).click();
  await page.getByLabel('Тип операции').selectOption('INCOME');
  await page.getByLabel('Сумма').fill('12 000,00');
  await page.getByRole('button', { name: 'Создать черновик' }).click();
  await expect(page.getByText('Черновик')).toBeVisible();

  await page.getByRole('button', { name: 'Подтвердить операцию' }).click();
  await page.getByRole('button', { name: 'Подтвердить' }).click();
  await expect(page.getByText('Подтверждена')).toBeVisible();
  await expect(page.getByText(/12.*000.*00/).first()).toBeVisible();
});
```

Add cases for expense envelope effect, no-negative rejection, generic allocation proposal accepted/changed/rejected, duplicate `Idempotency-Key` browser retry no duplicate, field error for malformed money, cancel/delete confirmed effects, foreign/protected route redirect, Escape/focus return and `375px` no-horizontal-overflow journal/form flow.

- [ ] **Step 2: Run spec and make it pass.**

```bash
pnpm test:e2e -- operations.spec.ts
```

Expected: FAIL before Task 7, then PASS after every flow is fully connected to API.

- [ ] **Step 3: Run final Stage 3a quality gate.**

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm build
docker compose -f infra/compose/local.yml config --quiet
```

Then separately verify migration compatibility:

```bash
pnpm db:migrate
pnpm --filter @harmofin/api exec vitest run --config vitest.integration.config.ts test/operations.migration.integration.test.ts
```

Expected: every command exits `0`; migration works on clean database and database containing Stage 1/2 fixture data.

- [ ] **Step 4: Manually verify browser flows.**

Start stack:

```bash
pnpm infra:up
pnpm dev
```

In a real browser, verify at desktop and `375px`: create draft income, confirm it, accept/change/reject generic allocation proposal, create expense, observe server-confirmed account/envelope values, reject insufficient balance, edit/cancel/logically delete, retry a pending financial submit, tab through dialogs and close with Escape. Stop only processes started in this task. Do not use destructive database cleanup.

- [ ] **Step 5: Commit browser coverage.**

```bash
git add e2e/operations.spec.ts e2e/playwright.config.ts
git diff --cached --check
git commit -m "test: cover operations and allocations flow"
```

Expected: browser coverage and full quality gate remain green.

---

## Plan Self-Review

- **Spec coverage:** Task 1 implements additive persistence. Task 2 implements idempotency and confirmed projections. Tasks 3–4 implement income, expense, allocation and generic proposal rules. Task 5 provides real PostgreSQL/OpenAPI/isolation coverage. Tasks 6–7 implement typed client and protected UI. Task 8 covers browser flows, migration and final gates. Transfers, cycles, dashboard, reports, plans and notifications remain deliberately absent.
- **Placeholder scan:** No implementation step leaves a behavior unspecified; all mutation boundaries, states, errors, tests and commits are named.
- **Type consistency:** Money crosses API as decimal request string and canonical integer response string. `TransactionDto`, `IncomeAllocationDto`, `IdempotencyService.execute`, transaction routes and allocation routes use the same identifiers across tasks.
