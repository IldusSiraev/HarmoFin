import type { PlanVsActualRowDto } from './useBudgetReferenceData.js';
import { useApiClient } from './useApiClient.js';

// Thin typed client over the v2 (Envelope Plan v2.2) API. Every amount in a
// response is a minor-units string produced by the server; request amounts are
// decimal strings. Nothing here computes money.
//
// CSRF is handled by the shared request client. Mutations take the
// Idempotency-Key from the caller: one key per user attempt, reused when the
// same attempt is retried. Preview calls need no key.

export type FundingSourceKind = 'INCOME' | 'OPENING' | 'FREE';
export type PlanListStatus = 'active' | 'archived' | 'all';
export type OccurrenceStatus = 'PENDING' | 'DUE' | 'SKIPPED' | 'COMPLETED' | 'CANCELLED';
export type PlanRecurrenceV2 = 'ONE_TIME' | 'MONTHLY' | 'EVERY_N_MONTHS' | 'YEARLY';

// Funding

export interface FundingLineInput {
  envelopeId: string;
  /** Server row identifier for two-slice mandatory rows; echo the preview value only. */
  lineId?: string;
  periodId?: string;
  /** Decimal rubles, e.g. "1500.50". */
  amount: string;
}

export interface FundingPreviewRequest {
  sourceKind: FundingSourceKind;
  incomeTransactionId?: string;
  overrides?: FundingLineInput[];
  confirmPeriodTargets?: string[];
}

export interface FundingPreviewResponse {
  sourceKind: FundingSourceKind;
  sourceAvailableMinor: string;
  periodTargetDrafts: Array<{
    periodId: string;
    targetMinor: string;
    selectedForConfirmation: boolean;
  }>;
  lines: Array<{
    envelopeId: string;
    /** Identifies a preview row for the next call; mandatory rows carry slice suffix. */
    lineId?: string | null;
    periodId: string | null;
    suggestedMinor: string;
    /** 1-based rule-queue position; null for envelopes without a queued rule. */
    queuePosition?: number | null;
    /** Period of the line (YYYY-MM-DD); null for envelopes without periods. */
    periodStartsOn?: string | null;
    periodEndsOn?: string | null;
  }>;
  remainingMinor: string;
  mandatoryDueCurrentMinor: string;
  mandatoryDueNextMinor: string;
  mandatoryGapMinor: string;
  previewHash: string;
  errors: Array<{ code: string; detail: string }>;
}

export interface FundingConfirmRequest {
  sourceKind: FundingSourceKind;
  incomeTransactionId?: string;
  previewHash: string;
  confirmPeriodTargets: string[];
  lines: FundingLineInput[];
}

export interface FundingConfirmResponse {
  assignedMinor: string;
  sourceRemainingMinor: string;
  confirmedPeriodIds: string[];
  assignments: Array<{
    id: string;
    envelopeId: string;
    periodId: string | null;
    amountMinor: string;
  }>;
}

// Envelopes, assignments, movements

/** One period bucket of a period envelope; amounts are minor-unit strings from the server. */
export interface EnvelopePeriodDto {
  periodId: string;
  startsOn: string;
  endsOn: string;
  fundedMinor: string;
  spentMinor: string;
  balanceMinor: string;
  /** The server decides which period is current (budget timezone). */
  current: boolean;
}

export interface EnvelopePlanDto {
  id: string;
  name: string;
  envelopeType: string;
  periodSlot: string | null;
  /** Goal in DECIMAL rubles ("5000", "5000.5"), unlike the minor-unit amounts below. */
  targetAmountMinor: string | null;
  comment: string | null;
  fundedMinor: string;
  spentMinor: string;
  balanceMinor: string;
  archivedAt: string | null;
  /** Period buckets with money movement plus the current one; empty for non-period envelopes. */
  periods?: EnvelopePeriodDto[];
}

export interface EnvelopePlanListResponse {
  items: EnvelopePlanDto[];
}

export interface AssignFreeRequest {
  envelopeId: string;
  periodId?: string;
  amount: string;
}

export interface MoveEnvelopeRequest {
  sourceEnvelopeId: string;
  sourcePeriodId?: string;
  destinationEnvelopeId?: string | null;
  destinationPeriodId?: string;
  amount: string;
}

// Server answers for assign/move: balances after the change, as minor strings.
export interface AssignFreeResponse {
  assignmentId: string;
  amountMinor: string;
  fundedMinor: string;
  spentMinor: string;
  balanceMinor: string;
  freeToAssignMinor: string;
}

export interface MoveEnvelopeResponse {
  movementId: string;
  amountMinor: string;
  sourceBalanceMinor: string;
  destinationBalanceMinor: string | null;
  cashMinor: string;
}

export type EnvelopePlanKind =
  'CURRENT_EXPENSES' | 'MANDATORY_EXPENSES' | 'SAVINGS_GOAL' | 'RESERVE' | 'CUSTOM';

export interface CreateEnvelopePlanRequest {
  name: string;
  envelopeType: EnvelopePlanKind;
  periodSlot?: 'FIRST' | 'SECOND';
  /** Decimal rubles (the field name is the API's). */
  targetAmountMinor?: string;
  comment?: string;
}

