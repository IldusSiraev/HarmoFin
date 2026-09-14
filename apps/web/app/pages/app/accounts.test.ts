import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: {
    currentData: { value: null as unknown },
    loadMe: vi.fn(),
  },
  api: {
    listAccounts: vi.fn(),
    getAccountsSummary: vi.fn(),
    createAccount: vi.fn(),
    updateAccount: vi.fn(),
    archiveAccount: vi.fn(),
  },
  route: { path: '/app/accounts', query: {} as Record<string, string> },
  navigateTo: vi.fn(),
}));

vi.mock('#imports', () => ({
  definePageMeta: vi.fn(),
  navigateTo: mocks.navigateTo,
  useRoute: () => mocks.route,
}));
vi.mock('../../composables/useAuth.js', () => ({ useAuth: () => mocks.auth }));
vi.mock('../../composables/useBudgetReferenceData.js', () => ({
  useBudgetReferenceData: () => mocks.api,
}));

import AccountsPage from './accounts.vue';
import { useToast } from '../../composables/useToast.js';

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

const normalize = (value: string): string => value.replace(/[\u00a0\u202f]/g, ' ');

function mountPage() {
  return mount(AccountsPage, {
    attachTo: document.body,
    global: {
      stubs: {
        NuxtLink: { template: '<a><slot /></a>' },
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
    mocks.route.query = {};
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
    mocks.api.getAccountsSummary.mockResolvedValue({
      currency: 'RUB',
      scale: 2,
      totalMinor: '150000',
      count: 2,
    });
    useToast().clear();
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
    await flushPromises();

    // Form is Teleported to body, access via document
    const nameInput = document.querySelector('input[name="name"]') as HTMLInputElement;
    const startingBalanceInput = document.querySelector(
      'input[name="startingBalance"]',
    ) as HTMLInputElement;
    const accountingStartDateInput = document.querySelector(
      'input[name="accountingStartDate"]',
    ) as HTMLInputElement;
    const form = document.querySelector('form[data-account-form]') as HTMLFormElement;

    nameInput.value = 'Основной счёт';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();

    startingBalanceInput.value = '123,45';
    startingBalanceInput.dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();

    accountingStartDateInput.value = '2026-09-03';
    accountingStartDateInput.dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();

    form.dispatchEvent(new Event('submit', { bubbles: true }));
    await flushPromises();

    expect(mocks.api.createAccount).toHaveBeenCalledWith(
      'budget-id',
      expect.objectContaining({ startingBalance: '123.45' }),
    );
    expect(mocks.api.listAccounts).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).toContain('Основной счёт');
  });

  it('announces a created account through a toast', async () => {
    mocks.api.createAccount.mockResolvedValue(account);
    mocks.api.listAccounts.mockResolvedValueOnce([]).mockResolvedValueOnce([account]);
    wrapper = mountPage();

    await flushPromises();
    await wrapper.get('[data-action="create-account"]').trigger('click');
    await flushPromises();

    const nameInput = document.querySelector('input[name="name"]') as HTMLInputElement;
    const startingBalanceInput = document.querySelector(
      'input[name="startingBalance"]',
    ) as HTMLInputElement;
    const accountingStartDateInput = document.querySelector(
      'input[name="accountingStartDate"]',
    ) as HTMLInputElement;
    const form = document.querySelector('form[data-account-form]') as HTMLFormElement;

    nameInput.value = 'Новый счёт';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    startingBalanceInput.value = '0,00';
    startingBalanceInput.dispatchEvent(new Event('input', { bubbles: true }));
    accountingStartDateInput.value = '2026-09-03';
    accountingStartDateInput.dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();

    form.dispatchEvent(new Event('submit', { bubbles: true }));
    await flushPromises();

    expect(useToast().toasts.value.at(-1)?.title).toBe('Счёт создан');
  });

  it('requires explicit archive confirmation', async () => {
    mocks.api.listAccounts.mockResolvedValue([account]);
    mocks.api.archiveAccount.mockResolvedValue({
      ...account,
      archivedAt: '2026-09-04T00:00:00.000Z',
    });
    wrapper = mountPage();

    await flushPromises();
    // The archive action now lives behind the row's action menu instead of
    // being a card-level button, so the menu has to be opened first.
    await wrapper.get('[data-testid="row-actions-account-id"]').trigger('click');
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
    await wrapper.get('[data-testid="row-actions-account-id"]').trigger('click');
    const link = wrapper.get('[data-action="transfer-from-account"]');
    expect(link.text()).toContain('Перевести со счёта');
    expect(link.attributes('to')).toContain('sourceAccountId=account-id');
  });

  it('lists accounts as rows with the server total above them', async () => {
    mocks.api.listAccounts.mockResolvedValue([account]);
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.findAll('[data-testid="list-row-select"]').length).toBeGreaterThan(0);
    expect(normalize(wrapper.get('[data-testid="accounts-total"]').text())).toContain('1 500,00 ₽');
    expect(mocks.api.getAccountsSummary).toHaveBeenCalledWith('budget-id', 'active');
    wrapper.unmount();
  });

  it('opens the drawer from a row', async () => {
    mocks.api.listAccounts.mockResolvedValue([account]);
    const wrapper = mountPage();
    await flushPromises();

    await wrapper.get('[data-testid="list-row-select"]').trigger('click');

    expect(wrapper.find('[data-testid="drawer"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it('switches both requests to the archive from the chip', async () => {
    mocks.api.listAccounts.mockResolvedValue([account]);
    const wrapper = mountPage();
    await flushPromises();

    await wrapper.get('[data-testid="chip-archived"]').trigger('click');
    await flushPromises();

    expect(mocks.api.listAccounts).toHaveBeenLastCalledWith('budget-id', 'archived');
    expect(mocks.api.getAccountsSummary).toHaveBeenLastCalledWith('budget-id', 'archived');
    wrapper.unmount();
  });

  it('separates an empty archive from an empty budget', async () => {
    mocks.api.listAccounts.mockResolvedValue([]);
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.text()).toContain('Счетов пока нет');

    await wrapper.get('[data-testid="chip-archived"]').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('В архиве пусто');
    wrapper.unmount();
  });
});
