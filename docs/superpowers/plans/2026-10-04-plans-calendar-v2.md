# Планы v2: календарь по дням — план реализации

> **Для исполнителя:** использовать superpowers:subagent-driven-development (рекомендуется) или superpowers:executing-plans. Шаги отмечены чекбоксами `- [ ]`.

**Цель:** вернуть на странице «Планы» календарь месяца с фактами и планами по дням, панелью дня, четырьмя плитками и списком «Ближайшие / Все» для модели Envelope Plan v2.2.

**Архитектура:** новое серверное чтение `GET /api/v2/budgets/:budgetId/plans/calendar?month=YYYY-MM` (additive) отдаёт суммы по дням, occurrences месяца, просрочки и итоги плиток строками minor units. Веб только отображает: компоненты `PlansCalendar`, `PlanDayPanel`, `PlanKpiRow`, `PlanItemList` подключаются в `plans.vue`, который остаётся владельцем состояния, листов оплаты/пропуска/записи дохода и `PlanCreateDialog`. Факты выбранного дня берутся из существующего журнала операций.

**Стек:** NestJS 11/Fastify, Prisma, Zod, Vitest, Supertest-стиль (`server.inject`); Nuxt 4/Vue 3.5, `date-fns`, `@lucide/vue`.

**Дизайн:** [2026-10-04-plans-calendar-v2-design.md](../specs/2026-10-04-plans-calendar-v2-design.md). Исполнитель читает дизайн и этот план.

## Общие ограничения (действуют для каждой задачи)

- Рабочая папка `D:\Projects\playground\family_budget`, ветка `feat/envelope-v22-foundation`, текущий checkout, без worktree. Один писатель.
- Деньги: браузер не считает. Серверные суммы строками minor units; на сервере `BigInt`. Допустимо только форматирование в вебе (`formatCompactSigned`, `FinanceMoney`).
- Только `CONFIRMED` и не удалённые операции входят в факты. Переводы в факты дня не входят.
- Каждый запрос фильтрует `budget_id` в самой БД; проверка цепочки доступа через `PlanModelPolicy.requireModel(userId, budgetId, 2)` (404 для чужого, 409 `MODEL_VERSION_MISMATCH` для v1).
- Правила `/api/v1` не ломаются. OpenAPI описывает запрос, ответ и ошибки нового маршрута.
- Интеграционные тесты API только на БД `harmofin_v22_test`, рабочую БД `harmofin` не трогать.
- Тексты интерфейса на русском, идентификаторы на английском. Только существующие токены Calm Fintech (`--hf-*`), без новых цветов. Читать [Calm Fintech](../specs/2026-09-17-calm-fintech-visual-guidelines.md) перед правкой UI.
- Не запускать Playwright и браузер. e2e-сценарии только писать (владелец запускает `pnpm test:e2e`).
- Не коммитить, не пушить, не деплоить без явного согласия владельца. Не трогать `CLAUDE.md`, `identity/*`, `docs/runbooks/budget-reset.sql`.
- В рабочем дереве могут быть чужие незакоммиченные правки (`apps/api/src/plans/*`, `apps/api/src/obligations/*`, `apps/api/test/*`): не менять и не откатывать то, что не относится к задаче. Перед правкой общего файла (`obligation-plan.repository.ts`, `income-plan-v2.repository.ts`) выполнить `git diff <файл>` и сохранить чужие изменения.
- Проверки после каждой задачи API: `cd apps/api && pnpm exec vitest run <файл>`, из корня `pnpm typecheck` и `pnpm exec prettier --check <файлы>`. Проверки задач web: `cd apps/web && pnpm exec vitest run <файлы>`, `pnpm exec eslint app`, `pnpm typecheck`.

## Структура файлов

| Файл | Действие |
| --- | --- |
| `apps/api/src/plans-calendar/plans-calendar.schemas.ts` | создать: Zod-схема `month` |
| `apps/api/src/plans-calendar/plans-calendar.domain.ts` | создать: чистая логика окна месяца, просрочки, дней, итогов |
| `apps/api/src/plans-calendar/plans-calendar.domain.test.ts` | создать |
| `apps/api/src/plans-calendar/plans-calendar.repository.ts` | создать: факты по дням, число активных планов |
| `apps/api/src/plans-calendar/plans-calendar.application.service.ts` | создать: сборка ответа в снимке |
| `apps/api/src/plans-calendar/plans-calendar.dto.ts` | создать: OpenAPI-классы ответа |
| `apps/api/src/plans-calendar/plans-calendar.controller.ts` | создать |
| `apps/api/src/plans-calendar/plans-calendar.module.ts` | создать |
| `apps/api/src/app.module.ts` | изменить: подключить модуль |
| `apps/api/src/obligations/obligation-plan.repository.ts` | изменить: экспорт `mandatoryPlanFilter`, необязательный `statuses` в `OccurrenceListFilter` |
| `apps/api/src/plans/income-plan-v2.repository.ts` | изменить: экспорт `incomePlanFilter` |
| `apps/api/test/v2-plans-calendar.integration.test.ts` | создать |
| `apps/api/test/v2-openapi.integration.test.ts` | изменить: добавить маршрут в `EXPECTED_V2` |
| `apps/web/app/composables/useEnvelopePlanV2.ts` | изменить: типы и `getPlansCalendar` |
| `apps/web/app/components/plans/calendar-grid.ts` (+ `.test.ts`) | создать |
| `apps/web/app/components/plans/PlansCalendar.vue` (+ `.test.ts`) | создать |
| `apps/web/app/components/plans/PlanKpiRow.vue` (+ `.test.ts`) | создать |
| `apps/web/app/components/plans/PlanDayPanel.vue` (+ `.test.ts`) | создать |
| `apps/web/app/components/plans/PlanItemList.vue` (+ `.test.ts`) | создать |
| `apps/web/app/pages/app/plans.vue` | изменить: календарь вместо двух списков |
| `apps/web/app/pages/app/plans.test.ts` | изменить |
| `e2e/envelope-v2-plans.spec.ts`, `e2e/envelope-v2-payments.spec.ts` | изменить селекторы и добавить сценарий календаря; не запускать |
| `docs/superpowers/plans/2026-10-03-envelope-v2.2-open-decisions.md`, `docs/ux/newcomer-walkthrough.md` | изменить |

Образцы: чтение с снимком и `SET TRANSACTION READ ONLY` — `apps/api/src/v2-dashboard/dashboard-v2.application.service.ts:140-147`; регистрация модуля — `dashboard-v2.module.ts`; контроллер — `dashboard-v2.controller.ts`; интеграционный тест (мир, регистрация, очистка) — `apps/api/test/v2-dashboard.integration.test.ts` (функции `register`, `world`, `occurrence`, `expense`, `cleanupUser`).

---

## T01. Чистая логика календаря (домен)

**Files:** создать `apps/api/src/plans-calendar/plans-calendar.schemas.ts`, `plans-calendar.domain.ts`, `plans-calendar.domain.test.ts`.

**Interfaces — produces:**

```ts
export const plansCalendarQuerySchema; // { month: 'YYYY-MM' }
export type PlansCalendarQuery = { month: string };
export type CalendarItemKind = 'OBLIGATION' | 'INCOME_PLAN';
export type CalendarDot = 'upcoming' | 'overdue';
export interface MonthWindow { from: string; to: string }
export function monthWindow(month: string): MonthWindow;
export function previousDay(date: string): string;
export function isOpenStatus(status: string): boolean;
export function isOverdue(kind: CalendarItemKind, status: string, scheduledOn: string, today: string): boolean;
export interface PlannedItem { kind: CalendarItemKind; status: string; scheduledOn: string; expectedMinor: bigint }
export function plannedTotals(items: readonly PlannedItem[]): { plannedIncomeMinor: bigint; plannedExpenseMinor: bigint; balanceMinor: bigint };
export interface FactRow { date: string; type: 'INCOME' | 'EXPENSE'; amountMinor: bigint }
export interface CalendarDay { date: string; incomeMinor: bigint; expenseMinor: bigint; dot: CalendarDot | null }
export function buildDays(facts: readonly FactRow[], items: ReadonlyArray<Pick<PlannedItem, 'kind' | 'status' | 'scheduledOn'>>, today: string): CalendarDay[];
```

- [ ] **Step 1: схема (без теста, тривиальна, покрывается интеграционным тестом T03).** Создать `plans-calendar.schemas.ts`:

```ts
import { z } from 'zod';

export const plansCalendarQuerySchema = z
  .object({
    month: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Укажите месяц в формате ГГГГ-ММ.')
      .refine((value) => {
        const year = Number(value.slice(0, 4));
        return year >= 2000 && year <= 2100;
      }, 'Год должен быть от 2000 до 2100.'),
  })
  .strict();

export type PlansCalendarQuery = z.infer<typeof plansCalendarQuerySchema>;
```

- [ ] **Step 2: красный тест** `plans-calendar.domain.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  buildDays,
  isOpenStatus,
  isOverdue,
  monthWindow,
  plannedTotals,
  previousDay,
} from './plans-calendar.domain.js';

describe('monthWindow', () => {
  it('returns inclusive first and last day', () => {
    expect(monthWindow('2026-09')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(monthWindow('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthWindow('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(monthWindow('2026-12')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });
});

describe('previousDay', () => {
  it('crosses month and year boundaries', () => {
    expect(previousDay('2026-09-24')).toBe('2026-09-23');
    expect(previousDay('2026-03-01')).toBe('2026-02-28');
    expect(previousDay('2026-01-01')).toBe('2025-12-31');
  });
});

describe('overdue', () => {
  it('open statuses are PENDING and DUE', () => {
    expect(isOpenStatus('PENDING')).toBe(true);
    expect(isOpenStatus('DUE')).toBe(true);
    for (const status of ['SKIPPED', 'COMPLETED', 'CANCELLED']) {
      expect(isOpenStatus(status)).toBe(false);
    }
  });

  it('only an open obligation before today is overdue', () => {
    expect(isOverdue('OBLIGATION', 'DUE', '2026-09-23', '2026-09-24')).toBe(true);
    expect(isOverdue('OBLIGATION', 'DUE', '2026-09-24', '2026-09-24')).toBe(false);
    expect(isOverdue('OBLIGATION', 'COMPLETED', '2026-09-01', '2026-09-24')).toBe(false);
    expect(isOverdue('OBLIGATION', 'SKIPPED', '2026-09-01', '2026-09-24')).toBe(false);
    expect(isOverdue('INCOME_PLAN', 'PENDING', '2026-09-01', '2026-09-24')).toBe(false);
  });
});

describe('plannedTotals', () => {
  it('sums expected amounts without cancelled and skipped, keeping completed', () => {
    const totals = plannedTotals([
      { kind: 'INCOME_PLAN', status: 'PENDING', scheduledOn: '2026-09-25', expectedMinor: 10_000_000n },
      { kind: 'INCOME_PLAN', status: 'CANCELLED', scheduledOn: '2026-09-26', expectedMinor: 999n },
      { kind: 'OBLIGATION', status: 'DUE', scheduledOn: '2026-09-10', expectedMinor: 300_000n },
      { kind: 'OBLIGATION', status: 'COMPLETED', scheduledOn: '2026-09-11', expectedMinor: 4_000_000n },
      { kind: 'OBLIGATION', status: 'SKIPPED', scheduledOn: '2026-09-12', expectedMinor: 777n },
    ]);
    expect(totals).toEqual({
      plannedIncomeMinor: 10_000_000n,
      plannedExpenseMinor: 4_300_000n,
      balanceMinor: 5_700_000n,
    });
  });

  it('balance can be negative and empty input is zero', () => {
    expect(plannedTotals([])).toEqual({ plannedIncomeMinor: 0n, plannedExpenseMinor: 0n, balanceMinor: 0n });
    expect(
      plannedTotals([
        { kind: 'OBLIGATION', status: 'DUE', scheduledOn: '2026-09-10', expectedMinor: 500n },
      ]).balanceMinor,
    ).toBe(-500n);
  });
});

describe('buildDays', () => {
  it('merges facts per day, adds dots, sorts by date and drops empty days', () => {
    const days = buildDays(
      [
        { date: '2026-09-05', type: 'EXPENSE', amountMinor: 600_000n },
        { date: '2026-09-05', type: 'INCOME', amountMinor: 4_300_000n },
        { date: '2026-09-02', type: 'EXPENSE', amountMinor: 100n },
      ],
      [
        { kind: 'OBLIGATION', status: 'DUE', scheduledOn: '2026-09-05' },
        { kind: 'OBLIGATION', status: 'DUE', scheduledOn: '2026-09-10' },
        { kind: 'OBLIGATION', status: 'PENDING', scheduledOn: '2026-09-30' },
        { kind: 'INCOME_PLAN', status: 'PENDING', scheduledOn: '2026-09-25' },
        { kind: 'OBLIGATION', status: 'COMPLETED', scheduledOn: '2026-09-12' },
      ],
      '2026-09-24',
    );
    expect(days).toEqual([
      { date: '2026-09-02', incomeMinor: 0n, expenseMinor: 100n, dot: null },
      { date: '2026-09-05', incomeMinor: 4_300_000n, expenseMinor: 600_000n, dot: 'overdue' },
      { date: '2026-09-10', incomeMinor: 0n, expenseMinor: 0n, dot: 'overdue' },
      { date: '2026-09-25', incomeMinor: 0n, expenseMinor: 0n, dot: 'upcoming' },
      { date: '2026-09-30', incomeMinor: 0n, expenseMinor: 0n, dot: 'upcoming' },
    ]);
  });

  it('overdue wins over upcoming on the same day', () => {
    const days = buildDays(
      [],
      [
        { kind: 'INCOME_PLAN', status: 'PENDING', scheduledOn: '2026-09-10' },
        { kind: 'OBLIGATION', status: 'DUE', scheduledOn: '2026-09-10' },
      ],
      '2026-09-24',
    );
    expect(days).toEqual([{ date: '2026-09-10', incomeMinor: 0n, expenseMinor: 0n, dot: 'overdue' }]);
  });
});
```

