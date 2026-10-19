# Демо-витрина `/demo` — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Публичная страница `/demo`, где посетитель настраивает финансовый цикл и проходит «Месяц семьи» из шести шагов с двумя выборами на настоящих компонентах приложения.

**Architecture:** Все суммы — литералы minor units в `apps/web/app/data/demo-scenario.ts` (11 снимков состояния). Функции-отображатели только копируют литералы в DTO компонентов (`DashboardV2Response`, `EnvelopePlanDto`, `GoalProgressRowDto`) без арифметики над деньгами. Даты считает чистая функция `demoPeriodDates` по строкам `YYYY-MM-DD` через `Date.UTC`. Страница хранит состояние в query-параметрах и рендерит компоненты приложения внутри `LandingShowcase` (inert).

**Tech Stack:** Nuxt 4, Vue 3.5, Vitest, `@vue/test-utils`, Playwright (только CI).

**Spec:** [docs/superpowers/specs/2026-10-19-demo-showcase-design.md](../specs/2026-10-19-demo-showcase-design.md)

## Global Constraints

- Страница не складывает, не вычитает и не делит денежные суммы; суммы — литералы в данных. Тесты считать могут.
- Нет обращений к API на `/demo`.
- Параметры URL: `step` 0–6 (по умолчанию 0), `start` 1–28 (10), `offset` 1–27 (15), `split` `suggested` | `vacation`, `leftover` `carry` | `save`.
- Ошибки цикла: «Укажите день от 1 до 28.», «Укажите число дней от 1 до 27.».
- Сценарий — первый период цикла, начинающийся `start` октября 2026 года.
- Тексты по глоссарию; слово «назначение» в смысле раскладывания денег запрещено.
- Строки «можно тратить в день» на демо нет.
- Local Playwright не запускать. Перед каждым коммитом `git branch --show-current` = `feat/demo-showcase`.

## Уточнения относительно спеки

1. Конверт «Резерв» имеет тип `RESERVE` (так он устроен в модели и в `landing-demo.ts`), а не `SAVINGS_GOAL`.
2. Выбор на шаге 5 — кнопками шага (`DemoStepCard`). `PeriodDecisionCard` не используется: он вызывает `useEnvelopePlanV2()` (API), а спека разрешает собственную карточку в этом случае.
3. При «Отложить в накопления» у конверта «Текущие траты» `fundedMinor` уменьшается на переложенную сумму (`1240000`, баланс `0`), чтобы строка конверта не показывала отрицательный остаток.

## Структура файлов

| Файл | Ответственность |
|---|---|
| `apps/web/app/data/demo-period-dates.ts` (+ test) | даты периода и событий из `start`/`offset` |
| `apps/web/app/data/demo-scenario.ts` (+ test) | шаги, варианты, снимки, отображатели в DTO, инварианты |
| `apps/web/app/components/demo/DemoCycleStep.vue` (+ test) | шаг 0: поля цикла и `CyclePreview` |
| `apps/web/app/components/demo/DemoStepCard.vue` (+ test) | текст шага и группа выбора |
| `apps/web/app/components/demo/DemoStage.vue` (+ test) | «экран приложения» для снимка |
| `apps/web/app/pages/demo.vue` (+ `demo.test.ts`) | URL-состояние, навигация, раскладка |
| `apps/web/app/components/landing/sections/HeroSection.vue`, `apps/web/app/data/landing.ts` (+ tests) | ссылки на `/demo` |
| `e2e/demo.spec.ts` | CI-сценарий |

---

### Task 1: Даты периода

**Files:**
- Create: `apps/web/app/data/demo-period-dates.ts`
- Test: `apps/web/app/data/demo-period-dates.test.ts`

**Interfaces:**
- Produces:

```ts
export type DemoPeriodDates = {
  periodStart: string; // YYYY-MM-DD, start-е октября 2026
  periodEnd: string; // день перед началом второго периода
  secondPeriodStart: string;
  salaryOn: string;
  mortgageOn: string;
  shoppingFrom: string;
  shoppingTo: string;
  laterPaymentsOn: string; // срок детсада, коммуналки и интернета: начало второго периода
  daysLeftAfterShopping: number; // periodEnd − shoppingTo в днях, ≥ 0
};
export function demoPeriodDates(start: number, offset: number): DemoPeriodDates;
export function formatDemoDate(iso: string): string; // "10 октября"
```

- [ ] **Step 1: Падающий тест**

```ts
import { describe, expect, it } from 'vitest';

import { demoPeriodDates, formatDemoDate } from './demo-period-dates.js';

describe('demoPeriodDates', () => {
  it('places the default cycle inside October 2026', () => {
    expect(demoPeriodDates(10, 15)).toEqual({
      periodStart: '2026-10-10',
      periodEnd: '2026-10-24',
      secondPeriodStart: '2026-10-25',
      salaryOn: '2026-10-10',
      mortgageOn: '2026-10-14',
      shoppingFrom: '2026-10-15',
      shoppingTo: '2026-10-21',
      laterPaymentsOn: '2026-10-25',
      daysLeftAfterShopping: 3,
    });
  });

  it('crosses into November when the boundary passes the month end', () => {
    const dates = demoPeriodDates(28, 27);
    expect(dates.periodStart).toBe('2026-10-28');
    expect(dates.secondPeriodStart).toBe('2026-11-24');
    expect(dates.periodEnd).toBe('2026-11-23');
  });

  it('keeps every event inside a short period and never goes negative', () => {
    const dates = demoPeriodDates(1, 1);
    expect(dates).toMatchObject({
      periodStart: '2026-10-01',
      periodEnd: '2026-10-01',
      secondPeriodStart: '2026-10-02',
      mortgageOn: '2026-10-01',
      shoppingFrom: '2026-10-01',
      shoppingTo: '2026-10-01',
      daysLeftAfterShopping: 0,
    });
    expect(demoPeriodDates(5, 6)).toMatchObject({
      periodEnd: '2026-10-10',
      mortgageOn: '2026-10-09',
      shoppingFrom: '2026-10-10',
      shoppingTo: '2026-10-10',
      daysLeftAfterShopping: 0,
    });
  });

  it('formats a date in Russian without a year', () => {
    expect(formatDemoDate('2026-10-05')).toBe('5 октября');
    expect(formatDemoDate('2026-11-24')).toBe('24 ноября');
  });
});
```

Run: `pnpm --filter @harmofin/web exec vitest run app/data/demo-period-dates.test.ts`
Expected: FAIL — модуль не найден.

- [ ] **Step 2: Реализация**

```ts
// Calendar math only (no money): the demo scenario lives in the first period of a cycle that
// starts on `start` October 2026. UTC dates avoid any timezone drift between SSR and browser.

export type DemoPeriodDates = {
  periodStart: string;
  periodEnd: string;
  secondPeriodStart: string;
  salaryOn: string;
  mortgageOn: string;
  shoppingFrom: string;
  shoppingTo: string;
  laterPaymentsOn: string;
  daysLeftAfterShopping: number;
};

const DAY_MS = 86_400_000;
const MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

function iso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function demoPeriodDates(start: number, offset: number): DemoPeriodDates {
  const periodStartMs = Date.UTC(2026, 9, start);
  const secondStartMs = periodStartMs + offset * DAY_MS;
  const periodEndMs = secondStartMs - DAY_MS;
  // Event day N of the period (1-based), clamped to the period's last day.
  const day = (n: number) => Math.min(periodStartMs + (n - 1) * DAY_MS, periodEndMs);
  const shoppingToMs = day(12);
  return {
    periodStart: iso(periodStartMs),
    periodEnd: iso(periodEndMs),
    secondPeriodStart: iso(secondStartMs),
    salaryOn: iso(periodStartMs),
    mortgageOn: iso(day(5)),
    shoppingFrom: iso(day(6)),
    shoppingTo: iso(shoppingToMs),
    laterPaymentsOn: iso(secondStartMs),
    daysLeftAfterShopping: Math.max(0, Math.round((periodEndMs - shoppingToMs) / DAY_MS)),
  };
}

export function formatDemoDate(value: string): string {
  const [, month, day] = value.split('-');
  return `${Number(day)} ${MONTHS[Number(month) - 1] ?? ''}`.trim();
}
```

