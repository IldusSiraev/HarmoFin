# Stage 6 Analytics, Goals and CSV Export Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` inline, task-by-task. User explicitly forbids worktrees, subagents, workflows and agent-driven development in this repository. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend HarmoFin analytics with server-calculated plan/fact and goal progress, then add safe owner-only CSV journal export and responsive accessible UI.

**Architecture:** Existing `reports` remains the analytical read model and gains typed report rows plus plan/fact and goal projections. A small `exports` module owns download authorization, query limit and CSV encoding while reusing journal filtering through `TransactionRepository`; it never writes a financial or export record. Nuxt renders exact server values in typed report components and downloads a Blob through the existing session-cookie API client.

**Tech Stack:** TypeScript strict, NestJS/Fastify, Prisma/PostgreSQL, Zod, Swagger, Vitest, Nuxt 4/Vue 3, ECharts table fallback, Playwright CI.

**Spec:** [2026-09-09-stage-6-analytics-export-design.md](../specs/2026-09-09-stage-6-analytics-export-design.md)

## Global Constraints

- Work in a fresh `feat/stage-6-analytics-export` branch from current `main`, in the current checkout only.
- Do not use worktrees, subagents, workflows, agent-driven development, push, merge or PR creation.
- Money remains PostgreSQL `BIGINT`; API exposes canonical integer strings. Browser code never decides financial values.
- Analytics and goals use confirmed-only server projections. Plan/fact never treats `SAVINGS` reminders as monetary actuals.
- Every user-data query/export scopes `workspace_id`, `budget_id`, membership and role in SQL. Inaccessible budgets/references return `404 RESOURCE_NOT_FOUND`.
- CSV is owner-only, synchronous, UTF-8 BOM + semicolon + RFC 4180 quoting + CRLF, with formula-injection protection and a hard 10,000-row limit.
- User-facing copy, CSV headers and errors are Russian. API names, identifiers and schema are English.
- Document every endpoint and error response in OpenAPI. Controllers translate HTTP only; repositories query, services calculate.
- Write Playwright only for CI. Do not execute `pnpm test:e2e` locally without explicit new user permission.

---

## File map

| Path | Responsibility |
|---|---|
| `apps/api/src/reports/report.schemas.ts` | Report keys and validated analytical filters. |
| `apps/api/src/reports/report.dto.ts` | Typed OpenAPI models for existing and Stage 6 report responses. |
| `apps/api/src/reports/report.repository.ts` | Scoped transactions, occurrences and confirmed balance projections. |
| `apps/api/src/reports/report.application.service.ts` | Plan/fact and goal progress calculations over `BIGINT`. |
| `apps/api/src/transactions/transaction.schemas.ts` | Optional internal journal `planId` filter. |
| `apps/api/src/transactions/transaction.repository.ts` | Reusable scoped journal where/query path plus bounded export rows. |
| `apps/api/src/transactions/transaction.application.service.ts` | Validates accessible plan filter before journal read. |
| `apps/api/src/exports/*` | Owner CSV download boundary and trusted encoder. |
| `apps/api/src/app.module.ts` | Registers exports module. |
| `apps/api/test/reports.integration.test.ts` | Report, goal, plan/fact and journal filter proof. |
| `apps/api/test/exports.integration.test.ts` | CSV, role/isolation, escaping and limit proof. |
| `apps/web/app/composables/useApiClient.ts` | Session-aware binary download request. |
| `apps/web/app/composables/useBudgetReferenceData.ts` | Typed Stage 6 report DTOs and CSV download method. |
| `apps/web/app/components/analytics/PlanVsActualReport.vue` | Accessible plan/fact table. |
| `apps/web/app/components/analytics/GoalProgressReport.vue` | Accessible exact goal progress. |
| `apps/web/app/pages/app/analytics.vue` | Stage 6 report selection and typed rendering. |
| `apps/web/app/pages/app/operations.vue` | Owner CSV download control retaining journal filters. |
| `e2e/stage-6-analytics-export.spec.ts` | CI-only owner analytics/export journey. |

