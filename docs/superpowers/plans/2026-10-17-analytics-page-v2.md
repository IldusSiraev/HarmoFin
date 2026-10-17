# Страница аналитики с графиками — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Заменить страницу `/app/analytics` (список из 9 отчётов + одна ECharts-диаграмма) на пять вкладок с понятными SVG-графиками и добавить серверные отчёты `envelope-limits` и `period-comparison`.

**Architecture:** API — два новых ключа в существующем `ReportV2ApplicationService` (одна read-only транзакция, `budget_id` в каждом запросе), чистые функции построения строк в новом `report-v2-insights.ts` с unit-тестами. Web — presentational-графики в `components/analytics/charts/` (только props), вкладки в `components/analytics/tabs/` загружают свои отчёты через `useAnalyticsReport`, страница управляет вкладкой, фильтрами и URL. ECharts удаляется.

**Tech Stack:** NestJS/Fastify, Prisma, Zod, Vitest (unit + integration), Nuxt 4/Vue 3.5, `@vue/test-utils`, `@lucide/vue`.

**Spec:** [docs/superpowers/specs/2026-10-17-analytics-page-v2-design.md](../specs/2026-10-17-analytics-page-v2-design.md)

## Global Constraints

- Деньги на сервере — `bigint` minor units; в ответе — строки `^-?\d+$`. Проценты и доли — целые `Permille`/`BasisPoints`, деление `bigint` (округление к нулю).
- Фронтенд не считает суммы, доли и разницы: только геометрия графиков из готовых сумм и форматирование.
- Каждый запрос к данным фильтрует `budget_id` в самом запросе; доступ — `findAccessible` в той же транзакции.
- Изменения `/api/v2` только аддитивные; существующие ключи и поля строк не меняются (кроме нового поля `shareBasisPoints`).
- Тексты интерфейса — русский, по глоссарию `docs/superpowers/specs/2026-10-16-ui-glossary-design.md` («Отложено», «Лимит на период», «Перерасход», «На текущие траты», «Накопления»; «назначение» в смысле раскладывания денег запрещено). Имена в коде — английские.
- Графики: без `echarts`, `window`, `ResizeObserver`, composables и API; цвета только через `--hf-color-*`.
- Один writer на задачу; reviewers read-only. Worktree не создавать. Локальный Playwright не запускать.
- Коммит, push и PR — только после явного одобрения владельца. Шаги «Коммит» ниже выполняются только при наличии этого одобрения; без него задача заканчивается проверками.
- Не трогать `identity/logo_description.png`.

## Файлы

API:
- Create `apps/api/src/reports/report-v2-insights.ts` — чистые функции: `addDays`, `periodRangeFor`, `withShareBasisPoints`, `envelopeLimitRows`, `periodComparisonRow`, `assertFiltersAllowed`.
- Create `apps/api/src/reports/report-v2-insights.test.ts`.
- Modify `apps/api/src/reports/report-v2.application.service.ts` — новые ключи, доли, `expensesByPeriod` через `periodRangeFor`.
- Modify `apps/api/src/reports/report-v2.repository.ts` — `limitPeriods()`.
- Modify `apps/api/src/reports/report-v2.dto.ts`, `report-v2.controller.ts` — ключи, классы строк, описание.
- Modify `apps/api/test/v2-reports.integration.test.ts`; regenerate `openapi.json`.

Web:
- Modify `apps/web/app/composables/useEnvelopePlanV2.ts` (+ test) — ключи, типы строк.
- Create `apps/web/app/composables/useAnalyticsReport.ts` (+ test).
- Create `apps/web/app/components/analytics/journal-href.ts`, `period-label.ts`; modify `ReportTable.vue`.
- Create `apps/web/app/components/ui/Tabs.vue` (+ test).
- Modify `apps/web/app/assets/styles/tokens.css` — токены графиков.
- Create `apps/web/app/components/analytics/charts/{chart-scale.ts,ShareBar.vue,ColumnChart.vue,LimitBar.vue,GoalProgress.vue}` (+ tests).
- Modify `apps/web/app/components/analytics/GoalProgressReport.vue` (+ test), `ReportFilters.vue` (+ test).
- Create `apps/web/app/components/analytics/ReportCard.vue`, `tabs/{OverviewTab,ExpensesTab,CashFlowTab,EnvelopesTab,SavingsTab}.vue` (+ tests).
- Rewrite `apps/web/app/pages/app/analytics.vue` (+ test).
- Delete `apps/web/app/components/analytics/ReportChart.vue`, `ReportChart.test.ts`; remove `echarts` from `apps/web/package.json`, `nuxt.config.ts`, `pnpm-lock.yaml`.

Docs: `docs/superpowers/specs/2026-08-30-family-budget-development-spec.md`, comments in `e2e/playwright.config.ts`, `apps/web/app/pages/index.build-chunks.test.ts`.

---

### Task 1: Чистые функции отчётов аналитики (API)

**Files:**
- Create: `apps/api/src/reports/report-v2-insights.ts`
- Create: `apps/api/src/reports/report-v2-insights.test.ts`
- Modify: `apps/api/src/reports/report-v2.application.service.ts` (функции `expensesByPeriod`, тип `Resolve`)

**Interfaces:**
- Produces:
  - `type Resolve = (date: string) => CycleAndPeriod`
  - `type PeriodRange = { start: string; end: string; source: 'STORED' | 'SETTINGS_AT' }`
  - `addDays(date: string, days: number): string`
  - `periodRangeFor(date: string, stored: Array<{ start: string; end: string }>, resolve: Resolve): PeriodRange`
  - `withShareBasisPoints<T extends { expenseMinor: string }>(rows: T[]): Array<T & { shareBasisPoints: number }>`
  - `type LimitPeriodRow = { periodId: string; envelopeId: string; envelopeName: string; archived: boolean; startsOn: string; endsOn: string; targetMinor: bigint | null; targetStatus: 'UNSET' | 'DRAFT' | 'CONFIRMED' }`
  - `envelopeLimitRows(periods: LimitPeriodRow[], spentByPeriod: Map<string, bigint>, today: string): EnvelopeLimitRow[]`
  - `periodComparisonRow(input: { asOf: string; current: PeriodRange; previous: PeriodRange; facts: FactRow[]; limitTotalMinor: bigint | null }): PeriodComparisonRow`
  - `REPORT_ALLOWED_FILTERS: Partial<Record<ReportV2Key, ReadonlyArray<keyof ReportV2Filters>>>` и `assertFiltersAllowed(key: ReportV2Key, filters: ReportV2Filters): void` (бросает `BadRequestException` `VALIDATION_FAILED`).

Ключи `'envelope-limits'` и `'period-comparison'` в `ReportV2Key` появляются в Task 2; в этой задаче `REPORT_ALLOWED_FILTERS` типизируется как `Partial<Record<string, …>>`, а в Task 2 сужается до `ReportV2Key`.

- [ ] **Step 1: Write the failing tests**

`apps/api/src/reports/report-v2-insights.test.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import type { CycleAndPeriod } from '../cycles/cycle-period.domain.js';
import {
  addDays,
  assertFiltersAllowed,
  envelopeLimitRows,
  periodComparisonRow,
  periodRangeFor,
  withShareBasisPoints,
  type LimitPeriodRow,
} from './report-v2-insights.js';
import type { FactRow } from './report-v2.repository.js';

const resolveMonthHalves = (date: string): CycleAndPeriod => {
  const [year, month, dayText] = date.split('-');
  const first = Number(dayText) <= 14;
  const last = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  const start = `${year}-${month}-${first ? '01' : '15'}`;
  const end = `${year}-${month}-${first ? '14' : String(last)}`;
  return {
    cycle: { start: `${year}-${month}-01`, end: `${year}-${month}-${last}` },
    period: { id: first ? 'FIRST' : 'SECOND', start, end },
    daysUntilNextBoundary: 0,
  } as CycleAndPeriod;
};

const expense = (occurredOn: string, amountMinor: bigint): FactRow => ({
  transactionType: 'EXPENSE',
  amountMinor,
  occurredOn,
  categoryId: 'c',
  categoryName: 'Еда',
});

const period = (overrides: Partial<LimitPeriodRow>): LimitPeriodRow => ({
  periodId: 'p1',
  envelopeId: 'e1',
  envelopeName: 'Продукты',
  archived: false,
  startsOn: '2026-03-01',
  endsOn: '2026-03-14',
  targetMinor: 1_000_000n,
  targetStatus: 'CONFIRMED',
  ...overrides,
});

describe('addDays', () => {
  it('переходит через границу месяца и года', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2025-12-31', 1)).toBe('2026-01-01');
  });
});

describe('periodRangeFor', () => {
  it('сохранённый период с самым поздним началом важнее настроек', () => {
    const stored = [
      { start: '2026-03-01', end: '2026-03-20' },
      { start: '2026-03-10', end: '2026-03-31' },
    ];
    expect(periodRangeFor('2026-03-12', stored, resolveMonthHalves)).toEqual({
      start: '2026-03-10',
      end: '2026-03-31',
      source: 'STORED',
    });
  });

  it('без сохранённого периода берёт настройки, действовавшие в тот день', () => {
    expect(periodRangeFor('2026-02-20', [], resolveMonthHalves)).toEqual({
      start: '2026-02-15',
      end: '2026-02-28',
      source: 'SETTINGS_AT',
    });
  });
});

describe('withShareBasisPoints', () => {
  it('доля от суммы ответа, округление к нулю', () => {
    const rows = withShareBasisPoints([
      { expenseMinor: '100' },
      { expenseMinor: '100' },
      { expenseMinor: '100' },
    ]);
    expect(rows.map((row) => row.shareBasisPoints)).toEqual([3333, 3333, 3333]);
  });

  it('пустой ответ и нулевая сумма не делят на ноль', () => {
    expect(withShareBasisPoints([])).toEqual([]);
    expect(withShareBasisPoints([{ expenseMinor: '0' }])[0]!.shareBasisPoints).toBe(0);
  });
});

describe('envelopeLimitRows', () => {
  it('перерасход: остаток отрицательный, доля больше 1000', () => {
    const [row] = envelopeLimitRows([period({})], new Map([['p1', 1_200_000n]]), '2026-10-17');
    expect(row).toMatchObject({
      targetMinor: '1000000',
      spentMinor: '1200000',
      remainingMinor: '-200000',
      overspentMinor: '200000',
      spentPermille: 1200,
      isCurrent: false,
    });
  });

  it('без лимита: target, остаток и доля null, перерасход 0', () => {
    const [row] = envelopeLimitRows(
      [period({ targetStatus: 'UNSET', targetMinor: null })],
      new Map([['p1', 5n]]),
      '2026-10-17',
    );
    expect(row).toMatchObject({
      targetMinor: null,
      remainingMinor: null,
      overspentMinor: '0',
      spentPermille: null,
    });
  });

  it('нулевой лимит: доли нет, весь расход — перерасход', () => {
    const [row] = envelopeLimitRows(
      [period({ targetMinor: 0n })],
      new Map([['p1', 10n]]),
      '2026-10-17',
    );
    expect(row).toMatchObject({ spentPermille: null, overspentMinor: '10' });
  });

  it('архивный конверт без движения в прошлом периоде пропускается, текущий остаётся', () => {
    const rows = envelopeLimitRows(
      [
        period({ periodId: 'old', archived: true }),
        period({ periodId: 'now', archived: true, startsOn: '2026-10-15', endsOn: '2026-10-31' }),
      ],
      new Map(),
      '2026-10-17',
    );
    expect(rows.map((row) => [row.periodId, row.isCurrent])).toEqual([['now', true]]);
  });

  it('сортировка: новые периоды сверху, затем имя конверта', () => {
    const rows = envelopeLimitRows(
      [
        period({ periodId: 'a', envelopeName: 'Транспорт' }),
        period({ periodId: 'b', envelopeName: 'Еда' }),
        period({ periodId: 'c', startsOn: '2026-03-15', endsOn: '2026-03-31' }),
      ],
      new Map(),
      '2026-10-17',
    );
    expect(rows.map((row) => row.periodId)).toEqual(['c', 'b', 'a']);
  });
});

describe('periodComparisonRow', () => {
  const current = { start: '2026-03-15', end: '2026-03-31', source: 'STORED' as const };
  const previous = { start: '2026-03-01', end: '2026-03-14', source: 'STORED' as const };

  it('сравнивает с тем же числом дней прошлого периода', () => {
    const row = periodComparisonRow({
      asOf: '2026-03-20',
      current,
      previous,
      facts: [
        expense('2026-03-03', 100_000n),
        expense('2026-03-10', 50_000n),
        expense('2026-03-16', 80_000n),
        expense('2026-03-25', 999n),
      ],
      limitTotalMinor: 500_000n,
    });
    expect(row).toEqual({
      asOf: '2026-03-20',
      periodStart: '2026-03-15',
      periodEnd: '2026-03-31',
      daysElapsed: 6,
      spentMinor: '80000',
      limitTotalMinor: '500000',
      spentOfLimitPermille: 160,
      previousPeriodStart: '2026-03-01',
      previousPeriodEnd: '2026-03-14',
      previousSameDaySpentMinor: '100000',
      previousTotalSpentMinor: '150000',
      deltaMinor: '-20000',
      deltaBasisPoints: -2000,
    });
  });

  it('окно прошлого периода не выходит за его конец; нулевой прошлый период без процента', () => {
    const row = periodComparisonRow({
      asOf: '2026-03-31',
      current,
      previous,
      facts: [expense('2026-03-31', 7n), expense('2026-03-14', 0n)],
      limitTotalMinor: null,
    });
    expect(row).toMatchObject({
      daysElapsed: 17,
      previousSameDaySpentMinor: '0',
      deltaBasisPoints: null,
      limitTotalMinor: null,
      spentOfLimitPermille: null,
    });
  });

  it('доходы не учитываются; отрицательная разница округляется к нулю', () => {
    const row = periodComparisonRow({
      asOf: '2026-03-15',
      current,
      previous,
      facts: [
        { ...expense('2026-03-15', 1_000n), transactionType: 'INCOME' },
        expense('2026-03-01', 3n),
        expense('2026-03-15', 1n),
      ],
      limitTotalMinor: 0n,
    });
    expect(row).toMatchObject({ spentMinor: '1', deltaMinor: '-2', deltaBasisPoints: -6666 });
    expect(row.spentOfLimitPermille).toBeNull();
  });
});

describe('assertFiltersAllowed', () => {
  it('отклоняет неприменимые фильтры новых ключей', () => {
    expect(() => assertFiltersAllowed('period-comparison', { envelopeId: 'x' })).toThrow(
      BadRequestException,
    );
    expect(() => assertFiltersAllowed('envelope-limits', { accountId: 'x' })).toThrow(
      BadRequestException,
    );
  });

  it('пропускает разрешённые фильтры и старые ключи', () => {
    expect(() => assertFiltersAllowed('period-comparison', { to: '2026-03-20' })).not.toThrow();
    expect(() => assertFiltersAllowed('envelope-limits', { from: '2026-03-01' })).not.toThrow();
    expect(() => assertFiltersAllowed('expenses-by-category', { accountId: 'x' })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @harmofin/api exec vitest run src/reports/report-v2-insights.test.ts`
Expected: FAIL — `Cannot find module './report-v2-insights.js'`.

- [ ] **Step 3: Implement**

`apps/api/src/reports/report-v2-insights.ts`:

