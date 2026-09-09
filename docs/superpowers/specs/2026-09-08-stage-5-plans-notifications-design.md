# Stage 5: регулярные планы, occurrences и внутренние уведомления — дизайн

## Статус и границы

Этот документ фиксирует дизайн MVP Stage 5. Он не разрешает начинать production-реализацию до отдельного подтверждения design и implementation plan.

Stage 5 добавляет регулярные планы, materialized occurrences, PostgreSQL-backed worker и внутренний центр уведомлений. План и occurrence не изменяют остатки счетов, конвертов, period limits или reports. Финансовое движение возникает только при явном подтверждении существующей фактической операции пользователем.

В этап не входят import, bank integrations, Telegram, email, push, AI, billing, multi-currency conversion, collaborative UI и plan-vs-actual analytics.

## Термины и инварианты

- `RegularPlan` — активный или отключённый шаблон ожидаемого дохода, расхода либо накопления.
- `PlanOccurrence` — материализованное возникновение плана на конкретную локальную календарную дату бюджета.
- `Notification` — внутреннее уведомление конкретному получателю. Создание уведомления отделено от будущего канала доставки.
- `WorkerJob` — durable запись расписания и lease для отдельного worker-процесса.
- Все суммы хранятся PostgreSQL `BIGINT`; HTTP принимает decimal string и возвращает canonical integer string.
- Все пользовательские reads/writes filter-ят `workspace_id` и `budget_id` в database query. Чужой budget или object ID возвращает `404 RESOURCE_NOT_FOUND`.
- Все plan, occurrence и notification changes создают `AuditEvent`; worker events используют `actorUserId = null` и `source = WORKER`.
- Worker никогда не создаёт подтверждённую операцию автоматически.

## Persistence contract

### Prisma enums

```text
RegularPlanType: INCOME | EXPENSE | SAVINGS
PlanRecurrence: ONE_TIME | MONTHLY | EVERY_N_MONTHS | YEARLY
PlanOccurrenceStatus: PENDING | DUE | SKIPPED | COMPLETED | CANCELLED
PlanOccurrenceCancellationReason: PLAN_CHANGED | PLAN_DISABLED | PLAN_DELETED
WorkerJobType: MATERIALIZE_PLAN_OCCURRENCES | EVALUATE_BUDGET_NOTIFICATIONS
WorkerJobStatus: PENDING | RUNNING | FAILED
NotificationType:
  PLAN_UPCOMING | PLAN_TODAY | PLAN_OVERDUE
  UNALLOCATED_INCOME | NEGATIVE_ACCOUNT | NEGATIVE_ENVELOPE
  INSUFFICIENT_MANDATORY_OBLIGATIONS
```

### `RegularPlan`

`RegularPlan` stores `id`, `workspaceId`, `budgetId`, `name`, `planType`, `amountMinor`, `currency`, `scale`, `anchorOn`, `startOn`, nullable `endOn`, `recurrence`, nullable `intervalMonths`, nullable default `accountId`, nullable `categoryId`, nullable `envelopeId`, nullable `comment`, `isActive`, nullable `disabledAt`, nullable `deletedAt`, timestamps and creator/updater user IDs.

`anchorOn` supplies day-of-month for monthly frequencies and month/day for yearly frequency. `startOn` is first eligible date. For `ONE_TIME`, `anchorOn = startOn`, `intervalMonths = null`; for `MONTHLY` and `YEARLY`, `intervalMonths = null`; for `EVERY_N_MONTHS`, `intervalMonths` is integer from `2` through `120`.

Validation rules:

- amount is positive; `currency = RUB`, `scale = 2`;
- `endOn`, when present, is not before `startOn`;
- `INCOME` category is active `INCOME`; envelope is null;
- `EXPENSE` category is active `EXPENSE` and envelope is active; account remains optional;
- `SAVINGS` category is active `EXPENSE`, envelope is active `SAVINGS_GOAL`, and account remains optional;
- references belong to same active budget; archive after plan creation leaves historical snapshots intact but blocks new draft creation until plan is corrected;
- logical deletion is used. Name uniqueness is not required.

`workspaceId` is denormalized to make isolation auditable and constrained with composite same-workspace/budget relationships in migration. `RegularPlan` has `@@unique([id, budgetId])`, indexes for `(budgetId, isActive, deletedAt)` and scheduling range queries.

### `PlanOccurrence`

