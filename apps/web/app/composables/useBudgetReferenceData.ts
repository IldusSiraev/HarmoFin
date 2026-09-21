import { type RequestClient, useApiClient } from './useApiClient.js';

export type ReferenceStatus = 'active' | 'archived' | 'all';
export type AccountType = 'BANK_ACCOUNT' | 'BANK_CARD' | 'CASH';
export type CategoryType = 'INCOME' | 'EXPENSE';
export type EnvelopeType =
  'CURRENT_EXPENSES' | 'MANDATORY_EXPENSES' | 'SAVINGS_GOAL' | 'RESERVE' | 'FREE_MONEY' | 'CUSTOM';
export type PeriodSlot = 'FIRST' | 'SECOND';

export interface BudgetDto {
  id: string;
  workspaceId: string;
  name: string;
  primaryCurrency: string;
  timezone: string;
  cycleStartDay: number;
  periodBoundaryOffset: number;
  allowNegativeBalance: boolean;
  incomeAllocationRuleEnabled: boolean;
  incomeAllocationSourceCategoryId: string | null;
  incomeAllocationTargetEnvelopeId: string | null;
  status: 'ACTIVE' | 'ARCHIVED';
}

export interface UpdateBudgetInput {
  name?: string | undefined;
  timezone?: string | undefined;
  cycleStartDay?: number | undefined;
  periodBoundaryOffset?: number | undefined;
  allowNegativeBalance?: boolean | undefined;
  incomeAllocationRuleEnabled?: boolean | undefined;
  incomeAllocationSourceCategoryId?: string | undefined;
  incomeAllocationTargetEnvelopeId?: string | undefined;
}

export interface ReferenceTemplateResult {
  createdCategoryKeys: string[];
  existingCategoryKeys: string[];
  createdEnvelopeKeys: string[];
  existingEnvelopeKeys: string[];
}

export interface ReferenceSummaryDto {
  currency: 'RUB';
  scale: 2;
  totalMinor: string;
  count: number;
}

export interface EnvelopeSummaryGroupDto {
  envelopeType: EnvelopeType;
  totalMinor: string;
  count: number;
}

export interface EnvelopeSummaryDto extends ReferenceSummaryDto {
  byType: EnvelopeSummaryGroupDto[];
}

export interface AccountDto {
  id: string;
  budgetId: string;
  name: string;
  accountType: AccountType;
  bankName: string | null;
  lastFourDigits: string | null;
  currency: 'RUB';
  scale: 2;
  startingBalanceMinor: string;
  currentBalanceMinor: string;
  accountingStartDate: string;
  comment: string | null;
  archivedAt: string | null;
}

export interface CreateAccountInput {
  name: string;
  accountType: AccountType;
  bankName?: string | null | undefined;
  lastFourDigits?: string | null | undefined;
  currency: 'RUB';
  startingBalance: string;
  accountingStartDate: string;
  comment?: string | null | undefined;
}

export interface UpdateAccountInput {
  name?: string | undefined;
  accountType?: AccountType | undefined;
  bankName?: string | null | undefined;
  lastFourDigits?: string | null | undefined;
  startingBalance?: string | undefined;
  accountingStartDate?: string | undefined;
  comment?: string | null | undefined;
}

export interface CategoryDto {
  id: string;
  budgetId: string;
  templateKey: string | null;
  name: string;
  categoryType: CategoryType;
  parentId: string | null;
  displayOrder: number;
  comment: string | null;
  icon: string | null;
  archivedAt: string | null;
}

// Categories with children are groups: pickers for actual money movement (operations, plans)
// must only offer leaves, while group categories stay visible in the category list and reports.
export function selectableCategories<T extends Pick<CategoryDto, 'id' | 'parentId'>>(
  categories: readonly T[],
  from: readonly Pick<CategoryDto, 'id' | 'parentId'>[] = categories,
): T[] {
  const parentIds = new Set(
    from.flatMap((category) => (category.parentId ? [category.parentId] : [])),
  );
  return categories.filter((category) => !parentIds.has(category.id));
}

export interface CreateCategoryInput {
  name: string;
  categoryType: CategoryType;
  parentId?: string | null | undefined;
  displayOrder: number;
  comment?: string | null | undefined;
  icon?: string | null | undefined;
}

export interface UpdateCategoryInput {
  name?: string | undefined;
  parentId?: string | null | undefined;
  displayOrder?: number | undefined;
  comment?: string | null | undefined;
  icon?: string | null | undefined;
}

export interface EnvelopeDto {
  id: string;
  budgetId: string;
  templateKey: string | null;
  name: string;
  envelopeType: EnvelopeType;
  periodSlot: PeriodSlot | null;
  currency: 'RUB';
  scale: 2;
  startingBalanceMinor: string;
  currentBalanceMinor: string;
  monthlyPlannedAmountMinor: string | null;
  targetAmountMinor: string | null;
  targetDate: string | null;
  displayOrder: number;
  comment: string | null;
  archivedAt: string | null;
}

