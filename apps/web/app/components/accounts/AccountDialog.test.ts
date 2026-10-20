import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';

import AccountDialog from './AccountDialog.vue';
import type { AccountDto } from '../../composables/useBudgetReferenceData.js';
import { useOperationDialogs } from '../../composables/useOperationDialogs.js';

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

const mountDialog = (overrides: Partial<AccountDto> = {}) =>
  mount(AccountDialog, {
    props: { account: { ...account, ...overrides } },
    attachTo: document.body,
    global: {
      stubs: {
        teleport: true,
        NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
      },
    },
  });

afterEach(() => {
  useOperationDialogs().close();
});

describe('AccountDialog', () => {
  it('shows what the account is', () => {
    const wrapper = mountDialog();
    const text = wrapper.text();

    expect(text).toContain('Банковская карта');
    expect(text).toContain('Банк');
    expect(text).toContain('1234');
    expect(text).toContain('01.09.2026');
    expect(text).toContain('Основная карта семьи');
    wrapper.unmount();
  });

  it('hands editing and archiving back to the page', async () => {
    const wrapper = mountDialog();

    await wrapper.get('[data-testid="account-dialog-edit"]').trigger('click');
    await wrapper.get('[data-testid="account-dialog-archive"]').trigger('click');

    expect(wrapper.emitted('edit')?.[0]?.[0]).toMatchObject({ id: 'account-id' });
    expect(wrapper.emitted('archive')?.[0]?.[0]).toMatchObject({ id: 'account-id' });
    wrapper.unmount();
  });

  it('links to the journal and opens a transfer from this account', async () => {
    const wrapper = mountDialog();

    expect(wrapper.get('[data-testid="account-dialog-operations"]').attributes('href')).toBe(
      '/app/operations?accountId=account-id',
    );

    const dialogs = useOperationDialogs();
    await wrapper.get('[data-testid="account-dialog-transfer"]').trigger('click');
    expect(dialogs.entryType.value).toBe('TRANSFER');
    expect(dialogs.transferSourceAccountId.value).toBe('account-id');
    expect(wrapper.emitted('close')).toHaveLength(1);
    wrapper.unmount();
  });

  it('offers no archiving for an account already in the archive', () => {
    const wrapper = mountDialog({ archivedAt: '2026-09-10T00:00:00.000Z' });

    expect(wrapper.find('[data-testid="account-dialog-archive"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('offers no transfer for an account already in the archive', () => {
    const wrapper = mountDialog({ archivedAt: '2026-09-10T00:00:00.000Z' });

    expect(wrapper.find('[data-testid="account-dialog-transfer"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