```ts
import { BadRequestException } from '@nestjs/common';

import { formatMinorUnits } from '../common/money/minor-units.js';
import type { CycleAndPeriod } from '../cycles/cycle-period.domain.js';
import type { ReportV2Filters } from './report-v2.dto.js';
import type { FactRow } from './report-v2.repository.js';

export type Resolve = (date: string) => CycleAndPeriod;

export type PeriodRange = { start: string; end: string; source: 'STORED' | 'SETTINGS_AT' };

export type LimitPeriodRow = {
  periodId: string;
  envelopeId: string;
  envelopeName: string;
  archived: boolean;
  startsOn: string;
  endsOn: string;
  targetMinor: bigint | null;
  targetStatus: 'UNSET' | 'DRAFT' | 'CONFIRMED';
};

export type EnvelopeLimitRow = {
  periodId: string;
  periodStart: string;
  periodEnd: string;
  isCurrent: boolean;
  envelopeId: string;
  envelopeName: string;
  targetMinor: string | null;
  targetStatus: 'UNSET' | 'DRAFT' | 'CONFIRMED';
  spentMinor: string;
  remainingMinor: string | null;
  overspentMinor: string;
  spentPermille: number | null;
};

export type PeriodComparisonRow = {
  asOf: string;
  periodStart: string;
  periodEnd: string;
  daysElapsed: number;
  spentMinor: string;
  limitTotalMinor: string | null;
  spentOfLimitPermille: number | null;
  previousPeriodStart: string;
  previousPeriodEnd: string;
  previousSameDaySpentMinor: string;
  previousTotalSpentMinor: string;
  deltaMinor: string;
  deltaBasisPoints: number | null;
};

const DAY_MS = 86_400_000;

export function addDays(date: string, days: number): string {
  return new Date(new Date(`${date}T00:00:00.000Z`).getTime() + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

function daysBetween(start: string, end: string): number {
  return (
    (new Date(`${end}T00:00:00.000Z`).getTime() - new Date(`${start}T00:00:00.000Z`).getTime()) /
    DAY_MS
  );
}

/**
 * Period containing `date`: a stored envelope_periods range (latest start wins when ranges
 * overlap), else the period of the cycle settings in force that day. Shared by expenses-by-period
 * and period-comparison so history is never re-sliced by current settings.
 */
export function periodRangeFor(
  date: string,
  stored: Array<{ start: string; end: string }>,
  resolve: Resolve,
): PeriodRange {
  let range: PeriodRange | undefined;
  for (const candidate of stored) {
    if (candidate.start <= date && date <= candidate.end) {
      range = { start: candidate.start, end: candidate.end, source: 'STORED' };
    }
  }
  if (range) return range;
  const { period } = resolve(date);
  return { start: period.start, end: period.end, source: 'SETTINGS_AT' };
}

export function withShareBasisPoints<T extends { expenseMinor: string }>(
  rows: T[],
): Array<T & { shareBasisPoints: number }> {
  const total = rows.reduce((sum, row) => sum + BigInt(row.expenseMinor), 0n);
  return rows.map((row) => ({
    ...row,
    shareBasisPoints: total === 0n ? 0 : Number((BigInt(row.expenseMinor) * 10_000n) / total),
  }));
}

export function envelopeLimitRows(
  periods: LimitPeriodRow[],
  spentByPeriod: Map<string, bigint>,
  today: string,
): EnvelopeLimitRow[] {
  const rows: EnvelopeLimitRow[] = [];
  for (const period of periods) {
    const spent = spentByPeriod.get(period.periodId) ?? 0n;
    const isCurrent = period.startsOn <= today && today <= period.endsOn;
    if (period.archived && spent === 0n && !isCurrent) continue;
    const target = period.targetStatus === 'UNSET' ? null : period.targetMinor;
    rows.push({
      periodId: period.periodId,
      periodStart: period.startsOn,
      periodEnd: period.endsOn,
      isCurrent,
      envelopeId: period.envelopeId,
      envelopeName: period.envelopeName,
      targetMinor: target === null ? null : formatMinorUnits(target),
      targetStatus: period.targetStatus,
      spentMinor: formatMinorUnits(spent),
      remainingMinor: target === null ? null : formatMinorUnits(target - spent),
      overspentMinor: formatMinorUnits(target !== null && spent > target ? spent - target : 0n),
      spentPermille: target === null || target === 0n ? null : Number((spent * 1000n) / target),
    });
  }
  return rows.sort(
    (left, right) =>
      right.periodStart.localeCompare(left.periodStart) ||
      left.envelopeName.localeCompare(right.envelopeName, 'ru') ||
      left.envelopeId.localeCompare(right.envelopeId),
  );
}

export function periodComparisonRow(input: {
  asOf: string;
  current: PeriodRange;
  previous: PeriodRange;
  facts: FactRow[];
  limitTotalMinor: bigint | null;
}): PeriodComparisonRow {
  const { asOf, current, previous, facts, limitTotalMinor } = input;
  const daysElapsed = daysBetween(current.start, asOf) + 1;
  const sameDayCandidate = addDays(previous.start, daysElapsed - 1);
  const sameDayEnd = sameDayCandidate < previous.end ? sameDayCandidate : previous.end;
  let spent = 0n;
  let previousSameDay = 0n;
  let previousTotal = 0n;
  for (const fact of facts) {
    if (fact.transactionType !== 'EXPENSE') continue;
    const day = fact.occurredOn;
    if (current.start <= day && day <= asOf) spent += fact.amountMinor;
    if (previous.start <= day && day <= previous.end) {
      previousTotal += fact.amountMinor;
      if (day <= sameDayEnd) previousSameDay += fact.amountMinor;
    }
  }
  const delta = spent - previousSameDay;
  return {
    asOf,
    periodStart: current.start,
    periodEnd: current.end,
    daysElapsed,
    spentMinor: formatMinorUnits(spent),
    limitTotalMinor: limitTotalMinor === null ? null : formatMinorUnits(limitTotalMinor),
    spentOfLimitPermille:
      limitTotalMinor === null || limitTotalMinor === 0n
        ? null
        : Number((spent * 1000n) / limitTotalMinor),
    previousPeriodStart: previous.start,
    previousPeriodEnd: previous.end,
    previousSameDaySpentMinor: formatMinorUnits(previousSameDay),
    previousTotalSpentMinor: formatMinorUnits(previousTotal),
    deltaMinor: formatMinorUnits(delta),
    deltaBasisPoints: previousSameDay === 0n ? null : Number((delta * 10_000n) / previousSameDay),
  };
}

/** Keys with a restricted filter set; keys not listed accept every filter. */
export const REPORT_ALLOWED_FILTERS: Partial<
  Record<string, ReadonlyArray<keyof ReportV2Filters>>
> = {
  'envelope-limits': ['from', 'to', 'envelopeId'],
  'period-comparison': ['to'],
};

export function assertFiltersAllowed(key: string, filters: ReportV2Filters): void {
  const allowed = REPORT_ALLOWED_FILTERS[key];
  if (!allowed) return;
  const rejected = (Object.keys(filters) as Array<keyof ReportV2Filters>).filter(
    (name) => filters[name] !== undefined && !allowed.includes(name),
  );
  if (rejected.length === 0) return;
  throw new BadRequestException({
    code: 'VALIDATION_FAILED',
    detail: 'Этот фильтр не применяется к выбранному отчёту.',
    fieldErrors: rejected.map((field) => ({
      field,
      message: 'Фильтр не применяется к этому отчёту.',
      code: 'unrecognized',
    })),
  });
}
```

В `report-v2.application.service.ts` заменить тело `expensesByPeriod` на вызов `periodRangeFor` и удалить локальный `type Resolve` (импортировать из `report-v2-insights.js`):

```ts
function expensesByPeriod(
  facts: FactRow[],
  stored: Array<{ start: string; end: string }>,
  resolve: Resolve,
) {
  const grouped = new Map<string, PeriodRange & { amountMinor: bigint }>();
  for (const fact of facts) {
    if (fact.transactionType !== 'EXPENSE') continue;
    const range = periodRangeFor(fact.occurredOn, stored, resolve);
    const id = `${range.start}:${range.end}`;
    const current = grouped.get(id) ?? { ...range, amountMinor: 0n };
    current.amountMinor += fact.amountMinor;
    grouped.set(id, current);
  }
  // sort and map — без изменений
}
```

