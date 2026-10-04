import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import OperationRow from './OperationRow.vue';
import type { TransactionJournalV2Item } from '../../composables/useEnvelopePlanV2.js';

const expense: TransactionJournalV2Item = {
  id: 'transaction-id',
  budgetId: 'budget-id',
  accountingModelVersion: 2,
  transactionType: 'EXPENSE',
  status: 'CONFIRMED',
  amountMinor: '245000',
  currency: 'RUB',
  occurredOn: '2026-09-14',
  accountId: 'account-id',
  categoryId: 'category-id',
  envelopeId: 'envelope-id',
  sourceDescription: null,
  merchantName: 'Супермаркет',
  comment: null,
  planOccurrenceIds: [],
  confirmedAt: '2026-09-14T10:00:00.000Z',
  cancelledAt: null,
  deletedAt: null,
  createdAt: '2026-09-14T10:00:00.000Z',
};

const mountRow = (overrides: Partial<TransactionJournalV2Item> = {}) =>
  mount(OperationRow, {
    props: {
      transaction: { ...expense, ...overrides },
      categoryName: 'Продукты',
      categoryIcon: 'shopping-cart',
      accountName: 'Основная карта',
      envelopeName: 'Текущие',
    },
  });

const normalize = (value: string): string => value.replace(/[\u00a0\u202f]/g, ' ');

describe('OperationRow', () => {
  it('leads with the category and the counterparty', () => {
    const text = normalize(mountRow().text());

    expect(text).toContain('Продукты');
    expect(text).toContain('Супермаркет');
    expect(text).toContain('Основная карта');
    expect(text).toContain('Текущие');
  });

  it('signs an expense and an income differently', () => {
    expect(normalize(mountRow().text())).toContain('-2 450,00 ₽');
    expect(
      normalize(
        mountRow({
          transactionType: 'INCOME',
          merchantName: null,
          sourceDescription: 'Аванс',
        }).text(),
      ),
    ).toContain('2 450,00 ₽');
  });

  it('labels only the statuses that need attention', () => {
    expect(mountRow().find('[data-testid="operation-row-status"]').exists()).toBe(false);
    expect(mountRow({ status: 'DRAFT' }).get('[data-testid="operation-row-status"]').text()).toBe(
      'Черновик',
    );
    expect(mountRow({ status: 'DELETED' }).get('[data-testid="operation-row-status"]').text()).toBe(
      'Удалена',
    );
  });

  it('marks a payment made against a plan', () => {
    expect(mountRow({ planOccurrenceIds: ['occurrence-id'] }).text()).toContain('По плану');
    expect(mountRow().text()).not.toContain('По плану');
  });

  it('shows no allocation leftovers of the old model', () => {
    expect(mountRow({ transactionType: 'INCOME' }).text()).not.toContain('Не распределено');
  });

  it('selects the operation when the row is pressed', async () => {
    const wrapper = mountRow();

    await wrapper.get('[data-testid="list-row-select"]').trigger('click');

    expect(wrapper.emitted('select')).toHaveLength(1);
  });
});