- [ ] **Step 3: красный запуск.** `cd apps/api && pnpm exec vitest run src/plans-calendar/plans-calendar.domain.test.ts`. Ожидается: не найден `plans-calendar.domain.js`.

- [ ] **Step 4: реализация** `plans-calendar.domain.ts`:

```ts
export type CalendarItemKind = 'OBLIGATION' | 'INCOME_PLAN';
export type CalendarDot = 'upcoming' | 'overdue';

export interface MonthWindow {
  from: string;
  to: string;
}

export interface PlannedItem {
  kind: CalendarItemKind;
  status: string;
  scheduledOn: string;
  expectedMinor: bigint;
}

export interface FactRow {
  date: string;
  type: 'INCOME' | 'EXPENSE';
  amountMinor: bigint;
}

export interface CalendarDay {
  date: string;
  incomeMinor: bigint;
  expenseMinor: bigint;
  dot: CalendarDot | null;
}

/** First and last day of a `YYYY-MM` month, inclusive. */
export function monthWindow(month: string): MonthWindow {
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7));
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, '0')}` };
}

export function previousDay(date: string): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

export function isOpenStatus(status: string): boolean {
  return status === 'PENDING' || status === 'DUE';
}

/** Only an open obligation scheduled before today is overdue; income plans are forecasts. */
export function isOverdue(
  kind: CalendarItemKind,
  status: string,
  scheduledOn: string,
  today: string,
): boolean {
  return kind === 'OBLIGATION' && isOpenStatus(status) && scheduledOn < today;
}

/** Plan totals follow spec §6: cancelled and skipped drop out, completed stay. */
export function plannedTotals(items: readonly PlannedItem[]): {
  plannedIncomeMinor: bigint;
  plannedExpenseMinor: bigint;
  balanceMinor: bigint;
} {
  let income = 0n;
  let expense = 0n;
  for (const item of items) {
    if (item.status === 'CANCELLED' || item.status === 'SKIPPED') continue;
    if (item.kind === 'INCOME_PLAN') income += item.expectedMinor;
    else expense += item.expectedMinor;
  }
  return { plannedIncomeMinor: income, plannedExpenseMinor: expense, balanceMinor: income - expense };
}

