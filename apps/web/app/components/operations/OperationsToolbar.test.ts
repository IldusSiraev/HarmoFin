import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import OperationsToolbar from './OperationsToolbar.vue';
import type { OperationFilters } from '../../composables/useOperationFilters.js';

const filters: OperationFilters = {
  type: '',
  status: '',
  from: '',
  to: '',
  accountId: '',
  categoryId: '',
  envelopeId: '',
};

const options = [
  { value: 'account-id', label: 'Основная карта' },
  { value: 'second-account-id', label: 'Наличные' },
];

const mountToolbar = (
  overrides: Partial<OperationFilters> = {},
  activeCount = 0,
  canViewDeleted = true,
) =>
  mount(OperationsToolbar, {
    attachTo: document.body,
    props: {
      filters: { ...filters, ...overrides },
      activeCount,
      accounts: options,
      categories: [{ value: 'category-id', label: 'Продукты' }],
      envelopes: [{ value: 'envelope-id', label: 'Текущие' }],
      canViewDeleted,
    },
  });

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('OperationsToolbar', () => {
  it('offers only the controls the v2 journal API understands', () => {
    const wrapper = mountToolbar();

    expect(wrapper.find('[data-testid="operations-search"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="chip-periodStart"]').exists()).toBe(false);
    expect(wrapper.find('[name="sortBy"]').exists()).toBe(false);
    expect(wrapper.find('[name="cycleStart"]').exists()).toBe(false);
  });

  it('offers deleted operations to the owner only', async () => {
    const statusOptions = async (canViewDeleted: boolean) => {
      const wrapper = mountToolbar({}, 0, canViewDeleted);
      await wrapper.get('[data-testid="more-filters"]').trigger('click');
      const values = wrapper
        .findComponent({ name: 'UiSelect' })
        .props('options')
        .map((option: { value: string }) => option.value);
      wrapper.unmount();
      return values;
    };

    expect(await statusOptions(true)).toEqual(['', 'DRAFT', 'CONFIRMED', 'CANCELLED', 'DELETED']);
    expect(await statusOptions(false)).toEqual(['', 'DRAFT', 'CONFIRMED', 'CANCELLED']);
  });

  it('selects a transaction type from the tabs', async () => {
    const wrapper = mountToolbar();

    await wrapper.get('[data-testid="type-tab-INCOME"]').trigger('click');

    expect(wrapper.emitted('change')).toEqual([['type', 'INCOME']]);
  });

  it('marks the tab matching the active type filter, defaulting to "Все"', () => {
    expect(mountToolbar().get('[data-testid="type-tab-all"]').attributes('aria-pressed')).toBe(
      'true',
    );

    const wrapper = mountToolbar({ type: 'EXPENSE' });
    expect(wrapper.get('[data-testid="type-tab-EXPENSE"]').attributes('aria-pressed')).toBe('true');
    expect(wrapper.get('[data-testid="type-tab-all"]').attributes('aria-pressed')).toBe('false');
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

  it('renders the option list outside the scrolling chip row so it is not clipped', async () => {
    const wrapper = mountToolbar();

    await wrapper.get('[data-testid="chip-accountId"]').trigger('click');

    const list = wrapper.get('[data-testid="chip-options"]').element;
    expect(list.closest('.operations-toolbar__chips')).toBeNull();
    expect(list.closest('.operations-toolbar')).not.toBeNull();
  });

  it('closes the option list on Escape and returns focus to its chip', async () => {
    const wrapper = mountToolbar();
    const chip = wrapper.get('[data-testid="chip-accountId"]');
    await chip.trigger('click');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-testid="chip-options"]').exists()).toBe(false);
    expect(document.activeElement).toBe(chip.element);
  });

  it('closes the option list when a click lands outside', async () => {
    const wrapper = mountToolbar();
    await wrapper.get('[data-testid="chip-accountId"]').trigger('click');

    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-testid="chip-options"]').exists()).toBe(false);
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