### Task 1: Typed plan/fact reports and journal plan filter

**Files:**
- Modify: `apps/api/src/reports/report.schemas.ts`
- Modify: `apps/api/src/reports/report.dto.ts`
- Modify: `apps/api/src/reports/report.repository.ts`
- Modify: `apps/api/src/reports/report.application.service.ts`
- Modify: `apps/api/src/reports/report.application.service.test.ts`
- Modify: `apps/api/src/reports/report.controller.ts`
- Modify: `apps/api/src/transactions/transaction.schemas.ts`
- Modify: `apps/api/src/transactions/transaction.repository.ts`
- Modify: `apps/api/src/transactions/transaction.application.service.ts`
- Modify: `apps/api/test/reports.integration.test.ts`
- Modify: `apps/api/test/journal.integration.test.ts`

**Interfaces:**
- Consumes Stage 5 `PlanOccurrence`, linked `Transaction`, active-budget policy and journal filtering.
- Produces `ReportKey` value `plan-vs-actual`, `PlanVsActualRow`, and optional `planId` in `ListTransactionsInput`.
- Produces `TransactionRepository.validateJournalReferences(budgetId, { planId? })` and reusable scoped filtering so later CSV uses exactly journal semantics.

```ts
export type PlanVsActualRow = {
  planId: string;
  planName: string;
  planType: 'INCOME' | 'EXPENSE';
  plannedMinor: string;
  actualMinor: string;
  varianceMinor: string;
  plannedOccurrenceCount: number;
  confirmedOccurrenceCount: number;
  journalFilters: { planId: string; status: 'CONFIRMED' };
};
```

- [ ] **Step 1: Write failing plan/fact unit tests**

Add fixtures with two `EXPENSE` snapshots, a cancelled snapshot, a skipped snapshot, a linked confirmed transaction with edited amount, a linked draft and an `SAVINGS` snapshot. Assert exact rows:

```ts
expect(result).toEqual({
  key: 'plan-vs-actual',
  rows: [
    {
      planId: 'plan-id',
      planName: 'Ипотека',
      planType: 'EXPENSE',
      plannedMinor: '300000',
      actualMinor: '170000',
      varianceMinor: '-130000',
      plannedOccurrenceCount: 2,
      confirmedOccurrenceCount: 1,
      journalFilters: { planId: 'plan-id', status: 'CONFIRMED' },
    },
  ],
});
```

Assert no `SAVINGS` row and no actual amount from draft, cancelled or manual-completed occurrence.

- [ ] **Step 2: Run unit test to verify it fails**

Run: `pnpm --filter @harmofin/api exec vitest run --config vitest.config.ts src/reports/report.application.service.test.ts`

Expected: FAIL because `plan-vs-actual` is not an accepted report key.

- [ ] **Step 3: Add report and journal schemas**

Extend `reportKeys` and web-facing report query validation with `plan-vs-actual`. Add optional `planId: z.string().uuid()` to `listTransactionsSchema`, `TransactionListQuery` and journal controller OpenAPI. Keep `planId` absent from create/update transaction payloads.

Build a documented `PlanVsActualReportResponse` and add it through `oneOf`/extra models without changing existing `{ key, rows }` JSON shape.

- [ ] **Step 4: Add scoped repository reads**

Add an occurrence report query selecting only same-budget `INCOME|EXPENSE` rows with `status != CANCELLED`, `scheduledOn` range and occurrence snapshot references. Join linked transaction only when its budget matches and select its status/amount.

Add `planId` validation using a same-budget plan lookup, including logically deleted plan rows so historical journal links remain valid. Add journal relation filter:

```ts
...(query.planId
  ? { planOccurrence: { planId: query.planId, budgetId } }
  : {}),
```

Keep `budget: activeBudgetWhere(userId, budgetId)` in final transaction query. Extract the existing journal where/order construction only if both list and export need it; do not duplicate the conditions.

- [ ] **Step 5: Implement `planVsActualRows` server calculation**

