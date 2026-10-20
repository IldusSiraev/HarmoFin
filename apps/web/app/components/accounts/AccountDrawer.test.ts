import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import AccountDrawer from './AccountDrawer.vue';
import type { AccountDto } from '../../composables/useBudgetReferenceData.js';

const account: AccountDto = {
  id: 'account-id',
  budgetId: 'budget-id',
  name: 'Основная карта',
  accountType: 'BANK_CARD',
  bankName: 'Банк',
  lastFourDigits: '1234',
  currency: 'RUB',
  scale: 2,
  startingBalanceMinor: '1000000',
  currentBalanceMinor: '245000',
  accountingStartDate: '2026-09-01',
  comment: 'Основная карта семьи',
  archivedAt: null,
};

const mountDrawer = (overrides: Partial<AccountDto> = {}) =>
  mount(AccountDrawer, {
    props: { account: { ...account, ...overrides } },
    attachTo: document.body,
    global: { stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } },
  });

describe('AccountDrawer', () => {
  it('shows what the account is', () => {
    const wrapper = mountDrawer();
    const text = wrapper.text();

    expect(text).toContain('Банковская карта');
    expect(text).toContain('Банк');
    expect(text).toContain('1234');
    expect(text).toContain('01.09.2026');
    expect(text).toContain('Основная карта семьи');
    wrapper.unmount();
  });

  it('hands editing and archiving back to the page', async () => {
    const wrapper = mountDrawer();

    await wrapper.get('[data-testid="account-drawer-edit"]').trigger('click');
    await wrapper.get('[data-testid="account-drawer-archive"]').trigger('click');

    expect(wrapper.emitted('edit')?.[0]?.[0]).toMatchObject({ id: 'account-id' });
    expect(wrapper.emitted('archive')?.[0]?.[0]).toMatchObject({ id: 'account-id' });
    wrapper.unmount();
  });

  it('links to the journal and to a transfer from this account', () => {
    const wrapper = mountDrawer();

    expect(wrapper.get('[data-testid="account-drawer-operations"]').attributes('href')).toBe(
      '/app/operations?accountId=account-id',
    );
    expect(wrapper.get('[data-testid="account-drawer-transfer"]').attributes('href')).toBe(
      '/app/transfers?sourceAccountId=account-id',
    );
    wrapper.unmount();
  });

  it('offers no archiving for an account already in the archive', () => {
    const wrapper = mountDrawer({ archivedAt: '2026-09-10T00:00:00.000Z' });

    expect(wrapper.find('[data-testid="account-drawer-archive"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('offers no transfer for an account already in the archive', () => {
    const wrapper = mountDrawer({ archivedAt: '2026-09-10T00:00:00.000Z' });

    expect(wrapper.find('[data-testid="account-drawer-transfer"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
