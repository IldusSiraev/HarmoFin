# Stage 6: аналитика, цели накоплений и CSV-экспорт — дизайн

## Статус и границы

Документ фиксирует дизайн MVP Stage 6. Он не разрешает production-реализацию до отдельного подтверждения design и detailed implementation plan.

Этап завершает пользовательскую аналитическую часть MVP: расширяет существующие отчёты plan/fact, показывает прогресс накопительных целей, добавляет безопасный CSV-экспорт отфильтрованного журнала и устраняет критичные responsive/accessibility gaps аналитики и экспорта.

В этап не входят XLSX, import CSV/XLSX, S3-compatible storage, export worker, временные файлы, подписанные ссылки, Telegram/email/push, multi-currency conversion, AI, billing, collaboration и новые финансовые движения. CSV остаётся синхронным ответом ограниченного размера; переход на asynchronous export job требует отдельного архитектурного решения.

## Неподвижные финансовые и security rules

- Денежная истина остаётся на сервере в PostgreSQL `BIGINT`; API возвращает canonical integer strings. Клиент не рассчитывает balances, deviations, progress или eligibility.
- В financial analytics учитываются только `CONFIRMED` transactions, allocations и transfers по существующим server-side rules. Draft, cancelled и logically deleted records не влияют на итоговые значения.
- Plan/fact не создаёт и не подтверждает фактические операции. `SAVINGS` occurrence не получает искусственный actual amount.
- Все user-data query/filter/export применяют `workspace_id`, `budget_id`, membership, active-state и role condition прямо в database query. Чужие IDs дают `404 RESOURCE_NOT_FOUND`.
- CSV экспортирует только данные бюджета текущего owner. Он не принимает имя файла, delimiter, URL, SQL-like filtering expression или любой пользовательский file path.
- Reports, goals и export не пишут финансовые records. Mutations отсутствуют; audit event для download в Stage 6 не требуется.

## Existing foundation

Stage 3b already has a protected `/app/analytics`, report filters, a reports module, confirmed-only transaction queries, account/envelope balance projections, rows for basic `savings-goals`, and table/chart presentation. Stage 5 adds immutable plan occurrence snapshots, linked actual transactions, dashboard obligations and regular-plan lifecycle.

Stage 6 extends these contracts rather than duplicating balances or recalculating finance in Nuxt.

## Server report contract

### Typed report responses

`GET /api/v1/budgets/:budgetId/reports/:key` remains the single report route. Existing report keys remain compatible. Stage 6 adds `plan-vs-actual` and replaces the schema-only generic rows description with documented report-key-specific response models while preserving JSON `{ key, rows }` shape.

Every row contains canonical minor strings. `journalFilters` remains server-produced, relative filter data for existing journal navigation; the client never creates a financial filter from an aggregate itself.

### Plan/fact

`plan-vs-actual` reports only `INCOME` and `EXPENSE` occurrences. `SAVINGS` remains covered by goal-progress reporting because a completed savings reminder is not a monetary fact.

A row is grouped by plan and reporting range. It contains:

```text
planId, planName, planType
plannedMinor
actualMinor
varianceMinor
plannedOccurrenceCount
confirmedOccurrenceCount
journalFilters
```

- The range filters occurrence `scheduledOn`, not the edited actual transaction date. This preserves the relation between an expected date and its eventual actual record.
- Planned amount is the sum of non-cancelled occurrence snapshots in range. `SKIPPED` remains planned but does not contribute actual money; cancelled rows contribute neither value nor count.
- Actual amount is the sum of linked transactions only where transaction `status = CONFIRMED`. An occurrence with a linked draft, cancelled draft, no transaction or manual completion contributes `0` actual.
- `varianceMinor = actualMinor - plannedMinor` is calculated by the server using `BIGINT`.
- Account, category and envelope filters apply to occurrence snapshot references. This keeps a report about the original plan stable when a user changes the actual operation before confirmation.
- Rows are ordered by `planName` then `planId`; empty input returns an empty list. A row link opens the server-filtered journal for actual confirmed transactions when such a filter is meaningful; no link claims that a draft is actual.

### Goal progress

Goal rows are a server projection over active envelopes with `targetAmountMinor`. Existing envelope validation requires a target amount when `targetDate` exists. Goal reporting does not change the envelope model or create an allocation.

Each row contains:

```text
envelopeId, name, envelopeType
currentMinor
targetMinor
targetDate | null
remainingMinor
progressPermille
isReached
daysRemaining | null
journalFilters
```

