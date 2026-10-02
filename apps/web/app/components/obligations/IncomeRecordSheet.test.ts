import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';

import IncomeRecordSheet from './IncomeRecordSheet.vue';

const occurrence = {
  id: 'occ',
  name: 'Зарплата',
  scheduledOn: '2026-09-25',
  expectedMinor: '10000000',
  categoryId: 'income-cat' as string | null,
};

function mountSheet(overrides: Record<string, unknown> = {}) {
  return mount(IncomeRecordSheet, {
    attachTo: document.body,
    props: {
      open: true,
      occurrence,
      categoryName: 'Зарплата',
      accounts: [{ value: 'account-id', label: 'Карта' }],
      today: '2026-09-24',
      pending: false,
      error: null,
      ...overrides,
    },
  });
}

describe('IncomeRecordSheet', () => {
  let wrapper: ReturnType<typeof mountSheet> | null = null;

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = '';
  });

  it('prefills the expected amount as an editable decimal string', async () => {
    wrapper = mountSheet();
    await flushPromises();

    const input = wrapper.get<HTMLInputElement>('[data-testid="income-amount"]');
    expect(input.element.value).toBe('100000.00');
  });

  it('focuses the amount field after opening and shows the currency symbol', async () => {
    wrapper = mountSheet({ open: false });
    await wrapper.setProps({ open: true });
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(document.activeElement?.id).toBe('income-record-amount');
    expect(wrapper.get('.income-sheet__currency').text()).toBe('₽');
  });

  it('requires an account and does not emit without one', async () => {
    wrapper = mountSheet();
    await flushPromises();

    await wrapper.get('[data-testid="income-submit"]').trigger('click');

    expect(wrapper.emitted('submit')).toBeUndefined();
    expect(wrapper.text()).toContain('Выберите счёт');
  });

  it('rejects a zero amount with a field error', async () => {
    wrapper = mountSheet();
    await flushPromises();

    await wrapper.get('[data-testid="income-amount"]').setValue('0');
    await wrapper.get('[data-testid="pill-accountId-account-id"]').trigger('click');
    await wrapper.get('[data-testid="income-submit"]').trigger('click');

    expect(wrapper.emitted('submit')).toBeUndefined();
    expect(wrapper.text()).toContain('Введите сумму больше нуля');
  });

  it('emits a normalized amount with the plan category and one key', async () => {
    wrapper = mountSheet();
    await flushPromises();

    await wrapper.get('[data-testid="income-amount"]').setValue('87000,5');
    await wrapper.get('[data-testid="pill-accountId-account-id"]').trigger('click');
    await wrapper.get('[data-testid="income-submit"]').trigger('click');

    expect(wrapper.emitted('submit')?.[0]?.[0]).toEqual(
      expect.objectContaining({
        amount: '87000.50',
        accountId: 'account-id',
        categoryId: 'income-cat',
        idempotencyKey: expect.any(String),
      }),
    );
  });
});
