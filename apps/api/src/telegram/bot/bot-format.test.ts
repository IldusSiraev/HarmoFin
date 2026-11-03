import { describe, expect, it } from 'vitest';

import {
  amountToMinor,
  escapeHtml,
  formatDay,
  formatRub,
  parseAmount,
  parseDay,
  parseTimeRange,
} from './bot-format.js';

const NBSP = '\u00a0';

describe('parseAmount', () => {
  it('accepts integers and up to two decimals with a comma or a dot', () => {
    expect(parseAmount('1250')).toBe('1250.00');
    expect(parseAmount('1250,5')).toBe('1250.50');
    expect(parseAmount('1250.55')).toBe('1250.55');
    expect(parseAmount('0,01')).toBe('0.01');
  });

  it('ignores spaces, no-break spaces and a trailing ruble sign', () => {
    expect(parseAmount('1 250,50')).toBe('1250.50');
    expect(parseAmount(`12${NBSP}000`)).toBe('12000.00');
    expect(parseAmount('500 ₽')).toBe('500.00');
    expect(parseAmount('500р')).toBe('500.00');
    expect(parseAmount('500 руб.')).toBe('500.00');
  });

  it('drops leading zeros so the API decimal pattern accepts the result', () => {
    expect(parseAmount('007')).toBe('7.00');
  });

  it('rejects zero, negatives, three decimals, words and too many digits', () => {
    expect(parseAmount('0')).toBeNull();
    expect(parseAmount('0,00')).toBeNull();
    expect(parseAmount('-5')).toBeNull();
    expect(parseAmount('1,234')).toBeNull();
    expect(parseAmount('сто')).toBeNull();
    expect(parseAmount('1e5')).toBeNull();
    expect(parseAmount('1234567890123')).toBeNull();
    expect(parseAmount('')).toBeNull();
  });
});

describe('amountToMinor and formatRub', () => {
  it('converts the canonical amount to minor units without floats', () => {
    expect(amountToMinor('1250.50')).toBe(125050n);
    expect(amountToMinor('0.01')).toBe(1n);
  });

  it('formats minor units with groups, kopecks only when present and a minus sign', () => {
    expect(formatRub(125050n)).toBe(`1${NBSP}250,50${NBSP}₽`);
    expect(formatRub('100000')).toBe(`1${NBSP}000${NBSP}₽`);
    expect(formatRub('-5')).toBe(`−0,05${NBSP}₽`);
    expect(formatRub(0n)).toBe(`0${NBSP}₽`);
  });
});

describe('dates and times', () => {
  it('formats a day without the year of today', () => {
    expect(formatDay('2026-11-05', '2026-11-03')).toBe('05.11');
    expect(formatDay('2025-12-31', '2026-11-03')).toBe('31.12.2025');
  });

  it('parses DD.MM with the current year and DD.MM.YYYY', () => {
    expect(parseDay('5.11', '2026-11-03')).toBe('2026-11-05');
    expect(parseDay('05.11.2025', '2026-11-03')).toBe('2025-11-05');
    expect(parseDay(' 1.2 ', '2026-11-03')).toBe('2026-02-01');
  });

  it('rejects impossible dates and other formats', () => {
    expect(parseDay('31.02', '2026-11-03')).toBeNull();
    expect(parseDay('2026-11-05', '2026-11-03')).toBeNull();
    expect(parseDay('завтра', '2026-11-03')).toBeNull();
  });

  it('parses a start time with a one-hour default and an explicit range', () => {
    expect(parseTimeRange('9:30')).toEqual({ startTime: '09:30', endTime: '10:30' });
    expect(parseTimeRange('09.30-11:00')).toEqual({ startTime: '09:30', endTime: '11:00' });
    expect(parseTimeRange('9:30 – 11:00')).toEqual({ startTime: '09:30', endTime: '11:00' });
    expect(parseTimeRange('23:30')).toEqual({ startTime: '23:30', endTime: '23:59' });
  });

  it('rejects broken times and a range that ends before it starts', () => {
    expect(parseTimeRange('25:00')).toBeNull();
    expect(parseTimeRange('9')).toBeNull();
    expect(parseTimeRange('11:00-9:00')).toBeNull();
    expect(parseTimeRange('9:00-10:00-11:00')).toBeNull();
  });
});

describe('escapeHtml', () => {
  it('escapes the characters Telegram HTML cares about', () => {
    expect(escapeHtml(`<b>"Tom" & 'Jerry'</b>`)).toBe(
      '&lt;b&gt;&quot;Tom&quot; &amp; &#39;Jerry&#39;&lt;/b&gt;',
    );
  });
});