Group snapshots by `planId`, sum `amountMinor` for all non-cancelled occurrences, sum actual only when linked transaction status is `CONFIRMED`, and calculate variance with `BIGINT`. Use snapshot account/category/envelope IDs for filters. Convert values only with `formatMinorUnits` at response boundary. Sort rows with `localeCompare('ru')` by plan name, then plan ID.

- [ ] **Step 6: Write failing integration tests for report/journal linkage**

Seed two budgets, a linked confirmed actual with a changed amount/date, a linked draft and a foreign plan ID. Assert:

```ts
expect(report.statusCode).toBe(200);
expect(report.json()).toMatchObject({
  key: 'plan-vs-actual',
  rows: [expect.objectContaining({ actualMinor: '170000', varianceMinor: '-130000' })],
});
expect(await journalFor({ planId, status: 'CONFIRMED' })).toHaveLength(1);
expect(foreignPlanFilter.statusCode).toBe(404);
```

- [ ] **Step 7: Run focused tests**

Run: `pnpm --filter @harmofin/api exec vitest run --config vitest.config.ts src/reports/report.application.service.test.ts && pnpm --filter @harmofin/api exec vitest run --config vitest.integration.config.ts test/reports.integration.test.ts test/journal.integration.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit Task 1**

```bash
git add apps/api/src/reports apps/api/src/transactions apps/api/test/reports.integration.test.ts apps/api/test/journal.integration.test.ts
git commit -m "feat: add plan fact reports"
```

### Task 2: Goal progress projection

**Files:**
- Modify: `apps/api/src/reports/report.dto.ts`
- Modify: `apps/api/src/reports/report.repository.ts`
- Modify: `apps/api/src/reports/report.application.service.ts`
- Modify: `apps/api/src/reports/report.application.service.test.ts`
- Modify: `apps/api/test/reports.integration.test.ts`

**Interfaces:**
- Consumes existing envelope target fields and `FinancialBalanceRepository` confirmed-only balance calculation.
- Produces typed `GoalProgressRow` for the existing `savings-goals` key; no schema migration or envelope mutation.

```ts
export type GoalProgressRow = {
  envelopeId: string;
  name: string;
  envelopeType: string;
  currentMinor: string;
  targetMinor: string;
  targetDate: string | null;
  remainingMinor: string;
  progressPermille: number;
  isReached: boolean;
  daysRemaining: number | null;
  journalFilters: { envelopeId: string };
};
```

- [ ] **Step 1: Write failing goal unit tests**

Use a fixed Moscow timestamp and target rows for under-target, exactly reached, over-target, target-without-date and past deadline. Assert exact integer behavior:

```ts
expect(goalRows(rows, now)).toEqual([
  expect.objectContaining({
    currentMinor: '25000',
    targetMinor: '50000',
    remainingMinor: '25000',
    progressPermille: 500,
    isReached: false,
    daysRemaining: 7,
  }),
  expect.objectContaining({ progressPermille: 1000, isReached: true, remainingMinor: '0' }),
]);
```

- [ ] **Step 2: Run unit test to verify it fails**

Run: `pnpm --filter @harmofin/api exec vitest run --config vitest.config.ts src/reports/report.application.service.test.ts`

Expected: FAIL because current goal rows lack remaining/progress/deadline values.

- [ ] **Step 3: Narrow goal repository input**

Make `savingsGoals` return active same-budget envelopes with non-null `targetAmountMinor`, their target date/type/name and `FinancialBalanceRepository.envelopeBalance`. Do not include archived envelopes or target-date-only invalid records.

- [ ] **Step 4: Calculate goal values on server**

Use `todayInTimezone(now, budget.timezone)` from cycle domain. Calculate `remainingMinor` and capped permille using `BigInt`; convert only final monetary fields to strings. Calculate `daysRemaining` from local calendar dates and return a signed number. Never call `Number` for money.

- [ ] **Step 5: Add goal DTO/OpenAPI schema**

Document `savings-goals` typed row fields, including integer `progressPermille`, `isReached`, nullable target date/deadline and canonical amount strings. Preserve existing report endpoint and existing basic report keys.

- [ ] **Step 6: Write integration proof**

Seed target envelopes in owner and foreign budgets, confirmed allocation/expense/transfer activity, an archived goal and a target without deadline. Assert confirmed balance only, `404` for foreign budget/filter, and no database mutation before/after GET.

- [ ] **Step 7: Run focused tests**

Run: `pnpm --filter @harmofin/api exec vitest run --config vitest.config.ts src/reports/report.application.service.test.ts && pnpm --filter @harmofin/api exec vitest run --config vitest.integration.config.ts test/reports.integration.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit Task 2**

