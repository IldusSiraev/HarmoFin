# Plans Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `/app/plans` list-only UI with a calendar-first UX (day cells with financial stats, a day-detail panel, a tabbed plan list, and a reworked plan form) built entirely on the frontend, reusing existing API endpoints.

**Architecture:** No backend changes. The frontend gains small pure-logic modules (calendar grid math, day aggregation, KPI math) plus new Vue components under `apps/web/app/components/plans/`, orchestrated by a rewritten `apps/web/app/pages/app/plans.vue`. `PlanOccurrenceCard.vue`/`PlanCard.vue` are replaced by `PlanOccurrenceRow.vue`/`PlanRow.vue` built on the existing `UiListRow`/`UiActionMenu` primitives.

**Tech Stack:** Vue 3 `<script setup>`, Nuxt 4, `date-fns` (already a dependency, used by `UiDatePicker`), Vitest + `@vue/test-utils`, Playwright (CI-only e2e).

**Spec:** [docs/superpowers/specs/2026-09-24-plans-page-redesign-design.md](../specs/2026-09-24-plans-page-redesign-design.md)

## Global Constraints

- No API/OpenAPI changes — every task uses endpoints that already exist (`GET/POST/PATCH/DELETE budgets/:budgetId/plans`, `GET budgets/:budgetId/plans/occurrences` with `from`/`to`, `.../skip`, `.../complete`, `.../create-draft`, `GET budgets/:budgetId/transactions` with `from`/`to`).
- Never use floating point for money. All amount math in new code uses `BigInt` on minor-unit strings, matching `formatMinorUnits` in [money-format.ts](../../../apps/web/app/components/finance/money-format.ts).
- Recurrence values are exactly `ONE_TIME` / `MONTHLY` / `EVERY_N_MONTHS` / `YEARLY` (functional spec §13.3) — do not add a weekly option.
- UI text is Russian; code identifiers are English (CLAUDE.md).
- Controls must be usable without hover (touch-friendly) — no action that is only reachable on `:hover`.
- Follow the Calm Fintech guideline (`docs/superpowers/specs/2026-09-17-calm-fintech-visual-guidelines.md`) for colors/cards: use `--hf-color-status-success`/`--hf-color-status-danger`/`--hf-color-brand` tokens, never hardcoded hex.
- Every new file's imports use the existing `.js`/`.vue` extension convention (NodeNext resolution) — see any existing file in `apps/web/app/composables` or `apps/web/app/components` for the pattern.
- Existing `plans.vue` idempotency-key pattern (`crypto.randomUUID()` cached per logical operation in a `Map`) must be preserved for every mutating call.
- Playwright e2e specs are CI-only — do not run them locally (per project convention); implement and reason about them statically.

---

## File Structure

Create:
- `apps/web/app/components/finance/money-format.ts` — **modify**, add `formatCompactSigned`.
- `apps/web/app/composables/useBudgetReferenceData.ts` — **modify**, widen `listPlanOccurrences` input type.
- `apps/web/app/components/plans/group-by-active.ts` (+ test) — groups `RegularPlanDto[]` into active/inactive.
- `apps/web/app/components/plans/calendar-grid.ts` (+ test) — pure 42-cell month grid builder.
- `apps/web/app/components/plans/day-aggregates.ts` (+ test) — per-day net amount + dot status.
- `apps/web/app/components/plans/plan-kpi.ts` (+ test) — monthly KPI reduction.
- `apps/web/app/components/plans/PlanOccurrenceRow.vue` (+ test) — replaces `PlanOccurrenceCard.vue`.
- `apps/web/app/components/plans/PlanRow.vue` (+ test) — replaces `PlanCard.vue`.
- `apps/web/app/components/plans/PlansCalendar.vue` (+ test).
- `apps/web/app/components/plans/PlanKpiRow.vue` (+ test).
- `apps/web/app/components/plans/PlanList.vue` (+ test).
- `apps/web/app/components/plans/PlanDayPanel.vue` (+ test).

Rewrite:
- `apps/web/app/components/plans/PlanForm.vue` (+ its test).
- `apps/web/app/pages/app/plans.vue` (+ its test).

Delete:
- `apps/web/app/components/plans/PlanCard.vue`
- `apps/web/app/components/plans/PlanOccurrenceCard.vue`

Modify:
- `e2e/stage-5-plans-notifications.spec.ts` — update selectors for the new structure.

---

### Task 1: Widen `listPlanOccurrences` to accept `from`/`to`

**Files:**
- Modify: `apps/web/app/composables/useBudgetReferenceData.ts:663-666` (type), `:935-940` (implementation already forwards arbitrary keys — no change needed there).
- Test: `apps/web/app/composables/useBudgetReferenceData.test.ts`

**Interfaces:**
- Produces: `listPlanOccurrences(budgetId: string, input?: { planId?: string; status?: PlanOccurrenceStatus; from?: string; to?: string }): Promise<PlanOccurrenceDto[]>` — used by every later task that fetches occurrences.

- [ ] **Step 1: Write the failing test**

Add to `apps/web/app/composables/useBudgetReferenceData.test.ts` inside the existing `describe('plans API client', ...)` block:

```ts
it('forwards a scheduled-date range when listing occurrences', async () => {
  const request = vi.fn().mockResolvedValue({ items: [] });
  const data = createBudgetReferenceData({ request, requestBlob: vi.fn() });

  await data.listPlanOccurrences('budget-id', { from: '2026-09-01', to: '2026-09-30' });

  expect(request).toHaveBeenCalledWith(
    '/api/v1/budgets/budget-id/plans/occurrences?from=2026-09-01&to=2026-09-30',
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test -- useBudgetReferenceData.test.ts -t "forwards a scheduled-date range"`
Expected: FAIL — TypeScript error (`from`/`to` not assignable) or, if TS is not checked by vitest here, a runtime pass already (since `withQuery` forwards unknown keys). Either way, proceed to Step 3 so the type is correct; if the test already passes at runtime, Step 3 still fixes the type-check failure that `pnpm typecheck` would report.

- [ ] **Step 3: Widen the type**

In `apps/web/app/composables/useBudgetReferenceData.ts`, replace lines 663-666:

```ts
  listPlanOccurrences(
    budgetId: string,
    input?: { planId?: string | undefined; status?: PlanOccurrenceStatus | undefined },
  ): Promise<PlanOccurrenceDto[]>;
```

with:

```ts
  listPlanOccurrences(
    budgetId: string,
    input?: {
      planId?: string | undefined;
      status?: PlanOccurrenceStatus | undefined;
      from?: string | undefined;
      to?: string | undefined;
    },
  ): Promise<PlanOccurrenceDto[]>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web test -- useBudgetReferenceData.test.ts -t "forwards a scheduled-date range"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/composables/useBudgetReferenceData.ts apps/web/app/composables/useBudgetReferenceData.test.ts
git commit -m "feat(web): allow date-range filtering when listing plan occurrences"
```

---

### Task 2: Compact signed money formatter

**Files:**
- Modify: `apps/web/app/components/finance/money-format.ts`
- Test: `apps/web/app/components/finance/money-format.test.ts`

