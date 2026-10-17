import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const v2 = { getReport: vi.fn() };
vi.mock('../../../composables/useEnvelopePlanV2.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useEnvelopePlanV2: () => v2,
}));
const global = { stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } };
const reply = (data: Record<string, unknown[]>) =>
  v2.getReport.mockImplementation(async (_budgetId: string, key: string) => ({
    key,
    rows: data[key] ?? [],
  }));

import SavingsTab from './SavingsTab.vue';

describe('SavingsTab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('прогресс накоплений с фильтрами конверта и даты', async () => {
    reply({
      'savings-goals': [
        {
          envelopeId: 'g',
          name: 'Отпуск',
          envelopeType: 'SAVINGS_GOAL',
          currentMinor: '100',
          targetMinor: '1000',
          targetDate: null,
          assignedMinor: '100',
          movedNetMinor: '0',
          spentMinor: '0',
          remainingMinor: '900',
          progressPermille: 100,
          isReached: false,
          daysRemaining: null,
        },
      ],
    });
    const filters = { envelopeId: 'g', to: '2026-03-31' };
    const wrapper = mount(SavingsTab, { props: { budgetId: 'b', filters }, global });
    await flushPromises();
    expect(v2.getReport).toHaveBeenCalledWith('b', 'savings-goals', filters);
    expect(wrapper.findAll('[data-goal]')).toHaveLength(1);
  });
});