```bash
git add apps/api/src/reports apps/api/test/reports.integration.test.ts
git commit -m "feat: add goal progress reports"
```

### Task 3: Owner-only CSV export API

**Files:**
- Create: `apps/api/src/exports/exports.module.ts`
- Create: `apps/api/src/exports/csv-export.repository.ts`
- Create: `apps/api/src/exports/csv-export.application.service.ts`
- Create: `apps/api/src/exports/exports.controller.ts`
- Create: `apps/api/src/exports/exports.dto.ts`
- Create: `apps/api/src/exports/exports.schemas.ts`
- Create: `apps/api/src/exports/csv-export.application.service.test.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/transactions/transaction.repository.ts`
- Create: `apps/api/test/exports.integration.test.ts`

**Interfaces:**
- Consumes validated journal query semantics from Task 1 and transaction owner/access checks.
- Produces `GET /api/v1/budgets/:budgetId/exports/transactions.csv`, an owner-only binary response and no persistent export object.

```ts
export type ExportTransactionsInput = Omit<ListTransactionsInput, 'limit' | 'cursor'>;

export type CsvExportResult = {
  filename: string;
  content: string;
};

export interface CsvExportApplicationService {
  exportTransactions(userId: string, budgetId: string, input: ExportTransactionsInput): Promise<CsvExportResult>;
}
```

- [ ] **Step 1: Write failing CSV unit tests**

Create tests with text containing semicolon, quote, CRLF and formula prefixes. Assert exact rows:

```ts
expect(csv).toBe(
  '﻿ID;Дата;Комментарий\r\n' +
    'transaction-id;2026-09-10;\'=SUM(A1:A2)\r\n',
);
```

Assert values beginning `=`, `+`, `-` and `@` receive one leading apostrophe, while amount minor string remains unchanged.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @harmofin/api exec vitest run --config vitest.config.ts src/exports/csv-export.application.service.test.ts`

Expected: FAIL because exports module does not exist.

- [ ] **Step 3: Define export query and OpenAPI contracts**

Create strict `ExportTransactionsInput` from journal filter fields without cursor or caller-controlled limit. Document CSV success with `text/csv`, 400/401/403/404/422 Problem Details, and `EXPORT_LIMIT_EXCEEDED`.

Use a fixed trusted filename such as `harmofin-operations.csv`; do not accept a filename or delimiter from HTTP.

- [ ] **Step 4: Implement owner policy and bounded query**

`CsvExportRepository` first queries an active accessible budget with membership role. Return `404` when missing; return `403` unless role is `OWNER`. Reuse the same scoped journal predicate/order from `TransactionRepository` and request `10_001` records. The service returns `422` if row count exceeds 10,000.

Select only export columns: transaction ID, date, type, status, `amountMinor`, currency, account/category/envelope names, source description, merchant, comment, planned flag, created/confirmed/cancelled/deleted timestamps. Do not load audit payloads, passwords or sessions.

- [ ] **Step 5: Implement CSV encoder and controller**

Encode Russian headers with `;`, CRLF and UTF-8 BOM. Quote values containing delimiter, quote, CR or LF; double embedded quotes; prefix risky cell text with apostrophe. Format only server decimal strings from `BIGINT`; never use float/`Number`.

Controller sends:

```ts
reply
  .header('Content-Type', 'text/csv; charset=utf-8')
  .header('Content-Disposition', 'attachment; filename="harmofin-operations.csv"')
  .send(result.content);