Комментарий над `expensesByPeriod` про приоритет сохранённых границ переносится в `periodRangeFor` (уже есть выше), над `expensesByPeriod` остаётся одна строка: `/** History is grouped by periodRangeFor: stored boundaries first, then settings in force. */`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @harmofin/api exec vitest run src/reports/report-v2-insights.test.ts`
Expected: PASS.
Run: `pnpm --filter @harmofin/api typecheck`
Expected: без ошибок.

- [ ] **Step 5: Commit (только с одобрения владельца)**

```bash
git add apps/api/src/reports/report-v2-insights.ts apps/api/src/reports/report-v2-insights.test.ts apps/api/src/reports/report-v2.application.service.ts
git commit -m "feat(api): чистые функции отчётов лимитов и сравнения периодов"
```

---

### Task 2: Отчёты `envelope-limits`, `period-comparison` и доли категорий (API)

**Files:**
- Modify: `apps/api/src/reports/report-v2.dto.ts`
- Modify: `apps/api/src/reports/report-v2.controller.ts`
- Modify: `apps/api/src/reports/report-v2.repository.ts`
- Modify: `apps/api/src/reports/report-v2.application.service.ts`
- Modify: `apps/api/src/reports/report-v2-insights.ts` (тип `REPORT_ALLOWED_FILTERS` → `Partial<Record<ReportV2Key, …>>`)
- Test: `apps/api/test/v2-reports.integration.test.ts`
- Regenerate: `openapi.json`

**Interfaces:**
- Consumes: всё из Task 1.
- Produces (HTTP, `GET /api/v2/budgets/{budgetId}/reports/{key}`):
  - `envelope-limits` → `{ key, rows: EnvelopeLimitRow[] }` (поля как в Task 1).
  - `period-comparison` → `{ key, rows: [PeriodComparisonRow] }`.
  - `expenses-by-category` строки получают `shareBasisPoints: number`.
- Produces (repository): `limitPeriods(tx, budgetId, range: { endsOnGte?: string; startsOnLte: string; envelopeId?: string }): Promise<LimitPeriodRow[]>`.

- [ ] **Step 1: Write the failing integration tests**

В `apps/api/test/v2-reports.integration.test.ts`:

1. Добавить хелпер рядом с `addPeriod`:

```ts
async function addLimitPeriod(
  w: World,
  envelopeId: string,
  start: string,
  end: string,
  targetMinor: bigint | null,
  targetStatus: 'UNSET' | 'DRAFT' | 'CONFIRMED' = 'CONFIRMED',
): Promise<string> {
  const id = randomUUID();
  await prisma.envelopePeriod.create({
    data: {
      id,
      budgetId: w.budgetId,
      envelopeId,
      startsOn: day(start),
      endsOn: day(end),
      targetStatus,
      targetMinor,
      ...(targetStatus === 'CONFIRMED'
        ? { confirmedByUserId: w.userId, confirmedAt: new Date() }
        : {}),
    },
  });
  return id;
}
```

2. Дополнить `ALL_KEYS` значениями `'envelope-limits'`, `'period-comparison'` и добавить рядом:

```ts
const DISALLOWED_FILTERS: Record<string, string[]> = {
  'envelope-limits': ['accountId', 'categoryId'],
  'period-comparison': ['accountId', 'categoryId', 'envelopeId'],
};
```

В тесте «404 на чужой/несуществующий categoryId, accountId, envelopeId для всех ключей» внутри цикла перед запросом:

```ts
const filterName = query.slice(1, query.indexOf('='));
if (DISALLOWED_FILTERS[key]?.includes(filterName)) continue;
```

Заголовок теста «изоляция: данные бюджета B не попадают ни в один из 9 отчётов бюджета A» → «…ни в один отчёт бюджета A».

3. Новый `describe`:

```ts
describe('v2 reports: аналитика', () => {
  it('envelope-limits: лимит, перерасход, без лимита; только конверты на текущие траты и v2-расходы', async () => {
    const w = await world();
    const march = await addLimitPeriod(w, w.mainEnvelopeId, '2026-03-01', '2026-03-14', 1_000_000n);
    const unset = await addLimitPeriod(w, w.mainEnvelopeId, '2026-03-15', '2026-03-31', null, 'UNSET');
    await addLimitPeriod(w, w.mandatoryEnvelopeId, '2026-03-01', '2026-03-14', 5_000n);
    await expense(w, w.mainEnvelopeId, 1_200_000n, '2026-03-05');
    await expense(w, w.mainEnvelopeId, 70_000n, '2026-03-20');
    await expense(w, w.mainEnvelopeId, 900_000n, '2026-03-06', { status: 'DRAFT' });
    await expense(w, w.mainEnvelopeId, 900_000n, '2026-03-07', { modelVersion: 1 });

    const list = await rows(w, 'envelope-limits', '?from=2026-03-01&to=2026-03-31');
    expect(list.map((row) => row.periodId)).toEqual([unset, march]);
    expect(list[1]).toMatchObject({
      envelopeId: w.mainEnvelopeId,
      envelopeName: 'Текущий',
      targetMinor: '1000000',
      targetStatus: 'CONFIRMED',
      spentMinor: '1200000',
      remainingMinor: '-200000',
      overspentMinor: '200000',
      spentPermille: 1200,
      isCurrent: false,
    });
    expect(list[0]).toMatchObject({
      targetMinor: null,
      spentMinor: '70000',
      remainingMinor: null,
      spentPermille: null,
    });
  });

  it('envelope-limits: «потрачено» совпадает со страницей конвертов', async () => {
    const w = await world();
    const periodId = await addLimitPeriod(w, w.mainEnvelopeId, '2026-03-01', '2026-03-14', 500_000n);
    await expense(w, w.mainEnvelopeId, 123_400n, '2026-03-05');
    const [limit] = await rows(w, 'envelope-limits', '?from=2026-03-01&to=2026-03-14');
    const envelopes = await server.inject({
      method: 'GET',
      url: `/api/v2/budgets/${w.budgetId}/envelopes`,
      headers: { origin, cookie: `harmofin_session=${w.cookie}` },
    });
    const main = envelopes
      .json<{ items: Array<{ id: string; periods?: Array<{ periodId: string; spentMinor: string }> }> }>()
      .items.find((item) => item.id === w.mainEnvelopeId);
    const period = main?.periods?.find((item) => item.periodId === periodId);
    expect(period?.spentMinor).toBe('123400');
    expect(limit?.spentMinor).toBe(period?.spentMinor);
  });

  it('envelope-limits: текущий период отмечен isCurrent, будущие периоды не попадают', async () => {
    const w = await world();
    const today = new Date().toISOString().slice(0, 10);
    const current = await addLimitPeriod(w, w.mainEnvelopeId, today, today, 1n);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    await addLimitPeriod(w, w.mainEnvelopeId, tomorrow, tomorrow, 1n);
    const list = await rows(w, 'envelope-limits');
    expect(list.map((row) => [row.periodId, row.isCurrent])).toEqual([[current, true]]);
  });

  it('period-comparison: то же число дней прошлого периода, лимит текущего периода', async () => {
    const w = await world();
    await addLimitPeriod(w, w.mainEnvelopeId, '2026-03-01', '2026-03-14', 0n);
    await addLimitPeriod(w, w.mainEnvelopeId, '2026-03-15', '2026-03-31', 500_000n);
    await expense(w, w.mainEnvelopeId, 100_000n, '2026-03-03');
    await expense(w, w.mainEnvelopeId, 50_000n, '2026-03-10');
    await expense(w, null, 80_000n, '2026-03-16');
    await expense(w, w.mainEnvelopeId, 999n, '2026-03-25');
    await expense(w, w.mainEnvelopeId, 5_000n, '2026-03-17', { status: 'DELETED' });

    const [row] = await rows(w, 'period-comparison', '?to=2026-03-20');
    expect(row).toEqual({
      asOf: '2026-03-20',
      periodStart: '2026-03-15',
      periodEnd: '2026-03-31',
      daysElapsed: 6,
      spentMinor: '80000',
      limitTotalMinor: '500000',
      spentOfLimitPermille: 160,
      previousPeriodStart: '2026-03-01',
      previousPeriodEnd: '2026-03-14',
      previousSameDaySpentMinor: '100000',
      previousTotalSpentMinor: '150000',
      deltaMinor: '-20000',
      deltaBasisPoints: -2000,
    });
  });

  it('period-comparison: пустой прошлый период и нет лимитов', async () => {
    const w = await world();
    await expense(w, w.mainEnvelopeId, 10_000n, '2026-03-16');
    const [row] = await rows(w, 'period-comparison', '?to=2026-03-20');
    expect(row).toMatchObject({
      periodStart: '2026-03-15',
      previousPeriodStart: '2026-03-01',
      previousSameDaySpentMinor: '0',
      deltaBasisPoints: null,
      limitTotalMinor: null,
    });
  });

  it('неприменимые фильтры новых ключей дают 400 VALIDATION_FAILED', async () => {
    const w = await world();
    for (const [key, query] of [
      ['period-comparison', '?from=2026-03-01'],
      ['period-comparison', `?accountId=${w.accountId}`],
      ['period-comparison', `?envelopeId=${w.mainEnvelopeId}`],
      ['envelope-limits', `?categoryId=${w.categoryId}`],
      ['envelope-limits', `?accountId=${w.accountId}`],
    ] as const) {
      const response = await get(w, key, query);
      expect(response.statusCode, `${key}${query}`).toBe(400);
      expect(response.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
    }
  });

  it('expenses-by-category: доля категории в базисных пунктах', async () => {
    const w = await world();
    await expense(w, null, 300_000n, '2026-03-05');
    await expense(w, null, 100_000n, '2026-03-05', { categoryId: w.otherCategoryId });
    const list = await rows(w, 'expenses-by-category');
    expect(list.map((row) => [row.categoryId, row.shareBasisPoints])).toEqual([
      [w.categoryId, 7500],
      [w.otherCategoryId, 2500],
    ]);
  });
});
```

4. В тесте «OpenAPI: обязательные поля строк и денежные поля-строки» дополнить `expectations`:

```ts
ReportV2EnvelopeLimitRow: {
  required: ['periodId', 'envelopeId', 'spentMinor', 'overspentMinor', 'isCurrent'],
  money: ['spentMinor', 'overspentMinor'],
},
ReportV2PeriodComparisonRow: {
  required: ['asOf', 'periodStart', 'spentMinor', 'deltaMinor', 'previousSameDaySpentMinor'],
  money: ['spentMinor', 'deltaMinor', 'previousSameDaySpentMinor', 'previousTotalSpentMinor'],
},
```

- [ ] **Step 2: Run tests to verify they fail**

Run (локальная БД поднята `pnpm infra:up`): `pnpm --filter @harmofin/api exec vitest run --config vitest.integration.config.ts test/v2-reports.integration.test.ts`
Expected: FAIL — новые ключи дают 400 (неизвестный key), нет `shareBasisPoints`, OpenAPI без новых схем.

- [ ] **Step 3: DTO и контроллер**

`report-v2.dto.ts`: в `reportV2Keys` после `'assignment-movements'` добавить `'envelope-limits'`, `'period-comparison'`. В `ReportV2ExpenseByCategoryRow` после `expenseMinor`:

```ts
  @ApiProperty({
    type: Number,
    description: 'Доля категории от суммы расходов ответа в базисных пунктах (0..10000), округление к нулю.',
  })
  shareBasisPoints!: number;
```

В конец файла:

```ts
export class ReportV2EnvelopeLimitRow {
  @ApiProperty({ type: String, format: 'uuid' })
  periodId!: string;

  @ApiProperty({ type: String, format: 'date' })
  periodStart!: string;

  @ApiProperty({ type: String, format: 'date' })
  periodEnd!: string;

  @ApiProperty({ type: Boolean, description: 'Период содержит сегодня в часовом поясе бюджета.' })
  isCurrent!: boolean;

  @ApiProperty({ type: String, format: 'uuid' })
  envelopeId!: string;

  @ApiProperty({ type: String })
  envelopeName!: string;

  @ApiProperty({ type: String, pattern: MONEY, nullable: true, description: 'null, если лимит не задан.' })
  targetMinor!: string | null;

  @ApiProperty({ type: String, enum: ['UNSET', 'DRAFT', 'CONFIRMED'] })
  targetStatus!: 'UNSET' | 'DRAFT' | 'CONFIRMED';

  @ApiProperty({ type: String, pattern: MONEY })
  spentMinor!: string;

  @ApiProperty({ type: String, pattern: MONEY, nullable: true, description: 'Лимит минус потрачено; может быть отрицательным.' })
  remainingMinor!: string | null;

  @ApiProperty({ type: String, pattern: MONEY })
  overspentMinor!: string;

  @ApiProperty({ type: Number, nullable: true, description: 'Потрачено × 1000 / лимит; больше 1000 при перерасходе.' })
  spentPermille!: number | null;
}

export class ReportV2EnvelopeLimitsResponse {
  @ApiProperty({ type: String, enum: ['envelope-limits'] })
  key!: 'envelope-limits';

  @ApiProperty({ type: [ReportV2EnvelopeLimitRow] })
  rows!: ReportV2EnvelopeLimitRow[];
}

export class ReportV2PeriodComparisonRow {
  @ApiProperty({ type: String, format: 'date', description: 'День расчёта: to или сегодня.' })
  asOf!: string;

  @ApiProperty({ type: String, format: 'date' })
  periodStart!: string;

  @ApiProperty({ type: String, format: 'date' })
  periodEnd!: string;

  @ApiProperty({ type: Number })
  daysElapsed!: number;

  @ApiProperty({ type: String, pattern: MONEY })
  spentMinor!: string;

  @ApiProperty({ type: String, pattern: MONEY, nullable: true })
  limitTotalMinor!: string | null;

  @ApiProperty({ type: Number, nullable: true })
  spentOfLimitPermille!: number | null;

  @ApiProperty({ type: String, format: 'date' })
  previousPeriodStart!: string;

  @ApiProperty({ type: String, format: 'date' })
  previousPeriodEnd!: string;

  @ApiProperty({ type: String, pattern: MONEY })
  previousSameDaySpentMinor!: string;

  @ApiProperty({ type: String, pattern: MONEY })
  previousTotalSpentMinor!: string;

  @ApiProperty({ type: String, pattern: MONEY })
  deltaMinor!: string;

  @ApiProperty({ type: Number, nullable: true, description: 'null, если в прошлом периоде к этому дню расходов не было.' })
  deltaBasisPoints!: number | null;
}

export class ReportV2PeriodComparisonResponse {
  @ApiProperty({ type: String, enum: ['period-comparison'] })
  key!: 'period-comparison';

  @ApiProperty({ type: [ReportV2PeriodComparisonRow] })
  rows!: ReportV2PeriodComparisonRow[];
}
```

`report-v2.controller.ts`: импортировать и добавить в `RESPONSES` `ReportV2EnvelopeLimitsResponse`, `ReportV2PeriodComparisonResponse`. В `description` `@ApiOperation` дописать: `envelope-limits принимает только from, to, envelopeId; period-comparison — только to (день расчёта); другие фильтры этих ключей дают 400 VALIDATION_FAILED.` В описание ответа 400: `VALIDATION_FAILED: неизвестный key, некорректные или неприменимые к ключу параметры.`

`report-v2-insights.ts`: тип `REPORT_ALLOWED_FILTERS` → `Partial<Record<ReportV2Key, ReadonlyArray<keyof ReportV2Filters>>>`, параметр `assertFiltersAllowed(key: ReportV2Key, …)`.

- [ ] **Step 4: Репозиторий**

В `report-v2.repository.ts` импортировать `type LimitPeriodRow` из `./report-v2-insights.js` и добавить метод:

```ts
  /**
   * Period rows of CURRENT_EXPENSES envelopes that started on or before `startsOnLte` and end on or
   * after `endsOnGte`. Budget is filtered on both the period and its envelope.
   */
  async limitPeriods(
    tx: Prisma.TransactionClient,
    budgetId: string,
    range: { endsOnGte?: string; startsOnLte: string; envelopeId?: string },
  ): Promise<LimitPeriodRow[]> {
    const rows = await tx.envelopePeriod.findMany({
      where: {
        budgetId,
        startsOn: { lte: dateValue(range.startsOnLte) },
        ...(range.endsOnGte ? { endsOn: { gte: dateValue(range.endsOnGte) } } : {}),
        envelope: {
          budgetId,
          envelopeType: 'CURRENT_EXPENSES',
          ...(range.envelopeId ? { id: range.envelopeId } : {}),
        },
      },
      select: {
        id: true,
        envelopeId: true,
        startsOn: true,
        endsOn: true,
        targetMinor: true,
        targetStatus: true,
        envelope: { select: { name: true, archivedAt: true } },
      },
      orderBy: [{ startsOn: 'desc' }, { id: 'asc' }],
    });
    return rows.map((row) => ({
      periodId: row.id,
      envelopeId: row.envelopeId,
      envelopeName: row.envelope.name,
      archived: row.envelope.archivedAt !== null,
      startsOn: dateText(row.startsOn),
      endsOn: dateText(row.endsOn),
      targetMinor: row.targetMinor,
      targetStatus: row.targetStatus,
    }));
  }
```

- [ ] **Step 5: Сервис**

В `report-v2.application.service.ts`:

```ts
import { AssignmentBalanceRepository } from '../envelope-plans/assignment-balance.repository.js';
import {
  addDays,
  assertFiltersAllowed,
  envelopeLimitRows,
  periodComparisonRow,
  periodRangeFor,
  withShareBasisPoints,
  type PeriodRange,
  type Resolve,
} from './report-v2-insights.js';
```

В классе поле (тот же приём, что в `EnvelopePlanApplicationService`):

```ts
  private readonly balances = new AssignmentBalanceRepository();
```

В `get()` первой строкой: `assertFiltersAllowed(key, filters);`

`rows()` получает доступ к `this.balances`, поэтому остаётся методом класса. После ветки `assignment-movements` добавить:

```ts
    if (key === 'envelope-limits') {
      const dated = filters.from !== undefined || filters.to !== undefined;
      const startsOnLte = filters.to !== undefined && filters.to < today ? filters.to : today;
      const periods = await repo.limitPeriods(tx, budgetId, {
        endsOnGte: dated ? filters.from : addDays(today, -365),
        startsOnLte,
        ...(filters.envelopeId ? { envelopeId: filters.envelopeId } : {}),
      });
      // Same spending rule as the envelopes page and dashboard (v2 expenses inside the period).
      const balances = await this.balances.allBalances(tx, budgetId, new Date());
      const spent = new Map<string, bigint>();
      for (const row of balances) if (row.periodId !== null) spent.set(row.periodId, row.spent);
      return envelopeLimitRows(periods, spent, today);
    }
    if (key === 'period-comparison') {
      const stored = await repo.storedPeriodRanges(tx, budgetId);
      const resolve = cycleResolver(await repo.cycleRevisions(tx, budgetId), budget);
      const current = periodRangeFor(asOf, stored, resolve);
      const previous = periodRangeFor(addDays(current.start, -1), stored, resolve);
      const facts = await repo.facts(tx, userId, budgetId, { from: previous.start, to: asOf });
      const limits = (await repo.limitPeriods(tx, budgetId, { endsOnGte: asOf, startsOnLte: asOf }))
        .filter((row) => !row.archived && row.targetStatus === 'CONFIRMED' && row.targetMinor !== null);
      const limitTotal =
        limits.length === 0 ? null : limits.reduce((sum, row) => sum + (row.targetMinor ?? 0n), 0n);
      return [periodComparisonRow({ asOf, current, previous, facts, limitTotalMinor: limitTotal })];
    }
```

Заменить `if (key === 'expenses-by-category') return expensesByCategory(facts);` на `return withShareBasisPoints(expensesByCategory(facts));`. Удалить неиспользуемый импорт `PeriodRange`, если линтер его отметит.

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @harmofin/api exec vitest run --config vitest.integration.config.ts test/v2-reports.integration.test.ts`
Expected: PASS, включая старые тесты (`expenses-by-period` после рефакторинга Task 1).
Run: `pnpm --filter @harmofin/api exec vitest run src/reports`
Expected: PASS.

- [ ] **Step 7: Regenerate OpenAPI и проверить контракт**

Run: `pnpm --filter @harmofin/api build && node scripts/openapi/generate.mjs`
Expected: `openapi.json` изменён только в схемах отчётов (новые `ReportV2EnvelopeLimit*`, `ReportV2PeriodComparison*`, `shareBasisPoints`, enum `key`, описания).
Run: `git diff --stat openapi.json` и `pnpm --filter @harmofin/api exec vitest run --config vitest.integration.config.ts test/v2-openapi.integration.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit (только с одобрения владельца)**

```bash
git add apps/api/src/reports apps/api/test/v2-reports.integration.test.ts openapi.json
git commit -m "feat(api): отчёты лимитов конвертов и сравнения с прошлым периодом"
```

---

### Task 3: Типы отчётов, загрузка, вкладки и токены графиков (web)

**Files:**
- Modify: `apps/web/app/composables/useEnvelopePlanV2.ts`, `useEnvelopePlanV2.test.ts`
- Create: `apps/web/app/composables/useAnalyticsReport.ts`, `useAnalyticsReport.test.ts`
- Create: `apps/web/app/components/analytics/journal-href.ts`, `journal-href.test.ts`
- Create: `apps/web/app/components/analytics/period-label.ts`, `period-label.test.ts`
- Modify: `apps/web/app/components/analytics/ReportTable.vue` (импорт `journalHref`)
- Create: `apps/web/app/components/ui/Tabs.vue`, `Tabs.test.ts`
- Modify: `apps/web/app/assets/styles/tokens.css`

**Interfaces:**
- Produces:
  - `REPORT_V2_KEYS` + `'envelope-limits'`, `'period-comparison'`.
  - Типы `ExpenseByCategoryV2Row`, `ExpenseByPeriodV2Row`, `NetCashFlowV2Row`, `AccountBalanceV2Row`, `EnvelopeLimitV2Row`, `PeriodComparisonV2Row`, `ReportV2RowMap` (ключ → тип строки).
  - `useAnalyticsReport<K extends ReportV2Key>(key: K): { rows: ShallowRef<ReportV2RowMap[K][]>; loading: Ref<boolean>; error: Ref<string>; load(budgetId: string, filters?: ReportV2Filters): Promise<void> }`.
  - `journalHref(row: Record<string, unknown>): string`.
  - `periodLabel(start: string, end: string): string` → `'01.03–14.03'`.
  - `<UiTabs :tabs="{ id, label }[]" v-model="id" label="…">` с default-слотом панели.
  - CSS: `--hf-color-chart-1…5`, `--hf-color-chart-rest`, `--hf-color-chart-track`.

- [ ] **Step 1: Write the failing tests**

`useEnvelopePlanV2.test.ts` — в существующем ожидании `REPORT_V2_KEYS` дописать `'envelope-limits', 'period-comparison'` в конец массива.

`apps/web/app/composables/useAnalyticsReport.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const v2 = { getReport: vi.fn() };
vi.mock('./useEnvelopePlanV2.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useEnvelopePlanV2: () => v2,
}));

import { useAnalyticsReport } from './useAnalyticsReport.js';

