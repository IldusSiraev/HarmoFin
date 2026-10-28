import type { ProblemDetails } from '../../composables/useApiClient.js';
import type {
  PersonRef,
  PlanRecurrenceV2,
  PlanResponse,
  UpdatePlanRequest,
  UpdatePlanResponse,
} from '../../composables/useEnvelopePlanV2.js';
import { normalizeDecimal } from '../../composables/useOperationForm.js';
import { PLAN_AMOUNT_ERROR, type PlanKind } from './plan-form.js';

// Pure form logic for editing a plan. The amount is validated by pattern and
// sent as text; the browser never does arithmetic on money.

export interface PlanCatalogEntry {
  kind: PlanKind;
  id: string;
  name: string;
  amountMinor: string;
  recurrence: PlanRecurrenceV2;
  intervalMonths: number | null;
  scheduledOn: string;
  active: boolean;
  /** Владелец плана; действия показывает только canEdit. */
  owner: PersonRef;
  canEdit: boolean;
}

export interface PlanEditModel {
  name: string;
  amount: string;
  applyToCurrentOpen: boolean;
}

export type PlanEditErrors = Partial<Record<'name' | 'amount', string>>;

const AMOUNT_PATTERN = /^\d+(?:\.\d{1,2})?$/;
const NAME_MAX = 120;

/** "4000000" -> "40000.00" by string operations; '' when the input is not minor units. */
export function minorToDecimalText(minor: string): string {
  if (!/^\d+$/.test(minor)) return '';
  const padded = minor.padStart(3, '0');
  const cut = padded.length - 2;
  return `${padded.slice(0, cut).replace(/^0+(?=\d)/, '')}.${padded.slice(cut)}`;
}

/** "40 000,5" -> "40000.50"; null when the text is not an amount with at most two decimals. */
export function normalizeAmountText(text: string): string | null {
  const value = normalizeDecimal(text);
  if (!AMOUNT_PATTERN.test(value)) return null;
  const [whole = '', fraction = ''] = value.split('.');
  return `${whole.replace(/^0+(?=\d)/, '')}.${fraction.padEnd(2, '0')}`;
}

export function createPlanEditModel(entry: PlanCatalogEntry): PlanEditModel {
  return {
    name: entry.name,
    amount: minorToDecimalText(entry.amountMinor),
    applyToCurrentOpen: false,
  };
}

export function isAmountChanged(model: PlanEditModel, entry: PlanCatalogEntry): boolean {
  const typed = normalizeAmountText(model.amount);
  return typed !== null && typed !== minorToDecimalText(entry.amountMinor);
}

export function hasPlanEditChanges(model: PlanEditModel, entry: PlanCatalogEntry): boolean {
  const amountSame = normalizeAmountText(model.amount) === minorToDecimalText(entry.amountMinor);
  return model.name.trim() !== entry.name || !amountSame;
}

export function validatePlanEdit(model: PlanEditModel): PlanEditErrors {
  const errors: PlanEditErrors = {};
  const name = model.name.trim();
  if (name === '') errors.name = 'Укажите название';
  else if (name.length > NAME_MAX) errors.name = 'Название не длиннее 120 символов';
  const amount = normalizeAmountText(model.amount);
  if (amount === null || amount === '0.00') errors.amount = PLAN_AMOUNT_ERROR;
  return errors;
}

/** Only the changed fields; the flag only travels with a changed amount. */
export function buildUpdatePlanRequest(
  model: PlanEditModel,
  entry: PlanCatalogEntry,
): UpdatePlanRequest {
  const request: UpdatePlanRequest = {};
  const name = model.name.trim();
  if (name !== entry.name) request.name = name;
  const amount = normalizeAmountText(model.amount);
  if (amount !== null && amount !== minorToDecimalText(entry.amountMinor)) {
    request.amount = amount;
    if (model.applyToCurrentOpen) request.applyToCurrentOpen = true;
  }
  return request;
}

export function planEditFieldErrors(problem: ProblemDetails): PlanEditErrors {
  const errors: PlanEditErrors = {};
  for (const item of problem.fieldErrors ?? []) {
    if (item.field === 'name' || item.field === 'amount') errors[item.field] = item.message;
  }
  return errors;
}

export function recurrenceLabel(
  recurrence: PlanRecurrenceV2,
  intervalMonths: number | null,
): string {
  switch (recurrence) {
    case 'ONE_TIME':
      return 'Разово';
    case 'MONTHLY':
      return 'Каждый месяц';
    case 'EVERY_N_MONTHS':
      return `Раз в ${intervalMonths ?? '?'} мес.`;
    case 'YEARLY':
      return 'Раз в год';
  }
}

function toEntry(plan: PlanResponse, kind: PlanKind): PlanCatalogEntry {
  return {
    kind,
    id: plan.id,
    name: plan.name,
    amountMinor: plan.amountMinor,
    recurrence: plan.recurrence,
    intervalMonths: plan.intervalMonths,
    scheduledOn: plan.scheduledOn,
    active: plan.status === 'ACTIVE',
    owner: plan.owner,
    canEdit: plan.canEdit,
  };
}

/** Both plan kinds in one list: active plans first, server order otherwise kept. */
export function toCatalogEntries(
  obligations: readonly PlanResponse[],
  incomes: readonly PlanResponse[],
): PlanCatalogEntry[] {
  const all = [
    ...obligations.map((plan) => toEntry(plan, 'obligation')),
    ...incomes.map((plan) => toEntry(plan, 'income')),
  ];
  return [...all.filter((item) => item.active), ...all.filter((item) => !item.active)];
}

export function planUpdateMessage(
  entry: PlanCatalogEntry,
  request: UpdatePlanRequest,
  response: Pick<UpdatePlanResponse, 'updatedOccurrences' | 'cancelledOccurrences'>,
): string {
  const noun = entry.kind === 'obligation' ? 'платежей' : 'поступлений';
  if (request.status === 'ARCHIVED') {
    return response.cancelledOccurrences === 0
      ? `План «${entry.name}» остановлен.`
      : `План «${entry.name}» остановлен. Отменено ${noun}: ${response.cancelledOccurrences}.`;
  }
  if (request.status === 'ACTIVE') return `План «${entry.name}» возобновлён.`;
  const name = request.name ?? entry.name;
  return request.amount === undefined || response.updatedOccurrences === 0
    ? `План «${name}» обновлён.`
    : `План «${name}» обновлён. Изменено ${noun}: ${response.updatedOccurrences}.`;
}
