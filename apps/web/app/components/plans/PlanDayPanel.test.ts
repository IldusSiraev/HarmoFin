import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import PlanDayPanel from './PlanDayPanel.vue';
import PlanOccurrenceRow from './PlanOccurrenceRow.vue';
import type { PlanOccurrenceDto } from '../../composables/useBudgetReferenceData.js';
import type { DayOperationView } from './PlanDayPanel.vue';

const operations: DayOperationView[] = [
  {
    id: 'transaction-1',
    categoryName: 'Бензин',
    categoryIcon: 'fuel',
    transactionType: 'EXPENSE',
    amountMinor: '350000',
    currency: 'RUB',
    scale: 2,
  },
  {
    id: 'transaction-2',
    categoryName: 'Кафе',
    categoryIcon: null,
    transactionType: 'EXPENSE',
    amountMinor: '85000',
    currency: 'RUB',
    scale: 2,
  },
];

const occurrence: PlanOccurrenceDto = {
  id: 'occurrence-id',
  planId: 'plan-id',
  planName: 'Подписка',
  planType: 'EXPENSE',
  scheduledOn: '2026-09-18',
  status: 'DUE',
  amountMinor: '300000',
  currency: 'RUB',
  scale: 2,
  accountId: 'account-id',
  categoryId: 'category-id',
  envelopeId: 'envelope-id',
  comment: null,
  transactionId: null,
  cancellationReason: null,
};

describe('PlanDayPanel', () => {
  it('shows the date, the net operations total, and each operation with its icon', () => {
    const wrapper = mount(PlanDayPanel, {
      props: { date: '2026-09-13', operations, occurrences: [], categoryIconById: {} },
    });

    expect(wrapper.text()).toContain('2026-09-13');
    expect(wrapper.text()).toContain('Бензин');
    expect(wrapper.text()).toContain('Кафе');
    expect(wrapper.findAll('.plan-day-panel__operation svg')).toHaveLength(2);
  });

  it('renders occurrences via PlanOccurrenceRow, resolving its category icon, and forwards its events', async () => {
    const wrapper = mount(PlanDayPanel, {
      props: {
        date: '2026-09-18',
        operations: [],
        occurrences: [occurrence],
        categoryIconById: { 'category-id': 'wifi' },
      },
    });

    expect(wrapper.findComponent(PlanOccurrenceRow).props('categoryIcon')).toBe('wifi');

    await wrapper.get('input[type="checkbox"]').setValue(true);

    expect(wrapper.emitted('complete-occurrence')?.[0]).toEqual([occurrence]);
  });

  it('emits add-plan from the add button', async () => {
    const wrapper = mount(PlanDayPanel, {
      props: { date: '2026-09-18', operations: [], occurrences: [], categoryIconById: {} },
    });

    await wrapper.get('[data-action="add-plan-on-day"]').trigger('click');

    expect(wrapper.emitted('add-plan')).toHaveLength(1);
  });
});
