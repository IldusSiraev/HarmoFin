import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import UpcomingObligations from './UpcomingObligations.vue';

const item = {
  occurrenceId: 'occurrence-id',
  planName: 'Ипотека',
  scheduledOn: '2026-09-10',
  amountMinor: '3600000',
  currency: 'RUB' as const,
  scale: 2 as const,
  status: 'DUE' as const,
  envelopeId: 'envelope-id',
  actionPath: '/app/plans?occurrence=occurrence-id',
};

describe('UpcomingObligations', () => {
  it('renders server projection with amount, status and action link', () => {
    const wrapper = mount(UpcomingObligations, {
      props: { items: [item] },
      global: {
        stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } },
      },
    });

    const text = wrapper.text().replaceAll(' ', ' ');
    expect(text).toContain('Ипотека');
    expect(text).toContain('36 000,00 ₽');
    expect(text).toContain('Сегодня');
    expect(wrapper.get('a[href="/app/plans?occurrence=occurrence-id"]')).toBeTruthy();
  });

  it('renders empty state', () => {
    expect(mount(UpcomingObligations, { props: { items: [] } }).text()).toContain(
      'Ближайших обязательств нет.',
    );
  });
});