describe('useAnalyticsReport', () => {
  beforeEach(() => vi.clearAllMocks());

  it('загружает строки ключа с фильтрами', async () => {
    v2.getReport.mockResolvedValue({ key: 'expenses-by-category', rows: [{ categoryId: 'c' }] });
    const report = useAnalyticsReport('expenses-by-category');
    await report.load('budget-id', { from: '2026-03-01' });
    expect(v2.getReport).toHaveBeenCalledWith('budget-id', 'expenses-by-category', {
      from: '2026-03-01',
    });
    expect(report.rows.value).toEqual([{ categoryId: 'c' }]);
    expect(report.loading.value).toBe(false);
    expect(report.error.value).toBe('');
  });

  it('ошибка даёт текст и пустые строки', async () => {
    v2.getReport.mockRejectedValue(new Error('boom'));
    const report = useAnalyticsReport('net-cash-flow');
    await report.load('budget-id');
    expect(report.error.value).toBe('Не удалось загрузить отчёт.');
    expect(report.rows.value).toEqual([]);
  });

  it('устаревший ответ не перетирает новый', async () => {
    let resolveFirst: (value: unknown) => void = () => undefined;
    v2.getReport
      .mockReturnValueOnce(new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce({ key: 'net-cash-flow', rows: [{ cycleStart: 'new' }] });
    const report = useAnalyticsReport('net-cash-flow');
    const first = report.load('budget-id', { from: '2026-01-01' });
    await report.load('budget-id', { from: '2026-02-01' });
    resolveFirst({ key: 'net-cash-flow', rows: [{ cycleStart: 'old' }] });
    await first;
    expect(report.rows.value).toEqual([{ cycleStart: 'new' }]);
  });
});
```

`apps/web/app/components/analytics/journal-href.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { journalHref } from './journal-href.js';

describe('journalHref', () => {
  it('строит ссылку в журнал из строковых journalFilters', () => {
    expect(journalHref({ journalFilters: { categoryId: 'c', type: 'EXPENSE', skip: 1 } })).toBe(
      '/app/operations?categoryId=c&type=EXPENSE',
    );
  });

  it('без фильтров — журнал целиком', () => {
    expect(journalHref({})).toBe('/app/operations');
  });
});
```

`apps/web/app/components/analytics/period-label.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { periodLabel } from './period-label.js';

describe('periodLabel', () => {
  it('день.месяц–день.месяц', () => {
    expect(periodLabel('2026-03-01', '2026-03-14')).toBe('01.03–14.03');
  });
});
```

`apps/web/app/components/ui/Tabs.test.ts`:

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import UiTabs from './Tabs.vue';

const tabs = [
  { id: 'a', label: 'Обзор' },
  { id: 'b', label: 'Расходы' },
  { id: 'c', label: 'Конверты' },
];

describe('UiTabs', () => {
  it('отмечает активную вкладку и связывает её с панелью', () => {
    const wrapper = mount(UiTabs, {
      props: { tabs, modelValue: 'b', label: 'Разделы' },
      slots: { default: '<p>панель</p>' },
    });
    const selected = wrapper.get('[role="tab"][aria-selected="true"]');
    expect(selected.text()).toBe('Расходы');
    expect(selected.attributes('tabindex')).toBe('0');
    const panel = wrapper.get('[role="tabpanel"]');
    expect(panel.attributes('aria-labelledby')).toBe(selected.attributes('id'));
    expect(selected.attributes('aria-controls')).toBe(panel.attributes('id'));
    expect(wrapper.findAll('[role="tab"][tabindex="-1"]')).toHaveLength(2);
  });

  it('стрелки, Home и End переключают вкладки по кругу', async () => {
    const wrapper = mount(UiTabs, {
      props: { tabs, modelValue: 'a', label: 'Разделы' },
      attachTo: document.body,
    });
    const list = wrapper.get('[role="tablist"]');
    await list.trigger('keydown', { key: 'ArrowLeft' });
    await list.trigger('keydown', { key: 'ArrowRight' });
    await list.trigger('keydown', { key: 'End' });
    await list.trigger('keydown', { key: 'Home' });
    expect(wrapper.emitted('update:modelValue')).toEqual([['c'], ['b'], ['c'], ['a']]);
    wrapper.unmount();
  });

  it('клик выбирает вкладку', async () => {
    const wrapper = mount(UiTabs, { props: { tabs, modelValue: 'a', label: 'Разделы' } });
    await wrapper.findAll('[role="tab"]')[2]!.trigger('click');
    expect(wrapper.emitted('update:modelValue')).toEqual([['c']]);
  });
});
```

Тест «стрелки» ожидает `['b']` после `ArrowRight`, потому что `modelValue` в тесте не обновляется (остаётся `'a'`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @harmofin/web exec vitest run app/composables/useAnalyticsReport.test.ts app/components/analytics/journal-href.test.ts app/components/analytics/period-label.test.ts app/components/ui/Tabs.test.ts app/composables/useEnvelopePlanV2.test.ts`
Expected: FAIL — модулей нет, ключи не совпадают.

- [ ] **Step 3: Implement**

`useEnvelopePlanV2.ts` — `REPORT_V2_KEYS` дописать `'envelope-limits', 'period-comparison'`; после `SavingsGoalV2Row` добавить:

```ts
export interface ExpenseByCategoryV2Row {
  categoryId: string;
  categoryName: string;
  expenseMinor: string;
  /** Server share of the response total, 0..10000. */
  shareBasisPoints: number;
  journalFilters: Record<string, string>;
}

export interface ExpenseByPeriodV2Row {
  periodStart: string;
  periodEnd: string;
  boundarySource: 'STORED' | 'SETTINGS_AT';
  expenseMinor: string;
  journalFilters: Record<string, string>;
}

export interface NetCashFlowV2Row {
  cycleStart: string;
  cycleEnd: string;
  incomeMinor: string;
  expenseMinor: string;
  netCashFlowMinor: string;
  journalFilters: Record<string, string>;
}

export interface AccountBalanceV2Row {
  accountId: string;
  name: string;
  balanceMinor: string;
  asOf: string;
}

export interface EnvelopeLimitV2Row {
  periodId: string;
  periodStart: string;
  periodEnd: string;
  isCurrent: boolean;
  envelopeId: string;
  envelopeName: string;
  targetMinor: string | null;
  targetStatus: 'UNSET' | 'DRAFT' | 'CONFIRMED';
  spentMinor: string;
  remainingMinor: string | null;
  overspentMinor: string;
  spentPermille: number | null;
}

export interface PeriodComparisonV2Row {
  asOf: string;
  periodStart: string;
  periodEnd: string;
  daysElapsed: number;
  spentMinor: string;
  limitTotalMinor: string | null;
  spentOfLimitPermille: number | null;
  previousPeriodStart: string;
  previousPeriodEnd: string;
  previousSameDaySpentMinor: string;
  previousTotalSpentMinor: string;
  deltaMinor: string;
  deltaBasisPoints: number | null;
}

export interface ReportV2RowMap {
  'account-balances': AccountBalanceV2Row;
  'expenses-by-category': ExpenseByCategoryV2Row;
  'expenses-by-period': ExpenseByPeriodV2Row;
  'expenses-by-cycle': Record<string, unknown>;
  'incomes-by-cycle': Record<string, unknown>;
  'net-cash-flow': NetCashFlowV2Row;
  'savings-goals': SavingsGoalV2Row;
  'plan-vs-actual': PlanVsActualRowDto;
  'assignment-movements': Record<string, unknown>;
  'envelope-limits': EnvelopeLimitV2Row;
  'period-comparison': PeriodComparisonV2Row;
}
```

`PlanVsActualRowDto` импортировать как тип из `./useBudgetReferenceData.js` (если это создаёт цикл импорта — перенести объявление `PlanVsActualRowDto` нельзя; тогда описать строку `plan-vs-actual` как `Record<string, unknown>` и приводить в `CashFlowTab` к `PlanVsActualRowDto`). Проверка — `pnpm --filter @harmofin/web typecheck`.

`apps/web/app/composables/useAnalyticsReport.ts`:

```ts
import { ref, shallowRef } from 'vue';

import {
  type ReportV2Filters,
  type ReportV2Key,
  type ReportV2RowMap,
  useEnvelopePlanV2,
} from './useEnvelopePlanV2.js';

/** One report of the analytics page: server rows as-is, plus loading and error state. */
export function useAnalyticsReport<K extends ReportV2Key>(key: K) {
  const v2 = useEnvelopePlanV2();
  const rows = shallowRef<ReportV2RowMap[K][]>([]);
  const loading = ref(false);
  const error = ref('');
  let request = 0;

  async function load(budgetId: string, filters: ReportV2Filters = {}) {
    const current = ++request;
    loading.value = true;
    error.value = '';
    try {
      const response = await v2.getReport(budgetId, key, filters);
      if (current !== request) return;
      rows.value = response.rows as unknown as ReportV2RowMap[K][];
    } catch {
      if (current !== request) return;
      rows.value = [];
      error.value = 'Не удалось загрузить отчёт.';
    } finally {
      if (current === request) loading.value = false;
    }
  }

  return { rows, loading, error, load };
}
```

`apps/web/app/components/analytics/journal-href.ts` — перенести функцию из `ReportTable.vue` без изменений поведения:

```ts
/** Journal link for a report row; only string journalFilters become query parameters. */
export function journalHref(row: Record<string, unknown>): string {
  const filters = row.journalFilters;
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) return '/app/operations';
  const query = new URLSearchParams(
    Object.entries(filters as Record<string, unknown>)
      .filter(([, value]) => typeof value === 'string')
      .map(([name, value]) => [name, String(value)]),
  );
  return `/app/operations${query.size > 0 ? `?${query}` : ''}`;
}
```

В `ReportTable.vue` удалить локальную `journalHref` и добавить `import { journalHref } from './journal-href.js';`.

`apps/web/app/components/analytics/period-label.ts`:

```ts
/** "2026-03-01", "2026-03-14" → "01.03–14.03". Server dates, no time zone math. */
export function periodLabel(start: string, end: string): string {
  const short = (date: string) => `${date.slice(8, 10)}.${date.slice(5, 7)}`;
  return `${short(start)}–${short(end)}`;
}
```

`apps/web/app/components/ui/Tabs.vue`:

```vue
<script setup lang="ts">
import { nextTick, useId, useTemplateRef } from 'vue';

defineOptions({ name: 'UiTabs' });

const props = defineProps<{
  tabs: ReadonlyArray<{ id: string; label: string }>;
  modelValue: string;
  label: string;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
const baseId = useId();
const buttons = useTemplateRef<HTMLButtonElement[]>('buttons');

const tabId = (id: string) => `${baseId}-tab-${id}`;
const panelId = `${baseId}-panel`;

async function select(index: number) {
  const tab = props.tabs[index];
  if (!tab) return;
  emit('update:modelValue', tab.id);
  await nextTick();
  buttons.value?.[index]?.focus();
}

function onKeydown(event: KeyboardEvent) {
  const count = props.tabs.length;
  const current = Math.max(
    0,
    props.tabs.findIndex((tab) => tab.id === props.modelValue),
  );
  const next: Record<string, number> = {
    ArrowRight: (current + 1) % count,
    ArrowLeft: (current - 1 + count) % count,
    Home: 0,
    End: count - 1,
  };
  if (!(event.key in next)) return;
  event.preventDefault();
  void select(next[event.key]!);
}
</script>

<template>
  <div class="ui-tabs">
    <div class="ui-tabs__list" role="tablist" :aria-label="label" @keydown="onKeydown">
      <button
        v-for="(tab, index) in tabs"
        :id="tabId(tab.id)"
        ref="buttons"
        :key="tab.id"
        type="button"
        role="tab"
        class="ui-tabs__tab"
        :aria-selected="tab.id === modelValue ? 'true' : 'false'"
        :aria-controls="panelId"
        :tabindex="tab.id === modelValue ? 0 : -1"
        @click="select(index)"
      >
        {{ tab.label }}
      </button>
    </div>
    <div
      :id="panelId"
      class="ui-tabs__panel"
      role="tabpanel"
      tabindex="0"
      :aria-labelledby="tabId(modelValue)"
    >
      <slot />
    </div>
  </div>
</template>

<style scoped>
.ui-tabs {
  display: grid;
  gap: var(--hf-space-5);
}
.ui-tabs__list {
  display: flex;
  gap: var(--hf-space-1);
  overflow-x: auto;
  border-bottom: 1px solid var(--hf-color-border);
  scrollbar-width: thin;
}
.ui-tabs__tab {
  flex: 0 0 auto;
  min-height: var(--hf-control-height-sm);
  padding: 0 var(--hf-space-4);
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--hf-color-text-muted);
  font: inherit;
  font-weight: var(--hf-font-weight-medium);
  white-space: nowrap;
  cursor: pointer;
}
.ui-tabs__tab[aria-selected='true'] {
  border-bottom-color: var(--hf-color-action-primary);
  color: var(--hf-color-text);
}
.ui-tabs__tab:focus-visible,
.ui-tabs__panel:focus-visible {
  outline: 2px solid var(--hf-color-focus-ring);
  outline-offset: 2px;
}
</style>
```

`tokens.css` — в блоке `:root` после `--hf-color-overlay` добавить:

```css
  /* charts — references only; dark theme follows the overridden base tokens */
  --hf-color-chart-1: var(--hf-color-brand);
  --hf-color-chart-2: var(--hf-color-primary-bright);
  --hf-color-chart-3: var(--hf-color-primary-strong);
  --hf-color-chart-4: var(--hf-color-brand-active);
  --hf-color-chart-5: var(--hf-color-slate-500);
  --hf-color-chart-rest: var(--hf-color-slate-200);
  --hf-color-chart-track: var(--hf-color-surface-subtle);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: команда из Step 2 и `pnpm --filter @harmofin/web exec vitest run app/components/analytics/ReportTable.test.ts`
Expected: PASS.
Run: `pnpm --filter @harmofin/web typecheck`
Expected: без ошибок.

- [ ] **Step 5: Commit (только с одобрения владельца)**

```bash
git add apps/web/app/composables apps/web/app/components/analytics/journal-href.ts apps/web/app/components/analytics/journal-href.test.ts apps/web/app/components/analytics/period-label.ts apps/web/app/components/analytics/period-label.test.ts apps/web/app/components/analytics/ReportTable.vue apps/web/app/components/ui/Tabs.vue apps/web/app/components/ui/Tabs.test.ts apps/web/app/assets/styles/tokens.css
git commit -m "feat(web): типы новых отчётов, загрузка отчёта и вкладки"
```

---

### Task 4: Presentational SVG-графики (web)

**Files:**
- Create: `apps/web/app/components/analytics/charts/chart-scale.ts`, `chart-scale.test.ts`
- Create: `apps/web/app/components/analytics/charts/ShareBar.vue`, `ShareBar.test.ts`
- Create: `apps/web/app/components/analytics/charts/ColumnChart.vue`, `ColumnChart.test.ts`
- Create: `apps/web/app/components/analytics/charts/LimitBar.vue`, `LimitBar.test.ts`
- Create: `apps/web/app/components/analytics/charts/GoalProgress.vue`, `GoalProgress.test.ts`
- Modify: `apps/web/app/components/analytics/GoalProgressReport.vue`, `GoalProgressReport.test.ts`

**Interfaces:**
- Consumes: `formatMinorUnits` (`components/finance/money-format.ts`), `FinanceMoney.vue`, `GoalProgressRowDto` (`useBudgetReferenceData.ts`).
- Produces:
  - `ratioPercent(value: string, max: string): number` — 0..100 с точностью 0.01, для геометрии.
  - `basisPointsPercent(basisPoints: number): string` — `'24%'`, `'0,5%'`, `'<0,1%'`.
  - `<ShareBar :items="{ id, label, amountMinor, shareBasisPoints, href? }[]" :highlight="5" />`
  - `<ColumnChart :columns="{ id, label, values: { seriesId, amountMinor }[], caption? }[]" :series="{ id, label, tone: 1|2|3 }[]" :label="string" />`
  - `<LimitBar :row="EnvelopeLimitV2Row" />`
  - `<GoalProgress :row="GoalProgressRowDto" />`

Общие правила компонентов: только props; нет `window`, `ResizeObserver`, `echarts`, composables; SVG — `aria-hidden="true"`, `focusable="false"`; значения дублируются видимым текстом.

- [ ] **Step 1: Write the failing tests**

`chart-scale.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { basisPointsPercent, ratioPercent } from './chart-scale.js';

describe('ratioPercent', () => {
  it('доля от максимума без float-денег', () => {
    expect(ratioPercent('25', '100')).toBe(25);
    expect(ratioPercent('1', '3')).toBe(33.33);
  });

  it('ограничена 0..100; некорректные и нулевые значения дают 0', () => {
    expect(ratioPercent('200', '100')).toBe(100);
    expect(ratioPercent('-5', '100')).toBe(0);
    expect(ratioPercent('5', '0')).toBe(0);
    expect(ratioPercent('x', '10')).toBe(0);
  });
});

describe('basisPointsPercent', () => {
  it('форматирует базисные пункты сервера', () => {
    expect(basisPointsPercent(2400)).toBe('24%');
    expect(basisPointsPercent(55)).toBe('0,5%');
    expect(basisPointsPercent(5)).toBe('<0,1%');
    expect(basisPointsPercent(0)).toBe('0%');
  });
});
```

`ShareBar.test.ts`:

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import ShareBar from './ShareBar.vue';

const global = { stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } };
const items = Array.from({ length: 7 }, (_, index) => ({
  id: `c${index}`,
  label: `Категория ${index}`,
  amountMinor: String((7 - index) * 10_000),
  shareBasisPoints: (7 - index) * 357,
  href: `/app/operations?categoryId=c${index}`,
}));

describe('ShareBar', () => {
  it('выделяет цветом первые highlight сегментов, остальные — нейтральные', () => {
    const wrapper = mount(ShareBar, { props: { items, highlight: 5 }, global });
    const segments = wrapper.findAll('[data-segment]');
    expect(segments).toHaveLength(7);
    expect(segments[0]!.attributes('data-tone')).toBe('1');
    expect(segments[4]!.attributes('data-tone')).toBe('5');
    expect(segments[5]!.attributes('data-tone')).toBe('rest');
    expect(wrapper.get('svg').attributes('aria-hidden')).toBe('true');
  });

  it('показывает название, сумму и долю текстом, строки ведут в журнал', () => {
    const wrapper = mount(ShareBar, { props: { items }, global });
    const first = wrapper.get('[data-share-row]');
    expect(first.text()).toContain('Категория 0');
    expect(first.text()).toContain('24%');
    expect(first.text().replace(/\s/g, ' ')).toContain('700,00');
    expect(first.get('a').attributes('href')).toBe('/app/operations?categoryId=c0');
  });

  it('без href строка не ссылка', () => {
    const wrapper = mount(ShareBar, {
      props: { items: [{ ...items[0]!, href: undefined }] },
      global,
    });
    expect(wrapper.find('a').exists()).toBe(false);
  });
});
```

`ColumnChart.test.ts`:

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import ColumnChart from './ColumnChart.vue';

const series = [
  { id: 'income', label: 'Доходы', tone: 2 as const },
  { id: 'expense', label: 'Расходы', tone: 1 as const },
];
const columns = [
  {
    id: 'march',
    label: '01.03–31.03',
    values: [
      { seriesId: 'income', amountMinor: '200000' },
      { seriesId: 'expense', amountMinor: '50000' },
    ],
    caption: '+1 500,00 ₽',
  },
  {
    id: 'april',
    label: '01.04–30.04',
    values: [
      { seriesId: 'income', amountMinor: '100000' },
      { seriesId: 'expense', amountMinor: '0' },
    ],
  },
];

describe('ColumnChart', () => {
  it('общая шкала: самый большой столбец 100%', () => {
    const wrapper = mount(ColumnChart, { props: { columns, series, label: 'По циклам' } });
    const bars = wrapper.findAll('[data-bar]');
    expect(bars.map((bar) => bar.attributes('data-percent'))).toEqual(['100', '25', '50', '0']);
  });

  it('легенда, подписи колонок и значения текстом', () => {
    const wrapper = mount(ColumnChart, { props: { columns, series, label: 'По циклам' } });
    const text = wrapper.text().replace(/\s/g, ' ');
    expect(text).toContain('Доходы');
    expect(text).toContain('Расходы');
    expect(text).toContain('01.03–31.03');
    expect(text).toContain('+1 500,00 ₽');
    expect(text).toContain('2 000,00');
    expect(wrapper.find('svg[aria-hidden="true"]').exists()).toBe(true);
  });

  it('все нули не делят на ноль', () => {
    const wrapper = mount(ColumnChart, {
      props: {
        columns: [{ id: 'z', label: 'Z', values: [{ seriesId: 'income', amountMinor: '0' }] }],
        series: [series[0]!],
        label: 'Пусто',
      },
    });
    expect(wrapper.get('[data-bar]').attributes('data-percent')).toBe('0');
  });
});
```

`LimitBar.test.ts`:

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import type { EnvelopeLimitV2Row } from '../../../composables/useEnvelopePlanV2.js';
import LimitBar from './LimitBar.vue';

const row: EnvelopeLimitV2Row = {
  periodId: 'p',
  periodStart: '2026-03-01',
  periodEnd: '2026-03-14',
  isCurrent: true,
  envelopeId: 'e',
  envelopeName: 'Продукты',
  targetMinor: '1000000',
  targetStatus: 'CONFIRMED',
  spentMinor: '400000',
  remainingMinor: '600000',
  overspentMinor: '0',
  spentPermille: 400,
};
const flat = (text: string) => text.replace(/\s/g, ' ');