Run: команда Step 1. Expected: PASS. Prettier может переразбить массив `MONTHS` — это нормально.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/data/demo-period-dates.ts apps/web/app/data/demo-period-dates.test.ts
git commit -m "feat(web): даты периода для демо-витрины"
```

---

### Task 2: Сценарий и предрасчитанные снимки

**Files:**
- Create: `apps/web/app/data/demo-scenario.ts`
- Test: `apps/web/app/data/demo-scenario.test.ts`

**Interfaces:**
- Consumes: `DemoPeriodDates`, `formatDemoDate` (Task 1); типы `DashboardV2Response`, `EnvelopePlanDto` из `../composables/useEnvelopePlanV2.js`, `GoalProgressRowDto` из `../composables/useBudgetReferenceData.js`.
- Produces:

```ts
export type DemoSplit = 'suggested' | 'vacation';
export type DemoLeftover = 'carry' | 'save';
export type DemoChoices = { split: DemoSplit | null; leftover: DemoLeftover | null };
export type DemoEnvelopeKey = 'mandatory' | 'current' | 'vacation' | 'reserve';
export type DemoEnvelopeAmounts = { fundedMinor: string; spentMinor: string; balanceMinor: string };
export type DemoSnapshot = {
  key: string;
  cashMinor: string;
  freeToAssignMinor: string;
  envelopesTotalMinor: string;
  envelopes: Record<DemoEnvelopeKey, DemoEnvelopeAmounts>;
  mortgagePaid: boolean;
  vacationProgressPermille: number;
  vacationRemainingMinor: string;
};
export const DEMO_STEP_COUNT = 7;
export const DEMO_SNAPSHOTS: Record<string, DemoSnapshot>;
export function snapshotKey(step: number, choices: DemoChoices): string | null;
export function demoSnapshot(step: number, choices: DemoChoices): DemoSnapshot | null;
export function toDashboard(snapshot: DemoSnapshot, dates: DemoPeriodDates, asOf: string): DashboardV2Response;
export function toEnvelopeRows(snapshot: DemoSnapshot): EnvelopePlanDto[];
export function toGoalRows(snapshot: DemoSnapshot): GoalProgressRowDto[];
export type DemoStepText = { title: string; body: string; caption: string };
export function demoStepText(step: number, choices: DemoChoices, dates: DemoPeriodDates): DemoStepText;
export const DEMO_CHOICES: {
  split: Array<{ value: DemoSplit; label: string; hint: string }>;
  leftover: Array<{ value: DemoLeftover; label: string; hint: string }>;
};
```

- [ ] **Step 1: Падающий тест инвариантов `apps/web/app/data/demo-scenario.test.ts`**

```ts
import { describe, expect, it } from 'vitest';

import { demoPeriodDates } from './demo-period-dates.js';
import {
  DEMO_SNAPSHOTS,
  demoSnapshot,
  demoStepText,
  snapshotKey,
  toDashboard,
  toEnvelopeRows,
  toGoalRows,
  type DemoChoices,
  type DemoSnapshot,
} from './demo-scenario.js';

const sum = (values: string[]) => values.reduce((total, value) => total + BigInt(value), 0n);
const balances = (s: DemoSnapshot) => Object.values(s.envelopes).map((e) => e.balanceMinor);
const PATHS: DemoChoices[] = [
  { split: 'suggested', leftover: 'carry' },
  { split: 'suggested', leftover: 'save' },
  { split: 'vacation', leftover: 'carry' },
  { split: 'vacation', leftover: 'save' },
];

describe('demo scenario snapshots', () => {
  it.each(Object.values(DEMO_SNAPSHOTS))('$key: envelopes + free = cash, total matches', (s) => {
    expect(sum(balances(s)) + BigInt(s.freeToAssignMinor)).toBe(BigInt(s.cashMinor));
    expect(sum(balances(s))).toBe(BigInt(s.envelopesTotalMinor));
    for (const envelope of Object.values(s.envelopes)) {
      expect(BigInt(envelope.balanceMinor)).toBe(
        BigInt(envelope.fundedMinor) - BigInt(envelope.spentMinor),
      );
    }
  });

  it.each(Object.values(DEMO_SNAPSHOTS))('$key: vacation goal progress matches 150 000 ₽', (s) => {
    const current = BigInt(s.envelopes.vacation.balanceMinor);
    expect(BigInt(s.vacationRemainingMinor)).toBe(15_000_000n - current);
    expect(s.vacationProgressPermille).toBe(Number((current * 1000n) / 15_000_000n));
  });

  it.each(PATHS)('path %o changes only the expected envelopes step by step', (choices) => {
    const at = (step: number) => demoSnapshot(step, choices)!;
    const changed = (a: DemoSnapshot, b: DemoSnapshot) =>
      (Object.keys(a.envelopes) as Array<keyof DemoSnapshot['envelopes']>).filter(
        (k) => a.envelopes[k].balanceMinor !== b.envelopes[k].balanceMinor,
      );
    expect(at(1).freeToAssignMinor).toBe('12000000');
    expect(at(2).freeToAssignMinor).toBe('0');
    expect(changed(at(2), at(3))).toEqual(['mandatory']);
    expect(BigInt(at(2).cashMinor) - BigInt(at(3).cashMinor)).toBe(3_600_000n);
    expect(changed(at(3), at(4))).toEqual(['current']);
    expect(BigInt(at(3).cashMinor) - BigInt(at(4).cashMinor)).toBe(1_240_000n);
    expect(at(5)).toEqual(at(4));
    const final = changed(at(5), at(6));
    expect(final).toEqual(choices.leftover === 'save' ? ['current', 'vacation'] : []);
    expect(at(6).cashMinor).toBe(at(5).cashMinor);
  });

  it('requires the choices each step depends on', () => {
    expect(snapshotKey(0, { split: null, leftover: null })).toBe('step0');
    expect(snapshotKey(3, { split: null, leftover: null })).toBeNull();
    expect(snapshotKey(6, { split: 'suggested', leftover: null })).toBeNull();
    expect(snapshotKey(6, { split: 'vacation', leftover: 'save' })).toBe('step6:vacation+save');
  });

  it('maps snapshots into the DTOs the app components read, without changing amounts', () => {
    const dates = demoPeriodDates(10, 15);
    const s = demoSnapshot(4, { split: 'suggested', leftover: null })!;
    const dashboard = toDashboard(s, dates, dates.shoppingTo);
    expect(dashboard.cashMinor).toBe(s.cashMinor);
    expect(dashboard.currentBalanceMinor).toBe(s.envelopes.current.balanceMinor);
    expect(dashboard.spendable).toEqual({ state: 'READY', amountMinor: s.envelopes.current.balanceMinor });
    expect(dashboard.period).toEqual({ start: '2026-10-10', end: '2026-10-24', periodId: 'demo-period-salary' });
    expect(dashboard.periodStats?.daysLeft).toBe(3);
    expect(dashboard.nearestObligations.map((o) => o.name)).toEqual(['Детский сад', 'Коммунальные услуги', 'Интернет']);
    expect(toEnvelopeRows(s).map((row) => [row.name, row.balanceMinor])).toEqual([
      ['Обязательные платежи', '1600000'],
      ['Текущие траты', '3260000'],
      ['Отпуск', '1500000'],
      ['Резерв', '800000'],
    ]);
    expect(toGoalRows(s)[0]).toMatchObject({ name: 'Отпуск', currentMinor: '1500000', progressPermille: 100 });
  });

  it('writes step texts with the visitor cycle dates and glossary terms', () => {
    const dates = demoPeriodDates(5, 10);
    const texts = [0, 1, 2, 3, 4, 5, 6].map((step) =>
      demoStepText(step, { split: 'suggested', leftover: 'save' }, dates),
    );
    expect(texts[1]!.body).toContain('5 октября');
    expect(texts[3]!.body).toContain('9 октября');
    expect(texts.map((t) => `${t.title} ${t.body}`).join(' ')).not.toMatch(/назнач/i);
    expect(texts.every((t) => t.caption.length > 0)).toBe(true);
  });
});
```

Run: `pnpm --filter @harmofin/web exec vitest run app/data/demo-scenario.test.ts`
Expected: FAIL — модуль не найден.

- [ ] **Step 2: Реализация `apps/web/app/data/demo-scenario.ts`**

```ts
// «Месяц семьи» for /demo. Every amount is a precomputed minor-units literal (Envelope Plan
// Model v2.2, §8: the landing never computes money). The mappers below only copy literals into
// the DTOs the real app components read; demo-scenario.test.ts checks the arithmetic.
import type { GoalProgressRowDto } from '../composables/useBudgetReferenceData.js';
import type { DashboardV2Response, EnvelopePlanDto } from '../composables/useEnvelopePlanV2.js';
import { formatDemoDate, type DemoPeriodDates } from './demo-period-dates.js';

export type DemoSplit = 'suggested' | 'vacation';
export type DemoLeftover = 'carry' | 'save';
export type DemoChoices = { split: DemoSplit | null; leftover: DemoLeftover | null };
export type DemoEnvelopeKey = 'mandatory' | 'current' | 'vacation' | 'reserve';
export type DemoEnvelopeAmounts = { fundedMinor: string; spentMinor: string; balanceMinor: string };
export type DemoSnapshot = {
  key: string;
  cashMinor: string;
  freeToAssignMinor: string;
  envelopesTotalMinor: string;
  envelopes: Record<DemoEnvelopeKey, DemoEnvelopeAmounts>;
  mortgagePaid: boolean;
  vacationProgressPermille: number;
  vacationRemainingMinor: string;
};
export type DemoStepText = { title: string; body: string; caption: string };

