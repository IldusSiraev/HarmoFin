import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import RecentOperations from './RecentOperations.vue';
import type { CategoryDto, TransactionDto } from '../../composables/useBudgetReferenceData.js';

const transaction = (id: string): TransactionDto =>
  ({
    id,
    budgetId: 'budget-id',
    transactionType: 'EXPENSE',
    status: 'CONFIRMED',
    amountMinor: '245000',
    currency: 'RUB',
    scale: 2,
    occurredOn: '2026-09-14',
    accountId: 'account-id',
    categoryId: 'category-id',
    envelopeId: null,
    sourceDescription: null,
    merchantName: 'Супермаркет',
    isPlanned: false,
    comment: null,
    confirmedAt: null,
    cancelledAt: null,
    deletedAt: null,
    accountCurrentBalanceMinor: '0',
    envelopeCurrentBalanceMinor: null,
    unallocatedMinor: '0',
    allocationProposal: null,
  }) as TransactionDto;

const categories = [
  { id: 'category-id', name: 'Продукты', templateKey: 'expense-groceries' },
] as unknown as CategoryDto[];

const mountBlock = (count: number) =>
  mount(RecentOperations, {
    props: {
      transactions: Array.from({ length: count }, (_, index) =>
        transaction(`transaction-${index}`),
      ),
      categories,
      accounts: [{ value: 'account-id', label: 'Основная карта' }],
      envelopes: [],
    },
    global: { stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } },
  });

describe('RecentOperations', () => {
  it('names the account and the category on every row', () => {
    const wrapper = mountBlock(1);

    expect(wrapper.text()).toContain('Продукты');
    expect(wrapper.text()).toContain('Основная карта');
  });

  it('links each row to the journal with that operation open', () => {
    const wrapper = mountBlock(1);

    expect(wrapper.get('[data-testid="recent-operation-link"]').attributes('href')).toBe(
      '/app/operations?operationId=transaction-0',
    );
  });

  it('says so when there is nothing yet', () => {
    expect(mountBlock(0).text()).toContain('Операций пока нет');
  });
});