export interface UpdateEnvelopePlanRequest {
  name?: string;
  periodSlot?: 'FIRST' | 'SECOND';
}

export interface EnvelopeHistoryItem {
  kind: 'ASSIGNMENT' | 'MOVEMENT' | 'SPENDING';
  amountMinor: string;
  effectiveOn: string;
}

export interface EnvelopeHistoryResponse {
  items: EnvelopeHistoryItem[];
  nextCursor: string | null;
}

export interface EnvelopeHistoryQuery {
  cursor?: string;
  limit?: string;
  /** DELETED returns cancelled facts, read-only. */
  status?: 'CONFIRMED' | 'DELETED';
}

export interface PeriodTargetResponse {
  periodId: string;
  envelopeId: string;
  periodStart: string;
  periodEnd: string;
  [key: string]: unknown;
}

// Dashboard

export type DashboardObligationCoverage = 'COVERED' | 'PARTIAL' | 'UNCOVERED';

export interface DashboardEnvelopeProgress {
  kind: 'SPENT' | 'COVERED' | 'GOAL';
  valueMinor: string;
  maxMinor: string;
  shortfallMinor: string | null;
}

export interface DashboardV2Response {
  planModelVersion: 2;
  period: { start: string; end: string; periodId: string | null };
  cycle: { start: string; end: string };
  asOf: string;
  horizonEnd: string;
  nearestObligations: Array<{
    occurrenceId: string;
    name: string;
    scheduledOn: string;
    unpaidMinor: string;
    coverage: DashboardObligationCoverage;
    shortfallMinor: string;
  }>;
  periodStats: {
    spentMinor: string;
    availableMinor: string;
    daysLeft: number;
    averagePerDayMinor: string;
  } | null;
  envelopes: Array<{
    id: string;
    name: string;
    envelopeType: string;
    periodSlot: 'FIRST' | 'SECOND' | null;
    balanceMinor: string;
    progress: DashboardEnvelopeProgress | null;
  }>;
  envelopesTotalMinor: string;
  spendable: { state: 'READY' | 'NEEDS_PERIOD_SETUP'; amountMinor: string | null };
  suggestedTarget: string | null;
  cashMinor: string;
  currentBalanceMinor: string;
  mandatoryBalanceMinor: string;
  mandatoryDueMinor: string;
  mandatoryDueCurrentMinor: string;
  mandatoryDueNextMinor: string;
  protectedMinor: string;
  otherProtectedMinor: string;
  freeToAssignMinor: string;
  unbackedMinor: string;
  mandatoryGapMinor: string;
  mandatoryGapCurrentMinor: string;
  mandatoryGapNextMinor: string;
  dueMayBeIncomplete: boolean;
  upcoming: Array<{ occurrenceId: string; scheduledOn: string; unpaidMinor: string }>;
  accounts: Array<{ id: string; name: string; balanceMinor: string }>;
  protectedAssignments: Array<{
    envelopeId: string;
    envelopeName: string;
    envelopeType: string;
    periodId: string | null;
    balanceMinor: string;
  }>;
  warnings: Array<{
    kind: 'PERIOD' | 'COVERAGE';
    code: 'PERIOD_LEFTOVER' | 'PERIOD_DEFICIT' | 'MANDATORY_GAP' | 'CASH_SHORTFALL';
    message: string;
    amountMinor: string;
    envelopeId: string | null;
    periodId: string | null;
    balanceMinor: string | null;
    /** Only for MANDATORY_GAP: ALERT if money is needed for the current period, INFO otherwise. */
    level?: 'ALERT' | 'INFO';
    actionPath: string;
  }>;
  onboarding: {
    categoriesSeeded: boolean;
    hasAccounts: boolean;
    needsOpeningAssignment: boolean;
    needsPeriodSetup: boolean;
    hasMandatoryPlans: boolean;
    mandatoryPlansDeclined: boolean;
  };
}

// Reference template

export type TemplateAction = 'CREATE' | 'ADOPT' | 'SKIP';
export type TemplateRuleChoice = 'SUGGESTED' | 'MANUAL';

export interface TemplateMatchFields {
  status: string;
  matchedBy: string | null;
  existingId: string | null;
  existingName: string | null;
  archivedId: string | null;
  collisionId: string | null;
  suggestedAction: string;
  requiresConsent: boolean;
}

export interface TemplatePreviewResponse {
  cycle: { cycleStartDay: number; periodBoundaryOffset: number } & TemplateMatchFields;
  categories: Array<
    TemplateMatchFields & {
      templateKey: string;
      name: string;
      categoryType: string;
      parentTemplateKey: string | null;
    }
  >;
  envelopes: Array<
    TemplateMatchFields & {
      role: string;
      templateKey: string;
      name: string;
      type: string;
      periodSlot: string | null;
      selectable: boolean;
      suggestedRuleType: string;
      existingRuleType: string | null;
      suggestedTargetMinor: string | null;
      replacementTemplateKey: string | null;
    }
  >;
  isComplete: boolean;
  previewHash: string;
}