export const DEMO_STEP_COUNT = 7;

const e = (fundedMinor: string, spentMinor: string, balanceMinor: string): DemoEnvelopeAmounts => ({
  fundedMinor,
  spentMinor,
  balanceMinor,
});
const EMPTY = e('0', '0', '0');

function snapshot(
  key: string,
  values: Omit<DemoSnapshot, 'key'>,
): [string, DemoSnapshot] {
  return [key, { key, ...values }];
}

export const DEMO_SNAPSHOTS: Record<string, DemoSnapshot> = Object.fromEntries([
  snapshot('step0', {
    cashMinor: '0', freeToAssignMinor: '0', envelopesTotalMinor: '0',
    envelopes: { mandatory: EMPTY, current: EMPTY, vacation: EMPTY, reserve: EMPTY },
    mortgagePaid: false, vacationProgressPermille: 0, vacationRemainingMinor: '15000000',
  }),
  snapshot('step1', {
    cashMinor: '12000000', freeToAssignMinor: '12000000', envelopesTotalMinor: '0',
    envelopes: { mandatory: EMPTY, current: EMPTY, vacation: EMPTY, reserve: EMPTY },
    mortgagePaid: false, vacationProgressPermille: 0, vacationRemainingMinor: '15000000',
  }),
  snapshot('step2:suggested', {
    cashMinor: '12000000', freeToAssignMinor: '0', envelopesTotalMinor: '12000000',
    envelopes: {
      mandatory: e('5200000', '0', '5200000'), current: e('4500000', '0', '4500000'),
      vacation: e('1500000', '0', '1500000'), reserve: e('800000', '0', '800000'),
    },
    mortgagePaid: false, vacationProgressPermille: 100, vacationRemainingMinor: '13500000',
  }),
  snapshot('step2:vacation', {
    cashMinor: '12000000', freeToAssignMinor: '0', envelopesTotalMinor: '12000000',
    envelopes: {
      mandatory: e('5200000', '0', '5200000'), current: e('3500000', '0', '3500000'),
      vacation: e('2500000', '0', '2500000'), reserve: e('800000', '0', '800000'),
    },
    mortgagePaid: false, vacationProgressPermille: 166, vacationRemainingMinor: '12500000',
  }),
  snapshot('step3:suggested', {
    cashMinor: '8400000', freeToAssignMinor: '0', envelopesTotalMinor: '8400000',
    envelopes: {
      mandatory: e('5200000', '3600000', '1600000'), current: e('4500000', '0', '4500000'),
      vacation: e('1500000', '0', '1500000'), reserve: e('800000', '0', '800000'),
    },
    mortgagePaid: true, vacationProgressPermille: 100, vacationRemainingMinor: '13500000',
  }),
  snapshot('step3:vacation', {
    cashMinor: '8400000', freeToAssignMinor: '0', envelopesTotalMinor: '8400000',
    envelopes: {
      mandatory: e('5200000', '3600000', '1600000'), current: e('3500000', '0', '3500000'),
      vacation: e('2500000', '0', '2500000'), reserve: e('800000', '0', '800000'),
    },
    mortgagePaid: true, vacationProgressPermille: 166, vacationRemainingMinor: '12500000',
  }),
  snapshot('step4:suggested', {
    cashMinor: '7160000', freeToAssignMinor: '0', envelopesTotalMinor: '7160000',
    envelopes: {
      mandatory: e('5200000', '3600000', '1600000'), current: e('4500000', '1240000', '3260000'),
      vacation: e('1500000', '0', '1500000'), reserve: e('800000', '0', '800000'),
    },
    mortgagePaid: true, vacationProgressPermille: 100, vacationRemainingMinor: '13500000',
  }),
  snapshot('step4:vacation', {
    cashMinor: '7160000', freeToAssignMinor: '0', envelopesTotalMinor: '7160000',
    envelopes: {
      mandatory: e('5200000', '3600000', '1600000'), current: e('3500000', '1240000', '2260000'),
      vacation: e('2500000', '0', '2500000'), reserve: e('800000', '0', '800000'),
    },
    mortgagePaid: true, vacationProgressPermille: 166, vacationRemainingMinor: '12500000',
  }),
  snapshot('step6:suggested+carry', {
    cashMinor: '7160000', freeToAssignMinor: '0', envelopesTotalMinor: '7160000',
    envelopes: {
      mandatory: e('5200000', '3600000', '1600000'), current: e('4500000', '1240000', '3260000'),
      vacation: e('1500000', '0', '1500000'), reserve: e('800000', '0', '800000'),
    },
    mortgagePaid: true, vacationProgressPermille: 100, vacationRemainingMinor: '13500000',
  }),
  snapshot('step6:suggested+save', {
    cashMinor: '7160000', freeToAssignMinor: '0', envelopesTotalMinor: '7160000',
    envelopes: {
      mandatory: e('5200000', '3600000', '1600000'), current: e('1240000', '1240000', '0'),
      vacation: e('4760000', '0', '4760000'), reserve: e('800000', '0', '800000'),
    },
    mortgagePaid: true, vacationProgressPermille: 317, vacationRemainingMinor: '10240000',
  }),
  snapshot('step6:vacation+carry', {
    cashMinor: '7160000', freeToAssignMinor: '0', envelopesTotalMinor: '7160000',
    envelopes: {
      mandatory: e('5200000', '3600000', '1600000'), current: e('3500000', '1240000', '2260000'),
      vacation: e('2500000', '0', '2500000'), reserve: e('800000', '0', '800000'),
    },
    mortgagePaid: true, vacationProgressPermille: 166, vacationRemainingMinor: '12500000',
  }),
  snapshot('step6:vacation+save', {
    cashMinor: '7160000', freeToAssignMinor: '0', envelopesTotalMinor: '7160000',
    envelopes: {
      mandatory: e('5200000', '3600000', '1600000'), current: e('1240000', '1240000', '0'),
      vacation: e('4760000', '0', '4760000'), reserve: e('800000', '0', '800000'),
    },
    mortgagePaid: true, vacationProgressPermille: 317, vacationRemainingMinor: '10240000',
  }),
]);

/** Snapshot key for a step, or null when a choice the step depends on is missing. */
export function snapshotKey(step: number, choices: DemoChoices): string | null {
  if (step <= 1) return `step${Math.max(0, step)}`;
  if (!choices.split) return null;
  if (step <= 4) return `step${step}:${choices.split}`;
  if (step === 5) return `step4:${choices.split}`; // the decision itself does not move money
  if (!choices.leftover) return null;
  return `step6:${choices.split}+${choices.leftover}`;
}

export function demoSnapshot(step: number, choices: DemoChoices): DemoSnapshot | null {
  const key = snapshotKey(step, choices);
  return key ? (DEMO_SNAPSHOTS[key] ?? null) : null;
}

const ENVELOPES: Record<DemoEnvelopeKey, { id: string; name: string; envelopeType: string; periodSlot: 'FIRST' | null }> = {
  mandatory: { id: 'demo-env-mandatory', name: 'Обязательные платежи', envelopeType: 'MANDATORY_EXPENSES', periodSlot: null },
  current: { id: 'demo-env-current', name: 'Текущие траты', envelopeType: 'CURRENT_EXPENSES', periodSlot: 'FIRST' },
  vacation: { id: 'demo-env-vacation', name: 'Отпуск', envelopeType: 'SAVINGS_GOAL', periodSlot: null },
  reserve: { id: 'demo-env-reserve', name: 'Резерв', envelopeType: 'RESERVE', periodSlot: null },
};
const ENVELOPE_ORDER: DemoEnvelopeKey[] = ['mandatory', 'current', 'vacation', 'reserve'];
const PERIOD_ID = 'demo-period-salary';

