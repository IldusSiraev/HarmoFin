import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import IncomeAllocationForm from './IncomeAllocationForm.vue';

describe('IncomeAllocationForm', () => {
  it('shows proposal without creating allocation until accepted', async () => {
    const wrapper = mount(IncomeAllocationForm, {
      props: {
        proposal: {
          targetEnvelopeId: 'envelope-id',
          amountMinor: '1200000',
          currency: 'RUB',
          scale: 2,
        },
        remainingMinor: '1200000',
        currency: 'RUB',
        scale: 2,
        accounts: [{ value: 'account-id', label: 'Счёт' }],
        envelopes: [{ value: 'envelope-id', label: 'Ремонт' }],
      },
    });

    expect(wrapper.text()).toContain('Предложить распределение');
    expect(wrapper.emitted('submit')).toBeUndefined();
    await wrapper.get('[data-action="apply-proposal"]').trigger('click');
    expect(wrapper.emitted('submit')).toHaveLength(1);
  });

  it('normalizes a changed allocation amount before submission', async () => {
    const wrapper = mount(IncomeAllocationForm, {
      props: {
        proposal: {
          targetEnvelopeId: 'envelope-id',
          amountMinor: '1200000',
          currency: 'RUB',
          scale: 2,
        },
        remainingMinor: '1200000',
        currency: 'RUB',
        scale: 2,
        accounts: [{ value: 'account-id', label: 'Счёт' }],
        envelopes: [{ value: 'envelope-id', label: 'Ремонт' }],
      },
    });

    await wrapper.get('button:nth-child(2)').trigger('click');
    await wrapper.get('input[name="allocation-amount"]').setValue('1 000,00');
    await wrapper.get('form').trigger('submit');

    expect(wrapper.emitted('submit')?.[0]?.[0]).toMatchObject({ amount: '1000.00' });
  });
});
