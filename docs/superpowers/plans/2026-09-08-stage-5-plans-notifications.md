# Stage 5: планы и уведомления — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` task-by-task. Пользователь явно запретил subagents и worktrees; выполнять в текущем checkout, останавливаться после каждого утверждённого Task.

**Goal:** Добавить регулярные планы, materialized occurrences, durable PostgreSQL worker, внутренние уведомления, создание черновика фактической операции и dashboard projection ближайших обязательств.

**Architecture:** API остаётся модульным NestJS monolith: `plans` владеет шаблонами и occurrences, `notifications` — пользовательским inbox, а существующий `transactions` подтверждает связанный occurrence через малый shared repository. Отдельный worker владеет PostgreSQL job lease, materialization и trusted server-side notification rules; уникальные database constraints делают повторные запуски безопасными.

**Tech Stack:** TypeScript strict, NestJS/Fastify, Prisma 6/PostgreSQL 18, Zod 4, Vitest, Nuxt 4/Vue 3, Playwright CI.

**Spec:** [2026-09-08-stage-5-plans-notifications-design.md](../specs/2026-09-08-stage-5-plans-notifications-design.md)

## Global Constraints

- Все пользовательские queries/mutations filter-ят `workspace_id` и `budget_id` в SQL; чужие IDs возвращают `404 RESOURCE_NOT_FOUND`.
- Суммы: PostgreSQL `BIGINT`; HTTP принимает decimal string и возвращает canonical integer string. Float запрещён.
- Только `CONFIRMED` фактические records меняют balances, limits и reports. План и occurrence никогда этого не делают.
- Mutations используют существующий `Idempotency-Key` contract, CSRF guard и Problem Details/OpenAPI schemas.
- Финансовые rules живут в server-side application services/repositories; controller не вычисляет деньги и не обращается к Prisma напрямую.
- Все plan/occurrence/notification changes создают allowlisted audit event. Worker использует `source = WORKER`, `actorUserId = null`.
- UI, validation и user-facing errors — русский; identifiers/API/schema — английский.
- Redis, external delivery, import, bank integrations, multi-currency conversion, plan-vs-actual analytics и browser E2E локально не добавлять.
- Playwright scenarios писать только для CI; `pnpm test:e2e` локально не запускать без нового явного разрешения.

---

## File map

| Path | Responsibility |
|---|---|
| `prisma/schema.prisma` | Stage 5 enums, relations, models and indexes declared through Prisma. |
| `prisma/migrations/20260908000000_stage_5_plans_notifications/migration.sql` | Additive PostgreSQL types/tables/checks/composite FKs and partial unique indexes. |
| `apps/api/src/plans/*` | Plan CRUD, occurrence actions and OpenAPI boundary. |
| `apps/api/src/plans/plan-occurrence.repository.ts` | Locking/link lifecycle shared by plans and transactions without controller coupling. |
| `apps/api/src/notifications/*` | Recipient-scoped notification inbox and read state. |
| `apps/api/src/transactions/*` | Complete linked occurrence atomically when existing draft is confirmed. |
| `apps/api/src/dashboard/*` | Trusted server projection for five upcoming obligations. |
| `apps/worker/src/*` | Prisma lifecycle, durable job claims, recurrence, materialization and notifications. |
| `apps/web/app/composables/useBudgetReferenceData.ts` | New API DTOs, methods and safe encoded paths. |
| `apps/web/app/pages/app/{plans,notifications}.vue` | Protected responsive Stage 5 pages. |
| `apps/web/app/components/{plans,notifications,dashboard}/*` | Focused form/card/list presentation components. |
| `apps/api/test/*` and `apps/web/app/**/*.test.ts` | PostgreSQL integration and browser-free UI proof. |
| `e2e/stage-5-plans-notifications.spec.ts` | CI-only critical browser journey. |

### Task 1: Persistence, additive migration and generated client

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260908000000_stage_5_plans_notifications/migration.sql`
- Create: `apps/api/test/plans-notifications-migration.integration.test.ts`
- Modify: API integration cleanup helpers in `apps/api/test/dashboard-summary.integration.test.ts`, `apps/api/test/operations.integration.test.ts`, `apps/api/test/transfers.integration.test.ts`, `apps/api/test/cycles.integration.test.ts`, `apps/api/test/journal.integration.test.ts`, `apps/api/test/reports.integration.test.ts`, `apps/api/test/transaction-lifecycle.integration.test.ts`

**Interfaces:**
- Produces Prisma enums `RegularPlanType`, `PlanRecurrence`, `PlanOccurrenceStatus`, `PlanOccurrenceCancellationReason`, `WorkerJobType`, `WorkerJobStatus`, `NotificationType`.
- Produces models `RegularPlan`, `PlanOccurrence`, `Notification`, `WorkerJob` plus `Budget`, `Transaction`, `User` relations.
- Consumed by every later task through generated `@prisma/client` delegates and enum values.

- [ ] **Step 1: Write failing migration integration tests**

```ts
it('rejects duplicate actionable occurrence date for one plan', async () => {
  await prisma.planOccurrence.create({ data: occurrence(planId, '2026-09-10') });
  await expect(
    prisma.planOccurrence.create({ data: occurrence(planId, '2026-09-10') }),
  ).rejects.toMatchObject({ code: 'P2002' });
});

