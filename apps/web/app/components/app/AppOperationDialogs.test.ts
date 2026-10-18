import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = {
  listAccounts: vi.fn(),
  listCategories: vi.fn(),
};
const v2 = {
  createTransaction: vi.fn(),
  createTransfer: vi.fn(),
  payOneTimeObligation: vi.fn(),
  listEnvelopes: vi.fn(),
};
const auth = {
  currentData: {
    value: {
      user: { email: 'owner@harmofin.test' },
      workspaces: [
        {
          role: 'OWNER',
          budgets: [{ id: 'budget-id', name: 'Бюджет', planModelVersion: 2 }],
        },
      ],
    },
  },
  loadMe: vi.fn(),
};

vi.mock('../../composables/useBudgetReferenceData.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useBudgetReferenceData: () => api,
}));
vi.mock('../../composables/useEnvelopePlanV2.js', () => ({ useEnvelopePlanV2: () => v2 }));
vi.mock('../../composables/useAuth.js', () => ({ useAuth: () => auth }));
const router = vi.hoisted(() => ({
  route: { path: '/app', query: {} as Record<string, string> },
  navigateTo: vi.fn(),
}));
vi.mock('#imports', () => ({
  useRoute: () => router.route,
  navigateTo: router.navigateTo,
}));

import { ApiRequestError } from '../../composables/useApiClient.js';
import AppOperationDialogs from './AppOperationDialogs.vue';
import { useOperationDialogs } from '../../composables/useOperationDialogs.js';
import { useOperationReferenceData } from '../../composables/useOperationReferenceData.js';
import { useFundingEntry } from '../../composables/useFundingEntry.js';
import { useToast } from '../../composables/useToast.js';

function click(testId: string): void {
  document.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)?.click();
}

