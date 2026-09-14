import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import EnvelopeRow from './EnvelopeRow.vue';
import type { EnvelopeDto } from '../../composables/useBudgetReferenceData.js';

const envelope: EnvelopeDto = {
  id: 'envelope-id',
  budgetId: 'budget-id',
  templateKey: null,
  name: 'Текущие расходы',
  envelopeType: 'CURRENT_EXPENSES',
  periodSlot: 'FIRST',
  currency: 'RUB',
  scale: 2,
  startingBalanceMinor: '1000000',
  currentBalanceMinor: '245000',
  monthlyPlannedAmountMinor: '300000',
  targetAmountMinor: null,
  targetDate: null,
  displayOrder: 10,
  comment: null,
  archivedAt: null,
};

const mountRow = (overrides: Partial<EnvelopeDto> = {}) =>
  mount(EnvelopeRow, { props: { envelope: { ...envelope, ...overrides } } });

const normalize = (value: string): string => value.replace(/[\u00a0\u202f]/g, ' ');

describe('EnvelopeRow', () => {
  it('leads with the name, the type and the period half', () => {
    const text = normalize(mountRow().text());

    expect(text).toContain('Текущие расходы');
    expect(text).toContain('Первая половина');
    expect(text).toContain('2 450,00 ₽');
  });

  it('draws a progress bar only for a savings goal', () => {
    expect(mountRow().find('[role="progressbar"]').exists()).toBe(false);

    const goal = mountRow({
      envelopeType: 'SAVINGS_GOAL',
      name: 'Отпуск',
      periodSlot: null,
      targetAmountMinor: '5000000',
      currentBalanceMinor: '1000000',
    });

    expect(goal.get('[role="progressbar"]').attributes('aria-valuenow')).toBe('20');
    expect(normalize(goal.get('[data-testid="envelope-row-goal"]').text())).toBe(
      '10 000,00 ₽ из 50 000,00 ₽',
    );
  });

  it('marks an archived envelope', () => {
    expect(
      mountRow({ archivedAt: '2026-09-10T00:00:00.000Z' })
        .get('[data-testid="envelope-row-archived"]')
        .text(),
    ).toBe('В архиве');
  });

  it('selects the envelope when the row is pressed', async () => {
    const wrapper = mountRow();

    await wrapper.get('[data-testid="list-row-select"]').trigger('click');

    expect(wrapper.emitted('select')).toHaveLength(1);
  });
});
