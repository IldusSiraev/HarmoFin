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

import OverviewTab from './OverviewTab.vue';

const comparison = {
  asOf: '2026-03-20',
  periodStart: '2026-03-15',
  periodEnd: '2026-03-31',
  daysElapsed: 6,
  spentMinor: '80000',
  limitTotalMinor: '500000',
  spentOfLimitPermille: 160,
  previousPeriodStart: '2026-03-01',
  previousPeriodEnd: '2026-03-14',
  previousSameDaySpentMinor: '100000',
  previousTotalSpentMinor: '150000',
  deltaMinor: '-20000',
  deltaBasisPoints: -2000,
};

describe('OverviewTab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('период, сравнение, топ-5 категорий за границы периода с сервера, счета', async () => {
    reply({
      'period-comparison': [comparison],
      'expenses-by-category': Array.from({ length: 6 }, (_, index) => ({
        categoryId: `c${index}`,
        categoryName: `Категория ${index}`,
        expenseMinor: '1000',
        shareBasisPoints: 1666,
        journalFilters: { categoryId: `c${index}`, type: 'EXPENSE' },
      })),
      'account-balances': [
        { accountId: 'a', name: 'Основной счёт', balanceMinor: '123400', asOf: '2026-03-20' },
      ],
    });
    const wrapper = mount(OverviewTab, { props: { budgetId: 'b', filters: {} }, global });
    await flushPromises();
    expect(v2.getReport).toHaveBeenCalledWith('b', 'period-comparison', {});
    expect(v2.getReport).toHaveBeenCalledWith('b', 'expenses-by-category', {
      from: '2026-03-15',
      to: '2026-03-31',
    });
    expect(v2.getReport).toHaveBeenCalledWith('b', 'account-balances', {});
    const text = flat(wrapper.text());
    expect(text).toContain('15.03–31.03');
    expect(text).toContain('из лимита на период 5 000,00 ₽');
    expect(text).toContain('на 20% меньше');
    expect(wrapper.findAll('[data-share-row]')).toHaveLength(5);
    expect(text).toContain('Основной счёт');
    expect(wrapper.find('a[href="/app/analytics?tab=expenses"]').exists()).toBe(true);
  });

  it('без лимита — текст вместо полосы; ошибка одного отчёта не скрывает другие', async () => {
    v2.getReport.mockImplementation(async (_b: string, key: string) => {
      if (key === 'account-balances') throw new Error('boom');
      if (key === 'period-comparison')
        return {
          key,
          rows: [{ ...comparison, limitTotalMinor: null, spentOfLimitPermille: null }],
        };
      return { key, rows: [] };
    });
    const wrapper = mount(OverviewTab, { props: { budgetId: 'b', filters: {} }, global });
    await flushPromises();
    expect(wrapper.text()).toContain('Лимит на период не задан');
    expect(wrapper.find('[role="progressbar"]').exists()).toBe(false);
    expect(wrapper.get('[role="alert"]').text()).toContain('Не удалось загрузить отчёт.');
  });

  it('ошибка сравнения периодов не маскируется пустым состоянием категорий', async () => {
    v2.getReport.mockImplementation(async (_b: string, key: string) => {
      if (key === 'period-comparison') throw new Error('boom');
      return { key, rows: [] };
    });
    const wrapper = mount(OverviewTab, { props: { budgetId: 'b', filters: {} }, global });
    await flushPromises();
    expect(wrapper.text()).not.toContain('В этом периоде подтверждённых расходов пока нет.');
    expect(wrapper.findAll('[role="alert"]').length).toBeGreaterThanOrEqual(2);
  });
});
