import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import TransferRow from './TransferRow.vue';
import type { TransferJournalItem } from '../../composables/useEnvelopePlanV2.js';

const transfer: TransferJournalItem = {
  kind: 'TRANSFER',
  id: 't1',
  budgetId: 'b1',
  status: 'CONFIRMED',
  amountMinor: '150000',
  currency: 'RUB',
  occurredOn: '2026-10-20',
  sourceAccountId: 'a',
  destinationAccountId: 'b',
  comment: 'Отпуск',
  createdAt: '2026-10-20T10:00:00.000Z',
  deletedAt: null,
};

function mountRow(overrides: Partial<TransferJournalItem> = {}) {
  return mount(TransferRow, {
    props: {
      transfer: { ...transfer, ...overrides },
      sourceName: 'Карта',
      destinationName: 'Вклад',
    },
  });
}

describe('TransferRow', () => {
  it('плашка перевода окрашена в тон перевода', () => {
    expect(mountRow().find('.ui-list-row__leading--transfer').exists()).toBe(true);
  });

  it('shows the route between accounts and the note', () => {
    const wrapper = mountRow();
    expect(wrapper.text()).toContain('Перевод');
    expect(wrapper.text()).toContain('Карта → Вклад');
    expect(wrapper.text()).toContain('Отпуск');
  });

  it('places the route under the amount, like the account of an operation', () => {
    const trailing = mountRow().find('.transfer-row__placement');
    expect(trailing.text()).toBe('Карта → Вклад');
    expect(trailing.element.previousElementSibling?.classList).toContain('transfer-row__amount');
  });

  it('renders the actions slot', () => {
    const wrapper = mount(TransferRow, {
      props: { transfer, sourceName: 'Карта', destinationName: 'Вклад' },
      slots: { actions: '<button data-testid="row-menu">…</button>' },
    });
    expect(wrapper.find('[data-testid="row-menu"]').exists()).toBe(true);
  });

  it('shows the amount without a sign', () => {
    const text = mountRow().find('.transfer-row__amount').text();
    expect(text).not.toMatch(/^[-−+]/);
  });

  it('marks a deleted transfer with text, not only colour', () => {
    expect(mountRow({ status: 'DELETED' }).find('[data-testid="transfer-row-status"]').text()).toBe(
      'Удалён',
    );
  });

  it('emits select', async () => {
    const wrapper = mountRow();
    await wrapper.find('[data-testid="list-row-select"]').trigger('click');
    expect(wrapper.emitted('select')).toHaveLength(1);
  });
});