export function toDashboard(
  s: DemoSnapshot,
  dates: DemoPeriodDates,
  asOf: string,
): DashboardV2Response {
  const later = [
    { occurrenceId: 'demo-occ-kindergarten', name: 'Детский сад', scheduledOn: dates.laterPaymentsOn, unpaidMinor: '1110000' },
    { occurrenceId: 'demo-occ-utilities', name: 'Коммунальные услуги', scheduledOn: dates.laterPaymentsOn, unpaidMinor: '400000' },
    { occurrenceId: 'demo-occ-internet', name: 'Интернет', scheduledOn: dates.laterPaymentsOn, unpaidMinor: '90000' },
  ];
  const obligations = s.mortgagePaid
    ? later
    : [{ occurrenceId: 'demo-occ-mortgage', name: 'Ипотека', scheduledOn: dates.mortgageOn, unpaidMinor: '3600000' }, ...later];
  const funded = s.envelopesTotalMinor !== '0';
  return {
    planModelVersion: 2,
    period: { start: dates.periodStart, end: dates.periodEnd, periodId: PERIOD_ID },
    cycle: { start: dates.periodStart, end: dates.periodEnd },
    asOf,
    horizonEnd: dates.periodEnd,
    nearestObligations: obligations,
    periodStats: funded
      ? {
          spentMinor: s.envelopes.current.spentMinor,
          availableMinor: s.envelopes.current.balanceMinor,
          daysLeft: asOf === dates.shoppingTo ? dates.daysLeftAfterShopping : 0,
          averagePerDayMinor: '0',
        }
      : null,
    envelopes: ENVELOPE_ORDER.map((key) => ({ ...ENVELOPES[key], balanceMinor: s.envelopes[key].balanceMinor })),
    envelopesTotalMinor: s.envelopesTotalMinor,
    spendable: { state: 'READY', amountMinor: s.envelopes.current.balanceMinor },
    suggestedTarget: null,
    cashMinor: s.cashMinor,
    currentBalanceMinor: s.envelopes.current.balanceMinor,
    mandatoryBalanceMinor: s.envelopes.mandatory.balanceMinor,
    mandatoryDueMinor: s.envelopes.mandatory.balanceMinor,
    mandatoryDueCurrentMinor: '0',
    mandatoryDueNextMinor: s.envelopes.mandatory.balanceMinor,
    otherProtectedMinor: '0',
    freeToAssignMinor: s.freeToAssignMinor,
    unbackedMinor: '0',
    mandatoryGapMinor: '0',
    mandatoryGapCurrentMinor: '0',
    mandatoryGapNextMinor: '0',
    dueMayBeIncomplete: false,
    upcoming: obligations.map(({ occurrenceId, scheduledOn, unpaidMinor }) => ({ occurrenceId, scheduledOn, unpaidMinor })),
    accounts: [{ id: 'demo-acc-card', name: 'Карта', balanceMinor: s.cashMinor }],
    protectedAssignments: [],
    warnings: [],
    onboarding: {
      categoriesSeeded: true,
      hasAccounts: true,
      needsOpeningAssignment: false,
      needsPeriodSetup: false,
      hasMandatoryPlans: true,
      mandatoryPlansDeclined: false,
    },
  };
}

export function toEnvelopeRows(s: DemoSnapshot): EnvelopePlanDto[] {
  return ENVELOPE_ORDER.map((key) => ({
    id: ENVELOPES[key].id,
    name: ENVELOPES[key].name,
    envelopeType: ENVELOPES[key].envelopeType,
    periodSlot: ENVELOPES[key].periodSlot,
    // Decimal rubles by contract (see EnvelopePlanDto); only the vacation goal has a target.
    targetAmountMinor: key === 'vacation' ? '150000' : null,
    comment: null,
    fundedMinor: s.envelopes[key].fundedMinor,
    spentMinor: s.envelopes[key].spentMinor,
    balanceMinor: s.envelopes[key].balanceMinor,
    archivedAt: null,
  }));
}

export function toGoalRows(s: DemoSnapshot): GoalProgressRowDto[] {
  return [
    {
      envelopeId: ENVELOPES.vacation.id,
      name: 'Отпуск',
      envelopeType: 'SAVINGS_GOAL',
      currentMinor: s.envelopes.vacation.balanceMinor,
      targetMinor: '15000000',
      targetDate: null,
      remainingMinor: s.vacationRemainingMinor,
      progressPermille: s.vacationProgressPermille,
      isReached: false,
      daysRemaining: null,
    },
  ];
}

export const DEMO_CHOICES = {
  split: [
    { value: 'suggested' as const, label: 'Как предлагает HarmoFin', hint: '45 000 ₽ на текущие траты, 15 000 ₽ в отпуск' },
    { value: 'vacation' as const, label: 'Больше отложить на отпуск', hint: '35 000 ₽ на текущие траты, 25 000 ₽ в отпуск' },
  ],
  leftover: [
    { value: 'carry' as const, label: 'Перенести на следующий период', hint: 'Остаток останется на текущие траты в период аванса' },
    { value: 'save' as const, label: 'Отложить в накопления', hint: 'Остаток переложим в конверт «Отпуск»' },
  ],
};

export function demoStepText(step: number, choices: DemoChoices, d: DemoPeriodDates): DemoStepText {
  const period = `${formatDemoDate(d.periodStart)} – ${formatDemoDate(d.periodEnd)}`;
  const leftover = choices.split === 'vacation' ? '22 600 ₽' : '32 600 ₽';
  switch (step) {
    case 0:
      return {
        title: 'Настройте финансовый цикл',
        body: 'Месяц делится на два периода: после зарплаты и после аванса. Укажите, с какого числа начинается первый период и через сколько дней начинается второй.',
        caption: 'Разбивка месяца на период зарплаты и период аванса.',
      };
    case 1:
      return {
        title: 'Пришла зарплата',
        body: `${formatDemoDate(d.salaryOn)} на карту пришли 120 000 ₽. Пока они не распределены по конвертам. Начинается период зарплаты: ${period}.`,
        caption: 'На карте 120 000 ₽, не распределено 120 000 ₽.',
      };
    case 2:
      return {
        title: 'Распределите деньги по конвертам',
        body: 'Конверты показывают, на что отложены деньги. Обязательные платежи — 52 000 ₽: ипотека, детский сад, коммунальные услуги и интернет. Выберите, как распределить остальное.',
        caption: 'Конверты после распределения зарплаты.',
      };
    case 3:
      return {
        title: 'Оплачена ипотека',
        body: `${formatDemoDate(d.mortgageOn)} списали 36 000 ₽ за ипотеку — из конверта «Обязательные платежи». Деньги на текущие траты не тронуты.`,
        caption: '−36 000 ₽ ипотека: на карте 84 000 ₽, в обязательных платежах 16 000 ₽.',
      };
    case 4:
      return {
        title: 'Неделя покупок',
        body: `С ${formatDemoDate(d.shoppingFrom)} по ${formatDemoDate(d.shoppingTo)} потратили 12 400 ₽ на продукты и бытовые мелочи — из «Текущих трат». До конца периода дней: ${d.daysLeftAfterShopping}.`,
        caption: `−12 400 ₽ покупки: на текущие траты осталось ${leftover}.`,
      };
    case 5:
      return {
        title: 'Конец периода',
        body: `${formatDemoDate(d.periodEnd)} период зарплаты заканчивается. На текущие траты осталось ${leftover}. Что сделать с остатком?`,
        caption: `Остаток текущих трат — ${leftover}.`,
      };
    default:
      return {
        title: 'Итог месяца',
        body:
          choices.leftover === 'save'
            ? `Остаток ${leftover} переложен в «Отпуск». Обязательные платежи защищены, а цель стала ближе.`
            : `Остаток ${leftover} перенесён на период аванса. Обязательные платежи защищены, отпуск копится по плану.`,
        caption: 'Конверты и прогресс цели «Отпуск» в конце периода.',
      };
  }
}
```

Run: `pnpm --filter @harmofin/web exec vitest run app/data/demo-scenario.test.ts`
Expected: PASS. Если тест инвариантов падает — исправить литерал в снимке, а не тест.

- [ ] **Step 3: Проверки и коммит**

Run: `pnpm --filter @harmofin/web typecheck && pnpm --filter @harmofin/web lint && pnpm exec prettier --write apps/web/app/data/demo-scenario.ts apps/web/app/data/demo-scenario.test.ts`

```bash
git add apps/web/app/data/demo-scenario.ts apps/web/app/data/demo-scenario.test.ts
git commit -m "feat(web): сценарий «Месяц семьи» с предрасчитанными снимками"
```

---

### Task 3: Компоненты демо

**Files:**
- Create: `apps/web/app/components/demo/DemoCycleStep.vue`, `DemoCycleStep.test.ts`
- Create: `apps/web/app/components/demo/DemoStepCard.vue`, `DemoStepCard.test.ts`
- Create: `apps/web/app/components/demo/DemoStage.vue`, `DemoStage.test.ts`

**Interfaces:**
- Consumes: Task 1–2 API; `CyclePreview` (`../settings/CyclePreview.vue`, props `cycleStartDay`, `periodBoundaryOffset`); `UiInput` (`../ui/Input.vue`, props `modelValue`, `name`, `label`, `inputmode`, `error`); `LandingShowcase` (`../landing/ui/LandingShowcase.vue`, prop `caption`); `AvailableBudgetCard` (`dashboard`), `UpcomingObligations` (`items`), `EnvelopePlanRow` (`envelope`), `GoalProgressReport` (`rows`).
- Produces:
  - `DemoCycleStep` — props `start: string`, `offset: string`; emits `update:start`, `update:offset` (strings); экспортирует функцию `cycleErrors(start: string, offset: string): { start?: string; offset?: string }` из `<script lang="ts">` модуля `apps/web/app/components/demo/demo-cycle.ts`.
  - `DemoStepCard` — props `step: number`, `title: string`, `body: string`, `choices?: Array<{ value: string; label: string; hint: string }>`, `selected?: string | null`; emits `choose: [value: string]`. Заголовок `h2` с `tabindex="-1"`, метод `focusHeading()` через `defineExpose`.
  - `DemoStage` — props `step: number`, `snapshot: DemoSnapshot`, `dates: DemoPeriodDates`, `asOf: string`, `caption: string`, `cycle: { start: number; offset: number }`.

- [ ] **Step 1: Проверка цикла `apps/web/app/components/demo/demo-cycle.ts` и тест**

```ts
// Same rules and messages as budget settings (apps/web/app/pages/app/settings/general.vue).
export function cycleErrors(start: string, offset: string): { start?: string; offset?: string } {
  const errors: { start?: string; offset?: string } = {};
  const day = Number(start);
  const days = Number(offset);
  if (!/^\d+$/.test(start.trim()) || day < 1 || day > 28) errors.start = 'Укажите день от 1 до 28.';
  if (!/^\d+$/.test(offset.trim()) || days < 1 || days > 27) errors.offset = 'Укажите число дней от 1 до 27.';
  return errors;
}
```

Тест `apps/web/app/components/demo/DemoCycleStep.test.ts`:

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import { cycleErrors } from './demo-cycle.js';
import DemoCycleStep from './DemoCycleStep.vue';

describe('demo cycle step', () => {
  it.each([
    ['10', '15', {}],
    ['0', '15', { start: 'Укажите день от 1 до 28.' }],
    ['29', '15', { start: 'Укажите день от 1 до 28.' }],
    ['10', '28', { offset: 'Укажите число дней от 1 до 27.' }],
    ['abc', '', { start: 'Укажите день от 1 до 28.', offset: 'Укажите число дней от 1 до 27.' }],
  ])('validates start=%s offset=%s', (start, offset, expected) => {
    expect(cycleErrors(start, offset)).toEqual(expected);
  });

  it('renders both settings fields and passes valid values to CyclePreview', () => {
    const wrapper = mount(DemoCycleStep, { props: { start: '5', offset: '10' } });
    expect(wrapper.text()).toContain('Начало первого периода');
    expect(wrapper.text()).toContain('Граница второго периода (дней от начала первого)');
    const preview = wrapper.findComponent({ name: 'SettingsCyclePreview' });
    expect(preview.props()).toMatchObject({ cycleStartDay: 5, periodBoundaryOffset: 10 });
  });

  it('shows field errors and hides the preview for invalid input', () => {
    const wrapper = mount(DemoCycleStep, { props: { start: '40', offset: '10' } });
    expect(wrapper.text()).toContain('Укажите день от 1 до 28.');
    expect(wrapper.findComponent({ name: 'SettingsCyclePreview' }).exists()).toBe(false);
  });

  it('emits typed values', async () => {
    const wrapper = mount(DemoCycleStep, { props: { start: '10', offset: '15' } });
    await wrapper.get('[name="demo-cycle-start"]').setValue('12');
    expect(wrapper.emitted('update:start')?.at(-1)).toEqual(['12']);
  });
});
```

