import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ navigateTo: vi.fn() }));
vi.mock('#imports', () => ({ navigateTo: mocks.navigateTo }));

import RecentOperations from './RecentOperations.vue';
import type { CategoryDto } from '../../composables/useBudgetReferenceData.js';
import type { TransactionJournalV2Item } from '../../composables/useEnvelopePlanV2.js';

const tx = (
  overrides: Partial<TransactionJournalV2Item> & { id: string },
): TransactionJournalV2Item => ({
  budgetId: 'budget-id',
  accountingModelVersion: 2,
  transactionType: 'EXPENSE',
  status: 'CONFIRMED',
  amountMinor: '245000',
  currency: 'RUB',
  occurredOn: '2026-09-14',
  accountId: 'account-id',
  categoryId: 'category-id',
  envelopeId: null,
  sourceDescription: null,
  merchantName: 'Супермаркет',
  comment: null,
  planOccurrenceIds: [],
  confirmedAt: null,
  cancelledAt: null,
  deletedAt: null,
  createdAt: '2026-09-14T10:00:00.000Z',
  ...overrides,
});

const categories = [
  { id: 'category-id', name: 'Продукты', templateKey: 'expense-groceries' },
] as unknown as CategoryDto[];

const mountRecent = (transactions: TransactionJournalV2Item[], asOf = '2026-10-22') =>
  mount(RecentOperations, {
    props: {
      transactions,
      categories,
      accounts: [{ value: 'account-id', label: 'Основная карта' }],
      envelopes: [],
      asOf,
    },
    global: { stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } },
  });

const mountBlock = (count: number) =>
  mountRecent(Array.from({ length: count }, (_, index) => tx({ id: `transaction-${index}` })));

describe('RecentOperations', () => {
  it('names the account and the category on every row', () => {
    const wrapper = mountBlock(1);

    expect(wrapper.text()).toContain('Продукты');
    expect(wrapper.text()).toContain('Основная карта');
  });

  it('opens the journal with that operation selected on click', async () => {
    const wrapper = mountBlock(1);

    await wrapper.get('[data-testid="list-row-select"]').trigger('click');

    expect(mocks.navigateTo).toHaveBeenCalledWith('/app/operations?operationId=transaction-0');
  });

  it('says so when there is nothing yet', () => {
    expect(mountBlock(0).text()).toContain('Операций пока нет');
  });

  it('groups operations by the server day: today, yesterday, then the date', () => {
    const wrapper = mountRecent([
      tx({ id: 'a', occurredOn: '2026-10-22' }),
      tx({ id: 'b', occurredOn: '2026-10-22' }),
      tx({ id: 'c', occurredOn: '2026-10-21' }),
      tx({ id: 'd', occurredOn: '2026-10-15' }),
    ]);
    const labels = wrapper
      .findAll('[data-testid="operation-group-label"]')
      .map((node) => node.text());
    expect(labels).toEqual(['Сегодня', 'Вчера', '15 октября']);
    expect(wrapper.findAll('ul')[0]!.findAll('li')).toHaveLength(2);
  });
});