```

- [ ] **Step 6: Write failing integration tests**

Register owner/editor/viewer/foreign users. Seed filtered journal rows, formula text and 10,001 rows. Assert owner content/header/filter parity, editor/viewer `403`, foreign `404`, owner foreign filter `404`, exact escaping and `422 EXPORT_LIMIT_EXCEEDED`.

- [ ] **Step 7: Run focused tests**

Run: `pnpm --filter @harmofin/api exec vitest run --config vitest.config.ts src/exports/csv-export.application.service.test.ts && pnpm --filter @harmofin/api exec vitest run --config vitest.integration.config.ts test/exports.integration.test.ts test/journal.integration.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit Task 3**

```bash
git add apps/api/src/exports apps/api/src/app.module.ts apps/api/src/transactions/transaction.repository.ts apps/api/test/exports.integration.test.ts
git commit -m "feat: add CSV journal export"
```

### Task 4: Typed analytics tables for plan/fact and goals

**Files:**
- Create: `apps/web/app/components/analytics/PlanVsActualReport.vue`
- Create: `apps/web/app/components/analytics/PlanVsActualReport.test.ts`
- Create: `apps/web/app/components/analytics/GoalProgressReport.vue`
- Create: `apps/web/app/components/analytics/GoalProgressReport.test.ts`
- Modify: `apps/web/app/components/analytics/ReportChart.vue`
- Modify: `apps/web/app/components/analytics/ReportTable.vue`
- Modify: `apps/web/app/pages/app/analytics.vue`
- Modify: `apps/web/app/pages/app/analytics.test.ts`
- Modify: `apps/web/app/composables/useBudgetReferenceData.ts`
- Modify: `apps/web/app/composables/useBudgetReferenceData.test.ts`

**Interfaces:**
- Consumes typed `PlanVsActualReportDto` and `GoalProgressReportDto` from Tasks 1–2.
- Produces exact-money tables, server `progressPermille` display and report-to-journal links without browser financial calculations.

```ts
export type ReportDto =
  | { key: 'plan-vs-actual'; rows: PlanVsActualRowDto[] }
  | { key: 'savings-goals'; rows: GoalProgressRowDto[] }
  | { key: ExistingReportKey; rows: Array<Record<string, unknown>> };
```

- [ ] **Step 1: Write failing component tests**

For plan/fact, mount an exact server row and assert rendered planned/actual/variance values and `/app/operations?planId=plan-id&status=CONFIRMED` link. For goals, assert semantic `<progress max="1000" value="500">`, exact remaining amount and Russian overdue text for `daysRemaining: -2`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @harmofin/web exec vitest run --config vitest.config.ts app/components/analytics/PlanVsActualReport.test.ts app/components/analytics/GoalProgressReport.test.ts`

Expected: FAIL because typed components and DTOs do not exist.

- [ ] **Step 3: Add discriminated client DTOs**

Extend `ReportKey`, `ReportDto` and `getReport` types. Keep canonical amounts as strings and dates as API strings. Do not use `Number` for plan/fact or goal arithmetic.

- [ ] **Step 4: Implement accessible components**

`PlanVsActualReport` renders a labelled table with plan, planned, actual, variance, count and server-provided journal link. `GoalProgressReport` renders envelope, exact current/target/remaining values, native progress using `progressPermille`, `aria-valuetext` and deadline text. Both render a Russian empty state and work in one column on narrow viewports.

- [ ] **Step 5: Route typed reports in analytics page**

Add `План и факт` to report select. Render typed components only for their keys; leave existing generic charts/tables for existing keys. Preserve URL filters and load/error/retry behavior. Keep filters before report content.

- [ ] **Step 6: Update generic chart/table boundaries**

Ensure `ReportChart` and `ReportTable` receive only existing generic report rows. Do not render chart values for typed money reports through `Number`; their tables are the required accessible visual comparison.

- [ ] **Step 7: Run focused web tests**

Run: `pnpm --filter @harmofin/web exec vitest run --config vitest.config.ts app/components/analytics/PlanVsActualReport.test.ts app/components/analytics/GoalProgressReport.test.ts app/components/analytics/ReportChart.test.ts app/pages/app/analytics.test.ts app/composables/useBudgetReferenceData.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit Task 4**

