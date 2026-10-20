import { flushPromises, mount } from '@vue/test-utils';
import { reactive } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = {
  listAccounts: vi.fn(),
  listCategories: vi.fn(),
};
const v2 = {
  listEnvelopes: vi.fn(),
};
// Reactive so the page's own `watch(() => route.query, ...)` (external
// navigation: browser back/forward, in-app links like "Все категории") can
// be exercised by reassigning `route.query` mid-test, the same way Nuxt's
// real `useRoute()` would update it.
const route = reactive({ query: {} as Record<string, string> });
const budgetRow = {
  id: 'budget-id',
  name: 'Бюджет',
  primaryCurrency: 'RUB',
  planModelVersion: 2,
};
const workspaceRow = { role: 'OWNER', budgets: [budgetRow] };
const auth = {
  currentData: { value: { workspaces: [workspaceRow] } },
  loadMe: vi.fn(),
};

vi.mock('#imports', () => ({
  definePageMeta: vi.fn(),
  navigateTo: vi.fn(),
  useRoute: () => route,
}));
vi.mock('../../composables/useAuth.js', () => ({ useAuth: () => auth }));
vi.mock('../../composables/useEnvelopePlanV2.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useEnvelopePlanV2: () => v2,
}));
vi.mock('../../composables/useBudgetReferenceData.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useBudgetReferenceData: () => api,
}));

const { tabStub } = vi.hoisted(() => ({
  tabStub: (name: string) => ({
    name,
    props: ['budgetId', 'filters'],
    template: `<div data-tab="${name}">{{ JSON.stringify(filters) }}</div>`,
  }),
}));
vi.mock('../../components/analytics/tabs/OverviewTab.vue', () => ({
  default: tabStub('overview'),
}));
vi.mock('../../components/analytics/tabs/ExpensesTab.vue', () => ({
  default: tabStub('expenses'),
}));
vi.mock('../../components/analytics/tabs/CashFlowTab.vue', () => ({
  default: tabStub('cash-flow'),
}));
vi.mock('../../components/analytics/tabs/EnvelopesTab.vue', () => ({
  default: tabStub('envelopes'),
}));
vi.mock('../../components/analytics/tabs/SavingsTab.vue', () => ({ default: tabStub('savings') }));

import { navigateTo } from '#imports';
import AnalyticsPage from './analytics.vue';

const global = {
  stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } },
};

describe('analytics page', () => {
  beforeEach(() => {
    route.query = {};
    vi.clearAllMocks();
    workspaceRow.role = 'OWNER';
    v2.listEnvelopes.mockResolvedValue({ items: [] });
    api.listAccounts.mockResolvedValue([]);
    api.listCategories.mockResolvedValue([]);
  });

  it('по умолчанию открыт обзор, вкладок пять', async () => {
    const wrapper = mount(AnalyticsPage, { global });
    await flushPromises();
    expect(wrapper.findAll('[role="tab"]').map((tab) => tab.text())).toEqual([
      'Обзор',
      'Расходы',
      'Доходы и расходы',
      'Конверты',
      'Накопления',
    ]);
    expect(wrapper.find('[data-tab="overview"]').exists()).toBe(true);
  });

  it('вкладка из ?tab=, фильтры передаются только применимые к вкладке', async () => {
    route.query = { tab: 'envelopes', from: '2026-03-01', accountId: 'acc', envelopeId: 'env' };
    const wrapper = mount(AnalyticsPage, { global });
    await flushPromises();
    expect(wrapper.get('[data-tab="envelopes"]').text()).toBe(
      JSON.stringify({ from: '2026-03-01', envelopeId: 'env' }),
    );
  });

  it('обзор не показывает панель фильтров', async () => {
    const wrapper = mount(AnalyticsPage, { global });
    await flushPromises();
    expect(wrapper.find('.ui-filter-bar').exists()).toBe(false);
  });

  it('фильтры вкладки: чипы счёта и конверта и чип периода', async () => {
    route.query = { tab: 'expenses', from: '2026-03-01' };
    api.listAccounts.mockResolvedValue([{ id: 'acc', name: 'Карта' }]);
    api.listCategories.mockResolvedValue([{ id: 'cat', name: 'Продукты' }]);
    v2.listEnvelopes.mockResolvedValue({
      items: [{ id: 'env', name: 'Текущие', archivedAt: null }],
    });
    const wrapper = mount(AnalyticsPage, { global });
    await flushPromises();
    expect(wrapper.find('[data-testid="chip-accountId"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="chip-envelopeId"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="chip-categoryId"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="chip-period"]').text()).toContain('с 01.03.2026');
    expect(wrapper.find('[data-testid="more-filters"]').exists()).toBe(false);
  });

  it('накопления фильтруются одной датой, а не периодом', async () => {
    route.query = { tab: 'savings', to: '2026-03-31' };
    const wrapper = mount(AnalyticsPage, { global });
    await flushPromises();
    const chip = wrapper.get('[data-testid="chip-period"]');
    expect(chip.text()).toContain('На дату');
    expect(chip.text()).toContain('31.03.2026');
  });

  it('старая ссылка ?report= переводится на вкладку', async () => {
    route.query = { report: 'plan-vs-actual', from: '2026-03-01' };
    const wrapper = mount(AnalyticsPage, { global });
    await flushPromises();
    expect(wrapper.find('[data-tab="cash-flow"]').exists()).toBe(true);
    expect(navigateTo).toHaveBeenCalledWith(
      { query: { tab: 'cash-flow', from: '2026-03-01' } },
      { replace: true },
    );
  });

  it('неизвестные tab и report дают обзор', async () => {
    route.query = { tab: 'nope', report: 'nope' };
    const wrapper = mount(AnalyticsPage, { global });
    await flushPromises();
    expect(wrapper.find('[data-tab="overview"]').exists()).toBe(true);
  });

  it('переключение вкладки пишет её в URL, фильтры сохраняются', async () => {
    route.query = { from: '2026-03-01' };
    const wrapper = mount(AnalyticsPage, { global });
    await flushPromises();
    await wrapper.findAll('[role="tab"]')[1]!.trigger('click');
    expect(navigateTo).toHaveBeenLastCalledWith(
      { query: { tab: 'expenses', from: '2026-03-01' } },
      { replace: true },
    );
    expect(wrapper.find('[data-tab="expenses"]').exists()).toBe(true);
  });

  it('без бюджета — пустое состояние', async () => {
    auth.currentData.value = { workspaces: [] } as never;
    const wrapper = mount(AnalyticsPage, { global });
    await flushPromises();
    expect(wrapper.text()).toContain('Бюджет не выбран');
    auth.currentData.value = { workspaces: [workspaceRow] };
  });

  it('выгрузка остаётся под вкладками', async () => {
    const wrapper = mount(AnalyticsPage, { global });
    await flushPromises();
    expect(wrapper.findComponent({ name: 'ExportPanelV2' }).exists()).toBe(true);
  });

  it('внешняя навигация (ссылка «Все категории», назад/вперёд) меняет вкладку и фильтры', async () => {
    const wrapper = mount(AnalyticsPage, { global });
    await flushPromises();
    expect(wrapper.find('[data-tab="overview"]').exists()).toBe(true);

    route.query = { tab: 'expenses', from: '2026-03-01' };
    await flushPromises();

    expect(wrapper.find('[data-tab="overview"]').exists()).toBe(false);
    expect(wrapper.get('[data-tab="expenses"]').text()).toBe(
      JSON.stringify({ from: '2026-03-01' }),
    );
  });
});
