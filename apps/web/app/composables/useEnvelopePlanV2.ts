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
  lines: Array<{ envelopeId: string; periodId: string | null; suggestedMinor: string }>;
  remainingMinor: string;
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

export interface EnvelopePlanDto {
  id: string;
  name: string;
  envelopeType: string;
  periodSlot: string | null;
  targetAmountMinor: string | null;
  comment: string | null;
  fundedMinor: string;
  spentMinor: string;
  balanceMinor: string;
  archivedAt: string | null;
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

// Dashboard

export interface DashboardV2Response {
  planModelVersion: 2;
  period: { start: string; end: string; periodId: string | null };
  horizonEnd: string;
  spendable: { state: 'READY' | 'NEEDS_PERIOD_SETUP'; amountMinor: string | null };
  suggestedTarget: string | null;
  cashMinor: string;
  currentBalanceMinor: string;
  mandatoryBalanceMinor: string;
  mandatoryDueMinor: string;
  otherProtectedMinor: string;
  freeToAssignMinor: string;
  unbackedMinor: string;
  mandatoryGapMinor: string;
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
    actionPath: string;
  }>;
  onboarding: {
    categoriesSeeded: boolean;
    hasAccounts: boolean;
    needsOpeningAssignment: boolean;
    needsPeriodSetup: boolean;
    hasMandatoryPlans: boolean;
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
  mode: 'LEGACY_PARTS' | 'ACCOUNT_ONLY';
  totalMinor: string;
  comment: string | null;
  occurredOn: string;
  sourceAccountId: string | null;
  destinationAccountId: string | null;
  parts?: Array<{
    id: string;
    amountMinor: string;
    sourceEnvelopeId: string;
    destinationEnvelopeId: string | null;
  }>;
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

function query(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined) search.set(name, value);
  }
  const text = search.toString();
  return text === '' ? '' : `?${text}`;
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

  return {
    getDashboard: (budgetId: string, asOf?: string) =>
      get<DashboardV2Response>(`${base(budgetId)}/dashboard${query({ asOf })}`),
    previewFunding: (budgetId: string, input: FundingPreviewRequest) =>
      post<FundingPreviewResponse>(`${base(budgetId)}/funding/preview`, input),
    confirmFunding: (budgetId: string, input: FundingConfirmRequest, idempotencyKey: string) =>
      postKeyed<FundingConfirmResponse>(`${base(budgetId)}/funding/confirm`, input, idempotencyKey),
    assignFree: (budgetId: string, input: AssignFreeRequest, idempotencyKey: string) =>
      postKeyed<EnvelopePlanDto>(
        `${base(budgetId)}/assignments`,
        { ...input, sourceKind: 'FREE' },
        idempotencyKey,
      ),
    move: (budgetId: string, input: MoveEnvelopeRequest, idempotencyKey: string) =>
      postKeyed<EnvelopePlanDto>(`${base(budgetId)}/movements`, input, idempotencyKey),
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
    createTransfer: (
      budgetId: string,
      input: CreateDirectTransferRequest,
      idempotencyKey: string,
    ) => postKeyed<DirectTransferResponse>(`${base(budgetId)}/transfers`, input, idempotencyKey),
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
