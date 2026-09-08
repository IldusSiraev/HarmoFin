# Дизайн Stage 3b HarmoFin: жизненный цикл операций, циклы, журнал, dashboard и отчёты

## Цель

Завершить Stage 3b до начала Stage 5: безопасное редактирование, logical delete и восстановление операций; полный журнал операций; финансовые циклы и периоды; server-computed dashboard summary; базовые отчёты из данных Stage 3a и Stage 4.

Все финансовые итоги остаются server-side PostgreSQL projections. Frontend отображает ответы API и не вычисляет балансы, лимиты или агрегаты.

## Граница этапа

### Входит

- Редактирование `DRAFT` и явно подтверждённое редактирование `CONFIRMED` transactions.
- Logical delete и восстановление transactions и income allocations.
- Атомарное разрешение confirmed income allocations перед удалением income.
- Owner-only audit history для операций.
- Pure domain service для финансовых циклов и периодов.
- Полные server-side filters, sort и cursor pagination journal.
- Server-side summary, dashboard и отчёты из подтверждённых transaction, allocation и transfer data.
- Доступные адаптивные journal, dashboard и analytics pages.
- Unit, PostgreSQL integration, web unit и CI-only Playwright coverage.

### Не входит

- Edit или restore transfers.
- Regular plans persistence, nearest obligations, notifications, worker jobs.
- Bank imports/integrations, export, multi-currency conversion, billing, AI, collaboration и deployment.
- Plan-versus-fact и отчёты по обязательствам.
- Persistent materialized balances, cycle membership или report snapshots.

## Глобальные инварианты

- Денежные величины хранятся и агрегируются PostgreSQL `BIGINT`; API принимает decimal strings и возвращает canonical integer strings.
- Только `CONFIRMED` transactions, allocations и transfer parts влияют на финансы. `DRAFT`, `CANCELLED`, `DELETED` исключены.
- Каждый user-data query и mutation проверяет active workspace membership, active budget, role и ownership; SQL query содержит `workspace_id` path и `budget_id` predicate.
- Foreign identifiers другого бюджета возвращают `404 RESOURCE_NOT_FOUND`; UI route/query parameters не являются механизмом авторизации.
- `OWNER` и `EDITOR` могут изменять операции. Только `OWNER` может restore operations/allocations, видеть deleted history и audit. `VIEWER` получает `403` на mutations.
- Каждая financial mutation требует `Idempotency-Key`. Повтор user intent использует исходный key.
- Controllers только валидируют HTTP boundary, документируют OpenAPI и вызывают service. Prisma и financial calculations остаются в repositories/services.
- Все mutation сценарии с финансовым эффектом выполняются в одной PostgreSQL transaction. Сначала блокируются transaction и затронутые account/envelope/income/allocation rows в одном детерминированном порядке.
- Audit values allowlist financial structural fields. Comment, source description, merchant/recipient и иной sensitive free text не попадают в audit payload.

## Persistence

Новая additive migration после Stage 4 добавляет только новые поля, enum, constraints и indexes. Миграции Stage 1–4 не меняются.

### Restore metadata

`Transaction` получает nullable `pre_delete_status` типа `TransactionStatus`.

- При delete сервер сохраняет точный status до delete в `pre_delete_status`, ставит `status = DELETED`, `deleted_at` и actor.
- При restore сервер восстанавливает `status = pre_delete_status`, очищает `deleted_at` и `pre_delete_status`.
- Database constraint требует `pre_delete_status IS NOT NULL` тогда и только тогда, когда `status = DELETED`; значение допускает только `DRAFT`, `CONFIRMED` или `CANCELLED`. Application service не допускает restore без сохранённого допустимого status.

`IncomeAllocation` получает nullable restore metadata, достаточную для возврата logical deleted allocation в `CONFIRMED`: pre-delete status и lifecycle timestamp при необходимости. Allocation не активируется, пока source income не `CONFIRMED` и confirmed allocation total не остаётся в пределах income amount.

### Period slot

`Envelope` получает nullable enum `PeriodSlot`:

```text
FIRST
SECOND
```

- Database `CHECK` permits `period_slot` only when `envelope_type = 'CURRENT_EXPENSES'`. Application service permits assignment only while envelope is active.
- Partial unique indexes обеспечивают максимум один active `FIRST` и один active `SECOND` slot на budget.
- Existing template envelopes получают `FIRST` для `envelope-current-10-24` и `SECOND` для `envelope-current-25-9`.
- При user change server atomically removes/changes conflicting assignment; assignments remain budget-scoped and auditable.
- Slot не определяется по user-visible name. Rename не меняет semantics.

## Operation lifecycle и allocation integrity

### State transitions

| Current status | Allowed actions |
|---|---|
| `DRAFT` | edit, confirm, cancel, delete |
| `CONFIRMED` | edit с `confirm: true`, delete |
| `CANCELLED` | delete |
| `DELETED` | owner restore |