```bash
git add apps/web/app/components/analytics apps/web/app/pages/app/analytics.* apps/web/app/composables/useBudgetReferenceData.*
git commit -m "feat: add typed analytics reports"
```

### Task 5: Operations CSV download UI

**Files:**
- Modify: `apps/web/app/composables/useApiClient.ts`
- Modify: `apps/web/app/composables/useApiClient.test.ts`
- Modify: `apps/web/app/composables/useBudgetReferenceData.ts`
- Modify: `apps/web/app/composables/useBudgetReferenceData.test.ts`
- Modify: `apps/web/app/pages/app/operations.vue`
- Modify: `apps/web/app/pages/app/operations.test.ts`

**Interfaces:**
- Consumes Task 3 `GET /exports/transactions.csv` and auth workspace role.
- Produces `downloadTransactionsCsv(budgetId, filters): Promise<Blob>` and owner-only `Экспорт CSV` journal control.

```ts
export interface RequestClient {
  request<T>(path: string, options?: RequestInit): Promise<T>;
  requestBlob(path: string, options?: RequestInit): Promise<Blob>;
}
```

- [ ] **Step 1: Write failing API-client and page tests**

Assert `requestBlob` preserves `credentials: 'include'`, origin header and Problem Details error parsing. Mount operations with owner role and verify its current filter object reaches download API. Mount editor role and assert the control is absent.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @harmofin/web exec vitest run --config vitest.config.ts app/composables/useApiClient.test.ts app/composables/useBudgetReferenceData.test.ts app/pages/app/operations.test.ts`

Expected: FAIL because binary request and export control do not exist.

- [ ] **Step 3: Add binary API request path**

Implement `requestBlob`: it uses same origin/session policy as `request`, does not attach JSON content type for GET, parses JSON Problem Details on failure, and returns `response.blob()` only for successful download. Add `downloadTransactionsCsv` with safe query serialization from `TransactionListInput` excluding cursor/limit.

- [ ] **Step 4: Implement owner UI and browser download**

Derive owner role from loaded auth workspace state. Reuse current journal filters, keep a local pending state and status/error live regions. On success create an object URL, trigger a fixed filename download through a temporary anchor and revoke URL after click. No client CSV generation or money conversion.

- [ ] **Step 5: Preserve responsive/keyboard behavior**

Place export beside journal actions with 44px control sizing and small-screen wrapping. Disabled/pending/error state remains text-visible and keyboard operable.

- [ ] **Step 6: Run focused web tests**

Run: `pnpm --filter @harmofin/web exec vitest run --config vitest.config.ts app/composables/useApiClient.test.ts app/composables/useBudgetReferenceData.test.ts app/pages/app/operations.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit Task 5**

```bash
git add apps/web/app/composables/useApiClient.* apps/web/app/composables/useBudgetReferenceData.* apps/web/app/pages/app/operations.*
git commit -m "feat: add CSV download control"
```

### Task 6: Cross-cutting proof and CI-only browser coverage

**Files:**
- Modify: `apps/api/test/reports.integration.test.ts`
- Modify: `apps/api/test/journal.integration.test.ts`
- Modify: `apps/api/test/exports.integration.test.ts`
- Modify: `apps/web/app/pages/app/analytics.test.ts`
- Modify: `apps/web/app/pages/app/operations.test.ts`
- Create: `e2e/stage-6-analytics-export.spec.ts`

**Interfaces:**
- Consumes full Stage 6 API and web contracts.
- Produces reproducible proof for finance isolation, CSV safety, mobile reachability and critical owner journey.

- [ ] **Step 1: Add combined integration matrix**

Test owner/editor/viewer/foreign matrix for reports, `planId` journal filter and CSV. Include owner-only `403`, foreign plan/filter `404`, non-cancelled snapshot replacement, confirmed-only actual, and no mutation of transaction/envelope counts after report/export GET.

- [ ] **Step 2: Add CSV adversarial tests**

