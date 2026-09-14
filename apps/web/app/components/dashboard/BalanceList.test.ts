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
        totalMinor: null,
        moreLink: '/app/accounts',
      },
      global: { stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } },
    });

    const text = wrapper.text().replaceAll(' ', ' ');
    expect(text).toContain('Наличные');
    expect(text).toContain('-5,00 ₽');
    expect(text).toContain('Дефицит');
  });

  it('shows the server total and stops at five rows', () => {
    const wrapper = mount(BalanceList, {
      props: {
        title: 'Счета',
        items: Array.from({ length: 7 }, (_, index) => ({
          id: `account-${index}`,
          name: `Счёт ${index}`,
          balanceMinor: '100000',
        })),
        warnings: [],
        subject: 'ACCOUNT',
        totalMinor: '700000',
        moreLink: '/app/accounts',
      },
      global: { stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } },
    });

    expect(wrapper.findAll('[data-testid="balance-list-row"]')).toHaveLength(5);
    expect(wrapper.get('[data-testid="balance-list-total"]').text().replaceAll(' ', ' ')).toContain(
      '7 000,00 ₽',
    );
  });

  it('renders rows as informational text, not as a navigation control', () => {
    const wrapper = mount(BalanceList, {
      props: {
        title: 'Счета',
        items: [{ id: 'account-id', name: 'Наличные', balanceMinor: '10000' }],
        warnings: [],
        subject: 'ACCOUNT',
        totalMinor: null,
        moreLink: '/app/accounts',
      },
      global: { stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } },
    });

    // Each row previously navigated to the same generic list page regardless
    // of which one was pressed, so rows are informational only now; "Все"
    // stays the one real navigation affordance in this component.
    expect(wrapper.find('[data-testid="list-row-select"]').exists()).toBe(false);
    expect(wrapper.findAll('button').length).toBe(0);
    expect(wrapper.get('a').attributes('href')).toBe('/app/accounts');
  });
});
