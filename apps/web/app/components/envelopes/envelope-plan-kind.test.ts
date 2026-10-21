import { describe, expect, it } from 'vitest';

import {
  decimalToMinor,
  envelopeTone,
  formatDayMonth,
  periodRangeText,
} from './envelope-plan-kind.js';

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