Run: `pnpm --filter @harmofin/web exec vitest run app/components/demo/DemoCycleStep.test.ts`
Expected: FAIL.

- [ ] **Step 2: `DemoCycleStep.vue`**

```vue
<script setup lang="ts">
import { computed } from 'vue';

import CyclePreview from '../settings/CyclePreview.vue';
import UiInput from '../ui/Input.vue';
import { cycleErrors } from './demo-cycle.js';

defineOptions({ name: 'DemoCycleStep' });

const props = defineProps<{ start: string; offset: string }>();
const emit = defineEmits<{ 'update:start': [value: string]; 'update:offset': [value: string] }>();

const errors = computed(() => cycleErrors(props.start, props.offset));
const valid = computed(() => !errors.value.start && !errors.value.offset);
</script>

<template>
  <div class="demo-cycle">
    <div class="demo-cycle__fields">
      <UiInput
        :model-value="start"
        name="demo-cycle-start"
        label="Начало первого периода"
        inputmode="numeric"
        :error="errors.start"
        @update:model-value="emit('update:start', String($event))"
      />
      <UiInput
        :model-value="offset"
        name="demo-cycle-offset"
        label="Граница второго периода (дней от начала первого)"
        inputmode="numeric"
        :error="errors.offset"
        @update:model-value="emit('update:offset', String($event))"
      />
    </div>
    <CyclePreview
      v-if="valid"
      :cycle-start-day="Number(start)"
      :period-boundary-offset="Number(offset)"
    />
  </div>
</template>

<style scoped>
.demo-cycle {
  display: grid;
  gap: var(--hf-space-5);
}

.demo-cycle__fields {
  display: grid;
  gap: var(--hf-space-4);
  max-width: 28rem;
}
</style>
```

Если `UiInput` эмитит другое событие или требует `v-model` — посмотреть `components/ui/Input.vue` и использовать его контракт, сохранив поведение теста. Run: команда Step 1. Expected: PASS.

- [ ] **Step 3: Тест `DemoStepCard.test.ts`**

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import DemoStepCard from './DemoStepCard.vue';

const choices = [
  { value: 'suggested', label: 'Как предлагает HarmoFin', hint: '45 000 ₽ на текущие траты' },
  { value: 'vacation', label: 'Больше отложить на отпуск', hint: '25 000 ₽ в отпуск' },
];

describe('demo step card', () => {
  it('renders the step heading and announces progress politely', () => {
    const wrapper = mount(DemoStepCard, { props: { step: 2, title: 'Распределите', body: 'Текст' } });
    expect(wrapper.get('h2').text()).toBe('Распределите');
    expect(wrapper.get('h2').attributes('tabindex')).toBe('-1');
    expect(wrapper.get('[aria-live="polite"]').text()).toBe('Шаг 3 из 7');
  });

  it('renders choices as a labelled radiogroup and marks the selected one in text', () => {
    const wrapper = mount(DemoStepCard, {
      props: { step: 2, title: 'Распределите', body: 'Текст', choices, selected: 'vacation' },
    });
    const group = wrapper.get('[role="radiogroup"]');
    expect(group.attributes('aria-label')).toBe('Выберите вариант');
    const radios = wrapper.findAll('[role="radio"]');
    expect(radios.map((r) => r.attributes('aria-checked'))).toEqual(['false', 'true']);
    expect(radios[1]!.text()).toContain('Выбрано');
  });

  it('emits the chosen value', async () => {
    const wrapper = mount(DemoStepCard, { props: { step: 5, title: 'Конец', body: 'Текст', choices } });
    await wrapper.findAll('[role="radio"]')[0]!.trigger('click');
    expect(wrapper.emitted('choose')?.[0]).toEqual(['suggested']);
  });
});
```

Run: `pnpm --filter @harmofin/web exec vitest run app/components/demo/DemoStepCard.test.ts`
Expected: FAIL.

- [ ] **Step 4: `DemoStepCard.vue`**

```vue
<script setup lang="ts">
import { ref } from 'vue';

import { DEMO_STEP_COUNT } from '../../data/demo-scenario.js';

defineOptions({ name: 'DemoStepCard' });

defineProps<{
  step: number;
  title: string;
  body: string;
  choices?: Array<{ value: string; label: string; hint: string }> | undefined;
  selected?: string | null | undefined;
}>();
const emit = defineEmits<{ choose: [value: string] }>();

const heading = ref<HTMLElement | null>(null);
defineExpose({ focusHeading: () => heading.value?.focus() });
</script>

<template>
  <section class="demo-step">
    <p class="demo-step__progress" aria-live="polite">Шаг {{ step + 1 }} из {{ DEMO_STEP_COUNT }}</p>
    <h2 ref="heading" class="demo-step__title" tabindex="-1">{{ title }}</h2>
    <p class="demo-step__body">{{ body }}</p>
    <div v-if="choices?.length" class="demo-step__choices" role="radiogroup" aria-label="Выберите вариант">
      <button
        v-for="choice in choices"
        :key="choice.value"
        type="button"
        role="radio"
        class="demo-step__choice"
        :class="{ 'demo-step__choice--selected': selected === choice.value }"
        :aria-checked="selected === choice.value ? 'true' : 'false'"
        @click="emit('choose', choice.value)"
      >
        <span class="demo-step__choice-label">{{ choice.label }}</span>
        <span class="demo-step__choice-hint">{{ choice.hint }}</span>
        <span v-if="selected === choice.value" class="demo-step__choice-mark">Выбрано</span>
      </button>
    </div>
  </section>
</template>

<style scoped>
.demo-step {
  display: grid;
  gap: var(--hf-space-3);
}

.demo-step__progress {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}

.demo-step__title {
  margin: 0;
}

.demo-step__body {
  margin: 0;
  color: var(--hf-color-text);
  line-height: 1.55;
}

.demo-step__choices {
  display: grid;
  gap: var(--hf-space-3);
  margin-top: var(--hf-space-2);
}

.demo-step__choice {
  display: grid;
  gap: var(--hf-space-1);
  min-height: 2.75rem;
  padding: var(--hf-space-3) var(--hf-space-4);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-md);
  background: var(--hf-color-surface);
  color: var(--hf-color-text);
  text-align: left;
  cursor: pointer;
}

