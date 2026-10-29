import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed } from 'vue';

const state = vi.hoisted(() => ({ role: 'OWNER' as 'OWNER' | 'EDITOR' | 'VIEWER' | null }));
vi.mock('../../composables/useActiveWorkspace.js', () => ({
  useActiveWorkspace: () => ({ role: computed(() => state.role) }),
}));
vi.mock('../../composables/useAuth.js', () => ({
  useAuth: () => ({ currentUser: { value: { id: 'user-id' } } }),
}));

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
  owner: { userId: 'owner-id', displayName: 'Алия', isActiveMember: true },
  canEdit: true,
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

beforeEach(() => {
  state.role = 'OWNER';
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

  it('lets an editor edit and archive an account the server says they can edit', () => {
    state.role = 'EDITOR';
    const wrapper = mountDialog();

    expect(wrapper.find('[data-testid="account-dialog-edit"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="account-dialog-archive"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="account-dialog-transfer"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it('hides edit and archive for an account owned by another member and explains why', () => {
    const wrapper = mountDialog({ canEdit: false });

    expect(wrapper.find('[data-testid="account-dialog-edit"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="account-dialog-archive"]').exists()).toBe(false);
    const notice = wrapper.get('[data-testid="account-dialog-owner-notice"]').text();
    expect(notice).toContain('Принадлежит участнику «Алия»');
    expect(notice).toContain('изменять может только владелец');
    wrapper.unmount();
  });

  it('shows no owner notice for an account the reader can edit', () => {
    const wrapper = mountDialog();

    expect(wrapper.find('[data-testid="account-dialog-owner-notice"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('offers no edit, archive or transfer for a viewer', () => {
    state.role = 'VIEWER';
    const wrapper = mountDialog({ canEdit: false });

    expect(wrapper.find('[data-testid="account-dialog-edit"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="account-dialog-archive"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="account-dialog-transfer"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="account-dialog-operations"]').exists()).toBe(true);
    wrapper.unmount();
  });
});
