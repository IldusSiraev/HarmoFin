import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

const MONEY = '^-?\\d+$';

export const reportV2Keys = [
  'account-balances',
  'expenses-by-category',
  'expenses-by-period',
  'expenses-by-cycle',
  'incomes-by-cycle',
  'net-cash-flow',
  'savings-goals',
  'plan-vs-actual',
  'assignment-movements',
  'envelope-limits',
  'period-comparison',
] as const;

export const reportV2KeySchema = z.enum(reportV2Keys);

export const reportV2FiltersSchema = z
  .object({
    from: z.string().date().optional(),
    to: z.string().date().optional(),
    accountId: z.string().uuid().optional(),
    categoryId: z.string().uuid().optional(),
    envelopeId: z.string().uuid().optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.from && input.to) {
      if (input.from > input.to) {
        context.addIssue({
          code: 'custom',
          path: ['to'],
          message: 'Дата окончания раньше даты начала.',
        });
      }
      const span =
        new Date(`${input.to}T00:00:00.000Z`).getTime() -
        new Date(`${input.from}T00:00:00.000Z`).getTime();
      if (span > 1_100 * 86_400_000) {
        context.addIssue({
          code: 'custom',
          path: ['to'],
          message: 'Период отчёта не может превышать 36 месяцев.',
        });
      }
    }
  });

export type ReportV2Key = z.output<typeof reportV2KeySchema>;
export type ReportV2Filters = z.output<typeof reportV2FiltersSchema>;

export class ReportV2JournalFiltersResponse {
  @ApiProperty({ type: String, format: 'date', required: false })
  from?: string;

  @ApiProperty({ type: String, format: 'date', required: false })
  to?: string;

  @ApiProperty({ type: String, enum: ['INCOME', 'EXPENSE'], required: false })
  type?: 'INCOME' | 'EXPENSE';

  @ApiProperty({ type: String, format: 'uuid', required: false })
  categoryId?: string;
}

export class ReportV2AccountBalanceRow {
  @ApiProperty({ type: String, format: 'uuid' })
  accountId!: string;

  @ApiProperty({ type: String })
  name!: string;

  @ApiProperty({ type: String, pattern: MONEY })
  balanceMinor!: string;

  @ApiProperty({ type: String, format: 'date', description: 'День, на конец которого баланс.' })
  asOf!: string;
}

export class ReportV2AccountBalancesResponse {
  @ApiProperty({ type: String, enum: ['account-balances'] })
  key!: 'account-balances';

  @ApiProperty({ type: [ReportV2AccountBalanceRow] })
  rows!: ReportV2AccountBalanceRow[];
}

export class ReportV2ExpenseByCategoryRow {
  @ApiProperty({ type: String, format: 'uuid' })
  categoryId!: string;

  @ApiProperty({ type: String })
  categoryName!: string;

  @ApiProperty({ type: String, pattern: MONEY })
  expenseMinor!: string;

  @ApiProperty({
    type: Number,
    description:
      'Доля категории от суммы расходов ответа в базисных пунктах (0..10000), округление к нулю.',
  })
  shareBasisPoints!: number;

  @ApiProperty({ type: ReportV2JournalFiltersResponse })
  journalFilters!: ReportV2JournalFiltersResponse;
}

export class ReportV2ExpensesByCategoryResponse {
  @ApiProperty({ type: String, enum: ['expenses-by-category'] })
  key!: 'expenses-by-category';

  @ApiProperty({ type: [ReportV2ExpenseByCategoryRow] })
  rows!: ReportV2ExpenseByCategoryRow[];
}

export class ReportV2ExpenseByPeriodRow {
  @ApiProperty({ type: String, format: 'date' })
  periodStart!: string;

  @ApiProperty({ type: String, format: 'date' })
  periodEnd!: string;

  @ApiProperty({
    type: String,
    enum: ['STORED', 'SETTINGS_AT'],
    description:
      'STORED: границы сохранённой строки периода конверта; SETTINGS_AT: даты без строки считаются по настройкам цикла, действовавшим в тот день (с учётом ревизий).',
  })
  boundarySource!: 'STORED' | 'SETTINGS_AT';

  @ApiProperty({ type: String, pattern: MONEY })
  expenseMinor!: string;

