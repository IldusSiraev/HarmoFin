import { describe, expect, it } from 'vitest';

import { ApiRequestError } from '../../composables/useApiClient.js';
import {
  buildCreatePlanRequest,
  createPlanForm,
  fieldErrorsFromProblem,
  validatePlanForm,
  type PlanFormModel,
} from './plan-form.js';

const AMOUNT_ERROR = 'Введите сумму больше нуля, не более двух знаков после запятой';

function valid(overrides: Partial<PlanFormModel> = {}): PlanFormModel {
  return {
    ...createPlanForm('2026-10-04'),
    amount: '100',
    name: 'Аренда',
    categoryId: 'cat-1',
    ...overrides,
  };
}

describe('createPlanForm', () => {
  it('starts monthly on the given date with empty fields', () => {
    expect(createPlanForm('2026-10-04')).toEqual({
      amount: '',
      name: '',
      scheduledOn: '2026-10-04',
      recurrence: 'MONTHLY',
      intervalMonths: '',
      categoryId: '',
      endOn: '',
      comment: '',
    });
  });
});

describe('validatePlanForm', () => {
  it('requires an amount', () => {
    expect(validatePlanForm(valid({ amount: '' })).amount).toBe(AMOUNT_ERROR);
  });

  it.each(['0', '0,00', 'abc', '1.234', '-5'])('rejects amount %s', (amount) => {
    expect(validatePlanForm(valid({ amount })).amount).toBe(AMOUNT_ERROR);
  });

  it.each(['100', '100,5', '100.50', ' 1 000,5 '])('accepts amount %s', (amount) => {
    expect(validatePlanForm(valid({ amount })).amount).toBeUndefined();
  });

  it('requires a trimmed name up to 120 characters', () => {
    expect(validatePlanForm(valid({ name: '   ' })).name).toBe('Укажите название');
    expect(validatePlanForm(valid({ name: 'а'.repeat(121) })).name).toBeDefined();
    expect(validatePlanForm(valid({ name: ` ${'а'.repeat(120)} ` })).name).toBeUndefined();
  });

  it('requires a whole 2-120 interval only for EVERY_N_MONTHS', () => {
    const message = 'Укажите интервал от 2 до 120 месяцев';
    for (const intervalMonths of ['1', '121', '2.5', '']) {
      expect(validatePlanForm(valid({ recurrence: 'EVERY_N_MONTHS', intervalMonths }))).toEqual({
        intervalMonths: message,
      });
    }
    expect(validatePlanForm(valid({ recurrence: 'EVERY_N_MONTHS', intervalMonths: '2' }))).toEqual(
      {},
    );
    expect(validatePlanForm(valid({ recurrence: 'MONTHLY', intervalMonths: '1' }))).toEqual({});
  });

  it('rejects an end date before the start date, except for ONE_TIME', () => {
    const message = 'Дата окончания не может быть раньше даты начала.';
    expect(validatePlanForm(valid({ endOn: '2026-10-03' })).endOn).toBe(message);
    expect(validatePlanForm(valid({ endOn: '2026-10-04' })).endOn).toBeUndefined();
    expect(validatePlanForm(valid({ recurrence: 'ONE_TIME', endOn: '2026-10-03' }))).toEqual({});
  });

  it('requires a category', () => {
    expect(validatePlanForm(valid({ categoryId: '' })).categoryId).toBe('Выберите категорию');
  });

  it('limits the comment to 500 characters', () => {
    expect(validatePlanForm(valid({ comment: 'а'.repeat(501) })).comment).toBeDefined();
    expect(validatePlanForm(valid({ comment: 'а'.repeat(500) })).comment).toBeUndefined();
  });

  it('requires a date', () => {
    expect(validatePlanForm(valid({ scheduledOn: '' })).scheduledOn).toBe('Укажите дату');
  });
});

describe('buildCreatePlanRequest', () => {
  it('omits interval and end date for MONTHLY without them', () => {
    expect(buildCreatePlanRequest(valid())).toEqual({
      name: 'Аренда',
      amount: '100',
      scheduledOn: '2026-10-04',
      categoryId: 'cat-1',
      recurrence: 'MONTHLY',
    });
  });

  it('drops the interval for non-interval recurrences', () => {
    const request = buildCreatePlanRequest(valid({ recurrence: 'YEARLY', intervalMonths: '5' }));
    expect(request).not.toHaveProperty('intervalMonths');
  });

  it('drops endOn for ONE_TIME', () => {
    const request = buildCreatePlanRequest(valid({ recurrence: 'ONE_TIME', endOn: '2027-01-01' }));
    expect(request).not.toHaveProperty('endOn');
  });

  it('sends a numeric interval for EVERY_N_MONTHS', () => {
    const request = buildCreatePlanRequest(
      valid({ recurrence: 'EVERY_N_MONTHS', intervalMonths: '3' }),
    );
    expect(request.intervalMonths).toBe(3);
  });

  it('turns a comma into a dot and trims the name', () => {
    const request = buildCreatePlanRequest(valid({ amount: '100,5', name: '  Аренда  ' }));
    expect(request.amount).toBe('100.5');
    expect(request.name).toBe('Аренда');
  });

  it('includes optional fields only when filled', () => {
    const request = buildCreatePlanRequest(valid({ endOn: '2027-01-01', comment: ' Квартира ' }));
    expect(request.endOn).toBe('2027-01-01');
    expect(request.comment).toBe('Квартира');
    const empty = buildCreatePlanRequest(valid({ comment: '   ' }));
    expect(empty).not.toHaveProperty('comment');
    expect(empty).not.toHaveProperty('endOn');
  });
});

describe('fieldErrorsFromProblem', () => {
  it('maps known server fields and collects unknown ones as a general error', () => {
    const problem = new ApiRequestError(422, {
      code: 'VALIDATION_FAILED',
      detail: 'bad',
      fieldErrors: [
        { field: 'amount', message: 'Сумма неверна', code: 'x' },
        { field: 'recurrence', message: 'Повтор неверен', code: 'x' },
        { field: 'weird', message: 'Что-то', code: 'x' },
      ],
    }).problem;

    expect(fieldErrorsFromProblem(problem)).toEqual({
      fields: { amount: 'Сумма неверна', recurrence: 'Повтор неверен' },
      general: 'Что-то',
    });
  });

  it('returns empty result without field errors', () => {
    expect(fieldErrorsFromProblem({ code: 'X', detail: 'd' })).toEqual({ fields: {} });
  });
});
