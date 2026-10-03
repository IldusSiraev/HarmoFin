import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiRequestError } from '../../composables/useApiClient.js';

const api = {
  listRegularPlans: vi.fn(),
  listPlanOccurrences: vi.fn(),
  listAccounts: vi.fn(),
  listCategories: vi.fn(),
  listEnvelopes: vi.fn(),
  createRegularPlan: vi.fn(),
  updateRegularPlan: vi.fn(),
  deleteRegularPlan: vi.fn(),
  skipPlanOccurrence: vi.fn(),
  completePlanOccurrence: vi.fn(),
  createPlanOccurrenceDraft: vi.fn(),
};
const v2 = {
  listTransactions: vi.fn(),
  listObligationOccurrences: vi.fn(),
  payObligation: vi.fn(),
  skipObligationOccurrence: vi.fn(),
  listIncomeOccurrences: vi.fn(),
  recordIncomeOccurrence: vi.fn(),
  createTransaction: vi.fn(),
};
const funding = { offer: vi.fn(), dismiss: vi.fn() };
const budgetRow: { id: string; name: string; primaryCurrency: string; planModelVersion?: 1 | 2 } = {
  id: 'budget-id',
  name: 'Бюджет',
  primaryCurrency: 'RUB',
};
const auth = {
  currentData: { value: { workspaces: [{ budgets: [budgetRow] }] } },
  loadMe: vi.fn(),
};
const { navigateTo, route } = vi.hoisted(() => ({ navigateTo: vi.fn(), route: { query: {} } }));

vi.mock('#imports', () => ({
  definePageMeta: vi.fn(),
  navigateTo,
  useRoute: () => route,
}));
vi.mock('../../composables/useEnvelopePlanV2.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useEnvelopePlanV2: () => v2,
}));
vi.mock('../../composables/useFundingEntry.js', () => ({ useFundingEntry: () => funding }));
vi.mock('../../composables/useAuth.js', () => ({ useAuth: () => auth }));
vi.mock('../../composables/useBudgetReferenceData.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useBudgetReferenceData: () => api,
}));

import PlansPage from './plans.vue';

function mountPage() {
  return mount(PlansPage, {
    attachTo: document.body,
    global: { stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } },
  });
}

const occurrence = {
  id: 'occurrence-id',
  planId: 'plan-id',
  planName: 'Ипотека',
  planType: 'EXPENSE' as const,
  scheduledOn: '2026-09-10',
  status: 'DUE' as const,
  amountMinor: '3600000',
  currency: 'RUB' as const,
  scale: 2 as const,
  accountId: 'account-id',
  categoryId: 'category-id',
  envelopeId: 'envelope-id',
  comment: null,
  transactionId: null,
  cancellationReason: null,
};

const transaction = {
  id: 'transaction-id',
  budgetId: 'budget-id',
  accountingModelVersion: 2 as const,
  transactionType: 'EXPENSE' as const,
  status: 'CONFIRMED' as const,
  amountMinor: '85000',
  currency: 'RUB',
  occurredOn: '2026-09-13',
  accountId: 'account-id',
  categoryId: 'category-id',
  envelopeId: 'envelope-id',
  sourceDescription: null,
  merchantName: null,
  comment: null,
  planOccurrenceIds: [],
  confirmedAt: '2026-09-13T00:00:00.000Z',
  cancelledAt: null,
  deletedAt: null,
  createdAt: '2026-09-13T00:00:00.000Z',
};