describe('LimitBar', () => {
  it('потрачено из лимита и остаток', () => {
    const wrapper = mount(LimitBar, { props: { row } });
    expect(flat(wrapper.text())).toContain('Потрачено 4 000,00 ₽ из 10 000,00 ₽');
    expect(flat(wrapper.text())).toContain('Осталось 6 000,00 ₽');
    expect(wrapper.get('[data-fill]').attributes('data-percent')).toBe('40');
    expect(wrapper.find('[data-overspent]').exists()).toBe(false);
  });

  it('перерасход — текстом и статусом, полоса заполнена', () => {
    const wrapper = mount(LimitBar, {
      props: {
        row: { ...row, spentMinor: '1200000', remainingMinor: '-200000', overspentMinor: '200000', spentPermille: 1200 },
      },
    });
    expect(flat(wrapper.get('[data-overspent]').text())).toContain('Перерасход 2 000,00 ₽');
    expect(wrapper.get('[data-fill]').attributes('data-percent')).toBe('100');
    expect(wrapper.get('[data-fill]').classes()).toContain('limit-bar__fill--over');
  });

  it('без лимита: подсказка и сумма без полосы', () => {
    const wrapper = mount(LimitBar, {
      props: { row: { ...row, targetMinor: null, targetStatus: 'UNSET', remainingMinor: null, spentPermille: null } },
    });
    expect(wrapper.text()).toContain('Лимит на период не задан');
    expect(flat(wrapper.text())).toContain('Потрачено 4 000,00 ₽');
    expect(wrapper.find('[data-fill]').exists()).toBe(false);
  });

  it('черновик лимита помечен', () => {
    const wrapper = mount(LimitBar, { props: { row: { ...row, targetStatus: 'DRAFT' } } });
    expect(wrapper.text()).toContain('Лимит не подтверждён');
  });
});
```

`GoalProgress.test.ts`:

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import GoalProgress from './GoalProgress.vue';

const row = {
  envelopeId: 'g',
  name: 'Отпуск',
  envelopeType: 'SAVINGS_GOAL',
  currentMinor: '1234500',
  targetMinor: '5000000',
  targetDate: '2026-12-31',
  remainingMinor: '3765500',
  progressPermille: 247,
  isReached: false,
  daysRemaining: 75,
};
const flat = (text: string) => text.replace(/\s/g, ' ');

describe('GoalProgress', () => {
  it('отложено из цели, осталось, срок', () => {
    const wrapper = mount(GoalProgress, { props: { row } });
    const text = flat(wrapper.text());
    expect(text).toContain('Отпуск');
    expect(text).toContain('Отложено 12 345,00 ₽ из 50 000,00 ₽');
    expect(text).toContain('Осталось 37 655,00 ₽');
    expect(text).toContain('Осталось дней: 75');
    expect(wrapper.get('[data-fill]').attributes('data-percent')).toBe('24.7');
  });

  it('достигнутая цель — статус текстом', () => {
    const wrapper = mount(GoalProgress, {
      props: { row: { ...row, isReached: true, progressPermille: 1000, remainingMinor: '0' } },
    });
    expect(wrapper.text()).toContain('Цель достигнута');
    expect(wrapper.text()).not.toContain('Осталось 0');
  });
});
```

`GoalProgressReport.test.ts` — заменить проверки таблицы на: заголовок «Накопления», по одному `[data-goal]` на строку, пустое состояние «Нет конвертов «Накопления».» (сохранить существующие кейсы данных, поменять селекторы и тексты).

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @harmofin/web exec vitest run app/components/analytics/charts app/components/analytics/GoalProgressReport.test.ts`
Expected: FAIL — компонентов нет.

- [ ] **Step 3: Implement**

`chart-scale.ts`:

```ts
/**
 * Geometry only: share of two server sums as 0..100 with 0.01 precision. Money stays in bigint;
 * the result never becomes a displayed amount.
 */
export function ratioPercent(value: string, max: string): number {
  let numerator: bigint;
  let denominator: bigint;
  try {
    numerator = BigInt(value);
    denominator = BigInt(max);
  } catch {
    return 0;
  }
  if (denominator <= 0n || numerator <= 0n) return 0;
  if (numerator >= denominator) return 100;
  return Number((numerator * 10_000n) / denominator) / 100;
}

/** Server basis points (0..10000) as a short Russian percent label. */
export function basisPointsPercent(basisPoints: number): string {
  if (basisPoints <= 0) return '0%';
  if (basisPoints < 10) return '<0,1%';
  if (basisPoints < 100) return `0,${Math.trunc(basisPoints / 10)}%`;
  return `${Math.trunc(basisPoints / 100)}%`;
}
```

`ShareBar.vue`:

```vue
<script setup lang="ts">
import { computed } from 'vue';

import FinanceMoney from '../../finance/FinanceMoney.vue';
import { basisPointsPercent } from './chart-scale.js';

defineOptions({ name: 'AnalyticsShareBar' });

export type ShareItem = {
  id: string;
  label: string;
  amountMinor: string;
  shareBasisPoints: number;
  href?: string | undefined;
};

const props = withDefaults(defineProps<{ items: ReadonlyArray<ShareItem>; highlight?: number }>(), {
  highlight: 5,
});

const tone = (index: number) => (index < props.highlight ? String(index + 1) : 'rest');

// Segment x/width in viewBox units (0..10000 = server basis points), no browser measuring.
const segments = computed(() => {
  let x = 0;
  return props.items.map((item, index) => {
    const segment = { id: item.id, x, width: item.shareBasisPoints, tone: tone(index) };
    x += item.shareBasisPoints;
    return segment;
  });
});
</script>

<template>
  <div class="share-bar">
    <svg
      class="share-bar__track"
      viewBox="0 0 10000 1"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <rect
        v-for="segment in segments"
        :key="segment.id"
        data-segment
        :data-tone="segment.tone"
        :class="`share-bar__segment share-bar__segment--${segment.tone}`"
        :x="segment.x"
        y="0"
        :width="segment.width"
        height="1"
      />
    </svg>
    <ul class="share-bar__list">
      <li v-for="(item, index) in items" :key="item.id" data-share-row class="share-bar__row">
        <span
          :class="`share-bar__dot share-bar__segment--${tone(index)}`"
          aria-hidden="true"
        />
        <NuxtLink v-if="item.href" :to="item.href" class="share-bar__label">{{ item.label }}</NuxtLink>
        <span v-else class="share-bar__label">{{ item.label }}</span>
        <FinanceMoney class="share-bar__amount" :minor-units="item.amountMinor" currency="RUB" :scale="2" />
        <span class="share-bar__share">{{ basisPointsPercent(item.shareBasisPoints) }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.share-bar {
  display: grid;
  gap: var(--hf-space-4);
}
.share-bar__track {
  display: block;
  width: 100%;
  height: 0.75rem;
  border-radius: var(--hf-radius-sm);
  background: var(--hf-color-chart-track);
  overflow: hidden;
}
.share-bar__segment--1 { fill: var(--hf-color-chart-1); background: var(--hf-color-chart-1); }
.share-bar__segment--2 { fill: var(--hf-color-chart-2); background: var(--hf-color-chart-2); }
.share-bar__segment--3 { fill: var(--hf-color-chart-3); background: var(--hf-color-chart-3); }
.share-bar__segment--4 { fill: var(--hf-color-chart-4); background: var(--hf-color-chart-4); }
.share-bar__segment--5 { fill: var(--hf-color-chart-5); background: var(--hf-color-chart-5); }
.share-bar__segment--rest { fill: var(--hf-color-chart-rest); background: var(--hf-color-chart-rest); }
.share-bar__list {
  display: grid;
  gap: var(--hf-space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}
.share-bar__row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto 3.5rem;
  gap: var(--hf-space-3);
  align-items: center;
  min-height: var(--hf-control-height-sm);
}
.share-bar__dot {
  width: 0.625rem;
  height: 0.625rem;
  border-radius: 50%;
}
.share-bar__label {
  overflow: hidden;
  color: var(--hf-color-text);
  text-overflow: ellipsis;
  white-space: nowrap;
}
a.share-bar__label {
  text-decoration: none;
}
a.share-bar__label:hover {
  text-decoration: underline;
}
.share-bar__amount,
.share-bar__share {
  font-variant-numeric: tabular-nums;
  text-align: right;
}
.share-bar__share {
  color: var(--hf-color-text-muted);
}
</style>
```

`ColumnChart.vue`:

```vue
<script setup lang="ts">
import { computed } from 'vue';

import { formatMinorUnits } from '../../finance/money-format.js';
import { ratioPercent } from './chart-scale.js';

defineOptions({ name: 'AnalyticsColumnChart' });

export type ColumnSeries = { id: string; label: string; tone: 1 | 2 | 3 };
export type Column = {
  id: string;
  label: string;
  values: ReadonlyArray<{ seriesId: string; amountMinor: string }>;
  caption?: string | undefined;
};

const props = defineProps<{
  columns: ReadonlyArray<Column>;
  series: ReadonlyArray<ColumnSeries>;
  label: string;
}>();

const max = computed(() => {
  let value = 0n;
  for (const column of props.columns) {
    for (const item of column.values) {
      const amount = BigInt(item.amountMinor);
      if (amount > value) value = amount;
    }
  }
  return value.toString();
});

const toneOf = (seriesId: string) => props.series.find((item) => item.id === seriesId)?.tone ?? 1;
const labelOf = (seriesId: string) => props.series.find((item) => item.id === seriesId)?.label ?? '';
const money = (minor: string) => formatMinorUnits(minor, 'RUB', 2);
</script>

<template>
  <figure class="column-chart">
    <figcaption class="column-chart__legend">
      <span class="column-chart__title">{{ label }}</span>
      <span v-for="item in series" :key="item.id" class="column-chart__legend-item">
        <span :class="`column-chart__swatch column-chart__tone--${item.tone}`" aria-hidden="true" />
        {{ item.label }}
      </span>
    </figcaption>
    <ol class="column-chart__columns">
      <li v-for="column in columns" :key="column.id" class="column-chart__column">
        <svg
          class="column-chart__plot"
          :viewBox="`0 0 ${column.values.length * 10} 100`"
          preserveAspectRatio="none"
          aria-hidden="true"
          focusable="false"
        >
          <rect
            v-for="(item, index) in column.values"
            :key="item.seriesId"
            data-bar
            :data-percent="String(ratioPercent(item.amountMinor, max))"
            :class="`column-chart__tone--${toneOf(item.seriesId)}`"
            :x="index * 10 + 1"
            :y="100 - ratioPercent(item.amountMinor, max)"
            width="8"
            :height="ratioPercent(item.amountMinor, max)"
          />
        </svg>
        <span class="column-chart__label">{{ column.label }}</span>
        <span v-for="item in column.values" :key="item.seriesId" class="column-chart__value">
          <span class="visually-hidden">{{ labelOf(item.seriesId) }}: </span>{{ money(item.amountMinor) }}
        </span>
        <span v-if="column.caption" class="column-chart__caption">{{ column.caption }}</span>
      </li>
    </ol>
  </figure>
</template>

<style scoped>
.column-chart {
  display: grid;
  gap: var(--hf-space-4);
  margin: 0;
}
.column-chart__legend {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-4);
  align-items: center;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}
.column-chart__title {
  color: var(--hf-color-text);
  font-weight: var(--hf-font-weight-semibold);
}
.column-chart__legend-item {
  display: inline-flex;
  gap: var(--hf-space-2);
  align-items: center;
}
.column-chart__swatch {
  width: 0.625rem;
  height: 0.625rem;
  border-radius: 2px;
}
.column-chart__columns {
  display: grid;
  grid-auto-columns: minmax(5.5rem, 1fr);
  grid-auto-flow: column;
  gap: var(--hf-space-3);
  margin: 0;
  padding: 0 0 var(--hf-space-2);
  overflow-x: auto;
  list-style: none;
}
.column-chart__column {
  display: grid;
  gap: var(--hf-space-1);
  font-size: var(--hf-font-size-caption);
  font-variant-numeric: tabular-nums;
}
.column-chart__plot {
  width: 100%;
  height: 10rem;
  border-bottom: 1px solid var(--hf-color-border-strong);
}
.column-chart__tone--1 { fill: var(--hf-color-chart-1); background: var(--hf-color-chart-1); }
.column-chart__tone--2 { fill: var(--hf-color-chart-2); background: var(--hf-color-chart-2); }
.column-chart__tone--3 { fill: var(--hf-color-chart-3); background: var(--hf-color-chart-3); }
.column-chart__label {
  color: var(--hf-color-text);
  font-weight: var(--hf-font-weight-medium);
}
.column-chart__value {
  color: var(--hf-color-text-muted);
}
.column-chart__caption {
  color: var(--hf-color-text);
  font-weight: var(--hf-font-weight-semibold);
}
</style>
```

Перед реализацией проверить, есть ли в глобальных стилях класс `visually-hidden` (`grep -rn "visually-hidden" apps/web/app/assets`). Если нет — использовать тот класс скрытия для screen reader, который уже есть в проекте; если нет никакого — добавить в `<style scoped>` компонента правило `.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }`.

`LimitBar.vue`:

```vue
<script setup lang="ts">
import { TriangleAlert } from '@lucide/vue';
import { computed } from 'vue';

import type { EnvelopeLimitV2Row } from '../../../composables/useEnvelopePlanV2.js';
import { formatMinorUnits } from '../../finance/money-format.js';

defineOptions({ name: 'AnalyticsLimitBar' });

const props = defineProps<{ row: EnvelopeLimitV2Row }>();
const money = (minor: string) => formatMinorUnits(minor, 'RUB', 2);
const overspent = computed(() => props.row.overspentMinor !== '0');
// spentPermille is the server ratio; the bar only caps it for drawing.
const percent = computed(() =>
  props.row.spentPermille === null ? 0 : Math.min(props.row.spentPermille, 1000) / 10,
);
</script>

<template>
  <article class="limit-bar">
    <header class="limit-bar__head">
      <h3 class="limit-bar__name">{{ row.envelopeName }}</h3>
      <span v-if="row.targetStatus === 'DRAFT'" class="limit-bar__draft">Лимит не подтверждён</span>
    </header>
    <template v-if="row.targetMinor !== null">
      <svg
        class="limit-bar__track"
        viewBox="0 0 100 1"
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        <rect
          data-fill
          :data-percent="String(percent)"
          :class="['limit-bar__fill', { 'limit-bar__fill--over': overspent }]"
          x="0"
          y="0"
          :width="percent"
          height="1"
        />
      </svg>
      <p class="limit-bar__text">Потрачено {{ money(row.spentMinor) }} из {{ money(row.targetMinor) }}</p>
      <p v-if="overspent" data-overspent class="limit-bar__over">
        <TriangleAlert :size="16" aria-hidden="true" />
        Перерасход {{ money(row.overspentMinor) }}
      </p>
      <p v-else-if="row.remainingMinor !== null" class="limit-bar__muted">
        Осталось {{ money(row.remainingMinor) }}
      </p>
    </template>
    <template v-else>
      <p class="limit-bar__muted">Лимит на период не задан</p>
      <p class="limit-bar__text">Потрачено {{ money(row.spentMinor) }}</p>
    </template>
  </article>
</template>

<style scoped>
.limit-bar {
  display: grid;
  gap: var(--hf-space-2);
  padding: var(--hf-space-4) 0;
  border-bottom: 1px solid var(--hf-color-border);
}
.limit-bar:last-child {
  border-bottom: 0;
}
.limit-bar__head {
  display: flex;
  gap: var(--hf-space-3);
  align-items: baseline;
  justify-content: space-between;
}
.limit-bar__name {
  margin: 0;
  font-size: var(--hf-font-size-body);
  font-weight: var(--hf-font-weight-semibold);
}
.limit-bar__draft {
  color: var(--hf-color-status-warning);
  font-size: var(--hf-font-size-caption);
}
.limit-bar__track {
  display: block;
  width: 100%;
  height: 0.5rem;
  border-radius: var(--hf-radius-sm);
  background: var(--hf-color-chart-track);
  overflow: hidden;
}
.limit-bar__fill {
  fill: var(--hf-color-chart-1);
}
.limit-bar__fill--over {
  fill: var(--hf-color-status-danger);
}
.limit-bar__text,
.limit-bar__muted,
.limit-bar__over {
  margin: 0;
  font-size: var(--hf-font-size-small);
  font-variant-numeric: tabular-nums;
}
.limit-bar__muted {
  color: var(--hf-color-text-muted);
}
.limit-bar__over {
  display: inline-flex;
  gap: var(--hf-space-1);
  align-items: center;
  color: var(--hf-color-text-danger);
  font-weight: var(--hf-font-weight-medium);
}
</style>
```

Перед реализацией проверить имя иконки в установленной версии `@lucide/vue` (`TriangleAlert` или `AlertTriangle`): `grep -rn "TriangleAlert\|AlertTriangle" apps/web/app --include=*.vue | head -3` — использовать то же имя, что уже встречается в проекте.

`GoalProgress.vue`:

```vue
<script setup lang="ts">
import { CircleCheck } from '@lucide/vue';

import type { GoalProgressRowDto } from '../../../composables/useBudgetReferenceData.js';
import { formatMinorUnits } from '../../finance/money-format.js';

defineOptions({ name: 'AnalyticsGoalProgress' });

const props = defineProps<{ row: GoalProgressRowDto }>();
const money = (minor: string) => formatMinorUnits(minor, 'RUB', 2);

function deadlineText(row: GoalProgressRowDto) {
  if (!row.targetDate) return 'Срок не указан';
  if (row.daysRemaining === null) return `Целевая дата: ${row.targetDate}`;
  if (row.daysRemaining < 0) return `Просрочено на ${Math.abs(row.daysRemaining)} дн.`;
  if (row.daysRemaining === 0) return 'Срок сегодня';
  return `Осталось дней: ${row.daysRemaining}`;
}
// progressPermille is computed and capped by the server (0..1000).
const percent = () => props.row.progressPermille / 10;
</script>

