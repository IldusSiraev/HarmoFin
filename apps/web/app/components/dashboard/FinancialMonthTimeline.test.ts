import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import FinancialMonthTimeline from './FinancialMonthTimeline.vue';

const cycle = { start: '2026-09-10', end: '2026-10-09' };
const first = { start: '2026-09-10', end: '2026-09-24' };
const second = { start: '2026-09-25', end: '2026-10-09' };

describe('FinancialMonthTimeline', () => {
  it('shows the cycle range in words', () => {
    const text = mount(FinancialMonthTimeline, {
      props: { cycle, period: first, asOf: '2026-09-17' },
    }).text();

    expect(text).toContain('Ваш финансовый месяц');
    expect(text).toContain('10 сентября');
    expect(text).toContain('9 октября');
  });

  it('places the server date and the period boundary along the track as percentages', () => {
    const wrapper = mount(FinancialMonthTimeline, {
      props: { cycle, period: first, asOf: '2026-09-17' },
    });

    // 2026-09-17 is 7 days into a 29-day span (10 сен -> 9 окт).
    expect(wrapper.get('.fm-timeline__today').attributes('style')).toContain(
      `left: ${(7 / 29) * 100}%`,
    );
    // The first period ends 2026-09-24, so the boundary is the next day (offset 15).
    expect(wrapper.get('.fm-timeline__boundary').attributes('style')).toContain(
      `left: ${(15 / 29) * 100}%`,
    );
    expect(wrapper.text()).toContain('25 сент.');
  });

  it('puts the boundary at the start of the second period', () => {
    const wrapper = mount(FinancialMonthTimeline, {
      props: { cycle, period: second, asOf: '2026-10-04' },
    });

    expect(wrapper.get('.fm-timeline__boundary').attributes('style')).toContain(
      `left: ${(15 / 29) * 100}%`,
    );
    expect(wrapper.get('.fm-timeline__today').attributes('style')).toContain(
      `left: ${(24 / 29) * 100}%`,
    );
  });

  it('hides the today marker and wording when the server date is outside the cycle', () => {
    const wrapper = mount(FinancialMonthTimeline, {
      props: { cycle, period: first, asOf: '2026-12-01' },
    });

    expect(wrapper.find('.fm-timeline__today').exists()).toBe(false);
    expect(wrapper.find('.fm-timeline__mark--today').exists()).toBe(false);
    expect(wrapper.get('[role="img"]').attributes('aria-label')).not.toContain('Сегодня');
  });

  it('keeps the today label alone above the track and the other labels below it', () => {
    const wrapper = mount(FinancialMonthTimeline, {
      props: { cycle, period: first, asOf: '2026-09-25' },
    });
    const rows = wrapper.findAll('.fm-timeline__marks');

    expect(rows).toHaveLength(2);
    expect(rows[0]!.findAll('.fm-timeline__mark')).toHaveLength(1);
    expect(rows[0]!.text()).toBe('25 сент.');
    expect(rows[1]!.findAll('.fm-timeline__mark')).toHaveLength(3);
  });

  it('keeps the boundary label clear of the start and end labels', () => {
    const early = mount(FinancialMonthTimeline, {
      props: {
        cycle,
        period: { start: '2026-09-10', end: '2026-09-11' },
        asOf: '2026-09-10',
      },
    });
    const late = mount(FinancialMonthTimeline, {
      props: {
        cycle,
        period: { start: '2026-10-08', end: '2026-10-09' },
        asOf: '2026-10-09',
      },
    });

    expect(early.get('.fm-timeline__mark--boundary').attributes('style')).toContain('left: 34%');
    expect(late.get('.fm-timeline__mark--boundary').attributes('style')).toContain('left: 66%');
  });

  it('hides the boundary when the cycle has only one period', () => {
    const wrapper = mount(FinancialMonthTimeline, {
      props: { cycle, period: cycle, asOf: '2026-09-17' },
    });

    expect(wrapper.find('.fm-timeline__boundary').exists()).toBe(false);
  });

  it('exposes the same information to assistive technology as one accessible summary', () => {
    const wrapper = mount(FinancialMonthTimeline, {
      props: { cycle, period: second, asOf: '2026-09-17' },
    });

    expect(wrapper.get('[role="img"]').attributes('aria-label')).toBe(
      'Финансовый месяц: с 10 сентября по 9 октября. Сегодня — день 8 из 30. Смена периода: 25 сент.',
    );
  });

  it('drops its own card surface when embedded, keeping the same summary', () => {
    const props = {
      cycle: { start: '2026-10-10', end: '2026-11-09' },
      period: { start: '2026-10-10', end: '2026-10-24' },
      asOf: '2026-10-22',
    };
    const standalone = mount(FinancialMonthTimeline, { props });
    const embedded = mount(FinancialMonthTimeline, { props: { ...props, embedded: true } });
    expect(embedded.classes()).toContain('fm-timeline--embedded');
    expect(standalone.classes()).not.toContain('fm-timeline--embedded');
    expect(embedded.get('[role="img"]').attributes('aria-label')).toBe(
      standalone.get('[role="img"]').attributes('aria-label'),
    );
    expect(embedded.text()).not.toContain('%');
  });
});
