import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import TransferCard from './TransferCard.vue';

const transfer = {
  id: 'transfer-id',
  budgetId: 'budget-id',
  status: 'CONFIRMED' as const,
  totalMinor: '2000',
  currency: 'RUB' as const,
  scale: 2 as const,
  occurredOn: '2026-09-05',
  comment: null,
  confirmedAt: '2026-09-05T00:00:00.000Z',
  cancelledAt: null,
  deletedAt: null,
  parts: [],
};

describe('TransferCard', () => {
  it('shows transfer status and confirmed total', () => {
    const wrapper = mount(TransferCard, { props: { transfer } });

    expect(wrapper.text()).toContain('Подтверждён');
    expect(wrapper.text()).toContain('20,00');
  });
});