<template>
  <article data-goal class="goal">
    <header class="goal__head">
      <h3 class="goal__name">{{ row.name }}</h3>
      <span v-if="row.isReached" class="goal__reached">
        <CircleCheck :size="16" aria-hidden="true" /> Цель достигнута
      </span>
    </header>
    <svg
      class="goal__track"
      viewBox="0 0 100 1"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <rect data-fill :data-percent="String(percent())" class="goal__fill" x="0" y="0" :width="percent()" height="1" />
    </svg>
    <p class="goal__text">Отложено {{ money(row.currentMinor) }} из {{ money(row.targetMinor) }}</p>
    <p class="goal__muted">
      <span v-if="!row.isReached">Осталось {{ money(row.remainingMinor) }} · </span>{{ deadlineText(row) }}
    </p>
  </article>
</template>

<style scoped>
.goal {
  display: grid;
  gap: var(--hf-space-2);
  padding: var(--hf-space-4) 0;
  border-bottom: 1px solid var(--hf-color-border);
}
.goal:last-child {
  border-bottom: 0;
}
.goal__head {
  display: flex;
  gap: var(--hf-space-3);
  align-items: baseline;
  justify-content: space-between;
}
.goal__name {
  margin: 0;
  font-size: var(--hf-font-size-body);
  font-weight: var(--hf-font-weight-semibold);
}
.goal__reached {
  display: inline-flex;
  gap: var(--hf-space-1);
  align-items: center;
  color: var(--hf-color-status-success);
  font-size: var(--hf-font-size-small);
  font-weight: var(--hf-font-weight-medium);
}
.goal__track {
  display: block;
  width: 100%;
  height: 0.5rem;
  border-radius: var(--hf-radius-sm);
  background: var(--hf-color-chart-track);
  overflow: hidden;
}
.goal__fill {
  fill: var(--hf-color-chart-2);
}
.goal__text,
.goal__muted {
  margin: 0;
  font-size: var(--hf-font-size-small);
  font-variant-numeric: tabular-nums;
}
.goal__muted {
  color: var(--hf-color-text-muted);
}
</style>
```

Проверить имя `CircleCheck`/`CheckCircle2` так же, как для `TriangleAlert`.

`GoalProgressReport.vue` — заменить таблицу списком `GoalProgress`:

```vue
<script setup lang="ts">
import type { GoalProgressRowDto } from '../../composables/useBudgetReferenceData.js';
import GoalProgress from './charts/GoalProgress.vue';

// The amount is the assigned continuous balance, not money on an account.
defineProps<{ rows: ReadonlyArray<GoalProgressRowDto> }>();
</script>

<template>
  <section class="goal-progress" aria-labelledby="goal-progress-title">
    <div class="goal-progress__heading">
      <h2 id="goal-progress-title">Накопления</h2>
      <p>Отложено на цель — остаток конверта. Это не деньги на счёте.</p>
    </div>
    <p v-if="rows.length === 0" class="goal-progress__empty">Нет конвертов «Накопления».</p>
    <div v-else class="goal-progress__list">
      <GoalProgress v-for="row in rows" :key="row.envelopeId" :row="row" />
    </div>
  </section>
</template>
```

Стили: оставить существующие `.goal-progress`, `.goal-progress__heading`, `.goal-progress__empty`; удалить стили таблицы.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @harmofin/web exec vitest run app/components/analytics app/components/landing`
Expected: PASS (лендинг использует `GoalProgressReport` — его тесты должны пройти; если тест лендинга проверяет старые тексты таблицы, обновить только ассерты текста, не секцию).
Run: `pnpm --filter @harmofin/web typecheck && pnpm --filter @harmofin/web lint`
Expected: без ошибок.

- [ ] **Step 5: Commit (только с одобрения владельца)**

```bash
git add apps/web/app/components/analytics/charts apps/web/app/components/analytics/GoalProgressReport.vue apps/web/app/components/analytics/GoalProgressReport.test.ts
git commit -m "feat(web): SVG-графики аналитики без echarts"
```

---

### Task 5: Вкладки аналитики (web)

**Files:**
- Create: `apps/web/app/components/analytics/ReportCard.vue`, `ReportCard.test.ts`
- Create: `apps/web/app/components/analytics/tabs/OverviewTab.vue`, `OverviewTab.test.ts`
- Create: `apps/web/app/components/analytics/tabs/ExpensesTab.vue`, `ExpensesTab.test.ts`
- Create: `apps/web/app/components/analytics/tabs/CashFlowTab.vue`, `CashFlowTab.test.ts`
- Create: `apps/web/app/components/analytics/tabs/EnvelopesTab.vue`, `EnvelopesTab.test.ts`
- Create: `apps/web/app/components/analytics/tabs/SavingsTab.vue`, `SavingsTab.test.ts`
- Create: `apps/web/app/components/analytics/tabs/comparison-text.ts`, `comparison-text.test.ts`

**Interfaces:**
- Consumes: `useAnalyticsReport`, `ReportV2RowMap`, `journalHref`, `periodLabel`, `ShareBar`, `ColumnChart`, `LimitBar`, `GoalProgressReport`, `PlanVsActualReport`, `ReportTable`, `UiProgress`, `UiSelect`, `UiMoreLink`, `UiEmptyState`, `UiSkeleton`, `UiButton`, `FinanceMoney`.
- Produces:
  - `<ReportCard :title :loading :error :empty empty-text="…" @retry>` + default slot.
  - Каждая вкладка: props `{ budgetId: string; filters: ReportV2Filters }`; загружает свои отчёты при монтировании и при изменении `filters` (deep watch).
  - `comparisonText(row: PeriodComparisonV2Row): string`.

- [ ] **Step 1: Write the failing tests**

`comparison-text.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import type { PeriodComparisonV2Row } from '../../../composables/useEnvelopePlanV2.js';
import { comparisonText } from './comparison-text.js';

const base: PeriodComparisonV2Row = {
  asOf: '2026-03-20',
  periodStart: '2026-03-15',
  periodEnd: '2026-03-31',
  daysElapsed: 6,
  spentMinor: '80000',
  limitTotalMinor: '500000',
  spentOfLimitPermille: 160,
  previousPeriodStart: '2026-03-01',
  previousPeriodEnd: '2026-03-14',
  previousSameDaySpentMinor: '100000',
  previousTotalSpentMinor: '150000',
  deltaMinor: '-20000',
  deltaBasisPoints: -2000,
};
const flat = (text: string) => text.replace(/\s/g, ' ');

describe('comparisonText', () => {
  it('меньше, чем к этому дню прошлого периода', () => {
    expect(flat(comparisonText(base))).toBe(
      'К этому дню прошлого периода: на 20% меньше (−200,00 ₽).',
    );
  });

  it('больше', () => {
    expect(flat(comparisonText({ ...base, deltaMinor: '5000', deltaBasisPoints: 500 }))).toBe(
      'К этому дню прошлого периода: на 5% больше (+50,00 ₽).',
    );
  });

  it('столько же', () => {
    expect(comparisonText({ ...base, deltaMinor: '0', deltaBasisPoints: 0 })).toBe(
      'Столько же, сколько к этому дню прошлого периода.',
    );
  });

  it('в прошлом периоде расходов не было', () => {
    expect(
      comparisonText({ ...base, previousSameDaySpentMinor: '0', deltaBasisPoints: null }),
    ).toBe('В прошлом периоде к этому дню расходов не было.');
  });

  it('меньше 1% показывается без нуля процентов', () => {
    expect(flat(comparisonText({ ...base, deltaMinor: '-50', deltaBasisPoints: -5 }))).toBe(
      'К этому дню прошлого периода: меньше чем на 1% (−0,50 ₽).',
    );
  });
});
```

`ReportCard.test.ts`:

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import ReportCard from './ReportCard.vue';

describe('ReportCard', () => {
  it('ошибка с повтором', async () => {
    const wrapper = mount(ReportCard, {
      props: { title: 'Структура', loading: false, error: 'Не удалось загрузить отчёт.', empty: false },
    });
    expect(wrapper.get('[role="alert"]').text()).toContain('Не удалось загрузить отчёт.');
    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('retry')).toHaveLength(1);
  });

  it('пусто — подсказка, иначе слот', () => {
    const empty = mount(ReportCard, {
      props: { title: 'Структура', loading: false, error: '', empty: true },
      slots: { default: '<p data-content>график</p>' },
    });
    expect(empty.text()).toContain('Нет данных');
    expect(empty.find('[data-content]').exists()).toBe(false);
    const filled = mount(ReportCard, {
      props: { title: 'Структура', loading: false, error: '', empty: false },
      slots: { default: '<p data-content>график</p>' },
    });
    expect(filled.find('[data-content]').exists()).toBe(true);
    expect(filled.get('h2').text()).toBe('Структура');
  });
});
```

Общий мок для тестов вкладок (повторить в каждом файле вкладки):

```ts
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const v2 = { getReport: vi.fn() };
vi.mock('../../../composables/useEnvelopePlanV2.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useEnvelopePlanV2: () => v2,
}));
const global = { stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } };
const flat = (text: string) => text.replace(/\s/g, ' ');
const reply = (data: Record<string, unknown[]>) =>
  v2.getReport.mockImplementation(async (_budgetId: string, key: string) => ({
    key,
    rows: data[key] ?? [],
  }));
```

`OverviewTab.test.ts` (после общего мока):

```ts
import OverviewTab from './OverviewTab.vue';

const comparison = {
  asOf: '2026-03-20',
  periodStart: '2026-03-15',
  periodEnd: '2026-03-31',
  daysElapsed: 6,
  spentMinor: '80000',
  limitTotalMinor: '500000',
  spentOfLimitPermille: 160,
  previousPeriodStart: '2026-03-01',
  previousPeriodEnd: '2026-03-14',
  previousSameDaySpentMinor: '100000',
  previousTotalSpentMinor: '150000',
  deltaMinor: '-20000',
  deltaBasisPoints: -2000,
};

describe('OverviewTab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('период, сравнение, топ-5 категорий за границы периода с сервера, счета', async () => {
    reply({
      'period-comparison': [comparison],
      'expenses-by-category': Array.from({ length: 6 }, (_, index) => ({
        categoryId: `c${index}`,
        categoryName: `Категория ${index}`,
        expenseMinor: '1000',
        shareBasisPoints: 1666,
        journalFilters: { categoryId: `c${index}`, type: 'EXPENSE' },
      })),
      'account-balances': [{ accountId: 'a', name: 'Основной счёт', balanceMinor: '123400', asOf: '2026-03-20' }],
    });
    const wrapper = mount(OverviewTab, { props: { budgetId: 'b', filters: {} }, global });
    await flushPromises();
    expect(v2.getReport).toHaveBeenCalledWith('b', 'period-comparison', {});
    expect(v2.getReport).toHaveBeenCalledWith('b', 'expenses-by-category', {
      from: '2026-03-15',
      to: '2026-03-31',
    });
    expect(v2.getReport).toHaveBeenCalledWith('b', 'account-balances', {});
    const text = flat(wrapper.text());
    expect(text).toContain('15.03–31.03');
    expect(text).toContain('из лимита на период 5 000,00 ₽');
    expect(text).toContain('на 20% меньше');
    expect(wrapper.findAll('[data-share-row]')).toHaveLength(5);
    expect(text).toContain('Основной счёт');
    expect(wrapper.find('a[href="/app/analytics?tab=expenses"]').exists()).toBe(true);
  });

  it('без лимита — текст вместо полосы; ошибка одного отчёта не скрывает другие', async () => {
    v2.getReport.mockImplementation(async (_b: string, key: string) => {
      if (key === 'account-balances') throw new Error('boom');
      if (key === 'period-comparison')
        return { key, rows: [{ ...comparison, limitTotalMinor: null, spentOfLimitPermille: null }] };
      return { key, rows: [] };
    });
    const wrapper = mount(OverviewTab, { props: { budgetId: 'b', filters: {} }, global });
    await flushPromises();
    expect(wrapper.text()).toContain('Лимит на период не задан');
    expect(wrapper.find('[role="progressbar"]').exists()).toBe(false);
    expect(wrapper.get('[role="alert"]').text()).toContain('Не удалось загрузить отчёт.');
  });
});
```

`ExpensesTab.test.ts`:

```ts
import ExpensesTab from './ExpensesTab.vue';

describe('ExpensesTab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('структура и расходы по периодам с фильтрами вкладки', async () => {
    reply({
      'expenses-by-category': [
        { categoryId: 'c', categoryName: 'Еда', expenseMinor: '30000', shareBasisPoints: 7500, journalFilters: { categoryId: 'c', type: 'EXPENSE' } },
      ],
      'expenses-by-period': [
        { periodStart: '2026-03-01', periodEnd: '2026-03-14', boundarySource: 'STORED', expenseMinor: '30000', journalFilters: {} },
      ],
    });
    const filters = { from: '2026-03-01', accountId: 'acc' };
    const wrapper = mount(ExpensesTab, { props: { budgetId: 'b', filters }, global });
    await flushPromises();
    expect(v2.getReport).toHaveBeenCalledWith('b', 'expenses-by-category', filters);
    expect(v2.getReport).toHaveBeenCalledWith('b', 'expenses-by-period', filters);
    expect(wrapper.get('[data-share-row] a').attributes('href')).toBe(
      '/app/operations?categoryId=c&type=EXPENSE',
    );
    expect(flat(wrapper.text())).toContain('75%');
    expect(wrapper.text()).toContain('01.03–14.03');
  });

  it('смена фильтров перезагружает отчёты', async () => {
    reply({});
    const wrapper = mount(ExpensesTab, { props: { budgetId: 'b', filters: {} }, global });
    await flushPromises();
    await wrapper.setProps({ filters: { envelopeId: 'e' } });
    await flushPromises();
    expect(v2.getReport).toHaveBeenLastCalledWith('b', 'expenses-by-period', { envelopeId: 'e' });
  });
});
```

`CashFlowTab.test.ts`:

```ts
import CashFlowTab from './CashFlowTab.vue';

describe('CashFlowTab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('пары столбцов по циклам с подписью разницы и план-факт регулярных платежей', async () => {
    reply({
      'net-cash-flow': [
        { cycleStart: '2026-03-01', cycleEnd: '2026-03-31', incomeMinor: '200000', expenseMinor: '50000', netCashFlowMinor: '150000', journalFilters: {} },
        { cycleStart: '2026-04-01', cycleEnd: '2026-04-30', incomeMinor: '0', expenseMinor: '30000', netCashFlowMinor: '-30000', journalFilters: {} },
      ],
      'plan-vs-actual': [
        { planId: 'p', planName: 'Аренда', planType: 'EXPENSE', plannedMinor: '100', actualMinor: '100', varianceMinor: '0', plannedOccurrenceCount: 1, confirmedOccurrenceCount: 1 },
      ],
    });
    const wrapper = mount(CashFlowTab, { props: { budgetId: 'b', filters: {} }, global });
    await flushPromises();
    expect(wrapper.findAll('[data-bar]')).toHaveLength(4);
    const text = flat(wrapper.text());
    expect(text).toContain('+1 500,00 ₽');
    expect(text).toContain('−300,00 ₽');
    expect(text).toContain('Аренда');
  });
});
```

`EnvelopesTab.test.ts`:

```ts
import EnvelopesTab from './EnvelopesTab.vue';

const limit = (periodId: string, start: string, end: string, isCurrent: boolean, name: string) => ({
  periodId, periodStart: start, periodEnd: end, isCurrent, envelopeId: `e-${name}`, envelopeName: name,
  targetMinor: '1000', targetStatus: 'CONFIRMED', spentMinor: '100', remainingMinor: '900',
  overspentMinor: '0', spentPermille: 100,
});

describe('EnvelopesTab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('по умолчанию текущий период; выбор периода фильтрует только показ', async () => {
    reply({
      'envelope-limits': [
        limit('p2', '2026-03-15', '2026-03-31', true, 'Продукты'),
        limit('p1', '2026-03-01', '2026-03-14', false, 'Кафе'),
      ],
      'assignment-movements': [],
    });
    const wrapper = mount(EnvelopesTab, { props: { budgetId: 'b', filters: {} }, global });
    await flushPromises();
    expect(wrapper.text()).toContain('Продукты');
    expect(wrapper.text()).not.toContain('Кафе');
    const select = wrapper.get('select[name="limitPeriod"]');
    expect(select.text()).toContain('15.03–31.03 (текущий)');
    await select.setValue('2026-03-01:2026-03-14');
    expect(wrapper.text()).toContain('Кафе');
    expect(wrapper.text()).not.toContain('Продукты');
    expect(v2.getReport).toHaveBeenCalledTimes(2);
  });

  it('нет конвертов на текущие траты — пустое состояние', async () => {
    reply({});
    const wrapper = mount(EnvelopesTab, { props: { budgetId: 'b', filters: {} }, global });
    await flushPromises();
    expect(wrapper.text()).toContain('Нет данных');
  });
});
```

Если `UiSelect` рендерит не нативный `<select>`, заменить селектор и `setValue` на способ, которым это делают существующие тесты `Select.test.ts` (проверить перед написанием теста).

`SavingsTab.test.ts`:

```ts
import SavingsTab from './SavingsTab.vue';