.demo-step__choice--selected {
  border-color: var(--hf-color-action-primary);
  box-shadow: inset 0 0 0 1px var(--hf-color-action-primary);
}

.demo-step__choice-label {
  font-weight: var(--hf-font-weight-semibold);
}

.demo-step__choice-hint,
.demo-step__choice-mark {
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}
</style>
```

Если токен `--hf-color-action-primary` в `apps/web/app/assets/styles/tokens.css` называется иначе — использовать существующий токен основного действия. Run: команда Step 3. Expected: PASS.

- [ ] **Step 5: Тест `DemoStage.test.ts`**

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import { demoPeriodDates } from '../../data/demo-period-dates.js';
import { demoSnapshot } from '../../data/demo-scenario.js';
import DemoStage from './DemoStage.vue';

const dates = demoPeriodDates(10, 15);
const stubs = { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } };
const choices = { split: 'suggested' as const, leftover: 'save' as const };

function mountStage(step: number) {
  return mount(DemoStage, {
    props: {
      step,
      snapshot: demoSnapshot(step, choices)!,
      dates,
      asOf: dates.shoppingTo,
      caption: 'Подпись шага',
      cycle: { start: 10, offset: 15 },
    },
    global: { stubs },
  });
}

describe('demo stage', () => {
  it('wraps the app components in an inert showcase with the step caption', () => {
    const wrapper = mountStage(3);
    expect(wrapper.find('[inert]').exists()).toBe(true);
    expect(wrapper.text()).toContain('Подпись шага');
  });

  it('shows the cycle preview on step 0 and app components afterwards', () => {
    expect(mountStage(0).findComponent({ name: 'SettingsCyclePreview' }).exists()).toBe(true);
    const step2 = mountStage(2);
    expect(step2.findAllComponents({ name: 'EnvelopePlanRow' })).toHaveLength(4);
    expect(step2.findComponent({ name: 'AvailableBudgetCard' }).exists()).toBe(true);
  });

  it('shows upcoming payments on step 3 and the goal progress on step 6', () => {
    expect(mountStage(3).text()).toContain('Детский сад');
    expect(mountStage(6).findComponent({ name: 'GoalProgressReport' }).exists()).toBe(true);
  });

  it('never shows a per-day spending figure', () => {
    for (const step of [1, 2, 3, 4, 5, 6]) expect(mountStage(step).text()).not.toMatch(/в день/);
  });
});
```

Если `defineOptions({ name })` у этих компонентов отличается (`AvailableBudgetCard`, `EnvelopePlanRow`, `GoalProgressReport`), сверить имена в их файлах и использовать фактические. Run: `pnpm --filter @harmofin/web exec vitest run app/components/demo/DemoStage.test.ts`
Expected: FAIL.

- [ ] **Step 6: `DemoStage.vue`**

```vue
<script setup lang="ts">
import { computed } from 'vue';

import GoalProgressReport from '../analytics/GoalProgressReport.vue';
import AvailableBudgetCard from '../dashboard/AvailableBudgetCard.vue';
import UpcomingObligations from '../dashboard/UpcomingObligations.vue';
import EnvelopePlanRow from '../envelopes/EnvelopePlanRow.vue';
import LandingShowcase from '../landing/ui/LandingShowcase.vue';
import CyclePreview from '../settings/CyclePreview.vue';
import type { DemoPeriodDates } from '../../data/demo-period-dates.js';
import {
  toDashboard,
  toEnvelopeRows,
  toGoalRows,
  type DemoSnapshot,
} from '../../data/demo-scenario.js';

defineOptions({ name: 'DemoStage' });

const props = defineProps<{
  step: number;
  snapshot: DemoSnapshot;
  dates: DemoPeriodDates;
  asOf: string;
  caption: string;
  cycle: { start: number; offset: number };
}>();

const dashboard = computed(() => toDashboard(props.snapshot, props.dates, props.asOf));
const envelopes = computed(() => toEnvelopeRows(props.snapshot));
const goals = computed(() => toGoalRows(props.snapshot));
</script>

<template>
  <LandingShowcase :caption="caption">
    <div class="demo-stage">
      <CyclePreview
        v-if="step === 0"
        :cycle-start-day="cycle.start"
        :period-boundary-offset="cycle.offset"
      />
      <template v-else>
        <AvailableBudgetCard :dashboard="dashboard" />
        <div v-if="step >= 2" class="demo-stage__envelopes">
          <EnvelopePlanRow v-for="envelope in envelopes" :key="envelope.id" :envelope="envelope" />
        </div>
        <UpcomingObligations v-if="step === 1 || step === 3" :items="dashboard.nearestObligations" />
        <GoalProgressReport v-if="step === 6" :rows="goals" />
      </template>
    </div>
  </LandingShowcase>
</template>

<style scoped>
.demo-stage,
.demo-stage__envelopes {
  display: grid;
  gap: var(--hf-space-4);
}
</style>
```

Run: команда Step 5. Expected: PASS. Если `AvailableBudgetCard` на каком-то шаге показывает «в день» — значит она читает `averagePerDayMinor`; тогда передавать `periodStats: null` в `toDashboard` для всех шагов и обновить тест Task 2 (ожидание `daysLeft`) — дни до конца периода в этом случае показываются только текстом шага.

- [ ] **Step 7: Проверки и коммит**

Run: `pnpm --filter @harmofin/web exec vitest run app/components/demo && pnpm --filter @harmofin/web typecheck && pnpm --filter @harmofin/web lint && pnpm exec prettier --write apps/web/app/components/demo`

```bash
git add apps/web/app/components/demo
git commit -m "feat(web): компоненты шага, цикла и экрана демо-витрины"
```

---

### Task 4: Страница `/demo`

**Files:**
- Create: `apps/web/app/pages/demo.vue`
- Create: `apps/web/app/pages/demo-state.ts`, `demo-state.test.ts`
- Test: `apps/web/app/pages/demo.test.ts`

**Interfaces:**
- Consumes: Task 1–3.
- Produces:

```ts
// apps/web/app/pages/demo-state.ts
export type DemoState = { step: number; start: number; offset: number; split: DemoSplit | null; leftover: DemoLeftover | null };
export function parseDemoQuery(query: Record<string, unknown>): DemoState; // normalizes and rewinds to the missing choice
export function toDemoQuery(state: DemoState): Record<string, string>;
```

- [ ] **Step 1: Тест состояния `apps/web/app/pages/demo-state.test.ts`**

```ts
import { describe, expect, it } from 'vitest';

import { parseDemoQuery, toDemoQuery } from './demo-state.js';

describe('demo state', () => {
  it('uses defaults for an empty query', () => {
    expect(parseDemoQuery({})).toEqual({ step: 0, start: 10, offset: 15, split: null, leftover: null });
  });

  it('replaces invalid values with defaults', () => {
    expect(parseDemoQuery({ step: '99', start: '0', offset: 'x', split: 'all', leftover: 'burn' })).toEqual({
      step: 0, start: 10, offset: 15, split: null, leftover: null,
    });
  });

  it('rewinds to the step whose choice is missing', () => {
    expect(parseDemoQuery({ step: '4' }).step).toBe(2);
    expect(parseDemoQuery({ step: '6', split: 'vacation' }).step).toBe(5);
    expect(parseDemoQuery({ step: '6', split: 'vacation', leftover: 'save' }).step).toBe(6);
  });

  it('drops a leftover choice made without a split', () => {
    expect(parseDemoQuery({ step: '1', leftover: 'save' }).leftover).toBeNull();
  });

  it('round-trips through the query', () => {
    const state = { step: 6, start: 5, offset: 10, split: 'suggested' as const, leftover: 'carry' as const };
    expect(parseDemoQuery(toDemoQuery(state))).toEqual(state);
    expect(toDemoQuery({ step: 1, start: 10, offset: 15, split: null, leftover: null })).toEqual({
      step: '1', start: '10', offset: '15',
    });
  });
});
```

Run: `pnpm --filter @harmofin/web exec vitest run app/pages/demo-state.test.ts`
Expected: FAIL.

- [ ] **Step 2: `apps/web/app/pages/demo-state.ts`**

Файл лежит в `pages/`, но не является маршрутом: Nuxt создаёт маршруты только из `.vue`. Если в проекте настроено иначе (`pages:extend` или `ignore`), перенести в `apps/web/app/data/demo-state.ts` и поправить импорты.