`PlanOccurrence` stores `id`, `workspaceId`, `budgetId`, `planId`, `scheduledOn`, snapshot fields (`planName`, `planType`, `amountMinor`, `currency`, `scale`, default account/category/envelope IDs and comment), `status`, nullable `transactionId`, nullable `skippedAt`, `completedAt`, `cancelledAt`, nullable `cancellationReason`, timestamps and nullable action user IDs.

The occurrence snapshot is immutable. A historical action stays intelligible even after plan edits, archive or logical deletion. A cancelled future occurrence remains historical; a later replacement receives a new row and its own immutable snapshot. It has:

- a composite foreign key to `(planId, budgetId)`;
- a composite nullable foreign key to `(transactionId, budgetId)`;
- a partial unique index on `(planId, scheduledOn)` where `status <> CANCELLED`, so only one actionable occurrence exists while a cancelled snapshot can coexist with its replacement;
- one-to-one link to `Transaction` through a unique nullable `transactionId`;
- indexes `(budgetId, status, scheduledOn)` and `(planId, scheduledOn)`.

No occurrence status affects financial calculations. `transactionId` only records provenance; only linked transaction status `CONFIRMED` can complete a transaction-backed occurrence.

### `Notification`

`Notification` stores `id`, `workspaceId`, `budgetId`, `userId`, `notificationType`, nullable `occurrenceId`, nullable `relatedEntityType`, nullable `relatedEntityId`, `title`, `body`, nullable relative `actionPath`, `notificationKey`, nullable `readAt`, nullable `resolvedAt`, timestamps.

`notificationKey` makes insertion idempotent through `@@unique([budgetId, userId, notificationKey])`:

- occurrence keys: `occurrence:<occurrenceId>:<notificationType>`;
- state-warning keys include notification type, related object, and its current unresolved episode ID.

Migration creates a partial unique index for unresolved state warnings: `(budget_id, user_id, notification_type, related_entity_type, related_entity_id) WHERE resolved_at IS NULL`. When condition clears, worker sets `resolvedAt`; a later recurrence becomes a new episode and notification. `PLAN_*` rows never use `resolvedAt`.

The API exposes server-produced relative action paths only. It never accepts an arbitrary URL. Notification body is Russian, generated by trusted rule templates and no full financial payload enters audit or logs.

### `WorkerJob`

`WorkerJob` stores `id`, `jobType`, versioned JSON `payload`, unique `jobKey`, `status`, `attempts`, `runAt`, nullable `lockedAt`, nullable `leaseExpiresAt`, nullable `lastRunAt`, nullable `completedAt`, nullable sanitized `lastError`, timestamps.

Two singleton jobs exist:

```text
plans:materialize-v1             MATERIALIZE_PLAN_OCCURRENCES
notifications:evaluate-budget-v1 EVALUATE_BUDGET_NOTIFICATIONS
```

Each job has `payload = { "version": 1 }`. Worker upserts both on startup without resetting a non-expired running lease or a failed job. A completed recurring execution transitions same row to `PENDING` with next `runAt`, `attempts = 0`, cleared lease and error. A terminal `FAILED` row remains observable until an operator explicitly resets it in database tooling; Stage 5 adds no public recovery endpoint.

## Calendar and occurrence lifecycle

### Recurrence calculation

All scheduling uses budget timezone to determine local `today`; persisted occurrence dates remain PostgreSQL `DATE` values.

- `ONE_TIME`: exactly `startOn`.
- `MONTHLY`: every month after `startOn`, anchored to `anchorOn` day.
- `EVERY_N_MONTHS`: every Nth month counted from `startOn` month, anchored to `anchorOn` day.
- `YEARLY`: every year in `anchorOn` month/day, starting from `startOn`.
- A missing day is clamped to last calendar day of target month. Thus anchor 31 occurs on 28 February in non-leap years, 29 February in leap years, and 30 April; anchor 29 follows same rule. The original anchor is never rewritten.
- Dates before `startOn` or after inclusive `endOn` do not exist.

Worker materializes dates in `[localToday - 7 calendar days, localToday + 60 calendar days]`. This bounded backfill recovers short outages and prevents creating years of old history after first deployment or re-enabling a plan. A partial unique index for non-cancelled `(planId, scheduledOn)` rows and insert-on-conflict-do-nothing make repeated runs safe while allowing replacement snapshots after a plan change.

### State transitions

```text
PENDING --scheduled date reaches local today--> DUE
PENDING | DUE --skip--> SKIPPED
PENDING | DUE --manual complete--> COMPLETED
PENDING | DUE --linked draft becomes CONFIRMED--> COMPLETED
PENDING --future plan revision/disable/delete--> CANCELLED
```