export interface TemplateApplyRequest {
  previewHash: string;
  cycle?: { startDay: number; boundaryOffset: number };
  periods: Array<{
    role: 'FIRST' | 'SECOND';
    action: TemplateAction;
    name?: string;
    /** Decimal rubles. */
    target?: string | null;
    ruleChoice?: TemplateRuleChoice;
  }>;
  mandatory: { action: TemplateAction; name?: string; ruleChoice?: TemplateRuleChoice };
  savings: Array<{ name: string; requestedContribution?: string | null }>;
}

export interface TemplateApplyResponse {
  created: {
    categories: Array<{ id: string; templateKey: string; name: string }>;
    envelopes: Array<{ id: string; templateKey: string; name: string; role: string }>;
  };
  adopted: Array<{ id: string; role: string; templateKey: string | null; name: string }>;
  skipped: Array<{ kind: string; role: string | null; templateKey: string; reason: string }>;
  rules: Array<{ envelopeId: string; type: string; priority: number }>;
  cycle: { changed: boolean; resetPeriods: number } & Record<string, unknown>;
  isComplete: boolean;
  previewHash: string;
}

// Transactions and transfers

export interface CreateTransactionV2Request {
  transactionType: 'INCOME' | 'EXPENSE';
  status: 'DRAFT' | 'CONFIRMED';
  amount: string;
  occurredOn: string;
  accountId: string;
  categoryId: string;
  envelopeId?: string | null;
  comment?: string;
}

export interface TransactionV2Response {
  id: string;
  budgetId: string;
  transactionType: 'INCOME' | 'EXPENSE';
  status: 'DRAFT' | 'CONFIRMED';
  amountMinor: string;
  currency: string;
  occurredOn: string;
  accountId: string;
  categoryId: string;
  envelopeId: string | null;
  comment: string | null;
  accountBalanceMinor: string;
  warnings: Array<{ code: string; detail: string }>;
}

export type TransactionV2Status = 'DRAFT' | 'CONFIRMED' | 'CANCELLED' | 'DELETED';

// The journal feed names who recorded each row; other reads of a transaction
// (a single fetch, a lifecycle response) do not carry it, so the field stays
// optional on the shared item type instead of forking it into a journal-only type.
export interface AuthorRef {
  userId: string;
  displayName: string | null;
  isActiveMember: boolean;
}

// One journal row.
export interface TransactionJournalV2Item {
  id: string;
  budgetId: string;
  accountingModelVersion: 1 | 2;
  transactionType: 'INCOME' | 'EXPENSE';
  status: TransactionV2Status;
  amountMinor: string;
  currency: string;
  occurredOn: string;
  accountId: string;
  categoryId: string;
  envelopeId: string | null;
  sourceDescription: string | null;
  merchantName: string | null;
  comment: string | null;
  planOccurrenceIds: string[];
  confirmedAt: string | null;
  cancelledAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  createdBy?: AuthorRef;
}

export interface TransactionJournalV2Response {
  items: TransactionJournalV2Item[];
  nextCursor: string | null;
}

// The journal order is fixed by the server; there is no search or sort filter.
export interface TransactionJournalV2Query {
  limit?: number;
  cursor?: string;
  type?: 'INCOME' | 'EXPENSE';
  /** DELETED is OWNER-only (403 otherwise); by default deleted rows are hidden. */
  status?: TransactionV2Status;
  from?: string;
  to?: string;
  accountId?: string;
  categoryId?: string;
  envelopeId?: string;
  createdByUserId?: string;
}

// Shared journal feed: v2 transactions and direct transfers in one order.
export interface TransferJournalItem {
  kind: 'TRANSFER';
  id: string;
  budgetId: string;
  status: 'CONFIRMED' | 'DELETED';
  amountMinor: string;
  currency: string;
  occurredOn: string;
  sourceAccountId: string;
  destinationAccountId: string;
  comment: string | null;
  createdAt: string;
  deletedAt: string | null;
  // Present on journal rows only, like `TransactionJournalV2Item.createdBy`;
  // a transfer mutation response does not carry it.
  createdBy?: AuthorRef;
}

export type TransactionFeedItem = { kind: 'TRANSACTION' } & TransactionJournalV2Item;
export type JournalItem = TransactionFeedItem | TransferJournalItem;

export interface JournalResponse {
  items: JournalItem[];
  nextCursor: string | null;
}

export type JournalQuery = Omit<TransactionJournalV2Query, 'type'> & {
  type?: 'INCOME' | 'EXPENSE' | 'TRANSFER';
};

// Only the fields that change; status moves through delete/restore.
export interface UpdateDirectTransferRequest {
  sourceAccountId?: string;
  destinationAccountId?: string;
  /** Decimal rubles, e.g. "1250.00". */
  amount?: string;
  occurredOn?: string;
  comment?: string | null;
}