```ts
import type { DemoLeftover, DemoSplit } from '../data/demo-scenario.js';

export type DemoState = {
  step: number;
  start: number;
  offset: number;
  split: DemoSplit | null;
  leftover: DemoLeftover | null;
};

function intIn(value: unknown, min: number, max: number, fallback: number): number {
  const text = typeof value === 'string' ? value : '';
  if (!/^\d+$/.test(text)) return fallback;
  const parsed = Number(text);
  return parsed >= min && parsed <= max ? parsed : fallback;
}

export function parseDemoQuery(query: Record<string, unknown>): DemoState {
  const split = query.split === 'suggested' || query.split === 'vacation' ? query.split : null;
  const leftoverRaw = query.leftover === 'carry' || query.leftover === 'save' ? query.leftover : null;
  const leftover = split ? leftoverRaw : null;
  let step = intIn(query.step, 0, 6, 0);
  if (step >= 3 && !split) step = 2;
  if (step === 6 && !leftover) step = 5;
  return { step, start: intIn(query.start, 1, 28, 10), offset: intIn(query.offset, 1, 27, 15), split, leftover };
}

export function toDemoQuery(state: DemoState): Record<string, string> {
  return {
    step: String(state.step),
    start: String(state.start),
    offset: String(state.offset),
    ...(state.split ? { split: state.split } : {}),
    ...(state.leftover ? { leftover: state.leftover } : {}),
  };
}
```

Run: команда Step 1. Expected: PASS.

- [ ] **Step 3: Тест страницы `apps/web/app/pages/demo.test.ts`**

```ts
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';

const mocks = vi.hoisted(() => ({
  route: { query: {} as Record<string, string> },
  replace: vi.fn(),
  apiRequest: vi.fn(),
}));

vi.mock('#app', () => ({
  useRoute: () => mocks.route,
  useRouter: () => ({ replace: mocks.replace }),
}));
vi.mock('#imports', () => ({ useHead: vi.fn() }));
vi.mock('../composables/useApiClient.js', () => ({ useApiClient: () => ({ request: mocks.apiRequest }) }));

import DemoPage from './demo.vue';

const stubs = { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } };

function mountPage(query: Record<string, string> = {}) {
  mocks.route = reactive({ query }) as never;
  mocks.replace.mockImplementation(({ query: next }: { query: Record<string, string> }) => {
    mocks.route.query = next;
    return Promise.resolve();
  });
  return mount(DemoPage, { global: { stubs } });
}

describe('demo page', () => {
  beforeEach(() => {
    mocks.replace.mockReset();
    mocks.apiRequest.mockReset();
  });

  it('starts with the cycle step and a demo notice, without any API call', async () => {
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.text()).toContain('Демо: выдуманная семья и суммы. Ничего не сохраняется.');
    expect(wrapper.get('h2').text()).toBe('Настройте финансовый цикл');
    expect(mocks.apiRequest).not.toHaveBeenCalled();
  });

  it('moves forward and writes the step to the URL', async () => {
    const wrapper = mountPage();
    await wrapper.get('[data-action="demo-next"]').trigger('click');
    expect(mocks.replace).toHaveBeenLastCalledWith({
      query: { step: '1', start: '10', offset: '15' },
    });
  });

  it('blocks «Далее» on a choice step until a choice is made, then records it', async () => {
    const wrapper = mountPage({ step: '2' });
    await flushPromises();
    expect(wrapper.get('[data-action="demo-next"]').attributes('disabled')).toBeDefined();
    await wrapper.findAll('[role="radio"]')[1]!.trigger('click');
    expect(mocks.replace).toHaveBeenLastCalledWith({
      query: { step: '2', start: '10', offset: '15', split: 'vacation' },
    });
  });

  it('blocks «Далее» on step 0 while the cycle is invalid', async () => {
    const wrapper = mountPage({ step: '0', start: '10', offset: '15' });
    await wrapper.get('[name="demo-cycle-start"]').setValue('40');
    expect(wrapper.get('[data-action="demo-next"]').attributes('disabled')).toBeDefined();
  });

  it('rewinds a URL without the needed choice and normalizes bad values', async () => {
    mountPage({ step: '5', start: '99' });
    await flushPromises();
    expect(mocks.replace).toHaveBeenCalledWith({ query: { step: '2', start: '10', offset: '15' } });
  });

  it('shows the visitor cycle dates in the scenario text', async () => {
    const wrapper = mountPage({ step: '3', start: '5', offset: '10', split: 'suggested' });
    await flushPromises();
    expect(wrapper.text()).toContain('9 октября');
  });

  it('offers registration as the main action on the final step and can restart', async () => {
    const wrapper = mountPage({ step: '6', split: 'suggested', leftover: 'save' });
    await flushPromises();
    const cta = wrapper.get('[data-action="demo-register"]');
    expect(cta.attributes('href')).toBe('/register');
    await wrapper.get('[data-action="demo-restart"]').trigger('click');
    expect(mocks.replace).toHaveBeenLastCalledWith({ query: { step: '0', start: '10', offset: '15' } });
  });
});
```

Run: `pnpm --filter @harmofin/web exec vitest run app/pages/demo.test.ts`
Expected: FAIL — страницы нет.

- [ ] **Step 4: `apps/web/app/pages/demo.vue`**

```vue
<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from '#app';
import { useHead } from '#imports';

import DemoCycleStep from '../components/demo/DemoCycleStep.vue';
import DemoStage from '../components/demo/DemoStage.vue';
import DemoStepCard from '../components/demo/DemoStepCard.vue';
import { cycleErrors } from '../components/demo/demo-cycle.js';
import UiButton from '../components/ui/Button.vue';
import { demoPeriodDates } from '../data/demo-period-dates.js';
import { DEMO_CHOICES, DEMO_STEP_COUNT, demoSnapshot, demoStepText } from '../data/demo-scenario.js';
import { parseDemoQuery, toDemoQuery, type DemoState } from './demo-state.js';

defineOptions({ name: 'DemoPage' });
useHead({ title: 'Демо — HarmoFin' });

const route = useRoute();
const router = useRouter();
const card = ref<InstanceType<typeof DemoStepCard> | null>(null);

const state = computed(() => parseDemoQuery(route.query as Record<string, unknown>));
// Draft cycle fields: the visitor may type an invalid value; the URL keeps the last valid cycle.
const startDraft = ref(String(state.value.start));
const offsetDraft = ref(String(state.value.offset));
const cycleValid = computed(() => Object.keys(cycleErrors(startDraft.value, offsetDraft.value)).length === 0);

const dates = computed(() => demoPeriodDates(state.value.start, state.value.offset));
const choices = computed(() => ({ split: state.value.split, leftover: state.value.leftover }));
const snapshot = computed(() => demoSnapshot(state.value.step, choices.value)!);
const text = computed(() => demoStepText(state.value.step, choices.value, dates.value));
const asOf = computed(() => {
  const d = dates.value;
  return [d.salaryOn, d.salaryOn, d.salaryOn, d.mortgageOn, d.shoppingTo, d.periodEnd, d.periodEnd][
    state.value.step
  ]!;
});
const stepChoices = computed(() =>
  state.value.step === 2 ? DEMO_CHOICES.split : state.value.step === 5 ? DEMO_CHOICES.leftover : undefined,
);
const selected = computed(() =>
  state.value.step === 2 ? state.value.split : state.value.step === 5 ? state.value.leftover : null,
);
const canGoNext = computed(() => {
  if (state.value.step === 0) return cycleValid.value;
  if (state.value.step === 2) return state.value.split !== null;
  if (state.value.step === 5) return state.value.leftover !== null;
  return state.value.step < DEMO_STEP_COUNT - 1;
});

function go(next: DemoState) {
  return router.replace({ query: toDemoQuery(next) });
}

function choose(value: string) {
  if (state.value.step === 2) void go({ ...state.value, split: value as DemoState['split'], leftover: null });
  if (state.value.step === 5) void go({ ...state.value, leftover: value as DemoState['leftover'] });
}

function next() {
  if (!canGoNext.value) return;
  const base =
    state.value.step === 0
      ? { ...state.value, start: Number(startDraft.value), offset: Number(offsetDraft.value) }
      : state.value;
  void go({ ...base, step: state.value.step + 1 });
}

function back() {
  if (state.value.step > 0) void go({ ...state.value, step: state.value.step - 1 });
}

function restart() {
  startDraft.value = '10';
  offsetDraft.value = '15';
  void go({ step: 0, start: 10, offset: 15, split: null, leftover: null });
}

// Rewrite a URL that was normalized or rewound, so the address bar matches what is shown.
onMounted(() => {
  const normalized = toDemoQuery(state.value);
  const current = route.query as Record<string, unknown>;
  const same =
    Object.keys(normalized).length === Object.keys(current).length &&
    Object.entries(normalized).every(([key, value]) => current[key] === value);
  if (!same && Object.keys(current).length > 0) void go(state.value);
});

watch(
  () => state.value.step,
  async () => {
    await nextTick();
    card.value?.focusHeading();
  },
);
</script>

<template>
  <div class="demo-page">
    <header class="demo-page__header">
      <NuxtLink to="/" class="demo-page__logo">HarmoFin</NuxtLink>
      <UiButton to="/register" variant="secondary" size="sm">Создать аккаунт</UiButton>
    </header>
    <p class="demo-page__notice">Демо: выдуманная семья и суммы. Ничего не сохраняется.</p>
    <main class="demo-page__layout">
      <div class="demo-page__story">
        <DemoStepCard
          ref="card"
          :step="state.step"
          :title="text.title"
          :body="text.body"
          :choices="stepChoices"
          :selected="selected"
          @choose="choose"
        />
        <DemoCycleStep
          v-if="state.step === 0"
          :start="startDraft"
          :offset="offsetDraft"
          @update:start="startDraft = $event"
          @update:offset="offsetDraft = $event"
        />
        <nav class="demo-page__nav" aria-label="Шаги демо">
          <UiButton variant="tertiary" :disabled="state.step === 0" data-action="demo-back" @click="back">
            Назад
          </UiButton>
          <UiButton
            v-if="state.step < DEMO_STEP_COUNT - 1"
            :disabled="!canGoNext"
            data-action="demo-next"
            @click="next"
          >
            Далее
          </UiButton>
          <UiButton v-else to="/register" variant="brand" data-action="demo-register">
            Создать аккаунт
          </UiButton>
        </nav>
        <button type="button" class="demo-page__restart" data-action="demo-restart" @click="restart">
          Начать сначала
        </button>
      </div>
      <div class="demo-page__screen">
        <DemoStage
          :step="state.step"
          :snapshot="snapshot"
          :dates="dates"
          :as-of="asOf"
          :caption="text.caption"
          :cycle="{ start: Number(startDraft) || state.start, offset: Number(offsetDraft) || state.offset }"
        />
      </div>
    </main>
  </div>
</template>

<style scoped>
.demo-page {
  min-height: 100vh;
  background: var(--hf-color-background);
  color: var(--hf-color-text);
}

.demo-page__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  max-width: var(--hf-container-max-wide);
  margin: 0 auto;
  padding: var(--hf-space-4);
}

.demo-page__logo {
  color: var(--hf-color-text);
  font-weight: var(--hf-font-weight-semibold);
  text-decoration: none;
}

.demo-page__notice {
  max-width: var(--hf-container-max-wide);
  margin: 0 auto var(--hf-space-4);
  padding: var(--hf-space-3) var(--hf-space-4);
  border-radius: var(--hf-radius-md);
  background: var(--hf-color-surface-subtle);
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}

.demo-page__layout {
  display: grid;
  gap: var(--hf-space-6);
  max-width: var(--hf-container-max-wide);
  margin: 0 auto;
  padding: 0 var(--hf-space-4) var(--hf-space-12);
}

.demo-page__story {
  display: grid;
  gap: var(--hf-space-5);
  align-content: start;
}

.demo-page__nav {
  display: flex;
  gap: var(--hf-space-3);
  position: sticky;
  bottom: 0;
  padding: var(--hf-space-3) 0;
  background: var(--hf-color-background);
}

.demo-page__restart {
  justify-self: start;
  padding: 0;
  border: 0;
  background: none;
  color: var(--hf-color-text-muted);
  text-decoration: underline;
  cursor: pointer;
}

@media (min-width: 64rem) {
  .demo-page__layout {
    grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
    align-items: start;
  }

  .demo-page__nav {
    position: static;
  }
}
</style>
```

