import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: { currentData: { value: null as unknown }, loadMe: vi.fn() },
  api: {
    getBudget: vi.fn(),
    listEnvelopes: vi.fn(),
    createEnvelope: vi.fn(),
    updateEnvelope: vi.fn(),
    archiveEnvelope: vi.fn(),
  },
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

function mountPage() {
  return mount(EnvelopesPage, {
    attachTo: document.body,
    global: {
      stubs: {
        NuxtLink: { template: '<a><slot /></a>' },
        EnvelopeCard: {
          template:
            '<article><strong>{{ envelope.name }}</strong><slot name="actions" /></article>',
          props: ['envelope'],
        },
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
    const startingBalanceInput = document.querySelector('input[name="startingBalance"]') as HTMLInputElement;
    const displayOrderInput = document.querySelector('input[name="displayOrder"]') as HTMLInputElement;
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

    const envelopeTypeSelect = document.querySelector('select[name="envelopeType"]') as HTMLSelectElement;
    envelopeTypeSelect.value = 'CURRENT_EXPENSES';
    envelopeTypeSelect.dispatchEvent(new Event('change', { bubbles: true }));
    await flushPromises();

    const periodSlotSelect = document.querySelector('select[name="periodSlot"]') as HTMLSelectElement;
    expect(periodSlotSelect.textContent).toContain('Первый период');
  });
});