// Only the fields that change. Status moves through delete/restore, never here.
export interface UpdateTransactionV2Request {
  /** Decimal rubles, e.g. "1250.00". */
  amount?: string;
  occurredOn?: string;
  accountId?: string;
  categoryId?: string;
  envelopeId?: string | null;
  comment?: string | null;
}

export interface TransactionV2LifecycleResponse {
  id: string;
  budgetId: string;
  transactionType: 'INCOME' | 'EXPENSE';
  status: TransactionV2Status;
  amountMinor: string;
  currency: string;
  occurredOn: string;
  accountId: string;
  categoryId: string;
  envelopeId: string | null;
  comment: string | null;
  accountBalanceMinor: string;
  warnings: Array<{ code: string; detail: string }>;
  occurrences: Array<{
    id: string;
    status: string;
    expectedMinor: string;
    paidMinor: string;
    unpaidMinor: string;
  }>;
}

export interface CreateDirectTransferRequest {
  sourceAccountId: string;
  destinationAccountId: string;
  amount: string;
  occurredOn: string;
  comment?: string;
}

export interface DirectTransferResponse {
  id: string;
  budgetId: string;
  status: 'CONFIRMED' | 'DRAFT' | 'CANCELLED' | 'DELETED';
  mode: 'ACCOUNT_ONLY';
  totalMinor: string;
  comment: string | null;
  occurredOn: string;
  sourceAccountId: string | null;
  destinationAccountId: string | null;
}

// Obligations

export interface ObligationPayRequest {
  accountId: string;
  categoryId: string;
  amount: string;
  occurredOn: string;
  willPayMore: boolean;
}

export interface ObligationResultResponse {
  transaction: {
    id: string;
    amountMinor: string;
    occurredOn: string;
    accountId: string;
    categoryId: string;
    envelopeId: string;
    accountBalanceMinor: string;
  } | null;
  occurrence: {
    id: string;
    status: string;
    expectedMinor: string;
    paidMinor: string;
    unpaidMinor: string;
  };
  warnings: Array<{ code: string; detail: string }>;
}

export interface CreatePlanRequest {
  name: string;
  amount: string;
  scheduledOn: string;
  categoryId: string;
  recurrence: PlanRecurrenceV2;
  intervalMonths?: number | null;
  endOn?: string | null;
  comment?: string | null;
}

export interface PlanResponse {
  id: string;
  planType: string;
  name: string;
  amountMinor: string;
  recurrence: PlanRecurrenceV2;
  intervalMonths: number | null;
  scheduledOn: string;
  endOn: string | null;
  categoryId: string | null;
  comment: string | null;
  status: string;
}

export interface UpdatePlanRequest {
  name?: string;
  amount?: string;
  status?: 'ACTIVE' | 'ARCHIVED';
  applyToCurrentOpen?: boolean;
}

export interface UpdatePlanResponse extends PlanResponse {
  updatedOccurrences: number;
  cancelledOccurrences: number;
}

export interface ObligationPlanResponse extends PlanResponse {
  envelopeId: string | null;
}

export interface PlanCreateResponse extends PlanResponse {
  occurrenceId: string | null;
  occurrencesCreated: number;
}

export interface ObligationPlanCreateResponse extends PlanCreateResponse {
  envelopeId: string | null;
}

export interface OneTimeObligationPayRequest {
  name: string;
  plannedAmount: string;
  actualAmount: string;
  occurredOn: string;
  accountId: string;
  categoryId: string;
  comment?: string | null;
}

export interface OneTimeObligationPayResponse {
  plannedMinor: string;
  actualMinor: string;
  occurrenceId: string;
  planId: string;
  transaction: {
    id: string;
    amountMinor: string;
    occurredOn: string;
    accountId: string;
    categoryId: string;
    envelopeId: string;
    accountBalanceMinor: string;
  };
  warnings: Array<{ code: string; detail: string }>;
}

export interface OccurrenceListQuery {
  planId?: string;
  status?: OccurrenceStatus;
  from?: string;
  to?: string;
}

export interface ObligationOccurrenceItem {
  id: string;
  planId: string;
  name: string;
  scheduledOn: string;
  status: OccurrenceStatus;
  expectedMinor: string;
  paidMinor: string;
  unpaidMinor: string;
  categoryId: string | null;
  envelopeId: string | null;
}

// Income plans

export interface IncomeOccurrenceItem {
  id: string;
  planId: string;
  name: string;
  scheduledOn: string;
  status: string;
  expectedMinor: string;
  categoryId: string | null;
  transactionId: string | null;
}

export type PlansCalendarDot = 'upcoming' | 'overdue';

export interface PlansCalendarDay {
  date: string;
  incomeMinor: string;
  expenseMinor: string;
  dot: PlansCalendarDot | null;
}

export interface PlansCalendarItem {
  kind: 'OBLIGATION' | 'INCOME_PLAN';
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
  // COMPLETED with a confirmed operation: the plan is shown once, on the date of that
  // operation (factOn), with the sum actually paid or received (factMinor).
  factOn: string | null;
  factMinor: string | null;
  factTransactionIds: string[];
}

export interface PlansCalendarTotals {
  plannedIncomeMinor: string;
  plannedExpenseMinor: string;
  balanceMinor: string;
  activePlanCount: number;
}

