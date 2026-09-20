import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiRequestError } from '../../../composables/useApiClient.js';

const mocks = vi.hoisted(() => {
  return {
    auth: { currentData: { value: null as unknown }, loadMe: vi.fn() },
    api: { getBudget: vi.fn(), updateBudget: vi.fn() },
  };
});

vi.mock('../../../composables/useAuth.js', () => ({ useAuth: () => mocks.auth }));
vi.mock('../../../composables/useBudgetReferenceData.js', () => ({
  useBudgetReferenceData: () => mocks.api,
}));

import GeneralSettingsPage from './general.vue';

const budget = {
  id: 'budget-id',
  workspaceId: 'workspace-id',
  name: 'Семейный бюджет',
  primaryCurrency: 'RUB',
  timezone: 'Europe/Moscow',
  cycleStartDay: 10,
  periodBoundaryOffset: 15,
  allowNegativeBalance: false,
  incomeAllocationRuleEnabled: false,
  incomeAllocationSourceCategoryId: null,
  incomeAllocationTargetEnvelopeId: null,
  status: 'ACTIVE' as const,
};

function mountPage() {
  return mount(GeneralSettingsPage, {
    global: { stubs: { NuxtLink: { template: '<a><slot /></a>' } } },
  });
}

describe('settings general page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.currentData.value = {
      user: { id: 'user-id', email: 'owner@example.test', displayName: null },
      workspaces: [
        {
          id: 'workspace-id',
          name: 'Семья',
          role: 'OWNER',
          budgets: [{ id: 'budget-id', name: 'Семейный бюджет', primaryCurrency: 'RUB' }],
        },
      ],
    };
    mocks.auth.loadMe.mockResolvedValue(mocks.auth.currentData.value);
    mocks.api.getBudget.mockResolvedValue(budget);
  });

  it('saves name, timezone and negative-balance without touching the income rule', async () => {
    mocks.api.updateBudget.mockResolvedValue(budget);
    const wrapper = mountPage();
    await flushPromises();

    await wrapper.get('[name="name"]').setValue('Новое имя');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(mocks.api.updateBudget).toHaveBeenCalledWith('budget-id', {
      name: 'Новое имя',
      timezone: 'Europe/Moscow',
      allowNegativeBalance: false,
    });
    expect(wrapper.text()).toContain('Общие настройки сохранены.');
  });

  it('shows a field error next to the matching control', async () => {
    mocks.api.updateBudget.mockRejectedValue(
      new ApiRequestError(400, {
        code: 'VALIDATION_FAILED',
        detail: 'Не доверять этой детали.',
        fieldErrors: [{ field: 'name', message: 'Укажите название.', code: 'custom' }],
      }),
    );
    const wrapper = mountPage();
    await flushPromises();
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(wrapper.text()).toContain('Укажите название.');
    expect(wrapper.get('[name="name"]').attributes('aria-invalid')).toBe('true');
  });
});
