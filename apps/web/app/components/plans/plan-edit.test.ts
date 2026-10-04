import { describe, expect, it } from 'vitest';

import {
  buildUpdatePlanRequest,
  createPlanEditModel,
  hasPlanEditChanges,
  isAmountChanged,
  minorToDecimalText,
  normalizeAmountText,
  planEditFieldErrors,
  planUpdateMessage,
  recurrenceLabel,
  toCatalogEntries,
  validatePlanEdit,
  type PlanCatalogEntry,
} from './plan-edit.js';

const AMOUNT_ERROR = 'Введите сумму больше нуля, не более двух знаков после запятой';

function entry(overrides: Partial<PlanCatalogEntry> = {}): PlanCatalogEntry {
  return {
    kind: 'obligation',
    id: 'plan-1',
    name: 'Аренда',
    amountMinor: '4000000',
    recurrence: 'MONTHLY',
    intervalMonths: null,
    scheduledOn: '2026-10-05',
    active: true,
    ...overrides,
  };
}

describe('minorToDecimalText', () => {
  it('formats minor units as decimal text without arithmetic', () => {
    expect(minorToDecimalText('4000000')).toBe('40000.00');
    expect(minorToDecimalText('5')).toBe('0.05');
    expect(minorToDecimalText('0')).toBe('0.00');
    expect(minorToDecimalText('12345')).toBe('123.45');
    expect(minorToDecimalText('abc')).toBe('');
    expect(minorToDecimalText('-5')).toBe('');
  });
});

describe('normalizeAmountText', () => {
  it('normalizes accepted amounts to two decimals', () => {
    expect(normalizeAmountText('40000')).toBe('40000.00');
    expect(normalizeAmountText('40 000,5')).toBe('40000.50');
    expect(normalizeAmountText('0100.5')).toBe('100.50');
    expect(normalizeAmountText('0,05')).toBe('0.05');
  });

  it.each(['', 'abc', '1.234', '-5', '1,2,3'])('rejects %s', (text) => {
    expect(normalizeAmountText(text)).toBeNull();
  });
});

describe('edit model', () => {
  it('starts from the plan values with the checkbox off', () => {
    expect(createPlanEditModel(entry())).toEqual({
      name: 'Аренда',
      amount: '40000.00',
      applyToCurrentOpen: false,
    });
  });

  it('detects a changed amount only when it is valid and different', () => {
    const plan = entry();
    const model = createPlanEditModel(plan);
    expect(isAmountChanged(model, plan)).toBe(false);
    expect(isAmountChanged({ ...model, amount: '40 000' }, plan)).toBe(false);
    expect(isAmountChanged({ ...model, amount: '50000' }, plan)).toBe(true);
    expect(isAmountChanged({ ...model, amount: 'abc' }, plan)).toBe(false);
  });

  it('reports changes in name or amount text, including an invalid amount', () => {
    const plan = entry();
    const model = createPlanEditModel(plan);
    expect(hasPlanEditChanges(model, plan)).toBe(false);
    expect(hasPlanEditChanges({ ...model, name: ' Аренда ' }, plan)).toBe(false);
    expect(hasPlanEditChanges({ ...model, name: 'Квартира' }, plan)).toBe(true);
    expect(hasPlanEditChanges({ ...model, amount: '50000' }, plan)).toBe(true);
    expect(hasPlanEditChanges({ ...model, amount: 'abc' }, plan)).toBe(true);
  });
});

describe('validatePlanEdit', () => {
  const model = { name: 'Аренда', amount: '100', applyToCurrentOpen: false };

  it('accepts a valid model', () => {
    expect(validatePlanEdit(model)).toEqual({});
  });

  it('requires a trimmed name up to 120 characters', () => {
    expect(validatePlanEdit({ ...model, name: '   ' }).name).toBe('Укажите название');
    expect(validatePlanEdit({ ...model, name: 'а'.repeat(121) }).name).toBe(
      'Название не длиннее 120 символов',
    );
    expect(validatePlanEdit({ ...model, name: ` ${'а'.repeat(120)} ` }).name).toBeUndefined();
  });

  it.each(['', '0', '0,00', 'abc', '1.234'])('rejects amount %s', (amount) => {
    expect(validatePlanEdit({ ...model, amount }).amount).toBe(AMOUNT_ERROR);
  });
});