export interface PlansCalendarResponse {
  month: string;
  today: string;
  days: PlansCalendarDay[];
  items: PlansCalendarItem[];
  overdue: PlansCalendarItem[];
  overdueCount: number;
  totals: PlansCalendarTotals;
}

export interface RecordIncomeOccurrenceRequest {
  accountId: string;
  amount: string;
  occurredOn: string;
  categoryId?: string;
  comment?: string | null;
}

export interface RecordIncomeOccurrenceResponse {
  occurrence: { id: string; status: string; transactionId: string };
  transaction: {
    id: string;
    transactionType: string;
    status: string;
    amountMinor: string;
    currency: string;
    occurredOn: string;
    accountId: string;
    categoryId: string;
    comment: string | null;
    accountBalanceMinor: string;
  };
}

// Funding rules and goals

export type FundingRuleType =
  'MANUAL' | 'SUM_OF_PLANS' | 'FIXED_PER_PERIOD' | 'SUGGESTED_FIXED' | 'PERCENT_OF_INCOME';

export interface PutFundingRuleRequest {
  type: FundingRuleType;
  priority: number;
  /** Decimal rubles; only FIXED_PER_PERIOD and SUGGESTED_FIXED. */
  fixedAmount?: string;
  /** Integer 0..10000; only PERCENT_OF_INCOME. */
  percentBasisPoints?: number;
}

export interface FundingRuleResponse {
  id: string;
  envelopeId: string;
  type: FundingRuleType;
  priority: number;
  fixedAmountMinor: string | null;
  percentBasisPoints: number | null;
}

export interface FundingRuleListResponse {
  items: FundingRuleResponse[];
}

export interface IncomeSuggestionState {
  enabled: boolean;
  sourceCategoryId: string | null;
  targetEnvelopeId: string | null;
}

export interface FundingRulesBatchQueueItem {
  envelopeId: string;
  type: Exclude<FundingRuleType, 'MANUAL'>;
  /** Decimal rubles; only FIXED_PER_PERIOD and SUGGESTED_FIXED. */
  fixedAmount?: string;
  /** Integer 0..10000; only PERCENT_OF_INCOME. */
  percentBasisPoints?: number;
}

export interface PutFundingRulesBatchRequest {
  /** Order of the array is the distribution order; the server assigns priorities. */
  queue: FundingRulesBatchQueueItem[];
  outside: Array<{ envelopeId: string; type: 'MANUAL' }>;
  incomeSuggestion: IncomeSuggestionState;
}

export interface FundingRulesBatchResponse {
  items: FundingRuleResponse[];
  incomeSuggestion: IncomeSuggestionState;
}

export interface PutPeriodTargetRequest {
  /** Decimal rubles; null resets the target to UNSET. */
  target: string | null;
}

export interface IncomeCategorySuggestionRequest {
  enabled: boolean;
  sourceCategoryId: string | null;
  targetEnvelopeId: string | null;
}

export interface IncomeCategorySuggestionResponse {
  enabled: boolean;
  sourceCategoryId: string | null;
  targetEnvelopeId: string | null;
}

// Reports (v2). Keys and row shapes follow the API DTO; amounts are minor strings.

export const REPORT_V2_KEYS = [
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
export type ReportV2Key = (typeof REPORT_V2_KEYS)[number];

export interface ReportV2Filters {
  from?: string;
  to?: string;
  accountId?: string;
  categoryId?: string;
  envelopeId?: string;
}

export interface SavingsGoalV2Row {
  envelopeId: string;
  name: string;
  envelopeType: string;
  /** Continuous v2 balance: assigned + moved net - spent. */
  currentMinor: string;
  targetMinor: string;
  targetDate: string | null;
  assignedMinor: string;
  movedNetMinor: string;
  spentMinor: string;
  remainingMinor: string;
  progressPermille: number;
  isReached: boolean;
  daysRemaining: number | null;
}

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

export interface ReportV2Response {
  key: ReportV2Key;
  rows: Array<Record<string, unknown>>;
}

function query(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined) search.set(name, value);
  }
  const text = search.toString();
  return text === '' ? '' : `?${text}`;
}

export interface CycleRange {
  start: string;
  end: string;
}

export interface CycleChangePreviewRequest {
  cycleStartDay: number;
  periodBoundaryOffset: number;
}

// effectiveOn and every date come from the server; the browser never computes them.
export interface CycleChangePreviewResponse {
  effectiveOn: string;
  transitionRanges: CycleRange[];
  previewHash: string;
}

export interface CycleTransitionTarget {
  periodStart: string;
  // Decimal string, null (or absent) means no fixed target.
  target?: string | null;
}

export interface CycleChangeConfirmRequest extends CycleChangePreviewRequest {
  previewHash: string;
  transitionTargets: CycleTransitionTarget[];
}

export interface CycleChangeConfirmResponse {
  effectiveOn: string;
  baselineCreated: boolean;
  transitionRanges: CycleRange[];
  createdPeriods: number;
}

