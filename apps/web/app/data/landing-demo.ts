// Demo budget for the landing showcases. Every amount is a precomputed
// minor-units string, consistent with section 8 of Envelope Plan Model v2.2:
// the landing never computes money. Dates are fixed so SSR and hydration match.
import type { GoalProgressRowDto } from '../composables/useBudgetReferenceData.js';
import type {
  DashboardV2Response,
  EnvelopeLimitV2Row,
  EnvelopePlanDto,
  ExpenseByCategoryV2Row,
  NetCashFlowV2Row,
} from '../composables/useEnvelopePlanV2.js';

const PERIOD_EARLIER = 'demo-period-2026-08-25';
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
      coverage: 'COVERED',
      shortfallMinor: '0',
    },
    {
      occurrenceId: 'demo-occ-internet',
      name: 'Интернет',
      scheduledOn: '2026-10-07',
      unpaidMinor: '90000',
      coverage: 'COVERED',
      shortfallMinor: '0',
    },
    {
      occurrenceId: 'demo-occ-kindergarten',
      name: 'Детский сад',
      scheduledOn: '2026-10-08',
      unpaidMinor: '1110000',
      coverage: 'COVERED',
      shortfallMinor: '0',
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
      progress: {
        kind: 'SPENT',
        valueMinor: '3350000',
        maxMinor: '6500000',
        shortfallMinor: null,
      },
    },
    {
      id: 'demo-env-mandatory',
      name: 'Обязательные платежи',
      envelopeType: 'MANDATORY_EXPENSES',
      periodSlot: null,
      balanceMinor: '5200000',
      progress: {
        kind: 'COVERED',
        valueMinor: '5200000',
        maxMinor: '4800000',
        shortfallMinor: '0',
      },
    },
    {
      id: 'demo-env-repair',
      name: 'Ремонт',
      envelopeType: 'SAVINGS_GOAL',
      periodSlot: null,
      balanceMinor: '7000000',
      progress: {
        kind: 'GOAL',
        valueMinor: '7000000',
        maxMinor: '12000000',
        shortfallMinor: null,
      },
    },
    {
      id: 'demo-env-vacation',
      name: 'Отпуск',
      envelopeType: 'SAVINGS_GOAL',
      periodSlot: null,
      balanceMinor: '4200000',
      progress: {
        kind: 'GOAL',
        valueMinor: '4200000',
        maxMinor: '10000000',
        shortfallMinor: null,
      },
    },
    {
      id: 'demo-env-reserve',
      name: 'Резерв',
      envelopeType: 'RESERVE',
      periodSlot: null,
      balanceMinor: '1500000',
      progress: null,
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
  protectedMinor: '18330000',
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

// Current period (25.09–09.10) by category. Amounts sum to
// periodStats.spentMinor (3 350 000); shares are basis points of that total
// and sum to exactly 10 000, as the server rounds them.
export const demoExpenseByCategoryRows: ExpenseByCategoryV2Row[] = [
  {
    categoryId: 'demo-cat-groceries',
    categoryName: 'Продукты',
    expenseMinor: '1450000',
    shareBasisPoints: 4328,
    journalFilters: {},
  },
  {
    categoryId: 'demo-cat-transport',
    categoryName: 'Транспорт',
    expenseMinor: '620000',
    shareBasisPoints: 1851,
    journalFilters: {},
  },
  {
    categoryId: 'demo-cat-cafe',
    categoryName: 'Кафе и рестораны',
    expenseMinor: '480000',
    shareBasisPoints: 1433,
    journalFilters: {},
  },
  {
    categoryId: 'demo-cat-kids',
    categoryName: 'Дети',
    expenseMinor: '450000',
    shareBasisPoints: 1343,
    journalFilters: {},
  },
  {
    categoryId: 'demo-cat-pharmacy',
    categoryName: 'Аптека',
    expenseMinor: '210000',
    shareBasisPoints: 627,
    journalFilters: {},
  },
  {
    categoryId: 'demo-cat-other',
    categoryName: 'Прочее',
    expenseMinor: '140000',
    shareBasisPoints: 418,
    journalFilters: {},
  },
];

// Limits of the «На текущие траты» envelope, newest first. The current row
// matches demoEnvelopes, the previous one leaves the 430 000 leftover shown on
// the dashboard, the earlier one is overspent.
// target = spent + remaining − overspent.
export const demoLimitRows: EnvelopeLimitV2Row[] = [
  {
    periodId: PERIOD_CURRENT,
    periodStart: '2026-09-25',
    periodEnd: '2026-10-09',
    isCurrent: true,
    envelopeId: 'demo-env-current-second',
    envelopeName: 'Текущие траты',
    targetMinor: '6500000',
    targetStatus: 'CONFIRMED',
    spentMinor: '3350000',
    remainingMinor: '3150000',
    overspentMinor: '0',
    spentPermille: 515,
  },
  {
    periodId: PERIOD_PREVIOUS,
    periodStart: '2026-09-10',
    periodEnd: '2026-09-24',
    isCurrent: false,
    envelopeId: 'demo-env-current-first',
    envelopeName: 'Текущие траты',
    targetMinor: '6000000',
    targetStatus: 'CONFIRMED',
    spentMinor: '5570000',
    remainingMinor: '430000',
    overspentMinor: '0',
    spentPermille: 928,
  },
  {
    periodId: PERIOD_EARLIER,
    periodStart: '2026-08-25',
    periodEnd: '2026-09-09',
    isCurrent: false,
    envelopeId: 'demo-env-current-second',
    envelopeName: 'Текущие траты',
    targetMinor: '6000000',
    targetStatus: 'CONFIRMED',
    spentMinor: '6240000',
    remainingMinor: '0',
    overspentMinor: '240000',
    spentPermille: 1040,
  },
];

// Financial cycles, oldest first; the last one is in progress.
// netCashFlowMinor = incomeMinor − expenseMinor.
export const demoCashFlowRows: NetCashFlowV2Row[] = [
  {
    cycleStart: '2026-07-10',
    cycleEnd: '2026-08-09',
    incomeMinor: '21200000',
    expenseMinor: '18640000',
    netCashFlowMinor: '2560000',
    journalFilters: {},
  },
  {
    cycleStart: '2026-08-10',
    cycleEnd: '2026-09-09',
    incomeMinor: '21900000',
    expenseMinor: '19870000',
    netCashFlowMinor: '2030000',
    journalFilters: {},
  },
  {
    cycleStart: '2026-09-10',
    cycleEnd: '2026-10-09',
    incomeMinor: '21200000',
    expenseMinor: '14380000',
    netCashFlowMinor: '6820000',
    journalFilters: {},
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
