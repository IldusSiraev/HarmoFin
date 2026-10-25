import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    mocks.auth.loadMe.mockResolvedValue(mocks.auth.currentData.value);
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

  it('links to account deletion from the account card', async () => {
    const wrapper = mountPage();
    await flushPromises();

    const link = wrapper.find('a[href="/app/settings/delete-account"]');
    expect(link.exists()).toBe(true);
    expect(link.text()).toContain('Удаление аккаунта');
    wrapper.unmount();
  });

  it('keeps a link to the help page', async () => {
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find('a[href="/app/help"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('Как пользоваться HarmoFin');
  });

  it('orders the cards so a single column reads «Бюджет», «Финансовый цикл», «Семья», «Аккаунт»', async () => {
    const wrapper = mountPage();
    await flushPromises();

    const headings = wrapper.findAll('section h2').map((heading) => heading.text());
    expect(headings).toEqual(['Бюджет', 'Финансовый цикл', 'Семья', 'Аккаунт']);
  });

  it('links to the family page before the account card', async () => {
    const wrapper = mountPage();
    await flushPromises();

    const link = wrapper.find('a[href="/app/settings/family"]');
    expect(link.exists()).toBe(true);
    expect(link.text()).toContain('Участники и приглашения');
  });

  it('does not show the income allocation rule anywhere on the page', async () => {
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.text()).not.toContain('распределение дохода');
    expect(wrapper.find('[name="incomeAllocationSourceCategoryId"]').exists()).toBe(false);
  });

  it('links to the cycle preview flow instead of an inline cycle form', async () => {
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find('[name="cycleStartDay"]').exists()).toBe(false);
    expect(wrapper.find('form').exists()).toBe(false);
    expect(mocks.api.getBudget).not.toHaveBeenCalled();
    expect(mocks.api.updateBudget).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('Изменить цикл');
    expect(wrapper.text()).not.toContain('Создать базовый шаблон');
  });

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

  it('shows the running application version as secondary text', async () => {
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find('.settings-page__version').text()).toBe('Версия 0.0.0-test');
  });

  it('opens the template preview', async () => {
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

  type MockedWorkspaces = { workspaces: Array<{ role: string }> };

  it('hides the template and cycle management for a viewer', async () => {
    (mocks.auth.currentData.value as MockedWorkspaces).workspaces[0]!.role = 'VIEWER';
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find('[data-action="initialize-template"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('Изменить цикл');
  });

  it('hides the template and cycle management for an editor too', async () => {
    (mocks.auth.currentData.value as MockedWorkspaces).workspaces[0]!.role = 'EDITOR';
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find('[data-action="initialize-template"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('Изменить цикл');
  });
});
