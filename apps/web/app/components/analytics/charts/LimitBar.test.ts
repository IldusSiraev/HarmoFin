import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import type { EnvelopeLimitV2Row } from '../../../composables/useEnvelopePlanV2.js';
import LimitBar from './LimitBar.vue';

const row: EnvelopeLimitV2Row = {
  periodId: 'p',
  periodStart: '2026-03-01',
  periodEnd: '2026-03-14',
  isCurrent: true,
  envelopeId: 'e',
  envelopeName: 'Продукты',
  targetMinor: '1000000',
  targetStatus: 'CONFIRMED',
  spentMinor: '400000',
  remainingMinor: '600000',
  overspentMinor: '0',
  spentPermille: 400,
};
const flat = (text: string) => text.replace(/\s/g, ' ');

describe('LimitBar', () => {
  it('потрачено из лимита и остаток', () => {
    const wrapper = mount(LimitBar, { props: { row } });
    expect(flat(wrapper.text())).toContain('Потрачено 4 000,00 ₽ из 10 000,00 ₽');
    expect(flat(wrapper.text())).toContain('Осталось 6 000,00 ₽');
    expect(wrapper.get('[data-fill]').attributes('data-percent')).toBe('40');
    expect(wrapper.find('[data-overspent]').exists()).toBe(false);
  });

  it('перерасход — текстом и статусом, полоса заполнена', () => {
    const wrapper = mount(LimitBar, {
      props: {
        row: {
          ...row,
          spentMinor: '1200000',
          remainingMinor: '-200000',
          overspentMinor: '200000',
          spentPermille: 1200,
        },
      },
    });
    expect(flat(wrapper.get('[data-overspent]').text())).toContain('Перерасход 2 000,00 ₽');
    expect(wrapper.get('[data-fill]').attributes('data-percent')).toBe('100');
    expect(wrapper.get('[data-fill]').classes()).toContain('limit-bar__fill--over');
  });

  it('без лимита: подсказка и сумма без полосы', () => {
    const wrapper = mount(LimitBar, {
      props: {
        row: {
          ...row,
          targetMinor: null,
          targetStatus: 'UNSET',
          remainingMinor: null,
          spentPermille: null,
        },
      },
    });
    expect(wrapper.text()).toContain('Лимит на период не задан');
    expect(flat(wrapper.text())).toContain('Потрачено 4 000,00 ₽');
    expect(wrapper.find('[data-fill]').exists()).toBe(false);
  });

  it('черновик лимита помечен', () => {
    const wrapper = mount(LimitBar, { props: { row: { ...row, targetStatus: 'DRAFT' } } });
    expect(wrapper.text()).toContain('Лимит не подтверждён');
  });
});
