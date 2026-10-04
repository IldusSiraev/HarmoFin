import type { ProblemDetails } from '../../composables/useApiClient.js';
import type { CreatePlanRequest, PlanRecurrenceV2 } from '../../composables/useEnvelopePlanV2.js';
import { normalizeDecimal } from '../../composables/useOperationForm.js';

// Pure form logic. The amount is validated by pattern and sent as text; the
// browser never does arithmetic on money.

export type PlanKind = 'obligation' | 'income';

export interface PlanFormModel {
  amount: string;
  name: string;
  scheduledOn: string;
  recurrence: PlanRecurrenceV2;
  intervalMonths: string;
  categoryId: string;
  endOn: string;
  comment: string;
}

export type PlanFormField = keyof PlanFormModel;
export type PlanFormErrors = Partial<Record<PlanFormField, string>>;

const AMOUNT_PATTERN = /^\d+(?:\.\d{1,2})?$/;
const ZERO_PATTERN = /^0+(?:\.0+)?$/;
const NAME_MAX = 120;
const COMMENT_MAX = 500;
const INTERVAL_MIN = 2;
const INTERVAL_MAX = 120;

export const PLAN_AMOUNT_ERROR = 'Введите сумму больше нуля, не более двух знаков после запятой';
const INTERVAL_ERROR = 'Укажите интервал от 2 до 120 месяцев';

const FORM_FIELDS: ReadonlyArray<PlanFormField> = [
  'amount',
  'name',
  'scheduledOn',
  'recurrence',
  'intervalMonths',
  'categoryId',
  'endOn',
  'comment',
];

export function createPlanForm(today: string): PlanFormModel {
  return {
    amount: '',
    name: '',
    scheduledOn: today,
    recurrence: 'MONTHLY',
    intervalMonths: '',
    categoryId: '',
    endOn: '',
    comment: '',
  };
}

function isValidAmount(text: string): boolean {
  const value = normalizeDecimal(text);
  return AMOUNT_PATTERN.test(value) && !ZERO_PATTERN.test(value);
}

function isValidInterval(text: string): boolean {
  if (!/^\d+$/.test(text.trim())) return false;
  const value = Number(text.trim());
  return value >= INTERVAL_MIN && value <= INTERVAL_MAX;
}

export function validatePlanForm(model: PlanFormModel): PlanFormErrors {
  const errors: PlanFormErrors = {};
  if (!isValidAmount(model.amount)) errors.amount = PLAN_AMOUNT_ERROR;
  const name = model.name.trim();
  if (name === '') errors.name = 'Укажите название';
  else if (name.length > NAME_MAX) errors.name = 'Название не длиннее 120 символов';
  if (model.scheduledOn === '') errors.scheduledOn = 'Укажите дату';
  if (model.categoryId === '') errors.categoryId = 'Выберите категорию';
  if (model.recurrence === 'EVERY_N_MONTHS' && !isValidInterval(model.intervalMonths)) {
    errors.intervalMonths = INTERVAL_ERROR;
  }
  // ISO dates compare correctly as text; no date arithmetic is needed.
  if (
    model.recurrence !== 'ONE_TIME' &&
    model.endOn !== '' &&
    model.scheduledOn !== '' &&
    model.endOn < model.scheduledOn
  ) {
    errors.endOn = 'Дата окончания не может быть раньше даты начала.';
  }
  if (model.comment.trim().length > COMMENT_MAX) {
    errors.comment = 'Комментарий не длиннее 500 символов';
  }
  return errors;
}

export function buildCreatePlanRequest(model: PlanFormModel): CreatePlanRequest {
  const request: CreatePlanRequest = {
    name: model.name.trim(),
    amount: normalizeDecimal(model.amount),
    scheduledOn: model.scheduledOn,
    categoryId: model.categoryId,
    recurrence: model.recurrence,
  };
  if (model.recurrence === 'EVERY_N_MONTHS') {
    request.intervalMonths = Number(model.intervalMonths.trim());
  }
  if (model.recurrence !== 'ONE_TIME' && model.endOn !== '') request.endOn = model.endOn;
  const comment = model.comment.trim();
  if (comment !== '') request.comment = comment;
  return request;
}

export function fieldErrorsFromProblem(problem: ProblemDetails): {
  fields: PlanFormErrors;
  general?: string;
} {
  const fields: PlanFormErrors = {};
  const unknown: string[] = [];
  for (const item of problem.fieldErrors ?? []) {
    const field = FORM_FIELDS.find((candidate) => candidate === item.field);
    if (field) fields[field] = item.message;
    else unknown.push(item.message);
  }
  return unknown.length > 0 ? { fields, general: unknown.join(' ') } : { fields };
}
