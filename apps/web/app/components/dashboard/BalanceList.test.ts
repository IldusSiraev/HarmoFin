import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import BalanceList from './BalanceList.vue';

describe('BalanceList', () => {
  it('renders named balances and explicit deficit text', () => {
    const wrapper = mount(BalanceList, {
      props: {
        title: 'Счета',
        items: [
          { id: 'account-id', name: 'Наличные', balanceMinor: '10000' },
          { id: 'deficit-id', name: 'Карта', balanceMinor: '-500' },
        ],
        warnings: [{ subject: 'ACCOUNT', id: 'deficit-id', balanceMinor: '-500' }],
        subject: 'ACCOUNT',
      },
    });

    const text = wrapper.text().replaceAll(' ', ' ');
    expect(text).toContain('Наличные');
    expect(text).toContain('-5,00 ₽');
    expect(text).toContain('Дефицит');
  });
});
