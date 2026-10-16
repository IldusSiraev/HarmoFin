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
  v2: {
    getDashboard: vi.fn(),
    getTemplatePreview: vi.fn(),
    applyTemplate: vi.fn(),
    confirmPeriodTarget: vi.fn(),
    rejectPeriodTarget: vi.fn(),
    declineMandatoryPlans: vi.fn(),
  },
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
  mandatoryPlansDeclined: false,
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

function dashboard(
  onboarding = v2Onboarding,
  proposal: { suggestedTarget: string | null; periodId: string | null } = {
    suggestedTarget: null,
    periodId: null,
  },
) {
  return {
    planModelVersion: 2,
    onboarding,
    suggestedTarget: proposal.suggestedTarget,
    period: { start: '2026-10-01', end: '2026-10-14', periodId: proposal.periodId },
  };
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

  it('orders the steps: accounts, mandatory payments, period plan, then money', async () => {
    const { wrapper } = mountChecklist();
    await flushPromises();

    expect(
      wrapper.findAll('[data-testid="onboarding-step"]').map((row) => row.attributes('data-step')),
    ).toEqual([
      'categoriesSeeded',
      'hasAccounts',
      'hasMandatoryPlans',
      'periodSetup',
      'openingAssignment',
    ]);
  });

  describe('mandatory payments step', () => {
    const mandatoryRow = (wrapper: ReturnType<typeof mountChecklist>['wrapper']) =>
      wrapper.get('[data-step="hasMandatoryPlans"]');

    it('offers to add a payment or to state there are none', async () => {
      const { wrapper } = mountChecklist();
      await flushPromises();

      const row = mandatoryRow(wrapper);
      expect(row.get('[data-testid="onboarding-mandatory-add"]').attributes('href')).toBe(
        '/app/plans',
      );
      expect(row.get('[data-testid="onboarding-mandatory-decline"]').text()).toBe('У меня их нет');
    });

    it('counts the step done when the owner declined mandatory payments', async () => {
      mocks.v2.getDashboard.mockResolvedValue(
        dashboard({ ...v2Onboarding, mandatoryPlansDeclined: true }),
      );
      const { wrapper } = mountChecklist();
      await flushPromises();

      const row = mandatoryRow(wrapper);
      expect(row.find('[data-testid="onboarding-step-done"]').exists()).toBe(true);
      expect(row.text()).toContain('Обязательных платежей нет.');
      expect(row.find('[data-testid="onboarding-mandatory-decline"]').exists()).toBe(false);
    });

    it('declines on click, rereads the status and announces it', async () => {
      mocks.v2.declineMandatoryPlans.mockResolvedValue(undefined);
      const { wrapper } = mountChecklist();
      await flushPromises();
      mocks.v2.getDashboard.mockResolvedValue(
        dashboard({ ...v2Onboarding, mandatoryPlansDeclined: true }),
      );

      await mandatoryRow(wrapper)
        .get('[data-testid="onboarding-mandatory-decline"]')
        .trigger('click');
      await flushPromises();

      expect(mocks.v2.declineMandatoryPlans).toHaveBeenCalledWith('budget-1', expect.any(String));
      expect(mocks.v2.getDashboard).toHaveBeenCalledTimes(2);
      expect(wrapper.get('[data-testid="onboarding-notice"]').text()).toBe(
        'Шаг «Обязательные платежи» пропущен.',
      );
      expect(mandatoryRow(wrapper).find('[data-testid="onboarding-step-done"]').exists()).toBe(
        true,
      );
    });

    it('shows the error, keeps the step open and reuses the key on retry', async () => {
      mocks.v2.declineMandatoryPlans.mockRejectedValueOnce(new Error('network'));
      const { wrapper } = mountChecklist();
      await flushPromises();

      const button = () =>
        mandatoryRow(wrapper).get('[data-testid="onboarding-mandatory-decline"]');
      await button().trigger('click');
      await flushPromises();

      expect(
        mandatoryRow(wrapper).get('[data-testid="onboarding-mandatory-error"]').text(),
      ).toContain('Не удалось');
      expect(mandatoryRow(wrapper).find('[data-testid="onboarding-step-done"]').exists()).toBe(
        false,
      );

      mocks.v2.declineMandatoryPlans.mockResolvedValueOnce(undefined);
      await button().trigger('click');
      await flushPromises();
      const [first, second] = mocks.v2.declineMandatoryPlans.mock.calls;
      expect(second![1]).toBe(first![1]);
    });

    it('sends a single request for a double click while pending', async () => {
      let resolve: () => void = () => {};
      mocks.v2.declineMandatoryPlans.mockReturnValue(
        new Promise<void>((done) => {
          resolve = done;
        }),
      );
      const { wrapper } = mountChecklist();
      await flushPromises();

      const button = mandatoryRow(wrapper).get('[data-testid="onboarding-mandatory-decline"]');
      await button.trigger('click');
      await button.trigger('click');
      resolve();
      await flushPromises();

      expect(mocks.v2.declineMandatoryPlans).toHaveBeenCalledTimes(1);
    });
  });

  it('warns on the money step until mandatory payments are settled', async () => {
    const { wrapper } = mountChecklist();
    await flushPromises();
    const warning =
      'Сначала добавьте обязательные платежи — иначе на них ничего не будет отложено.';
    expect(wrapper.get('[data-step="openingAssignment"]').text()).toContain(warning);

    mocks.v2.getDashboard.mockResolvedValue(
      dashboard({ ...v2Onboarding, hasMandatoryPlans: true }),
    );
    useFundingEntry().markConfirmed();
    await flushPromises();
    expect(wrapper.get('[data-step="openingAssignment"]').text()).not.toContain(warning);
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
        mandatoryPlansDeclined: false,
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
    expect(text).toContain('Распределить деньги по конвертам');
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
        mandatoryPlansDeclined: false,
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

  describe('period plan step', () => {
    const proposal = { suggestedTarget: '6500000', periodId: 'period-1' };

    beforeEach(() => {
      mocks.v2.getDashboard.mockResolvedValue(dashboard(v2Onboarding, proposal));
      mocks.v2.confirmPeriodTarget.mockResolvedValue({ periodId: 'period-1' });
      mocks.v2.rejectPeriodTarget.mockResolvedValue({ periodId: 'period-1' });
    });

    it('asks to confirm the proposed plan inside the step and explains the cycle is set', async () => {
      const { wrapper } = mountChecklist();
      await flushPromises();

      const step = wrapper.get('[data-step="periodSetup"]');
      expect(step.text()).toContain('Подтвердите лимит на период');
      expect(step.text()).toContain('Цикл уже задан в шаблоне');
      expect(step.text()).not.toContain('Периоды и цикл');
      expect(step.get('[data-testid="onboarding-target-amount"]').text()).toContain('65');
      expect(step.find('[data-testid="onboarding-target-confirm"]').exists()).toBe(true);
      expect(mocks.v2.confirmPeriodTarget).not.toHaveBeenCalled();
    });

    it('confirms the plan on click, refreshes the status and tells the page', async () => {
      const { wrapper } = mountChecklist();
      await flushPromises();

      await wrapper.get('[data-testid="onboarding-target-confirm"]').trigger('click');
      await flushPromises();

      expect(mocks.v2.confirmPeriodTarget).toHaveBeenCalledTimes(1);
      const [budgetId, periodId, key] = mocks.v2.confirmPeriodTarget.mock.calls[0]!;
      expect([budgetId, periodId]).toEqual(['budget-1', 'period-1']);
      expect(typeof key).toBe('string');
      expect(mocks.v2.getDashboard).toHaveBeenCalledTimes(2);
      expect(wrapper.emitted('targetDecided')).toHaveLength(1);
    });

    it('rejects the plan on explicit click', async () => {
      const { wrapper } = mountChecklist();
      await flushPromises();

      await wrapper.get('[data-testid="onboarding-target-reject"]').trigger('click');
      await flushPromises();

      expect(mocks.v2.rejectPeriodTarget).toHaveBeenCalledWith(
        'budget-1',
        'period-1',
        expect.any(String),
      );
      expect(mocks.v2.confirmPeriodTarget).not.toHaveBeenCalled();
    });

    it('shows an error and keeps the buttons when the decision fails', async () => {
      mocks.v2.confirmPeriodTarget.mockRejectedValueOnce(new Error('boom'));
      const { wrapper } = mountChecklist();
      await flushPromises();

      await wrapper.get('[data-testid="onboarding-target-confirm"]').trigger('click');
      await flushPromises();

      expect(wrapper.get('[data-testid="onboarding-target-error"]').text()).not.toBe('');
      expect(wrapper.find('[data-testid="onboarding-target-confirm"]').exists()).toBe(true);
      expect(wrapper.emitted('targetDecided')).toBeUndefined();
    });

    it('reports that it hosts the target only while expanded', async () => {
      const { wrapper } = mountChecklist();
      await flushPromises();
      expect(wrapper.emitted('hostsTarget')?.at(-1)).toEqual([true]);

      await wrapper.get('[data-action="onboarding-collapse"]').trigger('click');
      expect(wrapper.emitted('hostsTarget')?.at(-1)).toEqual([false]);

      await wrapper.get('[data-testid="onboarding-pill"]').trigger('click');
      expect(wrapper.emitted('hostsTarget')?.at(-1)).toEqual([true]);
    });

    it('reuses the Idempotency-Key on retry and mints a new one for another decision', async () => {
      mocks.v2.confirmPeriodTarget.mockRejectedValueOnce(new Error('boom'));
      const { wrapper } = mountChecklist();
      await flushPromises();

      await wrapper.get('[data-testid="onboarding-target-confirm"]').trigger('click');
      await flushPromises();
      await wrapper.get('[data-testid="onboarding-target-confirm"]').trigger('click');
      await flushPromises();

      const [first, second] = mocks.v2.confirmPeriodTarget.mock.calls;
      expect(second![2]).toBe(first![2]);
    });

    it('uses a different key when the user switches from confirm to reject', async () => {
      mocks.v2.confirmPeriodTarget.mockRejectedValueOnce(new Error('boom'));
      const { wrapper } = mountChecklist();
      await flushPromises();

      await wrapper.get('[data-testid="onboarding-target-confirm"]').trigger('click');
      await flushPromises();
      await wrapper.get('[data-testid="onboarding-target-reject"]').trigger('click');
      await flushPromises();

      expect(mocks.v2.rejectPeriodTarget.mock.calls[0]![2]).not.toBe(
        mocks.v2.confirmPeriodTarget.mock.calls[0]![2],
      );
    });

    it('sends a single request for a double click while the first is pending', async () => {
      let resolve: (value: unknown) => void = () => undefined;
      mocks.v2.confirmPeriodTarget.mockReturnValueOnce(new Promise((r) => (resolve = r)));
      const { wrapper } = mountChecklist();
      await flushPromises();

      const button = wrapper.get('[data-testid="onboarding-target-confirm"]');
      await button.trigger('click');
      await button.trigger('click');
      resolve({ periodId: 'period-1' });
      await flushPromises();

      expect(mocks.v2.confirmPeriodTarget).toHaveBeenCalledTimes(1);
    });

    it('stops hosting the target when it unmounts', async () => {
      const { wrapper } = mountChecklist();
      await flushPromises();
      expect(wrapper.emitted('hostsTarget')?.at(-1)).toEqual([true]);

      wrapper.unmount();

      expect(wrapper.emitted('hostsTarget')?.at(-1)).toEqual([false]);
    });

    it('announces the decision and never offers it again even if the reread fails', async () => {
      const { wrapper } = mountChecklist();
      await flushPromises();
      mocks.v2.getDashboard.mockRejectedValueOnce(new Error('network'));

      await wrapper.get('[data-testid="onboarding-target-confirm"]').trigger('click');
      await flushPromises();

      expect(wrapper.get('[data-testid="onboarding-notice"]').text()).toBe(
        'Лимит на период подтверждён.',
      );
      expect(wrapper.find('[data-testid="onboarding-target-confirm"]').exists()).toBe(false);
      expect(mocks.v2.confirmPeriodTarget).toHaveBeenCalledTimes(1);
    });

    it('explains what reject does and shows no buttons once the step is done', async () => {
      const { wrapper } = mountChecklist();
      await flushPromises();
      expect(wrapper.get('[data-step="periodSetup"]').text()).toContain(
        'Отклонить» — задать лимит самостоятельно',
      );

      mocks.v2.getDashboard.mockResolvedValue(
        dashboard({ ...v2Onboarding, needsPeriodSetup: false }, proposal),
      );
      await wrapper.get('[data-testid="onboarding-target-confirm"]').trigger('click');
      await flushPromises();

      expect(wrapper.find('[data-testid="onboarding-target-confirm"]').exists()).toBe(false);
      expect(wrapper.emitted('hostsTarget')?.at(-1)).toEqual([false]);
    });

    it('does not offer to set the limit again once the plan is confirmed', async () => {
      mocks.v2.getDashboard.mockResolvedValue(
        dashboard({ ...v2Onboarding, needsPeriodSetup: false }),
      );
      const { wrapper } = mountChecklist();
      await flushPromises();

      const step = wrapper.get('[data-step="periodSetup"]');
      expect(step.text()).toContain('Лимит на период подтверждён');
      expect(step.text()).toContain('распределите их по конвертам');
      expect(step.text()).not.toContain('Задать лимит');
      expect(step.get('a').text()).toBe('Открыть конверты');
      expect(step.get('a').attributes('href')).toBe('/app/envelopes');
    });

    it('drops the assignment hint from the confirmed step once money is assigned', async () => {
      mocks.v2.getDashboard.mockResolvedValue(
        dashboard({ ...v2Onboarding, needsPeriodSetup: false, needsOpeningAssignment: false }),
      );
      const { wrapper } = mountChecklist();
      await flushPromises();

      const step = wrapper.get('[data-step="periodSetup"]');
      expect(step.text()).toContain('Лимит на период подтверждён');
      expect(step.text()).not.toContain('распределите их по конвертам');
    });

    it('falls back to a link to the envelopes when there is no proposal', async () => {
      mocks.v2.getDashboard.mockResolvedValue(dashboard());
      const { wrapper } = mountChecklist();
      await flushPromises();

      const step = wrapper.get('[data-step="periodSetup"]');
      expect(step.text()).toContain('Лимит на текущий период');
      expect(step.text()).toContain('Цикл уже задан в шаблоне');
      expect(step.find('[data-testid="onboarding-target-confirm"]').exists()).toBe(false);
      expect(step.get('a').attributes('href')).toBe('/app/envelopes');
      expect(wrapper.emitted('hostsTarget')?.at(-1)).toEqual([false]);
    });
  });
});
