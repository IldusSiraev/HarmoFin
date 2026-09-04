import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import FinanceMoney from './FinanceMoney.vue';
import FinanceMoneyInput from './FinanceMoneyInput.vue';

describe('FinanceMoney', () => {
  it('renders server minor units and hides an invalid value', () => {
    const valid = mount(FinanceMoney, {
      props: { minorUnits: '9007199254740993', currency: 'RUB', scale: 2 },
    });
    const invalid = mount(FinanceMoney, {
      props: { minorUnits: 'not-a-money-value', currency: 'RUB', scale: 2 },
    });

    expect(valid.text()).toContain('90');
    expect(invalid.text()).toBe('—');
    expect(invalid.text()).not.toContain('not-a-money-value');
  });
});

describe('FinanceMoneyInput', () => {
  it('uses decimal input mode and forwards decimal text without parsing', async () => {
    const wrapper = mount(FinanceMoneyInput, {
      props: { modelValue: '', name: 'startingBalance', label: 'Начальный баланс' },
    });
    const input = wrapper.get('input');

    await input.setValue('1 234,50');

    expect(input.attributes('inputmode')).toBe('decimal');
    expect(wrapper.emitted('update:modelValue')).toEqual([['1 234,50']]);
  });
});