/** One entry per day that has facts or an open item, ordered by date. */
export function buildDays(
  facts: readonly FactRow[],
  items: ReadonlyArray<Pick<PlannedItem, 'kind' | 'status' | 'scheduledOn'>>,
  today: string,
): CalendarDay[] {
  const days = new Map<string, CalendarDay>();
  const dayOf = (date: string): CalendarDay => {
    let day = days.get(date);
    if (!day) {
      day = { date, incomeMinor: 0n, expenseMinor: 0n, dot: null };
      days.set(date, day);
    }
    return day;
  };
  for (const fact of facts) {
    const day = dayOf(fact.date);
    if (fact.type === 'INCOME') day.incomeMinor += fact.amountMinor;
    else day.expenseMinor += fact.amountMinor;
  }
  for (const item of items) {
    if (!isOpenStatus(item.status)) continue;
    const day = dayOf(item.scheduledOn);
    if (isOverdue(item.kind, item.status, item.scheduledOn, today)) day.dot = 'overdue';
    else if (day.dot === null) day.dot = 'upcoming';
  }
  return [...days.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
```

- [ ] **Step 5: зелёный запуск и проверки** (vitest файла, `pnpm exec prettier --write` для файлов T01, `pnpm typecheck`).

## T02. Репозиторий и сервис

**Files:** создать `plans-calendar.repository.ts`, `plans-calendar.application.service.ts`; изменить `obligation-plan.repository.ts` и `income-plan-v2.repository.ts`.

**Interfaces — consumes:** всё из T01; `ObligationPlanRepository.listOccurrences(db, budgetId, filter)` (строки с `paidMinor`), `IncomePlanRepository.listOccurrences`, `computeUnpaidMinor` (`obligations/obligation.application.service.ts:56`), `todayInTimezone(now, timezone)` (`cycles/cycle-period.domain.ts:55`), `PlanModelPolicy.requireModel`.

**Produces:**

```ts
export interface PlansCalendarItemView { kind: CalendarItemKind; occurrenceId: string; planId: string; name: string; scheduledOn: string; status: string; expectedMinor: string; paidMinor: string; unpaidMinor: string; categoryId: string | null; overdue: boolean; transactionId: string | null }
export interface PlansCalendarView { month: string; today: string; days: Array<{ date: string; incomeMinor: string; expenseMinor: string; dot: CalendarDot | null }>; items: PlansCalendarItemView[]; overdue: PlansCalendarItemView[]; overdueCount: number; totals: { plannedIncomeMinor: string; plannedExpenseMinor: string; balanceMinor: string; activePlanCount: number } }
export class PlansCalendarApplicationService { constructor(prisma: PrismaService, planModelPolicy: PlanModelPolicy, now?: () => Date); calendar(userId: string, budgetId: string, query: PlansCalendarQuery): Promise<PlansCalendarView> }
```

Для INCOME_PLAN элементов `paidMinor` и `unpaidMinor` равны `'0'` (у планового дохода нет оплат), `transactionId` берётся из occurrence; для OBLIGATION `transactionId: null`.

- [ ] **Step 1: Общие репозитории.** В `obligation-plan.repository.ts`: заменить `const mandatoryPlanFilter` на `export const mandatoryPlanFilter`; в `OccurrenceListFilter` добавить `statuses?: PlanOccurrenceStatus[] | undefined;` и в `where` метода `listOccurrences` после строки `...(query.status ? { status: query.status } : {}),` добавить `...(query.statuses ? { status: { in: query.statuses } } : {}),`. В `income-plan-v2.repository.ts`: `export const incomePlanFilter`. Сохранить чужие правки (см. общие ограничения).

- [ ] **Step 2: Репозиторий** `plans-calendar.repository.ts`:

```ts
import type { Prisma } from '@prisma/client';

import { mandatoryPlanFilter } from '../obligations/obligation-plan.repository.js';
import { incomePlanFilter } from '../plans/income-plan-v2.repository.js';
import type { FactRow, MonthWindow } from './plans-calendar.domain.js';

const dateValue = (value: string) => new Date(`${value}T00:00:00.000Z`);
const isoDate = (value: Date) => value.toISOString().slice(0, 10);

/** Data access for the plans calendar. Every query filters budget_id. */
export class PlansCalendarRepository {
  /** CONFIRMED, not deleted income and expense totals per day. Transfers are a separate table. */
  async factsByDay(
    db: Prisma.TransactionClient,
    budgetId: string,
    window: MonthWindow,
  ): Promise<FactRow[]> {
    const rows = await db.transaction.groupBy({
      by: ['occurredOn', 'transactionType'],
      where: {
        budgetId,
        status: 'CONFIRMED',
        deletedAt: null,
        occurredOn: { gte: dateValue(window.from), lte: dateValue(window.to) },
      },
      _sum: { amountMinor: true },
    });
    return rows.map((row) => ({
      date: isoDate(row.occurredOn),
      type: row.transactionType,
      amountMinor: row._sum.amountMinor ?? 0n,
    }));
  }

  /** Active mandatory-expense and income plans of the budget. */
  countActivePlans(db: Prisma.TransactionClient, budgetId: string): Promise<number> {
    return db.regularPlan.count({
      where: {
        isActive: true,
        OR: [mandatoryPlanFilter(budgetId), incomePlanFilter(budgetId)],
      },
    });
  }
}
```

- [ ] **Step 3: Сервис** `plans-calendar.application.service.ts`:

```ts
import { Prisma, type PlanOccurrenceStatus } from '@prisma/client';
import { NotFoundException } from '@nestjs/common';

import { formatMinorUnits } from '../common/money/minor-units.js';
import type { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import { todayInTimezone } from '../cycles/cycle-period.domain.js';
import type { PrismaService } from '../database/prisma.service.js';
import { computeUnpaidMinor } from '../obligations/obligation.application.service.js';
import { ObligationPlanRepository } from '../obligations/obligation-plan.repository.js';
import { IncomePlanRepository } from '../plans/income-plan-v2.repository.js';
import {
  buildDays,
  isOverdue,
  monthWindow,
  plannedTotals,
  previousDay,
  type CalendarDot,
  type CalendarItemKind,
  type PlannedItem,
} from './plans-calendar.domain.js';
import { PlansCalendarRepository } from './plans-calendar.repository.js';
import type { PlansCalendarQuery } from './plans-calendar.schemas.js';

const dateValue = (value: string) => new Date(`${value}T00:00:00.000Z`);
const isoDate = (value: Date) => value.toISOString().slice(0, 10);
const OPEN: PlanOccurrenceStatus[] = ['PENDING', 'DUE'];

export interface PlansCalendarItemView {
  kind: CalendarItemKind;
  occurrenceId: string;
  planId: string;
  name: string;
  scheduledOn: string;
  status: string;
  expectedMinor: string;
  paidMinor: string;
  unpaidMinor: string;
  categoryId: string | null;
  overdue: boolean;
  transactionId: string | null;
}

export interface PlansCalendarView {
  month: string;
  today: string;
  days: Array<{
    date: string;
    incomeMinor: string;
    expenseMinor: string;
    dot: CalendarDot | null;
  }>;
  items: PlansCalendarItemView[];
  overdue: PlansCalendarItemView[];
  overdueCount: number;
  totals: {
    plannedIncomeMinor: string;
    plannedExpenseMinor: string;
    balanceMinor: string;
    activePlanCount: number;
  };
}

type ObligationRow = Awaited<ReturnType<ObligationPlanRepository['listOccurrences']>>[number];
type IncomeRow = Awaited<ReturnType<IncomePlanRepository['listOccurrences']>>[number];

export class PlansCalendarApplicationService {
  private readonly obligations = new ObligationPlanRepository();
  private readonly incomes = new IncomePlanRepository();

  constructor(
    private readonly prisma: PrismaService,
    private readonly planModelPolicy: PlanModelPolicy,
    private readonly repository = new PlansCalendarRepository(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async calendar(
    userId: string,
    budgetId: string,
    query: PlansCalendarQuery,
  ): Promise<PlansCalendarView> {
    const model = await this.planModelPolicy.requireModel(userId, budgetId, 2);
    const window = monthWindow(query.month);
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        const budget = await tx.budget.findFirst({
          where: { id: budgetId, workspaceId: model.workspaceId },
          select: { timezone: true },
        });
        if (!budget) {
          throw new NotFoundException({
            code: 'RESOURCE_NOT_FOUND',
            detail: 'Бюджет не найден или недоступен для этого пользователя.',
          });
        }
        const today = todayInTimezone(this.now(), budget.timezone);
        const range = { from: dateValue(window.from), to: dateValue(window.to) };
        const [obligationRows, incomeRows, overdueRows, facts, activePlanCount] =
          await Promise.all([
            this.obligations.listOccurrences(tx, budgetId, range),
            this.incomes.listOccurrences(tx, budgetId, range),
            this.obligations.listOccurrences(tx, budgetId, {
              statuses: OPEN,
              to: dateValue(previousDay(today)),
            }),
            this.repository.factsByDay(tx, budgetId, window),
            this.repository.countActivePlans(tx, budgetId),
          ]);

        const items = [
          ...obligationRows.map((row) => this.obligationItem(row, today)),
          ...incomeRows.map((row) => this.incomeItem(row)),
        ].sort(byDateThenName);
        const overdue = overdueRows.map((row) => this.obligationItem(row, today));
        const planned: PlannedItem[] = [
          ...obligationRows.map((row) => ({
            kind: 'OBLIGATION' as const,
            status: row.status,
            scheduledOn: isoDate(row.scheduledOn),
            expectedMinor: row.amountMinor,
          })),
          ...incomeRows.map((row) => ({
            kind: 'INCOME_PLAN' as const,
            status: row.status,
            scheduledOn: isoDate(row.scheduledOn),
            expectedMinor: row.amountMinor,
          })),
        ];
        const totals = plannedTotals(planned);
        return {
          month: query.month,
          today,
          days: buildDays(facts, planned, today).map((day) => ({
            date: day.date,
            incomeMinor: formatMinorUnits(day.incomeMinor),
            expenseMinor: formatMinorUnits(day.expenseMinor),
            dot: day.dot,
          })),
          items,
          overdue,
          overdueCount: overdue.length,
          totals: {
            plannedIncomeMinor: formatMinorUnits(totals.plannedIncomeMinor),
            plannedExpenseMinor: formatMinorUnits(totals.plannedExpenseMinor),
            balanceMinor: formatMinorUnits(totals.balanceMinor),
            activePlanCount,
          },
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  private obligationItem(row: ObligationRow, today: string): PlansCalendarItemView {
    const scheduledOn = isoDate(row.scheduledOn);
    return {
      kind: 'OBLIGATION',
      occurrenceId: row.id,
      planId: row.planId,
      name: row.planName,
      scheduledOn,
      status: row.status,
      expectedMinor: formatMinorUnits(row.amountMinor),
      paidMinor: formatMinorUnits(row.paidMinor),
      unpaidMinor: formatMinorUnits(computeUnpaidMinor(row.status, row.amountMinor, row.paidMinor)),
      categoryId: row.categoryId,
      overdue: isOverdue('OBLIGATION', row.status, scheduledOn, today),
      transactionId: null,
    };
  }

  private incomeItem(row: IncomeRow): PlansCalendarItemView {
    return {
      kind: 'INCOME_PLAN',
      occurrenceId: row.id,
      planId: row.planId,
      name: row.planName,
      scheduledOn: isoDate(row.scheduledOn),
      status: row.status,
      expectedMinor: formatMinorUnits(row.amountMinor),
      paidMinor: '0',
      unpaidMinor: '0',
      categoryId: row.categoryId,
      overdue: false,
      transactionId: row.transactionId,
    };
  }
}

function byDateThenName(a: PlansCalendarItemView, b: PlansCalendarItemView): number {
  if (a.scheduledOn !== b.scheduledOn) return a.scheduledOn < b.scheduledOn ? -1 : 1;
  return a.occurrenceId < b.occurrenceId ? -1 : a.occurrenceId > b.occurrenceId ? 1 : 0;
}
```

(Если `typecheck` сообщает, что `PlanModelPolicy`/`PrismaService` нужны как значения для DI, оставить `import type` — сервис создаётся фабрикой в модуле, как `DashboardV2ApplicationService`.)

- [ ] **Step 4: Проверка.** `pnpm typecheck` (корень) без ошибок. Юнит-тесты сервиса не пишутся: логика покрыта доменом (T01) и интеграционным тестом (T03).

## T03. Контроллер, модуль, OpenAPI и интеграционные тесты

**Files:** создать `plans-calendar.dto.ts`, `plans-calendar.controller.ts`, `plans-calendar.module.ts`, `apps/api/test/v2-plans-calendar.integration.test.ts`; изменить `app.module.ts`, `apps/api/test/v2-openapi.integration.test.ts`.

- [ ] **Step 1: красный интеграционный тест.** Создать `apps/api/test/v2-plans-calendar.integration.test.ts`. Скопировать из `v2-dashboard.integration.test.ts` без изменений вспомогательные части: константы `databaseUrl`, `prisma`, `origin`, `password`, `day`; тип `World`; `beforeAll`/`afterAll` (создание `app` через `createApiApp`, `server`), `createdUsers`; функции `register`, `world` (с `timezone: 'UTC'`), `envelope`, `occurrence`, `expense`, `cleanupUser`, `addMember`. Для сервиса отдельная проверка не нужна. Добавить:

```ts
async function getCalendar(
  w: World,
  query = '?month=2026-09',
  options: { cookie?: string | null; budgetId?: string } = {},
) {
  const cookie = options.cookie === undefined ? w.cookie : options.cookie;
  return server.inject({
    method: 'GET',
    url: `/api/v2/budgets/${options.budgetId ?? w.budgetId}/plans/calendar${query}`,
    headers: cookie ? { origin, cookie: `harmofin_session=${cookie}` } : { origin },
  });
}

type CalendarBody = {
  month: string;
  today: string;
  days: Array<{ date: string; incomeMinor: string; expenseMinor: string; dot: string | null }>;
  items: Array<{ kind: string; occurrenceId: string; scheduledOn: string; status: string; expectedMinor: string; overdue: boolean }>;
  overdue: Array<{ occurrenceId: string; scheduledOn: string }>;
  overdueCount: number;
  totals: { plannedIncomeMinor: string; plannedExpenseMinor: string; balanceMinor: string; activePlanCount: number };
};
```

Расширить `occurrence(...)` из дашборда необязательными параметрами `status` (по умолчанию `'DUE'`) и `planName`, а для INCOME создавать связь с `categoryId`: `occurrence(w, amount, date, { planType, status })`; в `prisma.planOccurrence.create` писать `status: options.status ?? 'DUE'`. Для INCOME-расходов и доходов фактов добавить функцию `income(w, amountMinor, occurredOn, status)` по образцу `expense` (`transactionType: 'INCOME'`, `categoryId: w.incomeCategoryId`, `envelopeId: null`). Для переводов создавать строку в таблице переводов не нужно: тест на «перевод не входит» проверяет, что журнал операций с типом INCOME/EXPENSE — единственный источник (достаточно утверждения по счёту итогов, см. тест ниже).

Тесты (`describe('v2 plans calendar (GET /api/v2/budgets/:id/plans/calendar)')`), каждый с `const w = await world(10_000_000n)`:

1. **Факты по дням:** `expense(w, w.mainEnvelopeId, 600_000n, '2026-09-05')`, `income(w, 4_300_000n, '2026-09-05')`, второй расход `100_000n` в тот же день; ответ 200: день `2026-09-05` имеет `incomeMinor: '4300000'`, `expenseMinor: '700000'`.
2. **Только CONFIRMED:** расходы со статусами `DRAFT`, `CANCELLED`, `DELETED` в сентябре не меняют `days`; операция в августе или октябре не попадает в сентябрь.
3. **Планы и итоги:** три occurrence: расход `DUE` 300 000 (2026-09-10), расход `COMPLETED` 4 000 000 (2026-09-11), расход `SKIPPED` 777 (2026-09-12), доход `PENDING` 10 000 000 (2026-09-25), доход `CANCELLED` 999 (2026-09-26): `totals` = `plannedIncomeMinor '10000000'`, `plannedExpenseMinor '4300000'`, `balanceMinor '5700000'`; `items` содержит 5 строк, `activePlanCount` равно числу созданных активных планов (5).
4. **Просрочка:** `today` в ответе равен `todayInTimezone(new Date(), 'UTC')`. Создать открытый платёж с датой `previousDay(today)` относительно сегодня (использовать `new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)`) в **другом** месяце, чем запрошенный (запросить `?month=` текущего месяца минус 3, вычислив строкой): ответ содержит этот платёж в `overdue` и `overdueCount === 1`, а `items` пуст. Платёж с датой сегодня (`today`) не просрочен.
5. **Точки:** `today` = `new Date().toISOString().slice(0, 10)` (бюджет в UTC), `prevMonth` и `nextMonth` — строки `YYYY-MM` на 2 месяца раньше и позже `today` (считать через `Date.UTC`). Открытый платёж `DUE` с датой `<prevMonth>-10` и запрос `?month=<prevMonth>` дают день `<prevMonth>-10` с `dot: 'overdue'`; открытый платёж `PENDING` с датой `<nextMonth>-10` и запрос `?month=<nextMonth>` дают `dot: 'upcoming'`; открытый плановый доход на дату `<prevMonth>-11` даёт `dot: 'upcoming'` (доход не бывает просроченным).
6. **Изоляция бюджетов:** два мира `a` и `b`; операции и планы `b` не видны в ответе `a`; запрос к бюджету `b` с cookie `a` даёт 404 `RESOURCE_NOT_FOUND`; без cookie — 401.
7. **Роль VIEWER** (через `addMember(w, 'VIEWER')`) получает 200.
8. **Модель v1:** `world(0n, { planModelVersion: 1 })` — 409 `MODEL_VERSION_MISMATCH`.
9. **Валидация:** `?month=2026-13`, `?month=abc`, `?month=1999-12`, отсутствие параметра, лишний параметр `?month=2026-09&x=1` — 400 `VALIDATION_FAILED`.
10. **Только чтение:** до и после запроса `prisma.planOccurrence.count`, `prisma.auditEvent.count` и `prisma.transaction.count` бюджета не изменились.

Конкретные ожидания в каждом тесте писать числами (как в примерах выше), без вычислений от кода под тестом.

- [ ] **Step 2: красный запуск.** `cd apps/api && pnpm exec vitest run test/v2-plans-calendar.integration.test.ts` (БД `harmofin_v22_test` должна быть доступна, `DATABASE_URL` не менять). Ожидается 404 на маршруте.

- [ ] **Step 3: DTO** `plans-calendar.dto.ts`:

```ts
import { ApiProperty } from '@nestjs/swagger';

export class PlansCalendarDayResponse {
  @ApiProperty({ type: String, format: 'date', example: '2026-09-05' })
  date!: string;

  @ApiProperty({ type: String, example: '4300000', description: 'CONFIRMED доходы дня, minor units.' })
  incomeMinor!: string;

  @ApiProperty({ type: String, example: '700000', description: 'CONFIRMED расходы дня, minor units.' })
  expenseMinor!: string;

  @ApiProperty({
    type: String,
    enum: ['upcoming', 'overdue'],
    nullable: true,
    description: 'Есть открытый план на этот день; overdue — открытый платёж раньше сегодняшней даты.',
  })
  dot!: 'upcoming' | 'overdue' | null;
}

export class PlansCalendarItemResponse {
  @ApiProperty({ type: String, enum: ['OBLIGATION', 'INCOME_PLAN'] })
  kind!: 'OBLIGATION' | 'INCOME_PLAN';

  @ApiProperty({ type: String, format: 'uuid' })
  occurrenceId!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  planId!: string;

  @ApiProperty({ type: String })
  name!: string;

  @ApiProperty({ type: String, format: 'date' })
  scheduledOn!: string;

  @ApiProperty({ type: String, enum: ['PENDING', 'DUE', 'SKIPPED', 'COMPLETED', 'CANCELLED'] })
  status!: string;

  @ApiProperty({ type: String, example: '4000000' })
  expectedMinor!: string;

  @ApiProperty({ type: String, example: '0', description: 'Для планового дохода всегда 0.' })
  paidMinor!: string;

  @ApiProperty({ type: String, example: '4000000', description: 'Для планового дохода всегда 0.' })
  unpaidMinor!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  categoryId!: string | null;

  @ApiProperty({ type: Boolean, description: 'Открытый платёж раньше сегодняшней даты.' })
  overdue!: boolean;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: 'Операция записанного планового дохода.' })
  transactionId!: string | null;
}

export class PlansCalendarTotalsResponse {
  @ApiProperty({ type: String, example: '10000000' })
  plannedIncomeMinor!: string;

  @ApiProperty({ type: String, example: '4300000' })
  plannedExpenseMinor!: string;

  @ApiProperty({ type: String, example: '5700000', description: 'Плановые доходы минус плановые расходы месяца.' })
  balanceMinor!: string;

  @ApiProperty({ type: Number, example: 3 })
  activePlanCount!: number;
}

export class PlansCalendarResponse {
  @ApiProperty({ type: String, example: '2026-09' })
  month!: string;

  @ApiProperty({ type: String, format: 'date', description: 'Сегодняшняя дата в часовом поясе бюджета.' })
  today!: string;

  @ApiProperty({ type: [PlansCalendarDayResponse] })
  days!: PlansCalendarDayResponse[];

  @ApiProperty({ type: [PlansCalendarItemResponse] })
  items!: PlansCalendarItemResponse[];

  @ApiProperty({ type: [PlansCalendarItemResponse], description: 'Все открытые просроченные платежи бюджета, независимо от месяца.' })
  overdue!: PlansCalendarItemResponse[];

  @ApiProperty({ type: Number })
  overdueCount!: number;

  @ApiProperty({ type: PlansCalendarTotalsResponse })
  totals!: PlansCalendarTotalsResponse;
}
```

- [ ] **Step 4: контроллер** `plans-calendar.controller.ts`:

```ts
import { Controller, Get, Inject, Param, Query, Req, UseGuards } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { ProblemDetailsResponse } from '../common/errors/problem-details.dto.js';
import type { RequestContext } from '../common/request-context/request-context.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { uuidParamSchema } from '../cycles/cycle-revision.schemas.js';
import { PlansCalendarResponse } from './plans-calendar.dto.js';
import { PlansCalendarApplicationService } from './plans-calendar.application.service.js';
import { plansCalendarQuerySchema, type PlansCalendarQuery } from './plans-calendar.schemas.js';

type AuthenticatedRequest = FastifyRequest & { authContext?: RequestContext };

@ApiTags('plans calendar (v2)')
@Controller({ path: 'budgets/:budgetId/plans/calendar', version: '2' })
@UseGuards(SessionAuthGuard)
@ApiCookieAuth('session')
export class PlansCalendarController {
  constructor(
    @Inject(PlansCalendarApplicationService)
    private readonly service: PlansCalendarApplicationService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Календарь планов месяца: факты и планы по дням, просрочка, итоги',
    description:
      'Все суммы строки minor units, расчёт на сервере одним снимком. Факты дня: только CONFIRMED и не удалённые доходы/расходы (переводы не входят). Плановые итоги: occurrences месяца без CANCELLED и SKIPPED. overdue — все открытые просроченные платежи бюджета независимо от месяца. Доступно любому активному участнику. Коды: 400 VALIDATION_FAILED, 401, 404 RESOURCE_NOT_FOUND, 409 MODEL_VERSION_MISMATCH.',
  })
  @ApiQuery({
    name: 'month',
    required: true,
    schema: { type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])$', example: '2026-09' },
  })
  @ApiOkResponse({ type: PlansCalendarResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse, description: 'VALIDATION_FAILED.' })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({
    status: 404,
    type: ProblemDetailsResponse,
    description: 'RESOURCE_NOT_FOUND: бюджет не найден или чужой.',
  })
  @ApiResponse({
    status: 409,
    type: ProblemDetailsResponse,
    description: 'MODEL_VERSION_MISMATCH: бюджет работает на модели v1.',
  })
  calendar(
    @Param('budgetId', new ZodValidationPipe(uuidParamSchema)) budgetId: string,
    @Query(new ZodValidationPipe(plansCalendarQuerySchema)) query: PlansCalendarQuery,
    @Req() request: AuthenticatedRequest,
  ): Promise<PlansCalendarResponse> {
    const context = request.authContext;
    if (!context) throw new Error('Missing authenticated request context.');
    return this.service.calendar(context.userId, budgetId, query);
  }
}
```

- [ ] **Step 5: модуль** `plans-calendar.module.ts` по образцу `dashboard-v2.module.ts`:

```ts
import { DynamicModule, Module } from '@nestjs/common';

import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import { PrismaService } from '../database/prisma.service.js';
import { PlansCalendarApplicationService } from './plans-calendar.application.service.js';
import { PlansCalendarController } from './plans-calendar.controller.js';

@Module({})
export class PlansCalendarModule {
  static register(): DynamicModule {
    return {
      module: PlansCalendarModule,
      controllers: [PlansCalendarController],
      providers: [
        {
          provide: PlansCalendarApplicationService,
          useFactory: (prisma: PrismaService) =>
            new PlansCalendarApplicationService(prisma, new PlanModelPolicy(prisma)),
          inject: [PrismaService],
        },
      ],
    };
  }
}
```

В `app.module.ts` добавить `import { PlansCalendarModule } from './plans-calendar/plans-calendar.module.js';` и `PlansCalendarModule.register(),` после `PlansModule.register(),`.

- [ ] **Step 6: OpenAPI-индекс.** В `v2-openapi.integration.test.ts` в `EXPECTED_V2` после строки `['get', '/api/v2/budgets/{budgetId}/obligations/occurrences'],` добавить `['get', '/api/v2/budgets/{budgetId}/plans/calendar'],`.

- [ ] **Step 7: зелёный запуск.** `cd apps/api && pnpm exec vitest run test/v2-plans-calendar.integration.test.ts test/v2-openapi.integration.test.ts src/plans-calendar`, затем `pnpm typecheck`, `pnpm exec prettier --check` по новым файлам. Если OpenAPI-тест требует `maxLength` у строковых свойств, или другого описания, привести DTO к его правилам (читать сообщение теста).

- [ ] **Step 8: EXPLAIN (риск производительности).** Проверить, что `factsByDay` использует индекс `transactions_budget_id_transaction_type_status_occurred_on_idx` (`@@index([budgetId, transactionType, status, occurredOn])`): выполнить в `psql` на `harmofin_v22_test` `EXPLAIN SELECT occurred_on, transaction_type, SUM(amount_minor) FROM transactions WHERE budget_id = '<uuid>' AND status = 'CONFIRMED' AND deleted_at IS NULL AND occurred_on BETWEEN '2026-09-01' AND '2026-09-30' GROUP BY 1, 2;` и записать вывод одной строкой в отчёт задачи. Если полный скан, зафиксировать в open-decisions §2, схему не менять.

## T04. Клиентский контракт и сетка месяца

**Files:** изменить `apps/web/app/composables/useEnvelopePlanV2.ts`; создать `components/plans/calendar-grid.ts` и `calendar-grid.test.ts`.

**Produces:**

```ts
export type PlansCalendarDot = 'upcoming' | 'overdue';
export interface PlansCalendarDay { date: string; incomeMinor: string; expenseMinor: string; dot: PlansCalendarDot | null }
export interface PlansCalendarItem { kind: 'OBLIGATION' | 'INCOME_PLAN'; occurrenceId: string; planId: string; name: string; scheduledOn: string; status: string; expectedMinor: string; paidMinor: string; unpaidMinor: string; categoryId: string | null; overdue: boolean; transactionId: string | null }
export interface PlansCalendarTotals { plannedIncomeMinor: string; plannedExpenseMinor: string; balanceMinor: string; activePlanCount: number }
export interface PlansCalendarResponse { month: string; today: string; days: PlansCalendarDay[]; items: PlansCalendarItem[]; overdue: PlansCalendarItem[]; overdueCount: number; totals: PlansCalendarTotals }
// useEnvelopePlanV2().getPlansCalendar(budgetId: string, month: string): Promise<PlansCalendarResponse>
export interface CalendarCell { date: string; inCurrentMonth: boolean }
export function buildCalendarGrid(monthAnchor: string): CalendarCell[]; // 42 cells, Monday first
```

- [ ] **Step 1: красный тест** `calendar-grid.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { buildCalendarGrid } from './calendar-grid.js';

describe('buildCalendarGrid', () => {
  it('builds 42 cells starting on Monday', () => {
    const grid = buildCalendarGrid('2026-09-01'); // 2026-09-01 is Tuesday
    expect(grid).toHaveLength(42);
    expect(grid[0]).toEqual({ date: '2026-08-31', inCurrentMonth: false });
    expect(grid[1]).toEqual({ date: '2026-09-01', inCurrentMonth: true });
    expect(grid.filter((cell) => cell.inCurrentMonth)).toHaveLength(30);
    expect(grid[41]).toEqual({ date: '2026-10-11', inCurrentMonth: false });
  });

  it('accepts any day of the month as anchor', () => {
    expect(buildCalendarGrid('2026-09-17')[1]?.date).toBe('2026-09-01');
  });
});
```

Запуск `cd apps/web && pnpm exec vitest run app/components/plans/calendar-grid.test.ts` — красный (нет модуля).

- [ ] **Step 2: реализация** `calendar-grid.ts` (из истории `git show bbf25c5^:apps/web/app/components/plans/calendar-grid.ts`):

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

- [ ] **Step 3: типы и клиент.** В `useEnvelopePlanV2.ts` после `IncomeOccurrenceItem` добавить интерфейсы из блока «Produces» (кроме `CalendarCell`). В объект, возвращаемый `useEnvelopePlanV2`, рядом с `listTransactions` добавить:

```ts
    getPlansCalendar: (budgetId: string, month: string) =>
      get<PlansCalendarResponse>(`${base(budgetId)}/plans/calendar${query({ month })}`),
```

- [ ] **Step 4: зелёный и проверки.** `pnpm exec vitest run app/components/plans/calendar-grid.test.ts`, `pnpm typecheck`, `pnpm exec prettier --check` по файлам.

## T05. `PlansCalendar` и `PlanKpiRow`

**Files:** создать `PlansCalendar.vue`, `PlansCalendar.test.ts`, `PlanKpiRow.vue`, `PlanKpiRow.test.ts` в `apps/web/app/components/plans/`.

**Interfaces — consumes:** `buildCalendarGrid`, `PlansCalendarDay`, `PlansCalendarTotals`, `formatCompactSigned`, `formatMinorUnits` (`components/finance/money-format.ts`), `FinanceMoney.vue` (props `minorUnits`, `currency`, `scale`).

**Produces:**

```ts
// PlansCalendar props: { monthAnchor: string /* yyyy-MM-dd */; selectedDate: string; today: string; days: PlansCalendarDay[]; loading?: boolean }
// emits: 'select-day' [date: string], 'change-month' [monthAnchor: string]
// test ids: calendar-prev-month, calendar-next-month, calendar-day-<date>, calendar-dot-<date> (data-dot)
// PlanKpiRow props: { totals: PlansCalendarTotals } ; test ids kpi-planned-income, kpi-planned-expense, kpi-balance, kpi-total-plans
```

- [ ] **Step 1: красные тесты** `PlansCalendar.test.ts`:

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import PlansCalendar from './PlansCalendar.vue';

const days = [
  { date: '2026-09-05', incomeMinor: '4300000', expenseMinor: '600000', dot: 'overdue' as const },
  { date: '2026-09-25', incomeMinor: '0', expenseMinor: '0', dot: 'upcoming' as const },
];

function mountCalendar(props: Record<string, unknown> = {}) {
  return mount(PlansCalendar, {
    props: {
      monthAnchor: '2026-09-01',
      selectedDate: '2026-09-24',
      today: '2026-09-24',
      days,
      ...props,
    },
    attachTo: document.body,
  });
}

describe('PlansCalendar', () => {
  it('shows the month label and 42 day cells with neighbours disabled', () => {
    const wrapper = mountCalendar();
    expect(wrapper.text()).toContain('сентябрь 2026');
    expect(wrapper.findAll('[data-testid^="calendar-day-"]')).toHaveLength(42);
    expect(wrapper.get('[data-testid="calendar-day-2026-08-31"]').attributes('disabled')).toBeDefined();
    expect(wrapper.get('[data-testid="calendar-day-2026-09-01"]').attributes('disabled')).toBeUndefined();
  });

  it('shows compact income and expense amounts and puts them in the aria-label', () => {
    const wrapper = mountCalendar();
    const cell = wrapper.get('[data-testid="calendar-day-2026-09-05"]');
    expect(cell.text()).toContain('+43к');
    expect(cell.text()).toContain('−6');
    const label = cell.attributes('aria-label') ?? '';
    expect(label).toContain('5 сентября 2026');
    expect(label).toContain('доход');
    expect(label).toContain('расход');
    expect(label).toContain('просроченный платёж');
  });

  it('marks today and the selected day for assistive tech', () => {
    const wrapper = mountCalendar({ selectedDate: '2026-09-25' });
    expect(wrapper.get('[data-testid="calendar-day-2026-09-24"]').attributes('aria-label')).toContain('сегодня');
    const selected = wrapper.get('[data-testid="calendar-day-2026-09-25"]');
    expect(selected.attributes('aria-pressed')).toBe('true');
    expect(selected.attributes('aria-label')).toContain('предстоящий платёж');
  });

  it('draws a shape marker per dot kind', () => {
    const wrapper = mountCalendar();
    expect(wrapper.get('[data-testid="calendar-dot-2026-09-05"]').attributes('data-dot')).toBe('overdue');
    expect(wrapper.get('[data-testid="calendar-dot-2026-09-25"]').attributes('data-dot')).toBe('upcoming');
    expect(wrapper.find('[data-testid="calendar-dot-2026-09-06"]').exists()).toBe(false);
  });

  it('emits select-day for an enabled cell only', async () => {
    const wrapper = mountCalendar();
    await wrapper.get('[data-testid="calendar-day-2026-09-10"]').trigger('click');
    expect(wrapper.emitted('select-day')).toEqual([['2026-09-10']]);
  });

  it('emits change-month and blocks navigation beyond today + 60 days', async () => {
    const wrapper = mountCalendar();
    await wrapper.get('[data-testid="calendar-prev-month"]').trigger('click');
    expect(wrapper.emitted('change-month')).toEqual([['2026-08-01']]);
    // today 2026-09-24 + 60 days = 2026-11-23: October starts earlier, December 1 is later.
    expect(wrapper.get('[data-testid="calendar-next-month"]').attributes('disabled')).toBeUndefined();
    await wrapper.setProps({ monthAnchor: '2026-11-01' });
    const next = wrapper.get('[data-testid="calendar-next-month"]');
    expect(next.attributes('disabled')).toBeDefined();
    expect(next.attributes('aria-label')).toContain('60 дней');
  });

  it('flags the grid busy while loading', () => {
    expect(mountCalendar({ loading: true }).get('[data-testid="calendar-grid"]').attributes('aria-busy')).toBe('true');
  });
});
```

Добавить в тот же `describe` тест клавиатуры (`ArrowRight` выбирает следующий день, `ArrowDown` с 28 сентября выходит за месяц и событие не эмитится):

```ts
  it('ArrowRight selects the next day, ArrowDown beyond the month does nothing', async () => {
    const wrapper = mountCalendar();
    const cell = wrapper.get('[data-testid="calendar-day-2026-09-24"]');
    await cell.trigger('keydown', { key: 'ArrowRight' });
    expect(wrapper.emitted('select-day')).toEqual([['2026-09-25']]);
    await wrapper.get('[data-testid="calendar-day-2026-09-28"]').trigger('keydown', { key: 'ArrowDown' });
    expect(wrapper.emitted('select-day')).toEqual([['2026-09-25']]);
  });
```

И `PlanKpiRow.test.ts`:

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import PlanKpiRow from './PlanKpiRow.vue';

const totals = {
  plannedIncomeMinor: '10000000',
  plannedExpenseMinor: '4300000',
  balanceMinor: '5700000',
  activePlanCount: 3,
};
const norm = (value: string) => value.replace(/\s/g, ' ');

describe('PlanKpiRow', () => {
  it('shows four tiles with server values and the plan-month wording', () => {
    const wrapper = mount(PlanKpiRow, { props: { totals } });
    expect(norm(wrapper.get('[data-testid="kpi-planned-income"]').text())).toContain('100 000,00');
    expect(norm(wrapper.get('[data-testid="kpi-planned-expense"]').text())).toContain('43 000,00');
    expect(norm(wrapper.get('[data-testid="kpi-balance"]').text())).toContain('57 000,00');
    expect(wrapper.get('[data-testid="kpi-total-plans"]').text()).toContain('3');
    expect(wrapper.text()).toContain('Плановые доходы');
    expect(wrapper.text()).toContain('Плановые расходы');
    expect(wrapper.text()).toContain('Баланс');
    expect(wrapper.text()).toContain('Всего планов');
    expect(wrapper.text()).toContain('План месяца');
  });

  it('keeps a negative balance readable', () => {
    const wrapper = mount(PlanKpiRow, { props: { totals: { ...totals, balanceMinor: '-500' } } });
    expect(norm(wrapper.get('[data-testid="kpi-balance"]').text())).toContain('5,00');
  });
});
```

Красный запуск обоих файлов.

- [ ] **Step 2: реализация `PlansCalendar.vue`:**

```vue
<script setup lang="ts">
import { computed, nextTick } from 'vue';
import { addDays, addMonths, format, startOfMonth, subMonths } from 'date-fns';
import { ru } from 'date-fns/locale';
import { AlertTriangle, ChevronLeft, ChevronRight, Circle } from '@lucide/vue';

import type { PlansCalendarDay } from '../../composables/useEnvelopePlanV2.js';
import { formatCompactSigned, formatMinorUnits } from '../finance/money-format.js';
import { buildCalendarGrid } from './calendar-grid.js';

defineOptions({ name: 'PlansCalendar' });

const props = withDefaults(
  defineProps<{
    monthAnchor: string;
    selectedDate: string;
    today: string;
    days: ReadonlyArray<PlansCalendarDay>;
    loading?: boolean;
  }>(),
  { loading: false },
);

const emit = defineEmits<{
  'select-day': [date: string];
  'change-month': [monthAnchor: string];
}>();

const WEEKDAY_LABELS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
// The worker materialises occurrences up to today + 60 days; a month past that
// would look like "no plans at all".
const HORIZON_DAYS = 60;

const grid = computed(() => buildCalendarGrid(props.monthAnchor));
const dayByDate = computed(() => new Map(props.days.map((day) => [day.date, day])));
const monthLabel = computed(() =>
  format(parsePlainDate(props.monthAnchor), 'LLLL yyyy', { locale: ru }),
);
const nextMonthDisabled = computed(
  () =>
    startOfMonth(addMonths(parsePlainDate(props.monthAnchor), 1)) >
    addDays(parsePlainDate(props.today), HORIZON_DAYS),
);
// The selected day, or the first day of the month, is the single tab stop.
const tabStop = computed(() =>
  grid.value.some((cell) => cell.inCurrentMonth && cell.date === props.selectedDate)
    ? props.selectedDate
    : (grid.value.find((cell) => cell.inCurrentMonth)?.date ?? ''),
);

function parsePlainDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year as number, (month as number) - 1, day as number);
}

