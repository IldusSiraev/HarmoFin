import { describe, expect, it } from 'vitest';

import { escapeHtml, formatMinor, pluralRu } from './format.js';

describe('formatMinor', () => {
  it('formats minor units without floating point', () => {
    expect(formatMinor(123_456n, 'RUB')).toMatch(/^1\s234,56\s₽$/u);
    expect(formatMinor(5n, 'RUB')).toMatch(/^0,05\s₽$/u);
    expect(formatMinor(900_719_925_474_099_312n, 'RUB')).toMatch(/,12\s₽$/u);
  });

  it('keeps an unknown currency code as is', () => {
    expect(formatMinor(100n, 'USD')).toMatch(/^1,00\sUSD$/u);
  });
});

describe('pluralRu', () => {
  it.each([
    [1, 'операция'],
    [2, 'операции'],
    [5, 'операций'],
    [11, 'операций'],
    [21, 'операция'],
    [22, 'операции'],
    [112, 'операций'],
  ])('%i → %s', (count, expected) => {
    expect(pluralRu(count, 'операция', 'операции', 'операций')).toBe(expected);
  });
});

describe('escapeHtml', () => {
  it('escapes markup characters', () => {
    expect(escapeHtml(`<b a="1">'&'</b>`)).toBe('&lt;b a=&quot;1&quot;&gt;&#39;&amp;&#39;&lt;/b&gt;');
  });
});
