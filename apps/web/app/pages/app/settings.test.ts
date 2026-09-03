import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiRequestError } from '../../composables/useApiClient.js';

const mocks = vi.hoisted(() => {
  return {
    auth: {
      currentData: { value: null as unknown },
      loadMe: vi.fn(),
    },
    api: {
      getBudget: vi.fn(),
      updateBudget: vi.fn(),
      initializeTemplate: vi.fn(),
      listCategories: vi.fn(),
      listEnvelopes: vi.fn(),
    },
  };
});

vi.mock('../../composables/useAuth.js', () => ({
  useAuth: () => mocks.auth,
}));

vi.mock('../../composables/useBudgetReferenceData.js', () => ({
  useBudgetReferenceData: () => mocks.api,
}));

import SettingsPage from './settings.vue';

const budget = {
  id: 'budget-id',
  workspaceId: 'workspace-id',
  name: 'Семейный бюджет',
  primaryCurrency: 'RUB',
  timezone: 'Europe/Moscow',
  cycleStartDay: 10,
  periodBoundaryOffset: 5,
  allowNegativeBalance: false,
  incomeAllocationRuleEnabled: false,
  incomeAllocationSourceCategoryId: null,
  incomeAllocationTargetEnvelopeId: null,
  status: 'ACTIVE' as const,
};

function mountPage() {
  return mount(SettingsPage, {
    global: {
      stubs: {
        NuxtLink: { template: '<a><slot /></a>' },
      },
    },
  });
}

describe('settings page', () => {
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
    mocks.api.listCategories.mockResolvedValue([]);
    mocks.api.listEnvelopes.mockResolvedValue([]);
  });

  it('uses server DTO and places field error beside matching control', async () => {
    mocks.api.updateBudget.mockRejectedValue(
      new ApiRequestError(400, {
        code: 'VALIDATION_FAILED',
        detail: 'Не доверять этой детали.',
        fieldErrors: [
          { field: 'timezone', message: 'Укажите корректный часовой пояс.', code: 'custom' },
        ],
      }),
    );
    const wrapper = mountPage();

    await flushPromises();
    await wrapper.get('[name="timezone"]').setValue('bad-zone');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(wrapper.text()).toContain('Укажите корректный часовой пояс.');
    expect(wrapper.get('[name="timezone"]').attributes('aria-invalid')).toBe('true');
    expect(mocks.api.updateBudget).toHaveBeenCalledWith(
      'budget-id',
      expect.objectContaining({ timezone: 'bad-zone', allowNegativeBalance: false }),
    );
  });

  it('keeps unchecked negative-balance option as boolean and refreshes server data after save', async () => {
    mocks.api.updateBudget.mockResolvedValue(budget);
    const wrapper = mountPage();

    await flushPromises();
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(mocks.api.updateBudget).toHaveBeenCalledWith(
      'budget-id',
      expect.objectContaining({ allowNegativeBalance: false }),
    );
    expect(mocks.api.getBudget).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).toContain('Настройки бюджета сохранены.');
  });

  it('disables template action while request is pending and reloads server data', async () => {
    let completeRequest: (() => void) | undefined;
    mocks.api.initializeTemplate.mockImplementation(
      () => new Promise<void>((resolve) => {
        completeRequest = resolve;
      }),
    );
    const wrapper = mountPage();

    await flushPromises();
    const button = wrapper.get('[data-action="initialize-template"]');
    await button.trigger('click');

    expect(button.attributes('disabled')).toBeDefined();
    completeRequest?.();
    await flushPromises();

    expect(mocks.api.getBudget).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).toContain('Базовый шаблон создан.');
  });

  it('does not show unconfirmed automatic allocation references', async () => {
    const wrapper = mountPage();

    await flushPromises();

    expect(wrapper.find('[name="incomeAllocationSourceCategoryId"]').exists()).toBe(false);
    expect(wrapper.find('[name="incomeAllocationTargetEnvelopeId"]').exists()).toBe(false);
  });
});