`SKIPPED`, `COMPLETED` and `CANCELLED` are terminal. Missing or cancelled linked drafts leave occurrence `DUE`; user may edit, restore or confirm that existing draft, but cannot create a second transaction for same occurrence. `COMPLETED` may have null `transactionId` after explicit manual completion. Skipping never creates a financial record.

### Plan change, disable and deletion

- Updating a plan keeps past and current-date occurrences unchanged. It cancels only `PENDING` occurrences with `scheduledOn > localToday`, reason `PLAN_CHANGED`; next materialization creates replacements from new snapshot.
- Disabling works identically with reason `PLAN_DISABLED`, sets `isActive = false` and blocks future materialization. Current due occurrence remains actionable.
- Deletion sets `deletedAt`, disables plan, and cancels only future pending occurrences with reason `PLAN_DELETED`.
- Plan edits, disable, delete and resulting occurrence cancellations occur in one transaction and write separate allowlisted audit events.

## Actual-operation flow

`INCOME` and `EXPENSE` occurrences expose `Создать черновик`. This idempotent API mutation locks occurrence, validates active same-budget references, creates exactly one existing `Transaction` in `DRAFT` state with `isPlanned = true`, links it to occurrence and returns `TransactionResponse`. Web opens existing operation edit form prefilled from that draft. User may change amount, date, account, category, envelope and comment, then explicitly uses existing confirmation flow. Confirmation atomically marks linked occurrence `COMPLETED` and writes its audit event.

`SAVINGS` plan remains a non-financial reminder in Stage 5. It exposes `Отметить выполненным` and `Пропустить`, but not a synthetic expense, transfer or allocation. Existing model cannot correctly create a savings movement from amount/category/envelope alone: income allocation requires a concrete income, while transfer requires source and destination accounts/envelopes. Inventing either would violate financial correctness. A future approved flow may collect those missing references; it is excluded from this stage.

No endpoint in Stage 5 creates a confirmed transaction. Existing transaction create/confirm idempotency guarantees remain mandatory. The occurrence-draft endpoint has operation name `plan-occurrence.create-draft:<occurrenceId>` and hashes its empty body; retries replay same draft response.

## Worker, leases and recovery

Worker receives `DATABASE_URL`, `WORKER_POLL_INTERVAL_MS` default `30000`, `WORKER_CONCURRENCY` default `1`, and `WORKER_LEASE_SECONDS` default `300`. It owns a Prisma client and starts only after database connection and singleton job upsert succeed.

Claim uses one SQL transaction with `FOR UPDATE SKIP LOCKED` over rows due now or `RUNNING` with expired lease. It sets `RUNNING`, `lockedAt`, `leaseExpiresAt = now + lease`, increments attempts and returns claimed jobs. Each worker processes at most configured concurrency. A successful handler schedules its own next run (`materialize`: five minutes; `notifications`: fifteen minutes) inside same database transaction that writes its effects and audit events.

Failure stores a sanitized error class capped to 500 characters, clears lease and uses bounded exponential retry: five attempts, `min(30 seconds * 2^(attempts - 1), 30 minutes)`. On fifth failure status becomes `FAILED`; logger emits only job ID/type/attempt/error class, never payload or financial content. Expired leases are safely reclaimed after restart. Job effects are separately idempotent through occurrence and notification database constraints.

Worker materialization first moves eligible `PENDING` occurrences to `DUE`, then inserts bounded-window occurrences. Notification evaluation uses only active budgets and their owner as MVP recipient. Every worker query includes target budget and workspace relationship; it never trusts IDs from job payload.

## Notification rules

Worker evaluates these rules in budget local date and uses notification templates in Russian:

1. `PLAN_UPCOMING`: active pending occurrence exactly three local calendar days away.
2. `PLAN_TODAY`: occurrence scheduled today and status `DUE`.
3. `PLAN_OVERDUE`: `DUE` occurrence scheduled before today.
4. `UNALLOCATED_INCOME`: confirmed income total minus confirmed allocations is positive.
5. `NEGATIVE_ACCOUNT`: confirmed account balance is negative.
6. `NEGATIVE_ENVELOPE`: confirmed envelope balance is negative.
7. `INSUFFICIENT_MANDATORY_OBLIGATIONS`: for active `MANDATORY_EXPENSES` envelope, confirmed current envelope balance is less than sum of uncompleted `EXPENSE` occurrences due from today through next 30 local calendar days.