**Interfaces:**
- Produces: `formatCompactSigned(signedMinor: string, scale: number): string` — `signedMinor` already carries the sign (positive for income, negated for expense, same convention as `signedMinor` in [OperationRow.vue:32-34](../../../apps/web/app/components/operations/OperationRow.vue#L32-L34)). Returns e.g. `"+106к"`, `"−4к"`, `"−850"`, with no currency suffix (used only in the compact calendar cell). Used by Task 11 (`PlansCalendar.vue`).

- [ ] **Step 1: Write the failing test**

Append to `apps/web/app/components/finance/money-format.test.ts` — the file already imports `formatMinorUnits` from `./money-format.js` at the top, so only add `formatCompactSigned` to that existing import statement rather than adding a second one:

```ts
describe('formatCompactSigned', () => {
  it('shows the exact amount below one thousand', () => {
    expect(formatCompactSigned('85000', 2)).toBe('+850');
    expect(formatCompactSigned('-85000', 2)).toBe('−850');
  });

  it('rounds to the nearest thousand at or above one thousand', () => {
    expect(formatCompactSigned('10600000', 2)).toBe('+106к');
    expect(formatCompactSigned('-300000', 2)).toBe('−3к');
    expect(formatCompactSigned('-435000', 2)).toBe('−4к');
  });

  it('rejects a non-integer minor-unit string the same way formatMinorUnits does', () => {
    expect(() => formatCompactSigned('1.25', 2)).toThrow(TypeError);
  });
});
```

(`−` is the minus sign U+2212, `к` is Cyrillic «к» — written as escapes here so the plan file stays ASCII-safe; write the literal characters `−` and `к` in the actual test file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test -- money-format.test.ts -t "formatCompactSigned"`
Expected: FAIL with "formatCompactSigned is not a function" (import error).

- [ ] **Step 3: Implement `formatCompactSigned`**

Add to `apps/web/app/components/finance/money-format.ts` (after `formatMinorUnits`):

```ts
export function formatCompactSigned(signedMinor: string, scale: number): string {
  if (!/^-?\d+$/.test(signedMinor)) {
    throw new TypeError('signedMinor must be an integer string');
  }
  if (!Number.isSafeInteger(scale) || scale < 0) {
    throw new TypeError('scale must be a non-negative safe integer');
  }

  const value = BigInt(signedMinor);
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const divisor = 10n ** BigInt(scale);
  const whole = magnitude / divisor;
  const sign = negative ? '−' : '+';

  if (whole < 1000n) {
    return `${sign}${whole}`;
  }

  const thousands = (whole + 500n) / 1000n;
  return `${sign}${thousands}к`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web test -- money-format.test.ts`
Expected: PASS (all tests in the file, including the pre-existing `formatMinorUnits` ones)

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/components/finance/money-format.ts apps/web/app/components/finance/money-format.test.ts
git commit -m "feat(web): add compact signed money formatter for the plans calendar"
```

---

### Task 3: Group plans by active state

**Files:**
- Create: `apps/web/app/components/plans/group-by-active.ts`
- Test: `apps/web/app/components/plans/group-by-active.test.ts`

**Interfaces:**
- Consumes: `RegularPlanDto` from `useBudgetReferenceData.js` (already defined, `isActive: boolean`, `name: string`).
- Produces: `groupByActive(plans: ReadonlyArray<RegularPlanDto>): PlanGroup[]` where `PlanGroup = { active: boolean; label: string; items: RegularPlanDto[] }`. Used by Task 10 (`PlanList.vue`) for the "Все" tab.

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/components/plans/group-by-active.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { groupByActive } from './group-by-active.js';
import type { RegularPlanDto } from '../../composables/useBudgetReferenceData.js';

function plan(overrides: Partial<RegularPlanDto>): RegularPlanDto {
  return {
    id: 'plan-id',
    budgetId: 'budget-id',
    name: 'План',
    planType: 'EXPENSE',
    amountMinor: '100000',
    currency: 'RUB',
    scale: 2,
    anchorOn: '2026-09-01',
    startOn: '2026-09-01',
    endOn: null,
    recurrence: 'MONTHLY',
    intervalMonths: null,
    accountId: null,
    categoryId: 'category-id',
    envelopeId: 'envelope-id',
    comment: null,
    isActive: true,
    disabledAt: null,
    deletedAt: null,
    ...overrides,
  };
}

describe('groupByActive', () => {
  it('splits plans into an active group and an inactive group, each sorted by name', () => {
    const plans = [
      plan({ id: 'b', name: 'Б план', isActive: true }),
      plan({ id: 'a', name: 'А план', isActive: true }),
      plan({ id: 'c', name: 'В план', isActive: false }),
    ];

    const groups = groupByActive(plans);

    expect(groups).toEqual([
      { active: true, label: 'Активные', items: [plans[1], plans[0]] },
      { active: false, label: 'Отключённые', items: [plans[2]] },
    ]);
  });

  it('omits a group with no plans', () => {
    const groups = groupByActive([plan({ id: 'a', isActive: true })]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.active).toBe(true);
  });
});
```

(Cyrillic literals as escapes for plan-file ASCII-safety again — write actual Cyrillic text `Б план`, `А план`, `В план`, `Активные`, `Отключённые` in the real file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test -- group-by-active.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `groupByActive`**

Create `apps/web/app/components/plans/group-by-active.ts`:

```ts
import type { RegularPlanDto } from '../../composables/useBudgetReferenceData.js';

export interface PlanGroup {
  active: boolean;
  label: string;
  items: RegularPlanDto[];
}

export function groupByActive(plans: ReadonlyArray<RegularPlanDto>): PlanGroup[] {
  return [true, false].flatMap((active) => {
    const items = plans
      .filter((plan) => plan.isActive === active)
      .sort((left, right) => left.name.localeCompare(right.name, 'ru'));
    if (items.length === 0) return [];
    return [{ active, label: active ? 'Активные' : 'Отключённые', items }];
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web test -- group-by-active.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/components/plans/group-by-active.ts apps/web/app/components/plans/group-by-active.test.ts
git commit -m "feat(web): add active/inactive grouping for the plans list"
```

---

### Task 4: Calendar grid builder

**Files:**
- Create: `apps/web/app/components/plans/calendar-grid.ts`
- Test: `apps/web/app/components/plans/calendar-grid.test.ts`

**Interfaces:**
- Produces: `buildCalendarGrid(monthAnchor: string): CalendarCell[]` where `CalendarCell = { date: string; inCurrentMonth: boolean }`, `monthAnchor` is any `yyyy-MM-dd` date inside the target month, and the result is always exactly 42 cells (6 Monday-first weeks) sorted chronologically. Used by Task 11 (`PlansCalendar.vue`) and Task 14 (`plans.vue`, to compute the fetch range as `grid[0].date`..`grid[41].date`).

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/components/plans/calendar-grid.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { buildCalendarGrid } from './calendar-grid.js';

describe('buildCalendarGrid', () => {
  it('builds a Monday-first 42-cell grid spanning the neighboring months', () => {
    const grid = buildCalendarGrid('2026-09-01');

    expect(grid).toHaveLength(42);
    expect(grid[0]).toEqual({ date: '2026-08-31', inCurrentMonth: false });
    expect(grid[1]).toEqual({ date: '2026-09-01', inCurrentMonth: true });
    expect(grid[30]).toEqual({ date: '2026-09-30', inCurrentMonth: true });
    expect(grid[41]).toEqual({ date: '2026-10-11', inCurrentMonth: false });
    expect(grid.filter((cell) => cell.inCurrentMonth)).toHaveLength(30);
  });

  it('is stable for any day within the month, not just the first', () => {
    expect(buildCalendarGrid('2026-09-15')).toEqual(buildCalendarGrid('2026-09-01'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test -- calendar-grid.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `buildCalendarGrid`**

Create `apps/web/app/components/plans/calendar-grid.ts`:

```ts
import { addDays, format, startOfMonth, startOfWeek } from 'date-fns';

export interface CalendarCell {
  date: string;
  inCurrentMonth: boolean;
}

export function buildCalendarGrid(monthAnchor: string): CalendarCell[] {
  const month = startOfMonth(parsePlainDate(monthAnchor));
  const gridStart = startOfWeek(month, { weekStartsOn: 1 });

  return Array.from({ length: 42 }, (_, index) => {
    const day = addDays(gridStart, index);
    return {
      date: format(day, 'yyyy-MM-dd'),
      inCurrentMonth: day.getMonth() === month.getMonth(),
    };
  });
}

function parsePlainDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year as number, (month as number) - 1, day as number);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web test -- calendar-grid.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/components/plans/calendar-grid.ts apps/web/app/components/plans/calendar-grid.test.ts
git commit -m "feat(web): add pure calendar-grid builder for the plans page"
```

---

### Task 5: Day aggregates (net amount + plan dot per day)

**Files:**
- Create: `apps/web/app/components/plans/day-aggregates.ts`
- Test: `apps/web/app/components/plans/day-aggregates.test.ts`

**Interfaces:**
- Consumes: `TransactionDto` (`occurredOn`, `amountMinor`, `transactionType`), `PlanOccurrenceDto` (`scheduledOn`, `status`) from `useBudgetReferenceData.js`.
- Produces: `buildDayAggregates(transactions, occurrences, today): Record<string, DayAggregate>` where `DayAggregate = { netMinor: bigint; dot: 'none' | 'upcoming' | 'overdue' }`, keyed by `yyyy-MM-dd`. Used by Task 11 (`PlansCalendar.vue`).

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/components/plans/day-aggregates.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { buildDayAggregates } from './day-aggregates.js';

describe('buildDayAggregates', () => {
  it('nets confirmed transactions per day, income positive and expense negative', () => {
    const aggregates = buildDayAggregates(
      [
        { occurredOn: '2026-09-13', amountMinor: '350000', transactionType: 'EXPENSE' },
        { occurredOn: '2026-09-13', amountMinor: '85000', transactionType: 'EXPENSE' },
        { occurredOn: '2026-09-10', amountMinor: '10600000', transactionType: 'INCOME' },
      ],
      [],
      '2026-09-24',
    );

    expect(aggregates['2026-09-13']?.netMinor).toBe(-435000n);
    expect(aggregates['2026-09-10']?.netMinor).toBe(10600000n);
  });

  it('marks a past DUE occurrence overdue and a future PENDING one upcoming', () => {
    const aggregates = buildDayAggregates(
      [],
      [
        { scheduledOn: '2026-09-10', status: 'DUE' },
        { scheduledOn: '2026-09-26', status: 'PENDING' },
        { scheduledOn: '2026-09-24', status: 'DUE' },
      ],
      '2026-09-24',
    );

    expect(aggregates['2026-09-10']?.dot).toBe('overdue');
    expect(aggregates['2026-09-26']?.dot).toBe('upcoming');
    expect(aggregates['2026-09-24']?.dot).toBe('upcoming');
  });

  it('ignores completed, skipped, and cancelled occurrences for the dot', () => {
    const aggregates = buildDayAggregates(
      [],
      [
        { scheduledOn: '2026-09-05', status: 'COMPLETED' },
        { scheduledOn: '2026-09-06', status: 'SKIPPED' },
        { scheduledOn: '2026-09-07', status: 'CANCELLED' },
      ],
      '2026-09-24',
    );

    expect(aggregates['2026-09-05']).toBeUndefined();
    expect(aggregates['2026-09-06']).toBeUndefined();
    expect(aggregates['2026-09-07']).toBeUndefined();
  });

  it('keeps an overdue dot even when a same-day transaction also nets to zero contribution', () => {
    const aggregates = buildDayAggregates(
      [{ occurredOn: '2026-09-10', amountMinor: '100', transactionType: 'INCOME' }],
      [{ scheduledOn: '2026-09-10', status: 'DUE' }],
      '2026-09-24',
    );

    expect(aggregates['2026-09-10']).toEqual({ netMinor: 100n, dot: 'overdue' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test -- day-aggregates.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `buildDayAggregates`**

Create `apps/web/app/components/plans/day-aggregates.ts`:

```ts
import type { PlanOccurrenceDto, TransactionDto } from '../../composables/useBudgetReferenceData.js';

export interface DayAggregate {
  netMinor: bigint;
  dot: 'none' | 'upcoming' | 'overdue';
}

type TransactionForAggregate = Pick<TransactionDto, 'occurredOn' | 'amountMinor' | 'transactionType'>;
type OccurrenceForAggregate = Pick<PlanOccurrenceDto, 'scheduledOn' | 'status'>;

export function buildDayAggregates(
  transactions: ReadonlyArray<TransactionForAggregate>,
  occurrences: ReadonlyArray<OccurrenceForAggregate>,
  today: string,
): Record<string, DayAggregate> {
  const byDate: Record<string, DayAggregate> = {};

  for (const transaction of transactions) {
    const signed =
      transaction.transactionType === 'INCOME'
        ? BigInt(transaction.amountMinor)
        : -BigInt(transaction.amountMinor);
    const existing = byDate[transaction.occurredOn] ?? { netMinor: 0n, dot: 'none' as const };
    byDate[transaction.occurredOn] = { ...existing, netMinor: existing.netMinor + signed };
  }

  for (const occurrence of occurrences) {
    if (occurrence.status !== 'PENDING' && occurrence.status !== 'DUE') continue;
    const overdue = occurrence.status === 'DUE' && occurrence.scheduledOn < today;
    const existing = byDate[occurrence.scheduledOn] ?? { netMinor: 0n, dot: 'none' as const };
    const dot = overdue || existing.dot === 'overdue' ? 'overdue' : 'upcoming';
    byDate[occurrence.scheduledOn] = { ...existing, dot };
  }

  return byDate;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web test -- day-aggregates.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/components/plans/day-aggregates.ts apps/web/app/components/plans/day-aggregates.test.ts
git commit -m "feat(web): compute per-day net amount and plan-dot status for the calendar"
```

---

### Task 6: Monthly plan KPI math

**Files:**
- Create: `apps/web/app/components/plans/plan-kpi.ts`
- Test: `apps/web/app/components/plans/plan-kpi.test.ts`

**Interfaces:**
- Produces: `computePlanKpi(monthOccurrences, activePlanCount): PlanKpi` where `PlanKpi = { plannedIncomeMinor: string; plannedExpenseMinor: string; balanceMinor: string; totalPlans: number }`. Used by Task 14 (`plans.vue`) to feed Task 9 (`PlanKpiRow.vue`).

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/components/plans/plan-kpi.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { computePlanKpi } from './plan-kpi.js';

describe('computePlanKpi', () => {
  it('sums income and expense/savings occurrences separately and nets the balance', () => {
    const kpi = computePlanKpi(
      [
        { planType: 'INCOME', amountMinor: '1500000', status: 'PENDING' },
        { planType: 'EXPENSE', amountMinor: '3600000', status: 'DUE' },
        { planType: 'SAVINGS', amountMinor: '2500000', status: 'PENDING' },
      ],
      5,
    );

    expect(kpi).toEqual({
      plannedIncomeMinor: '1500000',
      plannedExpenseMinor: '6100000',
      balanceMinor: '-4600000',
      totalPlans: 5,
    });
  });

  it('excludes cancelled occurrences', () => {
    const kpi = computePlanKpi(
      [{ planType: 'EXPENSE', amountMinor: '100000', status: 'CANCELLED' }],
      0,
    );

    expect(kpi.plannedExpenseMinor).toBe('0');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test -- plan-kpi.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `computePlanKpi`**

Create `apps/web/app/components/plans/plan-kpi.ts`:

```ts
import type { PlanOccurrenceDto } from '../../composables/useBudgetReferenceData.js';

export interface PlanKpi {
  plannedIncomeMinor: string;
  plannedExpenseMinor: string;
  balanceMinor: string;
  totalPlans: number;
}

type OccurrenceForKpi = Pick<PlanOccurrenceDto, 'planType' | 'amountMinor' | 'status'>;

export function computePlanKpi(
  monthOccurrences: ReadonlyArray<OccurrenceForKpi>,
  activePlanCount: number,
): PlanKpi {
  let income = 0n;
  let expense = 0n;

  for (const occurrence of monthOccurrences) {
    if (occurrence.status === 'CANCELLED') continue;
    const amount = BigInt(occurrence.amountMinor);
    if (occurrence.planType === 'INCOME') income += amount;
    else expense += amount;
  }

  return {
    plannedIncomeMinor: income.toString(),
    plannedExpenseMinor: expense.toString(),
    balanceMinor: (income - expense).toString(),
    totalPlans: activePlanCount,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web test -- plan-kpi.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/components/plans/plan-kpi.ts apps/web/app/components/plans/plan-kpi.test.ts
git commit -m "feat(web): compute monthly plan KPI totals"
```

---

### Task 7: `PlanOccurrenceRow.vue`

**Files:**
- Create: `apps/web/app/components/plans/PlanOccurrenceRow.vue`
- Test: `apps/web/app/components/plans/PlanOccurrenceRow.test.ts`
- Delete (end of this task): `apps/web/app/components/plans/PlanOccurrenceCard.vue`

**Interfaces:**
- Consumes: `PlanOccurrenceDto` from `useBudgetReferenceData.js`; `categoryIcon` from `../operations/category-icon.js`; `UiListRow` from `../ui/ListRow.vue`; `UiActionMenu` from `../ui/ActionMenu.vue`; `FinanceMoney` from `../finance/FinanceMoney.vue`.
- Produces props: `{ occurrence: PlanOccurrenceDto; categoryIcon: string | null; pending?: boolean }` — `categoryIcon` is the occurrence's category's `icon` field (design decision: a plan's icon *is* its category's icon), resolved by the caller since this component never loads the category list itself. Emits: `complete: []`, `draft: []`, `skip: []`, `edit: []`, `remove: []`. Used by Task 10 (`PlanList.vue`) and Task 12 (`PlanDayPanel.vue`).

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/components/plans/PlanOccurrenceRow.test.ts`:

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import PlanOccurrenceRow from './PlanOccurrenceRow.vue';
import type { PlanOccurrenceDto } from '../../composables/useBudgetReferenceData.js';

function occurrence(overrides: Partial<PlanOccurrenceDto> = {}): PlanOccurrenceDto {
  return {
    id: 'occurrence-id',
    planId: 'plan-id',
    planName: 'Ипотека',
    planType: 'EXPENSE',
    scheduledOn: '2026-09-26',
    status: 'DUE',
    amountMinor: '3600000',
    currency: 'RUB',
    scale: 2,
    accountId: 'account-id',
    categoryId: 'category-id',
    envelopeId: 'envelope-id',
    comment: null,
    transactionId: null,
    cancellationReason: null,
    ...overrides,
  };
}

describe('PlanOccurrenceRow', () => {
  it('emits complete when the checkbox is checked', async () => {
    const wrapper = mount(PlanOccurrenceRow, {
      props: { occurrence: occurrence(), categoryIcon: null },
    });

    await wrapper.get('input[type="checkbox"]').setValue(true);

    expect(wrapper.emitted('complete')).toHaveLength(1);
  });

  it('emits edit and remove from the always-visible icon buttons', async () => {
    const wrapper = mount(PlanOccurrenceRow, {
      props: { occurrence: occurrence(), categoryIcon: null },
    });

    await wrapper.get('[data-action="edit-occurrence-plan"]').trigger('click');
    await wrapper.get('[data-action="remove-occurrence-plan"]').trigger('click');

    expect(wrapper.emitted('edit')).toHaveLength(1);
    expect(wrapper.emitted('remove')).toHaveLength(1);
  });

  it('offers draft and skip in the overflow menu when both apply', async () => {
    const wrapper = mount(PlanOccurrenceRow, {
      props: { occurrence: occurrence(), categoryIcon: null },
    });

    await wrapper.get('[data-testid="action-menu-trigger"]').trigger('click');
    await wrapper.get('[data-testid="row-draft"]').trigger('click');
    expect(wrapper.emitted('draft')).toHaveLength(1);

    await wrapper.get('[data-testid="row-skip"]').trigger('click');
    expect(wrapper.emitted('skip')).toHaveLength(1);
  });

  it('hides draft for a savings occurrence and hides both once a transaction exists', () => {
    const savings = mount(PlanOccurrenceRow, {
      props: { occurrence: occurrence({ planType: 'SAVINGS' }), categoryIcon: null },
    });
    expect(savings.find('[data-testid="row-draft"]').exists()).toBe(false);
    expect(savings.find('[data-testid="row-skip"]').exists()).toBe(true);

    const withTransaction = mount(PlanOccurrenceRow, {
      props: { occurrence: occurrence({ transactionId: 'transaction-id' }), categoryIcon: null },
    });
    expect(withTransaction.find('[data-testid="action-menu-trigger"]').exists()).toBe(false);
  });

  it('shows a status label with no actions for a completed occurrence', () => {
    const wrapper = mount(PlanOccurrenceRow, {
      props: { occurrence: occurrence({ status: 'COMPLETED' }), categoryIcon: null },
    });

    expect(wrapper.text()).toContain('Выполнено');
    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false);
  });

  it('renders a leading icon regardless of whether a category icon is set', () => {
    const withCategoryIcon = mount(PlanOccurrenceRow, {
      props: { occurrence: occurrence(), categoryIcon: 'house' },
    });
    const withoutCategoryIcon = mount(PlanOccurrenceRow, {
      props: { occurrence: occurrence(), categoryIcon: null },
    });

    expect(withCategoryIcon.find('svg').exists()).toBe(true);
    expect(withoutCategoryIcon.find('svg').exists()).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test -- PlanOccurrenceRow.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `PlanOccurrenceRow.vue`**

Create `apps/web/app/components/plans/PlanOccurrenceRow.vue`:

```vue
<script setup lang="ts">
import { computed } from 'vue';
import { Pencil, X } from '@lucide/vue';

import { categoryIcon as resolveCategoryIcon } from '../operations/category-icon.js';
import FinanceMoney from '../finance/FinanceMoney.vue';
import UiActionMenu from '../ui/ActionMenu.vue';
import UiListRow from '../ui/ListRow.vue';
import type { PlanOccurrenceDto } from '../../composables/useBudgetReferenceData.js';

defineOptions({ name: 'PlanOccurrenceRow' });

const props = withDefaults(
  defineProps<{ occurrence: PlanOccurrenceDto; categoryIcon: string | null; pending?: boolean }>(),
  { pending: false },
);

const emit = defineEmits<{
  complete: [];
  draft: [];
  skip: [];
  edit: [];
  remove: [];
}>();

const icon = computed(() =>
  resolveCategoryIcon(
    props.categoryIcon,
    props.occurrence.planType === 'INCOME' ? 'INCOME' : 'EXPENSE',
  ),
);

const isActionable = computed(
  () => props.occurrence.status === 'PENDING' || props.occurrence.status === 'DUE',
);

const canDraft = computed(
  () => isActionable.value && props.occurrence.planType !== 'SAVINGS' && !props.occurrence.transactionId,
);

const canSkip = computed(() => isActionable.value && !props.occurrence.transactionId);

const statusLabel = computed(() => {
  if (props.occurrence.status === 'SKIPPED') return 'Пропущено';
  if (props.occurrence.status === 'COMPLETED') return 'Выполнено';
  if (props.occurrence.status === 'CANCELLED') return 'Отменено';
  return null;
});

const rowLabel = computed(
  () => `Возникновение плана «${props.occurrence.planName}» от ${props.occurrence.scheduledOn}`,
);

function handleCheckbox(event: Event) {
  if ((event.target as HTMLInputElement).checked) emit('complete');
}
</script>

<template>
  <UiListRow :label="rowLabel">
    <template #leading><component :is="icon" :size="20" aria-hidden="true" /></template>

    <span class="plan-occurrence-row__title">{{ occurrence.planName }}</span>
    <span class="plan-occurrence-row__subtitle">{{ occurrence.scheduledOn }}</span>
    <span v-if="statusLabel" class="plan-occurrence-row__status">{{ statusLabel }}</span>

    <template #trailing>
      <FinanceMoney
        class="plan-occurrence-row__amount"
        :minor-units="occurrence.amountMinor"
        :currency="occurrence.currency"
        :scale="occurrence.scale"
      />
    </template>

    <template #actions>
      <div v-if="isActionable" class="plan-occurrence-row__controls">
        <label class="plan-occurrence-row__complete">
          <input
            type="checkbox"
            :disabled="pending"
            :aria-label="`Отметить «${occurrence.planName}» выполненным`"
            @change="handleCheckbox"
          />
        </label>
        <button
          type="button"
          data-action="edit-occurrence-plan"
          class="plan-occurrence-row__icon-button"
          aria-label="Изменить план"
          :disabled="pending"
          @click="$emit('edit')"
        >
          <Pencil :size="18" aria-hidden="true" />
        </button>
        <button
          type="button"
          data-action="remove-occurrence-plan"
          class="plan-occurrence-row__icon-button"
          aria-label="Удалить план"
          :disabled="pending"
          @click="$emit('remove')"
        >
          <X :size="18" aria-hidden="true" />
        </button>
        <UiActionMenu v-if="canDraft || canSkip" label="Ещё действия с планом">
          <button
            v-if="canDraft"
            type="button"
            role="menuitem"
            data-testid="row-draft"
            @click="$emit('draft')"
          >
            Создать черновик
          </button>
          <button
            v-if="canSkip"
            type="button"
            role="menuitem"
            data-testid="row-skip"
            @click="$emit('skip')"
          >
            Пропустить
          </button>
        </UiActionMenu>
      </div>
    </template>
  </UiListRow>
</template>

<style scoped>
.plan-occurrence-row__title {
  overflow: hidden;
  font-weight: var(--hf-font-weight-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.plan-occurrence-row__subtitle,
.plan-occurrence-row__status {
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
}
.plan-occurrence-row__amount {
  font-weight: var(--hf-font-weight-semibold);
  white-space: nowrap;
}
.plan-occurrence-row__controls {
  display: flex;
  gap: var(--hf-space-1);
  align-items: center;
}
.plan-occurrence-row__complete {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.75rem;
  height: 2.75rem;
}
.plan-occurrence-row__complete input {
  width: 1.25rem;
  height: 1.25rem;
}
.plan-occurrence-row__icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.75rem;
  height: 2.75rem;
  border: 0;
  border-radius: var(--hf-radius-md);
  background: transparent;
  color: var(--hf-color-text-muted);
  cursor: pointer;
}
.plan-occurrence-row__icon-button:hover:not(:disabled) {
  background: var(--hf-color-action-secondary-hover);
  color: var(--hf-color-text);
}
.plan-occurrence-row__icon-button:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
}
.plan-occurrence-row__icon-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
```

Delete the file it replaces:

```bash
git rm apps/web/app/components/plans/PlanOccurrenceCard.vue
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web test -- PlanOccurrenceRow.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/components/plans/PlanOccurrenceRow.vue apps/web/app/components/plans/PlanOccurrenceRow.test.ts
git commit -m "feat(web): add PlanOccurrenceRow, replacing PlanOccurrenceCard"
```

---

### Task 8: `PlanRow.vue`

**Files:**
- Create: `apps/web/app/components/plans/PlanRow.vue`
- Test: `apps/web/app/components/plans/PlanRow.test.ts`
- Delete (end of this task): `apps/web/app/components/plans/PlanCard.vue`

**Interfaces:**
- Consumes: `RegularPlanDto`; `categoryIcon` from `../operations/category-icon.js`; `UiListRow`; `FinanceMoney`.
- Produces props: `{ plan: RegularPlanDto; categoryIcon: string | null; pending?: boolean }` (same `categoryIcon`-from-caller pattern as `PlanOccurrenceRow`, Task 7). Emits: `edit: []`, `remove: []`. Used by Task 10 (`PlanList.vue`).

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/components/plans/PlanRow.test.ts`:

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import PlanRow from './PlanRow.vue';
import type { RegularPlanDto } from '../../composables/useBudgetReferenceData.js';

function plan(overrides: Partial<RegularPlanDto> = {}): RegularPlanDto {
  return {
    id: 'plan-id',
    budgetId: 'budget-id',
    name: 'Подписки',
    planType: 'EXPENSE',
    amountMinor: '300000',
    currency: 'RUB',
    scale: 2,
    anchorOn: '2026-09-20',
    startOn: '2026-09-20',
    endOn: null,
    recurrence: 'MONTHLY',
    intervalMonths: null,
    accountId: null,
    categoryId: 'category-id',
    envelopeId: 'envelope-id',
    comment: null,
    isActive: true,
    disabledAt: null,
    deletedAt: null,
    ...overrides,
  };
}

describe('PlanRow', () => {
  it('shows the recurrence label and emits edit/remove', async () => {
    const wrapper = mount(PlanRow, { props: { plan: plan(), categoryIcon: null } });

    expect(wrapper.text()).toContain('Ежемесячно');
    await wrapper.get('[data-action="edit-plan"]').trigger('click');
    await wrapper.get('[data-action="remove-plan"]').trigger('click');

    expect(wrapper.emitted('edit')).toHaveLength(1);
    expect(wrapper.emitted('remove')).toHaveLength(1);
  });

  it('shows an interval label for EVERY_N_MONTHS plans', () => {
    const wrapper = mount(PlanRow, {
      props: { plan: plan({ recurrence: 'EVERY_N_MONTHS', intervalMonths: 3 }), categoryIcon: null },
    });

    expect(wrapper.text()).toContain('Раз в 3 мес.');
  });

  it('marks a disabled plan', () => {
    const wrapper = mount(PlanRow, { props: { plan: plan({ isActive: false }), categoryIcon: null } });

    expect(wrapper.text()).toContain('Отключён');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test -- PlanRow.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `PlanRow.vue`**

Create `apps/web/app/components/plans/PlanRow.vue`:

```vue
<script setup lang="ts">
import { computed } from 'vue';
import { Pencil, X } from '@lucide/vue';

import { categoryIcon as resolveCategoryIcon } from '../operations/category-icon.js';
import FinanceMoney from '../finance/FinanceMoney.vue';
import UiListRow from '../ui/ListRow.vue';
import type { RegularPlanDto } from '../../composables/useBudgetReferenceData.js';

defineOptions({ name: 'PlanRow' });

const props = withDefaults(
  defineProps<{ plan: RegularPlanDto; categoryIcon: string | null; pending?: boolean }>(),
  { pending: false },
);

defineEmits<{ edit: []; remove: [] }>();

const icon = computed(() =>
  resolveCategoryIcon(props.categoryIcon, props.plan.planType === 'INCOME' ? 'INCOME' : 'EXPENSE'),
);

const recurrenceLabel = computed(() => {
  switch (props.plan.recurrence) {
    case 'ONE_TIME':
      return 'Один раз';
    case 'MONTHLY':
      return 'Ежемесячно';
    case 'YEARLY':
      return 'Ежегодно';
    case 'EVERY_N_MONTHS':
      return `Раз в ${props.plan.intervalMonths} мес.`;
  }
});

const rowLabel = computed(() => `План «${props.plan.name}»`);
</script>

<template>
  <UiListRow :label="rowLabel">
    <template #leading><component :is="icon" :size="20" aria-hidden="true" /></template>

    <span class="plan-row__title">{{ plan.name }}</span>
    <span class="plan-row__subtitle">
      {{ recurrenceLabel }}<template v-if="!plan.isActive"> · Отключён</template>
    </span>

    <template #trailing>
      <FinanceMoney
        class="plan-row__amount"
        :minor-units="plan.amountMinor"
        :currency="plan.currency"
        :scale="plan.scale"
      />
    </template>

    <template #actions>
      <button
        type="button"
        data-action="edit-plan"
        class="plan-row__icon-button"
        aria-label="Изменить план"
        :disabled="pending"
        @click="$emit('edit')"
      >
        <Pencil :size="18" aria-hidden="true" />
      </button>
      <button
        type="button"
        data-action="remove-plan"
        class="plan-row__icon-button"
        aria-label="Удалить план"
        :disabled="pending"
        @click="$emit('remove')"
      >
        <X :size="18" aria-hidden="true" />
      </button>
    </template>
  </UiListRow>
</template>

<style scoped>
.plan-row__title {
  overflow: hidden;
  font-weight: var(--hf-font-weight-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.plan-row__subtitle {
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
}
.plan-row__amount {
  font-weight: var(--hf-font-weight-semibold);
  white-space: nowrap;
}
.plan-row__icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.75rem;
  height: 2.75rem;
  border: 0;
  border-radius: var(--hf-radius-md);
  background: transparent;
  color: var(--hf-color-text-muted);
  cursor: pointer;
}
.plan-row__icon-button:hover:not(:disabled) {
  background: var(--hf-color-action-secondary-hover);
  color: var(--hf-color-text);
}
.plan-row__icon-button:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
}
.plan-row__icon-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
```

Delete the file it replaces:

```bash
git rm apps/web/app/components/plans/PlanCard.vue
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web test -- PlanRow.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/components/plans/PlanRow.vue apps/web/app/components/plans/PlanRow.test.ts
git commit -m "feat(web): add PlanRow, replacing PlanCard"
```

---

### Task 9: `PlanKpiRow.vue`

**Files:**
- Create: `apps/web/app/components/plans/PlanKpiRow.vue`
- Test: `apps/web/app/components/plans/PlanKpiRow.test.ts`

**Interfaces:**
- Consumes: `FinanceMoney` from `../finance/FinanceMoney.vue`.
- Produces props: `{ plannedIncomeMinor: string; plannedExpenseMinor: string; balanceMinor: string; totalPlans: number }` (matches `PlanKpi` from Task 6). Used by Task 14 (`plans.vue`).

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/components/plans/PlanKpiRow.test.ts`:

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import PlanKpiRow from './PlanKpiRow.vue';

describe('PlanKpiRow', () => {
  it('renders all four tiles', () => {
    const wrapper = mount(PlanKpiRow, {
      props: {
        plannedIncomeMinor: '1500000',
        plannedExpenseMinor: '6100000',
        balanceMinor: '-4600000',
        totalPlans: 5,
      },
    });

    expect(wrapper.text()).toContain('Плановые доходы');
    expect(wrapper.text()).toContain('Плановые расходы');
    expect(wrapper.text()).toContain('Баланс');
    expect(wrapper.text()).toContain('Всего планов');
    expect(wrapper.text()).toContain('5');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test -- PlanKpiRow.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `PlanKpiRow.vue`**

Create `apps/web/app/components/plans/PlanKpiRow.vue`:

```vue
<script setup lang="ts">
import FinanceMoney from '../finance/FinanceMoney.vue';

defineOptions({ name: 'PlanKpiRow' });

defineProps<{
  plannedIncomeMinor: string;
  plannedExpenseMinor: string;
  balanceMinor: string;
  totalPlans: number;
}>();
</script>

<template>
  <div class="plan-kpi-row">
    <article class="plan-kpi-row__tile">
      <p class="plan-kpi-row__label">Плановые доходы</p>
      <FinanceMoney
        class="plan-kpi-row__value plan-kpi-row__value--income"
        :minor-units="plannedIncomeMinor"
        currency="RUB"
        :scale="2"
      />
    </article>
    <article class="plan-kpi-row__tile">
      <p class="plan-kpi-row__label">Плановые расходы</p>
      <FinanceMoney
        class="plan-kpi-row__value plan-kpi-row__value--expense"
        :minor-units="`-${plannedExpenseMinor}`"
        currency="RUB"
        :scale="2"
      />
    </article>
    <article class="plan-kpi-row__tile">
      <p class="plan-kpi-row__label">Баланс</p>
      <FinanceMoney class="plan-kpi-row__value" :minor-units="balanceMinor" currency="RUB" :scale="2" />
    </article>
    <article class="plan-kpi-row__tile">
      <p class="plan-kpi-row__label">Всего планов</p>
      <span class="plan-kpi-row__value">{{ totalPlans }}</span>
    </article>
  </div>
</template>

<style scoped>
.plan-kpi-row {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--hf-space-4);
}
.plan-kpi-row__tile {
  display: grid;
  gap: var(--hf-space-1);
  padding: var(--hf-card-padding);
  border-radius: var(--hf-card-radius);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-card);
}
.plan-kpi-row__label {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.plan-kpi-row__value {
  font-size: 1.5rem;
  font-weight: var(--hf-font-weight-semibold);
}
.plan-kpi-row__value--income {
  color: var(--hf-color-status-success);
}
.plan-kpi-row__value--expense {
  color: var(--hf-color-status-danger);
}
@media (max-width: 47.9375rem) {
  .plan-kpi-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web test -- PlanKpiRow.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/components/plans/PlanKpiRow.vue apps/web/app/components/plans/PlanKpiRow.test.ts
git commit -m "feat(web): add PlanKpiRow"
```

---

### Task 10: `PlanList.vue`

**Files:**
- Create: `apps/web/app/components/plans/PlanList.vue`
- Test: `apps/web/app/components/plans/PlanList.test.ts`

**Interfaces:**
- Consumes: `PlanOccurrenceRow.vue` (Task 7), `PlanRow.vue` (Task 8), `groupByActive` from `./group-by-active.js` (Task 3), `UiEmptyState` from `../ui/EmptyState.vue`.
- Produces props: `{ activeTab: 'upcoming' | 'all'; upcomingOccurrences: PlanOccurrenceDto[]; allPlans: RegularPlanDto[]; categoryIconById: Record<string, string | null>; pending?: boolean }` — `categoryIconById` maps `categoryId` to that category's `icon`, built once by `plans.vue` (Task 14) from its loaded category list, and threaded down to each row's `categoryIcon` prop (Task 7/8's design decision). Emits: `'update:activeTab': [tab: 'upcoming' | 'all']`, `'complete-occurrence': [occurrence: PlanOccurrenceDto]`, `'draft-occurrence': [occurrence: PlanOccurrenceDto]`, `'skip-occurrence': [occurrence: PlanOccurrenceDto]`, `'edit-occurrence': [occurrence: PlanOccurrenceDto]`, `'remove-occurrence': [occurrence: PlanOccurrenceDto]`, `'edit-plan': [plan: RegularPlanDto]`, `'remove-plan': [plan: RegularPlanDto]`. Used by Task 14 (`plans.vue`).

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/components/plans/PlanList.test.ts`:

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import PlanList from './PlanList.vue';
import type { PlanOccurrenceDto, RegularPlanDto } from '../../composables/useBudgetReferenceData.js';

const occurrence: PlanOccurrenceDto = {
  id: 'occurrence-id',
  planId: 'plan-id',
  planName: 'Ипотека',
  planType: 'EXPENSE',
  scheduledOn: '2026-09-26',
  status: 'DUE',
  amountMinor: '3600000',
  currency: 'RUB',
  scale: 2,
  accountId: 'account-id',
  categoryId: 'category-id',
  envelopeId: 'envelope-id',
  comment: null,
  transactionId: null,
  cancellationReason: null,
};

const plan: RegularPlanDto = {
  id: 'plan-id',
  budgetId: 'budget-id',
  name: 'Ипотека',
  planType: 'EXPENSE',
  amountMinor: '3600000',
  currency: 'RUB',
  scale: 2,
  anchorOn: '2026-09-26',
  startOn: '2026-09-26',
  endOn: null,
  recurrence: 'MONTHLY',
  intervalMonths: null,
  accountId: null,
  categoryId: 'category-id',
  envelopeId: 'envelope-id',
  comment: null,
  isActive: true,
  disabledAt: null,
  deletedAt: null,
};

describe('PlanList', () => {
  it('shows occurrences on the upcoming tab and plans on the all tab', async () => {
    const wrapper = mount(PlanList, {
      props: {
        activeTab: 'upcoming',
        upcomingOccurrences: [occurrence],
        allPlans: [plan],
        categoryIconById: {},
      },
    });

    expect(wrapper.text()).toContain('Ипотека');
    expect(wrapper.findComponent({ name: 'PlanRow' }).exists()).toBe(false);

    await wrapper.setProps({ activeTab: 'all' });
    expect(wrapper.findComponent({ name: 'PlanRow' }).exists()).toBe(true);
    expect(wrapper.findComponent({ name: 'PlanOccurrenceRow' }).exists()).toBe(false);
  });

  it('emits update:activeTab when a tab button is clicked', async () => {
    const wrapper = mount(PlanList, {
      props: { activeTab: 'upcoming', upcomingOccurrences: [], allPlans: [], categoryIconById: {} },
    });

    await wrapper.get('[data-action="plans-tab-all"]').trigger('click');

    expect(wrapper.emitted('update:activeTab')?.[0]).toEqual(['all']);
  });

  it('shows an empty state when the active tab has nothing to show', () => {
    const wrapper = mount(PlanList, {
      props: { activeTab: 'upcoming', upcomingOccurrences: [], allPlans: [], categoryIconById: {} },
    });

    expect(wrapper.text()).toContain('Ближайших платежей пока нет');
  });

  it('forwards PlanOccurrenceRow events with the source occurrence, resolving its category icon', async () => {
    const wrapper = mount(PlanList, {
      props: {
        activeTab: 'upcoming',
        upcomingOccurrences: [occurrence],
        allPlans: [],
        categoryIconById: { 'category-id': 'house' },
      },
    });

    expect(wrapper.findComponent({ name: 'PlanOccurrenceRow' }).props('categoryIcon')).toBe('house');

    await wrapper.get('input[type="checkbox"]').setValue(true);

    expect(wrapper.emitted('complete-occurrence')?.[0]).toEqual([occurrence]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test -- PlanList.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `PlanList.vue`**

Create `apps/web/app/components/plans/PlanList.vue`:

```vue
<script setup lang="ts">
import { computed } from 'vue';

import { groupByActive } from './group-by-active.js';
import PlanOccurrenceRow from './PlanOccurrenceRow.vue';
import PlanRow from './PlanRow.vue';
import UiEmptyState from '../ui/EmptyState.vue';
import type { PlanOccurrenceDto, RegularPlanDto } from '../../composables/useBudgetReferenceData.js';

defineOptions({ name: 'PlanList' });

const props = withDefaults(
  defineProps<{
    activeTab: 'upcoming' | 'all';
    upcomingOccurrences: ReadonlyArray<PlanOccurrenceDto>;
    allPlans: ReadonlyArray<RegularPlanDto>;
    categoryIconById: Record<string, string | null>;
    pending?: boolean;
  }>(),
  { pending: false },
);

function categoryIconFor(categoryId: string | null): string | null {
  return props.categoryIconById[categoryId ?? ''] ?? null;
}

const emit = defineEmits<{
  'update:activeTab': [tab: 'upcoming' | 'all'];
  'complete-occurrence': [occurrence: PlanOccurrenceDto];
  'draft-occurrence': [occurrence: PlanOccurrenceDto];
  'skip-occurrence': [occurrence: PlanOccurrenceDto];
  'edit-occurrence': [occurrence: PlanOccurrenceDto];
  'remove-occurrence': [occurrence: PlanOccurrenceDto];
  'edit-plan': [plan: RegularPlanDto];
  'remove-plan': [plan: RegularPlanDto];
}>();

const sortedUpcoming = computed(() =>
  [...props.upcomingOccurrences].sort((left, right) =>
    left.scheduledOn.localeCompare(right.scheduledOn),
  ),
);

const planGroups = computed(() => groupByActive(props.allPlans));
</script>

<template>
  <section class="plan-list" aria-label="Список планов">
    <div class="plan-list__tabs" role="tablist">
      <button
        type="button"
        role="tab"
        data-action="plans-tab-upcoming"
        class="plan-list__tab"
        :class="{ 'plan-list__tab--active': activeTab === 'upcoming' }"
        :aria-selected="activeTab === 'upcoming'"
        @click="emit('update:activeTab', 'upcoming')"
      >
        Ближайшие
      </button>
      <button
        type="button"
        role="tab"
        data-action="plans-tab-all"
        class="plan-list__tab"
        :class="{ 'plan-list__tab--active': activeTab === 'all' }"
        :aria-selected="activeTab === 'all'"
        @click="emit('update:activeTab', 'all')"
      >
        Все
      </button>
    </div>

    <div v-if="activeTab === 'upcoming'" role="tabpanel" aria-label="Ближайшие">
      <UiEmptyState
        v-if="sortedUpcoming.length === 0"
        title="Ближайших платежей пока нет"
        description="Ближайшие даты появятся здесь автоматически."
      />
      <ul v-else class="plan-list__items">
        <li v-for="occurrence in sortedUpcoming" :key="occurrence.id">
          <PlanOccurrenceRow
            :occurrence="occurrence"
            :category-icon="categoryIconFor(occurrence.categoryId)"
            :pending="pending"
            @complete="emit('complete-occurrence', occurrence)"
            @draft="emit('draft-occurrence', occurrence)"
            @skip="emit('skip-occurrence', occurrence)"
            @edit="emit('edit-occurrence', occurrence)"
            @remove="emit('remove-occurrence', occurrence)"
          />
        </li>
      </ul>
    </div>

    <div v-else role="tabpanel" aria-label="Все">
      <UiEmptyState
        v-if="planGroups.length === 0"
        title="Планов пока нет"
        description="Добавьте ожидаемый доход, расход или накопление."
      />
      <template v-else>
        <div v-for="group in planGroups" :key="String(group.active)" class="plan-list__group">
          <h3 class="plan-list__group-title">{{ group.label }}</h3>
          <ul class="plan-list__items">
            <li v-for="plan in group.items" :key="plan.id">
              <PlanRow
                :plan="plan"
                :category-icon="categoryIconFor(plan.categoryId)"
                :pending="pending"
                @edit="emit('edit-plan', plan)"
                @remove="emit('remove-plan', plan)"
              />
            </li>
          </ul>
        </div>
      </template>
    </div>
  </section>
</template>

<style scoped>
.plan-list {
  display: grid;
  gap: var(--hf-space-4);
}
.plan-list__tabs {
  display: flex;
  gap: var(--hf-space-2);
  border-bottom: 1px solid var(--hf-color-border);
}
.plan-list__tab {
  padding: var(--hf-space-2) var(--hf-space-3);
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--hf-color-text-muted);
  font: inherit;
  font-weight: var(--hf-font-weight-medium);
  cursor: pointer;
}
.plan-list__tab--active {
  border-bottom-color: var(--hf-color-brand);
  color: var(--hf-color-text);
}
.plan-list__tab:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
}
.plan-list__group + .plan-list__group {
  margin-top: var(--hf-space-4);
}
.plan-list__group-title {
  margin: 0 0 var(--hf-space-2);
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
  text-transform: uppercase;
}
.plan-list__items {
  display: grid;
  gap: var(--hf-space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}
</style>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web test -- PlanList.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/components/plans/PlanList.vue apps/web/app/components/plans/PlanList.test.ts
git commit -m "feat(web): add tabbed PlanList (upcoming occurrences / all plans)"
```

---

### Task 11: `PlansCalendar.vue`

**Files:**
- Create: `apps/web/app/components/plans/PlansCalendar.vue`
- Test: `apps/web/app/components/plans/PlansCalendar.test.ts`

**Interfaces:**
- Consumes: `buildCalendarGrid` (Task 4), `DayAggregate` type + values (Task 5), `formatCompactSigned` (Task 2).
- Produces props: `{ monthAnchor: string; selectedDate: string; today: string; aggregates: Record<string, DayAggregate> }`. Emits: `'select-day': [date: string]`, `'change-month': [monthAnchor: string]`. Used by Task 14 (`plans.vue`).

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/components/plans/PlansCalendar.test.ts`:

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import PlansCalendar from './PlansCalendar.vue';
import type { DayAggregate } from './day-aggregates.js';

function mountCalendar(aggregates: Record<string, DayAggregate> = {}) {
  return mount(PlansCalendar, {
    props: {
      monthAnchor: '2026-09-01',
      selectedDate: '2026-09-24',
      today: '2026-09-24',
      aggregates,
    },
  });
}

describe('PlansCalendar', () => {
  it('renders 42 day cells with the correct in-month count', () => {
    const wrapper = mountCalendar();

    expect(wrapper.findAll('[data-testid="calendar-cell"]')).toHaveLength(42);
    expect(wrapper.findAll('[data-testid="calendar-cell"][data-in-month="true"]')).toHaveLength(30);
  });

  it('shows a compact signed amount for a day with a net total', () => {
    const wrapper = mountCalendar({ '2026-09-10': { netMinor: 10600000n, dot: 'none' } });

    const cell = wrapper.get('[data-date="2026-09-10"]');
    expect(cell.text()).toContain('+106к');
  });

  it('shows an overdue dot for a past DUE day and an upcoming dot for a future one', () => {
    const wrapper = mountCalendar({
      '2026-09-10': { netMinor: 0n, dot: 'overdue' },
      '2026-09-26': { netMinor: 0n, dot: 'upcoming' },
    });

    expect(wrapper.get('[data-date="2026-09-10"]').find('.plans-calendar__dot--overdue').exists()).toBe(
      true,
    );
    expect(wrapper.get('[data-date="2026-09-26"]').find('.plans-calendar__dot--upcoming').exists()).toBe(
      true,
    );
  });

  it('emits select-day when a cell is clicked and marks the selected/today cells', () => {
    const wrapper = mountCalendar();

    expect(wrapper.get('[data-date="2026-09-24"]').classes()).toContain('plans-calendar__cell--today');
    expect(wrapper.get('[data-date="2026-09-24"]').classes()).toContain(
      'plans-calendar__cell--selected',
    );

    wrapper.get('[data-date="2026-09-10"]').trigger('click');
    expect(wrapper.emitted('select-day')?.[0]).toEqual(['2026-09-10']);
  });

  it('emits change-month with the first day of the neighboring month', async () => {
    const wrapper = mountCalendar();

    await wrapper.get('[data-action="calendar-next-month"]').trigger('click');
    expect(wrapper.emitted('change-month')?.[0]).toEqual(['2026-10-01']);

    await wrapper.get('[data-action="calendar-prev-month"]').trigger('click');
    expect(wrapper.emitted('change-month')?.[1]).toEqual(['2026-08-01']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test -- PlansCalendar.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `PlansCalendar.vue`**

Create `apps/web/app/components/plans/PlansCalendar.vue`:

```vue
<script setup lang="ts">
import { computed } from 'vue';
import { addMonths, format, subMonths } from 'date-fns';
import { ru } from 'date-fns/locale';
import { ChevronLeft, ChevronRight } from '@lucide/vue';

import { buildCalendarGrid } from './calendar-grid.js';
import type { DayAggregate } from './day-aggregates.js';
import { formatCompactSigned } from '../finance/money-format.js';

defineOptions({ name: 'PlansCalendar' });

const props = defineProps<{
  monthAnchor: string;
  selectedDate: string;
  today: string;
  aggregates: Record<string, DayAggregate>;
}>();

const emit = defineEmits<{
  'select-day': [date: string];
  'change-month': [monthAnchor: string];
}>();

const WEEKDAY_LABELS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

const grid = computed(() => buildCalendarGrid(props.monthAnchor));

const monthLabel = computed(() =>
  format(parsePlainDate(props.monthAnchor), 'LLLL yyyy', { locale: ru }),
);

function aggregateFor(date: string): DayAggregate | undefined {
  return props.aggregates[date];
}

function compactAmount(date: string): string | null {
  const aggregate = aggregateFor(date);
  if (!aggregate || aggregate.netMinor === 0n) return null;
  return formatCompactSigned(aggregate.netMinor.toString(), 2);
}

function amountTone(date: string): 'income' | 'expense' | null {
  const aggregate = aggregateFor(date);
  if (!aggregate || aggregate.netMinor === 0n) return null;
  return aggregate.netMinor > 0n ? 'income' : 'expense';
}

function dotFor(date: string): 'none' | 'upcoming' | 'overdue' {
  return aggregateFor(date)?.dot ?? 'none';
}

function goToPreviousMonth() {
  emit('change-month', format(subMonths(parsePlainDate(props.monthAnchor), 1), 'yyyy-MM-dd'));
}

function goToNextMonth() {
  emit('change-month', format(addMonths(parsePlainDate(props.monthAnchor), 1), 'yyyy-MM-dd'));
}

function parsePlainDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year as number, (month as number) - 1, day as number);
}
</script>

<template>
  <div class="plans-calendar">
    <div class="plans-calendar__header">
      <button
        type="button"
        data-action="calendar-prev-month"
        class="plans-calendar__nav"
        aria-label="Предыдущий месяц"
        @click="goToPreviousMonth"
      >
        <ChevronLeft :size="20" aria-hidden="true" />
      </button>
      <p class="plans-calendar__month">{{ monthLabel }}</p>
      <button
        type="button"
        data-action="calendar-next-month"
        class="plans-calendar__nav"
        aria-label="Следующий месяц"
        @click="goToNextMonth"
      >
        <ChevronRight :size="20" aria-hidden="true" />
      </button>
    </div>

    <div class="plans-calendar__weekdays" aria-hidden="true">
      <span v-for="label in WEEKDAY_LABELS" :key="label">{{ label }}</span>
    </div>

    <div class="plans-calendar__grid">
      <button
        v-for="cell in grid"
        :key="cell.date"
        type="button"
        data-testid="calendar-cell"
        :data-date="cell.date"
        :data-in-month="cell.inCurrentMonth"
        class="plans-calendar__cell"
        :class="{
          'plans-calendar__cell--muted': !cell.inCurrentMonth,
          'plans-calendar__cell--today': cell.date === today,
          'plans-calendar__cell--selected': cell.date === selectedDate,
        }"
        @click="emit('select-day', cell.date)"
      >
        <span class="plans-calendar__day-number">{{ Number(cell.date.slice(-2)) }}</span>
        <span
          v-if="compactAmount(cell.date)"
          class="plans-calendar__amount"
          :class="`plans-calendar__amount--${amountTone(cell.date)}`"
        >
          {{ compactAmount(cell.date) }}
        </span>
        <span
          v-if="dotFor(cell.date) !== 'none'"
          class="plans-calendar__dot"
          :class="`plans-calendar__dot--${dotFor(cell.date)}`"
          aria-hidden="true"
        />
      </button>
    </div>

    <div class="plans-calendar__legend">
      <span class="plans-calendar__legend-item">
        <span class="plans-calendar__dot plans-calendar__dot--legend-income" aria-hidden="true" />
        Доход
      </span>
      <span class="plans-calendar__legend-item">
        <span class="plans-calendar__dot plans-calendar__dot--legend-expense" aria-hidden="true" />
        Расход
      </span>
      <span class="plans-calendar__legend-item">
        <span class="plans-calendar__dot plans-calendar__dot--upcoming" aria-hidden="true" />
        Планы
      </span>
    </div>
  </div>
</template>

<style scoped>
.plans-calendar {
  display: grid;
  gap: var(--hf-space-3);
  padding: var(--hf-card-padding);
  border-radius: var(--hf-card-radius);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-card);
}
.plans-calendar__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.plans-calendar__month {
  margin: 0;
  font-weight: var(--hf-font-weight-semibold);
  text-transform: capitalize;
}
.plans-calendar__nav {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.75rem;
  height: 2.75rem;
  border: 0;
  border-radius: var(--hf-radius-md);
  background: transparent;
  color: var(--hf-color-text-muted);
  cursor: pointer;
}
.plans-calendar__nav:hover {
  background: var(--hf-color-action-secondary-hover);
}
.plans-calendar__weekdays,
.plans-calendar__grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: var(--hf-space-1);
}
.plans-calendar__weekdays span {
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
  text-align: center;
}
.plans-calendar__cell {
  display: grid;
  gap: 0.125rem;
  justify-items: center;
  aspect-ratio: 1;
  padding: var(--hf-space-1);
  border: 1px solid transparent;
  border-radius: var(--hf-radius-md);
  background: transparent;
  cursor: pointer;
}
.plans-calendar__cell:hover {
  background: var(--hf-color-action-secondary-hover);
}
.plans-calendar__cell:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: -2px;
}
.plans-calendar__cell--muted {
  color: var(--hf-color-text-subtle);
}
.plans-calendar__cell--today .plans-calendar__day-number {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  border-radius: 50%;
  background: var(--hf-color-brand);
  color: var(--hf-color-white);
}
.plans-calendar__cell--selected {
  border-color: var(--hf-color-text);
}
.plans-calendar__day-number {
  font-size: var(--hf-font-size-caption);
}
.plans-calendar__amount {
  font-size: 0.625rem;
  font-weight: var(--hf-font-weight-semibold);
  white-space: nowrap;
}
.plans-calendar__amount--income {
  color: var(--hf-color-status-success);
}
.plans-calendar__amount--expense {
  color: var(--hf-color-status-danger);
}
.plans-calendar__dot {
  width: 0.375rem;
  height: 0.375rem;
  border-radius: 50%;
}
.plans-calendar__dot--upcoming,
.plans-calendar__dot--legend-income {
  background: var(--hf-color-brand);
}
.plans-calendar__dot--overdue,
.plans-calendar__dot--legend-expense {
  background: var(--hf-color-status-danger);
}
.plans-calendar__dot--legend-income {
  background: var(--hf-color-status-success);
}
.plans-calendar__legend {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-4);
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
}
.plans-calendar__legend-item {
  display: inline-flex;
  align-items: center;
  gap: var(--hf-space-1);
}
@media (max-width: 47.9375rem) {
  .plans-calendar__day-number {
    font-size: 0.625rem;
  }
  .plans-calendar__amount {
    font-size: 0.5625rem;
  }
}
</style>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web test -- PlansCalendar.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/components/plans/PlansCalendar.vue apps/web/app/components/plans/PlansCalendar.test.ts
git commit -m "feat(web): add PlansCalendar with per-day financial indicators"
```

---

### Task 12: `PlanDayPanel.vue`

**Files:**
- Create: `apps/web/app/components/plans/PlanDayPanel.vue`
- Test: `apps/web/app/components/plans/PlanDayPanel.test.ts`

**Interfaces:**
- Consumes: `categoryIcon` from `../operations/category-icon.js`, `PlanOccurrenceRow.vue` (Task 7), `FinanceMoney`, `UiButton`, `UiEmptyState`.
- Produces the `DayOperationView` type (`{ id: string; categoryName: string; categoryIcon: string | null; transactionType: 'INCOME' | 'EXPENSE'; amountMinor: string; currency: string; scale: number }`) and props `{ date: string; operations: ReadonlyArray<DayOperationView>; occurrences: ReadonlyArray<PlanOccurrenceDto>; categoryIconById: Record<string, string | null>; pending?: boolean }` (`categoryIconById` is the same map Task 10 receives, forwarded to each `PlanOccurrenceRow`'s `categoryIcon` prop). Emits: same occurrence events as `PlanList.vue` (`complete-occurrence`, `draft-occurrence`, `skip-occurrence`, `edit-occurrence`, `remove-occurrence`) plus `'add-plan': []`. Used by Task 14 (`plans.vue`), which builds `DayOperationView[]` from already-loaded transactions + categories.

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/components/plans/PlanDayPanel.test.ts`:

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import PlanDayPanel from './PlanDayPanel.vue';
import PlanOccurrenceRow from './PlanOccurrenceRow.vue';
import type { PlanOccurrenceDto } from '../../composables/useBudgetReferenceData.js';
import type { DayOperationView } from './PlanDayPanel.vue';

const operations: DayOperationView[] = [
  {
    id: 'transaction-1',
    categoryName: 'Бензин',
    categoryIcon: 'fuel',
    transactionType: 'EXPENSE',
    amountMinor: '350000',
    currency: 'RUB',
    scale: 2,
  },
  {
    id: 'transaction-2',
    categoryName: 'Кафе',
    categoryIcon: null,
    transactionType: 'EXPENSE',
    amountMinor: '85000',
    currency: 'RUB',
    scale: 2,
  },
];

const occurrence: PlanOccurrenceDto = {
  id: 'occurrence-id',
  planId: 'plan-id',
  planName: 'Подписка',
  planType: 'EXPENSE',
  scheduledOn: '2026-09-18',
  status: 'DUE',
  amountMinor: '300000',
  currency: 'RUB',
  scale: 2,
  accountId: 'account-id',
  categoryId: 'category-id',
  envelopeId: 'envelope-id',
  comment: null,
  transactionId: null,
  cancellationReason: null,
};

describe('PlanDayPanel', () => {
  it('shows the date, the net operations total, and each operation with its icon', () => {
    const wrapper = mount(PlanDayPanel, {
      props: { date: '2026-09-13', operations, occurrences: [], categoryIconById: {} },
    });

    expect(wrapper.text()).toContain('2026-09-13');
    expect(wrapper.text()).toContain('Бензин');
    expect(wrapper.text()).toContain('Кафе');
    expect(wrapper.findAll('.plan-day-panel__operation svg')).toHaveLength(2);
  });

  it('renders occurrences via PlanOccurrenceRow, resolving its category icon, and forwards its events', async () => {
    const wrapper = mount(PlanDayPanel, {
      props: {
        date: '2026-09-18',
        operations: [],
        occurrences: [occurrence],
        categoryIconById: { 'category-id': 'wifi' },
      },
    });

    expect(wrapper.findComponent(PlanOccurrenceRow).props('categoryIcon')).toBe('wifi');

    await wrapper.get('input[type="checkbox"]').setValue(true);

    expect(wrapper.emitted('complete-occurrence')?.[0]).toEqual([occurrence]);
  });

  it('emits add-plan from the add button', async () => {
    const wrapper = mount(PlanDayPanel, {
      props: { date: '2026-09-18', operations: [], occurrences: [], categoryIconById: {} },
    });

    await wrapper.get('[data-action="add-plan-on-day"]').trigger('click');

    expect(wrapper.emitted('add-plan')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test -- PlanDayPanel.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `PlanDayPanel.vue`**

Create `apps/web/app/components/plans/PlanDayPanel.vue`:

```vue
<script setup lang="ts">
import { categoryIcon as resolveCategoryIcon } from '../operations/category-icon.js';
import PlanOccurrenceRow from './PlanOccurrenceRow.vue';
import FinanceMoney from '../finance/FinanceMoney.vue';
import UiButton from '../ui/Button.vue';
import UiEmptyState from '../ui/EmptyState.vue';
import type { PlanOccurrenceDto } from '../../composables/useBudgetReferenceData.js';

export interface DayOperationView {
  id: string;
  categoryName: string;
  categoryIcon: string | null;
  transactionType: 'INCOME' | 'EXPENSE';
  amountMinor: string;
  currency: string;
  scale: number;
}

defineOptions({ name: 'PlanDayPanel' });

const props = withDefaults(
  defineProps<{
    date: string;
    operations: ReadonlyArray<DayOperationView>;
    occurrences: ReadonlyArray<PlanOccurrenceDto>;
    categoryIconById: Record<string, string | null>;
    pending?: boolean;
  }>(),
  { pending: false },
);

const emit = defineEmits<{
  'complete-occurrence': [occurrence: PlanOccurrenceDto];
  'draft-occurrence': [occurrence: PlanOccurrenceDto];
  'skip-occurrence': [occurrence: PlanOccurrenceDto];
  'edit-occurrence': [occurrence: PlanOccurrenceDto];
  'remove-occurrence': [occurrence: PlanOccurrenceDto];
  'add-plan': [];
}>();

function operationIcon(operation: DayOperationView) {
  return resolveCategoryIcon(operation.categoryIcon, operation.transactionType);
}

function occurrenceCategoryIcon(occurrence: PlanOccurrenceDto): string | null {
  return props.categoryIconById[occurrence.categoryId ?? ''] ?? null;
}

function netMinor(): string {
  return props.operations
    .reduce(
      (total, operation) =>
        operation.transactionType === 'INCOME'
          ? total + BigInt(operation.amountMinor)
          : total - BigInt(operation.amountMinor),
      0n,
    )
    .toString();
}

function signedMinor(operation: DayOperationView): string {
  return operation.transactionType === 'INCOME' ? operation.amountMinor : `-${operation.amountMinor}`;
}
</script>

<template>
  <section class="plan-day-panel" aria-label="Детали дня">
    <header class="plan-day-panel__header">
      <h2>{{ date }}</h2>
      <div v-if="operations.length > 0" class="plan-day-panel__net">
        <p class="plan-day-panel__net-label">
          {{ BigInt(netMinor()) >= 0n ? 'Доход' : 'Расход' }}
        </p>
        <FinanceMoney :minor-units="netMinor()" currency="RUB" :scale="2" />
      </div>
    </header>

    <section v-if="operations.length > 0" aria-label="Операции">
      <h3 class="plan-day-panel__section-title">Операции</h3>
      <ul class="plan-day-panel__operations">
        <li v-for="operation in operations" :key="operation.id" class="plan-day-panel__operation">
          <span class="plan-day-panel__operation-label">
            <component :is="operationIcon(operation)" :size="18" aria-hidden="true" />
            {{ operation.categoryName }}
          </span>
          <FinanceMoney
            :minor-units="signedMinor(operation)"
            :currency="operation.currency"
            :scale="operation.scale"
          />
        </li>
      </ul>
    </section>

    <section v-if="occurrences.length > 0" aria-label="Планы">
      <h3 class="plan-day-panel__section-title">Планы</h3>
      <ul class="plan-day-panel__items">
        <li v-for="occurrence in occurrences" :key="occurrence.id">
          <PlanOccurrenceRow
            :occurrence="occurrence"
            :category-icon="occurrenceCategoryIcon(occurrence)"
            :pending="pending"
            @complete="emit('complete-occurrence', occurrence)"
            @draft="emit('draft-occurrence', occurrence)"
            @skip="emit('skip-occurrence', occurrence)"
            @edit="emit('edit-occurrence', occurrence)"
            @remove="emit('remove-occurrence', occurrence)"
          />
        </li>
      </ul>
    </section>

    <UiEmptyState
      v-if="operations.length === 0 && occurrences.length === 0"
      title="На этот день пока ничего нет"
      description="Добавьте план или посмотрите другой день."
    />

    <UiButton data-action="add-plan-on-day" variant="secondary" @click="emit('add-plan')">
      + Добавить план на этот день
    </UiButton>
  </section>
</template>

<style scoped>
.plan-day-panel {
  display: grid;
  gap: var(--hf-space-4);
  padding: var(--hf-card-padding);
  border-radius: var(--hf-card-radius);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-card);
}
.plan-day-panel__header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--hf-space-3);
}
.plan-day-panel__header h2 {
  margin: 0;
  font-size: 1.125rem;
}
.plan-day-panel__net {
  display: flex;
  align-items: baseline;
  gap: var(--hf-space-2);
}
.plan-day-panel__net-label {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
  text-transform: uppercase;
}
.plan-day-panel__section-title {
  margin: 0 0 var(--hf-space-2);
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
  text-transform: uppercase;
}
.plan-day-panel__operations,
.plan-day-panel__items {
  display: grid;
  gap: var(--hf-space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}
.plan-day-panel__operation {
  display: flex;
  justify-content: space-between;
  gap: var(--hf-space-3);
  padding: var(--hf-space-2) var(--hf-space-3);
}
.plan-day-panel__operation-label {
  display: inline-flex;
  align-items: center;
  gap: var(--hf-space-2);
  color: var(--hf-color-text-muted);
}
</style>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web test -- PlanDayPanel.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/components/plans/PlanDayPanel.vue apps/web/app/components/plans/PlanDayPanel.test.ts
git commit -m "feat(web): add PlanDayPanel for calendar day details"
```

---

### Task 13: Rewrite `PlanForm.vue`

**Files:**
- Modify: `apps/web/app/components/plans/PlanForm.vue`
- Modify: `apps/web/app/components/plans/PlanForm.test.ts`

**Interfaces:**
- Consumes: `CreateRegularPlanInput`, `UpdateRegularPlanInput`, `RegularPlanDto`, `selectableCategories` from `useBudgetReferenceData.js`; `FinanceMoneyInput`, `UiButton`, `UiDatePicker`, `UiInput`, `UiSelect`.
- Produces props: `{ plan?: RegularPlanDto | null; defaultDate?: string; accounts; categories; envelopes; errors?; pending? }` (accounts/categories/envelopes types unchanged from the current component). Emits: `submit: [input: CreateRegularPlanInput | UpdateRegularPlanInput]`, `remove: []` (new — only meaningful when `plan` is set). Used by Task 14 (`plans.vue`).

- [ ] **Step 1: Write the failing tests**

Replace `apps/web/app/components/plans/PlanForm.test.ts` entirely:

```ts
import { mount } from '@vue/test-utils';
import { VueDatePicker } from '@vuepic/vue-datepicker';
import { describe, expect, it } from 'vitest';

import PlanForm from './PlanForm.vue';

const categories = [
  {
    id: 'income-category',
    budgetId: 'budget-id',
    templateKey: null,
    name: 'Зарплата',
    categoryType: 'INCOME' as const,
    parentId: null,
    displayOrder: 0,
    comment: null,
    icon: null,
    archivedAt: null,
  },
  {
    id: 'expense-category',
    budgetId: 'budget-id',
    templateKey: null,
    name: 'Ипотека',
    categoryType: 'EXPENSE' as const,
    parentId: null,
    displayOrder: 1,
    comment: null,
    icon: null,
    archivedAt: null,
  },
];

describe('PlanForm', () => {
  it('defaults to expense and shows the envelope field', () => {
    const wrapper = mount(PlanForm, {
      props: { accounts: [], categories, envelopes: [{ value: 'envelope-id', label: 'Обязательные' }] },
    });

    expect(wrapper.get('input[name="planType"][value="EXPENSE"]').element.checked).toBe(true);
    expect(wrapper.find('[name="envelopeId"]').exists()).toBe(true);
  });

  it('hides the envelope field for income and shows a third savings option', async () => {
    const wrapper = mount(PlanForm, {
      props: { accounts: [], categories, envelopes: [{ value: 'envelope-id', label: 'Обязательные' }] },
    });

    await wrapper.get('input[name="planType"][value="INCOME"]').setValue();
    expect(wrapper.find('[name="envelopeId"]').exists()).toBe(false);

    await wrapper.get('input[name="planType"][value="SAVINGS"]').setValue();
    expect(wrapper.find('[name="envelopeId"]').exists()).toBe(true);
  });

  it('shows the interval field only for every-N-months recurrence', async () => {
    const wrapper = mount(PlanForm, { props: { accounts: [], categories, envelopes: [] } });

    expect(wrapper.find('[name="intervalMonths"]').exists()).toBe(false);
    await wrapper.get('[name="recurrence"]').setValue('EVERY_N_MONTHS');
    expect(wrapper.find('[name="intervalMonths"]').exists()).toBe(true);
  });

  it('writes the single date field into both anchorOn and startOn on submit', async () => {
    const wrapper = mount(PlanForm, {
      props: {
        accounts: [{ value: 'account-id', label: 'Счёт' }],
        categories,
        envelopes: [{ value: 'envelope-id', label: 'Обязательные' }],
      },
    });

    await wrapper.get('[name="name"]').setValue('Ипотека');
    await wrapper.get('[name="amount"]').setValue('36 000,00');
    // UiDatePicker wraps VueDatePicker, which masks its native input as
    // dd.MM.yyyy — the codebase's own convention (DatePicker.test.ts, "emits
    // the ISO date string a calendar selection resolves to") is to drive it
    // through the library's own update:modelValue emit, not .setValue().
    await wrapper.findComponent(VueDatePicker).vm.$emit('update:modelValue', '2026-09-26');
    await wrapper.get('[name="categoryId"]').setValue('expense-category');
    await wrapper.get('[name="envelopeId"]').setValue('envelope-id');
    await wrapper.get('form').trigger('submit');

    expect(wrapper.emitted('submit')?.[0]?.[0]).toMatchObject({
      amount: '36000.00',
      anchorOn: '2026-09-26',
      startOn: '2026-09-26',
    });
  });

  it('pre-fills the date field from defaultDate when creating', async () => {
    const wrapper = mount(PlanForm, {
      props: {
        accounts: [],
        categories,
        envelopes: [{ value: 'envelope-id', label: 'Обязательные' }],
        defaultDate: '2026-09-18',
      },
    });

    await wrapper.get('[name="categoryId"]').setValue('expense-category');
    await wrapper.get('[name="envelopeId"]').setValue('envelope-id');
    await wrapper.get('form').trigger('submit');

    expect(wrapper.emitted('submit')?.[0]?.[0]).toMatchObject({
      anchorOn: '2026-09-18',
      startOn: '2026-09-18',
    });
  });

  it('shows delete and the active toggle only in edit mode, and emits remove', async () => {
    const created = mount(PlanForm, { props: { accounts: [], categories, envelopes: [] } });
    expect(created.find('[data-action="delete-plan"]').exists()).toBe(false);

    const editing = mount(PlanForm, {
      props: {
        accounts: [],
        categories,
        envelopes: [{ value: 'envelope-id', label: 'Обязательные' }],
        plan: {
          id: 'plan-id',
          budgetId: 'budget-id',
          name: 'Ипотека',
          planType: 'EXPENSE',
          amountMinor: '3600000',
          currency: 'RUB',
          scale: 2,
          anchorOn: '2026-09-26',
          startOn: '2026-09-26',
          endOn: null,
          recurrence: 'MONTHLY',
          intervalMonths: null,
          accountId: null,
          categoryId: 'expense-category',
          envelopeId: 'envelope-id',
          comment: null,
          isActive: true,
          disabledAt: null,
          deletedAt: null,
        },
      },
    });

    expect(editing.find('[data-action="delete-plan"]').exists()).toBe(true);
    expect(editing.find('[name="isActive"]').exists()).toBe(true);
    await editing.get('[data-action="delete-plan"]').trigger('click');
    expect(editing.emitted('remove')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test -- PlanForm.test.ts`
Expected: FAIL — the current implementation uses a `<select name="planType">` and separate `anchorOn`/`startOn` date fields, so most assertions fail.

- [ ] **Step 3: Rewrite `PlanForm.vue`**

Replace `apps/web/app/components/plans/PlanForm.vue` entirely:

```vue
<script setup lang="ts">
import { computed, reactive, watch } from 'vue';

import {
  selectableCategories,
  type CategoryDto,
  type CreateRegularPlanInput,
  type EnvelopeDto,
  type RegularPlanDto,
  type UpdateRegularPlanInput,
} from '../../composables/useBudgetReferenceData.js';
import FinanceMoneyInput from '../finance/FinanceMoneyInput.vue';
import UiButton from '../ui/Button.vue';
import UiDatePicker from '../ui/DatePicker.vue';
import UiInput from '../ui/Input.vue';
import UiSelect from '../ui/Select.vue';

const props = withDefaults(
  defineProps<{
    plan?: RegularPlanDto | null;
    defaultDate?: string | undefined;
    accounts: ReadonlyArray<{ value: string; label: string }>;
    categories: ReadonlyArray<CategoryDto>;
    envelopes: ReadonlyArray<{
      value: string;
      label: string;
      envelopeType?: EnvelopeDto['envelopeType'];
    }>;
    errors?: Partial<Record<string, string>>;
    pending?: boolean;
  }>(),
  { plan: null, defaultDate: undefined, errors: () => ({}), pending: false },
);

const emit = defineEmits<{
  submit: [input: CreateRegularPlanInput | UpdateRegularPlanInput];
  remove: [];
}>();

type FormModel = {
  name: string;
  planType: 'INCOME' | 'EXPENSE' | 'SAVINGS';
  amount: string;
  date: string;
  endOn: string;
  recurrence: 'ONE_TIME' | 'MONTHLY' | 'EVERY_N_MONTHS' | 'YEARLY';
  intervalMonths: string;
  accountId: string;
  categoryId: string;
  envelopeId: string;
  comment: string;
  isActive: boolean;
};

const form = reactive<FormModel>(fromPlan(props.plan, props.defaultDate));
const isEditing = computed(() => props.plan !== null);

watch(
  () => props.plan,
  (plan) => Object.assign(form, fromPlan(plan, props.defaultDate)),
);
watch(
  () => form.planType,
  (type) => {
    if (type === 'INCOME') form.envelopeId = '';
  },
);

function categoryOptions() {
  return selectableCategories(props.categories)
    .filter(
      (category) => category.categoryType === (form.planType === 'INCOME' ? 'INCOME' : 'EXPENSE'),
    )
    .map((category) => ({ value: category.id, label: category.name }));
}

function envelopeOptions() {
  return props.envelopes
    .filter((envelope) => form.planType !== 'SAVINGS' || envelope.envelopeType === 'SAVINGS_GOAL')
    .map((envelope) => ({ value: envelope.value, label: envelope.label }));
}

function normalizeAmount(value: string): string {
  return value.replace(/\s/g, '').replace(',', '.');
}

function submit() {
  const base = {
    name: form.name.trim(),
    planType: form.planType,
    amount: form.amount,
    anchorOn: form.date,
    startOn: form.date,
    endOn: form.endOn || null,
    recurrence: form.recurrence,
    intervalMonths: form.recurrence === 'EVERY_N_MONTHS' ? Number(form.intervalMonths) : null,
    accountId: form.accountId || null,
    categoryId: form.categoryId || null,
    envelopeId: form.planType === 'INCOME' ? null : form.envelopeId || null,
    comment: form.comment.trim() || null,
  } satisfies CreateRegularPlanInput;
  // isActive only exists on UpdateRegularPlanInput — built as a separate step
  // so the `satisfies CreateRegularPlanInput` above stays a real excess-
  // property check on the fields every plan type shares.
  const input: CreateRegularPlanInput | UpdateRegularPlanInput = isEditing.value
    ? { ...base, isActive: form.isActive }
    : base;
  emit('submit', input);
}

function fromPlan(plan: RegularPlanDto | null, defaultDate: string | undefined): FormModel {
  if (!plan) {
    const today = new Date().toISOString().slice(0, 10);
    return {
      name: '',
      planType: 'EXPENSE',
      amount: '',
      date: defaultDate ?? today,
      endOn: '',
      recurrence: 'MONTHLY',
      intervalMonths: '',
      accountId: '',
      categoryId: '',
      envelopeId: '',
      comment: '',
      isActive: true,
    };
  }
  return {
    name: plan.name,
    planType: plan.planType,
    amount: minorToDecimal(plan.amountMinor),
    date: plan.startOn,
    endOn: plan.endOn ?? '',
    recurrence: plan.recurrence,
    intervalMonths: plan.intervalMonths?.toString() ?? '',
    accountId: plan.accountId ?? '',
    categoryId: plan.categoryId ?? '',
    envelopeId: plan.envelopeId ?? '',
    comment: plan.comment ?? '',
    isActive: plan.isActive,
  };
}

function minorToDecimal(value: string): string {
  const amount = BigInt(value);
  const sign = amount < 0n ? '-' : '';
  const absolute = (amount < 0n ? -amount : amount).toString().padStart(3, '0');
  return `${sign}${absolute.slice(0, -2)}.${absolute.slice(-2)}`;
}
</script>

<template>
  <form class="plan-form" @submit.prevent="submit">
    <div class="plan-form__type" role="radiogroup" aria-label="Тип плана">
      <label
        class="plan-form__type-option"
        :class="{ 'plan-form__type-option--active': form.planType === 'EXPENSE' }"
      >
        <input v-model="form.planType" type="radio" name="planType" value="EXPENSE" />
        Расход
      </label>
      <label
        class="plan-form__type-option"
        :class="{ 'plan-form__type-option--active': form.planType === 'INCOME' }"
      >
        <input v-model="form.planType" type="radio" name="planType" value="INCOME" />
        Доход
      </label>
      <label
        class="plan-form__type-option"
        :class="{ 'plan-form__type-option--active': form.planType === 'SAVINGS' }"
      >
        <input v-model="form.planType" type="radio" name="planType" value="SAVINGS" />
        Накопление
      </label>
    </div>

    <div class="plan-form__hero-amount" :class="`plan-form__hero-amount--${form.planType.toLowerCase()}`">
      <FinanceMoneyInput
        :model-value="form.amount"
        name="amount"
        @update:model-value="form.amount = normalizeAmount($event)"
        label="Сумма"
        :error="errors.amount"
        required
      />
    </div>

    <UiInput v-model="form.name" name="name" label="Название" :error="errors.name" required />

    <UiDatePicker v-model="form.date" name="date" label="Дата" :error="errors.anchorOn" required />

    <UiSelect
      v-model="form.recurrence"
      name="recurrence"
      label="Повторение"
      :options="[
        { value: 'ONE_TIME', label: 'Один раз' },
        { value: 'MONTHLY', label: 'Ежемесячно' },
        { value: 'EVERY_N_MONTHS', label: 'Раз в несколько месяцев' },
        { value: 'YEARLY', label: 'Ежегодно' },
      ]"
      :error="errors.recurrence"
      required
    />
    <UiInput
      v-if="form.recurrence === 'EVERY_N_MONTHS'"
      v-model="form.intervalMonths"
      name="intervalMonths"
      label="Интервал в месяцах"
      type="text"
      :error="errors.intervalMonths"
      required
    />

    <UiSelect
      v-model="form.accountId"
      name="accountId"
      label="Счёт"
      :options="accounts"
      :error="errors.accountId"
    />
    <UiSelect
      v-model="form.categoryId"
      name="categoryId"
      label="Категория"
      :options="categoryOptions()"
      :error="errors.categoryId"
      required
    />
    <UiSelect
      v-if="form.planType !== 'INCOME'"
      v-model="form.envelopeId"
      name="envelopeId"
      label="Конверт"
      :options="envelopeOptions()"
      :error="errors.envelopeId"
      required
    />

    <details class="plan-form__advanced">
      <summary>Дополнительные настройки</summary>
      <UiDatePicker v-model="form.endOn" name="endOn" label="Дата окончания" :error="errors.endOn" />
      <UiInput v-model="form.comment" name="comment" label="Заметка" :error="errors.comment" />
    </details>

    <label v-if="isEditing" class="plan-form__active">
      <input v-model="form.isActive" type="checkbox" name="isActive" />
      Активен
    </label>

    <div class="plan-form__actions">
      <UiButton
        v-if="isEditing"
        type="button"
        variant="danger"
        data-action="delete-plan"
        :disabled="pending"
        @click="emit('remove')"
      >
        Удалить
      </UiButton>
      <UiButton type="submit" :loading="pending" :disabled="pending">
        {{ isEditing ? 'Сохранить изменения' : 'Добавить план' }}
      </UiButton>
    </div>
  </form>
</template>

<style scoped>
.plan-form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--hf-space-4);
}
.plan-form__type,
.plan-form__hero-amount,
.plan-form__advanced,
.plan-form__active,
.plan-form__actions {
  grid-column: 1 / -1;
}
.plan-form__type {
  display: flex;
  gap: var(--hf-space-2);
}
.plan-form__type-option {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  min-height: var(--hf-control-height-md);
  border: 1px solid var(--hf-color-border-strong);
  border-radius: var(--hf-control-radius);
  cursor: pointer;
}
.plan-form__type-option input {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
}
.plan-form__type-option--active {
  border-color: var(--hf-color-brand);
  background: var(--hf-color-brand-soft);
  color: var(--hf-color-brand);
  font-weight: var(--hf-font-weight-semibold);
}
.plan-form__hero-amount {
  border-bottom: 2px solid var(--hf-color-border-strong);
  transition: border-color var(--hf-transition-fast);
}
.plan-form__hero-amount :deep(.ui-field__control) {
  border: 0;
  padding-inline: 0;
  font-size: 2rem;
  font-weight: var(--hf-font-weight-semibold);
}
.plan-form__hero-amount--expense {
  border-color: var(--hf-color-status-danger);
}
.plan-form__hero-amount--income {
  border-color: var(--hf-color-status-success);
}
.plan-form__hero-amount--savings {
  border-color: var(--hf-color-brand);
}
.plan-form__advanced {
  color: var(--hf-color-text);
}
.plan-form__advanced summary {
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
  font-weight: var(--hf-font-weight-medium);
  cursor: pointer;
}
.plan-form__advanced > :not(summary) {
  margin-top: var(--hf-space-3);
}
.plan-form__active {
  display: flex;
  align-items: center;
  gap: var(--hf-space-2);
}
.plan-form__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-2);
}
@media (max-width: 47.9375rem) {
  .plan-form {
    grid-template-columns: 1fr;
  }
}
</style>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web test -- PlanForm.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/components/plans/PlanForm.vue apps/web/app/components/plans/PlanForm.test.ts
git commit -m "refactor(web): rework PlanForm with type toggle, hero amount, and edit mode delete"
```

---

### Task 14: Rewrite `plans.vue`

**Files:**
- Modify: `apps/web/app/pages/app/plans.vue`
- Modify: `apps/web/app/pages/app/plans.test.ts`

**Interfaces:**
- Consumes every component/util from Tasks 1-13: `PlansCalendar`, `PlanDayPanel`, `PlanKpiRow`, `PlanList`, `PlanForm`, `buildCalendarGrid`, `buildDayAggregates`, `computePlanKpi`, `ReferencePageLayout`, `UiModal`, `UiConfirmDialog`. Builds `categoryIconById: Record<string, string | null>` from the loaded `categories` list (`category.id` → `category.icon`) and passes it to `PlanDayPanel`/`PlanList` (Tasks 10/12), which is how the "plan icon = category icon" design decision reaches every row without each row component loading categories itself.
- This is the top-level orchestration task — no later task depends on it.

- [ ] **Step 1: Write the failing tests**

Replace `apps/web/app/pages/app/plans.test.ts` entirely:

```ts
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiRequestError } from '../../composables/useApiClient.js';

const api = {
  listRegularPlans: vi.fn(),
  listPlanOccurrences: vi.fn(),
  listTransactions: vi.fn(),
  listAccounts: vi.fn(),
  listCategories: vi.fn(),
  listEnvelopes: vi.fn(),
  createRegularPlan: vi.fn(),
  updateRegularPlan: vi.fn(),
  deleteRegularPlan: vi.fn(),
  skipPlanOccurrence: vi.fn(),
  completePlanOccurrence: vi.fn(),
  createPlanOccurrenceDraft: vi.fn(),
};
const auth = {
  currentData: {
    value: {
      workspaces: [{ budgets: [{ id: 'budget-id', name: 'Бюджет', primaryCurrency: 'RUB' }] }],
    },
  },
  loadMe: vi.fn(),
};
const { navigateTo, route } = vi.hoisted(() => ({ navigateTo: vi.fn(), route: { query: {} } }));

vi.mock('#imports', () => ({
  definePageMeta: vi.fn(),
  navigateTo,
  useRoute: () => route,
}));
vi.mock('../../composables/useAuth.js', () => ({ useAuth: () => auth }));
vi.mock('../../composables/useBudgetReferenceData.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useBudgetReferenceData: () => api,
}));

import PlansPage from './plans.vue';

function mountPage() {
  return mount(PlansPage, {
    attachTo: document.body,
    global: { stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } },
  });
}

const occurrence = {
  id: 'occurrence-id',
  planId: 'plan-id',
  planName: 'Ипотека',
  planType: 'EXPENSE' as const,
  scheduledOn: '2026-09-10',
  status: 'DUE' as const,
  amountMinor: '3600000',
  currency: 'RUB' as const,
  scale: 2 as const,
  accountId: 'account-id',
  categoryId: 'category-id',
  envelopeId: 'envelope-id',
  comment: null,
  transactionId: null,
  cancellationReason: null,
};

const transaction = {
  id: 'transaction-id',
  budgetId: 'budget-id',
  transactionType: 'EXPENSE' as const,
  status: 'CONFIRMED' as const,
  amountMinor: '85000',
  currency: 'RUB' as const,
  scale: 2 as const,
  occurredOn: '2026-09-13',
  accountId: 'account-id',
  categoryId: 'category-id',
  envelopeId: 'envelope-id',
  sourceDescription: null,
  merchantName: null,
  isPlanned: false,
  comment: null,
  confirmedAt: '2026-09-13T00:00:00.000Z',
  cancelledAt: null,
  deletedAt: null,
  accountCurrentBalanceMinor: '0',
  envelopeCurrentBalanceMinor: '0',
  unallocatedMinor: '0',
  allocationProposal: null,
};

describe('plans page', () => {
  let wrapper: ReturnType<typeof mountPage> | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    // The page computes "today" from the real clock (`format(new Date(), ...)`
    // in plans.vue) to build the default calendar month and the overdue/
    // upcoming dot split — pin it so the fixed 2026-09-10/2026-09-13 dates
    // below always fall inside the rendered grid regardless of when this
    // suite actually runs. Fake only `Date`, not timers — `flushPromises()`
    // from `@vue/test-utils` resolves via a real `setTimeout`, which would
    // hang forever under full fake timers.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-24T00:00:00.000Z'));
    route.query = {};
    api.listRegularPlans.mockResolvedValue([]);
    api.listPlanOccurrences.mockResolvedValue([occurrence]);
    api.listTransactions.mockResolvedValue({ items: [transaction], nextCursor: null });
    api.listAccounts.mockResolvedValue([{ id: 'account-id', name: 'Счёт планов' }]);
    api.listCategories.mockResolvedValue([
      { id: 'category-id', name: 'Расходы планов', categoryType: 'EXPENSE', icon: null },
    ]);
    api.listEnvelopes.mockResolvedValue([
      { id: 'envelope-id', name: 'Конверт планов', envelopeType: 'CURRENT_EXPENSES' },
    ]);
    api.createRegularPlan.mockResolvedValue({ id: 'plan-id' });
    api.completePlanOccurrence.mockResolvedValue({ ...occurrence, status: 'COMPLETED' });
    api.createPlanOccurrenceDraft.mockResolvedValue({ id: 'draft-id', status: 'DRAFT' });
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
      wrapper = null;
    }
    vi.useRealTimers();
  });

  it('marks plan controls ready after client hydration and loads calendar-range data', async () => {
    wrapper = mountPage();
    await flushPromises();

    expect(wrapper.get('[data-hydrated]').attributes('data-hydrated')).toBe('true');
    expect(api.listPlanOccurrences).toHaveBeenCalled();
    expect(api.listTransactions).toHaveBeenCalled();
  });

  it('selects a day and opens the create-draft flow for its occurrence', async () => {
    wrapper = mountPage();
    await flushPromises();

    await wrapper.get('[data-date="2026-09-10"]').trigger('click');
    await flushPromises();
    await wrapper.get('[data-testid="action-menu-trigger"]').trigger('click');
    await wrapper.get('[data-testid="row-draft"]').trigger('click');

    expect(api.createPlanOccurrenceDraft).toHaveBeenCalledWith(
      'budget-id',
      'occurrence-id',
      expect.any(String),
    );
    expect(navigateTo).toHaveBeenCalledWith('/app/operations?draftId=draft-id');
  });

  it('places server validation errors beside the plan field', async () => {
    api.createRegularPlan.mockRejectedValue(
      new ApiRequestError(400, {
        code: 'VALIDATION_FAILED',
        detail: 'Проверьте поля формы.',
        fieldErrors: [{ field: 'name', message: 'Укажите название плана.', code: 'custom' }],
      }),
    );
    wrapper = mountPage();
    await flushPromises();

    await wrapper.get('[data-action="create-plan"]').trigger('click');
    await flushPromises();

    const planForm = document.querySelector('form.plan-form') as HTMLFormElement;
    const nameInput = document.querySelector(
      'form.plan-form input[name="name"]',
    ) as HTMLInputElement;

    nameInput.value = '';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();

    planForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushPromises();

    const fullText = document.body.innerText;
    expect(fullText).toContain('Укажите название плана.');
    expect(nameInput.getAttribute('aria-invalid')).toBe('true');
  });

  it('selects the day of the occurrence referenced by the notification route', async () => {
    route.query = { occurrence: 'occurrence-id' };
    wrapper = mountPage();
    await flushPromises();

    expect(wrapper.get('[data-date="2026-09-10"]').classes()).toContain(
      'plans-calendar__cell--selected',
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test -- plans.test.ts`
Expected: FAIL — the current page has no calendar cells, no `listTransactions` call, etc.

- [ ] **Step 3: Rewrite `plans.vue`**

Replace `apps/web/app/pages/app/plans.vue` entirely:

```vue
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { format } from 'date-fns';
import { definePageMeta, navigateTo, useRoute } from '#imports';

import { buildCalendarGrid } from '../../components/plans/calendar-grid.js';
import { buildDayAggregates } from '../../components/plans/day-aggregates.js';
import { computePlanKpi } from '../../components/plans/plan-kpi.js';
import PlanDayPanel, {
  type DayOperationView,
} from '../../components/plans/PlanDayPanel.vue';
import PlanForm from '../../components/plans/PlanForm.vue';
import PlanKpiRow from '../../components/plans/PlanKpiRow.vue';
import PlanList from '../../components/plans/PlanList.vue';
import PlansCalendar from '../../components/plans/PlansCalendar.vue';
import ReferencePageLayout from '../../components/ui/ReferencePageLayout.vue';
import UiButton from '../../components/ui/Button.vue';
import UiConfirmDialog from '../../components/ui/ConfirmDialog.vue';
import UiModal from '../../components/ui/Modal.vue';
import { useAuth } from '../../composables/useAuth.js';
import { ApiRequestError } from '../../composables/useApiClient.js';
import {
  type CategoryDto,
  type CreateRegularPlanInput,
  type EnvelopeType,
  type PlanOccurrenceDto,
  type RegularPlanDto,
  type TransactionDto,
  type UpdateRegularPlanInput,
  useBudgetReferenceData,
} from '../../composables/useBudgetReferenceData.js';

defineOptions({ name: 'PlansPage' });
definePageMeta({ middleware: 'auth', layout: 'app' });

const auth = useAuth();
const route = useRoute();
const api = useBudgetReferenceData();

const today = format(new Date(), 'yyyy-MM-dd');

const plans = ref<RegularPlanDto[]>([]);
const rangeOccurrences = ref<PlanOccurrenceDto[]>([]);
const upcomingOccurrences = ref<PlanOccurrenceDto[]>([]);
const rangeTransactions = ref<TransactionDto[]>([]);
const accounts = ref<Array<{ value: string; label: string }>>([]);
const categories = ref<CategoryDto[]>([]);
const envelopes = ref<Array<{ value: string; label: string; envelopeType?: EnvelopeType }>>([]);

const loading = ref(true);
const hydrated = ref(false);
const pending = ref(false);
const error = ref('');
const statusText = ref('');
const formErrors = ref<Partial<Record<string, string>>>({});
const formOpen = ref(false);
const listTab = ref<'upcoming' | 'all'>('upcoming');
const monthAnchor = ref(today.slice(0, 8) + '01');
const selectedDate = ref(today);
const selectedPlan = ref<RegularPlanDto | null>(null);
const confirmation = ref<null | { action: 'remove' | 'skip'; planId?: string; occurrenceId?: string }>(
  null,
);
const mutationKeys = new Map<string, string>();

const budget = computed(() => auth.currentData.value?.workspaces[0]?.budgets[0] ?? null);

const grid = computed(() => buildCalendarGrid(monthAnchor.value));
const aggregates = computed(() =>
  buildDayAggregates(rangeTransactions.value, rangeOccurrences.value, today),
);

const monthOccurrences = computed(() =>
  rangeOccurrences.value.filter((occurrence) => occurrence.scheduledOn.startsWith(monthAnchor.value.slice(0, 7))),
);
const kpi = computed(() =>
  computePlanKpi(
    monthOccurrences.value,
    plans.value.filter((plan) => plan.isActive).length,
  ),
);

const categoryById = computed(() => new Map(categories.value.map((category) => [category.id, category])));
const categoryIconById = computed<Record<string, string | null>>(() =>
  Object.fromEntries(categories.value.map((category) => [category.id, category.icon])),
);

const selectedDayOperations = computed<DayOperationView[]>(() =>
  rangeTransactions.value
    .filter((transaction) => transaction.occurredOn === selectedDate.value)
    .map((transaction) => ({
      id: transaction.id,
      categoryName: categoryById.value.get(transaction.categoryId)?.name ?? 'Без категории',
      categoryIcon: categoryById.value.get(transaction.categoryId)?.icon ?? null,
      transactionType: transaction.transactionType,
      amountMinor: transaction.amountMinor,
      currency: transaction.currency,
      scale: transaction.scale,
    })),
);
const selectedDayOccurrences = computed(() =>
  rangeOccurrences.value.filter((occurrence) => occurrence.scheduledOn === selectedDate.value),
);

onMounted(() => {
  hydrated.value = true;
  void load();
});

async function load() {
  if (!budget.value) {
    try {
      await auth.loadMe();
    } catch {
      error.value = 'Не удалось загрузить бюджет.';
    }
  }
  if (!budget.value) {
    loading.value = false;
    return;
  }
  loading.value = true;
  error.value = '';
  try {
    const from = grid.value[0]?.date ?? monthAnchor.value;
    const to = grid.value[41]?.date ?? monthAnchor.value;
    const [
      planData,
      rangeOccurrenceData,
      dueOccurrenceData,
      pendingOccurrenceData,
      transactionData,
      accountData,
      categoryData,
      envelopeData,
    ] = await Promise.all([
      api.listRegularPlans(budget.value.id, 'all'),
      api.listPlanOccurrences(budget.value.id, { from, to }),
      api.listPlanOccurrences(budget.value.id, { status: 'DUE' }),
      api.listPlanOccurrences(budget.value.id, { status: 'PENDING' }),
      loadAllTransactions(budget.value.id, from, to),
      api.listAccounts(budget.value.id, 'active'),
      api.listCategories(budget.value.id, undefined, 'active'),
      api.listEnvelopes(budget.value.id, 'active'),
    ]);
    plans.value = planData;
    rangeOccurrences.value = rangeOccurrenceData;
    upcomingOccurrences.value = [...dueOccurrenceData, ...pendingOccurrenceData];
    rangeTransactions.value = transactionData;
    accounts.value = accountData.map((account) => ({ value: account.id, label: account.name }));
    categories.value = categoryData;
    envelopes.value = envelopeData.map((envelope) => ({
      value: envelope.id,
      label: envelope.name,
      envelopeType: envelope.envelopeType,
    }));

    const highlighted = String(route.query.occurrence ?? '');
    const target =
      rangeOccurrenceData.find((occurrence) => occurrence.id === highlighted) ??
      upcomingOccurrences.value.find((occurrence) => occurrence.id === highlighted);
    if (target) selectedDate.value = target.scheduledOn;
  } catch {
    error.value = 'Не удалось загрузить планы. Повторите попытку.';
  } finally {
    loading.value = false;
  }
}

async function loadAllTransactions(
  budgetId: string,
  from: string,
  to: string,
): Promise<TransactionDto[]> {
  const items: TransactionDto[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await api.listTransactions(budgetId, {
      from,
      to,
      status: 'CONFIRMED',
      limit: 100,
      cursor,
    });
    items.push(...page.items);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return items;
}

function selectDay(date: string) {
  selectedDate.value = date;
}

function changeMonth(nextMonthAnchor: string) {
  monthAnchor.value = nextMonthAnchor;
  void load();
}

function openCreate() {
  selectedPlan.value = null;
  formErrors.value = {};
  formOpen.value = true;
}

function openEditPlan(plan: RegularPlanDto) {
  selectedPlan.value = plan;
  formErrors.value = {};
  formOpen.value = true;
}

function openEditOccurrence(occurrence: PlanOccurrenceDto) {
  const plan = plans.value.find((candidate) => candidate.id === occurrence.planId);
  if (plan) openEditPlan(plan);
}

async function savePlan(input: CreateRegularPlanInput | UpdateRegularPlanInput) {
  if (!budget.value) return;
  pending.value = true;
  error.value = '';
  formErrors.value = {};
  const operation = selectedPlan.value ? `update:${selectedPlan.value.id}` : 'create';
  try {
    if (selectedPlan.value) {
      await api.updateRegularPlan(budget.value.id, selectedPlan.value.id, input, keyFor(operation));
    } else {
      await api.createRegularPlan(
        budget.value.id,
        input as CreateRegularPlanInput,
        keyFor(operation),
      );
    }
    mutationKeys.delete(operation);
    formOpen.value = false;
    selectedPlan.value = null;
    statusText.value = 'План сохранён.';
    await load();
  } catch (exception) {
    mapFormError(exception);
  } finally {
    pending.value = false;
  }
}

async function removePlan(planId: string) {
  if (!budget.value) return;
  pending.value = true;
  error.value = '';
  const operation = `remove:${planId}`;
  try {
    await api.deleteRegularPlan(budget.value.id, planId, keyFor(operation));
    mutationKeys.delete(operation);
    formOpen.value = false;
    selectedPlan.value = null;
    statusText.value = 'План удалён.';
    await load();
  } catch (exception) {
    error.value = errorMessage(exception);
  } finally {
    pending.value = false;
  }
}

async function completeOccurrence(occurrence: PlanOccurrenceDto) {
  if (!budget.value) return;
  pending.value = true;
  error.value = '';
  const operation = `complete:${occurrence.id}`;
  try {
    await api.completePlanOccurrence(budget.value.id, occurrence.id, keyFor(operation));
    mutationKeys.delete(operation);
    statusText.value = 'Данные обновлены на сервере.';
    await load();
  } catch (exception) {
    error.value = errorMessage(exception);
  } finally {
    pending.value = false;
  }
}

async function draftOccurrence(occurrence: PlanOccurrenceDto) {
  if (!budget.value) return;
  pending.value = true;
  error.value = '';
  const operation = `draft:${occurrence.id}`;
  try {
    const draft = await api.createPlanOccurrenceDraft(budget.value.id, occurrence.id, keyFor(operation));
    await navigateTo(`/app/operations?draftId=${encodeURIComponent(draft.id)}`);
  } catch (exception) {
    error.value = errorMessage(exception);
  } finally {
    pending.value = false;
  }
}

async function runConfirmation() {
  if (!budget.value || !confirmation.value) return;
  const current = confirmation.value;
  confirmation.value = null;
  pending.value = true;
  error.value = '';
  try {
    if (current.action === 'remove' && current.planId) {
      await removePlan(current.planId);
    }
    if (current.action === 'skip' && current.occurrenceId) {
      const key = keyFor(`skip:${current.occurrenceId}`);
      await api.skipPlanOccurrence(budget.value.id, current.occurrenceId, key);
      mutationKeys.delete(`skip:${current.occurrenceId}`);
      statusText.value = 'Данные обновлены на сервере.';
      await load();
    }
  } catch (exception) {
    error.value = errorMessage(exception);
  } finally {
    pending.value = false;
  }
}

function keyFor(operation: string) {
  const existing = mutationKeys.get(operation);
  if (existing) return existing;
  const key = crypto.randomUUID();
  mutationKeys.set(operation, key);
  return key;
}

function mapFormError(exception: unknown) {
  if (exception instanceof ApiRequestError) {
    formErrors.value = Object.fromEntries(
      (exception.problem.fieldErrors ?? []).map((field) => [field.field, field.message]),
    );
  }
  error.value = errorMessage(exception);
}

function errorMessage(exception: unknown) {
  return exception instanceof ApiRequestError
    ? exception.problem.detail
    : 'Не удалось выполнить действие. Повторите попытку.';
}
</script>

<template>
  <div v-if="hydrated" class="plans-page" data-hydrated="true">
    <ReferencePageLayout>
      <template #kicker>Регулярные планы</template>
      <template #title>Планы</template>
      <template #actions>
        <UiButton data-action="create-plan" @click="openCreate">+ Создать план</UiButton>
      </template>
      <template #content>
        <p v-if="statusText" class="plans-page__status" role="status">{{ statusText }}</p>
        <p v-if="error" class="plans-page__error" role="alert">{{ error }}</p>
        <p v-if="loading">Загрузка планов…</p>
        <template v-else-if="budget">
          <PlanKpiRow
            :planned-income-minor="kpi.plannedIncomeMinor"
            :planned-expense-minor="kpi.plannedExpenseMinor"
            :balance-minor="kpi.balanceMinor"
            :total-plans="kpi.totalPlans"
          />

          <div class="plans-page__main">
            <PlansCalendar
              :month-anchor="monthAnchor"
              :selected-date="selectedDate"
              :today="today"
              :aggregates="aggregates"
              @select-day="selectDay"
              @change-month="changeMonth"
            />

            <PlanDayPanel
              :date="selectedDate"
              :operations="selectedDayOperations"
              :occurrences="selectedDayOccurrences"
              :category-icon-by-id="categoryIconById"
              :pending="pending"
              @complete-occurrence="completeOccurrence"
              @draft-occurrence="draftOccurrence"
              @skip-occurrence="(occurrence) => (confirmation = { action: 'skip', occurrenceId: occurrence.id })"
              @edit-occurrence="openEditOccurrence"
              @remove-occurrence="(occurrence) => (confirmation = { action: 'remove', planId: occurrence.planId })"
              @add-plan="
                selectedPlan = null;
                formErrors = {};
                formOpen = true;
              "
            />

            <PlanList
              :active-tab="listTab"
              :upcoming-occurrences="upcomingOccurrences"
              :all-plans="plans"
              :category-icon-by-id="categoryIconById"
              :pending="pending"
              @update:active-tab="listTab = $event"
              @complete-occurrence="completeOccurrence"
              @draft-occurrence="draftOccurrence"
              @skip-occurrence="(occurrence) => (confirmation = { action: 'skip', occurrenceId: occurrence.id })"
              @edit-occurrence="openEditOccurrence"
              @remove-occurrence="(occurrence) => (confirmation = { action: 'remove', planId: occurrence.planId })"
              @edit-plan="openEditPlan"
              @remove-plan="(plan) => (confirmation = { action: 'remove', planId: plan.id })"
            />
          </div>
        </template>
      </template>
    </ReferencePageLayout>

    <UiModal
      :open="formOpen"
      :title="selectedPlan ? 'Изменить план' : 'Новый план'"
      @close="formOpen = false"
    >
      <PlanForm
        :plan="selectedPlan"
        :default-date="selectedDate"
        :accounts="accounts"
        :categories="categories"
        :envelopes="envelopes"
        :errors="formErrors"
        :pending="pending"
        @submit="savePlan"
        @remove="selectedPlan && (confirmation = { action: 'remove', planId: selectedPlan.id })"
      />
    </UiModal>

    <UiConfirmDialog
      :open="confirmation !== null"
      :title="confirmation?.action === 'remove' ? 'Удалить план?' : 'Подтвердить действие?'"
      :description="
        confirmation?.action === 'remove'
          ? 'Будущие возникновения будут отменены.'
          : 'Изменения вступят в силу сразу.'
      "
      confirm-label="Подтвердить"
      cancel-label="Отмена"
      variant="primary"
      :loading="pending"
      @confirm="runConfirmation"
      @cancel="confirmation = null"
    />
  </div>
</template>

<style scoped>
.plans-page__status,
.plans-page__error {
  margin: 0 0 var(--hf-space-4);
}
.plans-page__status {
  color: var(--hf-color-text-muted);
}
.plans-page__error {
  color: var(--hf-color-text-danger);
}
.plans-page__main {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr);
  gap: var(--hf-space-4);
  margin-top: var(--hf-space-4);
}
@media (max-width: 61.9375rem) {
  .plans-page__main {
    grid-template-columns: 1fr;
  }
}
</style>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web test -- plans.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/pages/app/plans.vue apps/web/app/pages/app/plans.test.ts
git commit -m "refactor(web): rebuild the plans page around the calendar/day-panel/list layout"
```

---

### Task 15: Update the CI-only e2e spec

**Files:**
- Modify: `e2e/stage-5-plans-notifications.spec.ts`

**Interfaces:**
- Consumes the new page's `data-action`/`data-date` attributes from Tasks 11-14 (`[data-action="create-plan"]`, `[data-date="..."]`, `[data-testid="action-menu-trigger"]`, `[data-testid="row-draft"]`).
- No later task depends on this one. This test is CI-only — do not run it locally; reason through the DOM it exercises statically against Tasks 7, 11, 13, 14.

- [ ] **Step 1: Update the occurrence-visibility assertion**

In `e2e/stage-5-plans-notifications.spec.ts`, replace lines 34-38:

```ts
    await page.goto('/app/plans');
    await expect(
      page.getByLabel('Ближайшие платежи').getByRole('heading', { name: 'Ипотека Stage 5' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Создать черновик' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      375,
    );
```

with:

```ts
    await page.goto('/app/plans');
    await expect(page.getByRole('tabpanel', { name: 'Ближайшие' })).toContainText('Ипотека Stage 5');
    await page.getByTestId('action-menu-trigger').click();
    await expect(page.getByRole('button', { name: 'Создать черновик' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      375,
    );
```

- [ ] **Step 2: Update the plan-creation helper's field selectors**

Replace `createExpensePlan` (lines 112-124):

```ts
async function createExpensePlan(page: Page): Promise<void> {
  await page.goto('/app/plans');
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
  await page.locator('[data-action="create-plan"]').click();
  await expect(page.locator('input[name="name"]')).toBeVisible();
  await page.getByLabel('Название').fill('Ипотека Stage 5');
  await page.getByLabel('Сумма').fill('36 000,00');
  await page.getByLabel('Счёт').selectOption({ label: 'Карта Stage 5' });
  await page.getByLabel('Категория').selectOption({ label: 'Продукты' });
  await page.getByLabel('Конверт').selectOption({ label: 'Обязательства Stage 5' });
  await page.getByRole('button', { name: 'Добавить план' }).click();
  await expect(page.getByText('План сохранён.')).toBeVisible();
}
```

(`Счёт по умолчанию` label became `Счёт`, and the submit button label changed from `Сохранить план` to `Добавить план` per Task 13's `PlanForm.vue`.)

- [ ] **Step 3: Leave the post-completion assertion as-is, and confirm why**

Lines 55-58 (`await page.goto('/app/plans'); await expect(page.getByText('Выполнено', { exact: true })).toBeVisible();`) need **no edit**. Reasoning to verify before moving on: `seedOccurrence` sets `scheduledOn: plan.startOn`, and `createExpensePlan` never fills the "Дата" field, so the plan keeps `PlanForm`'s create-mode default date — `today` (Task 13's `fromPlan()`, `defaultDate ?? today`, and `createExpensePlan` passes no `defaultDate` context so it resolves to today). `plans.vue`'s `selectedDate` also defaults to `today` (Task 14) and nothing earlier in this test clicks a different calendar day. `rangeOccurrences` (feeding `PlanDayPanel`'s `selectedDayOccurrences`) is fetched with no `status` filter, so the now-`COMPLETED` occurrence is still included, and `PlanOccurrenceRow` shows the `Выполнено` status label for a `COMPLETED` occurrence (Task 7's `PlanOccurrenceRow.test.ts`, "shows a status label with no actions for a completed occurrence"). So the completed occurrence surfaces in today's day panel exactly where the original two-line assertion expects to find it — the assertion is correct unchanged.

- [ ] **Step 4: Verify statically against the component tests**

There is no local Playwright run for this task (CI-only convention). Re-read Task 7's `PlanOccurrenceRow.test.ts`, Task 12's `PlanDayPanel.test.ts`, and Task 14's `plans.vue` `selectedDayOccurrences`/`selectedDate` wiring to confirm the reasoning in Step 3 holds, then move on — no further edits to this file beyond Steps 1-2.

- [ ] **Step 5: Commit**

```bash
git add e2e/stage-5-plans-notifications.spec.ts
git commit -m "test(e2e): update plans page selectors for the calendar redesign"
```

---

### Task 16: Full verification pass

**Files:** none (verification only).

- [ ] **Step 1: Lint**

Run: `pnpm lint`
Expected: no errors in any file touched by Tasks 1-15.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: no errors — pay particular attention to `apps/web/app/pages/app/plans.vue`'s use of `PlanKpi`, `DayAggregate`, and `DayOperationView` types, and to `PlanForm.vue`'s `submit()` (Task 13): `isActive` only exists on `UpdateRegularPlanInput`, which is why `base` is `satisfies`-checked against `CreateRegularPlanInput` alone and the edit-mode `{ ...base, isActive: form.isActive }` is assigned to the explicit `CreateRegularPlanInput | UpdateRegularPlanInput` union afterward, not folded into the same `satisfies` expression.

- [ ] **Step 3: Full web test suite**

Run: `pnpm --filter web test`
Expected: PASS, including every test file touched in Tasks 1-14 and every pre-existing test that imports `PlanCard.vue`/`PlanOccurrenceCard.vue` (there should be none left — confirm with `grep -r "PlanCard\|PlanOccurrenceCard" apps/web/app --include=*.ts --include=*.vue`, expected: no matches).

- [ ] **Step 4: Format check**

Run: `pnpm format:check`
Expected: PASS. If it fails, run `pnpm format` and re-stage.

- [ ] **Step 5: Build**

Run: `pnpm build`
Expected: PASS — confirms no dangling imports (e.g. the deleted `PlanCard.vue`/`PlanOccurrenceCard.vue`) and no Nuxt build-time type errors.

- [ ] **Step 6: Commit any formatting fixes**

Only if Step 4 required `pnpm format`:

```bash
git add -u
git commit -m "style: apply formatter after plans page redesign"
```