function typeAmount(value: string): void {
  const input = document.querySelector<HTMLInputElement>('input[name="amount"]');
  if (!input) return;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

beforeEach(() => {
  vi.clearAllMocks();
  router.route = { path: '/app', query: {} };
  useOperationDialogs().close();
  useToast().clear();
  useOperationReferenceData().invalidate();
  api.listAccounts.mockResolvedValue([{ id: 'account-id', name: 'Основная карта' }]);
  api.listCategories.mockResolvedValue([
    {
      id: 'category-id',
      name: 'Продукты',
      categoryType: 'EXPENSE',
      templateKey: 'expense-groceries',
      archivedAt: null,
    },
    {
      id: 'income-category-id',
      name: 'Зарплата',
      categoryType: 'INCOME',
      templateKey: 'income-salary',
      archivedAt: null,
    },
  ]);
  v2.listEnvelopes.mockResolvedValue({
    items: [{ id: 'envelope-id', name: 'Текущие', archivedAt: null }],
  });
});

describe('AppOperationDialogs', () => {
  it('shows nothing while no dialog is requested', () => {
    const wrapper = mount(AppOperationDialogs, { attachTo: document.body });

    expect(document.querySelector('[data-testid="entry-submit"]')).toBeNull();
    expect(document.querySelector('form.transfer-form')).toBeNull();
    expect(router.navigateTo).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('opens the expense entry from the installed-app shortcut and clears the shortcut parameter', async () => {
    router.route = { path: '/app', query: { entry: 'expense', period: 'current' } };
    const wrapper = mount(AppOperationDialogs, { attachTo: document.body });
    await flushPromises();

    expect(useOperationDialogs().openDialog.value).toBe('entry');
    expect(
      document.querySelector('[data-testid="entry-tab-EXPENSE"]')?.getAttribute('aria-selected'),
    ).toBe('true');
    expect(router.navigateTo).toHaveBeenCalledWith(
      { path: '/app', query: { period: 'current' } },
      { replace: true },
    );
    wrapper.unmount();
  });

  it('opens the type picker and routes the chosen type into the entry dialog', async () => {
    const wrapper = mount(AppOperationDialogs, { attachTo: document.body });

    useOperationDialogs().openChoose();
    await flushPromises();
    expect(document.querySelector('[data-testid="operation-type-expense"]')).not.toBeNull();

    click('operation-type-income');
    await flushPromises();

    expect(useOperationDialogs().openDialog.value).toBe('entry');
    expect(useOperationDialogs().entryType.value).toBe('INCOME');
    expect(
      document.querySelector('[data-testid="entry-tab-INCOME"]')?.getAttribute('aria-selected'),
    ).toBe('true');
    expect(document.querySelector('[data-testid="operation-type-expense"]')).toBeNull();
    wrapper.unmount();
  });

  it('opens the transfer tab of the entry dialog with the budget reference data', async () => {
    const wrapper = mount(AppOperationDialogs, { attachTo: document.body });

    useOperationDialogs().openTransfer();
    await flushPromises();

    expect(api.listAccounts).toHaveBeenCalledWith('budget-id', 'active');
    expect(
      document.querySelector('[data-testid="entry-tab-TRANSFER"]')?.getAttribute('aria-selected'),
    ).toBe('true');
    wrapper.unmount();
  });

  it('saves income through the v2 endpoint and then offers the optional assignment', async () => {
    v2.createTransaction.mockResolvedValue({ id: 'income-id' });
    const wrapper = mount(AppOperationDialogs, { attachTo: document.body });
    useOperationDialogs().openOperation('INCOME');
    await flushPromises();

    typeAmount('1000');
    click('pill-account-account-id');
    click('pill-category-income-category-id');
    await flushPromises();
    click('entry-submit');
    await flushPromises();

    expect(v2.createTransaction).toHaveBeenCalledWith(
      'budget-id',
      expect.objectContaining({ transactionType: 'INCOME', status: 'CONFIRMED' }),
      expect.any(String),
    );
    expect(useFundingEntry().request.value).toMatchObject({
      budgetId: 'budget-id',
      source: { sourceKind: 'INCOME', incomeTransactionId: 'income-id' },
    });
    expect(useOperationDialogs().openDialog.value).toBe('none');
    wrapper.unmount();
  });

  it('announces a failed save and keeps the entry dialog open', async () => {
    v2.createTransaction.mockRejectedValue(new Error('network'));
    const wrapper = mount(AppOperationDialogs, { attachTo: document.body });
    useOperationDialogs().openOperation('INCOME');
    await flushPromises();

    typeAmount('1000');
    click('pill-account-account-id');
    click('pill-category-income-category-id');
    await flushPromises();
    click('entry-submit');
    await flushPromises();

    expect(useOperationDialogs().openDialog.value).toBe('entry');
    expect(useToast().toasts.value.at(-1)?.tone).toBe('error');
    wrapper.unmount();
  });

  it('leads with popular categories, pads with the regular list, and reaches the overflow through search', async () => {
    const groceries = {
      id: 'category-id',
      name: 'Продукты',
      categoryType: 'EXPENSE',
      templateKey: 'expense-groceries',
      archivedAt: null,
    };
    // 14 filler categories pad the picker up to the 15-item target alongside
    // the one popular category; a 15th "overflow" one should get pushed out.
    const fillers = Array.from({ length: 14 }, (_unused, index) => ({
      id: `filler-${index}`,
      name: `Категория ${index}`,
      categoryType: 'EXPENSE',
      templateKey: null,
      archivedAt: null,
    }));
    const overflow = {
      id: 'overflow-category-id',
      name: 'Путешествия',
      categoryType: 'EXPENSE',
      templateKey: 'expense-travel',
      archivedAt: null,
    };
    api.listCategories.mockImplementation(
      (_budgetId: string, _type: unknown, _status: unknown, options?: { sort?: string }) =>
        Promise.resolve(
          options?.sort === 'popular' ? [groceries] : [groceries, ...fillers, overflow],
        ),
    );
    const wrapper = mount(AppOperationDialogs, { attachTo: document.body });
    useOperationDialogs().openOperation('EXPENSE');
    await flushPromises();

    const pills = [...document.querySelectorAll('[data-testid^="pill-category-"]')];
    expect(pills).toHaveLength(15);
    expect(pills[0]!.getAttribute('data-testid')).toBe('pill-category-category-id');
    expect(document.querySelector('[data-testid="pill-category-overflow-category-id"]')).toBeNull();

    const search = document.querySelector<HTMLInputElement>('input[name="categorySearch"]');
    search!.value = 'путешеств';
    search!.dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();

    expect(
      document.querySelector('[data-testid="pill-category-overflow-category-id"]'),
    ).not.toBeNull();
    wrapper.unmount();
  });

  describe('entry flows', () => {
    beforeEach(() => {
      v2.listEnvelopes.mockResolvedValue({
        items: [
          {
            id: 'envelope-id',
            name: 'Текущие',
            envelopeType: 'CURRENT_EXPENSES',
            archivedAt: null,
          },
          {
            id: 'mandatory-id',
            name: 'Обязательные',
            envelopeType: 'MANDATORY_EXPENSES',
            archivedAt: null,
          },
        ],
      });
      api.listAccounts.mockResolvedValue([
        { id: 'account-id', name: 'Основная карта' },
        { id: 'savings-id', name: 'Накопительный' },
      ]);
    });

    async function openExpense(): Promise<ReturnType<typeof mount>> {
      const wrapper = mount(AppOperationDialogs, { attachTo: document.body });
      useOperationDialogs().openOperation('EXPENSE');
      await flushPromises();
      typeAmount('500');
      click('pill-account-account-id');
      click('pill-category-category-id');
      await flushPromises();
      return wrapper;
    }

    it('saves an expense without an envelope through the v2 endpoint with envelopeId null', async () => {
      v2.createTransaction.mockResolvedValue({ id: 'expense-id' });
      const wrapper = await openExpense();

      const submit = document.querySelector<HTMLButtonElement>('[data-testid="entry-submit"]');
      expect(submit?.disabled).toBe(false);
      click('entry-submit');
      await flushPromises();

      expect(v2.createTransaction).toHaveBeenCalledTimes(1);
      const [id, body, key] = v2.createTransaction.mock.calls[0]!;
      expect(id).toBe('budget-id');
      expect(body).toMatchObject({ transactionType: 'EXPENSE', status: 'CONFIRMED' });
      expect(body.envelopeId).toBeNull();
      expect(typeof key).toBe('string');
      expect(useOperationDialogs().openDialog.value).toBe('none');
      wrapper.unmount();
    });

    it('sends the chosen non-mandatory envelope id', async () => {
      v2.createTransaction.mockResolvedValue({ id: 'expense-id' });
      const wrapper = await openExpense();

      click('pill-envelope-envelope-id');
      await flushPromises();
      click('entry-submit');
      await flushPromises();

      expect(v2.createTransaction.mock.calls[0]![1].envelopeId).toBe('envelope-id');
      wrapper.unmount();
    });

    it('preselects and marks the envelope of the current period', async () => {
      v2.listEnvelopes.mockResolvedValue({
        items: [
          {
            id: 'first-half-id',
            name: 'Первая половина',
            envelopeType: 'CURRENT_EXPENSES',
            periodSlot: 'FIRST',
            archivedAt: null,
            periods: [
              { periodId: 'p1', startsOn: '2026-10-01', endsOn: '2026-10-15', current: false },
            ],
          },
          {
            id: 'second-half-id',
            name: 'Вторая половина',
            envelopeType: 'CURRENT_EXPENSES',
            periodSlot: 'SECOND',
            archivedAt: null,
            periods: [
              { periodId: 'p2', startsOn: '2026-10-16', endsOn: '2026-10-31', current: true },
            ],
          },
        ],
      });
      const wrapper = mount(AppOperationDialogs, { attachTo: document.body });
      useOperationDialogs().openOperation('EXPENSE');
      await flushPromises();

      const pill = (id: string) => document.querySelector(`[data-testid="pill-envelope-${id}"]`);
      expect(pill('second-half-id')?.getAttribute('aria-checked')).toBe('true');
      expect(pill('first-half-id')?.getAttribute('aria-checked')).toBe('false');
      expect(pill('second-half-id')?.textContent).toContain('текущий период');
      expect(
        document.querySelector('[data-testid="pill-envelope-first-half-id-marker"]'),
      ).toBeNull();
      wrapper.unmount();
    });

    it('focuses the amount field when the expense form opens', async () => {
      const wrapper = mount(AppOperationDialogs, { attachTo: document.body });
      useOperationDialogs().openOperation('EXPENSE');
      await flushPromises();

      expect(document.activeElement).toBe(document.querySelector('input[name="amount"]'));
      wrapper.unmount();
    });

    it('shows account and category icons in the pills', async () => {
      api.listAccounts.mockResolvedValue([
        { id: 'account-id', name: 'Основная карта', accountType: 'BANK_CARD' },
      ]);
      const wrapper = mount(AppOperationDialogs, { attachTo: document.body });
      useOperationDialogs().openOperation('EXPENSE');
      await flushPromises();

      expect(
        document.querySelector('[data-testid="pill-account-account-id"] .pill-select__icon'),
      ).not.toBeNull();
      expect(
        document.querySelector('[data-testid="pill-category-category-id"] .pill-select__icon'),
      ).not.toBeNull();
      wrapper.unmount();
    });

    const savedExpense = {
      id: 'expense-id',
      amountMinor: '50000',
      currency: 'RUB',
      accountId: 'account-id',
      categoryId: 'category-id',
    };

    it('confirms each "add another" save inside the form and counts the batch', async () => {
      v2.createTransaction.mockResolvedValue(savedExpense);
      const wrapper = await openExpense();
      const notice = () =>
        document.querySelector('[data-testid="entry-saved-notice"]')?.textContent ?? '';

      expect(notice()).toBe('');
      click('entry-submit-next');
      await flushPromises();
      // The in-form notice replaces the toast while the dialog stays open.
      expect(useToast().toasts.value).toHaveLength(0);
      expect(notice()).toContain('Добавлено:');
      expect(notice()).toContain('500,00');
      expect(notice()).toContain('Продукты');
      expect(notice()).toContain('Основная карта');
      expect(notice()).not.toContain('Всего');
      expect(
        document.querySelector('[data-testid="entry-saved-notice"]')?.closest('[role="status"]'),
      ).not.toBeNull();

      typeAmount('300');
      click('pill-category-category-id');
      await flushPromises();
      click('entry-submit-next');
      await flushPromises();
      expect(notice()).toContain('Всего добавлено: 2');

      useOperationDialogs().close();
      await flushPromises();
      useOperationDialogs().openOperation('EXPENSE');
      await flushPromises();
      expect(notice()).toBe('');
      wrapper.unmount();
    });

    it('saves and keeps the form open for the next expense', async () => {
      v2.createTransaction.mockResolvedValue(savedExpense);
      const wrapper = await openExpense();

      click('entry-submit-next');
      await flushPromises();

      expect(v2.createTransaction).toHaveBeenCalledTimes(1);
      expect(useOperationDialogs().openDialog.value).toBe('entry');
      const amount = document.querySelector<HTMLInputElement>('input[name="amount"]');
      expect(amount?.value).toBe('');
      expect(document.activeElement).toBe(amount);
      expect(
        document
          .querySelector('[data-testid="pill-account-account-id"]')
          ?.getAttribute('aria-checked'),
      ).toBe('true');
      expect(
        document
          .querySelector('[data-testid="pill-category-category-id"]')
          ?.getAttribute('aria-checked'),
      ).toBe('false');
      wrapper.unmount();
    });

    it('does not post a mandatory-envelope expense and offers the one-time payment flow instead', async () => {
      v2.payOneTimeObligation.mockResolvedValue({ transaction: { id: 'tx' } });
      const wrapper = await openExpense();

      click('pill-envelope-mandatory-id');
      await flushPromises();
      expect(document.body.textContent).toContain('Обязательные оплачиваются');
      click('entry-submit');
      await flushPromises();

      expect(v2.createTransaction).not.toHaveBeenCalled();
      expect(v2.payOneTimeObligation).not.toHaveBeenCalled();
      click('entry-onetime-confirm');
      click('entry-onetime-confirm');
      await flushPromises();

      expect(v2.payOneTimeObligation).toHaveBeenCalledTimes(1);
      expect(v2.payOneTimeObligation).toHaveBeenCalledWith(
        'budget-id',
        expect.objectContaining({
          plannedAmount: '500',
          actualAmount: '500',
          accountId: 'account-id',
          categoryId: 'category-id',
          name: expect.any(String),
          occurredOn: expect.any(String),
        }),
        expect.any(String),
      );
      expect(v2.createTransaction).not.toHaveBeenCalled();
      expect(useOperationDialogs().openDialog.value).toBe('none');
      wrapper.unmount();
    });

    it('reuses the idempotency key on retry and shows the server error', async () => {
      v2.createTransaction.mockRejectedValueOnce(new Error('Недостаточно средств.'));
      v2.createTransaction.mockResolvedValueOnce({ id: 'expense-id' });
      const wrapper = await openExpense();

      click('entry-submit');
      await flushPromises();
      expect(document.body.textContent).toContain('Недостаточно средств.');
      click('entry-submit');
      await flushPromises();

      expect(v2.createTransaction).toHaveBeenCalledTimes(2);
      expect(v2.createTransaction.mock.calls[1]![2]).toBe(v2.createTransaction.mock.calls[0]![2]);
      wrapper.unmount();
    });

    it('creates a transfer with only accounts, amount and date and no envelope questions', async () => {
      v2.createTransfer.mockResolvedValue({ id: 'transfer-id' });
      const wrapper = mount(AppOperationDialogs, { attachTo: document.body });
      useOperationDialogs().openTransfer();
      await flushPromises();

      expect(
        document.querySelector('[data-testid="pill-transferEnvelope-envelope-id"]'),
      ).toBeNull();
      expect(document.querySelector('[data-testid="entry-split-transfer"]')).toBeNull();
      typeAmount('2000');
      click('pill-transferSource-account-id');
      click('pill-transferDestination-savings-id');
      await flushPromises();
      click('entry-submit');
      await flushPromises();

      expect(v2.createTransfer).toHaveBeenCalledTimes(1);
      const [id, body] = v2.createTransfer.mock.calls[0]!;
      expect(id).toBe('budget-id');
      expect(body).not.toHaveProperty('parts');
      expect(body).toEqual({
        sourceAccountId: 'account-id',
        destinationAccountId: 'savings-id',
        amount: '2000',
        occurredOn: expect.any(String),
      });
      wrapper.unmount();
    });

    function deferred<T>() {
      let resolve!: (value: T) => void;
      const promise = new Promise<T>((done) => {
        resolve = done;
      });
      return { promise, resolve };
    }

    async function openMandatoryStep(): Promise<ReturnType<typeof mount>> {
      const wrapper = await openExpense();
      click('pill-envelope-mandatory-id');
      await flushPromises();
      click('entry-submit');
      await flushPromises();
      return wrapper;
    }

    async function openV2Transfer(): Promise<ReturnType<typeof mount>> {
      // A dialog left open by a failed flow would keep its previous tab.
      useOperationDialogs().close();
      const wrapper = mount(AppOperationDialogs, { attachTo: document.body });
      useOperationDialogs().openTransfer();
      await flushPromises();
      typeAmount('2000');
      click('pill-transferSource-account-id');
      click('pill-transferDestination-savings-id');
      await flushPromises();
      return wrapper;
    }

    function alertText(): string {
      return document.querySelector('[role="alert"]')?.textContent ?? '';
    }

    it('moves focus into the one-time step and back to the submit button', async () => {
      const wrapper = await openMandatoryStep();
      await flushPromises();
      expect((document.activeElement as HTMLElement | null)?.getAttribute('name')).toBe(
        'oneTimeName',
      );

      click('entry-onetime-back');
      await flushPromises();
      expect(document.querySelector('[data-testid="entry-onetime"]')).toBeNull();
      expect(document.activeElement).toBe(document.querySelector('[data-testid="entry-submit"]'));
      wrapper.unmount();
    });

    it('lets the header back button leave the one-time step and disables the type tabs there', async () => {
      const wrapper = await openMandatoryStep();

      expect(
        document.querySelector<HTMLButtonElement>('[data-testid="entry-tab-INCOME"]')?.disabled,
      ).toBe(true);
      document.querySelector<HTMLButtonElement>('.entry-dialog__back')?.click();
      await flushPromises();

      expect(document.querySelector('[data-testid="entry-onetime"]')).toBeNull();
      expect(useOperationDialogs().openDialog.value).toBe('entry');
      expect(
        document.querySelector<HTMLButtonElement>('[data-testid="entry-tab-INCOME"]')?.disabled,
      ).toBe(false);
      wrapper.unmount();
    });

    it('shows a field-level error for an empty one-time payment name', async () => {
      const wrapper = await openMandatoryStep();
      const name = document.querySelector<HTMLInputElement>('input[name="oneTimeName"]')!;
      name.value = '';
      name.dispatchEvent(new Event('input', { bubbles: true }));
      await flushPromises();
      click('entry-onetime-confirm');
      await flushPromises();

      expect(document.querySelector('.ui-field__error')?.textContent).toContain(
        'Укажите название платежа',
      );
      expect(
        document.querySelector('input[name="oneTimeName"]')?.getAttribute('aria-invalid'),
      ).toBe('true');
      expect(v2.payOneTimeObligation).not.toHaveBeenCalled();
      wrapper.unmount();
    });

    it('sends exact v2 payloads for the one-time payment, expense and income', async () => {
      v2.payOneTimeObligation.mockResolvedValue({ transaction: { id: 'tx' } });
      let wrapper = await openMandatoryStep();
      click('entry-onetime-confirm');
      await flushPromises();
      expect(v2.payOneTimeObligation.mock.calls[0]![1]).toEqual({
        name: 'Продукты',
        plannedAmount: '500',
        actualAmount: '500',
        occurredOn: expect.any(String),
        accountId: 'account-id',
        categoryId: 'category-id',
      });
      wrapper.unmount();

      v2.createTransaction.mockResolvedValue({ id: 'expense-id' });
      useFundingEntry().dismiss();
      wrapper = await openExpense();
      click('entry-submit');
      await flushPromises();
      expect(v2.createTransaction.mock.calls[0]![1]).toEqual({
        transactionType: 'EXPENSE',
        status: 'CONFIRMED',
        amount: '500',
        occurredOn: expect.any(String),
        accountId: 'account-id',
        categoryId: 'category-id',
        envelopeId: null,
      });
      // A confirmed v2 expense never offers a funding assignment.
      expect(useFundingEntry().request.value).toBeNull();
      wrapper.unmount();

      v2.createTransaction.mockClear();
      wrapper = mount(AppOperationDialogs, { attachTo: document.body });
      useOperationDialogs().openOperation('INCOME');
      await flushPromises();
      typeAmount('1000');
      click('pill-account-account-id');
      click('pill-category-income-category-id');
      await flushPromises();
      click('entry-submit');
      await flushPromises();
      const income = v2.createTransaction.mock.calls[0]![1];
      expect(income).not.toHaveProperty('envelopeId');
      expect(income).toEqual({
        transactionType: 'INCOME',
        status: 'CONFIRMED',
        amount: '1000',
        occurredOn: expect.any(String),
        accountId: 'account-id',
        categoryId: 'income-category-id',
      });
      wrapper.unmount();
    });

    it('does not offer an assignment when a v2 income fails to save', async () => {
      useFundingEntry().dismiss();
      v2.createTransaction.mockRejectedValue(new Error('network'));
      const wrapper = mount(AppOperationDialogs, { attachTo: document.body });
      useOperationDialogs().openOperation('INCOME');
      await flushPromises();
      typeAmount('1000');
      click('pill-account-account-id');
      click('pill-category-income-category-id');
      await flushPromises();
      click('entry-submit');
      await flushPromises();

      expect(useFundingEntry().request.value).toBeNull();
      expect(useOperationDialogs().openDialog.value).toBe('entry');
      wrapper.unmount();
    });

    it('uses a new key after a field changes, and after success for the same input', async () => {
      v2.createTransaction.mockRejectedValueOnce(new Error('x'));
      v2.createTransaction.mockResolvedValue({ id: 'expense-id' });
      let wrapper = await openExpense();
      click('entry-submit');
      await flushPromises();
      typeAmount('600');
      await flushPromises();
      click('entry-submit');
      await flushPromises();
      expect(v2.createTransaction.mock.calls[1]![2]).not.toBe(
        v2.createTransaction.mock.calls[0]![2],
      );
      wrapper.unmount();

      // Identical input entered again after a success is a new attempt.
      useOperationDialogs().close();
      wrapper = await openExpense();
      typeAmount('600');
      await flushPromises();
      click('entry-submit');
      await flushPromises();
      expect(v2.createTransaction.mock.calls[2]![2]).not.toBe(
        v2.createTransaction.mock.calls[1]![2],
      );
      wrapper.unmount();
    });

    it('keeps the key of a failed one-time payment on retry', async () => {
      v2.payOneTimeObligation.mockRejectedValueOnce(new Error('x'));
      v2.payOneTimeObligation.mockResolvedValue({ transaction: { id: 'tx' } });
      const wrapper = await openMandatoryStep();
      click('entry-onetime-confirm');
      await flushPromises();
      click('entry-onetime-confirm');
      await flushPromises();

      expect(v2.payOneTimeObligation).toHaveBeenCalledTimes(2);
      expect(v2.payOneTimeObligation.mock.calls[1]![2]).toBe(
        v2.payOneTimeObligation.mock.calls[0]![2],
      );
      wrapper.unmount();
    });

    it('uses a new key for a v2 transfer after the amount changes', async () => {
      v2.createTransfer.mockRejectedValue(new Error('x'));
      const wrapper = await openV2Transfer();
      click('entry-submit');
      await flushPromises();
      click('entry-submit');
      await flushPromises();
      expect(v2.createTransfer.mock.calls[1]![2]).toBe(v2.createTransfer.mock.calls[0]![2]);

      typeAmount('2100');
      await flushPromises();
      click('entry-submit');
      await flushPromises();
      expect(v2.createTransfer.mock.calls[2]![2]).not.toBe(v2.createTransfer.mock.calls[1]![2]);
      wrapper.unmount();
    });

    it('sends one request when submit is pressed twice while a save is in flight', async () => {
      const slow = deferred<{ id: string }>();
      v2.createTransaction.mockReturnValue(slow.promise);
      let wrapper = await openExpense();
      click('entry-submit');
      click('entry-submit');
      await flushPromises();
      expect(v2.createTransaction).toHaveBeenCalledTimes(1);
      slow.resolve({ id: 'x' });
      await flushPromises();
      wrapper.unmount();

      const slowPay = deferred<{ transaction: { id: string } }>();
      v2.payOneTimeObligation.mockReturnValue(slowPay.promise);
      wrapper = await openMandatoryStep();
      click('entry-onetime-confirm');
      click('entry-onetime-confirm');
      await flushPromises();
      expect(v2.payOneTimeObligation).toHaveBeenCalledTimes(1);
      slowPay.resolve({ transaction: { id: 'x' } });
      await flushPromises();
      wrapper.unmount();

      const slowTransfer = deferred<{ id: string }>();
      v2.createTransfer.mockReturnValue(slowTransfer.promise);
      wrapper = await openV2Transfer();
      click('entry-submit');
      click('entry-submit');
      await flushPromises();
      expect(v2.createTransfer).toHaveBeenCalledTimes(1);
      slowTransfer.resolve({ id: 'x' });
      await flushPromises();
      wrapper.unmount();
    });

    it.each([
      [409, 'MANDATORY_ENVELOPE_REQUIRED', 'Обязательные расходы'],
      [409, 'INSUFFICIENT_BALANCE', 'Недостаточно средств'],
      [409, 'IDEMPOTENCY_CONFLICT', 'другими данными'],
      [409, 'MODEL_VERSION_MISMATCH', 'Обновите страницу'],
      [422, 'VALIDATION_FAILED', 'Проверьте введённые данные'],
    ])(
      'shows a Russian alert for %s %s in all v2 flows and keeps the key',
      async (status, code, text) => {
        const failure = () => new ApiRequestError(status, { code, detail: 'raw english detail' });
        v2.createTransaction.mockRejectedValue(failure());
        v2.payOneTimeObligation.mockRejectedValue(failure());
        v2.createTransfer.mockRejectedValue(failure());

        let wrapper = await openExpense();
        click('entry-submit');
        await flushPromises();
        click('entry-submit');
        await flushPromises();
        expect(alertText()).toContain(text);
        expect(alertText()).not.toContain('raw english');
        expect(useOperationDialogs().openDialog.value).toBe('entry');
        expect(v2.createTransaction.mock.calls[1]![2]).toBe(v2.createTransaction.mock.calls[0]![2]);
        wrapper.unmount();

        wrapper = await openMandatoryStep();
        click('entry-onetime-confirm');
        await flushPromises();
        click('entry-onetime-confirm');
        await flushPromises();
        expect(alertText()).toContain(text);
        expect(useOperationDialogs().openDialog.value).toBe('entry');
        expect(v2.payOneTimeObligation.mock.calls[1]![2]).toBe(
          v2.payOneTimeObligation.mock.calls[0]![2],
        );
        wrapper.unmount();

        wrapper = await openV2Transfer();
        click('entry-submit');
        await flushPromises();
        click('entry-submit');
        await flushPromises();
        expect(alertText()).toContain(text);
        expect(useOperationDialogs().openDialog.value).toBe('entry');
        expect(v2.createTransfer.mock.calls[1]![2]).toBe(v2.createTransfer.mock.calls[0]![2]);
        wrapper.unmount();
      },
    );
  });
});
