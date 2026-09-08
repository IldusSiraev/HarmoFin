import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = {
  listRegularPlans: vi.fn(),
  listPlanOccurrences: vi.fn(),
  listAccounts: vi.fn(),
  listCategories: vi.fn(),
  listEnvelopes: vi.fn(),
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
const { navigateTo } = vi.hoisted(() => ({ navigateTo: vi.fn() }));

vi.mock('#imports', () => ({
  definePageMeta: vi.fn(),
  navigateTo,
  useRoute: () => ({ query: {} }),
}));
vi.mock('../../composables/useAuth.js', () => ({ useAuth: () => auth }));
vi.mock('../../composables/useBudgetReferenceData.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useBudgetReferenceData: () => api,
}));

import PlansPage from './plans.vue';

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

describe('plans page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listRegularPlans.mockResolvedValue([]);
    api.listPlanOccurrences.mockResolvedValue([occurrence]);
    api.listAccounts.mockResolvedValue([]);
    api.listCategories.mockResolvedValue([]);
    api.listEnvelopes.mockResolvedValue([]);
    api.createPlanOccurrenceDraft.mockResolvedValue({ id: 'draft-id', status: 'DRAFT' });
  });

  it('opens occurrence draft in operation editor', async () => {
    const wrapper = mount(PlansPage, {
      global: { stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } },
    });
    await flushPromises();

    await wrapper.get('[data-action="create-occurrence-draft"]').trigger('click');

    expect(api.createPlanOccurrenceDraft).toHaveBeenCalledWith(
      'budget-id',
      'occurrence-id',
      expect.any(String),
    );
    expect(navigateTo).toHaveBeenCalledWith('/app/operations?draftId=draft-id');
  });

  it('does not offer draft creation for savings occurrence', async () => {
    api.listPlanOccurrences.mockResolvedValue([{ ...occurrence, planType: 'SAVINGS' }]);
    const wrapper = mount(PlansPage);
    await flushPromises();

    expect(wrapper.text()).toContain('Отметить выполненным');
    expect(wrapper.find('[data-action="create-occurrence-draft"]').exists()).toBe(false);
  });
});
