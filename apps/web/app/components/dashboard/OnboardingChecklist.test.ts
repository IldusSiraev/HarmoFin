import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

import OnboardingChecklist from './OnboardingChecklist.vue';

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
  return {
    wrapper: mount(OnboardingChecklist, {
      props: { budgetId: 'budget-1', onboarding, initializeTemplate },
      global: { stubs: { NuxtLink: NuxtLinkStub } },
    }),
    initializeTemplate,
  };
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
});
