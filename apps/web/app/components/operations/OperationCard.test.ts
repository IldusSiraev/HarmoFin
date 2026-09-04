import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import OperationCard from './OperationCard.vue';

const transaction = {
  id: 'transaction-id',
  budgetId: 'budget-id',
  transactionType: 'EXPENSE' as const,
  status: 'CONFIRMED' as const,
  amountMinor: '12345',
  currency: 'RUB' as const,
  scale: 2 as const,
  occurredOn: '2026-09-04',
  accountId: 'account-id',
  categoryId: 'category-id',
  envelopeId: 'envelope-id',
  sourceDescription: null,
  merchantName: 'Магазин',
  isPlanned: false,
  comment: null,
  confirmedAt: '2026-09-04T00:00:00.000Z',
  cancelledAt: null,
  deletedAt: null,
  accountCurrentBalanceMinor: '100000',
  envelopeCurrentBalanceMinor: '50000',
  unallocatedMinor: '0',
  allocationProposal: null,
};

describe('OperationCard', () => {
  it('renders localized server transaction value without balances', () => {
    const wrapper = mount(OperationCard, { props: { transaction } });

    expect(wrapper.text()).toContain('Расход');
    expect(wrapper.text()).toContain('Подтверждена');
    expect(wrapper.text()).toContain('123,45');
    expect(wrapper.text()).not.toContain('100000');
  });
});
