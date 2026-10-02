import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: { currentData: { value: null as unknown }, loadMe: vi.fn() },
  v2: { getDashboard: vi.fn(), getTemplatePreview: vi.fn(), applyTemplate: vi.fn() },
}));

vi.mock('../../composables/useAuth.js', () => ({ useAuth: () => mocks.auth }));
vi.mock('../../composables/useEnvelopePlanV2.js', () => ({ useEnvelopePlanV2: () => mocks.v2 }));

import OnboardingChecklist from './OnboardingChecklist.vue';
import { useFundingEntry } from '../../composables/useFundingEntry.js';

function setBudget(version: 1 | 2): void {
  mocks.auth.currentData.value = {
    user: { id: 'u', email: 'o@example.test', displayName: null },
    workspaces: [
      {
        id: 'w',
        name: 'Семья',
        role: 'OWNER',
        budgets: [
          { id: 'budget-1', name: 'Бюджет', primaryCurrency: 'RUB', planModelVersion: version },
        ],
      },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  setBudget(1);
});

const mounted: Array<{ unmount: () => void }> = [];

afterEach(() => {
  while (mounted.length > 0) mounted.pop()?.unmount();
  document.body.innerHTML = '';
  useFundingEntry().dismiss();
});

const NuxtLinkStub = {
  name: 'NuxtLink',
  props: { to: { type: String, required: true } },
  template: '<a :href="to"><slot /></a>',
};

const notStarted = {
  categoriesSeeded: false,
  cycleConfigured: false,
  hasAccounts: false,
  hasEnvelopeStartingBalances: false,
  hasAllocatedIncome: false,
};

function mountChecklist(
  onboarding: typeof notStarted,
  initializeTemplate = vi
    .fn()
    .mockResolvedValue({ createdCategoryKeys: [], existingCategoryKeys: [] }),
) {
  const wrapper = mount(OnboardingChecklist, {
    props: { budgetId: 'budget-1', onboarding, initializeTemplate },
    attachTo: document.body,
    global: { stubs: { NuxtLink: NuxtLinkStub } },
  });
  mounted.push(wrapper);
  return { wrapper, initializeTemplate };
}

describe('OnboardingChecklist', () => {
  it('shows all five steps as not started for a fresh budget', () => {
    const { wrapper } = mountChecklist(notStarted);

    expect(wrapper.findAll('[data-testid="onboarding-step"]')).toHaveLength(5);
    expect(wrapper.findAll('[data-testid="onboarding-step-done"]')).toHaveLength(0);
  });

  it('marks completed steps and links to the right pages', () => {
    const { wrapper } = mountChecklist({
      categoriesSeeded: true,
      cycleConfigured: true,
      hasAccounts: true,
      hasEnvelopeStartingBalances: false,
      hasAllocatedIncome: false,
    });

    expect(wrapper.findAll('[data-testid="onboarding-step-done"]')).toHaveLength(3);
    const links = wrapper.findAll('a').map((link) => link.attributes('href'));
    expect(links).toContain('/app/settings');
    expect(links).toContain('/app/accounts');
    expect(links).toContain('/app/envelopes');
    expect(links).toContain('/app/operations');
  });

  it('calls initializeTemplate when the first step button is clicked', async () => {
    const { wrapper, initializeTemplate } = mountChecklist(notStarted);

    await wrapper.get('[data-action="onboarding-initialize-template"]').trigger('click');
    await flushPromises();

    expect(initializeTemplate).toHaveBeenCalledWith('budget-1');
    expect(wrapper.emitted('templateInitialized')).toHaveLength(1);
  });

  it('renders nothing once every step is complete', () => {
    const { wrapper } = mountChecklist({
      categoriesSeeded: true,
      cycleConfigured: true,
      hasAccounts: true,
      hasEnvelopeStartingBalances: true,
      hasAllocatedIncome: true,
    });

    expect(wrapper.find('[data-testid="onboarding-checklist"]').exists()).toBe(false);
  });

  it('announces a template-init failure to screen readers', async () => {
    const { wrapper } = mountChecklist(notStarted, vi.fn().mockRejectedValue(new Error('boom')));

    await wrapper.get('[data-action="onboarding-initialize-template"]').trigger('click');
    await flushPromises();

    const status = wrapper.find('.ui-status--danger');
    expect(status.text()).toBe('Не удалось выполнить действие. Повторите попытку.');
    expect(status.attributes('aria-live')).toBe('polite');
  });

  it('collapses to a progress pill and expands again', async () => {
    const { wrapper } = mountChecklist({ ...notStarted, hasAccounts: true });

    await wrapper.get('[data-action="onboarding-collapse"]').trigger('click');
    expect(wrapper.find('[data-testid="onboarding-pill"]').text()).toContain('1/5');
    expect(wrapper.find('[data-testid="onboarding-step"]').exists()).toBe(false);

    await wrapper.get('[data-testid="onboarding-pill"]').trigger('click');
    expect(wrapper.findAll('[data-testid="onboarding-step"]')).toHaveLength(5);
  });

  describe('Envelope Plan v2 budget', () => {
    const v2Onboarding = {
      categoriesSeeded: false,
      hasAccounts: true,
      needsOpeningAssignment: true,
      needsPeriodSetup: true,
      hasMandatoryPlans: false,
    };
    const match = {
      matchedBy: null,
      existingId: null,
      existingName: null,
      archivedId: null,
      collisionId: null,
      suggestedAction: 'CREATE',
      requiresConsent: false,
    };

    function dashboard(onboarding = v2Onboarding) {
      return { planModelVersion: 2, onboarding };
    }

    beforeEach(() => {
      setBudget(2);
      mocks.v2.getDashboard.mockResolvedValue(dashboard());
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
        ],
        isComplete: false,
        previewHash: 'a'.repeat(64),
      });
    });

    it('opens the shared preview instead of the v1 template POST', async () => {
      const { wrapper, initializeTemplate } = mountChecklist(notStarted);
      await flushPromises();

      await wrapper.get('[data-action="onboarding-initialize-template"]').trigger('click');
      await flushPromises();

      expect(initializeTemplate).not.toHaveBeenCalled();
      expect(mocks.v2.getTemplatePreview).toHaveBeenCalledWith('budget-1');
      expect(document.body.textContent).toContain('Укажу позже');
      wrapper.unmount();
    });

    it('derives the steps from the v2 dashboard onboarding status', async () => {
      const { wrapper } = mountChecklist(notStarted);
      await flushPromises();

      expect(mocks.v2.getDashboard).toHaveBeenCalledWith('budget-1');
      const text = wrapper.text();
      expect(text).toContain('Назначить имеющиеся деньги');
      expect(text).not.toContain('Начальные остатки конвертов');
      expect(text).not.toContain('Первый доход и распределение');
      // only hasAccounts is done
      expect(wrapper.findAll('[data-testid="onboarding-step-done"]')).toHaveLength(1);
    });

    it('marks the assignment step done only from the server status', async () => {
      mocks.v2.getDashboard.mockResolvedValue(
        dashboard({
          categoriesSeeded: true,
          hasAccounts: true,
          needsOpeningAssignment: false,
          needsPeriodSetup: true,
          hasMandatoryPlans: false,
        }),
      );
      const { wrapper } = mountChecklist(notStarted);
      await flushPromises();

      expect(wrapper.findAll('[data-testid="onboarding-step-done"]')).toHaveLength(3);
    });

    it('offers the opening assignment without creating any expense', async () => {
      const { wrapper } = mountChecklist(notStarted);
      await flushPromises();

      await wrapper.get('[data-action="onboarding-assign-money"]').trigger('click');

      expect(useFundingEntry().request.value?.source).toEqual({ sourceKind: 'OPENING' });
    });

    it('refreshes the v2 status after the template is applied', async () => {
      mocks.v2.applyTemplate.mockResolvedValue({
        created: { categories: [], envelopes: [] },
        adopted: [],
        skipped: [],
        rules: [],
        cycle: { changed: false, resetPeriods: 0 },
        isComplete: true,
        previewHash: 'b'.repeat(64),
      });
      const { wrapper } = mountChecklist(notStarted);
      await flushPromises();
      await wrapper.get('[data-action="onboarding-initialize-template"]').trigger('click');
      await flushPromises();
      expect(mocks.v2.getDashboard).toHaveBeenCalledTimes(1);

      document.querySelector<HTMLElement>('[data-testid="template-apply"]')?.click();
      await flushPromises();

      expect(mocks.v2.getDashboard).toHaveBeenCalledTimes(2);
      expect(wrapper.emitted('templateInitialized')).toHaveLength(1);
      wrapper.unmount();
    });
  });
});
