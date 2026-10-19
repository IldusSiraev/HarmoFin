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

function snapshot(key: string, values: Omit<DemoSnapshot, 'key'>): [string, DemoSnapshot] {
  return [key, { key, ...values }];
}

export const DEMO_SNAPSHOTS: Record<string, DemoSnapshot> = Object.fromEntries([
  snapshot('step0', {
    cashMinor: '0',
    freeToAssignMinor: '0',
    envelopesTotalMinor: '0',
    envelopes: { mandatory: EMPTY, current: EMPTY, vacation: EMPTY, reserve: EMPTY },
    mortgagePaid: false,
    vacationProgressPermille: 0,
    vacationRemainingMinor: '15000000',
  }),
  snapshot('step1', {
    cashMinor: '12000000',
    freeToAssignMinor: '12000000',
    envelopesTotalMinor: '0',
    envelopes: { mandatory: EMPTY, current: EMPTY, vacation: EMPTY, reserve: EMPTY },
    mortgagePaid: false,
    vacationProgressPermille: 0,
    vacationRemainingMinor: '15000000',
  }),
  snapshot('step2:suggested', {
    cashMinor: '12000000',
    freeToAssignMinor: '0',
    envelopesTotalMinor: '12000000',
    envelopes: {
      mandatory: e('5200000', '0', '5200000'),
      current: e('4500000', '0', '4500000'),
      vacation: e('1500000', '0', '1500000'),
      reserve: e('800000', '0', '800000'),
    },
    mortgagePaid: false,
    vacationProgressPermille: 100,
    vacationRemainingMinor: '13500000',
  }),
  snapshot('step2:vacation', {
    cashMinor: '12000000',
    freeToAssignMinor: '0',
    envelopesTotalMinor: '12000000',
    envelopes: {
      mandatory: e('5200000', '0', '5200000'),
      current: e('3500000', '0', '3500000'),
      vacation: e('2500000', '0', '2500000'),
      reserve: e('800000', '0', '800000'),
    },
    mortgagePaid: false,
    vacationProgressPermille: 166,
    vacationRemainingMinor: '12500000',
  }),
  snapshot('step3:suggested', {
    cashMinor: '8400000',
    freeToAssignMinor: '0',
    envelopesTotalMinor: '8400000',
    envelopes: {
      mandatory: e('5200000', '3600000', '1600000'),
      current: e('4500000', '0', '4500000'),
      vacation: e('1500000', '0', '1500000'),
      reserve: e('800000', '0', '800000'),
    },
    mortgagePaid: true,
    vacationProgressPermille: 100,
    vacationRemainingMinor: '13500000',
  }),
  snapshot('step3:vacation', {
    cashMinor: '8400000',
    freeToAssignMinor: '0',
    envelopesTotalMinor: '8400000',
    envelopes: {
      mandatory: e('5200000', '3600000', '1600000'),
      current: e('3500000', '0', '3500000'),
      vacation: e('2500000', '0', '2500000'),
      reserve: e('800000', '0', '800000'),
    },
    mortgagePaid: true,
    vacationProgressPermille: 166,
    vacationRemainingMinor: '12500000',
  }),
  snapshot('step4:suggested', {
    cashMinor: '7160000',
    freeToAssignMinor: '0',
    envelopesTotalMinor: '7160000',
    envelopes: {
      mandatory: e('5200000', '3600000', '1600000'),
      current: e('4500000', '1240000', '3260000'),
      vacation: e('1500000', '0', '1500000'),
      reserve: e('800000', '0', '800000'),
    },
    mortgagePaid: true,
    vacationProgressPermille: 100,
    vacationRemainingMinor: '13500000',
  }),
  snapshot('step4:vacation', {
    cashMinor: '7160000',
    freeToAssignMinor: '0',
    envelopesTotalMinor: '7160000',
    envelopes: {
      mandatory: e('5200000', '3600000', '1600000'),
      current: e('3500000', '1240000', '2260000'),
      vacation: e('2500000', '0', '2500000'),
      reserve: e('800000', '0', '800000'),
    },
    mortgagePaid: true,
    vacationProgressPermille: 166,
    vacationRemainingMinor: '12500000',
  }),
  snapshot('step6:suggested+carry', {
    cashMinor: '7160000',
    freeToAssignMinor: '0',
    envelopesTotalMinor: '7160000',
    envelopes: {
      mandatory: e('5200000', '3600000', '1600000'),
      current: e('4500000', '1240000', '3260000'),
      vacation: e('1500000', '0', '1500000'),
      reserve: e('800000', '0', '800000'),
    },
    mortgagePaid: true,
    vacationProgressPermille: 100,
    vacationRemainingMinor: '13500000',
  }),
  snapshot('step6:suggested+save', {
    cashMinor: '7160000',
    freeToAssignMinor: '0',
    envelopesTotalMinor: '7160000',
    envelopes: {
      mandatory: e('5200000', '3600000', '1600000'),
      current: e('1240000', '1240000', '0'),
      vacation: e('4760000', '0', '4760000'),
      reserve: e('800000', '0', '800000'),
    },
    mortgagePaid: true,
    vacationProgressPermille: 317,
    vacationRemainingMinor: '10240000',
  }),
  snapshot('step6:vacation+carry', {
    cashMinor: '7160000',
    freeToAssignMinor: '0',
    envelopesTotalMinor: '7160000',
    envelopes: {
      mandatory: e('5200000', '3600000', '1600000'),
      current: e('3500000', '1240000', '2260000'),
      vacation: e('2500000', '0', '2500000'),
      reserve: e('800000', '0', '800000'),
    },
    mortgagePaid: true,
    vacationProgressPermille: 166,
    vacationRemainingMinor: '12500000',
  }),
  snapshot('step6:vacation+save', {
    cashMinor: '7160000',
    freeToAssignMinor: '0',
    envelopesTotalMinor: '7160000',
    envelopes: {
      mandatory: e('5200000', '3600000', '1600000'),
      current: e('1240000', '1240000', '0'),
      vacation: e('4760000', '0', '4760000'),
      reserve: e('800000', '0', '800000'),
    },
    mortgagePaid: true,
    vacationProgressPermille: 317,
    vacationRemainingMinor: '10240000',
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

const ENVELOPES: Record<
  DemoEnvelopeKey,
  { id: string; name: string; envelopeType: string; periodSlot: 'FIRST' | null }
> = {
  mandatory: {
    id: 'demo-env-mandatory',
    name: 'Обязательные платежи',
    envelopeType: 'MANDATORY_EXPENSES',
    periodSlot: null,
  },
  current: {
    id: 'demo-env-current',
    name: 'Текущие траты',
    envelopeType: 'CURRENT_EXPENSES',
    periodSlot: 'FIRST',
  },
  vacation: {
    id: 'demo-env-vacation',
    name: 'Отпуск',
    envelopeType: 'SAVINGS_GOAL',
    periodSlot: null,
  },
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
    {
      occurrenceId: 'demo-occ-kindergarten',
      name: 'Детский сад',
      scheduledOn: dates.laterPaymentsOn,
      unpaidMinor: '1110000',
    },
    {
      occurrenceId: 'demo-occ-utilities',
      name: 'Коммунальные услуги',
      scheduledOn: dates.laterPaymentsOn,
      unpaidMinor: '400000',
    },
    {
      occurrenceId: 'demo-occ-internet',
      name: 'Интернет',
      scheduledOn: dates.laterPaymentsOn,
      unpaidMinor: '90000',
    },
  ];
  const obligations = s.mortgagePaid
    ? later
    : [
        {
          occurrenceId: 'demo-occ-mortgage',
          name: 'Ипотека',
          scheduledOn: dates.mortgageOn,
          unpaidMinor: '3600000',
        },
        ...later,
      ];
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
    envelopes: ENVELOPE_ORDER.map((key) => ({
      ...ENVELOPES[key],
      balanceMinor: s.envelopes[key].balanceMinor,
    })),
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
    upcoming: obligations.map(({ occurrenceId, scheduledOn, unpaidMinor }) => ({
      occurrenceId,
      scheduledOn,
      unpaidMinor,
    })),
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
    {
      value: 'suggested' as const,
      label: 'Как предлагает HarmoFin',
      hint: '45 000 ₽ на текущие траты, 15 000 ₽ в отпуск',
    },
    {
      value: 'vacation' as const,
      label: 'Больше отложить на отпуск',
      hint: '35 000 ₽ на текущие траты, 25 000 ₽ в отпуск',
    },
  ],
  leftover: [
    {
      value: 'carry' as const,
      label: 'Перенести на следующий период',
      hint: 'Остаток останется на текущие траты в период аванса',
    },
    {
      value: 'save' as const,
      label: 'Отложить в накопления',
      hint: 'Остаток переложим в конверт «Отпуск»',
    },
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