export interface CreateEnvelopeInput {
  name: string;
  envelopeType: EnvelopeType;
  periodSlot?: PeriodSlot | null | undefined;
  currency: 'RUB';
  startingBalance: string;
  monthlyPlannedAmount?: string | null | undefined;
  targetAmount?: string | null | undefined;
  targetDate?: string | null | undefined;
  displayOrder: number;
  comment?: string | null | undefined;
}

export interface UpdateEnvelopeInput {
  name?: string | undefined;
  envelopeType?: EnvelopeType | undefined;
  periodSlot?: PeriodSlot | null | undefined;
  startingBalance?: string | undefined;
  monthlyPlannedAmount?: string | null | undefined;
  targetAmount?: string | null | undefined;
  targetDate?: string | null | undefined;
  displayOrder?: number | undefined;
  comment?: string | null | undefined;
}

export type RegularPlanType = 'INCOME' | 'EXPENSE' | 'SAVINGS';
export type PlanRecurrence = 'ONE_TIME' | 'MONTHLY' | 'EVERY_N_MONTHS' | 'YEARLY';
export type PlanOccurrenceStatus = 'PENDING' | 'DUE' | 'SKIPPED' | 'COMPLETED' | 'CANCELLED';

export interface RegularPlanDto {
  id: string;
  budgetId: string;
  name: string;
  planType: RegularPlanType;
  amountMinor: string;
  currency: 'RUB';
  scale: 2;
  anchorOn: string;
  startOn: string;
  endOn: string | null;
  recurrence: PlanRecurrence;
  intervalMonths: number | null;
  accountId: string | null;
  categoryId: string | null;
  envelopeId: string | null;
  comment: string | null;
  isActive: boolean;
  disabledAt: string | null;
  deletedAt: string | null;
}

export interface CreateRegularPlanInput {
  name: string;
  planType: RegularPlanType;
  amount: string;
  anchorOn: string;
  startOn: string;
  endOn?: string | null | undefined;
  recurrence: PlanRecurrence;
  intervalMonths?: number | null | undefined;
  accountId?: string | null | undefined;
  categoryId?: string | null | undefined;
  envelopeId?: string | null | undefined;
  comment?: string | null | undefined;
}

export type UpdateRegularPlanInput = Partial<CreateRegularPlanInput> & {
  isActive?: boolean | undefined;
};

export interface PlanOccurrenceDto {
  id: string;
  planId: string;
  planName: string;
  planType: RegularPlanType;
  scheduledOn: string;
  status: PlanOccurrenceStatus;
  amountMinor: string;
  currency: 'RUB';
  scale: 2;
  accountId: string | null;
  categoryId: string | null;
  envelopeId: string | null;
  comment: string | null;
  transactionId: string | null;
  cancellationReason: 'PLAN_CHANGED' | 'PLAN_DISABLED' | 'PLAN_DELETED' | null;
}

export type NotificationType =
  | 'PLAN_UPCOMING'
  | 'PLAN_TODAY'
  | 'PLAN_OVERDUE'
  | 'UNALLOCATED_INCOME'
  | 'NEGATIVE_ACCOUNT'
  | 'NEGATIVE_ENVELOPE'
  | 'INSUFFICIENT_MANDATORY_OBLIGATIONS';

