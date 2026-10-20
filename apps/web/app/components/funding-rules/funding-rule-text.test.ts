import { describe, expect, it } from 'vitest';

import {
  basisPointsToPercent,
  describeRule,
  percentToBasisPoints,
  ruleTypeOptions,
} from './funding-rule-text.js';

const rule = (envelopeId: string, type: string, extra: Record<string, unknown> = {}) => ({
  id: `r-${envelopeId}`,
  envelopeId,
  type: type as never,
  priority: 0,
  fixedAmountMinor: null,
  percentBasisPoints: null,
  ...extra,
});

describe('funding-rule-text', () => {
  it('переводит проценты и базисные пункты строками', () => {
    expect(basisPointsToPercent(1000)).toBe('10');
    expect(basisPointsToPercent(1250)).toBe('12.5');
    expect(basisPointsToPercent(5)).toBe('0.05');
    expect(percentToBasisPoints('12,5')).toBe(1250);
    expect(percentToBasisPoints('100')).toBe(10_000);
    expect(percentToBasisPoints('100.01')).toBeNull();
    expect(percentToBasisPoints('abc')).toBeNull();
  });

  it('SUM_OF_PLANS доступен только обязательному конверту', () => {
    expect(ruleTypeOptions('MANDATORY_EXPENSES')).toContain('SUM_OF_PLANS');
    expect(ruleTypeOptions('SAVINGS_GOAL')).not.toContain('SUM_OF_PLANS');
    expect(ruleTypeOptions('SAVINGS_GOAL')[0]).toBe('MANUAL');
  });

  it('описывает правило и номер в очереди', () => {
    const rules = [
      rule('m', 'MANUAL'),
      rule('a', 'SUM_OF_PLANS', { priority: 10 }),
      rule('b', 'PERCENT_OF_INCOME', { priority: 20, percentBasisPoints: 1000 }),
      rule('c', 'FIXED_PER_PERIOD', { priority: 30, fixedAmountMinor: '1500000' }),
    ];
    expect(describeRule('b', rules)).toBe('Процент от дохода, 10 % · №2 в очереди');
    expect(describeRule('a', rules)).toBe('Сумма планов обязательных · №1 в очереди');
    expect(describeRule('c', rules)).toMatch(
      /^Фиксированная цель на период, 15\s000,00\s₽ · №3 в очереди$/,
    );
    expect(describeRule('m', rules)).toBe('Вручную');
    expect(describeRule('x', rules)).toBe('Правило не задано');
    expect(describeRule('b', null)).toBeNull();
  });
});
