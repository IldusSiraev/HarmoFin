import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: {
    currentData: { value: null as unknown },
    loadMe: vi.fn(),
  },
  api: {
    listAccounts: vi.fn(),
    createAccount: vi.fn(),
    updateAccount: vi.fn(),
    archiveAccount: vi.fn(),
  },
}));

vi.mock('../../composables/useAuth.js', () => ({ useAuth: () => mocks.auth }));
vi.mock('../../composables/useBudgetReferenceData.js', () => ({
  useBudgetReferenceData: () => mocks.api,
}));

import AccountsPage from './accounts.vue';

const account = {
  id: 'account-id',
  budgetId: 'budget-id',
  name: 'Основной счёт',
  accountType: 'BANK_ACCOUNT' as const,
  bankName: null,
  lastFourDigits: null,
  currency: 'RUB' as const,
  scale: 2 as const,
  startingBalanceMinor: '12345',
  currentBalanceMinor: '12345',
  accountingStartDate: '2026-09-03',
  comment: null,
  archivedAt: null,
};

function mountPage() {
  return mount(AccountsPage, {
    attachTo: document.body,
    global: {
      stubs: {
        NuxtLink: { template: '<a><slot /></a>' },
        AccountCard: {
          template: '<article><strong>{{ account.name }}</strong><slot name="actions" /></article>',
          props: ['account'],
        },
        UiButton: {
          template: '<button v-bind="$attrs" @click="$emit(\'click\', $event)"><slot /></button>',
          props: ['variant', 'size', 'type', 'loading', 'disabled', 'fullWidth', 'ariaLabel', 'tooltip'],
          emits: ['click'],
          inheritAttrs: true,
        },
        UiModal: {
          template:
            '<div v-if="open" data-modal><div class="modal-header"><h2>{{ title }}</h2><button @click="$emit(\'close\')">×</button></div><div class="modal-content"><slot /></div></div>',
          props: ['open', 'title'],
          emits: ['close'],
        },
        UiConfirmDialog: {
          props: ['open'],
          template:
            '<div v-if="open" data-confirm-dialog><button data-confirm="archive-account" @click="$emit(\'confirm\')">Подтвердить</button><button @click="$emit(\'cancel\')">Отмена</button></div>',
        },
      },
    },
  });
}

describe('accounts page', () => {
  let wrapper: ReturnType<typeof mountPage> | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.currentData.value = {
      user: { id: 'user-id', email: 'owner@example.test', displayName: null },
      workspaces: [
        {
          id: 'workspace-id',
          name: 'Семья',
          role: 'OWNER',
          budgets: [{ id: 'budget-id', name: 'Бюджет', primaryCurrency: 'RUB' }],
        },
      ],
    };
    mocks.api.listAccounts.mockResolvedValue([]);
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
      wrapper = null;
    }
  });

  it('creates account from decimal text and refreshes server-confirmed card', async () => {
    mocks.api.createAccount.mockResolvedValue(account);
    mocks.api.listAccounts.mockResolvedValueOnce([]).mockResolvedValueOnce([account]);
    wrapper = mountPage();

    await flushPromises();
    await wrapper.get('[data-action="create-account"]').trigger('click');
    await wrapper.get('input[name="name"]').setValue('Основной счёт');
    await wrapper.get('input[name="startingBalance"]').setValue('123,45');
    await wrapper.get('input[name="accountingStartDate"]').setValue('2026-09-03');
    await wrapper.get('form[data-account-form]').trigger('submit');
    await flushPromises();

    expect(mocks.api.createAccount).toHaveBeenCalledWith(
      'budget-id',
      expect.objectContaining({ startingBalance: '123.45' }),
    );
    expect(mocks.api.listAccounts).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).toContain('Основной счёт');
  });
  it('requires explicit archive confirmation', async () => {
    mocks.api.listAccounts.mockResolvedValue([account]);
    mocks.api.archiveAccount.mockResolvedValue({
      ...account,
      archivedAt: '2026-09-04T00:00:00.000Z',
    });
    wrapper = mountPage();

    await flushPromises();
    await wrapper.get('[data-action="archive-account"]').trigger('click');
    expect(mocks.api.archiveAccount).not.toHaveBeenCalled();
    await wrapper.get('[data-confirm="archive-account"]').trigger('click');
    await flushPromises();
    expect(mocks.api.archiveAccount).toHaveBeenCalledWith('budget-id', 'account-id');
  });

  it('offers transfer with selected active account', async () => {
    mocks.api.listAccounts.mockResolvedValue([account]);
    wrapper = mountPage();

    await flushPromises();
    const link = wrapper.get('[data-action="transfer-from-account"]');
    expect(link.text()).toContain('Перевести со счёта');
    expect(link.attributes('to')).toContain('sourceAccountId=account-id');
  });
});
