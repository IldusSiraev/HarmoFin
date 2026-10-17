// Demo budget for the landing showcases. Every amount is a precomputed
// minor-units string, consistent with section 8 of Envelope Plan Model v2.2:
// the landing never computes money. Dates are fixed so SSR and hydration match.
import type {
  GoalProgressRowDto,
  PlanVsActualRowDto,
} from '../composables/useBudgetReferenceData.js';
import type { DashboardV2Response, EnvelopePlanDto } from '../composables/useEnvelopePlanV2.js';

const PERIOD_PREVIOUS = 'demo-period-2026-09-10';
const PERIOD_CURRENT = 'demo-period-2026-09-25';

export const demoDashboard: DashboardV2Response = {
  planModelVersion: 2,
  period: { start: '2026-09-25', end: '2026-10-09', periodId: PERIOD_CURRENT },
  cycle: { start: '2026-09-10', end: '2026-10-09' },
  asOf: '2026-10-03',
  horizonEnd: '2026-10-09',
  nearestObligations: [
    {
      occurrenceId: 'demo-occ-mortgage',
      name: 'Ипотека',
      scheduledOn: '2026-10-05',
      unpaidMinor: '3600000',
    },
    {
      occurrenceId: 'demo-occ-internet',
      name: 'Интернет',
      scheduledOn: '2026-10-07',
      unpaidMinor: '90000',
    },
    {
      occurrenceId: 'demo-occ-kindergarten',
      name: 'Детский сад',
      scheduledOn: '2026-10-08',
      unpaidMinor: '1110000',
    },
  ],
  periodStats: {
    spentMinor: '3350000',
    availableMinor: '6500000',
    daysLeft: 7,
    averagePerDayMinor: '450000',
  },
  envelopes: [
    {
      id: 'demo-env-current-second',
      name: 'Текущие траты',
      envelopeType: 'CURRENT_EXPENSES',
      periodSlot: 'SECOND',
      balanceMinor: '3150000',
    },
    {
      id: 'demo-env-mandatory',
      name: 'Обязательные платежи',
      envelopeType: 'MANDATORY_EXPENSES',
      periodSlot: null,
      balanceMinor: '5200000',
    },
    {
      id: 'demo-env-repair',
      name: 'Ремонт',
      envelopeType: 'SAVINGS_GOAL',
      periodSlot: null,
      balanceMinor: '7000000',
    },
    {
      id: 'demo-env-vacation',
      name: 'Отпуск',
      envelopeType: 'SAVINGS_GOAL',
      periodSlot: null,
      balanceMinor: '4200000',
    },
    {
      id: 'demo-env-reserve',
      name: 'Резерв',
      envelopeType: 'RESERVE',
      periodSlot: null,
      balanceMinor: '1500000',
    },
  ],
  envelopesTotalMinor: '21050000',
  spendable: { state: 'READY', amountMinor: '3150000' },
  suggestedTarget: null,
  cashMinor: '23230000',
  currentBalanceMinor: '3150000',
  mandatoryBalanceMinor: '5200000',
  mandatoryDueMinor: '4800000',
  mandatoryDueCurrentMinor: '4800000',
  mandatoryDueNextMinor: '0',
  otherProtectedMinor: '13130000',
  freeToAssignMinor: '1750000',
  unbackedMinor: '0',
  mandatoryGapMinor: '0',
  mandatoryGapCurrentMinor: '0',
  mandatoryGapNextMinor: '0',
  dueMayBeIncomplete: false,
  upcoming: [
    { occurrenceId: 'demo-occ-mortgage', scheduledOn: '2026-10-05', unpaidMinor: '3600000' },
    { occurrenceId: 'demo-occ-internet', scheduledOn: '2026-10-07', unpaidMinor: '90000' },
    { occurrenceId: 'demo-occ-kindergarten', scheduledOn: '2026-10-08', unpaidMinor: '1110000' },
  ],
  accounts: [
    { id: 'demo-acc-card', name: 'Карта', balanceMinor: '14200000' },
    { id: 'demo-acc-savings', name: 'Накопительный счёт', balanceMinor: '8200000' },
    { id: 'demo-acc-cash', name: 'Наличные', balanceMinor: '830000' },
  ],
  protectedAssignments: [
    {
      envelopeId: 'demo-env-current-first',
      envelopeName: 'Текущие траты',
      envelopeType: 'CURRENT_EXPENSES',
      periodId: PERIOD_PREVIOUS,
      balanceMinor: '430000',
    },
    {
      envelopeId: 'demo-env-mandatory',
      envelopeName: 'Обязательные платежи',
      envelopeType: 'MANDATORY_EXPENSES',
      periodId: null,
      balanceMinor: '5200000',
    },
    {
      envelopeId: 'demo-env-repair',
      envelopeName: 'Ремонт',
      envelopeType: 'SAVINGS_GOAL',
      periodId: null,
      balanceMinor: '7000000',
    },
    {
      envelopeId: 'demo-env-vacation',
      envelopeName: 'Отпуск',
      envelopeType: 'SAVINGS_GOAL',
      periodId: null,
      balanceMinor: '4200000',
    },
    {
      envelopeId: 'demo-env-reserve',
      envelopeName: 'Резерв',
      envelopeType: 'RESERVE',
      periodId: null,
      balanceMinor: '1500000',
    },
  ],
  warnings: [
    {
      kind: 'PERIOD',
      code: 'PERIOD_LEFTOVER',
      message: 'Остаток прошлого периода ждёт решения.',
      amountMinor: '430000',
      envelopeId: 'demo-env-current-first',
      periodId: PERIOD_PREVIOUS,
      balanceMinor: '430000',
      actionPath: '/app',
    },
  ],
  onboarding: {
    categoriesSeeded: true,
    hasAccounts: true,
    needsOpeningAssignment: false,
    needsPeriodSetup: false,
    hasMandatoryPlans: true,
    mandatoryPlansDeclined: false,
  },
};

