# Дизайн Stage 3a HarmoFin: операции и распределения доходов

## Цель

Добавить ядро фактического учёта: доходы, расходы и явные распределения доходов по конвертам. Все последствия операций подтверждает сервер внутри транзакции. Этап намеренно не завершает весь Stage 3.

## Граница этапа

### Входит

- Доходы и расходы с состояниями `DRAFT`, `CONFIRMED`, `CANCELLED`, `DELETED`.
- Явное распределение части подтверждённого дохода в конверт и счёт хранения.
- Proposal распределения из существующей настройки бюджета: income category-источник и target envelope.
- Транзакционный пересчёт server-confirmed balances счетов и конвертов.
- Идемпотентные mutations, audit, budget isolation, role checks и logical deletion.
- Журнал операций, формы создания и редактирования, подтверждение, отмена, удаление и распределения.
- API, OpenAPI, unit, integration и browser coverage.

### Не входит

- Переводы между счетами и их части — Stage 4.
- Циклы, периоды, dashboard, reports и aggregates — отдельная часть полного Stage 3.
- Планы, notifications, worker jobs, import, multi-currency conversion, collaboration, AI, billing и deployment.
- Автоматическое создание allocation или financial movement по совпадению категории.

## Доменные правила

### Операции

Одна реальная операция представлена одной записью `Transaction` с `INCOME` или `EXPENSE`. Все денежные значения сохраняются как PostgreSQL `BIGINT`; транспорт принимает decimal strings и возвращает canonical integer strings. `CONFIRMED` записи — единственные, влияющие на balances и totals.

`DRAFT` можно редактировать или отменять без финансового эффекта. `CANCELLED` и `DELETED` не влияют на расчёты. Удаление финансовой записи логическое; audit сохраняет allowlisted old/new fields без комментариев, полных request payloads, cookies, tokens или платёжных данных.

Доход требует active account и active category типа `INCOME`. Расход требует active account, active category типа `EXPENSE` и active envelope. Все связанные objects принадлежат тому же budget. Archived reference data нельзя выбрать для новой операции.

При `allowNegativeBalance === false` server blocks confirmation расхода, если результат сделает account или envelope отрицательным. При включённой настройке отрицательное значение допускается. UI показывает только server-confirmed result и не вычисляет balance optimistically.

### Распределения доходов

`IncomeAllocation` принадлежит одному подтверждённому income transaction. Его сумма строго положительна, category/source transaction имеет `INCOME`, а сумма allocations данного income не превышает income amount. Allocation увеличивает balance target envelope и не создаёт второй income transaction. Нераспределённый доход — разница income amount и суммы confirmed allocations, вычисляемая сервером.

`incomeAllocationRuleEnabled`, `incomeAllocationSourceCategoryId` и `incomeAllocationTargetEnvelopeId` остаются generic budget configuration, созданной в Stage 2. Если новый income соответствует active source category, API возвращает proposal для target envelope. Пользователь может принять, изменить или отказаться. Только отдельная explicit allocation mutation создаёт запись и меняет envelope balance.

## Persistence

Новая additive Prisma migration добавляет:

- enum `TransactionType`: `INCOME`, `EXPENSE`;
- enum `TransactionStatus`: `DRAFT`, `CONFIRMED`, `CANCELLED`, `DELETED`;
- `transactions` с budget, type, status, `amount_minor BIGINT`, `currency`, `scale`, operation date, account, category, nullable envelope for income, optional merchant/source description, logical deletion and audit columns;
- `income_allocations` с income transaction, envelope, account, positive `amount_minor BIGINT`, status, operation date, logical deletion and audit columns;
- `idempotency_records` keyed by budget, actor and key, storing request fingerprint and safe response/result metadata for financial mutations.

Database constraints enforce `RUB`, `scale = 2`, positive amount where required, same-budget composite relations and foreign-key integrity. Application services enforce type/state transitions, active reference data, sum of allocations and confirmed-balance rules. First Stage 1 and Stage 2 migrations remain unchanged.