- `currentMinor` uses the existing confirmed-only envelope balance projection.
- `remainingMinor = max(targetMinor - currentMinor, 0)`.
- `progressPermille` is a server-calculated integer; `1000` means target reached. It is capped at `1000`, while `isReached` preserves an over-target state without floating point.
- An amount target without a date returns no deadline. A past target date returns negative `daysRemaining`; the client renders the supplied signed integer with an explicit overdue label and never recalculates it.
- Financial values use integer strings; presentation may render a chart as a visual-only normalized value, but the accessible table and labels show exact server values.

## CSV export

### Endpoint and authorization

```text
GET /api/v1/budgets/:budgetId/exports/transactions.csv
```

The endpoint accepts the same validated journal filters: search, date/cycle/period range, account, category, envelope, type, status and sort. It requires an authenticated active `OWNER`; `EDITOR` and `VIEWER` receive `403 FORBIDDEN`. A foreign budget/object filter returns `404 RESOURCE_NOT_FOUND`.

It is a download GET: no CSRF token or idempotency key applies because it creates no persistent state. `Content-Type` is `text/csv; charset=utf-8`; `Content-Disposition` uses a fixed trusted Russian filename; response starts with UTF-8 BOM for spreadsheet compatibility.

### Rows and limits

The export reuses journal query/policy semantics instead of a parallel financial query. It returns at most 10,000 rows. The repository fetches one extra row; exceeding the limit returns `422 EXPORT_LIMIT_EXCEEDED` with Russian guidance to narrow filters.

Russian headers are stable and include operation ID, date, type, status, canonical amount in minor units, currency, account, category, envelope, income source, merchant, comment, planned flag and timestamps relevant to lifecycle. Logically deleted rows follow existing journal role/status rules; no hidden foreign data can appear.

CSV uses semicolon delimiter, RFC 4180 quoting, CRLF records and an escape prefix for cell text beginning with `=`, `+`, `-` or `@`. This prevents spreadsheet formula injection while preserving the original value visibly. Amount strings are emitted as canonical minor units and never through JavaScript `Number`.

## Web contract

### Analytics

`/app/analytics` gains report selection for `plan-vs-actual`, typed tables and an accessible visual comparison. It keeps filters in URL query state and loads all calculations from API.

Plan/fact presentation shows plan name, planned, actual, variance, occurrence counts and a journal link. Savings rows are not presented as financial actuals. Goal presentation shows current balance, target, exact remaining amount, deadline state and text progress; progress bars include ARIA text and do not communicate status by color alone.

Chart adapters may normalize already returned integer values only for pixels. Exact integer values remain in the table, aria labels and downloadable CSV; normalized values never reach APIs or finance code.

### Journal export

The operations journal gains an `Экспорт CSV` control visible only for owner role supplied by server auth state. It preserves current URL filters, disables while downloading, exposes status/error via live region and starts a browser download through the API client. Error responses use existing Problem Details handling.

### Responsive and accessibility polish

Stage 6 verifies analytics, operations export and goal views at narrow viewport. Controls remain reachable, tables get an accessible responsive layout or horizontal scroll container with a visible label, charts have text/table alternatives, focus remains visible, and export/download/error states work by keyboard.

## OpenAPI and errors

All new rows, CSV success response and errors are documented below `/api/v1`:

```text
400 VALIDATION_FAILED        malformed filters
401 UNAUTHORIZED             no session
403 FORBIDDEN                role cannot export
404 RESOURCE_NOT_FOUND       inaccessible budget/reference
422 EXPORT_LIMIT_EXCEEDED    more than 10,000 matching rows
```

No breaking changes are made to existing report keys. New typed schemas may be added to OpenAPI as `oneOf` documentation while retaining current response JSON shape.

## Testing and acceptance proof

- Unit tests cover plan/fact grouping, linked confirmed-only actuals, skipped/cancelled/manual-completed occurrence handling, positive/negative variance and range boundaries.
- Integration tests cover budget isolation, role matrix, archived/missing filters, integer serialization, goal progress boundaries, target date timezone behavior, and no financial state changes from analytics/export.
- CSV tests cover filter parity with journal, UTF-8 BOM, semicolon/quote/newline encoding, formula injection escaping, row limit, owner-only access and no cross-budget rows.
- Web Vitest covers loading/error/empty states, Russian labels, typed row rendering, URL filters, accessible progress, download errors and responsive table behavior.
- A CI-only Playwright scenario creates filtered journal data, downloads owner CSV, checks plan/fact and goal state, then verifies non-owner absence/denial through test-supported setup. It is not run locally without explicit user approval.
- Final gate remains `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm build`, `docker compose -f infra/compose/local.yml config --quiet` and `pnpm db:migrate`.
