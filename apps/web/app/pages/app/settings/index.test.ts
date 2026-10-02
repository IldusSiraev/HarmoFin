import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiRequestError } from '../../../composables/useApiClient.js';

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
    },
    v2: {
      getTemplatePreview: vi.fn(),
      applyTemplate: vi.fn(),
    },
  };
});

vi.mock('../../../composables/useAuth.js', () => ({
  useAuth: () => mocks.auth,
}));

vi.mock('../../../composables/useEnvelopePlanV2.js', () => ({
  useEnvelopePlanV2: () => mocks.v2,
}));

vi.mock('../../../composables/useBudgetReferenceData.js', () => ({
  useBudgetReferenceData: () => mocks.api,
}));

import SettingsPage from './index.vue';

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
  return mount(SettingsPage, {
    attachTo: document.body,
    global: {
      // The default NuxtLink auto-stub drops `to`, so href-based assertions
      // below need it forwarded explicitly.
      stubs: { NuxtLink: { template: '<a :href="to"><slot /></a>', props: ['to'] } },
    },
  });
}

describe('settings hub page', () => {
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

  it('shows the three cards with links to the sub-pages and the account email', async () => {
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.text()).toContain('Бюджет');
    expect(wrapper.text()).toContain('Аккаунт');
    expect(wrapper.text()).toContain('Финансовый цикл');
    expect(wrapper.text()).toContain('owner@example.test');
    expect(wrapper.find('a[href="/app/settings/general"]').exists()).toBe(true);
    expect(wrapper.find('a[href="/app/settings/password"]').exists()).toBe(true);
    expect(wrapper.find('a[href="/app/settings/sessions"]').exists()).toBe(true);
  });

  it('keeps a link to the help page', async () => {
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find('a[href="/app/help"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('Как пользоваться HarmoFin');
  });

  it('orders the cards so a single column reads «Бюджет», «Финансовый цикл», «Аккаунт»', async () => {
    const wrapper = mountPage();
    await flushPromises();

    const headings = wrapper.findAll('section h2').map((heading) => heading.text());
    expect(headings).toEqual(['Бюджет', 'Финансовый цикл', 'Аккаунт']);
  });

  it('does not show the income allocation rule anywhere on the page', async () => {
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.text()).not.toContain('распределение дохода');
    expect(wrapper.find('[name="incomeAllocationSourceCategoryId"]').exists()).toBe(false);
  });

  it('saves the financial cycle fields independently and refreshes them', async () => {
    mocks.api.updateBudget.mockResolvedValue({
      ...budget,
      cycleStartDay: 5,
      periodBoundaryOffset: 20,
    });
    const wrapper = mountPage();
    await flushPromises();

    await wrapper.get('[name="cycleStartDay"]').setValue('5');
    await wrapper.get('[name="periodBoundaryOffset"]').setValue('20');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(mocks.api.updateBudget).toHaveBeenCalledWith('budget-id', {
      cycleStartDay: 5,
      periodBoundaryOffset: 20,
    });
    expect(wrapper.text()).toContain('Финансовый цикл сохранён.');
  });

  it('shows a validation error beside the matching cycle field', async () => {
    mocks.api.updateBudget.mockRejectedValue(
      new ApiRequestError(400, {
        code: 'VALIDATION_FAILED',
        detail: 'Не доверять этой детали.',
        fieldErrors: [{ field: 'cycleStartDay', message: 'Некорректное число.', code: 'custom' }],
      }),
    );
    const wrapper = mountPage();
    await flushPromises();
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(wrapper.text()).toContain('Некорректное число.');
    expect(wrapper.get('[name="cycleStartDay"]').attributes('aria-invalid')).toBe('true');
  });

  it('disables the template action while pending and shows the result', async () => {
    let completeRequest: (() => void) | undefined;
    mocks.api.initializeTemplate.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
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

    expect(wrapper.text()).toContain('Базовый шаблон создан.');
    expect(wrapper.get('.ui-status').classes()).toContain('ui-status--success');
  });

  it('reports a failed template creation with the danger tone', async () => {
    mocks.api.initializeTemplate.mockRejectedValue(new Error('boom'));
    const wrapper = mountPage();
    await flushPromises();

    await wrapper.get('[data-action="initialize-template"]').trigger('click');
    await flushPromises();

    const status = wrapper.get('.ui-status');
    expect(status.text()).toBe('Не удалось выполнить действие. Повторите попытку.');
    expect(status.classes()).toContain('ui-status--danger');
  });

  describe('Envelope Plan v2 budget', () => {
    const match = {
      matchedBy: null,
      existingId: null,
      existingName: null,
      archivedId: null,
      collisionId: null,
      suggestedAction: 'CREATE',
      requiresConsent: false,
    };

    beforeEach(() => {
      mocks.auth.currentData.value = {
        user: { id: 'user-id', email: 'owner@example.test', displayName: null },
        workspaces: [
          {
            id: 'workspace-id',
            name: 'Семья',
            role: 'OWNER',
            budgets: [
              {
                id: 'budget-id',
                name: 'Семейный бюджет',
                primaryCurrency: 'RUB',
                planModelVersion: 2,
              },
            ],
          },
        ],
      };
      mocks.v2.getTemplatePreview.mockResolvedValue({
        cycle: { ...match, status: 'EXISTING', cycleStartDay: 1, periodBoundaryOffset: 14 },
        categories: [],
        envelopes: [
          {
            ...match,
            status: 'MISSING',
            role: 'FIRST',
            templateKey: 'v2-period-first',
            name: 'Первый период',
            type: 'CURRENT_EXPENSES',
            periodSlot: 'FIRST',
            selectable: false,
            suggestedRuleType: 'MANUAL',
            existingRuleType: null,
            suggestedTargetMinor: null,
            replacementTemplateKey: null,
          },
          {
            ...match,
            status: 'MISSING',
            role: 'SECOND',
            templateKey: 'v2-period-second',
            name: 'Второй период',
            type: 'CURRENT_EXPENSES',
            periodSlot: 'SECOND',
            selectable: false,
            suggestedRuleType: 'MANUAL',
            existingRuleType: null,
            suggestedTargetMinor: null,
            replacementTemplateKey: null,
          },
          {
            ...match,
            status: 'MISSING',
            role: 'MANDATORY',
            templateKey: 'v2-mandatory',
            name: 'Обязательные',
            type: 'MANDATORY_EXPENSES',
            periodSlot: null,
            selectable: false,
            suggestedRuleType: 'SUM_OF_PLANS',
            existingRuleType: null,
            suggestedTargetMinor: null,
            replacementTemplateKey: null,
          },
        ],
        isComplete: false,
        previewHash: 'a'.repeat(64),
      });
    });

    it('opens the preview instead of calling the v1 template POST', async () => {
      const wrapper = mountPage();
      await flushPromises();

      await wrapper.get('[data-action="initialize-template"]').trigger('click');
      await flushPromises();

      expect(mocks.api.initializeTemplate).not.toHaveBeenCalled();
      expect(mocks.v2.getTemplatePreview).toHaveBeenCalledWith('budget-id');
      expect(document.body.textContent).toContain('Укажу позже');
      wrapper.unmount();
      document.body.innerHTML = '';
    });
  });
});
