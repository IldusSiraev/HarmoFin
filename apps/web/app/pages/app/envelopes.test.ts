import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
            '<div v-if="open"><button data-confirm="archive-envelope" @click="$emit(\'confirm\')">Подтвердить</button></div>',
        },
      },
    },
  });
}

describe('envelopes page', () => {
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

  it('creates envelope while preserving decimal text as normalized string', async () => {
    mocks.api.createEnvelope.mockResolvedValue(envelope);
    mocks.api.listEnvelopes.mockResolvedValueOnce([]).mockResolvedValueOnce([envelope]);
    const wrapper = mountPage();

    await flushPromises();
    await wrapper.get('[data-action="create-envelope"]').trigger('click');
    await wrapper.get('input[name="name"]').setValue('Ремонт');
    await wrapper.get('input[name="startingBalance"]').setValue('123,45');
    await wrapper.get('input[name="displayOrder"]').setValue('1');
    await wrapper.get('form[data-envelope-form]').trigger('submit');
    await flushPromises();

    expect(mocks.api.createEnvelope).toHaveBeenCalledWith(
      'budget-id',
      expect.objectContaining({ startingBalance: '123.45' }),
    );
  });

  it('requires explicit archive confirmation', async () => {
    mocks.api.listEnvelopes.mockResolvedValue([envelope]);
    mocks.api.archiveEnvelope.mockResolvedValue({
      ...envelope,
      archivedAt: '2026-09-04T00:00:00.000Z',
    });
    const wrapper = mountPage();

    await flushPromises();
    await wrapper.get('[data-action="archive-envelope"]').trigger('click');
    expect(mocks.api.archiveEnvelope).not.toHaveBeenCalled();
    await wrapper.get('[data-confirm="archive-envelope"]').trigger('click');
    await flushPromises();
    expect(mocks.api.archiveEnvelope).toHaveBeenCalledWith('budget-id', 'envelope-id');
  });

  it('shows period slot selection only for current-expense envelope', async () => {
    const wrapper = mountPage();

    await flushPromises();
    await wrapper.get('[data-action="create-envelope"]').trigger('click');
    await wrapper.get('select[name="envelopeType"]').setValue('CURRENT_EXPENSES');

    expect(wrapper.get('select[name="periodSlot"]').text()).toContain('Первый период');
  });
});