describe('SavingsTab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('прогресс накоплений с фильтрами конверта и даты', async () => {
    reply({
      'savings-goals': [
        { envelopeId: 'g', name: 'Отпуск', envelopeType: 'SAVINGS_GOAL', currentMinor: '100', targetMinor: '1000', targetDate: null, assignedMinor: '100', movedNetMinor: '0', spentMinor: '0', remainingMinor: '900', progressPermille: 100, isReached: false, daysRemaining: null },
      ],
    });
    const filters = { envelopeId: 'g', to: '2026-03-31' };
    const wrapper = mount(SavingsTab, { props: { budgetId: 'b', filters }, global });
    await flushPromises();
    expect(v2.getReport).toHaveBeenCalledWith('b', 'savings-goals', filters);
    expect(wrapper.findAll('[data-goal]')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @harmofin/web exec vitest run app/components/analytics/ReportCard.test.ts app/components/analytics/tabs`
Expected: FAIL — компонентов нет.

- [ ] **Step 3: Implement**

`tabs/comparison-text.ts`:

```ts
import type { PeriodComparisonV2Row } from '../../../composables/useEnvelopePlanV2.js';
import { formatMinorUnits } from '../../finance/money-format.js';

/** Sentence for the overview card; every number comes from the server row. */
export function comparisonText(row: PeriodComparisonV2Row): string {
  if (row.deltaBasisPoints === null) return 'В прошлом периоде к этому дню расходов не было.';
  if (row.deltaMinor === '0') return 'Столько же, сколько к этому дню прошлого периода.';
  const less = row.deltaMinor.startsWith('-');
  const amount = formatMinorUnits(less ? row.deltaMinor.slice(1) : row.deltaMinor, 'RUB', 2);
  const signed = `${less ? '−' : '+'}${amount}`;
  const percent = Math.trunc(Math.abs(row.deltaBasisPoints) / 100);
  const words = less ? 'меньше' : 'больше';
  const share = percent === 0 ? `${words} чем на 1%` : `на ${percent}% ${words}`;
  return `К этому дню прошлого периода: ${share} (${signed}).`;
}
```

`ReportCard.vue`:

```vue
<script setup lang="ts">
import UiButton from '../ui/Button.vue';
import UiEmptyState from '../ui/EmptyState.vue';
import UiSkeleton from '../ui/Skeleton.vue';

defineOptions({ name: 'AnalyticsReportCard' });

withDefaults(
  defineProps<{
    title: string;
    loading: boolean;
    error: string;
    empty: boolean;
    emptyText?: string;
  }>(),
  { emptyText: 'Измените фильтры или добавьте подтверждённые операции.' },
);
defineEmits<{ retry: [] }>();
</script>

<template>
  <section class="report-card">
    <header class="report-card__head">
      <h2 class="report-card__title">{{ title }}</h2>
      <slot name="actions" />
    </header>
    <UiSkeleton v-if="loading" variant="card" />
    <p v-else-if="error" role="alert" class="report-card__error">
      {{ error }} <UiButton variant="tertiary" @click="$emit('retry')">Повторить</UiButton>
    </p>
    <UiEmptyState v-else-if="empty" title="Нет данных" :description="emptyText" />
    <slot v-else />
  </section>
</template>

<style scoped>
.report-card {
  display: grid;
  gap: var(--hf-space-4);
  padding: var(--hf-space-5);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-lg);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-sm);
}
.report-card__head {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-3);
  align-items: center;
  justify-content: space-between;
}
.report-card__title {
  margin: 0;
  font-size: var(--hf-font-size-h3);
  line-height: var(--hf-line-height-h3);
}
.report-card__error {
  margin: 0;
  color: var(--hf-color-text-danger);
}
</style>
```

Общий каркас вкладки — один и тот же у всех пяти; вкладки отличаются только отчётами и разметкой.

`tabs/ExpensesTab.vue`:

```vue
<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';

import { useAnalyticsReport } from '../../../composables/useAnalyticsReport.js';
import type { ReportV2Filters } from '../../../composables/useEnvelopePlanV2.js';
import ColumnChart from '../charts/ColumnChart.vue';
import ShareBar from '../charts/ShareBar.vue';
import { journalHref } from '../journal-href.js';
import { periodLabel } from '../period-label.js';
import ReportCard from '../ReportCard.vue';

const props = defineProps<{ budgetId: string; filters: ReportV2Filters }>();
const byCategory = useAnalyticsReport('expenses-by-category');
const byPeriod = useAnalyticsReport('expenses-by-period');

function load() {
  void byCategory.load(props.budgetId, props.filters);
  void byPeriod.load(props.budgetId, props.filters);
}
onMounted(load);
watch(() => props.filters, load, { deep: true });

const shareItems = computed(() =>
  byCategory.rows.value.map((row) => ({
    id: row.categoryId,
    label: row.categoryName,
    amountMinor: row.expenseMinor,
    shareBasisPoints: row.shareBasisPoints,
    href: journalHref(row as unknown as Record<string, unknown>),
  })),
);
const periodColumns = computed(() =>
  byPeriod.rows.value.map((row) => ({
    id: `${row.periodStart}:${row.periodEnd}`,
    label: periodLabel(row.periodStart, row.periodEnd),
    values: [{ seriesId: 'expense', amountMinor: row.expenseMinor }],
  })),
);
</script>

<template>
  <div class="analytics-tab">
    <ReportCard
      title="Структура расходов"
      :loading="byCategory.loading.value"
      :error="byCategory.error.value"
      :empty="byCategory.rows.value.length === 0"
      @retry="byCategory.load(budgetId, filters)"
    >
      <ShareBar :items="shareItems" />
    </ReportCard>
    <ReportCard
      title="Расходы по периодам"
      :loading="byPeriod.loading.value"
      :error="byPeriod.error.value"
      :empty="byPeriod.rows.value.length === 0"
      @retry="byPeriod.load(budgetId, filters)"
    >
      <ColumnChart
        label="Расходы за период"
        :columns="periodColumns"
        :series="[{ id: 'expense', label: 'Расходы', tone: 1 }]"
      />
    </ReportCard>
  </div>
</template>

<style scoped>
.analytics-tab {
  display: grid;
  gap: var(--hf-space-5);
}
</style>
```

`tabs/OverviewTab.vue`:

```vue
<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';

import { useAnalyticsReport } from '../../../composables/useAnalyticsReport.js';
import type { ReportV2Filters } from '../../../composables/useEnvelopePlanV2.js';
import FinanceMoney from '../../finance/FinanceMoney.vue';
import { formatMinorUnits } from '../../finance/money-format.js';
import UiMoreLink from '../../ui/MoreLink.vue';
import UiProgress from '../../ui/Progress.vue';
import ShareBar from '../charts/ShareBar.vue';
import { journalHref } from '../journal-href.js';
import { periodLabel } from '../period-label.js';
import ReportCard from '../ReportCard.vue';
import { comparisonText } from './comparison-text.js';

// The overview is always about the current period and today: tab filters do not apply.
const props = defineProps<{ budgetId: string; filters: ReportV2Filters }>();
const comparison = useAnalyticsReport('period-comparison');
const categories = useAnalyticsReport('expenses-by-category');
const accounts = useAnalyticsReport('account-balances');

const period = computed(() => comparison.rows.value[0] ?? null);

async function loadCategories() {
  const row = period.value;
  if (!row) return;
  await categories.load(props.budgetId, { from: row.periodStart, to: row.periodEnd });
}

async function load() {
  void accounts.load(props.budgetId);
  await comparison.load(props.budgetId);
  await loadCategories();
}
onMounted(() => void load());
watch(() => props.budgetId, () => void load());

const money = (minor: string) => formatMinorUnits(minor, 'RUB', 2);
const topCategories = computed(() =>
  categories.rows.value.slice(0, 5).map((row) => ({
    id: row.categoryId,
    label: row.categoryName,
    amountMinor: row.expenseMinor,
    shareBasisPoints: row.shareBasisPoints,
    href: journalHref(row as unknown as Record<string, unknown>),
  })),
);
</script>

<template>
  <div class="analytics-tab">
    <ReportCard
      title="Текущий период"
      :loading="comparison.loading.value"
      :error="comparison.error.value"
      :empty="period === null"
      @retry="load"
    >
      <div v-if="period" class="overview-period">
        <p class="overview-period__dates">{{ periodLabel(period.periodStart, period.periodEnd) }}</p>
        <p class="overview-period__label">Потрачено</p>
        <FinanceMoney class="overview-period__amount" :minor-units="period.spentMinor" currency="RUB" :scale="2" />
        <template v-if="period.limitTotalMinor !== null">
          <UiProgress
            :value="period.spentMinor"
            :max="period.limitTotalMinor"
            :label="`Потрачено ${money(period.spentMinor)} из лимита ${money(period.limitTotalMinor)}`"
          />
          <p class="overview-period__muted">из лимита на период {{ money(period.limitTotalMinor) }}</p>
        </template>
        <p v-else class="overview-period__muted">Лимит на период не задан</p>
        <p class="overview-period__compare">{{ comparisonText(period) }}</p>
      </div>
    </ReportCard>
    <ReportCard
      title="Куда уходят деньги"
      :loading="categories.loading.value"
      :error="categories.error.value"
      :empty="categories.rows.value.length === 0"
      empty-text="В этом периоде подтверждённых расходов пока нет."
      @retry="loadCategories"
    >
      <ShareBar :items="topCategories" />
      <UiMoreLink to="/app/analytics?tab=expenses">Все категории</UiMoreLink>
    </ReportCard>
    <ReportCard
      title="На счетах"
      :loading="accounts.loading.value"
      :error="accounts.error.value"
      :empty="accounts.rows.value.length === 0"
      empty-text="Добавьте счёт, чтобы видеть остатки."
      @retry="accounts.load(budgetId)"
    >
      <ul class="overview-accounts">
        <li v-for="row in accounts.rows.value" :key="row.accountId">
          <span>{{ row.name }}</span>
          <FinanceMoney :minor-units="row.balanceMinor" currency="RUB" :scale="2" />
        </li>
      </ul>
    </ReportCard>
  </div>
</template>

