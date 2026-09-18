import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import FinancialMonthTimeline from './FinancialMonthTimeline.vue';

const cycle = { start: '2026-09-10', end: '2026-10-09' };

describe('FinancialMonthTimeline', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 17));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the cycle range in words', () => {
    const wrapper = mount(FinancialMonthTimeline, {
      props: { cycle, period: { id: 'FIRST', start: '2026-09-10', end: '2026-09-24' } },
    });
    const text = wrapper.text();

    expect(text).toContain('Ваш финансовый месяц');
    expect(text).toContain('10 сентября');
    expect(text).toContain('9 октября');
  });

  it('places today and the period boundary along the track as percentages', () => {
    const wrapper = mount(FinancialMonthTimeline, {
      props: { cycle, period: { id: 'FIRST', start: '2026-09-10', end: '2026-09-24' } },
    });

    // 2026-09-17 is 7 days into a 29-day span (10 сен -> 9 окт).
    const today = wrapper.get('.fm-timeline__today');
    expect(today.attributes('style')).toContain(`left: ${(7 / 29) * 100}%`);

    // The FIRST period ends 2026-09-24, so the boundary sits the next day (offset 15).
    const boundary = wrapper.get('.fm-timeline__boundary');
    expect(boundary.attributes('style')).toContain(`left: ${(15 / 29) * 100}%`);
  });

  it('exposes the same information to assistive technology as one accessible summary', () => {
    const wrapper = mount(FinancialMonthTimeline, {
      props: { cycle, period: { id: 'SECOND', start: '2026-09-25', end: '2026-10-09' } },
    });

    expect(wrapper.get('[role="img"]').attributes('aria-label')).toBe(
      'Финансовый месяц: с 10 сентября по 9 октября. Сегодня — день 8 из 30.',
    );
  });
});
