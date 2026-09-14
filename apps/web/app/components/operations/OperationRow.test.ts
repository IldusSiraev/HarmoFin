import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import OperationRow from './OperationRow.vue';
import type { TransactionDto } from '../../composables/useBudgetReferenceData.js';

const expense: TransactionDto = {
  id: 'transaction-id',
  budgetId: 'budget-id',
  transactionType: 'EXPENSE',
  status: 'CONFIRMED',
  amountMinor: '245000',
  currency: 'RUB',
  scale: 2,
  occurredOn: '2026-09-14',
  accountId: 'account-id',
  categoryId: 'category-id',
  envelopeId: 'envelope-id',
  sourceDescription: null,
  merchantName: 'Супермаркет',
  isPlanned: false,
  comment: null,
  confirmedAt: '2026-09-14T10:00:00.000Z',
  cancelledAt: null,
  deletedAt: null,
  accountCurrentBalanceMinor: '1000000',
  envelopeCurrentBalanceMinor: '500000',
  unallocatedMinor: '0',
  allocationProposal: null,
};

const mountRow = (overrides: Partial<TransactionDto> = {}) =>
  mount(OperationRow, {
    props: {
      transaction: { ...expense, ...overrides },
      categoryName: 'Продукты',
      categoryTemplateKey: 'expense-groceries',
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

  it('flags income that still has money to allocate', () => {
    const wrapper = mountRow({
      transactionType: 'INCOME',
      merchantName: null,
      sourceDescription: 'Зарплата',
      unallocatedMinor: '120000',
    });

    expect(normalize(wrapper.get('[data-testid="operation-row-unallocated"]').text())).toContain(
      '1 200,00 ₽',
    );
  });

  it('selects the operation when the row is pressed', async () => {
    const wrapper = mountRow();

    await wrapper.get('[data-testid="list-row-select"]').trigger('click');

    expect(wrapper.emitted('select')).toHaveLength(1);
  });
});