describe('plans page', () => {
  let wrapper: ReturnType<typeof mountPage> | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    // The page computes "today" from the real clock (`format(new Date(), ...)`
    // in plans.vue) to build the default calendar month and the overdue/
    // upcoming dot split — pin it so the fixed 2026-09-10/2026-09-13 dates
    // below always fall inside the rendered grid regardless of when this
    // suite actually runs. Fake only `Date`, not timers — `flushPromises()`
    // from `@vue/test-utils` resolves via a real `setTimeout`, which would
    // hang forever under full fake timers.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-24T00:00:00.000Z'));
    route.query = {};
    api.listRegularPlans.mockResolvedValue([]);
    api.listPlanOccurrences.mockResolvedValue([occurrence]);
    v2.listTransactions.mockResolvedValue({ items: [transaction], nextCursor: null });
    api.listAccounts.mockResolvedValue([{ id: 'account-id', name: 'Счёт планов' }]);
    api.listCategories.mockResolvedValue([
      { id: 'category-id', name: 'Расходы планов', categoryType: 'EXPENSE', icon: null },
    ]);
    api.listEnvelopes.mockResolvedValue([
      { id: 'envelope-id', name: 'Конверт планов', envelopeType: 'CURRENT_EXPENSES' },
    ]);
    api.createRegularPlan.mockResolvedValue({ id: 'plan-id' });
    api.completePlanOccurrence.mockResolvedValue({ ...occurrence, status: 'COMPLETED' });
    api.createPlanOccurrenceDraft.mockResolvedValue({ id: 'draft-id', status: 'DRAFT' });
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
      wrapper = null;
    }
    vi.useRealTimers();
  });

  it('marks plan controls ready after client hydration and loads calendar-range data', async () => {
    wrapper = mountPage();
    await flushPromises();

    expect(wrapper.get('[data-hydrated]').attributes('data-hydrated')).toBe('true');
    expect(api.listPlanOccurrences).toHaveBeenCalled();
    expect(v2.listTransactions).toHaveBeenCalled();
  });

  it('selects a day and opens the create-draft flow for its occurrence', async () => {
    wrapper = mountPage();
    await flushPromises();

    await wrapper.get('[data-date="2026-09-10"]').trigger('click');
    await flushPromises();
    await wrapper.get('[data-testid="action-menu-trigger"]').trigger('click');
    await wrapper.get('[data-testid="row-draft"]').trigger('click');

    expect(api.createPlanOccurrenceDraft).toHaveBeenCalledWith(
      'budget-id',
      'occurrence-id',
      expect.any(String),
    );
    expect(navigateTo).toHaveBeenCalledWith('/app/operations?draftId=draft-id');
  });

  it('places server validation errors beside the plan field', async () => {
    api.createRegularPlan.mockRejectedValue(
      new ApiRequestError(400, {
        code: 'VALIDATION_FAILED',
        detail: 'Проверьте поля формы.',
        fieldErrors: [{ field: 'name', message: 'Укажите название плана.', code: 'custom' }],
      }),
    );
    wrapper = mountPage();
    await flushPromises();

    await wrapper.get('[data-action="create-plan"]').trigger('click');
    await flushPromises();

    const planForm = document.querySelector('form.plan-form') as HTMLFormElement;
    const nameInput = document.querySelector(
      'form.plan-form input[name="name"]',
    ) as HTMLInputElement;

    nameInput.value = '';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();

    planForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushPromises();

    const fullText = document.body.innerText;
    expect(fullText).toContain('Укажите название плана.');
    expect(nameInput.getAttribute('aria-invalid')).toBe('true');
  });

  it('selects the day of the occurrence referenced by the notification route', async () => {
    route.query = { occurrence: 'occurrence-id' };
    wrapper = mountPage();
    await flushPromises();

    expect(wrapper.get('[data-date="2026-09-10"]').classes()).toContain(
      'plans-calendar__cell--selected',
    );
  });

  it('moves the calendar to the month of a deep-linked occurrence outside the default month', async () => {
    route.query = { occurrence: 'occurrence-id' };
    api.listPlanOccurrences.mockResolvedValue([{ ...occurrence, scheduledOn: '2026-11-05' }]);
    wrapper = mountPage();
    await flushPromises();

    expect(wrapper.get('[data-date="2026-11-05"]').classes()).toContain(
      'plans-calendar__cell--selected',
    );
    expect(api.listPlanOccurrences).toHaveBeenCalledWith(
      'budget-id',
      expect.objectContaining({ from: expect.stringMatching(/^2026-10/) }),
    );
  });

  it('lets the user navigate away from a deep-linked occurrence month', async () => {
    route.query = { occurrence: 'occurrence-id' };
    wrapper = mountPage();
    await flushPromises();

    // The DUE/PENDING lists that back "Ближайшие" are not range-scoped, so the
    // linked occurrence stays visible to the highlight lookup forever — it must
    // only be honoured once, otherwise every month change snaps back.
    await wrapper.get('[data-action="calendar-next-month"]').trigger('click');
    await flushPromises();

    expect(wrapper.find('[data-date="2026-10-15"]').exists()).toBe(true);
    expect(wrapper.get('[data-date="2026-10-01"]').classes()).toContain(
      'plans-calendar__cell--selected',
    );
  });

  it('keeps the page mounted on month change and refetches only range data', async () => {
    wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find('.plans-page__main').exists()).toBe(true);
    api.listRegularPlans.mockClear();
    api.listAccounts.mockClear();
    api.listCategories.mockClear();
    api.listEnvelopes.mockClear();
    api.listPlanOccurrences.mockClear();
    v2.listTransactions.mockClear();

    // The old `load()` flipped the page-wide `loading` flag synchronously, which
    // unmounted the whole calendar/day-panel/list block (and dropped keyboard
    // focus) before the new data arrived. `trigger` awaits a render tick, so a
    // regression would already be visible here.
    await wrapper.get('[data-action="calendar-next-month"]').trigger('click');
    expect(wrapper.find('.plans-page__main').exists()).toBe(true);
    expect(wrapper.find('[data-hydrated]').exists()).toBe(true);

    await flushPromises();

    expect(wrapper.find('.plans-page__main').exists()).toBe(true);
    expect(api.listPlanOccurrences).toHaveBeenCalled();
    expect(v2.listTransactions).toHaveBeenCalled();
    expect(api.listRegularPlans).not.toHaveBeenCalled();
    expect(api.listAccounts).not.toHaveBeenCalled();
    expect(api.listCategories).not.toHaveBeenCalled();
    expect(api.listEnvelopes).not.toHaveBeenCalled();
  });

  it('reconciles a selected day that falls outside the newly navigated month', async () => {
    wrapper = mountPage();
    await flushPromises();

    await wrapper.get('[data-date="2026-09-10"]').trigger('click');
    expect(wrapper.get('[data-date="2026-09-10"]').classes()).toContain(
      'plans-calendar__cell--selected',
    );

    await wrapper.get('[data-action="calendar-next-month"]').trigger('click');
    await flushPromises();

    expect(wrapper.get('[data-date="2026-10-01"]').classes()).toContain(
      'plans-calendar__cell--selected',
    );
    expect(wrapper.findAll('.plans-calendar__cell--selected')).toHaveLength(1);
  });
});

