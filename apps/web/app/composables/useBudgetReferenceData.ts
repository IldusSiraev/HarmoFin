import { useApiClient } from './useApiClient.js';

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
  type?: TransactionType | undefined;
  status?: TransactionStatus | undefined;
  from?: string | undefined;
  to?: string | undefined;
  accountId?: string | undefined;
  categoryId?: string | undefined;
  envelopeId?: string | undefined;
}

export interface TransactionListResult {
  items: TransactionDto[];
  nextCursor: string | null;
}

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

export interface CreateIncomeAllocationInput {
  amount: string;
  occurredOn: string;
  accountId: string;
  envelopeId: string;
  comment?: string | null | undefined;
}

export interface BudgetReferenceDataApi {
  getBudget(budgetId: string): Promise<BudgetDto>;
  updateBudget(budgetId: string, input: UpdateBudgetInput): Promise<BudgetDto>;
  initializeTemplate(budgetId: string): Promise<ReferenceTemplateResult>;
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
  listTransactions(budgetId: string, input?: TransactionListInput): Promise<TransactionListResult>;
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
    listCategories: (budgetId, type, status) =>
      api.request<CategoryDto[]>(withQuery(categoryPath(budgetId), { type, status })),
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
