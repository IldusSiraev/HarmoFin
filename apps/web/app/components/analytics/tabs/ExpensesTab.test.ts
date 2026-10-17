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

import ExpensesTab from './ExpensesTab.vue';

describe('ExpensesTab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('структура и расходы по периодам с фильтрами вкладки', async () => {
    reply({
      'expenses-by-category': [
        {
          categoryId: 'c',
          categoryName: 'Еда',
          expenseMinor: '30000',
          shareBasisPoints: 7500,
          journalFilters: { categoryId: 'c', type: 'EXPENSE' },
        },
      ],
      'expenses-by-period': [
        {
          periodStart: '2026-03-01',
          periodEnd: '2026-03-14',
          boundarySource: 'STORED',
          expenseMinor: '30000',
          journalFilters: {},
        },
      ],
    });
    const filters = { from: '2026-03-01', accountId: 'acc' };
    const wrapper = mount(ExpensesTab, { props: { budgetId: 'b', filters }, global });
    await flushPromises();
    expect(v2.getReport).toHaveBeenCalledWith('b', 'expenses-by-category', filters);
    expect(v2.getReport).toHaveBeenCalledWith('b', 'expenses-by-period', filters);
    expect(wrapper.get('[data-share-row] a').attributes('href')).toBe(
      '/app/operations?categoryId=c&type=EXPENSE',
    );
    expect(flat(wrapper.text())).toContain('75%');
    expect(wrapper.text()).toContain('01.03–14.03');
    expect(wrapper.get('.column-chart__label--link').attributes('href')).toBe('/app/operations');
  });

  it('до ответа сервера показывает скелетон, а не «Нет данных»', () => {
    v2.getReport.mockImplementation(() => new Promise(() => {}));
    const wrapper = mount(ExpensesTab, { props: { budgetId: 'b', filters: {} }, global });
    expect(wrapper.find('[data-testid="skeleton-item"]').exists()).toBe(true);
    expect(wrapper.text()).not.toContain('Нет данных');
  });

  it('смена фильтров перезагружает отчёты', async () => {
    reply({});
    const wrapper = mount(ExpensesTab, { props: { budgetId: 'b', filters: {} }, global });
    await flushPromises();
    await wrapper.setProps({ filters: { envelopeId: 'e' } });
    await flushPromises();
    expect(v2.getReport).toHaveBeenLastCalledWith('b', 'expenses-by-period', { envelopeId: 'e' });
  });
});