export interface NotificationDto {
  id: string;
  budgetId: string;
  notificationType: NotificationType;
  occurrenceId: string | null;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  title: string;
  body: string;
  actionPath: string | null;
  readAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

export interface NotificationListResult {
  items: NotificationDto[];
  nextCursor: string | null;
}

export type TransactionType = 'INCOME' | 'EXPENSE';
export type TransactionStatus = 'DRAFT' | 'CONFIRMED' | 'CANCELLED' | 'DELETED';

export interface AllocationProposal {
  targetEnvelopeId: string;
  amountMinor: string;
  currency: 'RUB';
  scale: 2;
}

export interface TransactionDto {
  id: string;
  budgetId: string;
  transactionType: TransactionType;
  status: TransactionStatus;
  amountMinor: string;
  currency: 'RUB';
  scale: 2;
  occurredOn: string;
  accountId: string;
  categoryId: string;
  envelopeId: string | null;
  sourceDescription: string | null;
  merchantName: string | null;
  isPlanned: boolean;
  comment: string | null;
  confirmedAt: string | null;
  cancelledAt: string | null;
  deletedAt: string | null;
  accountCurrentBalanceMinor: string;
  envelopeCurrentBalanceMinor: string | null;
  unallocatedMinor: string;
  allocationProposal: AllocationProposal | null;
}

export interface TransactionListInput {
  limit?: number | undefined;
  cursor?: string | undefined;
  search?: string | undefined;
  type?: TransactionType | undefined;
  status?: TransactionStatus | 'all' | undefined;
  from?: string | undefined;
  to?: string | undefined;
  cycleStart?: string | undefined;
  periodStart?: string | undefined;
  accountId?: string | undefined;
  categoryId?: string | undefined;
  envelopeId?: string | undefined;
  planId?: string | undefined;
  sortBy?: 'occurredOn' | 'amount' | undefined;
  sortDirection?: 'asc' | 'desc' | undefined;
}

export interface TransactionListResult {
  items: TransactionDto[];
  nextCursor: string | null;
}

export type TransactionExportInput = Omit<TransactionListInput, 'limit' | 'cursor'>;

export type TransferStatus = 'DRAFT' | 'CONFIRMED' | 'CANCELLED' | 'DELETED';

export interface TransferPartDto {
  id: string;
  transferId: string;
  budgetId: string;
  sourceAccountId: string;
  destinationAccountId: string;
  sourceEnvelopeId: string;
  destinationEnvelopeId: string;
  amountMinor: string;
  comment: string | null;
  sourceAccountCurrentBalanceMinor: string;
  destinationAccountCurrentBalanceMinor: string;
  sourceEnvelopeCurrentBalanceMinor: string;
  destinationEnvelopeCurrentBalanceMinor: string;
}

export interface TransferDto {
  id: string;
  budgetId: string;
  status: TransferStatus;
  totalMinor: string;
  currency: 'RUB';
  scale: 2;
  occurredOn: string;
  comment: string | null;
  confirmedAt: string | null;
  cancelledAt: string | null;
  deletedAt: string | null;
  parts: TransferPartDto[];
}

export interface TransferPartInput {
  sourceEnvelopeId: string;
  destinationEnvelopeId?: string | undefined;
  amount: string;
  comment?: string | null | undefined;
}

export interface CreateTransferInput {
  status: 'DRAFT' | 'CONFIRMED';
  total: string;
  occurredOn: string;
  sourceAccountId: string;
  destinationAccountId: string;
  parts: TransferPartInput[];
  comment?: string | null | undefined;
}

export interface TransferListInput {
  limit?: number | undefined;
  cursor?: string | undefined;
  status?: TransferStatus | undefined;
  from?: string | undefined;
  to?: string | undefined;
  accountId?: string | undefined;
  envelopeId?: string | undefined;
}

export interface TransferListResult {
  items: TransferDto[];
  nextCursor: string | null;
}

export interface CreateTransactionInput {
  transactionType: TransactionType;
  status: 'DRAFT' | 'CONFIRMED';
  amount: string;
  occurredOn: string;
  accountId: string;
  categoryId: string;
  envelopeId?: string | null | undefined;
  sourceDescription?: string | null | undefined;
  merchantName?: string | null | undefined;
  isPlanned: boolean;
  comment?: string | null | undefined;
}

export interface UpdateTransactionInput {
  amount?: string | undefined;
  occurredOn?: string | undefined;
  accountId?: string | undefined;
  categoryId?: string | undefined;
  envelopeId?: string | null | undefined;
  sourceDescription?: string | null | undefined;
  merchantName?: string | null | undefined;
  isPlanned?: boolean | undefined;
  comment?: string | null | undefined;
  confirm?: true | undefined;
}

export interface ResolveIncomeDeletionInput {
  allocationResolution: 'CANCEL' | 'DELETE';
}

export interface IncomeAllocationDto {
  id: string;
  budgetId: string;
  incomeTransactionId: string;
  status: 'CONFIRMED' | 'CANCELLED' | 'DELETED';
  amountMinor: string;
  currency: 'RUB';
  scale: 2;
  occurredOn: string;
  accountId: string;
  envelopeId: string;
  comment: string | null;
  deletedAt: string | null;
  remainingUnallocatedMinor: string;
  envelopeCurrentBalanceMinor: string;
}

export interface AuditEventDto {
  id: string;
  createdAt: string;
  actor: { id: string; displayName: string | null; email: string } | null;
  entityType: string;
  entityId: string | null;
  action: string;
  source: string;
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
}

export interface CreateIncomeAllocationInput {
  amount: string;
  occurredOn: string;
  accountId: string;
  envelopeId: string;
  comment?: string | null | undefined;
}

export type ReportKey =
  | 'expenses-by-category'
  | 'expenses-by-period'
  | 'expenses-by-cycle'
  | 'incomes-by-cycle'
  | 'savings-reallocation-by-cycle'
  | 'net-cash-flow'
  | 'account-balances'
  | 'envelope-balances'
  | 'savings-goals'
  | 'plan-vs-actual';

export type ReportFilters = {
  from?: string | undefined;
  to?: string | undefined;
  accountId?: string | undefined;
  categoryId?: string | undefined;
  envelopeId?: string | undefined;
  type?: TransactionType | undefined;
  currency?: 'RUB' | undefined;
};

export interface PlanVsActualRowDto {
  planId: string;
  planName: string;
  planType: 'INCOME' | 'EXPENSE';
  plannedMinor: string;
  actualMinor: string;
  varianceMinor: string;
  plannedOccurrenceCount: number;
  confirmedOccurrenceCount: number;
  journalFilters: { planId: string; status: 'CONFIRMED' };
}

export interface PlanVsActualReportDto {
  key: 'plan-vs-actual';
  rows: PlanVsActualRowDto[];
}

export interface GoalProgressRowDto {
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
}

export interface GoalProgressReportDto {
  key: 'savings-goals';
  rows: GoalProgressRowDto[];
}

export type GenericReportKey = Exclude<ReportKey, 'plan-vs-actual' | 'savings-goals'>;

export interface GenericReportDto {
  key: GenericReportKey;
  rows: Array<Record<string, unknown>>;
}

export type ReportDto = GenericReportDto | PlanVsActualReportDto | GoalProgressReportDto;

export type DashboardWarning = {
  subject: 'ACCOUNT' | 'ENVELOPE';
  id: string;
  balanceMinor: string;
};

export type DashboardBalance = {
  id: string;
  name: string;
  balanceMinor: string;
};

export type UpcomingObligationDto = {
  occurrenceId: string;
  planName: string;
  scheduledOn: string;
  amountMinor: string;
  currency: 'RUB';
  scale: 2;
  status: 'PENDING' | 'DUE';
  envelopeId: string | null;
  actionPath: string;
};

export type DashboardSummaryDto = {
  cycle: { start: string; end: string };
  period: { id: 'FIRST' | 'SECOND'; start: string; end: string };
  totalAccountMoneyMinor: string;
  accounts: DashboardBalance[];
  envelopes: DashboardBalance[];
  unallocatedIncomeMinor: string;
  unassignedStartingBalanceMinor: string;
  onboarding: {
    categoriesSeeded: boolean;
    cycleConfigured: boolean;
    hasAccounts: boolean;
    hasEnvelopeStartingBalances: boolean;
    hasAllocatedIncome: boolean;
  };
  periodLimit:
    | {
        state: 'available';
        envelopeId: string;
        limitMinor: string;
        spentMinor: string;
        remainingMinor: string;
        daysUntilBoundary: number;
        averageRemainingDailyLimitMinor: string;
      }
    | { state: 'unavailable' };
  warnings: DashboardWarning[];
  upcomingObligations: UpcomingObligationDto[];
};

export interface BudgetReferenceDataApi {
  getReport(budgetId: string, key: ReportKey, filters?: ReportFilters): Promise<ReportDto>;
  getDashboardSummary(budgetId: string): Promise<DashboardSummaryDto>;
  getBudget(budgetId: string): Promise<BudgetDto>;
  updateBudget(budgetId: string, input: UpdateBudgetInput): Promise<BudgetDto>;
  initializeTemplate(budgetId: string): Promise<ReferenceTemplateResult>;
  getAccountsSummary(budgetId: string, status?: ReferenceStatus): Promise<ReferenceSummaryDto>;
  getEnvelopesSummary(budgetId: string, status?: ReferenceStatus): Promise<EnvelopeSummaryDto>;
  listAccounts(budgetId: string, status?: ReferenceStatus): Promise<AccountDto[]>;
  getAccount(budgetId: string, accountId: string): Promise<AccountDto>;
  createAccount(budgetId: string, input: CreateAccountInput): Promise<AccountDto>;
  updateAccount(
    budgetId: string,
    accountId: string,
    input: UpdateAccountInput,
  ): Promise<AccountDto>;
  archiveAccount(budgetId: string, accountId: string): Promise<AccountDto>;
  listCategories(
    budgetId: string,
    type?: CategoryType,
    status?: ReferenceStatus,
    options?: { sort?: 'popular'; limit?: number },
  ): Promise<CategoryDto[]>;
  getCategory(budgetId: string, categoryId: string): Promise<CategoryDto>;
  createCategory(budgetId: string, input: CreateCategoryInput): Promise<CategoryDto>;
  updateCategory(
    budgetId: string,
    categoryId: string,
    input: UpdateCategoryInput,
  ): Promise<CategoryDto>;
  archiveCategory(budgetId: string, categoryId: string): Promise<CategoryDto>;
  listEnvelopes(budgetId: string, status?: ReferenceStatus): Promise<EnvelopeDto[]>;
  getEnvelope(budgetId: string, envelopeId: string): Promise<EnvelopeDto>;
  createEnvelope(budgetId: string, input: CreateEnvelopeInput): Promise<EnvelopeDto>;
  updateEnvelope(
    budgetId: string,
    envelopeId: string,
    input: UpdateEnvelopeInput,
  ): Promise<EnvelopeDto>;
  archiveEnvelope(budgetId: string, envelopeId: string): Promise<EnvelopeDto>;
  listNotifications(
    budgetId: string,
    input?: { state?: 'unread' | 'read' | 'all' | undefined; cursor?: string | undefined },
  ): Promise<NotificationListResult>;
  markNotificationRead(
    budgetId: string,
    notificationId: string,
    idempotencyKey: string,
  ): Promise<NotificationDto>;
  markAllNotificationsRead(
    budgetId: string,
    idempotencyKey: string,
  ): Promise<{ updatedCount: number }>;
  listRegularPlans(
    budgetId: string,
    status?: 'active' | 'inactive' | 'all',
  ): Promise<RegularPlanDto[]>;
  getRegularPlan(budgetId: string, planId: string): Promise<RegularPlanDto>;
  createRegularPlan(
    budgetId: string,
    input: CreateRegularPlanInput,
    idempotencyKey: string,
  ): Promise<RegularPlanDto>;
  updateRegularPlan(
    budgetId: string,
    planId: string,
    input: UpdateRegularPlanInput,
    idempotencyKey: string,
  ): Promise<RegularPlanDto>;
  deleteRegularPlan(
    budgetId: string,
    planId: string,
    idempotencyKey: string,
  ): Promise<RegularPlanDto>;
  listPlanOccurrences(
    budgetId: string,
    input?: { planId?: string | undefined; status?: PlanOccurrenceStatus | undefined },
  ): Promise<PlanOccurrenceDto[]>;
  skipPlanOccurrence(
    budgetId: string,
    occurrenceId: string,
    idempotencyKey: string,
  ): Promise<PlanOccurrenceDto>;
  completePlanOccurrence(
    budgetId: string,
    occurrenceId: string,
    idempotencyKey: string,
  ): Promise<PlanOccurrenceDto>;
  createPlanOccurrenceDraft(
    budgetId: string,
    occurrenceId: string,
    idempotencyKey: string,
  ): Promise<TransactionDto>;
  listTransactions(budgetId: string, input?: TransactionListInput): Promise<TransactionListResult>;
  downloadTransactionsCsv(budgetId: string, input?: TransactionListInput): Promise<Blob>;
  getTransaction(budgetId: string, transactionId: string): Promise<TransactionDto>;
  createTransaction(
    budgetId: string,
    input: CreateTransactionInput,
    idempotencyKey: string,
  ): Promise<TransactionDto>;
  updateTransaction(
    budgetId: string,
    transactionId: string,
    input: UpdateTransactionInput,
    idempotencyKey: string,
  ): Promise<TransactionDto>;
  confirmTransaction(
    budgetId: string,
    transactionId: string,
    idempotencyKey: string,
  ): Promise<TransactionDto>;
  cancelTransaction(
    budgetId: string,
    transactionId: string,
    idempotencyKey: string,
  ): Promise<TransactionDto>;
  deleteTransaction(
    budgetId: string,
    transactionId: string,
    idempotencyKey: string,
  ): Promise<TransactionDto>;
  restoreTransaction(
    budgetId: string,
    transactionId: string,
    idempotencyKey: string,
  ): Promise<TransactionDto>;
  deleteTransactionWithAllocations(
    budgetId: string,
    transactionId: string,
    input: ResolveIncomeDeletionInput,
    idempotencyKey: string,
  ): Promise<TransactionDto>;
  listTransactionAllocations(
    budgetId: string,
    transactionId: string,
  ): Promise<IncomeAllocationDto[]>;
  listTransactionAudit(budgetId: string, transactionId: string): Promise<AuditEventDto[]>;
  listTransfers(budgetId: string, input?: TransferListInput): Promise<TransferListResult>;
  getTransfer(budgetId: string, transferId: string): Promise<TransferDto>;
  createTransfer(
    budgetId: string,
    input: CreateTransferInput,
    idempotencyKey: string,
  ): Promise<TransferDto>;
  confirmTransfer(
    budgetId: string,
    transferId: string,
    idempotencyKey: string,
  ): Promise<TransferDto>;
  cancelTransfer(
    budgetId: string,
    transferId: string,
    idempotencyKey: string,
  ): Promise<TransferDto>;
  deleteTransfer(
    budgetId: string,
    transferId: string,
    idempotencyKey: string,
  ): Promise<TransferDto>;
  createIncomeAllocation(
    budgetId: string,
    transactionId: string,
    input: CreateIncomeAllocationInput,
    idempotencyKey: string,
  ): Promise<IncomeAllocationDto>;
  restoreIncomeAllocation(
    budgetId: string,
    allocationId: string,
    idempotencyKey: string,
  ): Promise<IncomeAllocationDto>;
}

export function createBudgetReferenceData(api: RequestClient): BudgetReferenceDataApi {
  function budgetPath(budgetId: string) {
    return `/api/v1/budgets/${encodeURIComponent(budgetId)}`;
  }

  function accountPath(budgetId: string, accountId?: string) {
    const path = `${budgetPath(budgetId)}/accounts`;
    return accountId ? `${path}/${encodeURIComponent(accountId)}` : path;
  }

  function categoryPath(budgetId: string, categoryId?: string) {
    const path = `${budgetPath(budgetId)}/categories`;
    return categoryId ? `${path}/${encodeURIComponent(categoryId)}` : path;
  }

  function envelopePath(budgetId: string, envelopeId?: string) {
    const path = `${budgetPath(budgetId)}/envelopes`;
    return envelopeId ? `${path}/${encodeURIComponent(envelopeId)}` : path;
  }

  function reportPath(budgetId: string, key: ReportKey) {
    return `${budgetPath(budgetId)}/reports/${encodeURIComponent(key)}`;
  }

  function notificationPath(budgetId: string, notificationId?: string) {
    const path = `${budgetPath(budgetId)}/notifications`;
    return notificationId ? `${path}/${encodeURIComponent(notificationId)}` : path;
  }

  function planPath(budgetId: string, planId?: string) {
    const path = `${budgetPath(budgetId)}/plans`;
    return planId ? `${path}/${encodeURIComponent(planId)}` : path;
  }

  function occurrencePath(budgetId: string, occurrenceId: string) {
    return `${planPath(budgetId)}/occurrences/${encodeURIComponent(occurrenceId)}`;
  }

  function transactionPath(budgetId: string, transactionId?: string) {
    const path = `${budgetPath(budgetId)}/transactions`;
    return transactionId ? `${path}/${encodeURIComponent(transactionId)}` : path;
  }

  function transferPath(budgetId: string, transferId?: string) {
    const path = `${budgetPath(budgetId)}/transfers`;
    return transferId ? `${path}/${encodeURIComponent(transferId)}` : path;
  }

  function allocationPath(budgetId: string, transactionId: string) {
    return `${transactionPath(budgetId, transactionId)}/allocations`;
  }

  function idempotent(idempotencyKey: string): HeadersInit {
    return { 'Idempotency-Key': idempotencyKey };
  }

  return {
    getReport: (budgetId, key, filters = {}) =>
      api.request<ReportDto>(
        withQuery(
          reportPath(budgetId, key),
          Object.fromEntries(
            Object.entries(filters).map(([name, value]) => [
              name,
              value === undefined ? undefined : String(value),
            ]),
          ),
        ),
      ),
    getDashboardSummary: (budgetId) =>
      api.request<DashboardSummaryDto>(`${budgetPath(budgetId)}/summary`),
    getBudget: (budgetId) => api.request<BudgetDto>(budgetPath(budgetId)),
    updateBudget: (budgetId, input) =>
      api.request<BudgetDto>(budgetPath(budgetId), {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    initializeTemplate: (budgetId) =>
      api.request<ReferenceTemplateResult>(`${budgetPath(budgetId)}/reference-template`, {
        method: 'POST',
      }),
    getAccountsSummary: (budgetId, status) =>
      api.request<ReferenceSummaryDto>(withQuery(`${accountPath(budgetId)}/summary`, { status })),
    getEnvelopesSummary: (budgetId, status) =>
      api.request<EnvelopeSummaryDto>(withQuery(`${envelopePath(budgetId)}/summary`, { status })),
    listAccounts: (budgetId, status) =>
      api.request<AccountDto[]>(withQuery(accountPath(budgetId), { status })),
    getAccount: (budgetId, accountId) => api.request<AccountDto>(accountPath(budgetId, accountId)),
    createAccount: (budgetId, input) =>
      api.request<AccountDto>(accountPath(budgetId), {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    updateAccount: (budgetId, accountId, input) =>
      api.request<AccountDto>(accountPath(budgetId, accountId), {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    archiveAccount: (budgetId, accountId) =>
      api.request<AccountDto>(`${accountPath(budgetId, accountId)}/archive`, { method: 'POST' }),
    listCategories: (budgetId, type, status, options) =>
      api.request<CategoryDto[]>(
        withQuery(categoryPath(budgetId), {
          type,
          status,
          sort: options?.sort,
          limit: options?.limit === undefined ? undefined : String(options.limit),
        }),
      ),
    getCategory: (budgetId, categoryId) =>
      api.request<CategoryDto>(categoryPath(budgetId, categoryId)),
    createCategory: (budgetId, input) =>
      api.request<CategoryDto>(categoryPath(budgetId), {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    updateCategory: (budgetId, categoryId, input) =>
      api.request<CategoryDto>(categoryPath(budgetId, categoryId), {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    archiveCategory: (budgetId, categoryId) =>
      api.request<CategoryDto>(`${categoryPath(budgetId, categoryId)}/archive`, { method: 'POST' }),
    listEnvelopes: (budgetId, status) =>
      api.request<EnvelopeDto[]>(withQuery(envelopePath(budgetId), { status })),
    getEnvelope: (budgetId, envelopeId) =>
      api.request<EnvelopeDto>(envelopePath(budgetId, envelopeId)),
    createEnvelope: (budgetId, input) =>
      api.request<EnvelopeDto>(envelopePath(budgetId), {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    updateEnvelope: (budgetId, envelopeId, input) =>
      api.request<EnvelopeDto>(envelopePath(budgetId, envelopeId), {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    archiveEnvelope: (budgetId, envelopeId) =>
      api.request<EnvelopeDto>(`${envelopePath(budgetId, envelopeId)}/archive`, { method: 'POST' }),
    listNotifications: (budgetId, input = {}) =>
      api.request<NotificationListResult>(withQuery(notificationPath(budgetId), input)),
    markNotificationRead: (budgetId, notificationId, idempotencyKey) =>
      api.request<NotificationDto>(`${notificationPath(budgetId, notificationId)}/read`, {
        method: 'POST',
        headers: idempotent(idempotencyKey),
      }),
    markAllNotificationsRead: (budgetId, idempotencyKey) =>
      api.request<{ updatedCount: number }>(`${notificationPath(budgetId)}/read-all`, {
        method: 'POST',
        headers: idempotent(idempotencyKey),
      }),
    listRegularPlans: (budgetId, status) =>
      api
        .request<{ items: RegularPlanDto[] }>(withQuery(planPath(budgetId), { status }))
        .then((result) => result.items),
    getRegularPlan: (budgetId, planId) => api.request<RegularPlanDto>(planPath(budgetId, planId)),
    createRegularPlan: (budgetId, input, idempotencyKey) =>
      api.request<RegularPlanDto>(planPath(budgetId), {
        method: 'POST',
        headers: idempotent(idempotencyKey),
        body: JSON.stringify(input),
      }),
    updateRegularPlan: (budgetId, planId, input, idempotencyKey) =>
      api.request<RegularPlanDto>(planPath(budgetId, planId), {
        method: 'PATCH',
        headers: idempotent(idempotencyKey),
        body: JSON.stringify(input),
      }),
    deleteRegularPlan: (budgetId, planId, idempotencyKey) =>
      api.request<RegularPlanDto>(planPath(budgetId, planId), {
        method: 'DELETE',
        headers: idempotent(idempotencyKey),
      }),
    listPlanOccurrences: (budgetId, input = {}) =>
      api
        .request<{ items: PlanOccurrenceDto[] }>(
          withQuery(`${planPath(budgetId)}/occurrences`, input),
        )
        .then((result) => result.items),
    skipPlanOccurrence: (budgetId, occurrenceId, idempotencyKey) =>
      api.request<PlanOccurrenceDto>(`${occurrencePath(budgetId, occurrenceId)}/skip`, {
        method: 'POST',
        headers: idempotent(idempotencyKey),
      }),
    completePlanOccurrence: (budgetId, occurrenceId, idempotencyKey) =>
      api.request<PlanOccurrenceDto>(`${occurrencePath(budgetId, occurrenceId)}/complete`, {
        method: 'POST',
        headers: idempotent(idempotencyKey),
      }),
    createPlanOccurrenceDraft: (budgetId, occurrenceId, idempotencyKey) =>
      api.request<TransactionDto>(`${occurrencePath(budgetId, occurrenceId)}/create-draft`, {
        method: 'POST',
        headers: idempotent(idempotencyKey),
      }),
    listTransactions: (budgetId, input = {}) =>
      api.request<TransactionListResult>(
        withQuery(
          transactionPath(budgetId),
          Object.fromEntries(
            Object.entries(input).map(([name, value]) => [
              name,
              value === undefined ? undefined : String(value),
            ]),
          ),
        ),
      ),
    downloadTransactionsCsv: (budgetId, input = {}) => {
      const filters = { ...input };
      delete filters.limit;
      delete filters.cursor;
      return api.requestBlob(
        withQuery(
          `${budgetPath(budgetId)}/exports/transactions.csv`,
          Object.fromEntries(
            Object.entries(filters).map(([name, value]) => [
              name,
              value === undefined ? undefined : String(value),
            ]),
          ),
        ),
      );
    },
    getTransaction: (budgetId, transactionId) =>
      api.request<TransactionDto>(transactionPath(budgetId, transactionId)),
    createTransaction: (budgetId, input, idempotencyKey) =>
      api.request<TransactionDto>(transactionPath(budgetId), {
        method: 'POST',
        headers: idempotent(idempotencyKey),
        body: JSON.stringify(input),
      }),
    updateTransaction: (budgetId, transactionId, input, idempotencyKey) =>
      api.request<TransactionDto>(transactionPath(budgetId, transactionId), {
        method: 'PATCH',
        headers: idempotent(idempotencyKey),
        body: JSON.stringify(input),
      }),
    confirmTransaction: (budgetId, transactionId, idempotencyKey) =>
      api.request<TransactionDto>(`${transactionPath(budgetId, transactionId)}/confirm`, {
        method: 'POST',
        headers: idempotent(idempotencyKey),
      }),
    cancelTransaction: (budgetId, transactionId, idempotencyKey) =>
      api.request<TransactionDto>(`${transactionPath(budgetId, transactionId)}/cancel`, {
        method: 'POST',
        headers: idempotent(idempotencyKey),
      }),
    deleteTransaction: (budgetId, transactionId, idempotencyKey) =>
      api.request<TransactionDto>(transactionPath(budgetId, transactionId), {
        method: 'DELETE',
        headers: idempotent(idempotencyKey),
      }),
    restoreTransaction: (budgetId, transactionId, idempotencyKey) =>
      api.request<TransactionDto>(`${transactionPath(budgetId, transactionId)}/restore`, {
        method: 'POST',
        headers: idempotent(idempotencyKey),
      }),
    deleteTransactionWithAllocations: (budgetId, transactionId, input, idempotencyKey) =>
      api.request<TransactionDto>(
        `${transactionPath(budgetId, transactionId)}/delete-with-allocations`,
        {
          method: 'POST',
          headers: idempotent(idempotencyKey),
          body: JSON.stringify(input),
        },
      ),
    listTransactionAllocations: (budgetId, transactionId) =>
      api.request<IncomeAllocationDto[]>(allocationPath(budgetId, transactionId)),
    listTransactionAudit: (budgetId, transactionId) =>
      api
        .request<{ items: AuditEventDto[] }>(`${transactionPath(budgetId, transactionId)}/audit`)
        .then((result) => result.items),
    listTransfers: (budgetId, input = {}) =>
      api.request<TransferListResult>(
        withQuery(
          transferPath(budgetId),
          Object.fromEntries(
            Object.entries(input).map(([name, value]) => [
              name,
              value === undefined ? undefined : String(value),
            ]),
          ),
        ),
      ),
    getTransfer: (budgetId, transferId) =>
      api.request<TransferDto>(transferPath(budgetId, transferId)),
    createTransfer: (budgetId, input, idempotencyKey) =>
      api.request<TransferDto>(transferPath(budgetId), {
        method: 'POST',
        headers: idempotent(idempotencyKey),
        body: JSON.stringify(input),
      }),
    confirmTransfer: (budgetId, transferId, idempotencyKey) =>
      api.request<TransferDto>(`${transferPath(budgetId, transferId)}/confirm`, {
        method: 'POST',
        headers: idempotent(idempotencyKey),
      }),
    cancelTransfer: (budgetId, transferId, idempotencyKey) =>
      api.request<TransferDto>(`${transferPath(budgetId, transferId)}/cancel`, {
        method: 'POST',
        headers: idempotent(idempotencyKey),
      }),
    deleteTransfer: (budgetId, transferId, idempotencyKey) =>
      api.request<TransferDto>(transferPath(budgetId, transferId), {
        method: 'DELETE',
        headers: idempotent(idempotencyKey),
      }),
    createIncomeAllocation: (budgetId, transactionId, input, idempotencyKey) =>
      api.request<IncomeAllocationDto>(allocationPath(budgetId, transactionId), {
        method: 'POST',
        headers: idempotent(idempotencyKey),
        body: JSON.stringify(input),
      }),
    restoreIncomeAllocation: (budgetId, allocationId, idempotencyKey) =>
      api.request<IncomeAllocationDto>(
        `${budgetPath(budgetId)}/allocations/${encodeURIComponent(allocationId)}/restore`,
        { method: 'POST', headers: idempotent(idempotencyKey) },
      ),
  };
}

export function useBudgetReferenceData(): BudgetReferenceDataApi {
  return createBudgetReferenceData(useApiClient());
}

function withQuery(path: string, parameters: Record<string, string | undefined>): string {
  const query = new URLSearchParams();

  for (const [name, value] of Object.entries(parameters)) {
    if (value !== undefined) {
      query.set(name, value);
    }
  }

  const queryString = query.toString();
  return queryString ? `${path}?${queryString}` : path;
}
