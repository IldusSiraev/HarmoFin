import { type RequestClient, useApiClient } from './useApiClient.js';
import type { PersonRef, ReportV2Key } from './useEnvelopePlanV2.js';

export type ReferenceStatus = 'active' | 'archived' | 'all';
export type AccountType = 'BANK_ACCOUNT' | 'BANK_CARD' | 'CASH';
export type CategoryType = 'INCOME' | 'EXPENSE';
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

export interface ReferenceSummaryDto {
  currency: 'RUB';
  scale: 2;
  totalMinor: string;
  count: number;
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
  owner: PersonRef;
  canEdit: boolean;
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

export type NotificationType =
  | 'PLAN_UPCOMING'
  | 'PLAN_TODAY'
  | 'PLAN_OVERDUE'
  | 'UNALLOCATED_INCOME'
  | 'NEGATIVE_ACCOUNT'
  | 'NEGATIVE_ENVELOPE'
  | 'INSUFFICIENT_MANDATORY_OBLIGATIONS'
  | 'MEMBER_JOINED'
  | 'MEMBER_LEFT'
  | 'MEMBER_REMOVED'
  | 'OBJECTS_TRANSFERRED'
  | 'CALENDAR_REMINDER';

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

export interface PlanVsActualRowDto {
  planId: string;
  planName: string;
  planType: 'INCOME' | 'EXPENSE';
  plannedMinor: string;
  actualMinor: string;
  varianceMinor: string;
  plannedOccurrenceCount: number;
  confirmedOccurrenceCount: number;
  journalFilters?: { planId: string; status: 'CONFIRMED' };
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
  journalFilters?: { envelopeId: string };
}

export interface GoalProgressReportDto {
  key: 'savings-goals';
  rows: GoalProgressRowDto[];
}

export type GenericReportKey = Exclude<ReportV2Key, 'plan-vs-actual' | 'savings-goals'>;

export interface GenericReportDto {
  key: GenericReportKey;
  rows: Array<Record<string, unknown>>;
}

export type ReportDto = GenericReportDto | PlanVsActualReportDto | GoalProgressReportDto;

export interface BudgetReferenceDataApi {
  getBudget(budgetId: string): Promise<BudgetDto>;
  getAccountsSummary(
    budgetId: string,
    status?: ReferenceStatus,
    ownerUserId?: string,
  ): Promise<ReferenceSummaryDto>;
  listAccounts(
    budgetId: string,
    status?: ReferenceStatus,
    ownerUserId?: string,
  ): Promise<AccountDto[]>;
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
  listTransactionAudit(budgetId: string, transactionId: string): Promise<AuditEventDto[]>;
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

  function notificationPath(budgetId: string, notificationId?: string) {
    const path = `${budgetPath(budgetId)}/notifications`;
    return notificationId ? `${path}/${encodeURIComponent(notificationId)}` : path;
  }

  function transactionPath(budgetId: string, transactionId?: string) {
    const path = `${budgetPath(budgetId)}/transactions`;
    return transactionId ? `${path}/${encodeURIComponent(transactionId)}` : path;
  }

  function idempotent(idempotencyKey: string): HeadersInit {
    return { 'Idempotency-Key': idempotencyKey };
  }

  return {
    getBudget: (budgetId) => api.request<BudgetDto>(budgetPath(budgetId)),
    getAccountsSummary: (budgetId, status, ownerUserId) =>
      api.request<ReferenceSummaryDto>(
        withQuery(`${accountPath(budgetId)}/summary`, {
          status,
          ownerUserId,
        }),
      ),
    listAccounts: (budgetId, status, ownerUserId) =>
      api.request<AccountDto[]>(withQuery(accountPath(budgetId), { status, ownerUserId })),
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
    listTransactionAudit: (budgetId, transactionId) =>
      api
        .request<{ items: AuditEventDto[] }>(`${transactionPath(budgetId, transactionId)}/audit`)
        .then((result) => result.items),
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