function incomeText(date: string): string | null {
  const day = dayByDate.value.get(date);
  return day && day.incomeMinor !== '0' ? formatCompactSigned(day.incomeMinor, 2) : null;
}

function expenseText(date: string): string | null {
  const day = dayByDate.value.get(date);
  return day && day.expenseMinor !== '0' ? formatCompactSigned(`-${day.expenseMinor}`, 2) : null;
}

function cellLabel(date: string): string {
  const parts = [format(parsePlainDate(date), 'd MMMM yyyy, EEEE', { locale: ru })];
  if (date === props.today) parts.push('сегодня');
  const day = dayByDate.value.get(date);
  // The visible text is compact (+43к); an aria-label replaces it, so carry the amounts.
  if (day && day.incomeMinor !== '0') parts.push(`доход ${formatMinorUnits(day.incomeMinor, 'RUB', 2)}`);
  if (day && day.expenseMinor !== '0') parts.push(`расход ${formatMinorUnits(day.expenseMinor, 'RUB', 2)}`);
  if (day?.dot === 'overdue') parts.push('просроченный платёж');
  else if (day?.dot === 'upcoming') parts.push('предстоящий платёж');
  return parts.join(', ');
}

function monthAnchorOf(delta: 1 | -1): string {
  const base = parsePlainDate(props.monthAnchor);
  return format(delta === 1 ? addMonths(base, 1) : subMonths(base, 1), 'yyyy-MM-dd');
}