export interface BudgetSettingsV2Request {
  name?: string;
  allowNegativeAccountBalance?: boolean;
  timezone?: string;
}

export interface BudgetSettingsV2Response {
  id: string;
  name: string;
  timezone: string;
  allowNegativeAccountBalance: boolean;
  cycleStartDay: number;
  periodBoundaryOffset: number;
  planModelVersion: number;
}

export function useEnvelopePlanV2() {
  const api = useApiClient();

  function base(budgetId: string): string {
    return `/api/v2/budgets/${encodeURIComponent(budgetId)}`;
  }

  function get<T>(path: string): Promise<T> {
    return api.request<T>(path);
  }

  // Preview-style POST: CSRF only, no Idempotency-Key.
  function post<T>(path: string, body: unknown): Promise<T> {
    return api.request<T>(path, { method: 'POST', body: JSON.stringify(body) });
  }

  function postKeyed<T>(path: string, body: unknown, idempotencyKey: string): Promise<T> {
    return api.request<T>(path, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Idempotency-Key': idempotencyKey },
    });
  }

  function putKeyed<T>(path: string, body: unknown, idempotencyKey: string): Promise<T> {
    return api.request<T>(path, {
      method: 'PUT',
      body: JSON.stringify(body),
      headers: { 'Idempotency-Key': idempotencyKey },
    });
  }

  function patchKeyed<T>(path: string, body: unknown, idempotencyKey: string): Promise<T> {
    return api.request<T>(path, {
      method: 'PATCH',
      body: JSON.stringify(body),
      headers: { 'Idempotency-Key': idempotencyKey },
    });
  }

  return {
    previewCycleChange: (budgetId: string, input: CycleChangePreviewRequest) =>
      post<CycleChangePreviewResponse>(`${base(budgetId)}/cycle-change/preview`, input),
    confirmCycleChange: (
      budgetId: string,
      input: CycleChangeConfirmRequest,
      idempotencyKey: string,
    ) =>
      postKeyed<CycleChangeConfirmResponse>(
        `${base(budgetId)}/cycle-change/confirm`,
        input,
        idempotencyKey,
      ),
    updateBudgetSettings: (
      budgetId: string,
      input: BudgetSettingsV2Request,
      idempotencyKey: string,
    ) => patchKeyed<BudgetSettingsV2Response>(`${base(budgetId)}/settings`, input, idempotencyKey),
    getReport: (budgetId: string, key: ReportV2Key, filters: ReportV2Filters = {}) =>
      get<ReportV2Response>(
        `${base(budgetId)}/reports/${encodeURIComponent(key)}${query({ ...filters })}`,
      ),
    // CSV exports (OWNER only). The shared client sends the session cookie and
    // turns JSON problems (403, 409, 422 EXPORT_LIMIT_EXCEEDED) into ApiRequestError.
    exportTransactions: (budgetId: string) =>
      api.requestBlob(`${base(budgetId)}/exports/transactions.csv`),
    exportAssignments: (budgetId: string) =>
      api.requestBlob(`${base(budgetId)}/exports/assignments.csv`),
    listFundingRules: (budgetId: string) =>
      get<FundingRuleListResponse>(`${base(budgetId)}/funding-rules`),
    saveFundingRules: (
      budgetId: string,
      input: PutFundingRulesBatchRequest,
      idempotencyKey: string,
    ) =>
      putKeyed<FundingRulesBatchResponse>(`${base(budgetId)}/funding-rules`, input, idempotencyKey),
    updateFundingRule: (
      budgetId: string,
      envelopeId: string,
      input: PutFundingRuleRequest,
      idempotencyKey: string,
    ) =>
      putKeyed<FundingRuleResponse>(
        `${base(budgetId)}/envelopes/${encodeURIComponent(envelopeId)}/funding-rule`,
        input,
        idempotencyKey,
      ),
    updatePeriodTarget: (
      budgetId: string,
      envelopeId: string,
      periodStart: string,
      input: PutPeriodTargetRequest,
      idempotencyKey: string,
    ) =>
      putKeyed<PeriodTargetResponse>(
        `${base(budgetId)}/envelopes/${encodeURIComponent(envelopeId)}/periods/${encodeURIComponent(periodStart)}/target`,
        input,
        idempotencyKey,
      ),
    updateIncomeCategorySuggestion: (
      budgetId: string,
      input: IncomeCategorySuggestionRequest,
      idempotencyKey: string,
    ) =>
      putKeyed<IncomeCategorySuggestionResponse>(
        `${base(budgetId)}/income-category-suggestion`,
        input,
        idempotencyKey,
      ),
    getDashboard: (budgetId: string, asOf?: string) =>
      get<DashboardV2Response>(`${base(budgetId)}/dashboard${query({ asOf })}`),
    previewFunding: (budgetId: string, input: FundingPreviewRequest) =>
      post<FundingPreviewResponse>(`${base(budgetId)}/funding/preview`, input),
    confirmFunding: (budgetId: string, input: FundingConfirmRequest, idempotencyKey: string) =>
      postKeyed<FundingConfirmResponse>(`${base(budgetId)}/funding/confirm`, input, idempotencyKey),
    assignFree: (budgetId: string, input: AssignFreeRequest, idempotencyKey: string) =>
      postKeyed<AssignFreeResponse>(
        `${base(budgetId)}/assignments`,
        { ...input, sourceKind: 'FREE' },
        idempotencyKey,
      ),
    move: (budgetId: string, input: MoveEnvelopeRequest, idempotencyKey: string) =>
      postKeyed<MoveEnvelopeResponse>(`${base(budgetId)}/movements`, input, idempotencyKey),
    getEnvelope: (budgetId: string, envelopeId: string) =>
      get<EnvelopePlanDto>(`${base(budgetId)}/envelopes/${encodeURIComponent(envelopeId)}`),
    getEnvelopeHistory: (budgetId: string, envelopeId: string, filter: EnvelopeHistoryQuery = {}) =>
      get<EnvelopeHistoryResponse>(
        `${base(budgetId)}/envelopes/${encodeURIComponent(envelopeId)}/history${query({ ...filter })}`,
      ),
    createEnvelope: (budgetId: string, input: CreateEnvelopePlanRequest, idempotencyKey: string) =>
      postKeyed<EnvelopePlanDto>(`${base(budgetId)}/envelopes`, input, idempotencyKey),
    updateEnvelope: (
      budgetId: string,
      envelopeId: string,
      input: UpdateEnvelopePlanRequest,
      idempotencyKey: string,
    ) =>
      api.request<EnvelopePlanDto>(
        `${base(budgetId)}/envelopes/${encodeURIComponent(envelopeId)}`,
        {
          method: 'PATCH',
          body: JSON.stringify(input),
          headers: { 'Idempotency-Key': idempotencyKey },
        },
      ),
    archiveEnvelope: (budgetId: string, envelopeId: string, idempotencyKey: string) =>
      postKeyed<EnvelopePlanDto>(
        `${base(budgetId)}/envelopes/${encodeURIComponent(envelopeId)}/archive`,
        {},
        idempotencyKey,
      ),
    confirmPeriodTarget: (budgetId: string, periodId: string, idempotencyKey: string) =>
      postKeyed<PeriodTargetResponse>(
        `${base(budgetId)}/periods/${encodeURIComponent(periodId)}/confirm-target`,
        {},
        idempotencyKey,
      ),
    rejectPeriodTarget: (budgetId: string, periodId: string, idempotencyKey: string) =>
      postKeyed<PeriodTargetResponse>(
        `${base(budgetId)}/periods/${encodeURIComponent(periodId)}/reject-target`,
        {},
        idempotencyKey,
      ),
    declineMandatoryPlans: (budgetId: string, idempotencyKey: string) =>
      postKeyed<void>(`${base(budgetId)}/onboarding/no-mandatory-plans`, {}, idempotencyKey),
    payObligation: (
      budgetId: string,
      occurrenceId: string,
      input: ObligationPayRequest,
      idempotencyKey: string,
    ) =>
      postKeyed<ObligationResultResponse>(
        `${base(budgetId)}/obligations/${encodeURIComponent(occurrenceId)}/pay`,
        input,
        idempotencyKey,
      ),
    skipObligationOccurrence: (budgetId: string, occurrenceId: string, idempotencyKey: string) =>
      postKeyed<ObligationResultResponse>(
        `${base(budgetId)}/obligations/${encodeURIComponent(occurrenceId)}/skip`,
        {},
        idempotencyKey,
      ),
    listObligationOccurrences: (budgetId: string, filter: OccurrenceListQuery = {}) =>
      get<{ items: ObligationOccurrenceItem[] }>(
        `${base(budgetId)}/obligations/occurrences${query({ ...filter })}`,
      ),
    getTemplatePreview: (budgetId: string) =>
      get<TemplatePreviewResponse>(`${base(budgetId)}/reference-template/preview`),
    applyTemplate: (budgetId: string, input: TemplateApplyRequest, idempotencyKey: string) =>
      postKeyed<TemplateApplyResponse>(
        `${base(budgetId)}/reference-template/apply`,
        input,
        idempotencyKey,
      ),
    listEnvelopes: (budgetId: string) =>
      get<EnvelopePlanListResponse>(`${base(budgetId)}/envelopes`),
    createTransaction: (
      budgetId: string,
      input: CreateTransactionV2Request,
      idempotencyKey: string,
    ) => postKeyed<TransactionV2Response>(`${base(budgetId)}/transactions`, input, idempotencyKey),
    listTransactions: (budgetId: string, filter: TransactionJournalV2Query = {}) =>
      get<TransactionJournalV2Response>(
        `${base(budgetId)}/transactions${query({
          ...filter,
          limit: filter.limit === undefined ? undefined : String(filter.limit),
        })}`,
      ),
    listJournal: (budgetId: string, filter: JournalQuery = {}) =>
      get<JournalResponse>(
        `${base(budgetId)}/journal${query({
          ...filter,
          limit: filter.limit === undefined ? undefined : String(filter.limit),
        })}`,
      ),
    getPlansCalendar: (budgetId: string, month: string) =>
      get<PlansCalendarResponse>(`${base(budgetId)}/plans/calendar${query({ month })}`),
    getTransaction: (budgetId: string, transactionId: string) =>
      get<TransactionJournalV2Item>(
        `${base(budgetId)}/transactions/${encodeURIComponent(transactionId)}`,
      ),
    updateTransaction: (
      budgetId: string,
      transactionId: string,
      input: UpdateTransactionV2Request,
      idempotencyKey: string,
    ) =>
      patchKeyed<TransactionV2LifecycleResponse>(
        `${base(budgetId)}/transactions/${encodeURIComponent(transactionId)}`,
        input,
        idempotencyKey,
      ),
    deleteTransaction: (budgetId: string, transactionId: string, idempotencyKey: string) =>
      api.request<TransactionV2LifecycleResponse>(
        `${base(budgetId)}/transactions/${encodeURIComponent(transactionId)}`,
        { method: 'DELETE', headers: { 'Idempotency-Key': idempotencyKey } },
      ),
    restoreTransaction: (budgetId: string, transactionId: string, idempotencyKey: string) =>
      postKeyed<TransactionV2LifecycleResponse>(
        `${base(budgetId)}/transactions/${encodeURIComponent(transactionId)}/restore`,
        {},
        idempotencyKey,
      ),
    createTransfer: (
      budgetId: string,
      input: CreateDirectTransferRequest,
      idempotencyKey: string,
    ) => postKeyed<DirectTransferResponse>(`${base(budgetId)}/transfers`, input, idempotencyKey),
    updateTransfer: (
      budgetId: string,
      transferId: string,
      input: UpdateDirectTransferRequest,
      idempotencyKey: string,
    ) =>
      patchKeyed<TransferJournalItem>(
        `${base(budgetId)}/transfers/${encodeURIComponent(transferId)}`,
        input,
        idempotencyKey,
      ),
    deleteTransfer: (budgetId: string, transferId: string, idempotencyKey: string) =>
      api.request<TransferJournalItem>(
        `${base(budgetId)}/transfers/${encodeURIComponent(transferId)}`,
        { method: 'DELETE', headers: { 'Idempotency-Key': idempotencyKey } },
      ),
    restoreTransfer: (budgetId: string, transferId: string, idempotencyKey: string) =>
      postKeyed<TransferJournalItem>(
        `${base(budgetId)}/transfers/${encodeURIComponent(transferId)}/restore`,
        {},
        idempotencyKey,
      ),
    listObligationPlans: (budgetId: string, status?: PlanListStatus) =>
      get<{ items: ObligationPlanResponse[] }>(
        `${base(budgetId)}/obligations/plans${query({ status })}`,
      ),
    createObligationPlan: (budgetId: string, input: CreatePlanRequest, idempotencyKey: string) =>
      postKeyed<ObligationPlanCreateResponse>(
        `${base(budgetId)}/obligations/plans`,
        input,
        idempotencyKey,
      ),
    payOneTimeObligation: (
      budgetId: string,
      input: OneTimeObligationPayRequest,
      idempotencyKey: string,
    ) =>
      postKeyed<OneTimeObligationPayResponse>(
        `${base(budgetId)}/obligations/one-time-pay`,
        input,
        idempotencyKey,
      ),
    listIncomePlans: (budgetId: string, status?: PlanListStatus) =>
      get<{ items: PlanResponse[] }>(`${base(budgetId)}/income-plans${query({ status })}`),
    createIncomePlan: (budgetId: string, input: CreatePlanRequest, idempotencyKey: string) =>
      postKeyed<PlanCreateResponse>(`${base(budgetId)}/income-plans`, input, idempotencyKey),
    updateObligationPlan: (
      budgetId: string,
      planId: string,
      input: UpdatePlanRequest,
      idempotencyKey: string,
    ) =>
      patchKeyed<UpdatePlanResponse>(
        `${base(budgetId)}/obligations/plans/${encodeURIComponent(planId)}`,
        input,
        idempotencyKey,
      ),
    updateIncomePlan: (
      budgetId: string,
      planId: string,
      input: UpdatePlanRequest,
      idempotencyKey: string,
    ) =>
      patchKeyed<UpdatePlanResponse>(
        `${base(budgetId)}/income-plans/${encodeURIComponent(planId)}`,
        input,
        idempotencyKey,
      ),
    recordIncomeOccurrence: (
      budgetId: string,
      occurrenceId: string,
      input: RecordIncomeOccurrenceRequest,
      idempotencyKey: string,
    ) =>
      postKeyed<RecordIncomeOccurrenceResponse>(
        `${base(budgetId)}/income-plans/occurrences/${encodeURIComponent(occurrenceId)}/record`,
        input,
        idempotencyKey,
      ),
    listIncomeOccurrences: (budgetId: string, filter: OccurrenceListQuery = {}) =>
      get<{ items: IncomeOccurrenceItem[] }>(
        `${base(budgetId)}/income-plans/occurrences${query({ ...filter })}`,
      ),
  };
}