## Application services and repositories

`TransactionRepository` contains scoped Prisma access. Every query filters `budget_id` in database and requires active workspace, active membership and active budget. `TransactionApplicationService` owns domain validation and transaction boundaries; controllers only validate HTTP DTOs and delegate.

Create, update, confirm, cancel, logical delete and allocation mutations execute atomically with audit event and idempotency record. Repeating matching `Idempotency-Key` returns original result; the same key with a different request is rejected safely. Cross-budget ID substitution returns `404 RESOURCE_NOT_FOUND`; accessible non-owner mutation returns `403 FORBIDDEN` according to existing role policy.

Balance view functions derive account balance from starting balance plus confirmed income minus confirmed expenses, and derive envelope balance from starting balance plus confirmed allocations minus confirmed expenses. The server runs these queries/aggregations; `currentBalanceMinor` never becomes a browser source of truth.

## HTTP contract

All routes live under `/api/v1/budgets/:budgetId` and preserve cookie sessions, OriginGuard, SessionAuthGuard and CsrfGuard for unsafe mutations.

- `GET /transactions` — cursor/page pagination, bounded filters by type, status, dates, account, category and envelope.
- `POST /transactions` — create draft or explicit confirmed operation with `Idempotency-Key`.
- `GET /transactions/:transactionId` — detail with server-confirmed consequences and allocation summary.
- `PATCH /transactions/:transactionId` — update permitted state with idempotency.
- `POST /transactions/:transactionId/confirm` — explicit confirmation with idempotency.
- `POST /transactions/:transactionId/cancel` — cancel draft or permitted state with idempotency.
- `DELETE /transactions/:transactionId` — logical delete with idempotency.
- `POST /transactions/:transactionId/allocations` — explicit allocation for a confirmed income with idempotency.
- `PATCH` and logical-delete routes for allocation records only when domain invariants remain true.

Every endpoint receives OpenAPI request, response and Problem Details schemas. Money requests are decimal strings; money responses are integer strings matching `^-?\d+$`. Errors have generic Russian detail and known field errors where safe.

## Web UI

Add protected operations journal and operation form under `/app`. The journal uses only server pagination/filter data. Forms use existing `FinanceMoneyInput`, `UiInput`, `UiSelect`, `UiButton`, `UiStatus` and `UiConfirmDialog`.

The form changes fields by selected type:

- Income: date, amount, account, income category, optional source description and planned marker.
- Expense: date, amount, account, expense category, envelope, optional merchant/description.

Creating a draft and confirming a financial action are separate, clearly labelled user actions. Confirmed edit, cancellation and logical deletion require visible confirmation. Matching generic income allocation setting displays an editable proposal, never an automatic allocation. Allocation requires explicit acceptance and presents remaining undistributed amount from API response.

UI uses Russian text, visible labels, field-level errors, keyboard controls, focus return after dialogs, non-colour status text and compact layout below `768px`.

## Tests and acceptance

Unit tests cover decimal/bigint boundaries, type/state transitions, confirmed-only effects, allocation sums, generic rule proposals, no-negative mode, idempotency and safe error mapping.

Integration tests use real PostgreSQL and verify migration compatibility, transactionality/rollback, audit/logical deletion, idempotency retries, OpenAPI, active object restrictions, RBAC and cross-budget isolation.

Playwright covers desktop and `375px`: create draft, confirm income/expense, edit/cancel/delete, allocation accept/change/reject, no duplicate on retry, invalid money field error, protected routes, dialog Escape/focus return and no horizontal overflow. Browser tests inspect only visible flows; they do not bypass the API with direct database writes.

## Delivery sequence

1. Schema, migration and money/state invariants.
2. Transaction and allocation repository/application service/API/OpenAPI.
3. Integration and idempotency coverage.
4. Typed web client, journal and operation/allocations forms.
5. Browser coverage and full CI verification.

A detailed implementation plan is written only after review of this design.