const KEY_STEPS: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };

function handleKeydown(event: KeyboardEvent, date: string): void {
  const step = KEY_STEPS[event.key];
  if (step === undefined) return;
  event.preventDefault();
  const target = format(addDays(parsePlainDate(date), step), 'yyyy-MM-dd');
  const inMonth = grid.value.some((cell) => cell.inCurrentMonth && cell.date === target);
  if (!inMonth) return;
  emit('select-day', target);
  void nextTick(() =>
    document.querySelector<HTMLElement>(`[data-testid="calendar-day-${target}"]`)?.focus(),
  );
}
</script>

<template>
  <div class="plans-calendar">
    <div class="plans-calendar__header">
      <button
        type="button"
        class="plans-calendar__nav"
        data-testid="calendar-prev-month"
        aria-label="Предыдущий месяц"
        @click="emit('change-month', monthAnchorOf(-1))"
      >
        <ChevronLeft :size="20" aria-hidden="true" />
      </button>
      <p class="plans-calendar__month" aria-live="polite">{{ monthLabel }}</p>
      <button
        type="button"
        class="plans-calendar__nav"
        data-testid="calendar-next-month"
        :aria-label="
          nextMonthDisabled
            ? 'Следующий месяц недоступен: планы рассчитаны на 60 дней вперёд'
            : 'Следующий месяц'
        "
        :disabled="nextMonthDisabled"
        @click="emit('change-month', monthAnchorOf(1))"
      >
        <ChevronRight :size="20" aria-hidden="true" />
      </button>
    </div>

    <div class="plans-calendar__weekdays" aria-hidden="true">
      <span v-for="label in WEEKDAY_LABELS" :key="label">{{ label }}</span>
    </div>

    <div
      class="plans-calendar__grid"
      data-testid="calendar-grid"
      role="group"
      aria-label="Дни месяца"
      :aria-busy="loading"
    >
      <button
        v-for="cell in grid"
        :key="cell.date"
        type="button"
        class="plans-calendar__cell"
        :class="{
          'plans-calendar__cell--outside': !cell.inCurrentMonth,
          'plans-calendar__cell--today': cell.date === today,
          'plans-calendar__cell--selected': cell.date === selectedDate,
        }"
        :data-testid="`calendar-day-${cell.date}`"
        :disabled="!cell.inCurrentMonth"
        :tabindex="cell.date === tabStop ? 0 : -1"
        :aria-label="cell.inCurrentMonth ? cellLabel(cell.date) : undefined"
        :aria-pressed="cell.inCurrentMonth ? cell.date === selectedDate : undefined"
        @click="emit('select-day', cell.date)"
        @keydown="handleKeydown($event, cell.date)"
      >
        <span class="plans-calendar__num">{{ Number(cell.date.slice(8)) }}</span>
        <template v-if="cell.inCurrentMonth">
          <span v-if="incomeText(cell.date)" class="plans-calendar__amount plans-calendar__amount--income">
            {{ incomeText(cell.date) }}
          </span>
          <span v-if="expenseText(cell.date)" class="plans-calendar__amount plans-calendar__amount--expense">
            {{ expenseText(cell.date) }}
          </span>
          <span
            v-if="dayByDate.get(cell.date)?.dot"
            class="plans-calendar__marker"
            :class="`plans-calendar__marker--${dayByDate.get(cell.date)?.dot}`"
            :data-testid="`calendar-dot-${cell.date}`"
            :data-dot="dayByDate.get(cell.date)?.dot"
            aria-hidden="true"
          >
            <AlertTriangle v-if="dayByDate.get(cell.date)?.dot === 'overdue'" :size="12" />
            <Circle v-else :size="8" fill="currentColor" />
          </span>
        </template>
      </button>
    </div>
  </div>
