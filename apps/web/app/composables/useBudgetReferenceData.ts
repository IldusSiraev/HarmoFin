import { useApiClient } from './useApiClient.js';

export type ReferenceStatus = 'active' | 'archived' | 'all';
export type AccountType = 'BANK_ACCOUNT' | 'BANK_CARD' | 'CASH';
export type CategoryType = 'INCOME' | 'EXPENSE';
export type EnvelopeType =
  | 'CURRENT_EXPENSES'
  | 'MANDATORY_EXPENSES'
  | 'SAVINGS_GOAL'
  | 'RESERVE'
  | 'FREE_MONEY'
  | 'CUSTOM';

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
  archivedAt: string | null;
}

export interface CreateCategoryInput {
  name: string;
  categoryType: CategoryType;
  parentId?: string | null | undefined;
  displayOrder: number;
  comment?: string | null | undefined;
}

export interface UpdateCategoryInput {
  name?: string | undefined;
  parentId?: string | null | undefined;
  displayOrder?: number | undefined;
  comment?: string | null | undefined;
}

export interface EnvelopeDto {
  id: string;
  budgetId: string;
  templateKey: string | null;
  name: string;
  envelopeType: EnvelopeType;
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
  startingBalance?: string | undefined;
  monthlyPlannedAmount?: string | null | undefined;
  targetAmount?: string | null | undefined;
  targetDate?: string | null | undefined;
  displayOrder?: number | undefined;
  comment?: string | null | undefined;
}

export interface BudgetReferenceDataApi {
  getBudget(budgetId: string): Promise<BudgetDto>;
  updateBudget(budgetId: string, input: UpdateBudgetInput): Promise<BudgetDto>;
  initializeTemplate(budgetId: string): Promise<ReferenceTemplateResult>;
  listAccounts(budgetId: string, status?: ReferenceStatus): Promise<AccountDto[]>;
  getAccount(budgetId: string, accountId: string): Promise<AccountDto>;
  createAccount(budgetId: string, input: CreateAccountInput): Promise<AccountDto>;
  updateAccount(budgetId: string, accountId: string, input: UpdateAccountInput): Promise<AccountDto>;
  archiveAccount(budgetId: string, accountId: string): Promise<AccountDto>;
  listCategories(
    budgetId: string,
    type?: CategoryType,
    status?: ReferenceStatus,
  ): Promise<CategoryDto[]>;
  getCategory(budgetId: string, categoryId: string): Promise<CategoryDto>;
  createCategory(budgetId: string, input: CreateCategoryInput): Promise<CategoryDto>;
  updateCategory(budgetId: string, categoryId: string, input: UpdateCategoryInput): Promise<CategoryDto>;
  archiveCategory(budgetId: string, categoryId: string): Promise<CategoryDto>;
  listEnvelopes(budgetId: string, status?: ReferenceStatus): Promise<EnvelopeDto[]>;
  getEnvelope(budgetId: string, envelopeId: string): Promise<EnvelopeDto>;
  createEnvelope(budgetId: string, input: CreateEnvelopeInput): Promise<EnvelopeDto>;
  updateEnvelope(budgetId: string, envelopeId: string, input: UpdateEnvelopeInput): Promise<EnvelopeDto>;
  archiveEnvelope(budgetId: string, envelopeId: string): Promise<EnvelopeDto>;
}

type RequestClient = {
  request<T>(path: string, options?: RequestInit): Promise<T>;
};

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

  return {
    getBudget: (budgetId) => api.request<BudgetDto>(budgetPath(budgetId)),
    updateBudget: (budgetId, input) =>
      api.request<BudgetDto>(budgetPath(budgetId), { method: 'PATCH', body: JSON.stringify(input) }),
    initializeTemplate: (budgetId) =>
      api.request<ReferenceTemplateResult>(`${budgetPath(budgetId)}/reference-template`, {
        method: 'POST',
      }),
    listAccounts: (budgetId, status) =>
      api.request<AccountDto[]>(withQuery(accountPath(budgetId), { status })),
    getAccount: (budgetId, accountId) => api.request<AccountDto>(accountPath(budgetId, accountId)),
    createAccount: (budgetId, input) =>
      api.request<AccountDto>(accountPath(budgetId), { method: 'POST', body: JSON.stringify(input) }),
    updateAccount: (budgetId, accountId, input) =>
      api.request<AccountDto>(accountPath(budgetId, accountId), {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    archiveAccount: (budgetId, accountId) =>
      api.request<AccountDto>(`${accountPath(budgetId, accountId)}/archive`, { method: 'POST' }),
    listCategories: (budgetId, type, status) =>
      api.request<CategoryDto[]>(withQuery(categoryPath(budgetId), { type, status })),
    getCategory: (budgetId, categoryId) => api.request<CategoryDto>(categoryPath(budgetId, categoryId)),
    createCategory: (budgetId, input) =>
      api.request<CategoryDto>(categoryPath(budgetId), { method: 'POST', body: JSON.stringify(input) }),
    updateCategory: (budgetId, categoryId, input) =>
      api.request<CategoryDto>(categoryPath(budgetId, categoryId), {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    archiveCategory: (budgetId, categoryId) =>
      api.request<CategoryDto>(`${categoryPath(budgetId, categoryId)}/archive`, { method: 'POST' }),
    listEnvelopes: (budgetId, status) =>
      api.request<EnvelopeDto[]>(withQuery(envelopePath(budgetId), { status })),
    getEnvelope: (budgetId, envelopeId) => api.request<EnvelopeDto>(envelopePath(budgetId, envelopeId)),
    createEnvelope: (budgetId, input) =>
      api.request<EnvelopeDto>(envelopePath(budgetId), { method: 'POST', body: JSON.stringify(input) }),
    updateEnvelope: (budgetId, envelopeId, input) =>
      api.request<EnvelopeDto>(envelopePath(budgetId, envelopeId), {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    archiveEnvelope: (budgetId, envelopeId) =>
      api.request<EnvelopeDto>(`${envelopePath(budgetId, envelopeId)}/archive`, { method: 'POST' }),
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
