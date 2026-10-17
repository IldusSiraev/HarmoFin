import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const v2 = { getReport: vi.fn() };
vi.mock('../../../composables/useEnvelopePlanV2.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useEnvelopePlanV2: () => v2,
}));
const global = { stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } };
const flat = (text: string) => text.replace(/\s/g, ' ');
const reply = (data: Record<string, unknown[]>) =>
  v2.getReport.mockImplementation(async (_budgetId: string, key: string) => ({
    key,
    rows: data[key] ?? [],
  }));

import CashFlowTab from './CashFlowTab.vue';

describe('CashFlowTab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('пары столбцов по циклам с подписью разницы и план-факт регулярных платежей', async () => {
    reply({
      'net-cash-flow': [
        {
          cycleStart: '2026-03-01',
          cycleEnd: '2026-03-31',
          incomeMinor: '200000',
          expenseMinor: '50000',
          netCashFlowMinor: '150000',
          journalFilters: {},
        },
        {
          cycleStart: '2026-04-01',
          cycleEnd: '2026-04-30',
          incomeMinor: '0',
          expenseMinor: '30000',
          netCashFlowMinor: '-30000',
          journalFilters: {},
        },
      ],
      'plan-vs-actual': [
        {
          planId: 'p',
          planName: 'Аренда',
          planType: 'EXPENSE',
          plannedMinor: '100',
          actualMinor: '100',
          varianceMinor: '0',
          plannedOccurrenceCount: 1,
          confirmedOccurrenceCount: 1,
        },
      ],
    });
    const wrapper = mount(CashFlowTab, { props: { budgetId: 'b', filters: {} }, global });
    await flushPromises();
    expect(wrapper.findAll('[data-bar]')).toHaveLength(4);
    const text = flat(wrapper.text());
    expect(text).toContain('+1 500,00 ₽');
    expect(text).toContain('−300,00 ₽');
    expect(text).toContain('Аренда');
    const links = wrapper.findAll('.column-chart__label--link');
    expect(links).toHaveLength(2);
    expect(links[0]!.attributes('href')).toBe('/app/operations');
    expect(text).toContain('За текущий финансовый цикл.');
  });

  it('подпись «За выбранные даты.» когда заданы from/to', async () => {
    reply({
      'net-cash-flow': [],
      'plan-vs-actual': [
        {
          planId: 'p',
          planName: 'Аренда',
          planType: 'EXPENSE',
          plannedMinor: '100',
          actualMinor: '100',
          varianceMinor: '0',
          plannedOccurrenceCount: 1,
          confirmedOccurrenceCount: 1,
        },
      ],
    });
    const wrapper = mount(CashFlowTab, {
      props: { budgetId: 'b', filters: { from: '2026-03-01', to: '2026-03-31' } },
      global,
    });
    await flushPromises();
    expect(flat(wrapper.text())).toContain('За выбранные даты.');
  });
});
