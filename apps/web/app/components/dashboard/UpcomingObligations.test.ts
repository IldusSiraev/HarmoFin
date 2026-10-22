import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import UpcomingObligations from './UpcomingObligations.vue';
import type { DashboardV2Response } from '../../composables/useEnvelopePlanV2.js';

type Obligation = DashboardV2Response['nearestObligations'][number];

const normalize = (value: string): string => value.replace(/\p{Zs}/gu, ' ');
const item = (over: Partial<Obligation> = {}): Obligation => ({
  occurrenceId: 'occurrence-id',
  name: 'Ипотека',
  scheduledOn: '2026-10-26',
  unpaidMinor: '3597300',
  coverage: 'COVERED',
  shortfallMinor: '0',
  ...over,
});
const stubs = { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } };
const mountList = (items: Obligation[]) =>
  mount(UpcomingObligations, { props: { items }, global: { stubs } });

describe('UpcomingObligations', () => {
  it('renders the whole row as one plan link with a date tile, amount and one accessible name', () => {
    const wrapper = mountList([item()]);
    const link = wrapper.get('a[href="/app/plans?occurrence=occurrence-id"]');
    const text = normalize(link.text());
    expect(text).toContain('Ипотека');
    expect(text).toContain('35 973,00 ₽');
    expect(text).toContain('26');
    expect(text).not.toContain('2026-10-26');
    expect(normalize(link.attributes('aria-label') ?? '')).toBe(
      'Ипотека, 26 октября, 35 973,00 ₽, отложено полностью',
    );
    expect(link.find('a, button').exists()).toBe(false);
    const all = wrapper.get('a[href="/app/plans"]');
    expect(all.text()).toContain('Все планы');
  });

  it.each([
    ['COVERED', '0', 'Отложено полностью'],
    ['PARTIAL', '1100000', 'Нужно пополнить 11 000,00 ₽'],
    ['UNCOVERED', '3597300', 'Не отложено'],
  ] as const)('shows %s coverage as icon plus text', (coverage, shortfallMinor, label) => {
    const wrapper = mountList([item({ coverage, shortfallMinor })]);
    const status = wrapper.get('[data-testid="obligation-status"]');
    expect(normalize(status.text())).toBe(label);
    expect(status.find('svg[aria-hidden="true"]').exists()).toBe(true);
  });

  it('renders the empty state', () => {
    expect(mountList([]).text()).toContain('Ближайших обязательных платежей нет.');
  });
});
