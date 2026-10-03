import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ currentData: { value: null as unknown } }));
const route = vi.hoisted(() => ({ path: '/app' }));
vi.mock('#imports', () => ({ useRoute: () => route }));
vi.mock('../composables/useAuth.js', () => ({ useAuth: () => auth }));

import AppLayout from './app.vue';

const stubs = {
  AppSidebar: true,
  AppHeader: true,
  AppMobileMenu: true,
  AppBottomNav: true,
  AppOperationDialogs: true,
  FundingEntryHost: true,
  UiToastStack: true,
};

function setBudget(planModelVersion: number | undefined): void {
  auth.currentData.value = {
    workspaces: [{ budgets: [{ id: 'budget-id', name: 'Бюджет', planModelVersion }] }],
  };
}

function mountLayout() {
  return mount(AppLayout, {
    slots: { default: '<p data-testid="page-content">Страница</p>' },
    global: { stubs },
  });
}

describe('app layout', () => {
  beforeEach(() => {
    auth.currentData.value = null;
    route.path = '/app';
  });

  it('renders the page for a budget on the supported model', () => {
    setBudget(2);
    const wrapper = mountLayout();

    expect(wrapper.find('[data-testid="page-content"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="budget-not-migrated"]').exists()).toBe(false);
  });

  it('renders the page while the budget is not loaded yet', () => {
    const wrapper = mountLayout();

    expect(wrapper.find('[data-testid="page-content"]').exists()).toBe(true);
  });

  it('shows one explanation instead of the page for a budget not moved to the new model', () => {
    setBudget(1);
    const wrapper = mountLayout();

    expect(wrapper.find('[data-testid="page-content"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="budget-not-migrated"]').text()).toContain(
      'Бюджет ещё не переведён на новую модель',
    );
  });

  it.each(['/app/settings/password', '/app/settings/sessions'])(
    'keeps account screen %s available for a budget not moved to the new model',
    (path) => {
      route.path = path;
      setBudget(1);
      const wrapper = mountLayout();

      expect(wrapper.find('[data-testid="page-content"]').exists()).toBe(true);
      expect(wrapper.find('[data-testid="budget-not-migrated"]').exists()).toBe(false);
    },
  );
});
