import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: { currentData: { value: null as unknown }, loadMe: vi.fn() },
  api: {
    getBudget: vi.fn(),
    listEnvelopes: vi.fn(),
    getEnvelopesSummary: vi.fn(),
    createEnvelope: vi.fn(),
    updateEnvelope: vi.fn(),
    archiveEnvelope: vi.fn(),
  },
  route: { path: '/app/envelopes', query: {} as Record<string, string> },
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

import EnvelopesPage from './envelopes.vue';

const envelope = {
  id: 'envelope-id',
  budgetId: 'budget-id',
  templateKey: null,
  name: 'Ремонт',
  envelopeType: 'SAVINGS_GOAL' as const,
  periodSlot: null,
  currency: 'RUB' as const,
  scale: 2 as const,
  startingBalanceMinor: '0',
  currentBalanceMinor: '12345',
  monthlyPlannedAmountMinor: null,
  targetAmountMinor: '500000',
  targetDate: '2027-01-01',
  displayOrder: 0,
  comment: null,
  archivedAt: null,
};

const currentExpenseEnvelope = {
  ...envelope,
  id: 'envelope-two-id',
  name: 'Продукты',
  envelopeType: 'CURRENT_EXPENSES' as const,
  targetAmountMinor: null,
};

const normalize = (value: string): string => value.replace(/[\u00a0\u202f]/g, ' ');

function mountPage() {
  return mount(EnvelopesPage, {
    attachTo: document.body,
    global: {
      stubs: {
        NuxtLink: { template: '<a><slot /></a>' },
        UiConfirmDialog: {
          props: ['open'],
          template:
            '<div v-if="open" data-confirm-dialog><button data-confirm="archive-envelope" @click="$emit(\'confirm\')">Подтвердить</button><button @click="$emit(\'cancel\')">Отмена</button></div>',
        },
      },
    },
  });
}

describe('envelopes page', () => {
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
    mocks.api.getBudget.mockResolvedValue({
      id: 'budget-id',
      workspaceId: 'workspace-id',
      name: 'Бюджет',
      primaryCurrency: 'RUB',
      timezone: 'Europe/Moscow',
      cycleStartDay: 10,
      periodBoundaryOffset: 5,
      allowNegativeBalance: false,
      incomeAllocationRuleEnabled: false,
      incomeAllocationSourceCategoryId: null,
      incomeAllocationTargetEnvelopeId: null,
      status: 'ACTIVE',
    });
    mocks.api.listEnvelopes.mockResolvedValue([]);
    mocks.api.getEnvelopesSummary.mockResolvedValue({
      currency: 'RUB',
      scale: 2,
      totalMinor: '210000',
      count: 1,
      byType: [{ envelopeType: 'CURRENT_EXPENSES', totalMinor: '210000', count: 1 }],
    });
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
      wrapper = null;
    }
  });

  it('creates envelope while preserving decimal text as normalized string', async () => {
    mocks.api.createEnvelope.mockResolvedValue(envelope);
    mocks.api.listEnvelopes.mockResolvedValueOnce([]).mockResolvedValueOnce([envelope]);
    wrapper = mountPage();

    await flushPromises();
    await wrapper.get('[data-action="create-envelope"]').trigger('click');
    await flushPromises();

    // Form is Teleported to body, access via document
    const nameInput = document.querySelector('input[name="name"]') as HTMLInputElement;
    const startingBalanceInput = document.querySelector(
      'input[name="startingBalance"]',
    ) as HTMLInputElement;
    const displayOrderInput = document.querySelector(
      'input[name="displayOrder"]',
    ) as HTMLInputElement;
    const form = document.querySelector('form[data-envelope-form]') as HTMLFormElement;

    nameInput.value = 'Ремонт';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();

    startingBalanceInput.value = '123,45';
    startingBalanceInput.dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();

    displayOrderInput.value = '1';
    displayOrderInput.dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();

    form.dispatchEvent(new Event('submit', { bubbles: true }));
    await flushPromises();

    expect(mocks.api.createEnvelope).toHaveBeenCalledWith(
      'budget-id',
      expect.objectContaining({ startingBalance: '123.45' }),
    );
    expect(mocks.api.listEnvelopes).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).toContain('Ремонт');
  });

  it('requires explicit archive confirmation', async () => {
    mocks.api.listEnvelopes.mockResolvedValue([envelope]);
    mocks.api.archiveEnvelope.mockResolvedValue({
      ...envelope,
      archivedAt: '2026-09-04T00:00:00.000Z',
    });
    wrapper = mountPage();

    await flushPromises();
    await wrapper.get('[data-testid="row-actions-envelope-id"]').trigger('click');
    await wrapper.get('[data-action="archive-envelope"]').trigger('click');
    expect(mocks.api.archiveEnvelope).not.toHaveBeenCalled();
    await wrapper.get('[data-confirm="archive-envelope"]').trigger('click');
    await flushPromises();
    expect(mocks.api.archiveEnvelope).toHaveBeenCalledWith('budget-id', 'envelope-id');
  });

  it('shows period slot selection only for current-expense envelope', async () => {
    wrapper = mountPage();

    await flushPromises();
    await wrapper.get('[data-action="create-envelope"]').trigger('click');
    await flushPromises();

    const envelopeTypeSelect = document.querySelector(
      'select[name="envelopeType"]',
    ) as HTMLSelectElement;
    envelopeTypeSelect.value = 'CURRENT_EXPENSES';
    envelopeTypeSelect.dispatchEvent(new Event('change', { bubbles: true }));
    await flushPromises();

    const periodSlotSelect = document.querySelector(
      'select[name="periodSlot"]',
    ) as HTMLSelectElement;
    expect(periodSlotSelect.textContent).toContain('Первый период');
  });

  it('groups envelopes by type with the server total in the heading', async () => {
    mocks.api.listEnvelopes.mockResolvedValue([currentExpenseEnvelope]);
    wrapper = mountPage();
    await flushPromises();

    const headings = wrapper.findAll('[data-testid="envelope-group-label"]');
    expect(headings.length).toBeGreaterThan(0);
    expect(normalize(headings[0]?.text() ?? '')).toContain('Текущие расходы');
    expect(normalize(wrapper.get('[data-testid="envelope-group-total"]').text())).toContain(
      '2 100,00 ₽',
    );
  });

  it('opens the drawer from a row', async () => {
    mocks.api.listEnvelopes.mockResolvedValue([currentExpenseEnvelope]);
    wrapper = mountPage();
    await flushPromises();

    await wrapper.get('[data-testid="list-row-select"]').trigger('click');

    expect(wrapper.find('[data-testid="drawer"]').exists()).toBe(true);
  });

  it('switches both requests to the archive from the chip', async () => {
    mocks.api.listEnvelopes.mockResolvedValue([currentExpenseEnvelope]);
    wrapper = mountPage();
    await flushPromises();

    await wrapper.get('[data-testid="chip-archived"]').trigger('click');
    await flushPromises();

    expect(mocks.api.listEnvelopes).toHaveBeenLastCalledWith('budget-id', 'archived');
    expect(mocks.api.getEnvelopesSummary).toHaveBeenLastCalledWith('budget-id', 'archived');
  });
});
