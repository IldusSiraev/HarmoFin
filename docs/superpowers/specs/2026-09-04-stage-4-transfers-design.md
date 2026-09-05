# Дизайн Stage 4 HarmoFin: переводы между счетами

## Цель

Добавить server-confirmed переводы между активными счетами с одной или несколькими частями по конвертам. Перевод остаётся единым финансовым событием, сохраняется атомарно и не считается доходом или расходом.

## Граница этапа

### Входит

- Переводы с состояниями `DRAFT`, `CONFIRMED`, `CANCELLED`, `DELETED`.
- Один или несколько положительных частей перевода, чья сумма равна общей сумме.
- Явная смена конверта при части перевода.
- Server-computed balances счетов и конвертов с учётом только подтверждённых переводов.
- Idempotency, audit, budget isolation, role checks и logical deletion.
- API, OpenAPI, PostgreSQL integration, typed web client, protected `/app/transfers` и browser coverage.
- Переход со страницы счёта к форме перевода с предзаполненным source account.

### Не входит

- Unified feed переводов и операций в `/app/operations`.
- Редактирование или восстановление перевода.
- Циклы, периоды, dashboard, reports, plans, notifications, worker jobs, imports, multi-currency conversion, collaboration, AI, billing и deployment.
- Превращение перевода в доход, расход или income allocation.

## Доменные правила

`Transfer` — aggregate одного budget с общей суммой, датой, валютой, комментарием, статусом и audit metadata. `TransferPart` принадлежит transfer и хранит source/destination account, source/destination envelope и сумму в integer minor units.

Форма задаёт один source account и один destination account для всего transfer. Сервер сохраняет эти account references в каждой части. Каждая часть задаёт source envelope; destination envelope по умолчанию равен source envelope. Пользователь может явно выбрать другой destination envelope, что является reallocation purpose и должно быть видно в UI.

Все суммы на хранении — PostgreSQL `BIGINT`. API принимает decimal strings и возвращает canonical integer strings. Только `CONFIRMED` transfer влияет на balances. `DRAFT`, `CANCELLED` и `DELETED` не влияют на расчёты. `DRAFT` можно подтвердить или отменить; любой не удалённый transfer можно логически удалить; `DELETED` неизменяем. Удаление пишет audit event; edit и restore не входят в Stage 4.

Сервер проверяет:

- source и destination accounts существуют, active, относятся к тому же budget, имеют `RUB` и `scale = 2`;
- source и destination accounts различаются;
- source/destination envelopes существуют, active, относятся к тому же budget, имеют `RUB` и `scale = 2`;
- каждая часть и total строго положительны;
- сумма частей точно равна total;
- при `allowNegativeBalance === false` подтверждение не делает source account или source envelope отрицательным.

Подтверждённый transfer меняет account balance на сумму outgoing parts source account и incoming parts destination account. Поэтому сумма balances всех accounts не меняется. Обычная часть с одинаковыми source/destination envelope не меняет total envelope money; смена destination envelope уменьшает source envelope и увеличивает destination envelope на ту же сумму. Frontend никогда не вычисляет balances или limits.

## Persistence и projections

Новая additive Prisma migration добавляет:

- enum `TransferStatus`: `DRAFT`, `CONFIRMED`, `CANCELLED`, `DELETED`;
- `transfers` с `budget_id`, `total_minor`, currency, scale, occurred date, status, optional comment, lifecycle timestamps и audit columns;
- `transfer_parts` с transfer, budget, source/destination account, source/destination envelope, positive `amount_minor`, optional comment и audit columns.

`TransferPart` использует composite foreign keys `(id, budget_id)` к accounts и envelopes. Database constraints обеспечивают `RUB`, `scale = 2`, positive stored amounts, valid statuses and foreign-key integrity. Exact equality total and parts, active-reference state and capacity are application-service invariants checked while rows are locked in the same PostgreSQL transaction.

Financial balance SQL projections расширяются без materialized balances:

- account: starting balance + confirmed income − confirmed expense − confirmed transfer parts from account + confirmed transfer parts to account;
- envelope: starting balance + confirmed income allocations − confirmed expense − confirmed transfer parts from envelope + confirmed transfer parts to envelope.

## Application services и API

Новый `transfers` module follows existing repository/service/controller separation. Repository queries filter `workspace_id` and `budget_id` in SQL and obtain active membership/budget access. Application service owns locks, status transitions, cross-reference checks, capacity validation, transactional writes, audit and response mapping. Controllers validate HTTP schemas, document OpenAPI and delegate only.

All financial mutations use existing `IdempotencyService`: matching `(budget, actor, Idempotency-Key, payload)` replays original response; same key with different payload returns conflict safely.

Routes under `/api/v1/budgets/:budgetId`:

- `GET /transfers` — cursor pagination plus bounded status/date/account/envelope filters;
- `GET /transfers/:transferId` — aggregate, parts and server-confirmed balance consequences;
- `POST /transfers` — create `DRAFT` or explicitly confirmed transfer with `Idempotency-Key`;
- `POST /transfers/:transferId/confirm` — confirm draft with `Idempotency-Key`;
- `POST /transfers/:transferId/cancel` — cancel a draft with `Idempotency-Key`;
- `DELETE /transfers/:transferId` — logical delete with `Idempotency-Key`.

Unsafe routes preserve cookie session, OriginGuard, SessionAuthGuard and CsrfGuard. Cross-budget identifiers return `404 RESOURCE_NOT_FOUND`; insufficient source balance, invalid state and unequal sums return safe Problem Details with field errors where appropriate.

## Web UI

Add protected `/app/transfers` with cursor-paginated transfer list, filters, status display and explicit actions. Add transfer form with date, source account, destination account, total and an editable parts list. Each part has source envelope, destination envelope and amount. Removing/adding a part remains keyboard-accessible. The form displays server field errors and a clear total mismatch summary; the server remains authority.

The account card exposes `Перевести со счёта`, linking to the protected transfer form with source account prefilled. Query parameters are convenience only; server authorization remains independent.

Extend `useBudgetReferenceData` with client-safe transfer DTOs, decimal request inputs and idempotent mutation methods. Reuse existing money inputs, buttons, status and confirm dialog. UI text stays Russian, focus returns after dialogs, and layout fits `375px` without horizontal overflow.

## Tests и acceptance

Unit tests cover money parsing, part-total equality, active same-budget references, distinct accounts, no-negative source capacity, confirmed-only projection effects, ordinary purpose preservation, explicit envelope reallocation, status transitions and idempotency replay/conflict.

PostgreSQL integration tests cover migration compatibility with Stage 1–3a data, transaction rollback, audit/logical deletion, RBAC, cross-budget isolation, API/OpenAPI contracts and account/envelope balance assertions for one-part and multipart transfers.

Playwright covers desktop and `375px`: protected route, source-account prefill, draft/confirm, one part, multiple parts, explicit changed destination envelope, invalid part total, insufficient balance rejection, same-key browser retry without duplicate, cancel/delete, Escape/focus return and no horizontal overflow. Tests interact through web and API only; no database bypass.

## Delivery sequence

1. Add persistence contract, migration and projection tests.
2. Implement transfer repository/application service/API/OpenAPI and real PostgreSQL coverage.
3. Extend typed web facade and transfer page/form/account entry point.
4. Add browser coverage, manual desktop/mobile verification and final quality gate.
5. Before Stage 5 starts, complete Stage 3b for operation edit/restore, complete journal filters, cycles, periods, dashboard and reports.

A detailed implementation plan is written only after review of this design.
