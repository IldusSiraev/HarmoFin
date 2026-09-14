import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import OperationsToolbar from './OperationsToolbar.vue';
import type { OperationFilters } from '../../composables/useOperationFilters.js';

const filters: OperationFilters = {
  search: '',
  type: '',
  status: '',
  from: '',
  to: '',
  cycleStart: '',
  periodStart: '',
  accountId: '',
  categoryId: '',
  envelopeId: '',
  planId: '',
  sortBy: 'occurredOn',
  sortDirection: 'desc',
};

const options = [
  { value: 'account-id', label: 'Основная карта' },
  { value: 'second-account-id', label: 'Наличные' },
];

const mountToolbar = (overrides: Partial<OperationFilters> = {}, activeCount = 0) =>
  mount(OperationsToolbar, {
    props: {
      filters: { ...filters, ...overrides },
      activeCount,
      accounts: options,
      categories: [{ value: 'category-id', label: 'Продукты' }],
      envelopes: [{ value: 'envelope-id', label: 'Текущие' }],
      periods: [{ value: '2026-09-10', label: '10.09 – 24.09' }],
    },
  });

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('OperationsToolbar', () => {
  it('debounces the search', async () => {
    const wrapper = mountToolbar();

    await wrapper.get('[data-testid="operations-search"] input').setValue('кафе');
    expect(wrapper.emitted('search')).toBeUndefined();

    vi.advanceTimersByTime(300);

    expect(wrapper.emitted('search')).toEqual([['кафе']]);
  });

  it('shows the chosen account inside its chip', () => {
    const wrapper = mountToolbar({ accountId: 'account-id' });

    expect(wrapper.get('[data-testid="chip-accountId"]').text()).toContain('Основная карта');
    expect(wrapper.get('[data-testid="chip-accountId"]').attributes('aria-pressed')).toBe('true');
  });

  it('reports a chosen chip value', async () => {
    const wrapper = mountToolbar();

    await wrapper.get('[data-testid="chip-accountId"]').trigger('click');
    await wrapper.get('[data-testid="chip-option-accountId-account-id"]').trigger('click');

    expect(wrapper.emitted('change')).toEqual([['accountId', 'account-id']]);
  });

  it('clears a filter when its active value is chosen again', async () => {
    const wrapper = mountToolbar({ accountId: 'account-id' });

    await wrapper.get('[data-testid="chip-accountId"]').trigger('click');
    await wrapper.get('[data-testid="chip-option-accountId-account-id"]').trigger('click');

    expect(wrapper.emitted('change')).toEqual([['accountId', '']]);
  });

  it('counts active filters on the more-filters button', () => {
    expect(
      mountToolbar({ status: 'DRAFT' }, 1).get('[data-testid="more-filters"]').text(),
    ).toContain('1');
  });

  it('opens the extra filters in a drawer and resets from there', async () => {
    const wrapper = mountToolbar({ status: 'DRAFT' }, 1);

    await wrapper.get('[data-testid="more-filters"]').trigger('click');
    expect(wrapper.find('[data-testid="drawer"]').exists()).toBe(true);

    await wrapper.get('[data-testid="reset-filters"]').trigger('click');

    expect(wrapper.emitted('reset')).toHaveLength(1);
  });
});
