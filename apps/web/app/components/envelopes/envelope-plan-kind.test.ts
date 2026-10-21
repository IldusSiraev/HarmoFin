import { describe, expect, it } from 'vitest';

import {
  decimalToMinor,
  envelopeTone,
  formatDayMonth,
  periodRangeText,
  planBadge,
  pluralRu,
  planProgress,
} from './envelope-plan-kind.js';
import type { EnvelopePlanDto } from '../../composables/useEnvelopePlanV2.js';

describe('decimalToMinor', () => {
  it.each([
    ['5000', '500000'],
    ['5000.5', '500050'],
    ['5000.00', '500000'],
    ['5000.05', '500005'],
    ['0', '0'],
    ['0.5', '50'],
    ['0.00', '0'],
    ['123456789012345678.99', '12345678901234567899'],
  ])('converts %s to %s without floating point', (input, expected) => {
    expect(decimalToMinor(input)).toBe(expected);
  });

  it.each(['', 'abc', '-1', '1.234', '1,5', ' 5'])('rejects %j', (input) => {
    expect(decimalToMinor(input)).toBeNull();
  });
});

describe('envelopeTone', () => {
  it('сопоставляет тип конверта с тоном', () => {
    expect(envelopeTone('CURRENT_EXPENSES')).toBe('current');
    expect(envelopeTone('MANDATORY_EXPENSES')).toBe('mandatory');
    expect(envelopeTone('SAVINGS_GOAL')).toBe('savings');
    expect(envelopeTone('RESERVE')).toBe('reserve');
    expect(envelopeTone('CUSTOM')).toBe('custom');
    expect(envelopeTone('UNKNOWN')).toBe('custom');
  });
});

describe('periodRangeText', () => {
  it('в одном месяце пишет месяц один раз', () => {
    expect(periodRangeText('2026-10-10', '2026-10-24')).toBe('10–24 октября');
  });

  it('в разных месяцах пишет оба месяца', () => {
    expect(periodRangeText('2026-10-25', '2026-11-09')).toBe('25 октября – 9 ноября');
  });
});

describe('formatDayMonth', () => {
  it('пишет день и месяц без года', () => {
    expect(formatDayMonth('2026-10-24')).toBe('24 октября');
    expect(formatDayMonth('2026-01-01')).toBe('1 января');
  });

  it('возвращает исходную строку для неизвестного формата', () => {
    expect(formatDayMonth('bad')).toBe('bad');
  });
});

describe('planProgress', () => {
  const base = {
    id: 'e',
    name: 'X',
    periodSlot: null,
    targetAmountMinor: null,
    comment: null,
    fundedMinor: '0',
    spentMinor: '0',
    balanceMinor: '0',
    archivedAt: null,
  };

  it('текущие траты: потрачено из отложенного текущего периода', () => {
    const env = {
      ...base,
      envelopeType: 'CURRENT_EXPENSES',
      periods: [
        {
          periodId: 'old',
          startsOn: '2026-09-25',
          endsOn: '2026-10-09',
          fundedMinor: '1',
          spentMinor: '1',
          balanceMinor: '0',
          current: false,
        },
        {
          periodId: 'p',
          startsOn: '2026-10-10',
          endsOn: '2026-10-24',
          fundedMinor: '6500000',
          spentMinor: '3165000',
          balanceMinor: '3335000',
          current: true,
        },
      ],
    } as EnvelopePlanDto;
    expect(planProgress(env, null)).toEqual({
      value: '3165000',
      max: '6500000',
      label: 'Потрачено из отложенного',
      tone: 'current',
    });
  });

  it('обязательные: остаток к ближайшим платежам', () => {
    const env = {
      ...base,
      envelopeType: 'MANDATORY_EXPENSES',
      balanceMinor: '5163531',
    } as EnvelopePlanDto;
    expect(planProgress(env, { balanceMinor: '5163531', dueMinor: '6200000' })).toEqual({
      value: '5163531',
      max: '6200000',
      label: 'Покрыто ближайших платежей',
      tone: 'mandatory',
    });
    expect(planProgress(env, { balanceMinor: '1', dueMinor: '0' })).toBeNull();
  });

  it('цель: остаток к цели (цель в рублях)', () => {
    const env = {
      ...base,
      envelopeType: 'SAVINGS_GOAL',
      balanceMinor: '14850000',
      targetAmountMinor: '280000',
    } as EnvelopePlanDto;
    expect(planProgress(env, null)).toEqual({
      value: '14850000',
      max: '28000000',
      label: 'Цель',
      tone: 'savings',
    });
  });

  it('без цели — нет полосы', () => {
    expect(planProgress({ ...base, envelopeType: 'RESERVE' } as EnvelopePlanDto, null)).toBeNull();
  });
});

describe('planBadge', () => {
  const base = {
    id: 'e',
    name: 'X',
    periodSlot: null,
    targetAmountMinor: null,
    comment: null,
    fundedMinor: '0',
    spentMinor: '0',
    archivedAt: null,
  };

  it('перерасход — danger', () => {
    expect(
      planBadge(
        { ...base, envelopeType: 'CUSTOM', balanceMinor: '-320000' } as EnvelopePlanDto,
        null,
      ),
    ).toEqual({ tone: 'danger', text: expect.stringMatching(/^Перерасход 3\s200,00/) });
  });

  it('обязательные с нехваткой — warning', () => {
    expect(
      planBadge(
        { ...base, envelopeType: 'MANDATORY_EXPENSES', balanceMinor: '100' } as EnvelopePlanDto,
        '1036469',
      ),
    ).toEqual({ tone: 'warning', text: expect.stringMatching(/^Нужно пополнить на 10\s364,69/) });
  });

  it('иначе нет метки', () => {
    expect(
      planBadge(
        { ...base, envelopeType: 'MANDATORY_EXPENSES', balanceMinor: '100' } as EnvelopePlanDto,
        '0',
      ),
    ).toBeNull();
  });
});

describe('pluralRu', () => {
  it.each([
    [1, 'конверт'],
    [2, 'конверта'],
    [5, 'конвертов'],
    [11, 'конвертов'],
    [21, 'конверт'],
    [22, 'конверта'],
    [25, 'конвертов'],
  ])('%i — %s', (n, word) => {
    expect(pluralRu(n, 'конверт', 'конверта', 'конвертов')).toBe(word);
  });
});