Use comments and merchant names containing `=1+1`, `+SUM`, `-42`, `@cmd`, semicolons, quotes and newlines. Assert the raw bytes contain BOM, CRLF, quoted/escaped text and leading apostrophes. Assert 10,000 rows succeeds and 10,001 returns `422 EXPORT_LIMIT_EXCEEDED`.

- [ ] **Step 3: Add web responsive/accessibility tests**

Assert plan/fact and goal report tables have labels, exact status text, table fallback and no horizontal page overflow at 375px. Assert owner export status uses `role="status"`, error uses `role="alert"`, and editor sees no export control.

- [ ] **Step 4: Add CI-only Playwright flow**

Create owner data through existing helpers, then seed linked plan occurrence/confirmed actual and target envelope with test-supported Prisma setup. Verify plan/fact values and goal progress, set journal filter, download CSV, assert download filename/text and narrow viewport reachability. Use a second browser context/session for editor denial or hidden control. Add a clear CI-only describe label; do not add a local run step.

- [ ] **Step 5: Run browser-free coverage only**

Run: `pnpm --filter @harmofin/api exec vitest run --config vitest.integration.config.ts test/reports.integration.test.ts test/journal.integration.test.ts test/exports.integration.test.ts && pnpm --filter @harmofin/web exec vitest run --config vitest.config.ts app/pages/app/analytics.test.ts app/pages/app/operations.test.ts`

Expected: PASS. Do not run `pnpm test:e2e` locally.

- [ ] **Step 6: Commit Task 6**

```bash
git add apps/api/test apps/web/app/pages/app e2e/stage-6-analytics-export.spec.ts
git commit -m "test: cover Stage 6 workflows"
```

### Task 7: Final quality gate and review handoff

**Files:**
- Modify only files required by a verified failure in this task.

**Interfaces:**
- Consumes all Stage 6 contracts.
- Produces a verified branch suitable for code review. It does not merge, push or create a PR.

- [ ] **Step 1: Inspect changed scope**

Run: `git status --short && git diff --check && git diff --stat main...HEAD`

Expected: only Stage 6 source/tests/docs/migration changes, no secrets, generated database or unrelated user work.

- [ ] **Step 2: Run static gates**

Run:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
```

Expected: all commands exit `0`.

- [ ] **Step 3: Run test gates sequentially**

Run:

```bash
pnpm test
pnpm test:integration
```

Expected: all suites exit `0`. Run sequentially so the API process integration test is not CPU-starved by an overlapping root test process.

- [ ] **Step 4: Run build, Compose and migration gates**

Run:

```bash
pnpm build
docker compose -f infra/compose/local.yml config --quiet
pnpm db:migrate
```

Expected: all commands exit `0`. Do not run browser E2E locally.

- [ ] **Step 5: Review inline and fix confirmed findings**

Review current branch directly in the checkout. Confirm financial correctness, confirmed-only projections, budget/role isolation, CSV formula safety, OpenAPI, accessibility and no client money calculation. Write a regression test before each correction; rerun relevant gates.

- [ ] **Step 6: Commit final corrections if any**

```bash
git status --short
git add <only-reviewed-stage-6-paths>
git commit -m "fix: finalize Stage 6 quality gates"
```

- [ ] **Step 7: Handoff**

Report branch, commits, migration state, verification evidence, CI-only Playwright path, CSV row limit and deliberately excluded XLSX/S3/export-worker features. Do not merge, push, create a PR or delete the branch without explicit user approval.

## Plan self-review

- **Spec coverage:** Tasks 1–2 implement typed plan/fact and goals; Task 3 implements owner CSV contract/security; Tasks 4–5 implement server-driven responsive UI; Task 6 proves security/accessibility/CI journey; Task 7 runs final gates.
- **No placeholders:** every deliverable has exact files, interfaces, failure proof, focused command and commit boundary.
- **Type consistency:** `plan-vs-actual`, `PlanVsActualRow`, `GoalProgressRow`, `planId`, `downloadTransactionsCsv` and `EXPORT_LIMIT_EXCEEDED` use the same names throughout.
