# Stage 4 Transfers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add server-confirmed single-part and multipart transfers between accounts, including explicit envelope reallocation, a protected transfer page, and end-to-end financial correctness coverage.

**Architecture:** Model a transfer as a separate `Transfer` aggregate with owned `TransferPart` rows; do not add a `TRANSFER` transaction type or merge transfers into `/app/operations`. The transfer application service owns same-budget reference validation, status transitions, idempotency, audit and transactional writes. Account and envelope balances remain SQL-derived server views extended with confirmed transfer parts.

**Tech Stack:** TypeScript strict mode, NestJS/Fastify, Prisma/PostgreSQL, Zod, Swagger/OpenAPI, Vue 3/Nuxt 4, Vitest, Supertest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-04-stage-4-transfers-design.md`

## Global Constraints

- Read the Stage 4 design, functional specification and development specification before implementation decisions.
- Keep Stage 3a behavior intact; add an additive migration only. Never modify existing Stage 1–3a migrations.
- Financial source of truth is PostgreSQL `BIGINT`; API receives decimal strings and returns canonical integer strings.
- Only `CONFIRMED` records affect calculated balances. Perform financial validation and writes inside server database transactions.
- Every user-data query and mutation filters `budget_id` in SQL and verifies active workspace membership, budget access, role and object ownership.
- Allow `OWNER` and `EDITOR` transfer mutations; all other roles receive `403 FORBIDDEN`. Cross-budget IDs receive `404 RESOURCE_NOT_FOUND`.
- Every financial mutation requires and reuses existing idempotency behavior. UI never retries financial writes with a new key automatically.
- Use Russian UI and user-facing error text. Keep code and API identifiers English.
- Exclude unified `/app/operations` transfer feed, transfer edit/restore, cycles, dashboard, reports, plans, notifications, worker jobs, imports, multi-currency, collaboration, AI, billing and deployment.
- Before Stage 5 begins, schedule and complete Stage 3b: operation edit/restore, complete journal filters, cycles, periods, dashboard and report scope.

---

### Task 1: Persist transfer aggregates and extend SQL projections

**Files:**
- Modify: `prisma/schema.prisma:61-77, 156-257`
- Create: `prisma/migrations/20260905000000_stage_4_transfers/migration.sql`
- Modify: `apps/api/src/common/finance/financial-balance.repository.ts`
- Create: `apps/api/src/common/finance/financial-balance.repository.test.ts`
- Create: `apps/api/test/transfers.migration.integration.test.ts`

**Interfaces:**
- Produces Prisma enum `TransferStatus = DRAFT | CONFIRMED | CANCELLED | DELETED`.
- Produces Prisma `Transfer` and `TransferPart` models with `@@unique([id, budgetId])` and budget-scoped composite relations.
- Produces `FinancialBalanceRepository.accountBalance(tx, budgetId, accountId)` and `.envelopeBalance(tx, budgetId, envelopeId)` that include confirmed transfer part outgoing/incoming effects.

- [ ] **Step 1: Write failing projection tests**

```ts
it('moves account money without changing total confirmed account money', async () => {
  await createConfirmedTransferPart({
    sourceAccountId: accountA.id,
    destinationAccountId: accountB.id,
    sourceEnvelopeId: envelope.id,
    destinationEnvelopeId: envelope.id,
    amountMinor: 2500n,
  });

  await expectBalance(accountA.id, 7_500n);
  await expectBalance(accountB.id, 12_500n);
  await expectEnvelopeBalance(envelope.id, 0n);
});