</template>

<style scoped>
.plans-calendar {
  display: grid;
  gap: var(--hf-space-2);
  padding: var(--hf-space-4);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-lg);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-sm);
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
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2.75rem;
  height: 2.75rem;
  border: none;
  border-radius: var(--hf-radius-md);
  background: transparent;
  color: var(--hf-color-text);
  cursor: pointer;
}
.plans-calendar__nav:disabled {
  color: var(--hf-color-text-muted);
  cursor: not-allowed;
}
.plans-calendar__nav:focus-visible,
.plans-calendar__cell:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
}
.plans-calendar__weekdays,
.plans-calendar__grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: var(--hf-space-1);
}
.plans-calendar__weekdays {
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
  text-align: center;
}
.plans-calendar__cell {
  display: grid;
  align-content: start;
  justify-items: center;
  gap: 2px;
  min-width: 0;
  min-height: 2.75rem;
  padding: var(--hf-space-1);
  border: 1px solid transparent;
  border-radius: var(--hf-radius-md);
  background: transparent;
  color: var(--hf-color-text);
  font: inherit;
  cursor: pointer;
}
.plans-calendar__cell:disabled {
  cursor: default;
  opacity: 0.35;
}
.plans-calendar__cell--today .plans-calendar__num {
  font-weight: var(--hf-font-weight-semibold);
  text-decoration: underline;
}
.plans-calendar__cell--selected {
  border-color: var(--hf-color-action-primary);
  background: var(--hf-color-surface-subtle);
}
.plans-calendar__amount {
  max-width: 100%;
  overflow: hidden;
  font-size: var(--hf-font-size-small);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.plans-calendar__amount--income {
  color: var(--hf-color-status-success);
}
.plans-calendar__amount--expense {
  color: var(--hf-color-status-danger);
}
.plans-calendar__marker--overdue {
  color: var(--hf-color-text-danger);
}
.plans-calendar__marker--upcoming {
  color: var(--hf-color-status-info);
}
@media (max-width: 30rem) {
  /* On a phone the cell is narrow: keep the day number and the marker, the panel shows amounts. */
  .plans-calendar__amount {
    font-size: 0.625rem;
  }
}
</style>
```

(На узкой ширине суммы остаются мелким текстом; полные значения доступны в `aria-label` и панели дня. Если при проверке владельцем суммы не помещаются, скрыть `.plans-calendar__amount` в этом media-запросе и добавить значок знака; это визуальная правка без изменения тестов.)

- [ ] **Step 3: реализация `PlanKpiRow.vue`:**

```vue
<script setup lang="ts">
import type { PlansCalendarTotals } from '../../composables/useEnvelopePlanV2.js';
import FinanceMoney from '../finance/FinanceMoney.vue';

defineOptions({ name: 'PlanKpiRow' });

defineProps<{ totals: PlansCalendarTotals }>();
</script>

<template>
  <section class="kpi-row" aria-label="План месяца">
    <div class="kpi-row__tile" data-testid="kpi-planned-income">
      <p class="kpi-row__label">Плановые доходы</p>
      <FinanceMoney :minor-units="totals.plannedIncomeMinor" currency="RUB" :scale="2" />
      <p class="kpi-row__note">План месяца, не факт</p>
    </div>
    <div class="kpi-row__tile" data-testid="kpi-planned-expense">
      <p class="kpi-row__label">Плановые расходы</p>
      <FinanceMoney :minor-units="totals.plannedExpenseMinor" currency="RUB" :scale="2" />
      <p class="kpi-row__note">План месяца, не факт</p>
    </div>
    <div class="kpi-row__tile" data-testid="kpi-balance">
      <p class="kpi-row__label">Баланс</p>
      <FinanceMoney :minor-units="totals.balanceMinor" currency="RUB" :scale="2" />
      <p class="kpi-row__note">Плановые доходы минус расходы</p>
    </div>
    <div class="kpi-row__tile" data-testid="kpi-total-plans">
      <p class="kpi-row__label">Всего планов</p>
      <p class="kpi-row__count">{{ totals.activePlanCount }}</p>
      <p class="kpi-row__note">Активные платежи и доходы</p>
    </div>
  </section>
</template>

<style scoped>
.kpi-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--hf-space-3);
}
.kpi-row__tile {
  display: grid;
  gap: var(--hf-space-1);
  padding: var(--hf-space-3) var(--hf-space-4);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-lg);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-sm);
}
.kpi-row__label,
.kpi-row__note {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}
.kpi-row__count {
  margin: 0;
  font-size: var(--hf-font-size-body);
  font-weight: var(--hf-font-weight-semibold);
  font-variant-numeric: tabular-nums;
}
@media (min-width: 64rem) {
  .kpi-row {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}
</style>
```

- [ ] **Step 4: зелёный запуск.** `pnpm exec vitest run app/components/plans/PlansCalendar.test.ts app/components/plans/PlanKpiRow.test.ts`; затем `prettier --write` и `eslint` по двум компонентам (предупреждения `vue/html-self-closing` не вводить).

## T06. `PlanDayPanel` и `PlanItemList`

**Files:** создать `PlanDayPanel.vue`, `PlanDayPanel.test.ts`, `PlanItemList.vue`, `PlanItemList.test.ts`.

**Interfaces — consumes:** `PlansCalendarItem`, `TransactionJournalV2Item`, `formatPlainDateShort` (`components/obligations/format-plain-date.js`), `FinanceMoney`, `UiButton` (`components/ui/Button.vue`).

**Produces:**

```ts
// PlanDayPanel props: { date: string; items: PlansCalendarItem[]; facts: TransactionJournalV2Item[]; categoryNames: Record<string, string>; factsLoading?: boolean; factsError?: boolean; busy?: boolean }
// emits: 'add-plan' [date: string], 'pay' [item], 'skip' [item], 'record-income' [item], 'retry-facts'
// test ids: day-panel, plan-add-for-day, day-empty, day-item-<occurrenceId>, day-pay-<id>, day-skip-<id>, day-record-<id>, day-fact-<transactionId>
//
// PlanItemList props: { items: PlansCalendarItem[]; overdue: PlansCalendarItem[]; today: string; mode: 'upcoming' | 'all'; hasAnyPlans: boolean; busy?: boolean; linkedId?: string | null }
// emits: 'update:mode' [mode], 'pay' [item], 'skip' [item], 'record-income' [item], 'add-plan' [kind: 'obligation' | 'income']
// test ids: plans-list, list-mode-upcoming, list-mode-all, obligation-row-<id>, obligation-pay-<id>, obligation-skip-<id>, income-row-<id>, income-record-<id>, obligation-overdue, obligation-linked, plan-add-obligation-empty, plan-add-income-empty, list-forecast
```

Поведение `PlanItemList`:

- «Ближайшие»: `overdue` (все, первыми), затем элементы месяца со статусом `PENDING`/`DUE`, у которых `kind === 'INCOME_PLAN'` или `scheduledOn >= today`. Просроченные платежи месяца уже в `overdue`, дублей нет.
- «Все»: все `items` месяца, сначала открытые, потом остальные, порядок сервера сохраняется.
- Действия: платёж открыт (`PENDING`/`DUE`) — «Оплатить» (`obligation-pay-<id>`) и, если `paidMinor === '0'`, «Пропустить» (`obligation-skip-<id>`); плановый доход открыт — «Записать доход» (`income-record-<id>`). Строки платежа: `id="obligation-<occurrenceId>"`, `data-testid="obligation-row-<id>"`, метка «Из уведомления» при `linkedId`, «Просрочено» (`obligation-overdue`) при `item.overdue`, статусные метки «Выполнено»/«Пропущено»/«Отменено», остаток при `unpaidMinor !== '0'`. Строки дохода: `income-row-<id>`, «Прогноз — не входит в «На счетах»» для открытых, «Записан» для выполненных.
- Строка-прогноз `list-forecast` («Это прогноз: пока деньги не пришли и вы не записали их как доход, они не входят в «На счетах» и не увеличивают «Можно потратить».») видна, когда в показанном списке есть открытый плановый доход.
- Пустое состояние: если `hasAnyPlans` ложно — два блока: «Обязательных платежей пока нет. Добавьте аренду, коммунальные платежи, кредиты — «Можно потратить» учтёт их заранее.» с кнопкой «Добавить платёж» (`plan-add-obligation-empty`) и «Здесь будут ожидаемые поступления.» с кнопкой «Добавить доход» (`plan-add-income-empty`); иначе «Ближайших планов нет.» (режим «Ближайшие») или «На этот месяц планов нет.» (режим «Все») и те же две кнопки.
- Переключатель режимов: две кнопки `role="tab"`/`aria-selected` в `role="tablist"` «Показать планы» (`list-mode-upcoming` «Ближайшие», `list-mode-all` «Все»), эмитят `update:mode`.
- Корневой элемент `section` с `ref`-доступным `tabindex="-1"` и `data-testid="plans-list"`, `aria-label="Планы"`; страница фокусирует его после действий (через `defineExpose({ focus })`).

- [ ] **Step 1: красные тесты `PlanItemList.test.ts`** (фикстуры: `daycare` просрочен 2026-09-10 `DUE` 300000, `rent` `PENDING` 2026-09-30 4000000, `done` `COMPLETED` 2026-09-12, `salary` доход `PENDING` 2026-09-25 10000000, `today = '2026-09-24'`). Проверки:
  1. режим `upcoming` с `overdue: [daycare]`, `items: [rent, salary, done]` показывает порядок daycare, rent, salary и не показывает done; режим `all` с `items: [daycare, rent, done, salary]` показывает все четыре, открытые первыми.
  2. у daycare есть `obligation-overdue`; у rent нет; `linkedId: 'occ-rent'` даёт `aria-current="true"` и `obligation-linked` «Из уведомления».
  3. клик `obligation-pay-occ-rent` эмитит `pay` с исходным объектом; `obligation-skip-occ-rent` эмитит `skip`; у частично оплаченного (`paidMinor !== '0'`) кнопки пропуска нет; клик `income-record-inc-occ` эмитит `record-income`.
  4. `list-forecast` виден, когда есть открытый доход, и отсутствует без него; текста «не защищает текущие обязательства» нет.
  5. пустые состояния: `hasAnyPlans: false` показывает обе фразы и обе кнопки (клики эмитят `add-plan` с `'obligation'` и `'income'`); `hasAnyPlans: true` в режиме `upcoming` показывает «Ближайших планов нет.», в `all` — «На этот месяц планов нет.».
  6. переключатель: клик по `list-mode-all` эмитит `update:mode` со значением `'all'`; `aria-selected` соответствует `mode`.
  7. при `busy: true` кнопки действий неактивны.

  Тест пишется полностью по этим пунктам (каждая проверка — конкретные `expect`), красный запуск: `pnpm exec vitest run app/components/plans/PlanItemList.test.ts`.

- [ ] **Step 2: реализация `PlanItemList.vue`.** Перенести разметку строк из старого `plans.vue` (блоки `li.obligation-row` и строка дохода) в компонент без изменения классов, добавив `PlansCalendarItem` вместо `ObligationOccurrenceItem`/`IncomeOccurrenceItem`; использовать `formatPlainDateShort`, `FinanceMoney`, иконки `AlertTriangle`, `Bell`, `Check`, `Plus`, `SkipForward`, `TrendingUp` (`@lucide/vue`); стили строк (`.obligation-row*`, `.income-row__forecast`, `.obligation-list__empty`, `.obligation-list__items`) перенести из `plans.vue` в `<style scoped>` компонента. Логика выбора элементов:

```ts
const isOpen = (item: PlansCalendarItem) => item.status === 'PENDING' || item.status === 'DUE';

const shown = computed<PlansCalendarItem[]>(() => {
  if (props.mode === 'upcoming') {
    const overdueIds = new Set(props.overdue.map((item) => item.occurrenceId));
    const rest = props.items.filter(
      (item) =>
        isOpen(item) &&
        !overdueIds.has(item.occurrenceId) &&
        (item.kind === 'INCOME_PLAN' || item.scheduledOn >= props.today),
    );
    return [...props.overdue, ...rest];
  }
  return [...props.items.filter(isOpen), ...props.items.filter((item) => !isOpen(item))];
});
const hasOpenIncome = computed(() =>
  shown.value.some((item) => item.kind === 'INCOME_PLAN' && isOpen(item)),
);
```

  Корневой `section` с `tabindex="-1"`, `defineExpose({ focus: () => root.value?.focus() })`.

- [ ] **Step 3: красные тесты `PlanDayPanel.test.ts`:** заголовок содержит дату («24 сентября»); пустой день показывает `day-empty` «На этот день пока ничего нет»; кнопка `plan-add-for-day` эмитит `add-plan` с датой дня; плановые строки (`day-item-<id>`) с действиями `day-pay-`, `day-skip-`, `day-record-` и эмитами `pay`/`skip`/`record-income`; факты (`day-fact-<id>`) показывают название категории из `categoryNames`, подпись «Доход» или «Расход» словами, комментарий/получателя/источник, сумму; `factsLoading` показывает «Загрузка операций…»; `factsError` показывает `role="alert"` «Не удалось загрузить операции дня.» и кнопку «Повторить» (эмит `retry-facts`); `busy` блокирует действия.

- [ ] **Step 4: реализация `PlanDayPanel.vue`** по тем же правилам: карточка (`border`, `radius-lg`, `surface`, `shadow-sm`), заголовок `<h2>` с датой (`format(date, 'd MMMM, EEEE', { locale: ru })`), список плановых позиций (имя, статус словами, сумма `FinanceMoney`, кнопки-иконки с `aria-label` «Оплатить {name}», «Пропустить {name}», «Записать доход {name}», `min-width/min-height: 2.75rem`), список фактов (иконка и слово «Доход»/«Расход», сумма `FinanceMoney`, подпись `merchantName ?? sourceDescription ?? comment`), кнопка «Добавить план» (`UiButton variant="secondary"`, `data-testid="plan-add-for-day"`).

- [ ] **Step 5: зелёный запуск** обоих файлов, `prettier --write`, `eslint`.

## T07. Интеграция в `plans.vue`

**Files:** изменить `apps/web/app/pages/app/plans.vue`, `apps/web/app/pages/app/plans.test.ts`.

**Interfaces — consumes:** всё из T04–T06; `useEnvelopePlanV2().getPlansCalendar`, `listTransactions`; `PlanCreateDialog` (`initialKind`, `initialDate`, события `submit`/`close`).

Страница остаётся владельцем состояния и листов (`ObligationPaySheet`, `IncomeRecordSheet`, `PlanCreateDialog`, `UiConfirmDialog`). Меняются источник данных и разметка списков.

- [ ] **Step 1: красные тесты страницы.** В `plans.test.ts`:
  - В мок `v2` добавить `getPlansCalendar: vi.fn()` и `listTransactions: vi.fn()`; `listObligationOccurrences`/`listIncomeOccurrences` из мока убрать (страница их больше не вызывает).
  - Добавить хелпер:

```ts
const toCalendarItem = (
  item: { id: string; planId: string; name: string; scheduledOn: string; status: string; expectedMinor: string; categoryId: string | null },
  kind: 'OBLIGATION' | 'INCOME_PLAN',
  extra: { paidMinor?: string; unpaidMinor?: string; overdue?: boolean; transactionId?: string | null } = {},
) => ({
  kind,
  occurrenceId: item.id,
  planId: item.planId,
  name: item.name,
  scheduledOn: item.scheduledOn,
  status: item.status,
  expectedMinor: item.expectedMinor,
  paidMinor: extra.paidMinor ?? '0',
  unpaidMinor: extra.unpaidMinor ?? (kind === 'OBLIGATION' ? item.expectedMinor : '0'),
  categoryId: item.categoryId,
  overdue: extra.overdue ?? false,
  transactionId: extra.transactionId ?? null,
});

function calendarOf(
  items: ReturnType<typeof toCalendarItem>[],
  overdue: ReturnType<typeof toCalendarItem>[] = [],
  totals = { plannedIncomeMinor: '0', plannedExpenseMinor: '0', balanceMinor: '0', activePlanCount: items.length },
) {
  return { month: '2026-09', today: '2026-09-24', days: [], items, overdue, overdueCount: overdue.length, totals };
}
```

  - В `beforeEach`: `v2.getPlansCalendar.mockResolvedValue(calendarOf([toCalendarItem(rent, 'OBLIGATION'), toCalendarItem(salary, 'INCOME_PLAN')], [toCalendarItem(daycare, 'OBLIGATION', { overdue: true })]))` и `v2.listTransactions.mockResolvedValue({ items: [], nextCursor: null })`. Все существующие тесты, которые переопределяют `listObligationOccurrences`/`listIncomeOccurrences` или проверяют их вызовы, переписать на `getPlansCalendar` (`toHaveBeenCalledWith('budget-id', '2026-09')`; после успешного действия список перечитывается — `getPlansCalendar` вызывается ещё раз). Тест «ожидаемый доход» использует `list-forecast` вместо старого текста. Контейнеры `obligation-list` и `income-list` заменены на `plans-list`.
  - Новые тесты (каждый с конкретными `expect`): (1) на загрузке вызывается `getPlansCalendar('budget-id', '2026-09')`, видны `calendar-day-2026-09-24` и четыре плитки; (2) баннер `overdue-banner` «Просрочено: 1» при `overdueCount: 1`, его кнопка «Показать» переключает список на «Ближайшие» и фокусирует `plans-list`, при нуле баннера нет; (3) клик по дню 2026-09-10 вызывает `listTransactions('budget-id', { from: '2026-09-10', to: '2026-09-10', status: 'CONFIRMED', limit: 50 })` и панель показывает возвращённую операцию; (4) `plan-add-for-day` открывает `PlanCreateDialog` с датой выбранного дня (в поле «Ближайший платёж» значение `10.09.2026`); (5) смена месяца вызывает `getPlansCalendar('budget-id', '2026-10')`; быстрый двойной клик по «Следующий месяц»/«Предыдущий месяц» отбрасывает устаревший ответ (первый `mockResolvedValueOnce` с задержкой не перетирает второй); (6) ошибка чтения календаря показывает `role="alert"` «Не удалось загрузить календарь.» и кнопку «Повторить», повторный клик вызывает чтение заново; (7) оплата из панели дня вызывает `payObligation` (те же листы), и после неё перечитываются календарь и операции дня; (8) `?occurrence=` подсвечивает строку, если она есть в `items` или `overdue`, и игнорируется иначе (прежняя семантика).
  - Красный запуск: `cd apps/web && pnpm exec vitest run app/pages/app/plans.test.ts`.

- [ ] **Step 2: состояние и загрузка.** В `plans.vue`:
  - Импорты: `PlansCalendar`, `PlanKpiRow`, `PlanDayPanel`, `PlanItemList`, типы `PlansCalendarResponse`, `PlansCalendarItem`, `TransactionJournalV2Item`; убрать неиспользуемые импорты иконок и `FinanceMoney`/`formatPlainDateShort`, если больше не нужны странице.
  - Состояние:

```ts
const monthKey = ref(format(new Date(), 'yyyy-MM'));
const monthAnchor = computed(() => `${monthKey.value}-01`);
const selectedDate = ref(today);
const calendar = ref<PlansCalendarResponse | null>(null);
const calendarLoading = ref(false);
const calendarError = ref(false);
const listMode = ref<'upcoming' | 'all'>('upcoming');
const dayFacts = ref<TransactionJournalV2Item[]>([]);
const factsLoading = ref(false);
const factsError = ref(false);
const planListEl = ref<InstanceType<typeof PlanItemList> | null>(null);
let calendarRequest = 0;
let factsRequest = 0;

const calendarDays = computed(() => (calendar.value?.month === monthKey.value ? calendar.value.days : []));
const calendarItems = computed(() => (calendar.value?.month === monthKey.value ? calendar.value.items : []));
const overdueItems = computed(() => calendar.value?.overdue ?? []);
const dayItems = computed(() => calendarItems.value.filter((item) => item.scheduledOn === selectedDate.value));
const categoryNames = computed(() => Object.fromEntries(categories.value.map((category) => [category.id, category.name])));
```

  - Заменить тело `loadObligations(withReference = false)`: параллельно `loadCalendar()` (бросает при ошибке в `loadAll`, как прежде), справочники при `withReference`, затем `loadFacts()`; убрать `obligations`, `incomeOccurrences`, `incomeLoadFailed`, `sortedObligations`, `visibleIncome` и связанные с ними computed. `loadCalendar`:

```ts
async function loadCalendar(): Promise<void> {
  if (!budget.value) return;
  const request = ++calendarRequest;
  calendarLoading.value = true;
  calendarError.value = false;
  try {
    const result = await v2.getPlansCalendar(budget.value.id, monthKey.value);
    if (request !== calendarRequest) return;
    calendar.value = result;
  } catch (exception) {
    if (request === calendarRequest) calendarError.value = true;
    throw exception;
  } finally {
    if (request === calendarRequest) calendarLoading.value = false;
  }
}
```

  - `loadFacts()` с защитой от устаревших ответов (`factsRequest`), вызов `v2.listTransactions(budget.value.id, { from: selectedDate.value, to: selectedDate.value, status: 'CONFIRMED', limit: 50 })`, ошибка выставляет `factsError`.
  - `changeMonth(anchor: string)`: `monthKey.value = anchor.slice(0, 7)`; выбор дня: сегодня, если месяц текущий по `calendar.today` (иначе по браузерной `today`), иначе первый день месяца; `void loadCalendar().catch(() => undefined)` и `void loadFacts()`.
  - `selectDay(date)`: `selectedDate.value = date; void loadFacts()`.
  - Преобразование для листов: `toObligationOccurrence(item): ObligationOccurrenceItem` (`id: item.occurrenceId`, `planId`, `name`, `scheduledOn`, `status`, `expectedMinor`, `paidMinor`, `unpaidMinor`, `categoryId`, `envelopeId: null`) и `toIncomeOccurrence(item): IncomeOccurrenceItem` (`id: item.occurrenceId`, … `transactionId`); обработчики `onPay(item) => openPay(toObligationOccurrence(item))`, `onSkip(item) => { confirmation.value = { action: 'skip', occurrenceId: item.occurrenceId } }`, `onRecordIncome(item) => openIncomeRecord(toIncomeOccurrence(item))`.
  - `applyOccurrenceLink` ищет `wanted` среди `calendarItems` и `overdueItems`; прокрутка к `obligation-<id>` как раньше. После успешного создания плана (`submitPlan`) фокус возвращается на `planListEl.value?.focus()` для обоих видов плана (вместо двух прежних ref-списков); аналогично после оплаты и записи дохода. Удалить ref `obligationListEl` и `incomeListEl`.
  - `openPlanDialog(kind, date?)`: сохраняет `planDialogDate` (`date ?? today`), передаётся в `initial-date` диалога вместо константы `today`; кнопка панели дня вызывает `openPlanDialog('obligation', date)`.

- [ ] **Step 3: разметка.** Внутри `#content` вместо двух `section`:

```vue
<p v-if="calendarError" class="plans-page__error" role="alert">
  Не удалось загрузить календарь.
  <UiButton variant="tertiary" size="sm" data-testid="calendar-retry" @click="retryCalendar">Повторить</UiButton>
</p>
<p v-if="(calendar?.overdueCount ?? 0) > 0" class="plans-page__overdue" data-testid="overdue-banner">
  <AlertTriangle :size="16" aria-hidden="true" />
  Просрочено: {{ calendar?.overdueCount }}
  <UiButton variant="tertiary" size="sm" @click="showOverdue">Показать</UiButton>
</p>
<PlanKpiRow v-if="calendar" :totals="calendar.totals" />
<div class="plans-page__board">
  <PlansCalendar
    :month-anchor="monthAnchor"
    :selected-date="selectedDate"
    :today="calendar?.today ?? today"
    :days="calendarDays"
    :loading="calendarLoading"
    @select-day="selectDay"
    @change-month="changeMonth"
  />
  <PlanDayPanel
    :date="selectedDate"
    :items="dayItems"
    :facts="dayFacts"
    :category-names="categoryNames"
    :facts-loading="factsLoading"
    :facts-error="factsError"
    :busy="pending"
    @add-plan="openPlanDialog('obligation', $event)"
    @pay="onPay"
    @skip="onSkip"
    @record-income="onRecordIncome"
    @retry-facts="loadFacts"
  />
</div>
<PlanItemList
  ref="planListEl"
  v-model:mode="listMode"
  :items="calendarItems"
  :overdue="overdueItems"
  :today="calendar?.today ?? today"
  :has-any-plans="(calendar?.totals.activePlanCount ?? 0) > 0"
  :busy="pending || payPending || incomePending"
  :linked-id="linkedOccurrenceId"
  @pay="onPay"
  @skip="onSkip"
  @record-income="onRecordIncome"
  @add-plan="openPlanDialog($event)"
/>
```

  `retryCalendar`: `void loadCalendar().catch(() => undefined)`. `showOverdue`: `listMode.value = 'upcoming'`, затем `await nextTick(); planListEl.value?.focus()`. Кнопка в шапке «Добавить платёж» (`plan-add-obligation`) остаётся. Стили: `.plans-page__board { display: grid; gap: var(--hf-space-4); grid-template-columns: minmax(0, 1fr); }` и `@media (min-width: 64rem) { .plans-page__board { grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); align-items: start; } }`; `.plans-page__overdue` — строка с иконкой «!» и текстом (не только цвет), токены `--hf-color-text-danger`; контейнер `#content` делает вертикальный `display: grid; gap: var(--hf-space-4)`. Старые стили строк перенесены в `PlanItemList` (T06), удалить из страницы.

- [ ] **Step 4: зелёный запуск и проверки.** `pnpm exec vitest run app/pages/app/plans.test.ts app/components/plans`, затем весь `pnpm exec vitest run` (все 837+ тестов `apps/web` зелёные), `pnpm exec eslint app`, `pnpm typecheck`, `prettier --write` по изменённым файлам.

## T08. e2e, документы, финальные проверки

**Files:** `e2e/envelope-v2-plans.spec.ts`, `e2e/envelope-v2-payments.spec.ts`, `docs/superpowers/plans/2026-10-03-envelope-v2.2-open-decisions.md`, `docs/ux/newcomer-walkthrough.md`.

- [ ] **Step 1: e2e `envelope-v2-plans.spec.ts`.** Заменить `getByTestId('obligation-list')` и `getByTestId('income-list')` на `getByTestId('plans-list')`: пустое состояние содержит обе фразы («Обязательных платежей пока нет.», «Здесь будут ожидаемые поступления.»), после создания платежа список в режиме «Ближайшие» содержит «Аренда», после создания дохода — «Зарплата» и «Это прогноз». Кнопки «Добавить платёж» (шапка и пустое состояние) и «Добавить доход» (пустое состояние) остаются. Добавить второй тест `calendar: day panel adds a plan on the selected date`: после регистрации и применения шаблона (SETUP через API, как в первом тесте) → `/app/plans` → нажать `calendar-day-<сегодня в формате ГГГГ-ММ-ДД, взятый из браузера через page.evaluate>` → `day-panel` виден и содержит «На этот день пока ничего нет» → `plan-add-for-day` → диалог «Создать план» с датой дня (`#planScheduledOn-input` значение `ДД.ММ.ГГГГ`) → заполнить сумму, название, категорию → «Добавить платёж» → день в календаре получает `calendar-dot-<дата>` с `data-dot="upcoming"`. **Не запускать.**
- [ ] **Step 2: e2e `envelope-v2-payments.spec.ts`.** Строки платежей остаются в «Ближайшие» только пока открыты; перед проверкой выполненных строк (около строки 205, `kindergartenRow` с «Выполнено») переключить список: `await page.getByTestId('list-mode-all').click();` и аналогично перед проверкой `rentRow` со статусом выполнено, если такая есть. Прочие селекторы (`obligation-row-*`, `obligation-pay-*`) не менялись. **Не запускать.**
- [ ] **Step 3: open-decisions.** В `docs/superpowers/plans/2026-10-03-envelope-v2.2-open-decisions.md` §1.3 дописать строкой: «Календарь по дням сделан (чтение `GET /api/v2/budgets/:id/plans/calendar`, компоненты `PlansCalendar`, `PlanDayPanel`, `PlanKpiRow`, `PlanItemList`). Остаются: правка и остановка плана (UX-15)»; в §2 добавить пункты: «Горизонт occurrences 60 дней: календарь блокирует следующий месяц за горизонтом; повторяющийся плановый доход получает возникновения только при создании», «Ссылка уведомления `?occurrence=` на платёж вне открытого месяца не подсвечивается (календарь показывает выбранный месяц и просроченные)», «`GET plans/calendar` не ограничивает число просроченных платежей (ожидаемо единицы)». В UX-17 журнала `docs/ux/newcomer-walkthrough.md` обновить статус: «календарь сделан (SHA — после коммита); правка и остановка планов отдельно».
- [ ] **Step 4: полные проверки (из корня).** `cd apps/api && pnpm exec vitest run src/plans-calendar test/v2-plans-calendar.integration.test.ts test/v2-openapi.integration.test.ts` (интеграционные на `harmofin_v22_test`); `cd apps/web && pnpm exec vitest run`, `pnpm exec eslint app`; из корня `pnpm typecheck`; `pnpm exec prettier --check` по всем изменённым и созданным файлам (`git status --short`, исключая чужие правки). Отчёт: числа пройденных тестов и все пропуски.

## Ревью (после T08, до коммита)

Независимые read-only ревью, каждое по короткому пакету (дизайн, список файлов, evidence): **API-контракт** (`plans-calendar.dto.ts`, контроллер, OpenAPI-индекс, совпадение типов клиента `PlansCalendarResponse` с DTO), **безопасность и изоляция** (фильтр `budget_id` в каждом запросе, 404/401/409, чужие данные, только чтение), **финансовое** (суммы только серверные, `CONFIRMED`-факты, плановые итоги по §6, отсутствие арифметики над деньгами в вебе, переводы не входят), **backend** (запросы репозитория, индексы, снимок `RepeatableRead`, `EXPLAIN`), **UI/UX** (Calm Fintech, доступность календаря с клавиатуры, маркеры не только цветом, 390px, тексты), **QA** (покрытие тестов по задачам, регрессии существующих сценариев, e2e-селекторы), **финальное**. `BLOCK` исправить и повторить затронутое ревью.

## Коммит

Только с согласия владельца, по файлам задач. Предлагаемое разбиение: (1) `feat(api): чтение календаря планов v2` (T01–T03 и тесты), (2) `feat(web): календарь планов по дням` (T04–T08). SHA для журнала UX проставить вторым небольшим коммитом.