<style scoped>
.analytics-tab {
  display: grid;
  gap: var(--hf-space-5);
}
.overview-period {
  display: grid;
  gap: var(--hf-space-2);
}
.overview-period__dates,
.overview-period__label,
.overview-period__muted,
.overview-period__compare {
  margin: 0;
}
.overview-period__dates,
.overview-period__label,
.overview-period__muted {
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}
.overview-period__amount {
  font-size: var(--hf-font-size-h2);
  font-weight: var(--hf-font-weight-semibold);
  font-variant-numeric: tabular-nums;
}
.overview-accounts {
  display: grid;
  gap: var(--hf-space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}
.overview-accounts li {
  display: flex;
  justify-content: space-between;
  gap: var(--hf-space-3);
  min-height: var(--hf-control-height-sm);
  align-items: center;
  font-variant-numeric: tabular-nums;
}
</style>
```

Проверить, как `UiMoreLink` принимает текст (слот или prop) — `apps/web/app/components/ui/MoreLink.vue`; использовать его API.

`tabs/CashFlowTab.vue` — каркас как у `ExpensesTab`, отчёты `net-cash-flow` и `plan-vs-actual`:

```ts
const flow = useAnalyticsReport('net-cash-flow');
const plans = useAnalyticsReport('plan-vs-actual');

function signed(minor: string) {
  const negative = minor.startsWith('-');
  const amount = formatMinorUnits(negative ? minor.slice(1) : minor, 'RUB', 2);
  return minor === '0' ? amount : `${negative ? '−' : '+'}${amount}`;
}

const cycleColumns = computed(() =>
  flow.rows.value.map((row) => ({
    id: row.cycleStart,
    label: periodLabel(row.cycleStart, row.cycleEnd),
    values: [
      { seriesId: 'income', amountMinor: row.incomeMinor },
      { seriesId: 'expense', amountMinor: row.expenseMinor },
    ],
    caption: signed(row.netCashFlowMinor),
  })),
);
```

Шаблон: `ReportCard title="Доходы и расходы по циклам"` с `<ColumnChart label="Доходы и расходы" :columns="cycleColumns" :series="[{ id: 'income', label: 'Доходы', tone: 2 }, { id: 'expense', label: 'Расходы', tone: 1 }]" />` и под графиком строка `<p class="cash-flow__hint">Под каждым циклом — доходы минус расходы.</p>`; `ReportCard title="Регулярные платежи: план и факт"` с `<PlanVsActualReport :rows="plans.rows.value" />`.

`tabs/EnvelopesTab.vue`:

```ts
const limits = useAnalyticsReport('envelope-limits');
const movements = useAnalyticsReport('assignment-movements');
const selected = ref('');

const periodOptions = computed(() => {
  const seen = new Map<string, { value: string; label: string }>();
  for (const row of limits.rows.value) {
    const value = `${row.periodStart}:${row.periodEnd}`;
    if (!seen.has(value)) {
      seen.set(value, {
        value,
        label: `${periodLabel(row.periodStart, row.periodEnd)}${row.isCurrent ? ' (текущий)' : ''}`,
      });
    }
  }
  return [...seen.values()];
});

watch(
  () => limits.rows.value,
  (rows) => {
    const current = rows.find((row) => row.isCurrent) ?? rows[0];
    selected.value = current ? `${current.periodStart}:${current.periodEnd}` : '';
  },
);

const visible = computed(() =>
  limits.rows.value.filter((row) => `${row.periodStart}:${row.periodEnd}` === selected.value),
);
```

`load()` вызывает `limits.load` и `movements.load` с `props.filters`. Шаблон: `ReportCard title="Лимиты на период"` (`:empty="limits.rows.value.length === 0"`, `empty-text="Нет конвертов «На текущие траты» с периодами в выбранных датах."`) с `<template #actions><UiSelect v-model="selected" name="limitPeriod" label="Период" :options="periodOptions" /></template>` и `<LimitBar v-for="row in visible" :key="row.periodId" :row="row" />`; `ReportCard title="Распределения и переносы"` с `<ReportTable :rows="movements.rows.value" hide-journal />`.

`tabs/SavingsTab.vue` — один отчёт `savings-goals`, `ReportCard title="Накопления"` (`:empty="false"` — пустое состояние рисует сам `GoalProgressReport`), внутри `<GoalProgressReport :rows="goals.rows.value as unknown as GoalProgressRowDto[]" />`. Если двойной заголовок «Накопления» (карточка и `GoalProgressReport`) мешает — у `ReportCard` для этой вкладки передать `title` «Прогресс накоплений».

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @harmofin/web exec vitest run app/components/analytics`
Expected: PASS.
Run: `pnpm --filter @harmofin/web typecheck && pnpm --filter @harmofin/web lint`
Expected: без ошибок.

- [ ] **Step 5: Commit (только с одобрения владельца)**

```bash
git add apps/web/app/components/analytics/ReportCard.vue apps/web/app/components/analytics/ReportCard.test.ts apps/web/app/components/analytics/tabs
git commit -m "feat(web): вкладки аналитики с графиками"
```

---

### Task 6: Страница аналитики (web)

**Files:**
- Rewrite: `apps/web/app/pages/app/analytics.vue`
- Rewrite: `apps/web/app/pages/app/analytics.test.ts`
- Modify: `apps/web/app/components/analytics/ReportFilters.vue`, `ReportFilters.test.ts`

**Interfaces:**
- Consumes: `UiTabs`, все вкладки Task 5, `ReportFilters`, `FilterPanel`, `ReferencePageLayout`, `ExportPanelV2`, `useAuth`, `useBudgetReferenceData().listAccounts/listCategories`, `useEnvelopePlanV2().listEnvelopes`.
- Produces:
  - `ReportFilters` prop `fields?: ReadonlyArray<keyof AnalyticsFilters>` (по умолчанию все пять).
  - Экспорт из страницы не нужен; поведение URL: `?tab=<id>&from&to&accountId&categoryId&envelopeId`.

- [ ] **Step 1: Write the failing tests**

`ReportFilters.test.ts` — добавить:

```ts
it('показывает только поля вкладки', () => {
  const wrapper = mount(ReportFilters, {
    props: {
      modelValue: { from: '', to: '', accountId: '', categoryId: '', envelopeId: '' },
      fields: ['envelopeId', 'to'],
    },
  });
  expect(wrapper.find('[name="envelopeId"]').exists()).toBe(true);
  expect(wrapper.find('[name="to"]').exists()).toBe(true);
  expect(wrapper.find('[name="from"]').exists()).toBe(false);
  expect(wrapper.find('[name="accountId"]').exists()).toBe(false);
});
```

(Если `UiDatePicker` не прокидывает `name` в DOM, проверять по `label` так, как это делает существующий `ReportFilters.test.ts`.)

`analytics.test.ts` — переписать. Моки `#imports`, `useAuth`, `useEnvelopePlanV2`, `useBudgetReferenceData` оставить как сейчас; добавить заглушки вкладок, чтобы тест страницы не зависел от их загрузки:

```ts
const tabStub = (name: string) => ({
  name,
  props: ['budgetId', 'filters'],
  template: `<div data-tab="${name}">{{ JSON.stringify(filters) }}</div>`,
});
vi.mock('../../components/analytics/tabs/OverviewTab.vue', () => ({ default: tabStub('overview') }));
vi.mock('../../components/analytics/tabs/ExpensesTab.vue', () => ({ default: tabStub('expenses') }));
vi.mock('../../components/analytics/tabs/CashFlowTab.vue', () => ({ default: tabStub('cash-flow') }));
vi.mock('../../components/analytics/tabs/EnvelopesTab.vue', () => ({ default: tabStub('envelopes') }));
vi.mock('../../components/analytics/tabs/SavingsTab.vue', () => ({ default: tabStub('savings') }));
```

Тесты:

```ts
import { navigateTo } from '#imports';

describe('analytics page', () => {
  beforeEach(() => {
    route.query = {};
    vi.clearAllMocks();
    workspaceRow.role = 'OWNER';
    v2.listEnvelopes.mockResolvedValue({ items: [] });
    api.listAccounts.mockResolvedValue([]);
    api.listCategories.mockResolvedValue([]);
  });

  it('по умолчанию открыт обзор, вкладок пять', async () => {
    const wrapper = mount(AnalyticsPage, { global });
    await flushPromises();
    expect(wrapper.findAll('[role="tab"]').map((tab) => tab.text())).toEqual([
      'Обзор',
      'Расходы',
      'Доходы и расходы',
      'Конверты',
      'Накопления',
    ]);
    expect(wrapper.find('[data-tab="overview"]').exists()).toBe(true);
  });

  it('вкладка из ?tab=, фильтры передаются только применимые к вкладке', async () => {
    route.query = { tab: 'envelopes', from: '2026-03-01', accountId: 'acc', envelopeId: 'env' };
    const wrapper = mount(AnalyticsPage, { global });
    await flushPromises();
    expect(wrapper.get('[data-tab="envelopes"]').text()).toBe(
      JSON.stringify({ from: '2026-03-01', envelopeId: 'env' }),
    );
  });

  it('обзор не показывает панель фильтров', async () => {
    const wrapper = mount(AnalyticsPage, { global });
    await flushPromises();
    expect(wrapper.find('[aria-label="Фильтры аналитики"]').exists()).toBe(false);
  });

  it('старая ссылка ?report= переводится на вкладку', async () => {
    route.query = { report: 'plan-vs-actual', from: '2026-03-01' };
    const wrapper = mount(AnalyticsPage, { global });
    await flushPromises();
    expect(wrapper.find('[data-tab="cash-flow"]').exists()).toBe(true);
    expect(navigateTo).toHaveBeenCalledWith(
      { query: { tab: 'cash-flow', from: '2026-03-01' } },
      { replace: true },
    );
  });

  it('неизвестные tab и report дают обзор', async () => {
    route.query = { tab: 'nope', report: 'nope' };
    const wrapper = mount(AnalyticsPage, { global });
    await flushPromises();
    expect(wrapper.find('[data-tab="overview"]').exists()).toBe(true);
  });

  it('переключение вкладки пишет её в URL, фильтры сохраняются', async () => {
    route.query = { from: '2026-03-01' };
    const wrapper = mount(AnalyticsPage, { global });
    await flushPromises();
    await wrapper.findAll('[role="tab"]')[1]!.trigger('click');
    expect(navigateTo).toHaveBeenLastCalledWith(
      { query: { tab: 'expenses', from: '2026-03-01' } },
      { replace: true },
    );
    expect(wrapper.find('[data-tab="expenses"]').exists()).toBe(true);
  });

  it('без бюджета — пустое состояние', async () => {
    auth.currentData.value = { workspaces: [] } as never;
    const wrapper = mount(AnalyticsPage, { global });
    await flushPromises();
    expect(wrapper.text()).toContain('Бюджет не выбран');
    auth.currentData.value = { workspaces: [workspaceRow] };
  });

  it('выгрузка остаётся под вкладками', async () => {
    const wrapper = mount(AnalyticsPage, { global });
    await flushPromises();
    expect(wrapper.findComponent({ name: 'ExportPanelV2' }).exists()).toBe(true);
  });
});
```

Существующие тесты выгрузки CSV из старого `analytics.test.ts` (вызовы `exportTransactions`/`exportAssignments`) перенести без изменений, если они проверяют страницу; если они проверяют только `ExportPanelV2` — оставить их в тесте этого компонента.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @harmofin/web exec vitest run app/pages/app/analytics.test.ts app/components/analytics/ReportFilters.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`ReportFilters.vue` — добавить prop и `v-if` на каждое поле:

```ts
const props = withDefaults(
  defineProps<{
    modelValue: AnalyticsFilters;
    accounts?: ReadonlyArray<{ value: string; label: string }>;
    categories?: ReadonlyArray<{ value: string; label: string }>;
    envelopes?: ReadonlyArray<{ value: string; label: string }>;
    fields?: ReadonlyArray<keyof AnalyticsFilters>;
  }>(),
  { fields: () => ['from', 'to', 'accountId', 'categoryId', 'envelopeId'] },
);
const shown = (field: keyof AnalyticsFilters) => props.fields.includes(field);
```

В шаблоне: `v-if="shown('from')"` и т. д. на каждом `UiDatePicker`/`UiSelect`.

`analytics.vue`:

```vue
<script setup lang="ts">
import { computed, onMounted, ref, type Component } from 'vue';
import { definePageMeta, navigateTo, useRoute } from '#imports';

import ExportPanelV2 from '../../components/analytics/ExportPanelV2.vue';
import ReportFilters, { type AnalyticsFilters } from '../../components/analytics/ReportFilters.vue';
import CashFlowTab from '../../components/analytics/tabs/CashFlowTab.vue';
import EnvelopesTab from '../../components/analytics/tabs/EnvelopesTab.vue';
import ExpensesTab from '../../components/analytics/tabs/ExpensesTab.vue';
import OverviewTab from '../../components/analytics/tabs/OverviewTab.vue';
import SavingsTab from '../../components/analytics/tabs/SavingsTab.vue';
import FilterPanel from '../../components/ui/FilterPanel.vue';
import ReferencePageLayout from '../../components/ui/ReferencePageLayout.vue';
import UiEmptyState from '../../components/ui/EmptyState.vue';
import UiTabs from '../../components/ui/Tabs.vue';
import { useAuth } from '../../composables/useAuth.js';
import { useBudgetReferenceData } from '../../composables/useBudgetReferenceData.js';
import { type ReportV2Filters, useEnvelopePlanV2 } from '../../composables/useEnvelopePlanV2.js';

defineOptions({ name: 'BudgetAnalyticsPage' });
definePageMeta({ middleware: 'auth', layout: 'app' });

type TabId = 'overview' | 'expenses' | 'cash-flow' | 'envelopes' | 'savings';
type FilterName = keyof AnalyticsFilters;

const TABS: ReadonlyArray<{ id: TabId; label: string; component: Component; filters: FilterName[] }> = [
  { id: 'overview', label: 'Обзор', component: OverviewTab, filters: [] },
  { id: 'expenses', label: 'Расходы', component: ExpensesTab, filters: ['from', 'to', 'accountId', 'envelopeId'] },
  { id: 'cash-flow', label: 'Доходы и расходы', component: CashFlowTab, filters: ['from', 'to', 'accountId', 'categoryId'] },
  { id: 'envelopes', label: 'Конверты', component: EnvelopesTab, filters: ['from', 'to', 'envelopeId'] },
  { id: 'savings', label: 'Накопления', component: SavingsTab, filters: ['envelopeId', 'to'] },
];

// Shared links from the report-list page keep working: each old key opens its tab.
const LEGACY_REPORT_TABS: Record<string, TabId> = {
  'account-balances': 'overview',
  'expenses-by-category': 'expenses',
  'expenses-by-period': 'expenses',
  'expenses-by-cycle': 'expenses',
  'incomes-by-cycle': 'cash-flow',
  'net-cash-flow': 'cash-flow',
  'plan-vs-actual': 'cash-flow',
  'assignment-movements': 'envelopes',
  'savings-goals': 'savings',
};
const FILTER_NAMES: FilterName[] = ['from', 'to', 'accountId', 'categoryId', 'envelopeId'];

const auth = useAuth();
const route = useRoute();
const api = useBudgetReferenceData();
const v2 = useEnvelopePlanV2();
const loading = ref(true);
const legacy = typeof route.query.report === 'string';
const tab = ref<TabId>(tabFromQuery());
const filters = ref<AnalyticsFilters>(filtersFromQuery());
const accounts = ref<Array<{ value: string; label: string }>>([]);
const categories = ref<Array<{ value: string; label: string }>>([]);
const envelopes = ref<Array<{ value: string; label: string }>>([]);
const budget = computed(() => auth.currentData.value?.workspaces[0]?.budgets[0] ?? null);
const isOwner = computed(() => auth.currentData.value?.workspaces[0]?.role === 'OWNER');
const activeTab = computed(() => TABS.find((item) => item.id === tab.value) ?? TABS[0]!);

/** Only the filters of the active tab reach its reports; the others stay in the URL. */
const tabFilters = computed<ReportV2Filters>(() => {
  const result: ReportV2Filters = {};
  for (const name of activeTab.value.filters) {
    if (filters.value[name]) result[name] = filters.value[name];
  }
  return result;
});
const activeFilterCount = computed(() => Object.keys(tabFilters.value).length);

function tabFromQuery(): TabId {
  const value = route.query.tab;
  if (typeof value === 'string' && TABS.some((item) => item.id === value)) return value as TabId;
  const report = route.query.report;
  if (typeof report === 'string' && report in LEGACY_REPORT_TABS) return LEGACY_REPORT_TABS[report]!;
  return 'overview';
}

function filtersFromQuery(): AnalyticsFilters {
  const value = (name: string) =>
    typeof route.query[name] === 'string' ? (route.query[name] as string) : '';
  return {
    from: value('from'),
    to: value('to'),
    accountId: value('accountId'),
    categoryId: value('categoryId'),
    envelopeId: value('envelopeId'),
  };
}

function syncUrl() {
  const query: Record<string, string> = { tab: tab.value };
  for (const name of FILTER_NAMES) if (filters.value[name]) query[name] = filters.value[name];
  void navigateTo({ query }, { replace: true });
}

function selectTab(value: string) {
  tab.value = value as TabId;
  syncUrl();
}

function updateFilters(value: AnalyticsFilters) {
  filters.value = value;
  syncUrl();
}

onMounted(async () => {
  if (legacy) syncUrl();
  if (!budget.value) await auth.loadMe();
  if (!budget.value) {
    loading.value = false;
    return;
  }
  const budgetId = budget.value.id;
  try {
    const [accountData, categoryData, envelopeData] = await Promise.all([
      api.listAccounts(budgetId, 'active'),
      api.listCategories(budgetId, undefined, 'active'),
      v2.listEnvelopes(budgetId),
    ]);
    accounts.value = accountData.map((item) => ({ value: item.id, label: item.name }));
    categories.value = categoryData.map((item) => ({ value: item.id, label: item.name }));
    envelopes.value = envelopeData.items
      .filter((item) => item.archivedAt === null)
      .map((item) => ({ value: item.id, label: item.name }));
  } catch {
    // Filter options are optional: reports still load, the selects only offer "Все …".
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="analytics-page">
    <UiEmptyState
      v-if="!loading && !budget"
      title="Бюджет не выбран"
      description="Выберите активный бюджет для просмотра отчётов."
    />
    <ReferencePageLayout v-else>
      <template #kicker>Аналитика</template>
      <template #title>Отчёты бюджета</template>
      <template #filters>
        <FilterPanel v-if="activeTab.filters.length > 0" :active-count="activeFilterCount">
          <ReportFilters
            :model-value="filters"
            :fields="activeTab.filters"
            :accounts="accounts"
            :categories="categories"
            :envelopes="envelopes"
            @update:model-value="updateFilters"
          />
        </FilterPanel>
      </template>
      <template #content>
        <UiTabs
          v-if="budget"
          :model-value="tab"
          :tabs="TABS"
          label="Разделы аналитики"
          @update:model-value="selectTab"
        >
          <component
            :is="activeTab.component"
            :key="activeTab.id"
            :budget-id="budget.id"
            :filters="tabFilters"
          />
        </UiTabs>
        <ExportPanelV2 v-if="budget" :budget-id="budget.id" :is-owner="isOwner" />
      </template>
    </ReferencePageLayout>
  </div>
</template>

<style scoped>
.analytics-page {
  display: grid;
}
</style>
```

Перед реализацией проверить в `ReferencePageLayout.vue`, что слот `#filters` можно оставить пустым (вкладка «Обзор»); если пустой слот рисует пустую обёртку — передавать слот через `v-if` на `<template #filters v-if="…">`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @harmofin/web exec vitest run app/pages/app/analytics.test.ts app/components/analytics app/components/ui`
Expected: PASS.
Run: `pnpm --filter @harmofin/web typecheck && pnpm --filter @harmofin/web lint`
Expected: без ошибок.

- [ ] **Step 5: Commit (только с одобрения владельца)**

```bash
git add apps/web/app/pages/app/analytics.vue apps/web/app/pages/app/analytics.test.ts apps/web/app/components/analytics/ReportFilters.vue apps/web/app/components/analytics/ReportFilters.test.ts
git commit -m "feat(web): страница аналитики из пяти вкладок"
```

---

### Task 7: Удаление ECharts, документация и полная проверка

**Files:**
- Delete: `apps/web/app/components/analytics/ReportChart.vue`, `ReportChart.test.ts`
- Modify: `apps/web/package.json`, `pnpm-lock.yaml`, `apps/web/nuxt.config.ts`
- Modify: `apps/web/app/pages/index.build-chunks.test.ts` (комментарий), `e2e/playwright.config.ts` (комментарий)
- Modify: `docs/superpowers/specs/2026-08-30-family-budget-development-spec.md`

**Interfaces:**
- Consumes: всё выше. После задачи в `apps/web/app` нет импортов `echarts`.

- [ ] **Step 1: Убедиться, что ECharts больше не используется**

Run: `grep -rn "echarts\|ReportChart" apps/web/app --include=*.vue --include=*.ts`
Expected: только `ReportChart.vue`, `ReportChart.test.ts` и комментарий в `index.build-chunks.test.ts`.

- [ ] **Step 2: Удалить компонент и зависимость**

```bash
git rm apps/web/app/components/analytics/ReportChart.vue apps/web/app/components/analytics/ReportChart.test.ts
pnpm --filter @harmofin/web remove echarts
```

`nuxt.config.ts`: из `optimizeDeps.include` убрать `'echarts'`; удалить `manualChunks` целиком (он существовал только для `charts-vendor`), `hoistTransitiveImports: false` оставить.

`index.build-chunks.test.ts` — комментарий: заменить фразы про загрузку `echarts` страницей аналитики на «Графики приложения — собственные SVG-компоненты; тест защищает лендинг от появления тяжёлой библиотеки графиков в будущем». Логику теста не менять.

`e2e/playwright.config.ts` — комментарий про analytics/echarts заменить на нейтральный: «первый визит на маршрут dev-сервера платит за компиляцию по требованию; более долгое ожидание ничего не стоит на успешном прогоне».

- [ ] **Step 3: Обновить development-спецификацию**

В `docs/superpowers/specs/2026-08-30-family-budget-development-spec.md`:
- в таблице стека строку `| Графики | ECharts |` → `| Графики | Собственные SVG-компоненты (`apps/web/app/components/analytics/charts`) |`;
- фразу «Для аналитики используется ECharts или совместимая библиотека с управляемой доступностью.» → «Для аналитики используются собственные SVG-компоненты без внешней библиотеки графиков: значения всегда продублированы текстом, цвета берутся из токенов темы.»;
- строку `ECharts` в списке технологий около строки 1725 удалить или заменить так же (прочитать контекст перед правкой).

Run: `grep -n "ECharts\|echarts" docs/superpowers/specs/2026-08-30-family-budget-development-spec.md`
Expected: пусто.

- [ ] **Step 4: Полная проверка**

Run по очереди:
- `pnpm format:check`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:integration` (нужна локальная БД `pnpm infra:up`)
- `pnpm build`
- `pnpm --filter @harmofin/web exec vitest run app/pages/index.build-chunks.test.ts` (после сборки тест не пропускается)

Expected: всё зелёное. Упавшую несвязанную проверку не чинить — записать в отчёт задачи.

Run: `git status --short` и `git diff --stat`
Expected: изменены только файлы этого плана и `openapi.json`; `identity/logo_description.png` не тронут.

- [ ] **Step 5: Сценарий визуальной проверки для CI/владельца**

Локальный Playwright и браузер не запускаются без прямой просьбы владельца. В отчёт задачи записать сценарий ручной проверки: вкладки на 375px (горизонтальная прокрутка, без переноса), тёмная тема (контраст подписей, цвет перерасхода), клавиатура по вкладкам (стрелки, Home/End, видимый фокус), переход по категории в журнал, старая ссылка `/app/analytics?report=net-cash-flow`.

- [ ] **Step 6: Commit (только с одобрения владельца)**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/nuxt.config.ts apps/web/app/pages/index.build-chunks.test.ts e2e/playwright.config.ts docs/superpowers/specs/2026-08-30-family-budget-development-spec.md
git commit -m "chore(web): убрать echarts, графики аналитики на SVG"
```

---

## Ревью

По матрице маршрутизации (`docs/superpowers/specs/2026-09-29-development-agent-team-design.md`):

- Task 1–2: Financial (формулы `spentPermille`, `deltaBasisPoints`, `shareBasisPoints`, окно «к этому дню»), Security (изоляция `budget_id`, 404 на чужие фильтры, 400 на неприменимые), API (новые ключи, DTO, `openapi.json`, совместимость `/api/v2`), QA.
- Task 3–6: UI/UX (Calm Fintech, токены, доступность вкладок и графиков, тексты по глоссарию), QA.
- Task 7: QA и final review всего изменения.
- Financial или Security `BLOCK` снимается только исправлением writer и повторным ревью.