  @ApiProperty({ type: ReportV2JournalFiltersResponse })
  journalFilters!: ReportV2JournalFiltersResponse;
}

export class ReportV2ExpensesByPeriodResponse {
  @ApiProperty({ type: String, enum: ['expenses-by-period'] })
  key!: 'expenses-by-period';

  @ApiProperty({ type: [ReportV2ExpenseByPeriodRow] })
  rows!: ReportV2ExpenseByPeriodRow[];
}

export class ReportV2ExpenseByCycleRow {
  @ApiProperty({ type: String, format: 'date' })
  cycleStart!: string;

  @ApiProperty({ type: String, format: 'date' })
  cycleEnd!: string;

  @ApiProperty({ type: String, pattern: MONEY })
  expenseMinor!: string;

  @ApiProperty({ type: ReportV2JournalFiltersResponse })
  journalFilters!: ReportV2JournalFiltersResponse;
}

export class ReportV2ExpensesByCycleResponse {
  @ApiProperty({ type: String, enum: ['expenses-by-cycle'] })
  key!: 'expenses-by-cycle';

  @ApiProperty({ type: [ReportV2ExpenseByCycleRow] })
  rows!: ReportV2ExpenseByCycleRow[];
}

export class ReportV2IncomeByCycleRow {
  @ApiProperty({ type: String, format: 'date' })
  cycleStart!: string;

  @ApiProperty({ type: String, format: 'date' })
  cycleEnd!: string;

  @ApiProperty({ type: String, pattern: MONEY })
  incomeMinor!: string;

  @ApiProperty({ type: ReportV2JournalFiltersResponse })
  journalFilters!: ReportV2JournalFiltersResponse;
}

export class ReportV2IncomesByCycleResponse {
  @ApiProperty({ type: String, enum: ['incomes-by-cycle'] })
  key!: 'incomes-by-cycle';

  @ApiProperty({ type: [ReportV2IncomeByCycleRow] })
  rows!: ReportV2IncomeByCycleRow[];
}

export class ReportV2NetCashFlowRow {
  @ApiProperty({ type: String, format: 'date' })
  cycleStart!: string;

  @ApiProperty({ type: String, format: 'date' })
  cycleEnd!: string;

  @ApiProperty({ type: String, pattern: MONEY })
  incomeMinor!: string;

  @ApiProperty({ type: String, pattern: MONEY })
  expenseMinor!: string;

  @ApiProperty({ type: String, pattern: MONEY })
  netCashFlowMinor!: string;

  @ApiProperty({ type: ReportV2JournalFiltersResponse })
  journalFilters!: ReportV2JournalFiltersResponse;
}

export class ReportV2NetCashFlowResponse {
  @ApiProperty({ type: String, enum: ['net-cash-flow'] })
  key!: 'net-cash-flow';

  @ApiProperty({ type: [ReportV2NetCashFlowRow] })
  rows!: ReportV2NetCashFlowRow[];
}

export class ReportV2SavingsGoalRow {
  @ApiProperty({ type: String, format: 'uuid' })
  envelopeId!: string;

  @ApiProperty({ type: String })
  name!: string;

  @ApiProperty({ type: String })
  envelopeType!: string;

  @ApiProperty({
    type: String,
    pattern: MONEY,
    description: 'Непрерывный v2-остаток: назначено + перенесено нетто - потрачено.',
  })
  currentMinor!: string;

  @ApiProperty({ type: String, pattern: MONEY })
  targetMinor!: string;

  @ApiProperty({ type: String, format: 'date', nullable: true })
  targetDate!: string | null;

  @ApiProperty({ type: String, pattern: MONEY, description: 'Сумма CONFIRMED назначений.' })
  assignedMinor!: string;

  @ApiProperty({
    type: String,
    pattern: MONEY,
    description: 'Переназначения между конвертами (вход минус выход); не накопление.',
  })
  movedNetMinor!: string;

  @ApiProperty({ type: String, pattern: MONEY, description: 'CONFIRMED v2-расходы конверта.' })
  spentMinor!: string;

  @ApiProperty({ type: String, pattern: MONEY })
  remainingMinor!: string;

  @ApiProperty({ type: Number, minimum: 0, maximum: 1000 })
  progressPermille!: number;

  @ApiProperty({ type: Boolean })
  isReached!: boolean;