describe('buildUpdatePlanRequest', () => {
  it('sends only the changed name', () => {
    const plan = entry();
    const model = { ...createPlanEditModel(plan), name: ' Квартира ' };
    expect(buildUpdatePlanRequest(model, plan)).toEqual({ name: 'Квартира' });
  });

  it('sends the amount as two-decimal text and the flag only with a changed amount', () => {
    const plan = entry();
    const model = { ...createPlanEditModel(plan), amount: '50000,5', applyToCurrentOpen: true };
    expect(buildUpdatePlanRequest(model, plan)).toEqual({
      amount: '50000.50',
      applyToCurrentOpen: true,
    });
    expect(buildUpdatePlanRequest({ ...model, applyToCurrentOpen: false }, plan)).toEqual({
      amount: '50000.50',
    });
  });

  it('drops the flag when the amount is unchanged', () => {
    const plan = entry();
    const model = { ...createPlanEditModel(plan), name: 'Квартира', applyToCurrentOpen: true };
    expect(buildUpdatePlanRequest(model, plan)).toEqual({ name: 'Квартира' });
  });
});

describe('planEditFieldErrors', () => {
  it('maps server field errors to name and amount', () => {
    expect(
      planEditFieldErrors({
        code: 'VALIDATION_FAILED',
        detail: 'bad',
        fieldErrors: [
          { field: 'amount', message: 'Сумма неверна', code: 'x' },
          { field: 'name', message: 'Название занято', code: 'x' },
          { field: 'other', message: 'Что-то', code: 'x' },
        ],
      }),
    ).toEqual({ amount: 'Сумма неверна', name: 'Название занято' });
    expect(planEditFieldErrors({ code: 'X', detail: 'd' })).toEqual({});
  });
});

describe('recurrenceLabel', () => {
  it('describes each recurrence in words', () => {
    expect(recurrenceLabel('ONE_TIME', null)).toBe('Разово');
    expect(recurrenceLabel('MONTHLY', null)).toBe('Каждый месяц');
    expect(recurrenceLabel('EVERY_N_MONTHS', 3)).toBe('Раз в 3 мес.');
    expect(recurrenceLabel('YEARLY', null)).toBe('Раз в год');
  });
});

describe('toCatalogEntries', () => {
  const plan = (id: string, status: string, planType: string) => ({
    id,
    planType,
    name: id,
    amountMinor: '100',
    recurrence: 'MONTHLY' as const,
    intervalMonths: null,
    scheduledOn: '2026-10-05',
    endOn: null,
    categoryId: 'c',
    comment: null,
    status,
  });

  it('merges both kinds, active plans first, order otherwise kept', () => {
    const entries = toCatalogEntries(
      [plan('o-stopped', 'ARCHIVED', 'EXPENSE'), plan('o-active', 'ACTIVE', 'EXPENSE')],
      [plan('i-active', 'ACTIVE', 'INCOME')],
    );
    expect(entries.map((item) => [item.kind, item.id, item.active])).toEqual([
      ['obligation', 'o-active', true],
      ['income', 'i-active', true],
      ['obligation', 'o-stopped', false],
    ]);
    expect(entries[0]).toMatchObject({ amountMinor: '100', recurrence: 'MONTHLY' });
  });
});

describe('planUpdateMessage', () => {
  const counts = { updatedOccurrences: 3, cancelledOccurrences: 2 };

  it('reports the changed payments only when the amount changed', () => {
    expect(planUpdateMessage(entry(), { name: 'Квартира' }, counts)).toBe(
      'План «Квартира» обновлён.',
    );
    expect(planUpdateMessage(entry(), { amount: '50000.00' }, counts)).toBe(
      'План «Аренда» обновлён. Изменено платежей: 3.',
    );
    expect(
      planUpdateMessage(entry({ kind: 'income', name: 'Зарплата' }), { amount: '1.00' }, counts),
    ).toBe('План «Зарплата» обновлён. Изменено поступлений: 3.');
  });

  it('omits the counter sentence when the counter is 0', () => {
    const zero = { updatedOccurrences: 0, cancelledOccurrences: 0 };
    expect(planUpdateMessage(entry(), { amount: '50000.00' }, zero)).toBe(
      'План «Аренда» обновлён.',
    );
    expect(planUpdateMessage(entry(), { status: 'ARCHIVED' }, zero)).toBe(
      'План «Аренда» остановлен.',
    );
    expect(
      planUpdateMessage(entry({ kind: 'income', name: 'Зарплата' }), { status: 'ARCHIVED' }, zero),
    ).toBe('План «Зарплата» остановлен.');
  });

  it('reports stop and resume', () => {
    expect(planUpdateMessage(entry(), { status: 'ARCHIVED' }, counts)).toBe(
      'План «Аренда» остановлен. Отменено платежей: 2.',
    );
    expect(
      planUpdateMessage(
        entry({ kind: 'income', name: 'Зарплата' }),
        { status: 'ARCHIVED' },
        counts,
      ),
    ).toBe('План «Зарплата» остановлен. Отменено поступлений: 2.');
    expect(planUpdateMessage(entry(), { status: 'ACTIVE' }, counts)).toBe(
      'План «Аренда» возобновлён.',
    );
  });
});
