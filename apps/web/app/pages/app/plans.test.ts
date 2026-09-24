import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiRequestError } from '../../composables/useApiClient.js';

const api = {
  listRegularPlans: vi.fn(),
  listPlanOccurrences: vi.fn(),
  listTransactions: vi.fn(),
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
const auth = {
  currentData: {
    value: {
      workspaces: [{ budgets: [{ id: 'budget-id', name: 'Бюджет', primaryCurrency: 'RUB' }] }],
    },
  },
  loadMe: vi.fn(),
};
const { navigateTo, route } = vi.hoisted(() => ({ navigateTo: vi.fn(), route: { query: {} } }));

vi.mock('#imports', () => ({
  definePageMeta: vi.fn(),
  navigateTo,
  useRoute: () => route,
}));
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
  transactionType: 'EXPENSE' as const,
  status: 'CONFIRMED' as const,
  amountMinor: '85000',
  currency: 'RUB' as const,
  scale: 2 as const,
  occurredOn: '2026-09-13',
  accountId: 'account-id',
  categoryId: 'category-id',
  envelopeId: 'envelope-id',
  sourceDescription: null,
  merchantName: null,
  isPlanned: false,
  comment: null,
  confirmedAt: '2026-09-13T00:00:00.000Z',
  cancelledAt: null,
  deletedAt: null,
  accountCurrentBalanceMinor: '0',
  envelopeCurrentBalanceMinor: '0',
  unallocatedMinor: '0',
  allocationProposal: null,
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
    api.listTransactions.mockResolvedValue({ items: [transaction], nextCursor: null });
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
    expect(api.listTransactions).toHaveBeenCalled();
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
    api.listTransactions.mockClear();

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
    expect(api.listTransactions).toHaveBeenCalled();
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