describe('plans page: v2 obligations', () => {
  let wrapper: ReturnType<typeof mountV2> | null = null;

  const daycare = {
    id: 'occ-daycare',
    planId: 'plan-daycare',
    name: 'Детский сад',
    scheduledOn: '2026-09-10',
    status: 'DUE' as const,
    expectedMinor: '300000',
    paidMinor: '0',
    unpaidMinor: '300000',
    categoryId: 'category-id',
    envelopeId: 'mandatory-envelope',
  };
  const rent = {
    ...daycare,
    id: 'occ-rent',
    planId: 'plan-rent',
    name: 'Аренда',
    scheduledOn: '2026-09-30',
    status: 'PENDING' as const,
    expectedMinor: '4000000',
    unpaidMinor: '4000000',
  };
  // Tomorrow relative to the pinned clock (2026-09-24).
  const salary = {
    id: 'inc-occ',
    planId: 'inc-plan',
    name: 'Зарплата',
    scheduledOn: '2026-09-25',
    status: 'PENDING',
    expectedMinor: '10000000',
    categoryId: 'income-cat',
    transactionId: null,
  };
  const confirmStub = {
    UiConfirmDialog: {
      props: ['open'],
      emits: ['confirm', 'cancel'],
      template:
        '<div v-if="open"><button data-testid="confirm-yes" @click="$emit(\'confirm\')">Да</button></div>',
    },
  };

  function mountV2() {
    return mount(PlansPage, {
      attachTo: document.body,
      global: {
        stubs: {
          NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
          ...confirmStub,
        },
      },
    });
  }

  async function openPay(id: string) {
    await wrapper!.get(`[data-testid="obligation-pay-${id}"]`).trigger('click');
    await flushPromises();
  }
  async function fillAndSubmit(amount: string, willPayMore = false) {
    await wrapper!.get('[data-testid="pay-amount"]').setValue(amount);
    await wrapper!.get('[data-testid="pill-accountId-account-id"]').trigger('click');
    if (willPayMore) await wrapper!.get('[data-testid="pay-will-pay-more"]').setValue(true);
    await wrapper!.get('[data-testid="pay-submit"]').trigger('click');
    await flushPromises();
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-24T00:00:00.000Z'));
    route.query = {};
    budgetRow.planModelVersion = 2;
    api.listRegularPlans.mockResolvedValue([]);
    api.listPlanOccurrences.mockResolvedValue([]);
    v2.listTransactions.mockResolvedValue({ items: [], nextCursor: null });
    api.listEnvelopes.mockResolvedValue([]);
    v2.listObligationOccurrences.mockResolvedValue({ items: [daycare, rent] });
    v2.payObligation.mockResolvedValue({ transaction: null, occurrence: daycare, warnings: [] });
    v2.skipObligationOccurrence.mockResolvedValue({ transaction: null, occurrence: daycare });
    v2.listIncomeOccurrences.mockResolvedValue({ items: [salary] });
    v2.recordIncomeOccurrence.mockResolvedValue({
      occurrence: { id: 'inc-occ', status: 'COMPLETED', transactionId: 'income-tx' },
      transaction: { id: 'income-tx', amountMinor: '8700000' },
    });
    api.listAccounts.mockResolvedValue([{ id: 'account-id', name: 'Карта' }]);
    api.listCategories.mockResolvedValue([
      { id: 'category-id', name: 'Детский сад', categoryType: 'EXPENSE', icon: null },
      { id: 'income-cat', name: 'Зарплата', categoryType: 'INCOME', icon: null },
    ]);
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = '';
    delete budgetRow.planModelVersion;
    vi.useRealTimers();
  });

  it('lists open obligations with an overdue marker before payment and skips v1 plan loads', async () => {
    wrapper = mountV2();
    await flushPromises();

    expect(v2.listObligationOccurrences).toHaveBeenCalledWith('budget-id', expect.anything());
    expect(api.listRegularPlans).not.toHaveBeenCalled();
    expect(api.listPlanOccurrences).not.toHaveBeenCalled();
    expect(wrapper.get('[data-testid="obligation-row-occ-daycare"]').text()).toContain(
      'Просрочено',
    );
    expect(wrapper.get('[data-testid="obligation-row-occ-rent"]').text()).not.toContain(
      'Просрочено',
    );
  });

  it('highlights and scrolls to the obligation named by ?occurrence= without any action', async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    route.query = { occurrence: 'occ-rent' };
    wrapper = mountV2();
    await flushPromises();

    const row = wrapper.get('[data-testid="obligation-row-occ-rent"]');
    expect(row.attributes('aria-current')).toBe('true');
    expect(row.classes()).toContain('obligation-row--linked');
    expect(
      wrapper.get('[data-testid="obligation-row-occ-daycare"]').attributes('aria-current'),
    ).toBe(undefined);
    expect(row.get('[data-testid="obligation-linked"]').text()).toContain('Из уведомления');
    expect(wrapper.findAll('[data-testid="obligation-linked"]')).toHaveLength(1);
    expect(scroll).toHaveBeenCalled();
    expect(v2.payObligation).not.toHaveBeenCalled();
    expect(v2.skipObligationOccurrence).not.toHaveBeenCalled();
  });

  it('ignores an unknown ?occurrence= id', async () => {
    route.query = { occurrence: 'no-such-id' };
    wrapper = mountV2();
    await flushPromises();

    expect(wrapper.find('[aria-current="true"]').exists()).toBe(false);
  });

  it('pays the actual amount once, then rereads the server state', async () => {
    wrapper = mountV2();
    await flushPromises();
    v2.listObligationOccurrences.mockResolvedValue({
      items: [
        { ...daycare, status: 'COMPLETED', paidMinor: '200000', unpaidMinor: '100000' },
        rent,
      ],
    });

    await openPay('occ-daycare');
    await fillAndSubmit('2000.00');

    expect(v2.payObligation).toHaveBeenCalledTimes(1);
    expect(v2.payObligation).toHaveBeenCalledWith(
      'budget-id',
      'occ-daycare',
      expect.objectContaining({
        amount: '2000.00',
        willPayMore: false,
        accountId: 'account-id',
        categoryId: 'category-id',
      }),
      expect.any(String),
    );
    expect(api.completePlanOccurrence).not.toHaveBeenCalled();
    expect(v2.listObligationOccurrences).toHaveBeenCalledTimes(2);
    expect(wrapper.find('[data-testid="drawer"]').exists()).toBe(false);
    expect(
      wrapper.get('[data-testid="obligation-row-occ-daycare"]').text().replace(/\s/g, ' '),
    ).toContain('1 000,00');
  });

  it('records a partial payment with willPayMore and leaves the occurrence open from the server', async () => {
    wrapper = mountV2();
    await flushPromises();
    v2.listObligationOccurrences.mockResolvedValue({
      items: [daycare, { ...rent, paidMinor: '3500000', unpaidMinor: '500000' }],
    });

    await openPay('occ-rent');
    await fillAndSubmit('35000.00', true);

    expect(v2.payObligation).toHaveBeenCalledTimes(1);
    expect(v2.payObligation).toHaveBeenCalledWith(
      'budget-id',
      'occ-rent',
      expect.objectContaining({ amount: '35000.00', willPayMore: true }),
      expect.any(String),
    );
    const row = wrapper.get('[data-testid="obligation-row-occ-rent"]');
    expect(row.find('[data-testid="obligation-pay-occ-rent"]').exists()).toBe(true);
    expect(row.text().replace(/\s/g, ' ')).toContain('5 000,00');
  });

  it('skips through the server action without creating a payment', async () => {
    wrapper = mountV2();
    await flushPromises();

    await wrapper.get('[data-testid="obligation-skip-occ-daycare"]').trigger('click');
    await wrapper.get('[data-testid="confirm-yes"]').trigger('click');
    await flushPromises();

    expect(v2.skipObligationOccurrence).toHaveBeenCalledWith(
      'budget-id',
      'occ-daycare',
      expect.any(String),
    );
    expect(v2.payObligation).not.toHaveBeenCalled();
    expect(api.createPlanOccurrenceDraft).not.toHaveBeenCalled();
  });

  it('protects against a double submit', async () => {
    v2.payObligation.mockReturnValue(new Promise(() => undefined));
    wrapper = mountV2();
    await flushPromises();

    await openPay('occ-daycare');
    await wrapper.get('[data-testid="pill-accountId-account-id"]').trigger('click');
    const submit = wrapper.get('[data-testid="pay-submit"]');
    await submit.trigger('click');
    await submit.trigger('click');

    expect(v2.payObligation).toHaveBeenCalledTimes(1);
  });

  it('reuses the key on retry of an unchanged attempt and shows a Russian server error', async () => {
    v2.payObligation
      .mockRejectedValueOnce(
        new ApiRequestError(409, { code: 'OCCURRENCE_NOT_OPEN', detail: 'raw english detail' }),
      )
      .mockResolvedValueOnce({ transaction: null, occurrence: daycare, warnings: [] });
    wrapper = mountV2();
    await flushPromises();

    await openPay('occ-daycare');
    await wrapper.get('[data-testid="pill-accountId-account-id"]').trigger('click');
    await wrapper.get('[data-testid="pay-submit"]').trigger('click');
    await flushPromises();

    const errorText = wrapper.get('[data-testid="pay-error"]').text();
    expect(errorText).toContain('уже закрыто');
    expect(errorText).not.toContain('raw english detail');

    await wrapper.get('[data-testid="pay-submit"]').trigger('click');
    await flushPromises();

    expect(v2.payObligation).toHaveBeenCalledTimes(2);
    expect(v2.payObligation.mock.calls[1]?.[3]).toBe(v2.payObligation.mock.calls[0]?.[3]);
  });

  it('labels icon-only row actions with the obligation name and shows Russian dates', async () => {
    wrapper = mountV2();
    await flushPromises();

    const pay = wrapper.get('[data-testid="obligation-pay-occ-daycare"]');
    expect(pay.attributes('aria-label')).toBe('Оплатить Детский сад');
    expect(pay.text()).toBe('');
    expect(
      wrapper.get('[data-testid="obligation-skip-occ-daycare"]').attributes('aria-label'),
    ).toBe('Пропустить Детский сад');
    const rowText = wrapper.get('[data-testid="obligation-row-occ-daycare"]').text();
    expect(rowText).toContain('10 сен');
    expect(rowText).not.toContain('2026-09-10');
  });

  it('focuses the amount field on open and returns focus to the row button on cancel and Escape', async () => {
    wrapper = mountV2();
    await flushPromises();
    const pay = wrapper.get('[data-testid="obligation-pay-occ-daycare"]');

    (pay.element as HTMLElement).focus();
    await pay.trigger('click');
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(document.activeElement?.id).toBe('obligation-pay-amount');

    await wrapper.get('[data-testid="pay-cancel"]').trigger('click');
    await flushPromises();
    expect(document.activeElement).toBe(pay.element);

    await pay.trigger('click');
    await flushPromises();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();
    expect(wrapper.find('[data-testid="drawer"]').exists()).toBe(false);
    expect(document.activeElement).toBe(pay.element);
  });

  it('moves focus to the list after a successful payment', async () => {
    wrapper = mountV2();
    await flushPromises();
    await openPay('occ-daycare');
    await fillAndSubmit('3000.00');

    expect(document.activeElement).toBe(wrapper.get('[data-testid="obligation-list"]').element);
  });

  it('sends one payment with a stable key and the date on a double submit', async () => {
    v2.payObligation.mockReturnValue(new Promise(() => undefined));
    wrapper = mountV2();
    await flushPromises();

    await openPay('occ-daycare');
    await wrapper.get('[data-testid="pill-accountId-account-id"]').trigger('click');
    const submit = wrapper.get('[data-testid="pay-submit"]');
    await submit.trigger('click');
    await submit.trigger('click');

    expect(v2.payObligation).toHaveBeenCalledTimes(1);
    expect(v2.payObligation.mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({ occurredOn: expect.stringMatching(/^2026-09-2[34]$/) }),
    );
    expect(v2.payObligation.mock.calls[0]?.[3]).toEqual(expect.any(String));
  });

  it('rereads obligations after a skip and explains a 409 in Russian', async () => {
    wrapper = mountV2();
    await flushPromises();
    await wrapper.get('[data-testid="obligation-skip-occ-daycare"]').trigger('click');
    await wrapper.get('[data-testid="confirm-yes"]').trigger('click');
    await flushPromises();
    expect(v2.listObligationOccurrences).toHaveBeenCalledTimes(2);

    v2.skipObligationOccurrence.mockRejectedValueOnce(
      new ApiRequestError(409, { code: 'OCCURRENCE_HAS_PAYMENTS', detail: 'raw english detail' }),
    );
    await wrapper.get('[data-testid="obligation-skip-occ-rent"]').trigger('click');
    await wrapper.get('[data-testid="confirm-yes"]').trigger('click');
    await flushPromises();
    const alertText = wrapper.get('.plans-page__error').text();
    expect(alertText).toContain('уже есть оплаты');
    expect(alertText).not.toContain('raw english detail');
  });

  it('keeps the v1 skip and complete actions on the legacy methods', async () => {
    budgetRow.planModelVersion = 1;
    api.listPlanOccurrences.mockResolvedValue([occurrence]);
    wrapper = mountV2();
    await flushPromises();
    await wrapper.get('[data-date="2026-09-10"]').trigger('click');
    await flushPromises();

    await wrapper.findAll('input[type="checkbox"]')[0]!.setValue(true);
    await flushPromises();
    expect(api.completePlanOccurrence).toHaveBeenCalledWith(
      'budget-id',
      'occurrence-id',
      expect.any(String),
    );

    await wrapper.findAll('[data-testid="action-menu-trigger"]')[0]!.trigger('click');
    await wrapper.findAll('[data-testid="row-skip"]')[0]!.trigger('click');
    await wrapper.get('[data-testid="confirm-yes"]').trigger('click');
    await flushPromises();
    expect(api.skipPlanOccurrence).toHaveBeenCalledWith(
      'budget-id',
      'occurrence-id',
      expect.any(String),
    );
    expect(v2.skipObligationOccurrence).not.toHaveBeenCalled();
    expect(v2.payObligation).not.toHaveBeenCalled();
  });

  describe('expected income', () => {
    async function openRecord() {
      await wrapper!.get('[data-testid="income-record-inc-occ"]').trigger('click');
      await flushPromises();
    }

    it('shows tomorrow income as a forecast and creates nothing on load', async () => {
      wrapper = mountV2();
      await flushPromises();

      const row = wrapper.get('[data-testid="income-row-inc-occ"]');
      expect(row.text().replace(/\s/g, ' ')).toContain('100 000,00');
      expect(row.text()).toContain('Прогноз — не входит в «На счетах»');
      expect(wrapper.get('[data-testid="income-list"]').text()).toContain(
        'Ожидаемое поступление не защищает текущие обязательства',
      );
      expect(v2.listIncomeOccurrences).toHaveBeenCalledTimes(1);
      expect(v2.recordIncomeOccurrence).not.toHaveBeenCalled();
      expect(v2.createTransaction).not.toHaveBeenCalled();
      expect(funding.offer).not.toHaveBeenCalled();
    });

    it('records the actual amount once, then offers funding for that income', async () => {
      wrapper = mountV2();
      await flushPromises();
      v2.listIncomeOccurrences.mockResolvedValue({
        items: [{ ...salary, status: 'COMPLETED', transactionId: 'income-tx' }],
      });

      await openRecord();
      await wrapper.get('[data-testid="income-amount"]').setValue('87000.00');
      await wrapper.get('[data-testid="pill-accountId-account-id"]').trigger('click');
      await wrapper.get('[data-testid="income-submit"]').trigger('click');
      await flushPromises();

      expect(v2.recordIncomeOccurrence).toHaveBeenCalledTimes(1);
      expect(v2.recordIncomeOccurrence).toHaveBeenCalledWith(
        'budget-id',
        'inc-occ',
        expect.objectContaining({
          amount: '87000.00',
          accountId: 'account-id',
          categoryId: 'income-cat',
        }),
        expect.any(String),
      );
      expect(funding.offer).toHaveBeenCalledTimes(1);
      expect(funding.offer).toHaveBeenCalledWith({
        sourceKind: 'INCOME',
        incomeTransactionId: 'income-tx',
      });
      // No automatic assignment and no deletion: dismissing the offer leaves the income.
      expect(v2.createTransaction).not.toHaveBeenCalled();
      expect(wrapper.find('[data-testid="drawer"]').exists()).toBe(false);
    });

    it('keeps obligations and shows an alert when the income forecast fails to load', async () => {
      v2.listIncomeOccurrences.mockRejectedValue(new Error('boom'));
      wrapper = mountV2();
      await flushPromises();

      expect(wrapper.find('[data-testid="obligation-row-occ-daycare"]').exists()).toBe(true);
      const alert = wrapper.get('[data-testid="income-list"] [role="alert"]');
      expect(alert.text()).toContain('Не удалось загрузить ожидаемые доходы');
      expect(v2.recordIncomeOccurrence).not.toHaveBeenCalled();
      expect(funding.offer).not.toHaveBeenCalled();
    });

    it('leaves the recorded income untouched when the funding offer is dismissed', async () => {
      wrapper = mountV2();
      await flushPromises();
      await openRecord();
      await wrapper.get('[data-testid="pill-accountId-account-id"]').trigger('click');
      await wrapper.get('[data-testid="income-submit"]').trigger('click');
      await flushPromises();

      funding.dismiss(); // «Позже»
      await flushPromises();

      const destructive = Object.keys(v2).filter((name) => /delete|cancel|revert/i.test(name));
      expect(destructive).toEqual([]);
      expect(v2.createTransaction).not.toHaveBeenCalled();
      expect(v2.payObligation).not.toHaveBeenCalled();
      expect(v2.skipObligationOccurrence).not.toHaveBeenCalled();
      expect(v2.recordIncomeOccurrence).toHaveBeenCalledTimes(1);
    });

    it('disables recording for a completed occurrence', async () => {
      v2.listIncomeOccurrences.mockResolvedValue({
        items: [{ ...salary, status: 'COMPLETED', transactionId: 'income-tx' }],
      });
      wrapper = mountV2();
      await flushPromises();

      const row = wrapper.get('[data-testid="income-row-inc-occ"]');
      expect(row.text()).toContain('Записан');
      expect(row.text()).not.toContain('Прогноз');
      const button = row.find('[data-testid="income-record-inc-occ"]');
      expect(!button.exists() || button.attributes('disabled') !== undefined).toBe(true);
    });

    it('sends one record call on a double submit', async () => {
      v2.recordIncomeOccurrence.mockReturnValue(new Promise(() => undefined));
      wrapper = mountV2();
      await flushPromises();

      await openRecord();
      await wrapper.get('[data-testid="pill-accountId-account-id"]').trigger('click');
      const submit = wrapper.get('[data-testid="income-submit"]');
      await submit.trigger('click');
      await submit.trigger('click');

      expect(v2.recordIncomeOccurrence).toHaveBeenCalledTimes(1);
      expect(v2.recordIncomeOccurrence.mock.calls[0]?.[2]).toEqual(
        expect.objectContaining({ amount: '100000.00' }),
      );
    });

    it('reuses the key on retry, changes it after an edit and shows Russian errors', async () => {
      v2.recordIncomeOccurrence
        .mockRejectedValueOnce(
          new ApiRequestError(409, { code: 'OCCURRENCE_NOT_OPEN', detail: 'raw english' }),
        )
        .mockRejectedValueOnce(
          new ApiRequestError(409, { code: 'OCCURRENCE_NOT_OPEN', detail: 'raw english' }),
        )
        .mockResolvedValue({
          occurrence: { id: 'inc-occ', status: 'COMPLETED', transactionId: 'income-tx' },
          transaction: { id: 'income-tx' },
        });
      wrapper = mountV2();
      await flushPromises();

      await openRecord();
      await wrapper.get('[data-testid="pill-accountId-account-id"]').trigger('click');
      await wrapper.get('[data-testid="income-submit"]').trigger('click');
      await flushPromises();
      expect(wrapper.get('[data-testid="income-error"]').text()).toContain('уже записан');
      expect(wrapper.get('[data-testid="income-error"]').text()).not.toContain('raw english');

      await wrapper.get('[data-testid="income-submit"]').trigger('click');
      await flushPromises();
      const calls = v2.recordIncomeOccurrence.mock.calls;
      expect(calls[1]?.[3]).toBe(calls[0]?.[3]);

      await wrapper.get('[data-testid="income-amount"]').setValue('90000.00');
      await wrapper.get('[data-testid="income-submit"]').trigger('click');
      await flushPromises();
      expect(v2.recordIncomeOccurrence.mock.calls[2]?.[3]).not.toBe(calls[0]?.[3]);
    });

    it('focuses the amount on open and returns focus to the row button on cancel', async () => {
      wrapper = mountV2();
      await flushPromises();
      const button = wrapper.get('[data-testid="income-record-inc-occ"]');

      (button.element as HTMLElement).focus();
      await button.trigger('click');
      await flushPromises();
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(document.activeElement?.id).toBe('income-record-amount');

      await wrapper.get('[data-testid="income-cancel"]').trigger('click');
      await flushPromises();
      expect(document.activeElement).toBe(button.element);
    });

    it('does not touch income plans for a v1 budget', async () => {
      budgetRow.planModelVersion = 1;
      wrapper = mountV2();
      await flushPromises();

      expect(v2.listIncomeOccurrences).not.toHaveBeenCalled();
      expect(wrapper.find('[data-testid="income-list"]').exists()).toBe(false);
    });
  });

  it('keeps the legacy plans UI for a v1 budget', async () => {
    budgetRow.planModelVersion = 1;
    wrapper = mountV2();
    await flushPromises();

    expect(v2.listObligationOccurrences).not.toHaveBeenCalled();
    expect(api.listRegularPlans).toHaveBeenCalled();
    expect(wrapper.find('.plans-page__main').exists()).toBe(true);
    expect(wrapper.find('[data-testid="obligation-list"]').exists()).toBe(false);
  });
});
