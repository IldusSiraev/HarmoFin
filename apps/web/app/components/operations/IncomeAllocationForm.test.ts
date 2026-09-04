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
        accounts: [{ value: 'account-id', label: 'Счёт' }],
        envelopes: [{ value: 'envelope-id', label: 'Ремонт' }],
      },
    });

    expect(wrapper.text()).toContain('Предложить распределение');
    expect(wrapper.emitted('submit')).toBeUndefined();
    await wrapper.get('[data-action="apply-proposal"]').trigger('click');
    expect(wrapper.emitted('submit')).toHaveLength(1);
  });
});
