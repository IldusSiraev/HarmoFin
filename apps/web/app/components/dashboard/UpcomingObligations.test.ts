import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import UpcomingObligations from './UpcomingObligations.vue';

const item = {
  occurrenceId: 'occurrence-id',
  name: 'Ипотека',
  scheduledOn: '2026-10-26',
  unpaidMinor: '3597300',
};

const stubs = { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } };

describe('UpcomingObligations', () => {
  it('renders server values with a human date, amount and a link to the plan row', () => {
    const wrapper = mount(UpcomingObligations, { props: { items: [item] }, global: { stubs } });

    const text = wrapper.text().replaceAll(' ', ' ');
    expect(text).toContain('Ипотека');
    expect(text).toContain('35 973,00 ₽');
    expect(text).toContain('26 октября');
    // A raw ISO date next to the amount runs together in a narrow card.
    expect(text).not.toContain('2026-10-26');
    const link = wrapper.get('a[href="/app/plans?occurrence=occurrence-id"]');
    // Repeated links need distinct accessible names for screen-reader link lists.
    // One link to the whole plans page replaces the removed caption link in the spendable card.
    const all = wrapper.get('a[href="/app/plans"]');
    expect(all.text()).toBe('Все');
    expect(all.attributes('aria-label')).toBe('Все: Обязательные платежи');
    expect(link.attributes('aria-label')).toBe('Открыть план: Ипотека, 26 октября');
  });

  it('renders the empty state', () => {
    expect(
      mount(UpcomingObligations, { props: { items: [] }, global: { stubs } }).text(),
    ).toContain('Ближайших обязательных платежей нет.');
  });
});
