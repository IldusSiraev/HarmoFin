import { DOMWrapper, flushPromises, mount } from '@vue/test-utils';
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
  v2: { getDashboard: vi.fn() },
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
vi.mock('../../composables/useEnvelopePlanV2.js', () => ({ useEnvelopePlanV2: () => mocks.v2 }));

import AccountsPage from './accounts.vue';
import { ApiRequestError } from '../../composables/useApiClient.js';
import { useFundingEntry } from '../../composables/useFundingEntry.js';
import { useOperationDialogs } from '../../composables/useOperationDialogs.js';
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

// The account dialog teleports to <body>, outside the page wrapper.
const body = () => new DOMWrapper(document.body);

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
    mocks.v2.getDashboard.mockResolvedValue({ onboarding: { needsOpeningAssignment: false } });
    useToast().clear();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
      wrapper = null;
    }
  });

  it('marks the page ready after client hydration', async () => {
    wrapper = mountPage();
    await flushPromises();

    expect(wrapper.get('[data-hydrated]').attributes('data-hydrated')).toBe('true');
  });

  async function createWithBalance(balance: string): Promise<void> {
    mocks.api.createAccount.mockResolvedValue(account);
    mocks.api.listAccounts.mockResolvedValue([account]);
    wrapper = mountPage();
    await flushPromises();
    await wrapper.get('[data-action="create-account"]').trigger('click');
    await flushPromises();
    const fill = (name: string, value: string) => {
      const input = document.querySelector(`input[name="${name}"]`) as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    fill('name', 'Основной счёт');
    fill('startingBalance', balance);
    fill('accountingStartDate', '2026-09-03');
    await flushPromises();
    document
      .querySelector('form[data-account-form]')
      ?.dispatchEvent(new Event('submit', { bubbles: true }));
    await flushPromises();
  }

  it('offers the opening assignment once money has been assigned before', async () => {
    useFundingEntry().dismiss();
    const budget = (mocks.auth.currentData.value as { workspaces: Array<{ budgets: object[] }> })
      .workspaces[0]!.budgets[0] as Record<string, unknown>;
    budget.planModelVersion = 2;

    await createWithBalance('1000');

    expect(useFundingEntry().request.value?.source).toEqual({ sourceKind: 'OPENING' });
    expect(mocks.v2.getDashboard).toHaveBeenCalledWith('budget-id');
  });

  it('offers nothing for a zero starting balance', async () => {
    useFundingEntry().dismiss();
    const budget = (mocks.auth.currentData.value as { workspaces: Array<{ budgets: object[] }> })
      .workspaces[0]!.budgets[0] as Record<string, unknown>;
    budget.planModelVersion = 2;
    await createWithBalance('0');
    expect(useFundingEntry().request.value).toBeNull();
    expect(mocks.v2.getDashboard).not.toHaveBeenCalled();
  });

  it('does not open the assignment during the initial setup and points to the checklist', async () => {
    useFundingEntry().dismiss();
    mocks.v2.getDashboard.mockResolvedValue({ onboarding: { needsOpeningAssignment: true } });

    await createWithBalance('1000');

    expect(useFundingEntry().request.value).toBeNull();
    const toast = useToast().toasts.value.at(-1);
    expect(toast?.title).toBe('Счёт создан');
    expect(toast?.description).toBe(
      'Распределить деньги по конвертам можно на главной, в мастере «Начало работы».',
    );
  });

  it('does not open the assignment when the onboarding status cannot be read', async () => {
    useFundingEntry().dismiss();
    mocks.v2.getDashboard.mockRejectedValue(new Error('network'));

    await createWithBalance('1000');

    expect(useFundingEntry().request.value).toBeNull();
    expect(useToast().toasts.value.at(-1)?.title).toBe('Счёт создан');
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
    // The archive action lives in the account dialog now, not on the card
    // itself, so the card has to be opened first.
    await wrapper.get('[data-testid="account-card-select"]').trigger('click');
    await body().get('[data-testid="account-dialog-archive"]').trigger('click');
    expect(mocks.api.archiveAccount).not.toHaveBeenCalled();
    await wrapper.get('[data-confirm="archive-account"]').trigger('click');
    await flushPromises();
    expect(mocks.api.archiveAccount).toHaveBeenCalledWith('budget-id', 'account-id');
  });

  it('closes the confirm dialog and explains a refused archive of an account with balance', async () => {
    mocks.api.listAccounts.mockResolvedValue([account]);
    mocks.api.archiveAccount.mockRejectedValue(
      new ApiRequestError(409, {
        code: 'ACCOUNT_HAS_BALANCE',
        detail: 'Счёт нельзя архивировать: на нём есть остаток.',
      }),
    );
    wrapper = mountPage();

    await flushPromises();
    await wrapper.get('[data-testid="account-card-select"]').trigger('click');
    await body().get('[data-testid="account-dialog-archive"]').trigger('click');
    await wrapper.get('[data-confirm="archive-account"]').trigger('click');
    await flushPromises();

    expect(wrapper.find('[data-confirm-dialog]').exists()).toBe(false);
    const toast = useToast().toasts.value.at(-1);
    expect(toast?.tone).toBe('error');
    expect(toast?.description).toContain('есть остаток');
  });

  it('offers transfer with selected active account', async () => {
    mocks.api.listAccounts.mockResolvedValue([account]);
    wrapper = mountPage();

    await flushPromises();
    await wrapper.get('[data-testid="account-card-select"]').trigger('click');
    const button = body().get('[data-testid="account-dialog-transfer"]');
    expect(button.text()).toContain('Перевести со счёта');

    const dialogs = useOperationDialogs();
    await button.trigger('click');
    expect(dialogs.entryType.value).toBe('TRANSFER');
    expect(dialogs.transferSourceAccountId.value).toBe('account-id');
    dialogs.close();
  });

  it('lists accounts as cards with the server total above them', async () => {
    mocks.api.listAccounts.mockResolvedValue([account]);
    wrapper = mountPage();
    await flushPromises();

    expect(wrapper.findAll('[data-testid="account-card-select"]').length).toBeGreaterThan(0);
    expect(normalize(wrapper.get('[data-testid="accounts-total"]').text())).toContain('1 500,00 ₽');
    expect(mocks.api.getAccountsSummary).toHaveBeenCalledWith('budget-id', 'active');
  });

  it('opens the dialog from a card', async () => {
    mocks.api.listAccounts.mockResolvedValue([account]);
    wrapper = mountPage();
    await flushPromises();

    await wrapper.get('[data-testid="account-card-select"]').trigger('click');

    expect(body().find('[data-testid="modal"]').exists()).toBe(true);
  });

  it('switches both requests to the archive from the status switch', async () => {
    mocks.api.listAccounts.mockResolvedValue([account]);
    wrapper = mountPage();
    await flushPromises();

    await wrapper.get('[data-testid="status-archived"]').trigger('click');
    await flushPromises();

    expect(mocks.api.listAccounts).toHaveBeenLastCalledWith('budget-id', 'archived');
    expect(mocks.api.getAccountsSummary).toHaveBeenLastCalledWith('budget-id', 'archived');
  });

  it('separates an empty archive from an empty budget', async () => {
    mocks.api.listAccounts.mockResolvedValue([]);
    wrapper = mountPage();
    await flushPromises();
    expect(wrapper.text()).toContain('Счетов пока нет');

    await wrapper.get('[data-testid="status-archived"]').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('В архиве пусто');
  });
});