`DemoStepCard` в шаблоне используется до объявления `DEMO_STEP_COUNT` — константа импортирована в `<script setup>`, поэтому доступна в шаблоне. Если `UiButton` не поддерживает `disabled`/`to` вместе — сверить props в `components/ui/Button.vue` (`disabled` поддерживается, `to` превращает кнопку в ссылку). Если токены `--hf-color-background`, `--hf-color-surface-subtle`, `--hf-container-max-wide` называются иначе — взять фактические из `tokens.css`.

Run: `pnpm --filter @harmofin/web exec vitest run app/pages/demo.test.ts app/pages/demo-state.test.ts`
Expected: PASS.

- [ ] **Step 5: Проверки и коммит**

Run: `pnpm --filter @harmofin/web exec vitest run app/pages app/components/demo app/data && pnpm --filter @harmofin/web typecheck && pnpm --filter @harmofin/web lint && pnpm exec prettier --write apps/web/app/pages/demo.vue apps/web/app/pages/demo-state.ts apps/web/app/pages/demo-state.test.ts apps/web/app/pages/demo.test.ts`

```bash
git add apps/web/app/pages/demo.vue apps/web/app/pages/demo-state.ts apps/web/app/pages/demo-state.test.ts apps/web/app/pages/demo.test.ts
git commit -m "feat(web): страница демо-витрины /demo"
```

---

### Task 5: Ссылки с лендинга и E2E

**Files:**
- Modify: `apps/web/app/components/landing/sections/HeroSection.vue:27`
- Modify: `apps/web/app/data/landing.ts:183-188` (`footerProductLinks`)
- Test: `apps/web/app/components/landing/sections/HeroSection.test.ts`, `apps/web/app/components/landing/LandingFooter.test.ts`
- Create: `e2e/demo.spec.ts`

- [ ] **Step 1: Тесты лендинга (падающие)**

В `HeroSection.test.ts` заменить ожидание `expect(hrefs).toContain('#how-it-works');` на:

```ts
    expect(hrefs).toContain('/demo');
    expect(wrapper.text()).toContain('Попробовать демо');
```

В `LandingFooter.test.ts` добавить тест:

```ts
  it('links the demo from the product column', () => {
    const wrapper = mount(LandingFooter, { global: { stubs } });
    expect(wrapper.find('a[href="/demo"]').text()).toBe('Демо');
  });
```

Run: `pnpm --filter @harmofin/web exec vitest run app/components/landing`
Expected: FAIL.

- [ ] **Step 2: Ссылки**

`HeroSection.vue`, строка с `hero__secondary`:

```vue
          <NuxtLink class="hero__secondary" to="/demo">Попробовать демо →</NuxtLink>
```

`landing.ts`, `footerProductLinks` — добавить первым элементом:

```ts
  { href: '/demo', label: 'Демо' },
```

Если подвал рендерит `footerProductLinks` через `<a :href>`, ссылка на `/demo` работает и так; менять разметку подвала не нужно.

Run: `pnpm --filter @harmofin/web exec vitest run app/components/landing`
Expected: PASS.

- [ ] **Step 3: E2E `e2e/demo.spec.ts`**

```ts
import { expect, test, type Page } from '@playwright/test';

async function waitForHydration(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
}

test('walks the demo with a custom cycle through both choices to the final step', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await page.getByRole('link', { name: 'Попробовать демо →' }).click();
  await expect(page).toHaveURL(/\/demo/);
  await waitForHydration(page);

  await expect(page.getByRole('heading', { level: 2 })).toHaveText('Настройте финансовый цикл');
  await page.getByLabel('Начало первого периода').fill('5');
  await page.getByLabel('Граница второго периода (дней от начала первого)').fill('10');
  await page.getByRole('button', { name: 'Далее' }).click();

  await expect(page.getByRole('heading', { level: 2 })).toHaveText('Пришла зарплата');
  await expect(page.getByText('5 октября на карту пришли 120 000 ₽')).toBeVisible();
  await page.getByRole('button', { name: 'Далее' }).click();

  await expect(page.getByRole('button', { name: 'Далее' })).toBeDisabled();
  await page.getByRole('radio', { name: /Больше отложить на отпуск/ }).click();
  await page.getByRole('button', { name: 'Далее' }).click();

  await expect(page.getByText('9 октября списали 36 000 ₽ за ипотеку')).toBeVisible();
  await page.getByRole('button', { name: 'Далее' }).click();
  await expect(page.getByText(/потратили 12 400 ₽/)).toBeVisible();
  await page.getByRole('button', { name: 'Далее' }).click();

  await page.getByRole('radio', { name: /Отложить в накопления/ }).click();
  await page.getByRole('button', { name: 'Далее' }).click();

  await expect(page.getByRole('heading', { level: 2 })).toHaveText('Итог месяца');
  await expect(page).toHaveURL(/step=6.*start=5.*offset=10.*split=vacation.*leftover=save/);
  await expect(page.getByRole('link', { name: 'Создать аккаунт' }).last()).toHaveAttribute('href', '/register');

  await page.reload();
  await expect(page.getByRole('heading', { level: 2 })).toHaveText('Итог месяца');
});
```

Локально Playwright не запускать; проверка — `pnpm lint`.

- [ ] **Step 4: Финальные проверки и коммит**

Run: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test`

```bash
git add apps/web/app/components/landing/sections/HeroSection.vue apps/web/app/components/landing/sections/HeroSection.test.ts apps/web/app/data/landing.ts apps/web/app/components/landing/LandingFooter.test.ts e2e/demo.spec.ts
git commit -m "feat(web): ссылки на демо с лендинга и e2e-сценарий витрины"
```

---

## Ревью

После каждой задачи — QA; после Task 3–5 — UI/UX (раскладка, доступность, глоссарий, Calm Fintech); в конце — final.
