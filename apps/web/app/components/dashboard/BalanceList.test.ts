import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import BalanceList from './BalanceList.vue';

const stubs = { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } };

describe('BalanceList', () => {
  it('renders named balances with a visible minus sign', () => {
    const wrapper = mount(BalanceList, {
      props: {
        title: 'Счета',
        subtitle: 'Где находятся деньги',
        moreLabel: 'Все счета',
        items: [
          { id: 'account-id', name: 'Наличные', balanceMinor: '10000' },
          { id: 'deficit-id', name: 'Карта', balanceMinor: '-500' },
        ],
        totalMinor: null,
        moreLink: '/app/accounts',
      },
      global: { stubs },
    });

    const text = wrapper.text().replaceAll(' ', ' ');
    expect(text).toContain('Наличные');
    expect(text).toContain('-5,00 ₽');
  });

  it('shows the server total and stops at five rows', () => {
    const wrapper = mount(BalanceList, {
      props: {
        title: 'Счета',
        subtitle: 'Где находятся деньги',
        moreLabel: 'Все счета',
        items: Array.from({ length: 7 }, (_, index) => ({
          id: `account-${index}`,
          name: `Счёт ${index}`,
          balanceMinor: '100000',
        })),
        totalMinor: '700000',
        moreLink: '/app/accounts',
      },
      global: { stubs },
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
        subtitle: 'Где находятся деньги',
        moreLabel: 'Все счета',
        items: [{ id: 'account-id', name: 'Наличные', balanceMinor: '10000' }],
        totalMinor: null,
        moreLink: '/app/accounts',
      },
      global: { stubs },
    });

    // Each row previously navigated to the same generic list page regardless
    // of which one was pressed, so rows are informational only now; the
    // labelled "all" link stays the one real navigation affordance here.
    expect(wrapper.find('[data-testid="list-row-select"]').exists()).toBe(false);
    expect(wrapper.findAll('button').length).toBe(0);
    expect(wrapper.get('a').attributes('href')).toBe('/app/accounts');
  });

  it('names the card with a heading, subtitle and a labelled "all" link', () => {
    const wrapper = mount(BalanceList, {
      props: {
        title: 'Счета',
        subtitle: 'Где находятся деньги',
        moreLabel: 'Все счета',
        items: [],
        totalMinor: '0',
        moreLink: '/app/accounts',
      },
      global: { stubs },
    });
    expect(wrapper.get('h2').text()).toBe('Счета');
    expect(wrapper.text()).toContain('Где находятся деньги');
    expect(wrapper.get('a[href="/app/accounts"]').text()).toContain('Все счета');
  });

  it('renders an h3 title when nested under a page heading', () => {
    const wrapper = mount(BalanceList, {
      props: {
        title: 'Счета',
        subtitle: 'Где находятся деньги',
        moreLabel: 'Все счета',
        headingLevel: 'h3',
        items: [],
        totalMinor: '0',
        moreLink: '/app/accounts',
      },
      global: { stubs },
    });
    expect(wrapper.get('h3').text()).toBe('Счета');
    expect(wrapper.find('h2').exists()).toBe(false);
  });
});
