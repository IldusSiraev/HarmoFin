import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import GoalProgress from './GoalProgress.vue';

const row = {
  envelopeId: 'g',
  name: 'Отпуск',
  envelopeType: 'SAVINGS_GOAL',
  currentMinor: '1234500',
  targetMinor: '5000000',
  targetDate: '2026-12-31',
  remainingMinor: '3765500',
  progressPermille: 247,
  isReached: false,
  daysRemaining: 75,
};
const flat = (text: string) => text.replace(/\s/g, ' ');

describe('GoalProgress', () => {
  it('отложено из цели, осталось, срок', () => {
    const wrapper = mount(GoalProgress, { props: { row } });
    const text = flat(wrapper.text());
    expect(text).toContain('Отпуск');
    expect(text).toContain('Отложено 12 345,00 ₽ из 50 000,00 ₽');
    expect(text).toContain('Осталось 37 655,00 ₽');
    expect(text).toContain('Осталось дней: 75');
    expect(wrapper.get('[data-fill]').attributes('data-percent')).toBe('24.7');
  });

  it('целевая дата без оставшихся дней — в формате дд.мм.гггг', () => {
    const wrapper = mount(GoalProgress, {
      props: { row: { ...row, daysRemaining: null } },
    });
    expect(flat(wrapper.text())).toContain('Целевая дата: 31.12.2026');
  });

  it('достигнутая цель — статус текстом', () => {
    const wrapper = mount(GoalProgress, {
      props: { row: { ...row, isReached: true, progressPermille: 1000, remainingMinor: '0' } },
    });
    expect(wrapper.text()).toContain('Цель достигнута');
    expect(wrapper.text()).not.toContain('Осталось 0');
  });
});