  @ApiProperty({ type: Number, format: 'int32', nullable: true })
  daysRemaining!: number | null;
}

export class ReportV2SavingsGoalsResponse {
  @ApiProperty({ type: String, enum: ['savings-goals'] })
  key!: 'savings-goals';

  @ApiProperty({ type: [ReportV2SavingsGoalRow] })
  rows!: ReportV2SavingsGoalRow[];
}

export class ReportV2PlanVsActualRow {
  @ApiProperty({ type: String, format: 'uuid' })
  planId!: string;

  @ApiProperty({ type: String })
  planName!: string;

  @ApiProperty({ type: String, enum: ['INCOME', 'EXPENSE'] })
  planType!: 'INCOME' | 'EXPENSE';

  @ApiProperty({ type: String, pattern: MONEY, description: 'Сумма snapshot-ов occurrence.' })
  plannedMinor!: string;

  @ApiProperty({
    type: String,
    pattern: MONEY,
    description: 'CONFIRMED оплаты occurrence, каждая операция один раз.',
  })
  actualMinor!: string;

  @ApiProperty({ type: String, pattern: MONEY })
  varianceMinor!: string;

  @ApiProperty({ type: Number, minimum: 0 })
  plannedOccurrenceCount!: number;

  @ApiProperty({ type: Number, minimum: 0 })
  confirmedOccurrenceCount!: number;
}

export class ReportV2PlanVsActualResponse {
  @ApiProperty({ type: String, enum: ['plan-vs-actual'] })
  key!: 'plan-vs-actual';

  @ApiProperty({ type: [ReportV2PlanVsActualRow] })
  rows!: ReportV2PlanVsActualRow[];
}

export class ReportV2AssignmentMovementRow {
  @ApiProperty({ type: String, enum: ['ASSIGNMENT', 'MOVEMENT'] })
  kind!: 'ASSIGNMENT' | 'MOVEMENT';

  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, format: 'date' })
  effectiveOn!: string;

  @ApiProperty({ type: String, pattern: MONEY })
  amountMinor!: string;

  @ApiProperty({
    type: Boolean,
    description: 'true для назначений; переназначение между конвертами накоплением не считается.',
  })
  countsAsAccumulation!: boolean;

  @ApiProperty({ type: String, enum: ['INCOME', 'OPENING', 'FREE'], nullable: true })
  assignmentType!: 'INCOME' | 'OPENING' | 'FREE' | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  envelopeId!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  periodId!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  sourceEnvelopeId!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  sourcePeriodId!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  destinationEnvelopeId!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  destinationPeriodId!: string | null;
}

export class ReportV2AssignmentMovementsResponse {
  @ApiProperty({ type: String, enum: ['assignment-movements'] })
  key!: 'assignment-movements';

  @ApiProperty({ type: [ReportV2AssignmentMovementRow] })
  rows!: ReportV2AssignmentMovementRow[];
}

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

  @ApiProperty({ type: String, example: 'Продукты' })
  envelopeName!: string;

  @ApiProperty({
    type: String,
    pattern: MONEY,
    nullable: true,
    description: 'null, если лимит не задан.',
  })
  targetMinor!: string | null;

  @ApiProperty({ type: String, enum: ['UNSET', 'DRAFT', 'CONFIRMED'] })
  targetStatus!: 'UNSET' | 'DRAFT' | 'CONFIRMED';

  @ApiProperty({ type: String, pattern: MONEY })
  spentMinor!: string;

  @ApiProperty({
    type: String,
    pattern: MONEY,
    nullable: true,
    description: 'Лимит минус потрачено; может быть отрицательным.',
  })
  remainingMinor!: string | null;

  @ApiProperty({ type: String, pattern: MONEY })
  overspentMinor!: string;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Потрачено × 1000 / лимит; больше 1000 при перерасходе.',
  })
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

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'null, если в прошлом периоде к этому дню расходов не было.',
  })
  deltaBasisPoints!: number | null;
}

export class ReportV2PeriodComparisonResponse {
  @ApiProperty({ type: String, enum: ['period-comparison'] })
  key!: 'period-comparison';

  @ApiProperty({ type: [ReportV2PeriodComparisonRow] })
  rows!: ReportV2PeriodComparisonRow[];
}