it('allows only one unresolved negative-account notification episode', async () => {
  await prisma.notification.create({ data: stateNotification('NEGATIVE_ACCOUNT', accountId) });
  await expect(
    prisma.notification.create({ data: stateNotification('NEGATIVE_ACCOUNT', accountId) }),
  ).rejects.toMatchObject({ code: 'P2002' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @harmofin/api test:integration -- plans-notifications-migration.integration.test.ts`

Expected: FAIL because Stage 5 Prisma delegates and migration do not exist.

- [ ] **Step 3: Extend Prisma contract**

Add all four models and enum declarations from design. Keep `RegularPlan` and `PlanOccurrence` snapshots amount-bearing with `BigInt`; add `Transaction.planOccurrence` as nullable one-to-one inverse. Add `Budget.regularPlans`, `Budget.planOccurrences`, `Budget.notifications`, and `User.notifications`. Model core relation shape exactly:

```prisma
model PlanOccurrence {
  id            String               @id @db.Uuid
  workspaceId   String               @map("workspace_id") @db.Uuid
  budgetId      String               @map("budget_id") @db.Uuid
  planId        String               @map("plan_id") @db.Uuid
  scheduledOn   DateTime             @map("scheduled_on") @db.Date
  status        PlanOccurrenceStatus @default(PENDING)
  transactionId String?              @unique @map("transaction_id") @db.Uuid
  plan          RegularPlan          @relation(fields: [planId, budgetId], references: [id, budgetId])
  transaction   Transaction?         @relation(fields: [transactionId, budgetId], references: [id, budgetId])

  @@index([budgetId, status, scheduledOn])
  @@index([planId, scheduledOn])
  @@map("plan_occurrences")
}
```

- [ ] **Step 4: Write additive SQL migration**

Create PostgreSQL enums/tables without altering or dropping existing financial columns. Add `CHECK` constraints for positive amounts, `end_on >= start_on`, valid interval/recurrence pairing and terminal lifecycle timestamps. Add composite same-budget foreign keys, including occurrence-to-plan/transaction. Add migration-only partial unique indexes, including one actionable occurrence per plan date:

```sql
CREATE UNIQUE INDEX "plan_occurrences_active_plan_date_key"
  ON "plan_occurrences" ("plan_id", "scheduled_on")
  WHERE "status" <> 'CANCELLED';

CREATE UNIQUE INDEX "notifications_unresolved_state_warning_key"
  ON "notifications" (
    "budget_id", "user_id", "notification_type", "related_entity_type", "related_entity_id"
  )
  WHERE "resolved_at" IS NULL
    AND "occurrence_id" IS NULL
    AND "related_entity_type" IS NOT NULL
    AND "related_entity_id" IS NOT NULL;
```

Use `ON DELETE RESTRICT` for financial/history relations. Do not backfill plans, occurrences or notifications.

- [ ] **Step 5: Regenerate Prisma client and run migration test**

Run: `pnpm db:generate && pnpm db:migrate && pnpm --filter @harmofin/api test:integration -- plans-notifications-migration.integration.test.ts`

Expected: PASS; duplicate occurrence and unresolved warning constraints reject concurrent duplicate rows.

- [ ] **Step 6: Update integration cleanup order**

Delete Stage 5 dependent rows before `transactions`, `accounts`, `categories`, `envelopes`, `budgets`, memberships and workspace. Every existing integration suite retains foreign-key-safe cleanup.

- [ ] **Step 7: Run focused regression tests**

Run: `pnpm --filter @harmofin/api exec vitest run --config vitest.integration.config.ts test/dashboard-summary.integration.test.ts test/operations.integration.test.ts test/transaction-lifecycle.integration.test.ts test/transfers.integration.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit Task 1**

```bash
git add prisma/schema.prisma prisma/migrations/20260908000000_stage_5_plans_notifications apps/api/test
git commit -m "feat: add plans and notifications persistence"
```

### Task 2: Regular plan API, occurrence lifecycle and audit

**Files:**
- Create: `apps/api/src/plans/plans.module.ts`
- Create: `apps/api/src/plans/regular-plan.repository.ts`
- Create: `apps/api/src/plans/plan-occurrence.repository.ts`
- Create: `apps/api/src/plans/regular-plan.application.service.ts`
- Create: `apps/api/src/plans/plans.controller.ts`
- Create: `apps/api/src/plans/plans.schemas.ts`
- Create: `apps/api/src/plans/plans.dto.ts`
- Create: `apps/api/src/plans/regular-plan.application.service.test.ts`
- Create: `apps/api/test/plans.integration.test.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Produces `RegularPlanApplicationService.list|get|create|update|remove|listOccurrences|skipOccurrence|completeOccurrence|createDraftFromOccurrence`.
- Produces `PlanOccurrenceRepository.completeForConfirmedTransaction(tx, transactionId, actorUserId, requestId)` for Task 5.
- Consumes `IdempotencyService`, `TransactionRepository`, existing role/money/reference patterns and Task 1 Prisma contract.

- [ ] **Step 1: Write failing application-service tests**

```ts
it('cancels only future pending occurrences when plan changes', async () => {
  await service.update(ownerId, budgetId, planId, { amount: '1500' }, key);
  expect(repository.cancelled).toEqual([
    expect.objectContaining({ scheduledOn: '2026-09-12', reason: 'PLAN_CHANGED' }),
  ]);
  expect(repository.cancelled).not.toContainEqual(
    expect.objectContaining({ scheduledOn: '2026-09-08' }),
  );
});

it('rejects creating a transaction draft for savings', async () => {
  await expect(service.createDraftFromOccurrence(ownerId, budgetId, savingsOccurrenceId, key))
    .rejects.toMatchObject({ status: 409, response: { code: 'PLAN_TYPE_NOT_TRANSACTIONAL' } });
});
```

- [ ] **Step 2: Run unit test to verify it fails**

Run: `pnpm --filter @harmofin/api test -- regular-plan.application.service.test.ts`

Expected: FAIL because plans module is absent.

- [ ] **Step 3: Define strict Zod and Swagger contracts**

Implement `CreateRegularPlanInput`, `UpdateRegularPlanInput`, occurrence filters and DTOs. Decimal `amount` is parsed only in application service. Request uses `anchorOn`, `startOn`, `endOn`, `recurrence`, `intervalMonths`, default reference IDs, comment and `isActive`; `.superRefine` enforces recurrence shape. Response exposes canonical `amountMinor`, never float. Document every endpoint with `ApiCookieAuth`, request, response and `ProblemDetailsResponse` for 400/401/403/404/409/422.

```ts
export type PlanOccurrenceAction = 'SKIP' | 'COMPLETE';

export interface PlanOccurrenceView {
  id: string;
  planId: string;
  planType: 'INCOME' | 'EXPENSE' | 'SAVINGS';
  scheduledOn: string;
  status: 'PENDING' | 'DUE' | 'SKIPPED' | 'COMPLETED' | 'CANCELLED';
  amountMinor: string;
  transactionId: string | null;
}
```

- [ ] **Step 4: Implement scoped repository and lifecycle writes**

Every plan/occurrence lookup includes `budgetId` plus active membership condition. Mutation lookups first lock row through `FOR UPDATE`, then re-query scoped ownership. Repository writes audit records in same transaction with allowlists named in design. It exposes no unscoped `findUnique` by object ID.

```ts
async findOccurrenceForMutation(
  tx: Prisma.TransactionClient,
  userId: string,
  budgetId: string,
  occurrenceId: string,
): Promise<OccurrenceRecord | null>;
```

- [ ] **Step 5: Implement service rules and controller**

Use `OWNER|EDITOR` for create/update/disable/skip/complete/create-draft, `OWNER` only for delete. On update/disable/delete, cancel only future `PENDING` occurrences in same write transaction. Skip/manual complete require `PENDING|DUE`; terminal states yield `OCCURRENCE_STATE_INVALID` conflict. `createDraftFromOccurrence` locks occurrence, validates type `INCOME|EXPENSE`, validates current references, uses `IdempotencyService` operation `plan-occurrence.create-draft:<occurrenceId>`, creates one DRAFT `Transaction`, links it and emits audits.

- [ ] **Step 6: Write PostgreSQL integration tests**

Cover owner list/create/read/update/delete, editor mutation and non-member `404`; foreign plan/occurrence `404`; category/envelope type/archived validation; integer string round-trip; edit/disable/delete cancellation boundaries; skip/manual complete; duplicate draft replay and idempotency conflict; audit values excluding full body.

- [ ] **Step 7: Run focused tests**

Run: `pnpm --filter @harmofin/api exec vitest run --config vitest.config.ts src/plans/regular-plan.application.service.test.ts && pnpm --filter @harmofin/api exec vitest run --config vitest.integration.config.ts test/plans.integration.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit Task 2**

```bash
git add apps/api/src/plans apps/api/src/app.module.ts apps/api/test/plans.integration.test.ts
git commit -m "feat: add regular plan API"
```

### Task 3: Durable worker scheduler and occurrence materialization

**Files:**
- Modify: `apps/worker/package.json`
- Modify: `apps/worker/src/config.ts`
- Modify: `apps/worker/src/config.test.ts`
- Modify: `apps/worker/src/main.ts`
- Modify: `apps/worker/src/runtime.ts`
- Modify: `apps/worker/src/runtime.test.ts`
- Create: `apps/worker/src/database.ts`
- Create: `apps/worker/src/job.repository.ts`
- Create: `apps/worker/src/job-runner.ts`
- Create: `apps/worker/src/job-runner.test.ts`
- Create: `apps/worker/src/recurrence.ts`
- Create: `apps/worker/src/recurrence.test.ts`
- Create: `apps/worker/src/plan-occurrence.handler.ts`
- Create: `apps/worker/src/plan-occurrence.handler.test.ts`
- Create: `apps/api/test/worker-occurrences.integration.test.ts`

**Interfaces:**
- Produces `datesForPlanInWindow(plan, { from, to }): string[]` and `WorkerJobRepository.claimDue(limit, now)`.
- Produces `JobRunner.start(): Promise<void>` and `JobRunner.stop(): Promise<void>` consumed by `WorkerRuntime`.
- Consumes `WorkerJob`/plan schemas from Task 1; no HTTP API dependency.

- [ ] **Step 1: Write failing recurrence tests**

```ts
it.each([
  ['monthly 31 clamps in non-leap February', monthlyPlan('2026-01-31'), '2026-02-28'],
  ['yearly leap-day clamps in 2027', yearlyPlan('2024-02-29'), '2027-02-28'],
  ['every three months preserves anchor', everyMonthsPlan('2026-01-31', 3), '2026-04-30'],
])('%s', (_name, plan, expected) => {
  expect(datesForPlanInWindow(plan, range('2026-01-01', '2027-12-31'))).toContain(expected);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @harmofin/worker test -- recurrence.test.ts`

Expected: FAIL because recurrence module is absent.

- [ ] **Step 3: Add database configuration and lifecycle**

Add `@prisma/client` dependency to worker and `DATABASE_URL`, poll interval, concurrency and lease configuration. `database.ts` creates/disconnects `PrismaClient`; worker startup connects, upserts only missing singleton jobs and starts runner. Shutdown stops claiming, waits in-flight handlers, closes Prisma, then emits existing stopped log.

```ts
export interface WorkerConfig {
  databaseUrl: string;
  pollIntervalMs: number;
  concurrency: number;
  leaseSeconds: number;
  nodeEnv: 'development' | 'test' | 'production';
  logLevel: LogLevel;
}
```

- [ ] **Step 4: Implement recurrence and materialization handler**

Implement pure date arithmetic in `recurrence.ts`; it must derive local today with budget timezone and output only ISO dates. Handler transaction order: move `PENDING` records due today/past to `DUE`, load active non-deleted plans, generate `[today - 7, today + 60]`, bulk insert `skipDuplicates`, then write worker audit events for rows actually inserted or transitioned. It must not inspect or change balances, transactions, allocations, transfers or reports.

- [ ] **Step 5: Implement atomic job claims, retry and lease recovery**

Use raw PostgreSQL `FOR UPDATE SKIP LOCKED` within transaction and include expired `RUNNING` leases in claim predicate. Mark claim `RUNNING`, increment attempt and assign lease atomically. On success requeue same singleton row for 5 minutes; on error retry five times with `min(30_000 * 2 ** (attempts - 1), 1_800_000)`, then set `FAILED`. Store error class/message max 500 characters.

```ts
export interface ClaimedJob {
  id: string;
  jobType: 'MATERIALIZE_PLAN_OCCURRENCES' | 'EVALUATE_BUDGET_NOTIFICATIONS';
  attempts: number;
}

claimDue(limit: number, now: Date): Promise<ClaimedJob[]>;
```

- [ ] **Step 6: Write worker and database integration tests**

`job-runner.test.ts` uses two repository instances against test database to prove one claim executes once. Integration verifies materialization rerun creates no duplicate, restart reclaims expired lease, five transient failures end `FAILED`, short backfill excludes ancient occurrences, and dates transition `PENDING` to `DUE` without changing balances.

- [ ] **Step 7: Run focused worker proof**

Run: `pnpm --filter @harmofin/worker test && pnpm --filter @harmofin/api test:integration -- worker-occurrences.integration.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit Task 3**

```bash
git add apps/worker apps/api/test/worker-occurrences.integration.test.ts pnpm-lock.yaml
git commit -m "feat: materialize plan occurrences in worker"
```

### Task 4: Internal notification rules and inbox API

**Files:**
- Create: `apps/api/src/notifications/notifications.module.ts`
- Create: `apps/api/src/notifications/notification.repository.ts`
- Create: `apps/api/src/notifications/notification.application.service.ts`
- Create: `apps/api/src/notifications/notifications.controller.ts`
- Create: `apps/api/src/notifications/notifications.schemas.ts`
- Create: `apps/api/src/notifications/notifications.dto.ts`
- Create: `apps/api/src/notifications/notification.application.service.test.ts`
- Create: `apps/worker/src/notification.handler.ts`
- Create: `apps/worker/src/notification.handler.test.ts`
- Create: `apps/api/test/notifications.integration.test.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/worker/src/job-runner.ts`

**Interfaces:**
- Produces `NotificationApplicationService.list|markRead|markAllRead`.
- Produces `NotificationRuleHandler.execute(now): Promise<void>` for `EVALUATE_BUDGET_NOTIFICATIONS`.
- Consumes Task 1 constraints, Task 3 claim runner, existing confirmed-only balance queries.

- [ ] **Step 1: Write failing rule tests**

```ts
it('creates one today notification per due occurrence', async () => {
  await handler.execute(nowInBudgetTimezone('2026-09-10'));
  await handler.execute(nowInBudgetTimezone('2026-09-10'));
  expect(await notificationsFor(occurrenceId, 'PLAN_TODAY')).toHaveLength(1);
});

it('resolves then reopens negative account episode', async () => {
  await setAccountBalance(-1n); await handler.execute(now);
  await setAccountBalance(0n); await handler.execute(now);
  await setAccountBalance(-1n); await handler.execute(now);
  expect(await negativeEpisodes(accountId)).toHaveLength(2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @harmofin/worker test -- notification.handler.test.ts`

Expected: FAIL because notification handler is absent.

- [ ] **Step 3: Implement trusted worker rules**

Use only active budgets and owner recipient. Implement per-occurrence upcoming(+3), today and overdue templates/keys. Implement state conditions only from confirmed transactions, allocations and transfers. Mandatory deficit equals confirmed current mandatory-envelope balance minus uncompleted expense occurrence amounts in inclusive `[today, today + 30]`; all queries contain target `budget_id`. Insert with unique key and resolve matching unresolved state warning when false. Requeue this job after 15 minutes.

- [ ] **Step 4: Implement recipient-scoped inbox boundary**

List unread first then `createdAt DESC,id DESC` with signed/validated opaque cursor matching existing journal approach. Reads include active membership and `userId = actorId`; mark-one and mark-all write allowlisted audit records in transaction. Never accept title, body, action path, recipient or related object from client.

```ts
export type NotificationListView = {
  items: NotificationView[];
  nextCursor: string | null;
};

markRead(userId: string, budgetId: string, notificationId: string, key: string): Promise<NotificationView>;
```

- [ ] **Step 5: Add OpenAPI contracts and module registration**

Document list state `unread|read|all`, cursor/limit, notification response and Problem Details. Mutations require CSRF and idempotency header; `POST /notifications/read-all` hashes `{}` with operation `notification.read-all`.

- [ ] **Step 6: Write integration tests**

Prove each of seven rules, duplicate occurrence notification prevention, state resolution/reopen, recipient isolation `404`, foreign budget `404`, read/read-all replay, Russian payload values, audit allowlist and no draft/cancelled/deleted financial record contributing to warning.

- [ ] **Step 7: Run focused tests**

Run: `pnpm --filter @harmofin/worker test -- notification.handler.test.ts && pnpm --filter @harmofin/api test:integration -- notifications.integration.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit Task 4**

```bash
git add apps/api/src/notifications apps/worker/src apps/api/test/notifications.integration.test.ts
git commit -m "feat: add internal notifications"
```

### Task 5: Link confirmed actual operations to occurrences

**Files:**
- Modify: `apps/api/src/plans/plan-occurrence.repository.ts`
- Modify: `apps/api/src/plans/regular-plan.application.service.ts`
- Modify: `apps/api/src/plans/plans.controller.ts`
- Modify: `apps/api/src/transactions/transaction.application.service.ts`
- Modify: `apps/api/src/transactions/transaction.module.ts`
- Modify: `apps/api/src/transactions/transaction.repository.ts`
- Modify: `apps/api/src/transactions/transaction.application.service.test.ts`
- Create: `apps/api/test/plan-occurrence-transaction.integration.test.ts`

**Interfaces:**
- Consumes `PlanOccurrenceRepository.completeForConfirmedTransaction` from Task 2.
- Produces one transactional confirmation flow preserving existing `TransactionResponse` contract.

- [ ] **Step 1: Write failing integration tests**

```ts
it('creates a single editable DRAFT and completes occurrence only after confirm', async () => {
  const draft = await createOccurrenceDraft();
  expect(draft.status).toBe('DRAFT');
  expect(await occurrenceStatus()).toBe('DUE');

  await confirmTransaction(draft.id, idempotencyKey);
  expect(await occurrenceStatus()).toBe('COMPLETED');
  expect(await linkedTransactionId()).toBe(draft.id);
});

it('does not let a cancelled draft create a second financial movement', async () => {
  await cancelLinkedDraft();
  await expect(createOccurrenceDraft()).rejects.toMatchObject({ status: 409 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @harmofin/api test:integration -- plan-occurrence-transaction.integration.test.ts`

Expected: FAIL before linked lifecycle behavior exists.

- [ ] **Step 3: Complete occurrence in existing confirm transaction**

After `TransactionRepository.updateLifecycle(..., 'CONFIRMED', ...)` returns, `TransactionApplicationService.confirm` calls injected `PlanOccurrenceRepository.completeForConfirmedTransaction` using same Prisma transaction. Repository locks by `(transactionId, budgetId)`, ignores unrelated transactions, changes only linked `PENDING|DUE` occurrence to `COMPLETED`, sets `completedAt`/actor and writes occurrence audit. No plan controller calls transaction controller; no confirmed create endpoint is added.

- [ ] **Step 4: Preserve exact-one draft and idempotency behavior**

Occurrence draft mutation must replay same draft response for same key/body and reject mismatched key/body through existing `IDEMPOTENCY_CONFLICT`. Linked draft can be edited and confirmed through existing transaction endpoints. Cancel/delete leave occurrence uncompleted and linked; skip/manual complete after draft exists returns lifecycle conflict to preserve audit/provenance.

- [ ] **Step 5: Extend unit tests**

Add tests proving unrelated confirmed transaction does not invoke occurrence write, linked occurrence update shares transaction rollback, confirmation replay produces no second occurrence audit, and insufficient balance leaves both transaction and occurrence unchanged.

- [ ] **Step 6: Run focused regression suite**

Run: `pnpm --filter @harmofin/api test -- transaction.application.service.test.ts regular-plan.application.service.test.ts && pnpm --filter @harmofin/api exec vitest run --config vitest.integration.config.ts test/plan-occurrence-transaction.integration.test.ts test/transaction-lifecycle.integration.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit Task 5**

```bash
git add apps/api/src/plans apps/api/src/transactions apps/api/test/plan-occurrence-transaction.integration.test.ts
git commit -m "feat: link occurrence drafts to transactions"
```

### Task 6: Dashboard upcoming-obligations server projection

**Files:**
- Modify: `apps/api/src/dashboard/dashboard.repository.ts`
- Modify: `apps/api/src/dashboard/dashboard.application.service.ts`
- Modify: `apps/api/src/dashboard/dashboard.dto.ts`
- Modify: `apps/api/src/dashboard/dashboard.application.service.test.ts`
- Modify: `apps/api/test/dashboard-summary.integration.test.ts`
- Create: `apps/web/app/components/dashboard/UpcomingObligations.vue`
- Create: `apps/web/app/components/dashboard/UpcomingObligations.test.ts`
- Modify: `apps/web/app/pages/app/index.vue`
- Modify: `apps/web/app/pages/app/index.test.ts`

**Interfaces:**
- Produces `DashboardSummary.upcomingObligations: UpcomingObligation[]`.
- Consumed by dashboard UI only; no client arithmetic and no side effect.

- [ ] **Step 1: Write failing API unit/integration tests**

```ts
expect(summary.upcomingObligations).toEqual([
  expect.objectContaining({ occurrenceId, scheduledOn: '2026-09-10', amountMinor: '3600000' }),
]);
expect(summary.upcomingObligations).not.toContainEqual(
  expect.objectContaining({ status: 'SKIPPED' }),
);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @harmofin/api test -- dashboard.application.service.test.ts && pnpm --filter @harmofin/api test:integration -- dashboard-summary.integration.test.ts`

Expected: FAIL because response lacks `upcomingObligations`.

- [ ] **Step 3: Add scoped SQL projection**

Repository query returns at most five `PENDING|DUE` `EXPENSE` occurrences where scheduled date is on/after local today, ordered `scheduled_on ASC, created_at ASC, id ASC`, and joins accessible active budget in SQL. Application service serializes amount as canonical integer string and builds fixed relative `/app/plans?occurrence=<uuid>` action path.

```ts
upcomingObligations: Array<{
  occurrenceId: string;
  planName: string;
  scheduledOn: string;
  amountMinor: string;
  currency: 'RUB';
  scale: 2;
  status: 'PENDING' | 'DUE';
  envelopeId: string | null;
  actionPath: string;
}>;
```

- [ ] **Step 4: Add accessible dashboard component**

`UpcomingObligations.vue` renders title, date, amount and status text; empty state remains visible. Link uses API-provided relative path. On small screens it becomes one-column with no horizontal scroll. Test rendered data, empty state and link destination.

- [ ] **Step 5: Run focused tests**

Run: `pnpm --filter @harmofin/api test -- dashboard.application.service.test.ts && pnpm --filter @harmofin/api test:integration -- dashboard-summary.integration.test.ts && pnpm --filter @harmofin/web test -- UpcomingObligations.test.ts index.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit Task 6**

```bash
git add apps/api/src/dashboard apps/api/test/dashboard-summary.integration.test.ts apps/web/app/components/dashboard apps/web/app/pages/app/index.*
git commit -m "feat: show upcoming obligations on dashboard"
```

### Task 7: Plans web page and operation-draft navigation

**Files:**
- Create: `apps/web/app/components/plans/PlanForm.vue`
- Create: `apps/web/app/components/plans/PlanForm.test.ts`
- Create: `apps/web/app/components/plans/PlanCard.vue`
- Create: `apps/web/app/components/plans/PlanOccurrenceCard.vue`
- Create: `apps/web/app/pages/app/plans.vue`
- Create: `apps/web/app/pages/app/plans.test.ts`
- Modify: `apps/web/app/composables/useBudgetReferenceData.ts`
- Modify: `apps/web/app/pages/app/operations.vue`
- Modify: `apps/web/app/pages/app/operations.test.ts`
- Modify: `apps/web/app/pages/app/index.vue`

**Interfaces:**
- Consumes `RegularPlanDto`, `PlanOccurrenceDto`, and `createOccurrenceDraft` client methods.
- Produces protected `/app/plans` and `/app/operations?draftId=<uuid>` behavior.

- [ ] **Step 1: Extend web contract with exact DTOs/methods**

Add plan/occurrence enums and DTO interfaces matching Swagger fields. Add `listPlans`, `createPlan`, `updatePlan`, `deletePlan`, `listPlanOccurrences`, `skipPlanOccurrence`, `completePlanOccurrence`, `createPlanOccurrenceDraft`. Every mutation passes stable per-action UUID key and uses existing `useApiClient` CSRF behavior.

- [ ] **Step 2: Write failing component/page tests**

```ts
it('opens a returned draft in operations editor', async () => {
  api.createPlanOccurrenceDraft.mockResolvedValue({ id: 'draft-id', status: 'DRAFT' });
  await wrapper.get('[data-action="create-occurrence-draft"]').trigger('click');
  expect(navigateTo).toHaveBeenCalledWith('/app/operations?draftId=draft-id');
});

it('does not offer transaction draft action for savings occurrence', () => {
  expect(wrapper.text()).not.toContain('Создать черновик');
  expect(wrapper.text()).toContain('Отметить выполненным');
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @harmofin/web test -- PlanForm.test.ts plans.test.ts operations.test.ts`

Expected: FAIL because page/components/client methods are absent.

- [ ] **Step 4: Implement plan form and page state**

Form selects plan type and recurrence, conditionally requires N-month interval, displays labelled date/amount/reference controls and server field errors. Page loads plan/occurrence/reference data from server; supports create/edit/disable/delete/skip/manual complete through accessible `UiConfirmDialog`. It never computes a due date, currency amount or balance locally.

- [ ] **Step 5: Implement draft navigation and operations preload**

After API returns draft, navigate to exact encoded string `/app/operations?draftId=<uuid>`. On operations page, validate route param as UUID, retrieve server transaction with `getTransaction`, require `DRAFT`, call existing `openEdit`, and clear invalid/foreign access through normal error presentation. User edits and explicitly confirms with existing form.

- [ ] **Step 6: Add responsive/accessibility proof**

Test page loading/error/empty states, Russian buttons/status messages, server field errors bound to controls plus `role="alert"`, keyboard dialog actions and occurrence link selection from dashboard query. CSS stacks controls/card actions at max-width `47.9375rem`.

- [ ] **Step 7: Run focused web tests**

Run: `pnpm --filter @harmofin/web test -- PlanForm.test.ts plans.test.ts operations.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit Task 7**

```bash
git add apps/web/app/components/plans apps/web/app/pages/app/plans.* apps/web/app/pages/app/operations.* apps/web/app/pages/app/index.vue apps/web/app/composables/useBudgetReferenceData.ts
git commit -m "feat: add plans interface"
```

### Task 8: Notifications web page and navigation

**Files:**
- Create: `apps/web/app/components/notifications/NotificationCard.vue`
- Create: `apps/web/app/components/notifications/NotificationCard.test.ts`
- Create: `apps/web/app/pages/app/notifications.vue`
- Create: `apps/web/app/pages/app/notifications.test.ts`
- Modify: `apps/web/app/composables/useBudgetReferenceData.ts`
- Modify: `apps/web/app/pages/app/index.vue`

**Interfaces:**
- Consumes `NotificationDto`, `listNotifications`, `markNotificationRead`, `markAllNotificationsRead`.
- Produces protected `/app/notifications` with recipient-specific state from server.

- [ ] **Step 1: Write failing page tests**

```ts
it('marks notification read before following server action path', async () => {
  await wrapper.get('[data-action="notification-link"]').trigger('click');
  expect(api.markNotificationRead).toHaveBeenCalledWith('budget-id', 'notification-id', expect.any(String));
  expect(navigateTo).toHaveBeenCalledWith('/app/plans?occurrence=occurrence-id');
});

it('renders unread status as text, not color only', () => {
  expect(wrapper.text()).toContain('Новое');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @harmofin/web test -- NotificationCard.test.ts notifications.test.ts`

Expected: FAIL because inbox page is absent.

- [ ] **Step 3: Add client API methods**

Add cursor list and idempotent mark methods to `BudgetReferenceDataApi`. Do not permit caller-supplied actionPath/title/body. Use `encodeURIComponent` only for IDs in generated endpoints.

- [ ] **Step 4: Implement card/page**

List unread first from API, show title/body/date/read status and controlled relative action link. Link click retains stable idempotency key, attempts mark-read, then navigates only if action path begins `/app/`; malformed server response presents error and does not navigate. Page supplies one `Отметить все прочитанными` action, load-more pagination, retry/error/empty state and `aria-live` status.

- [ ] **Step 5: Add dashboard navigation links**

Add `Планы` and `Уведомления` to protected dashboard navigation. Test both routes, preserving existing operations/accounts/envelopes/analytics links.

- [ ] **Step 6: Run focused tests**

Run: `pnpm --filter @harmofin/web test -- NotificationCard.test.ts notifications.test.ts index.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit Task 8**

```bash
git add apps/web/app/components/notifications apps/web/app/pages/app/notifications.* apps/web/app/composables/useBudgetReferenceData.ts apps/web/app/pages/app/index.*
git commit -m "feat: add notifications interface"
```

### Task 9: Cross-cutting integration and CI-only browser coverage

**Files:**
- Create: `apps/api/test/stage-5-isolation.integration.test.ts`
- Create: `apps/api/test/worker-job-concurrency.integration.test.ts`
- Create: `e2e/stage-5-plans-notifications.spec.ts`
- Modify: `apps/api/test/dashboard-summary.integration.test.ts`
- Modify: `apps/web/app/pages/app/plans.test.ts`
- Modify: `apps/web/app/pages/app/notifications.test.ts`

**Interfaces:**
- Consumes finished API, worker and web interfaces from Tasks 1–8.
- Produces reproducible proof for isolation, roles, idempotency, worker recovery and critical responsive journey.

- [ ] **Step 1: Write isolation/role matrix tests**

```ts
it.each([
  ['foreign owner', foreign.cookie, 404],
  ['member without mutation role', viewer.cookie, 403],
])('%s cannot mutate plan occurrence', async (_label, cookie, statusCode) => {
  const response = await server.inject({ method: 'POST', url: occurrenceSkipUrl, cookies: sessionCookies(cookie) });
  expect(response.statusCode).toBe(statusCode);
});
```

Cover plans, occurrence actions, notifications, dashboard obligations and all linked account/category/envelope IDs.

- [ ] **Step 2: Write concurrent worker proof**

Start two runner instances against one test database, release a barrier before claim, then assert one job handler writes exactly one occurrence/notification event. Expire a lease and assert only one recovery handler completes it. Ensure duplicate retries retain one occurrence/notification per database key.

- [ ] **Step 3: Write CI-only Playwright scenario**

Use existing `e2e` helpers to sign in, create an expense plan, wait for or seed an occurrence through test-supported flow, open `/app/plans`, create draft, edit amount, confirm operation, confirm occurrence status, follow notification link and mark it read. Include narrow viewport assertion that page actions stay reachable. Tag/comment test as CI-only; do not add a local invocation step.

- [ ] **Step 4: Run browser-free coverage only**

Run: `pnpm --filter @harmofin/api test:integration -- stage-5-isolation.integration.test.ts worker-job-concurrency.integration.test.ts && pnpm --filter @harmofin/web test -- plans.test.ts notifications.test.ts`

Expected: PASS. Do not run `pnpm test:e2e` locally.

- [ ] **Step 5: Commit Task 9**

```bash
git add apps/api/test apps/web/app/pages/app e2e/stage-5-plans-notifications.spec.ts
git commit -m "test: cover stage 5 workflows"
```

### Task 10: Final quality gate and review handoff

**Files:**
- Modify only files required by failures found in this task.

**Interfaces:**
- Consumes all Stage 5 contracts.
- Produces verified branch suitable for code review; it makes no release, merge or push.

- [ ] **Step 1: Inspect changed scope**

Run: `git status --short && git diff --check && git diff --stat main...HEAD`

Expected: only Stage 5 code/tests/migration/docs; no secret, generated database file or unrelated user work.

- [ ] **Step 2: Run format and static gates**

Run:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
```

Expected: all commands exit `0`.

- [ ] **Step 3: Run unit and integration gates**

Run:

```bash
pnpm test
pnpm test:integration
```

Expected: all suites exit `0`, including PostgreSQL worker-concurrency and isolation suites.

- [ ] **Step 4: Run build, Compose and migration gates**

Run:

```bash
pnpm build
docker compose -f infra/compose/local.yml config --quiet
pnpm db:migrate
```

Expected: all commands exit `0`. Do not run browser E2E locally.

- [ ] **Step 5: Request code review**

Invoke `superpowers:requesting-code-review`; resolve confirmed findings without scope expansion, then repeat applicable gates.

- [ ] **Step 6: Commit final corrections if any**

```bash
git status --short
git add <only-reviewed-stage-5-paths>
git commit -m "fix: finalize stage 5 quality gates"
```

- [ ] **Step 7: Handoff**

Report branch name, commits, migration name, verification evidence, CI-only Playwright location, and any deliberately excluded work. Do not merge, push, create a PR or delete branch without explicit user approval.

## Plan self-review

- **Spec coverage:** Task 1 maps persistence/constraints; Task 2 maps plans, occurrence lifecycle, API, roles and audits; Task 3 maps recurrence, backfill, jobs, lease/retry/recovery; Task 4 maps all notification rules/inbox; Task 5 maps draft/confirmation provenance; Task 6 maps dashboard; Tasks 7–8 map responsive UI/accessibility; Tasks 9–10 map isolation/concurrency/CI quality proof.
- **No placeholders:** every task has exact paths, named interfaces, red/green command, expected result and commit scope.
- **Type consistency:** plan APIs use `RegularPlan`, `PlanOccurrence`, `Notification`, `WorkerJob`, `PlanOccurrenceRepository` and canonical minor-string DTOs consistently across later tasks.