- `DELETED` нельзя edit, confirm, cancel или delete повторно: `409 TRANSACTION_STATE_INVALID`.
- Edit `CONFIRMED` требует explicit `confirm: true`; client показывает confirmation dialog до запроса.
- Restore возвращает exact saved status. Invalid terminal transitions используют documented conflict code.
- При confirm, confirmed edit или restore server повторно проверяет active same-budget account/category/envelope references, currency/scale и capacity.

### Income allocations

Перед уменьшением confirmed income server blocks income и all its confirmed allocations, суммирует их и отклоняет update, если сумма allocations превысит new income amount.

При delete confirmed income с confirmed allocations обычный delete возвращает:

```text
409 INCOME_HAS_CONFIRMED_ALLOCATIONS
```

Problem Details содержит allowlisted count и IDs affected allocations. Он не изменяет balances.

Отдельная user-confirmed idempotent action atomically:

1. locks income и confirmed allocations;
2. logical-deletes or cancels linked allocations согласно explicit `allocationResolution`;
3. writes one audit event per allocation;
4. logical-deletes income;
5. writes income audit event.

Restore income/allocation revalidates all active references. Allocation restore rejects absent/non-confirmed source income and total above income amount. No action creates phantom envelope funds.

## Cycles и periods

Новый `cycles` domain module — pure TypeScript server code, без Prisma и HTTP dependencies. Он принимает:

- `cycleStartDay`;
- `periodBoundaryOffset`;
- IANA budget timezone;
- operation/current calendar date.

Возвращает:

- cycle start/end;
- period identifier and start/end;
- days remaining until next period boundary.

### Rules

- Если day date >= `cycleStartDay`, cycle starts current month; иначе previous month.
- Cycle end — day before same start day next month.
- Первый period начинается cycle start; ends after `periodBoundaryOffset - 1` calendar days.
- Второй period начинается next day; ends cycle end.
- Для start day `10` и offset `15`: `10–24` and `25–9`.
- Date calculations use budget timezone/calendar dates, not browser timezone. Leap years, short months and month/year rollover remain valid.
- Cycle setting changes alter only projections. Historical operation `occurred_on` never changes.
- Input validates valid start day for all months and offset producing two non-empty periods.

Read contracts:

```text
GET /api/v1/budgets/:budgetId/cycles/current
GET /api/v1/budgets/:budgetId/cycles?date=YYYY-MM-DD
```

## Journal API

Existing `GET /budgets/:budgetId/transactions` gains bounded documented query fields:

```text
search
from
to
cycleStart
periodStart
accountId
categoryId
envelopeId
type
status
sortBy = occurredOn | amount
sortDirection = asc | desc
cursor
limit
```

- Search uses case-insensitive SQL match over `source_description` and `merchant_name`.
- Filters compose with `AND`.
- `cycleStart` and `periodStart` are exact ISO projection starts validated against budget settings. Incompatible cycle/period values return `400 VALIDATION_FAILED`.
- Every ID filter is budget-scoped in query. Foreign ID returns `404 RESOURCE_NOT_FOUND`.
- Default excludes deleted. `status=DELETED` and `status=all` are OWNER-only.
- Cursor includes version, sort fields, sortable value, `createdAt` and `id`. Decode validates base64url payload and exact shape before SQL; malformed/mismatched cursor returns `400 VALIDATION_FAILED`.
- Stable tie breakers ensure no duplicate/missing rows across pages.
- Detail response includes associated allocations allowed by role. Owner can request audit history; non-owner cannot receive deleted/audit data.

New transaction routes:

```text
POST /budgets/:budgetId/transactions/:transactionId/restore
POST /budgets/:budgetId/transactions/:transactionId/delete-with-allocations
GET  /budgets/:budgetId/transactions/:transactionId/allocations
GET  /budgets/:budgetId/transactions/:transactionId/audit
POST /budgets/:budgetId/allocations/:allocationId/restore
```

Restore and resolution mutations require CSRF/session guards and `Idempotency-Key`. Existing create, patch, confirm, cancel, delete and allocation routes remain compatible.

## Audit module

New `audit` module provides owner-only budget-scoped event access. Repository joins active membership and budget in SQL. Responses include event identity, budget-local datetime, actor, entity type/ID, action, source and allowlisted old/new financial fields. Sensitive free text remains excluded.

## Dashboard summary

New protected route:

```text
GET /api/v1/budgets/:budgetId/summary
```

`dashboard` repository computes one server response from confirmed data only:

- current cycle and period;
- total account money;
- account balances;
- envelope balances;
- unallocated confirmed income;
- current period limit, spent, remaining;
- days to next boundary;
- average remaining daily limit;
- negative account/envelope warnings.

No nearest obligations until plans exist.

### Period-limit formula

For selected current period slot envelope, at `asOf` current date in budget timezone:

```text
opening balance immediately before period start
+ confirmed allocations into slot during [periodStart, asOf]
+ net confirmed envelope-changing transfer reallocations into slot during [periodStart, asOf]
= periodLimitMinor

confirmed expenses from slot during [periodStart, asOf]
= spentMinor

periodLimitMinor - spentMinor
= remainingMinor
```

- Transfer preserving source/destination envelope does not contribute.
- Formula uses actual confirmed allocations and expenses; it never assumes planned/future income.
- `averageRemainingDailyLimitMinor` divides integer `remainingMinor` by inclusive remaining calendar days, truncating toward zero. Response documents rounding.
- A missing active slot envelope returns a documented empty/unsupported period-limit state, not a guessed value.

## Reports

New `reports` module exposes:

```text
GET /api/v1/budgets/:budgetId/reports/:reportKey
```

Allowed keys:

```text
expenses-by-category
expenses-by-period
expenses-by-cycle
incomes-by-cycle
savings-reallocation-by-cycle
net-cash-flow
account-balances
envelope-balances
savings-goals
```

Bounded filters: date/cycle range, account, category, envelope, type and `RUB` currency. All aggregates are PostgreSQL `BIGINT` and only confirmed records contribute.

- Transfers never count as income, expense or net cash flow.
- Only transfer parts with different source/destination envelopes contribute to savings/reallocation.
- Account/envelope balance reports use date buckets and server balance projections.
- Savings-goal progress uses envelope target only where configured.
- Plan-vs-fact, plan obligations and export remain excluded.
- Each report row returns sufficient filter state for a safely encoded journal link.

## Web UI

### Journal

`/app/operations` becomes complete journal:

- Filter controls, sortable columns/list, active-filter reset, pagination/load more.
- URL query is source of client filter state; it never grants access.
- Debounced search and request sequencing or `AbortController` ensure stale result cannot overwrite newer request.
- Desktop and mobile layouts avoid horizontal page scroll.
- Operation details show allocations. Owner sees audit/history.
- Form supports create/edit mode and preloads selected transaction.
- Confirmed edit, delete, restore and allocation resolution use `UiConfirmDialog`.
- Problem Details field errors map to exact controls and accessible summary.
- Mutation retries preserve one idempotency key; after every mutation reload/invalidate server data only.
- Account and envelope pages link to encoded initial journal filters.

### Dashboard

`/app` replaces current placeholder. It renders summary values returned by API, including loading, empty and error states. It has no client-side balance/limit arithmetic.

### Analytics

New protected `/app/analytics` filters and renders report responses. Rows link to journal with encoded filters.

Chart forms:

- Expenses by category: capped horizontal bars plus table equivalent.
- Expenses/incomes/savings/net cash flow by cycle or period: single-series line or bar chart.
- Account/envelope balance history: separate selected-entity series with legend and table.
- Savings goals: progress indicator, numeric value and table.

Visualization rules:

- Existing design tokens only; series get fixed entity mapping and identity never depends only on color.
- Status uses text/icon with color.
- No dual axes or rainbow palettes.
- Filters precede charts; keyboard-accessible controls, tooltip, table equivalent and direct journal link are mandatory.
- Before shipping categorical visualization, validate chosen palette in light and dark modes and inspect rendering for collisions and responsive overflow.

## Testing

### Milestone 1: lifecycle

- Unit: transitions, pre-delete restore, confirmed update confirmation, allocation caps, delete resolution, restore preconditions, idempotency replay/conflict.
- PostgreSQL integration: locks/atomic rollback, archived/foreign references, role matrix, audit allowlist, no phantom account/envelope money.
- Web: edit preload, confirmation, restore, allocation-consequence errors and field error summary.

### Milestone 2: cycles

- Table-driven examples from functional specification.
- Leap-year, short month, year rollover, budget timezone and settings-change cases.
- Current/selected cycle contract validation.

### Milestone 3: journal

- Every filter and combined filters; search; sort/cursor stability; malformed cursor; foreign filter IDs; deleted role visibility; budget isolation.
- URL state, reset, stale response prevention, details/history and actions.
- Desktop/mobile no horizontal overflow.

### Milestone 4: summary and reports

- Unit: formula, integer rounding and aggregates.
- PostgreSQL integration: confirmed-only accounting, transfer neutrality for income/expense/net flow, reallocation classification, filter isolation and report-to-journal mapping.
- Web: loading/error/empty states and filter propagation.
- Add Playwright scenarios for CI only. Do not run Playwright locally.

## Delivery sequence

1. Add persistence and lifecycle/restore correctness.
2. Add cycle domain service and current/selected-cycle contracts.
3. Add full journal query, audit access and journal UI.
4. Add summary/report projections, dashboard and analytics UI.
5. Add CI browser coverage and run local quality gate excluding Playwright:

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

One coherent commit series per milestone. No push before every local gate passes.
