import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import PlanOccurrenceRow from './PlanOccurrenceRow.vue';
import type { PlanOccurrenceDto } from '../../composables/useBudgetReferenceData.js';

function occurrence(overrides: Partial<PlanOccurrenceDto> = {}): PlanOccurrenceDto {
  return {
    id: 'occurrence-id',
    planId: 'plan-id',
    planName: 'Ипотека',
    planType: 'EXPENSE',
    scheduledOn: '2026-09-26',
    status: 'DUE',
    amountMinor: '3600000',
    currency: 'RUB',
    scale: 2,
    accountId: 'account-id',
    categoryId: 'category-id',
    envelopeId: 'envelope-id',
    comment: null,
    transactionId: null,
    cancellationReason: null,
    ...overrides,
  };
}

describe('PlanOccurrenceRow', () => {
  it('emits complete when the checkbox is checked', async () => {
    const wrapper = mount(PlanOccurrenceRow, {
      props: { occurrence: occurrence(), categoryIcon: null },
    });

    await wrapper.get('input[type="checkbox"]').setValue(true);

    expect(wrapper.emitted('complete')).toHaveLength(1);
  });

  it('emits edit and remove from the always-visible icon buttons', async () => {
    const wrapper = mount(PlanOccurrenceRow, {
      props: { occurrence: occurrence(), categoryIcon: null },
    });

    await wrapper.get('[data-action="edit-occurrence-plan"]').trigger('click');
    await wrapper.get('[data-action="remove-occurrence-plan"]').trigger('click');

    expect(wrapper.emitted('edit')).toHaveLength(1);
    expect(wrapper.emitted('remove')).toHaveLength(1);
  });

  it('offers draft and skip in the overflow menu when both apply', async () => {
    const wrapper = mount(PlanOccurrenceRow, {
      props: { occurrence: occurrence(), categoryIcon: null },
    });

    await wrapper.get('[data-testid="action-menu-trigger"]').trigger('click');
    await wrapper.get('[data-testid="row-draft"]').trigger('click');
    expect(wrapper.emitted('draft')).toHaveLength(1);

    // UiActionMenu closes itself on any menu-item click (established convention,
    // see apps/web/app/pages/app/operations.vue), so the menu must be reopened
    // before the second item is reachable.
    await wrapper.get('[data-testid="action-menu-trigger"]').trigger('click');
    await wrapper.get('[data-testid="row-skip"]').trigger('click');
    expect(wrapper.emitted('skip')).toHaveLength(1);
  });

  it('hides draft for a savings occurrence and hides both once a transaction exists', async () => {
    const savings = mount(PlanOccurrenceRow, {
      props: { occurrence: occurrence({ planType: 'SAVINGS' }), categoryIcon: null },
    });
    // UiActionMenu only renders its slot content once opened (v-if="open"), so
    // the menu must be opened before checking which items it offers.
    await savings.get('[data-testid="action-menu-trigger"]').trigger('click');
    expect(savings.find('[data-testid="row-draft"]').exists()).toBe(false);
    expect(savings.find('[data-testid="row-skip"]').exists()).toBe(true);

    const withTransaction = mount(PlanOccurrenceRow, {
      props: { occurrence: occurrence({ transactionId: 'transaction-id' }), categoryIcon: null },
    });
    expect(withTransaction.find('[data-testid="action-menu-trigger"]').exists()).toBe(false);
  });

  it('shows a status label with no actions for a completed occurrence', () => {
    const wrapper = mount(PlanOccurrenceRow, {
      props: { occurrence: occurrence({ status: 'COMPLETED' }), categoryIcon: null },
    });

    expect(wrapper.text()).toContain('Выполнено');
    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false);
  });

  it('renders a leading icon regardless of whether a category icon is set', () => {
    const withCategoryIcon = mount(PlanOccurrenceRow, {
      props: { occurrence: occurrence(), categoryIcon: 'house' },
    });
    const withoutCategoryIcon = mount(PlanOccurrenceRow, {
      props: { occurrence: occurrence(), categoryIcon: null },
    });

    expect(withCategoryIcon.find('svg').exists()).toBe(true);
    expect(withoutCategoryIcon.find('svg').exists()).toBe(true);
  });
});
