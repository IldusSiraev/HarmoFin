import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  // useFundingEntry reads the active budget from the auth state.
  auth: {
    currentData: {
      value: {
        user: { id: 'u', email: 'o@example.test', displayName: null },
        workspaces: [
          {
            id: 'w',
            name: 'Семья',
            role: 'OWNER',
            budgets: [
              { id: 'budget-1', name: 'Бюджет', primaryCurrency: 'RUB', planModelVersion: 2 },
            ],
          },
        ],
      },
    },
    loadMe: vi.fn(),
  },
  v2: { getDashboard: vi.fn(), getTemplatePreview: vi.fn(), applyTemplate: vi.fn() },
}));

vi.mock('../../composables/useAuth.js', () => ({ useAuth: () => mocks.auth }));
vi.mock('../../composables/useEnvelopePlanV2.js', () => ({ useEnvelopePlanV2: () => mocks.v2 }));

import OnboardingChecklist from './OnboardingChecklist.vue';
import { useFundingEntry } from '../../composables/useFundingEntry.js';

beforeEach(() => {
  vi.clearAllMocks();
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

function mountChecklist() {
  const wrapper = mount(OnboardingChecklist, {
    props: { budgetId: 'budget-1' },
    attachTo: document.body,
    global: { stubs: { NuxtLink: NuxtLinkStub } },
  });
  mounted.push(wrapper);
  return { wrapper };
}

describe('OnboardingChecklist', () => {
  beforeEach(() => {
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

  it('opens the shared template preview from the first step', async () => {
    const { wrapper } = mountChecklist();
    await flushPromises();

    await wrapper.get('[data-action="onboarding-initialize-template"]').trigger('click');
    await flushPromises();

    expect(mocks.v2.getTemplatePreview).toHaveBeenCalledWith('budget-1');
    expect(document.body.textContent).toContain('Укажу позже');
    expect(wrapper.text()).not.toContain('Создать базовый шаблон');
    wrapper.unmount();
  });

  it('collapses to a progress pill and expands again', async () => {
    const { wrapper } = mountChecklist();
    await flushPromises();

    await wrapper.get('[data-action="onboarding-collapse"]').trigger('click');
    expect(wrapper.find('[data-testid="onboarding-pill"]').text()).toContain('1/5');
    expect(wrapper.find('[data-testid="onboarding-step"]').exists()).toBe(false);

    await wrapper.get('[data-testid="onboarding-pill"]').trigger('click');
    expect(wrapper.findAll('[data-testid="onboarding-step"]')).toHaveLength(5);
  });

  it('renders nothing once every step is complete', async () => {
    mocks.v2.getDashboard.mockResolvedValue(
      dashboard({
        categoriesSeeded: true,
        hasAccounts: true,
        needsOpeningAssignment: false,
        needsPeriodSetup: false,
        hasMandatoryPlans: true,
      }),
    );
    const { wrapper } = mountChecklist();
    await flushPromises();

    expect(wrapper.find('[data-testid="onboarding-checklist"]').exists()).toBe(false);
  });

  it('derives the steps from the v2 dashboard onboarding status', async () => {
    const { wrapper } = mountChecklist();
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
    const { wrapper } = mountChecklist();
    await flushPromises();

    expect(wrapper.findAll('[data-testid="onboarding-step-done"]')).toHaveLength(3);
  });

  it('offers the opening assignment without creating any expense', async () => {
    const { wrapper } = mountChecklist();
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
    const { wrapper } = mountChecklist();
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