Rules 4–7 are state warnings. Worker resolves their prior unresolved notification when condition becomes false and creates at most one unresolved row per recipient/object/type. Plans notify per occurrence/type, including one upcoming, one today and one overdue notification. An action path points to `/app/plans?occurrence=<uuid>`, relevant account/envelope page, or filtered journal; no external delivery is attempted.

## API and authorization contract

All endpoints live below `/api/v1/budgets/:budgetId`, use session cookie authentication, Swagger request/response/error schemas, and `CsrfGuard` plus `Idempotency-Key` on mutations.

```text
GET    /plans?status=active|inactive|all
POST   /plans
GET    /plans/:planId
PATCH  /plans/:planId
DELETE /plans/:planId
GET    /plans/occurrences?planId=&status=&from=&to=
POST   /plans/occurrences/:occurrenceId/skip
POST   /plans/occurrences/:occurrenceId/complete
POST   /plans/occurrences/:occurrenceId/create-draft

GET    /notifications?state=unread|read|all&limit=&cursor=
POST   /notifications/:notificationId/read
POST   /notifications/read-all
```

Plan read endpoints require active budget membership. Plan create/update/disable/skip/complete/create-draft require `OWNER` or `EDITOR`; delete requires `OWNER`. Notification list/read requires active membership and `notification.userId = authenticated user`; another recipient's notification returns `404`. Returned role failure is `403`; malformed input is `400 VALIDATION_FAILED`; inaccessible IDs are `404 RESOURCE_NOT_FOUND`; invalid lifecycle, duplicate actual draft and incompatible repeat request are `409`; archived/missing plan references are `422`.

`RegularPlanResponse`, `PlanOccurrenceResponse`, `NotificationResponse`, list responses and dashboard additions use integer strings for all minor amounts and document every enum in OpenAPI. User-facing errors and all UI copy are Russian.

Audit allowlists:

- plan: name, plan type, amount string, recurrence fields, active/default reference IDs, comment and deletion state;
- occurrence: plan ID, scheduled date, type, amount string, lifecycle state, linked transaction ID and cancellation reason;
- notification: type, occurrence/related object ID, action path, `readAt` and `resolvedAt`.

Full notification body, raw request payloads, credentials and balances do not enter audit payloads or logs.

## Dashboard and web contract

`DashboardSummary` gains `upcomingObligations`, a server projection of up to five non-terminal expense occurrences on or after budget local today, ordered by scheduled date then creation time. Each item returns occurrence ID, plan name, scheduled date, amount minor string, currency, scale, status, envelope ID and action path. It does not alter existing balances, warnings or period arithmetic.

`/app/plans` shows active/inactive plans, upcoming/due/overdue occurrences, Russian status text and actions. It loads server state, offers draft creation only for income/expense, and opens `/app/operations` with linked draft selected. `/app/notifications` lists unread first, supports mark-one and mark-all-read, uses server action paths and exposes status text not only color.

Dashboard shows upcoming obligations from API only. Navigation includes `Планы` and `Уведомления`. Pages use protected routes, semantic headings, visible focus, labelled controls, field-level errors plus error summary, `aria-live` status/error messages, keyboard-operable actions, 44px-friendly controls and single-column small-screen layout. Client never calculates balances, deadlines, deficit or notification eligibility.

## Tests and acceptance proof

- Unit recurrence tables cover one-time, monthly, N-month, yearly, 29–31 anchors, leap year, year rollover, end date and bounded windows.
- PostgreSQL integration covers migration constraints, plan CRUD, role/isolation 404, snapshots, disable/edit/delete cancellation, occurrence lifecycle, exactly-one draft, transaction confirmation completion, idempotency replay/conflict and audit allowlists.
- Worker tests cover atomic `SKIP LOCKED` claim by two workers, lease expiry/restart recovery, retry/backoff/terminal failure, duplicate-safe materialization and per-occurrence notification uniqueness.
- Integration covers every notification rule with confirmed-only financial values, resolution/reopen behavior and insufficient mandatory obligations window.
- Web Vitest covers page loading/error states, Russian actions, field errors, accessible status and draft-to-operation navigation.
- `e2e/stage-5-plans-notifications.spec.ts` covers critical browser flow in CI only. It is not run locally without explicit user request.

Final gate is `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm build`, `docker compose -f infra/compose/local.yml config --quiet` and `pnpm db:migrate`.
