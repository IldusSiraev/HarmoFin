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
  createdByUserId: '',
};

const options = [
  { value: 'account-id', label: 'Основная карта' },
  { value: 'second-account-id', label: 'Наличные' },
];

const mountToolbar = (
  overrides: Partial<OperationFilters> = {},
  canViewDeleted = true,
  authors: Array<{ value: string; label: string }> = [],
) =>
  mount(OperationsToolbar, {
    attachTo: document.body,
    props: {
      filters: { ...filters, ...overrides },
      accounts: options,
      categories: [{ value: 'category-id', label: 'Продукты' }],
      envelopes: [{ value: 'envelope-id', label: 'Текущие' }],
      canViewDeleted,
      authors,
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
      const wrapper = mountToolbar({}, canViewDeleted);
      await wrapper.get('[data-testid="chip-status"]').trigger('click');
      const values = wrapper
        .findAll('[role="option"]')
        .map((option) => option.attributes('data-testid')?.replace('chip-option-status-', ''));
      wrapper.unmount();
      return values;
    };

    expect(await statusOptions(true)).toEqual(['DRAFT', 'CONFIRMED', 'CANCELLED', 'DELETED']);
    expect(await statusOptions(false)).toEqual(['DRAFT', 'CONFIRMED', 'CANCELLED']);
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

  it('offers a transfers tab', () => {
    const wrapper = mountToolbar();
    expect(wrapper.find('[data-testid="type-tab-TRANSFER"]').text()).toBe('Переводы');
  });

  it('shows the chosen account inside its chip', () => {
    const wrapper = mountToolbar({ accountId: 'account-id' });

    expect(wrapper.get('[data-testid="chip-accountId"]').text()).toContain('Основная карта');
    expect(wrapper.find('[data-testid="chip-clear"]').exists()).toBe(true);
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
    expect(list.closest('.ui-filter-bar__chips')).toBeNull();
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

  it('keeps every filter in the bar, without a drawer or dialog', () => {
    const wrapper = mountToolbar();

    expect(wrapper.find('[data-testid="more-filters"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="chip-status"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="chip-period"]').exists()).toBe(true);
  });

  it('shows the chosen period on its chip and clears both bounds', async () => {
    const wrapper = mountToolbar({ from: '2026-10-01', to: '2026-10-20' });
    const period = wrapper.get('[data-testid="chip-period"]');

    expect(period.text()).toContain('01.10 – 20.10.2026');
    await period.element
      .parentElement!.querySelector<HTMLElement>('[data-testid="chip-clear"]')!
      .click();

    expect(wrapper.emitted('change')).toEqual([
      ['from', ''],
      ['to', ''],
    ]);
  });

  it('clears a chosen value from the chip itself', async () => {
    const wrapper = mountToolbar({ categoryId: 'category-id' });

    expect(wrapper.get('[data-testid="chip-categoryId"]').text()).toContain('Продукты');
    await wrapper.get('[data-testid="chip-clear"]').trigger('click');

    expect(wrapper.emitted('change')).toEqual([['categoryId', '']]);
  });

  it('hides the author chip in a single-member family', () => {
    expect(mountToolbar().find('[data-testid="chip-createdByUserId"]').exists()).toBe(false);
  });

  it('offers an author chip once the family has more than one member', async () => {
    const authors = [
      { value: 'u1', label: 'Алия' },
      { value: 'u2', label: 'Марат' },
    ];
    const wrapper = mountToolbar({}, true, authors);

    expect(wrapper.find('[data-testid="chip-createdByUserId"]').exists()).toBe(true);
    await wrapper.get('[data-testid="chip-createdByUserId"]').trigger('click');
    await wrapper.get('[data-testid="chip-option-createdByUserId-u1"]').trigger('click');

    expect(wrapper.emitted('change')).toEqual([['createdByUserId', 'u1']]);
  });

  it('offers a reset only while some filter is set', async () => {
    expect(mountToolbar().find('[data-testid="reset-filters"]').exists()).toBe(false);
    const wrapper = mountToolbar({ status: 'DRAFT' });

    await wrapper.get('[data-testid="reset-filters"]').trigger('click');

    expect(wrapper.emitted('reset')).toHaveLength(1);
  });
});
