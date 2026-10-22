import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import DashboardEnvelopeRow from './DashboardEnvelopeRow.vue';

const normalize = (value: string): string => value.replace(/\p{Zs}/gu, ' ');
const base = {
  id: 'e',
  name: 'Обязательные платежи',
  envelopeType: 'MANDATORY_EXPENSES',
  periodSlot: null,
  balanceMinor: '2608957',
  progress: null,
} as const;

describe('DashboardEnvelopeRow', () => {
  it('shows a coverage bar in the type colour and the server shortfall', () => {
    const wrapper = mount(DashboardEnvelopeRow, {
      props: {
        envelope: {
          ...base,
          progress: {
            kind: 'COVERED',
            valueMinor: '2608957',
            maxMinor: '7984300',
            shortfallMinor: '5375343',
          },
        },
      },
    });
    const bar = wrapper.get('[role="progressbar"]');
    expect(bar.attributes('aria-label')).toBe('Покрыто ближайших платежей');
    expect(bar.attributes('aria-valuenow')).toBe('32');
    expect(wrapper.find('.ui-progress__fill--mandatory').exists()).toBe(true);
    expect(normalize(wrapper.text())).toContain('Нужно пополнить 53 753,43 ₽');
    expect(normalize(wrapper.text())).toContain('26 089,57 ₽');
  });

  it('says fully set aside when nothing is short', () => {
    const wrapper = mount(DashboardEnvelopeRow, {
      props: {
        envelope: {
          ...base,
          progress: {
            kind: 'COVERED',
            valueMinor: '9000000',
            maxMinor: '7984300',
            shortfallMinor: '0',
          },
        },
      },
    });
    expect(wrapper.text()).toContain('Отложено полностью');
  });

  it('keeps the type subtitle for spent and goal bars', () => {
    const wrapper = mount(DashboardEnvelopeRow, {
      props: {
        envelope: {
          ...base,
          name: 'Автомобиль',
          envelopeType: 'SAVINGS_GOAL',
          balanceMinor: '300000',
          progress: {
            kind: 'GOAL',
            valueMinor: '300000',
            maxMinor: '2000000',
            shortfallMinor: null,
          },
        },
      },
    });
    expect(wrapper.get('[role="progressbar"]').attributes('aria-label')).toBe('Цель');
    expect(wrapper.find('.ui-progress__fill--savings').exists()).toBe(true);
    expect(wrapper.text()).not.toContain('Нужно пополнить');
  });

  it('renders no bar without progress', () => {
    const wrapper = mount(DashboardEnvelopeRow, { props: { envelope: base } });
    expect(wrapper.find('[role="progressbar"]').exists()).toBe(false);
  });
});