it('moves envelope money only when destination envelope differs', async () => {
  await createConfirmedTransferPart({
    sourceAccountId: accountA.id,
    destinationAccountId: accountB.id,
    sourceEnvelopeId: sourceEnvelope.id,
    destinationEnvelopeId: destinationEnvelope.id,
    amountMinor: 2_500n,
  });

  await expectEnvelopeBalance(sourceEnvelope.id, 7_500n);
  await expectEnvelopeBalance(destinationEnvelope.id, 2_500n);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @harmofin/api exec vitest run --config vitest.config.ts src/common/finance/financial-balance.repository.test.ts`

Expected: FAIL because transfer tables and projection terms do not exist.

- [ ] **Step 3: Add Prisma contract and additive SQL migration**

Add exact model shape:

```prisma
enum TransferStatus {
  DRAFT
  CONFIRMED
  CANCELLED
  DELETED
}

model Transfer {
  id              String         @id @db.Uuid
  budgetId        String         @map("budget_id") @db.Uuid
  status          TransferStatus @default(DRAFT)
  totalMinor      BigInt         @map("total_minor")
  currency        String         @default("RUB") @db.Char(3)
  scale           Int            @default(2) @db.SmallInt
  occurredOn      DateTime       @map("occurred_on") @db.Date
  comment         String?        @db.VarChar(500)
  confirmedAt     DateTime?      @map("confirmed_at") @db.Timestamptz(3)
  cancelledAt     DateTime?      @map("cancelled_at") @db.Timestamptz(3)
  deletedAt       DateTime?      @map("deleted_at") @db.Timestamptz(3)
  createdByUserId String         @map("created_by_user_id") @db.Uuid
  updatedByUserId String         @map("updated_by_user_id") @db.Uuid
  createdAt       DateTime       @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt       DateTime       @updatedAt @map("updated_at") @db.Timestamptz(3)

  budget Budget         @relation(fields: [budgetId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  parts  TransferPart[]

  @@unique([id, budgetId])
  @@index([budgetId, occurredOn, createdAt])
  @@index([budgetId, status, occurredOn])
  @@map("transfers")
}

model TransferPart {
  id                   String   @id @db.Uuid
  transferId           String   @map("transfer_id") @db.Uuid
  budgetId             String   @map("budget_id") @db.Uuid
  sourceAccountId      String   @map("source_account_id") @db.Uuid
  destinationAccountId String   @map("destination_account_id") @db.Uuid
  sourceEnvelopeId     String   @map("source_envelope_id") @db.Uuid
  destinationEnvelopeId String  @map("destination_envelope_id") @db.Uuid
  amountMinor          BigInt   @map("amount_minor")
  comment              String?  @db.VarChar(500)
  createdAt            DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt            DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)

  transfer Transfer @relation(fields: [transferId, budgetId], references: [id, budgetId], onDelete: Restrict, onUpdate: Cascade)
  sourceAccount Account @relation("TransferPartSourceAccount", fields: [sourceAccountId, budgetId], references: [id, budgetId], onDelete: Restrict, onUpdate: Cascade)
  destinationAccount Account @relation("TransferPartDestinationAccount", fields: [destinationAccountId, budgetId], references: [id, budgetId], onDelete: Restrict, onUpdate: Cascade)
  sourceEnvelope Envelope @relation("TransferPartSourceEnvelope", fields: [sourceEnvelopeId, budgetId], references: [id, budgetId], onDelete: Restrict, onUpdate: Cascade)
  destinationEnvelope Envelope @relation("TransferPartDestinationEnvelope", fields: [destinationEnvelopeId, budgetId], references: [id, budgetId], onDelete: Restrict, onUpdate: Cascade)

  @@unique([id, budgetId])
  @@index([budgetId, sourceAccountId])
  @@index([budgetId, destinationAccountId])
  @@index([budgetId, sourceEnvelopeId])
  @@index([budgetId, destinationEnvelopeId])
  @@map("transfer_parts")
}
```

Add matching reverse relation names to `Budget`, `Account`, and `Envelope`. Migration creates enums/tables, composite foreign keys, `total_minor > 0`, `amount_minor > 0`, `currency = 'RUB'`, `scale = 2`, valid lifecycle checks and listed indexes.

Extend each balance query with two `COALESCE(SUM(part.amount_minor), 0)` terms joined to a `CONFIRMED` transfer: subtract source and add destination. Do not store calculated balances.

- [ ] **Step 4: Add migration compatibility coverage**

Create a real PostgreSQL integration test that migrates Stage 1–3a fixture data to Stage 4, inserts a one-part and multipart transfer through Prisma, and asserts database constraints reject a zero part and cross-budget composite reference.

- [ ] **Step 5: Run focused tests to verify they pass**

Run:

```bash
pnpm db:migrate
pnpm --filter @harmofin/api exec vitest run --config vitest.config.ts src/common/finance/financial-balance.repository.test.ts
pnpm --filter @harmofin/api exec vitest run --config vitest.integration.config.ts test/transfers.migration.integration.test.ts
```

Expected: PASS; same-envelope transfer preserves envelope total, changed envelope moves purpose balance, and migration preserves existing data.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260905000000_stage_4_transfers apps/api/src/common/finance/financial-balance.repository.ts apps/api/src/common/finance/financial-balance.repository.test.ts apps/api/test/transfers.migration.integration.test.ts
git commit -m "feat: add transfer persistence and projections"
```

### Task 2: Add transfer application service and documented HTTP contract

**Files:**
- Create: `apps/api/src/transfers/transfer.schemas.ts`
- Create: `apps/api/src/transfers/transfer.dto.ts`
- Create: `apps/api/src/transfers/transfer.repository.ts`
- Create: `apps/api/src/transfers/transfer.application.service.ts`
- Create: `apps/api/src/transfers/transfer.controller.ts`
- Create: `apps/api/src/transfers/transfer.module.ts`
- Create: `apps/api/src/transfers/transfer.application.service.test.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes `Transfer`, `TransferPart`, `FinancialBalanceRepository`, `IdempotencyService`, `createUuidV7`, existing session/role guards and Problem Details errors.
- Produces `TransferApplicationService` methods `list`, `get`, `create`, `confirm`, `cancel`, `delete` and routes under `/api/v1/budgets/:budgetId/transfers`.

- [ ] **Step 1: Write failing domain tests**

```ts
const input = {
  status: 'CONFIRMED' as const,
  total: '30.00',
  occurredOn: '2026-09-05',
  sourceAccountId: sourceAccountId,
  destinationAccountId: destinationAccountId,
  parts: [
    { sourceEnvelopeId, destinationEnvelopeId: sourceEnvelopeId, amount: '20.00' },
    { sourceEnvelopeId, destinationEnvelopeId: destinationEnvelopeId, amount: '10.00' },
  ],
};

await expect(service.create(ownerId, budgetId, input, 'create-key')).resolves.toMatchObject({
  status: 'CONFIRMED',
  totalMinor: '3000',
});
await expect(service.create(ownerId, budgetId, { ...input, total: '30.01' }, 'bad-key')).rejects.toMatchObject({
  response: { code: 'TRANSFER_PARTS_TOTAL_MISMATCH' },
});
```

Cover: matching part total, different accounts, active same-budget references, source capacity, `DRAFT` confirmation, draft cancellation, logical deletion, rejected `DELETED` mutation, idempotency replay and idempotency conflict.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @harmofin/api exec vitest run --config vitest.config.ts src/transfers/transfer.application.service.test.ts`

Expected: FAIL because transfer module does not exist.

- [ ] **Step 3: Implement schemas, DTOs, repository and service**

Define client boundary schema:

```ts
const transferPartSchema = z.object({
  sourceEnvelopeId: z.string().uuid(),
  destinationEnvelopeId: z.string().uuid().optional(),
  amount: z.string().min(1).max(64),
  comment: z.string().trim().min(1).max(500).nullable().optional(),
});

export const createTransferSchema = z.object({
  status: z.enum(['DRAFT', 'CONFIRMED']).default('DRAFT'),
  total: z.string().min(1).max(64),
  occurredOn: z.string().date(),
  sourceAccountId: z.string().uuid(),
  destinationAccountId: z.string().uuid(),
  parts: z.array(transferPartSchema).min(1).max(100),
  comment: z.string().trim().min(1).max(500).nullable().optional(),
}).strict();
```

Service must parse each decimal with `parseDecimalToMinorUnits(value, 2, false)`, default `destinationEnvelopeId` to `sourceEnvelopeId`, sum parts with `bigint`, and reject a nonmatching total before persistence. Repository locks current references and source balances inside `runTransaction`; its capacity assertion uses projected current source account/envelope balances minus aggregate outgoing part amounts. It writes transfer and all parts together, then one allowlisted `auditEvent` per aggregate lifecycle action.

Expose a view with:

```ts
interface TransferView {
  id: string;
  budgetId: string;
  status: 'DRAFT' | 'CONFIRMED' | 'CANCELLED' | 'DELETED';
  totalMinor: string;
  currency: 'RUB';
  scale: 2;
  occurredOn: string;
  comment: string | null;
  confirmedAt: string | null;
  cancelledAt: string | null;
  deletedAt: string | null;
  parts: TransferPartView[];
}
```

`TransferPartView` returns IDs, canonical `amountMinor`, optional comment, and server-derived current balances for both accounts and both envelopes. Register `TransferModule` in `AppModule`. Controller uses current request context, `SessionAuthGuard`, role policy, `CsrfGuard`, `Idempotency-Key` and Swagger response/problem DTOs, matching transaction controller conventions.

- [ ] **Step 4: Run focused tests to verify they pass**

Run:

```bash
pnpm --filter @harmofin/api exec vitest run --config vitest.config.ts src/transfers/transfer.application.service.test.ts
pnpm --filter @harmofin/api typecheck
```

Expected: PASS with all lifecycle, invariants and idempotency cases green.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/transfers apps/api/src/app.module.ts
git commit -m "feat: add transfer API and lifecycle"
```

### Task 3: Verify transfer HTTP behavior against PostgreSQL

**Files:**
- Create: `apps/api/test/transfers.integration.test.ts`
- Modify: `apps/api/test/operations.integration.test.ts`
- Modify: `apps/api/test/reference-data.integration.test.ts`

**Interfaces:**
- Consumes all Stage 4 routes and database migration.
- Produces real-PostgreSQL acceptance coverage for public transfer API, server balance projections and Stage 3a regression behavior.

- [ ] **Step 1: Write failing public API scenarios**

```ts
const created = await request(app)
  .post(`/api/v1/budgets/${budgetId}/transfers`)
  .set(authHeaders(owner))
  .set('Idempotency-Key', 'transfer-one-part')
  .send({
    status: 'CONFIRMED',
    total: '50.00',
    occurredOn: '2026-09-05',
    sourceAccountId,
    destinationAccountId,
    parts: [{ sourceEnvelopeId, amount: '50.00' }],
  })
  .expect(201);

expect(created.body.totalMinor).toBe('5000');
expect(created.body.parts).toHaveLength(1);
```

Add cases for: multipart changed destination envelope, unequal total `409`, same account `400`, archived/foreign reference rejection, insufficient confirmed source capacity, draft confirm/cancel, delete confirmed restoring visible projections, replay same idempotency key with one row, same key different payload `409`, `EDITOR` allowed and `VIEWER` forbidden, unauthenticated `401`, and OpenAPI paths/operation schemas.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @harmofin/api exec vitest run --config vitest.integration.config.ts test/transfers.integration.test.ts`

Expected: FAIL before transfer routes are connected to a real PostgreSQL app.

- [ ] **Step 3: Correct production boundaries exposed by integration**

Fix only production behavior required by failed scenarios: repository `budgetId` SQL predicates, role checks, lifecycle state checks, response DTO/OpenAPI mismatches, atomic write rollback or derived projection equations. Do not loosen constraints or mock PostgreSQL.

- [ ] **Step 4: Verify integration and regression suites**

Run:

```bash
pnpm db:migrate
pnpm --filter @harmofin/api exec vitest run --config vitest.integration.config.ts test/transfers.integration.test.ts test/operations.integration.test.ts test/reference-data.integration.test.ts
```

Expected: PASS with existing income, expense and allocation balances unchanged.

- [ ] **Step 5: Commit**

```bash
git add apps/api/test/transfers.integration.test.ts apps/api/test/operations.integration.test.ts apps/api/test/reference-data.integration.test.ts apps/api/src
git commit -m "test: cover transfer API invariants"
```

### Task 4: Add typed client, transfer form/list and account entry point

**Files:**
- Modify: `apps/web/app/composables/useBudgetReferenceData.ts`
- Create: `apps/web/app/composables/useTransferForm.ts`
- Create: `apps/web/app/composables/useTransferForm.test.ts`
- Create: `apps/web/app/components/transfers/TransferForm.vue`
- Create: `apps/web/app/components/transfers/TransferForm.test.ts`
- Create: `apps/web/app/components/transfers/TransferCard.vue`
- Create: `apps/web/app/components/transfers/TransferCard.test.ts`
- Create: `apps/web/app/pages/app/transfers.vue`
- Create: `apps/web/app/pages/app/transfers.test.ts`
- Modify: `apps/web/app/pages/app/accounts.vue`
- Modify: `apps/web/app/pages/app/accounts.test.ts`

**Interfaces:**
- Consumes transfer HTTP contract and existing `FinanceMoneyInput`, `UiInput`, `UiSelect`, `UiButton`, `UiStatus`, `UiConfirmDialog`, `useAuth` and `ApiRequestError`.
- Produces `TransferDto`, `TransferPartDto`, `CreateTransferInput`, `TransferListInput`, `useBudgetReferenceData().listTransfers/createTransfer/confirmTransfer/cancelTransfer/deleteTransfer` and protected `/app/transfers`.

- [ ] **Step 1: Write failing client and form tests**

```ts
it('serializes transfer parts as canonical decimal request input', () => {
  expect(toCreateTransferInput({
    total: '1 000,00',
    sourceAccountId: 'source-id',
    destinationAccountId: 'destination-id',
    parts: [{ sourceEnvelopeId: 'envelope-id', destinationEnvelopeId: '', amount: '1 000,00' }],
  })).toEqual({
    total: '1000.00',
    sourceAccountId: 'source-id',
    destinationAccountId: 'destination-id',
    parts: [{ sourceEnvelopeId: 'envelope-id', amount: '1000.00' }],
  });
});

it('adds and removes a transfer part while preserving labels and field errors', async () => {
  const wrapper = mount(TransferForm, { props: { accounts, envelopes, model } });
  await wrapper.getByRole('button', { name: 'Добавить часть' }).trigger('click');
  expect(wrapper.findAll('[data-transfer-part]')).toHaveLength(2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @harmofin/web exec vitest run --config vitest.config.ts app/composables/useTransferForm.test.ts app/components/transfers/TransferForm.test.ts app/pages/app/transfers.test.ts
```

Expected: FAIL because transfer client/types/components/page do not exist.

- [ ] **Step 3: Implement typed facade and UI**

Add these client types:

```ts
type TransferStatus = 'DRAFT' | 'CONFIRMED' | 'CANCELLED' | 'DELETED';
type TransferPartInput = {
  sourceEnvelopeId: string;
  destinationEnvelopeId?: string | undefined;
  amount: string;
  comment?: string | null | undefined;
};
type CreateTransferInput = {
  status: 'DRAFT' | 'CONFIRMED';
  total: string;
  occurredOn: string;
  sourceAccountId: string;
  destinationAccountId: string;
  parts: TransferPartInput[];
  comment?: string | null | undefined;
};
```

Use `/api/v1/budgets/:budgetId/transfers` path helpers and existing idempotency header method. `useTransferForm` normalizes decimal input, defaults a new part destination envelope to its source envelope, and omits empty optional destination envelope so server defaults it.

`transfers.vue` loads active accounts/envelopes and paginated transfers from server; it sends random UUID idempotency keys only for explicit user clicks, refreshes the server list after mutations and maps safe Problem Details to summary/field errors. `TransferForm` has source/destination accounts, date, total, list of parts, `Добавить часть`, `Удалить часть`, `Создать черновик` and `Подтвердить перевод`. Confirmed creation and destructive lifecycle actions open `UiConfirmDialog`.

Add `Перевести со счёта` for active account cards. It navigates to `/app/transfers?sourceAccountId=<encoded-id>`; `transfers.vue` accepts that value only as initial form state after its server-owned active reference list loads.

- [ ] **Step 4: Run focused web tests and typecheck**

Run:

```bash
pnpm --filter @harmofin/web exec vitest run --config vitest.config.ts app/composables/useTransferForm.test.ts app/components/transfers/TransferForm.test.ts app/components/transfers/TransferCard.test.ts app/pages/app/transfers.test.ts app/pages/app/accounts.test.ts
pnpm --filter @harmofin/web typecheck
```

Expected: PASS; browser code has no balance arithmetic or trusted route-parameter authorization.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/composables/useBudgetReferenceData.ts apps/web/app/composables/useTransferForm.ts apps/web/app/composables/useTransferForm.test.ts apps/web/app/components/transfers apps/web/app/pages/app/transfers.vue apps/web/app/pages/app/transfers.test.ts apps/web/app/pages/app/accounts.vue apps/web/app/pages/app/accounts.test.ts
git commit -m "feat: add transfer management interface"
```

### Task 5: Add browser transfer flows and final verification

**Files:**
- Create: `e2e/transfers.spec.ts`
- Modify: `e2e/playwright.config.ts` only if existing `*.spec.ts` discovery requires it
- Modify: `docs/superpowers/specs/2026-09-04-stage-4-transfers-design.md` only if verification exposes an approved design correction

**Interfaces:**
- Consumes real local API, PostgreSQL, transfer page and account page entry action.
- Produces full Stage 4 browser and quality-gate evidence.

- [ ] **Step 1: Write failing Playwright scenarios**

```ts
test('owner confirms multipart transfer and explicit envelope reallocation', async ({ page }) => {
  await registerInitializeAndCreateTransferReferences(page);
  await page.goto('/app/transfers');
  await page.getByLabel('Счёт списания').selectOption({ label: 'Основной счёт' });
  await page.getByLabel('Счёт зачисления').selectOption({ label: 'Накопительный счёт' });
  await page.getByLabel('Общая сумма').fill('20 000,00');
  await page.getByLabel('Сумма части 1').fill('15 000,00');
  await page.getByRole('button', { name: 'Добавить часть' }).click();
  await page.getByLabel('Сумма части 2').fill('5 000,00');
  await page.getByRole('button', { name: 'Подтвердить перевод' }).click();
  await page.getByRole('button', { name: 'Подтвердить', exact: true }).click();
  await expect(page.getByText('Подтверждён')).toBeVisible();
});
```

Add protected-route redirect, source-account prefill, one-part same-envelope preservation, changed destination envelope, unequal part total field error, insufficient balance rejection, same `Idempotency-Key` browser replay with one transfer, draft cancel, confirmed delete, Escape/focus return, desktop and `375px` no-horizontal-overflow list/form.

- [ ] **Step 2: Run spec to verify it fails**

Run: `pnpm test:e2e -- transfers.spec.ts`

Expected: FAIL before transfer UI/API wiring is complete.

- [ ] **Step 3: Correct only browser-exposed integration gaps**

Make minimal production changes for failed visible behavior: query prefill sequencing, field error mapping, focus return, responsive layout, or server response handling. Preserve server-side financial authority and idempotency keys.

- [ ] **Step 4: Run full Stage 4 quality gate**

Run:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm build
docker compose -f infra/compose/local.yml config --quiet
pnpm db:migrate
pnpm --filter @harmofin/api exec vitest run --config vitest.integration.config.ts test/transfers.migration.integration.test.ts
```

Expected: every command exits `0`.

- [ ] **Step 5: Manually verify browser flows**

Run:

```bash
pnpm infra:up
pnpm dev
```

In Chrome at desktop and `375px`, create and confirm single-part/multipart transfers, change a destination envelope, reject unequal totals and insufficient source balance, follow account prefill, cancel/delete a transfer, retry a pending submit and close dialogs with Escape. Stop only processes started for verification.

- [ ] **Step 6: Commit**

```bash
git add e2e/transfers.spec.ts e2e/playwright.config.ts apps/api apps/web prisma docs/superpowers/specs/2026-09-04-stage-4-transfers-design.md
git diff --cached --check
git commit -m "test: cover transfer flows"
```

---

## Plan Self-Review

- **Spec coverage:** Task 1 implements transfer persistence and confirmed SQL projections. Task 2 supplies atomic transfer rules, lifecycle, audit, isolation, idempotency and OpenAPI. Task 3 verifies all public PostgreSQL/API outcomes. Task 4 implements dedicated transfer UI and source-account entry point. Task 5 verifies browser behavior and full quality gate.
- **Placeholder scan:** No task leaves an implementation boundary unspecified; model fields, route shapes, lifecycle, projection equations, test cases and verification commands are explicit.
- **Type consistency:** `CreateTransferInput.total` and `TransferPartInput.amount` are decimal strings; persistence uses `totalMinor` and `amountMinor` `bigint`; DTOs return canonical strings. `TransferStatus` uses the same four values across Prisma, API, client and UI.
