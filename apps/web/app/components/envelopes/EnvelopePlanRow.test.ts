import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import EnvelopePlanRow from './EnvelopePlanRow.vue';

const base = {
  id: 'e1',
  name: 'Ремонт',
  envelopeType: 'CUSTOM',
  periodSlot: null,
  targetAmountMinor: null,
  comment: null,
  fundedMinor: '4000000',
  spentMinor: '1200000',
  balanceMinor: '2800000',
  archivedAt: null,
};

const plain = (value: string): string => value.replace(/\s/g, ' ');

describe('EnvelopePlanRow', () => {
  it('shows funded, spent and left as assignment values with a full accessible label', () => {
    const wrapper = mount(EnvelopePlanRow, { props: { envelope: base } });

    const text = plain(wrapper.text());
    expect(text).toContain('Отложено 40 000');
    expect(text).toContain('Потрачено 12 000');
    expect(text).toContain('Осталось');
    expect(text).toContain('28 000');
    expect(text).not.toContain('Начальный баланс конверта');
    expect(
      plain(wrapper.get('[data-testid="list-row-select"]').attributes('aria-label')!),
    ).toContain('осталось 28 000');
  });

  it('marks an overspent envelope with text, not only color', () => {
    const wrapper = mount(EnvelopePlanRow, {
      props: { envelope: { ...base, balanceMinor: '-100000' } },
    });

    expect(wrapper.text()).toContain('Перерасход');
  });

  it('shows the goal without inventing a period status', () => {
    const wrapper = mount(EnvelopePlanRow, {
      props: { envelope: { ...base, envelopeType: 'SAVINGS_GOAL', targetAmountMinor: '100000' } },
    });

    expect(plain(wrapper.get('[data-testid="plan-row-target"]').text())).toContain('100 000');
    expect(wrapper.text()).toContain('не сбрасывается');
  });

  it.each([
    ['5000', '5 000,00'],
    ['5000.5', '5 000,50'],
    ['5000.00', '5 000,00'],
    ['0', '0,00'],
  ])('shows the decimal-ruble goal %s as %s', (target, shown) => {
    const wrapper = mount(EnvelopePlanRow, {
      props: { envelope: { ...base, envelopeType: 'SAVINGS_GOAL', targetAmountMinor: target } },
    });

    expect(plain(wrapper.get('[data-testid="plan-row-target"]').text())).toContain(shown);
  });

  it('marks a highlighted row with a text label', () => {
    const wrapper = mount(EnvelopePlanRow, {
      props: { envelope: base, highlight: 'Нужно пополнить' },
    });

    expect(wrapper.text()).toContain('Нужно пополнить');
  });
});
