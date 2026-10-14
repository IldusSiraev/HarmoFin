import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import OperationAmountField from './OperationAmountField.vue';

describe('OperationAmountField', () => {
  it('shows the stepper buttons by default', () => {
    const wrapper = mount(OperationAmountField, { props: { modelValue: '10' } });

    expect(wrapper.find('[aria-label="Увеличить сумму"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="Уменьшить сумму"]').exists()).toBe(true);
  });

  it('hides the steppers with hideStepper but keeps input and currency', async () => {
    const wrapper = mount(OperationAmountField, {
      props: { modelValue: '10', hideStepper: true, currencySymbol: '₽' },
    });

    expect(wrapper.find('[aria-label="Увеличить сумму"]').exists()).toBe(false);
    expect(wrapper.find('[aria-label="Уменьшить сумму"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('₽');

    await wrapper.get('input').setValue('25,5');
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['25,5']);
  });
});