// `targetAmountMinor` is DECIMAL rubles by contract (see EnvelopePlanDto).
export const demoEnvelopes: EnvelopePlanDto[] = [
  {
    id: 'demo-env-current-second',
    name: 'Текущие траты',
    envelopeType: 'CURRENT_EXPENSES',
    periodSlot: 'SECOND',
    targetAmountMinor: '65000',
    comment: null,
    fundedMinor: '6500000',
    spentMinor: '3350000',
    balanceMinor: '3150000',
    archivedAt: null,
  },
  {
    id: 'demo-env-mandatory',
    name: 'Обязательные платежи',
    envelopeType: 'MANDATORY_EXPENSES',
    periodSlot: null,
    targetAmountMinor: null,
    comment: null,
    fundedMinor: '5200000',
    spentMinor: '0',
    balanceMinor: '5200000',
    archivedAt: null,
  },
  {
    id: 'demo-env-repair',
    name: 'Ремонт',
    envelopeType: 'SAVINGS_GOAL',
    periodSlot: null,
    targetAmountMinor: '120000',
    comment: null,
    fundedMinor: '7000000',
    spentMinor: '0',
    balanceMinor: '7000000',
    archivedAt: null,
  },
  {
    id: 'demo-env-reserve',
    name: 'Резерв',
    envelopeType: 'RESERVE',
    periodSlot: null,
    targetAmountMinor: null,
    comment: null,
    fundedMinor: '1500000',
    spentMinor: '0',
    balanceMinor: '1500000',
    archivedAt: null,
  },
];

export const demoGoalRows: GoalProgressRowDto[] = [
  {
    envelopeId: 'demo-env-repair',
    name: 'Ремонт',
    envelopeType: 'SAVINGS_GOAL',
    currentMinor: '7000000',
    targetMinor: '12000000',
    targetDate: '2027-03-01',
    remainingMinor: '5000000',
    progressPermille: 583,
    isReached: false,
    daysRemaining: 149,
  },
  {
    envelopeId: 'demo-env-vacation',
    name: 'Отпуск',
    envelopeType: 'SAVINGS_GOAL',
    currentMinor: '4200000',
    targetMinor: '10000000',
    targetDate: null,
    remainingMinor: '5800000',
    progressPermille: 420,
    isReached: false,
    daysRemaining: null,
  },
];

// varianceMinor = actual − planned, as the API computes it.
export const demoPlanRows: PlanVsActualRowDto[] = [
  {
    planId: 'demo-plan-salary',
    planName: 'Зарплата',
    planType: 'INCOME',
    plannedMinor: '10600000',
    actualMinor: '10600000',
    varianceMinor: '0',
    plannedOccurrenceCount: 1,
    confirmedOccurrenceCount: 1,
  },
  {
    planId: 'demo-plan-mortgage',
    planName: 'Ипотека',
    planType: 'EXPENSE',
    plannedMinor: '3600000',
    actualMinor: '3600000',
    varianceMinor: '0',
    plannedOccurrenceCount: 1,
    confirmedOccurrenceCount: 1,
  },
  {
    planId: 'demo-plan-utilities',
    planName: 'Коммунальные платежи',
    planType: 'EXPENSE',
    plannedMinor: '850000',
    actualMinor: '912000',
    varianceMinor: '62000',
    plannedOccurrenceCount: 1,
    confirmedOccurrenceCount: 1,
  },
];

// Static funding preview for the income section (FundingReviewSheet wording).
export const demoIncome = {
  name: 'Зарплата',
  amountMinor: '10600000',
  lines: [
    { name: 'Текущие траты · вторая половина', amountMinor: '6500000' },
    { name: 'Обязательные платежи', amountMinor: '3000000' },
    { name: 'Ремонт', amountMinor: '1100000' },
  ],
  remainingMinor: '0',
};
