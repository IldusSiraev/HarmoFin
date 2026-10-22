import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import DashboardOverviewPanel from './DashboardOverviewPanel.vue';
import type { DashboardV2Response } from '../../composables/useEnvelopePlanV2.js';

const normalize = (value: string): string => value.replace(/\p{Zs}/gu, ' ');

const dashboard = {
  planModelVersion: 2,
  period: { start: '2026-10-10', end: '2026-10-24', periodId: 'p' },
  cycle: { start: '2026-10-10', end: '2026-11-09' },
  asOf: '2026-10-22',
  horizonEnd: '2026-11-09',
  spendable: { state: 'READY', amountMinor: '783766' },
  suggestedTarget: null,
  cashMinor: '64781339',
  currentBalanceMinor: '783766',
  mandatoryBalanceMinor: '2608957',
  mandatoryDueMinor: '7984300',
  mandatoryDueCurrentMinor: '4197300',
  mandatoryDueNextMinor: '3787000',
  otherProtectedMinor: '300000',
  protectedMinor: '2908957',
  freeToAssignMinor: '0',
  unbackedMinor: '0',
  mandatoryGapMinor: '0',
  mandatoryGapCurrentMinor: '0',
  mandatoryGapNextMinor: '0',
  dueMayBeIncomplete: false,
  nearestObligations: [],
  periodStats: null,
  envelopes: [],
  envelopesTotalMinor: '0',
  upcoming: [],
  accounts: [],
  protectedAssignments: [],
  warnings: [],
  onboarding: {
    categoriesSeeded: true,
    hasAccounts: true,
    needsOpeningAssignment: false,
    needsPeriodSetup: false,
    hasMandatoryPlans: true,
    mandatoryPlansDeclined: false,
  },
} satisfies DashboardV2Response;

describe('DashboardOverviewPanel', () => {
  it('lists cash, protected money and the spendable amount from the server', () => {
    const text = normalize(mount(DashboardOverviewPanel, { props: { dashboard } }).text());
    expect(text).toContain('Общая картина');
    expect(text).toContain('На счетах');
    expect(text).toContain('647 813,39 ₽');
    expect(text).toContain('Отложено на платежи и накопления');
    expect(text).toContain('29 089,57 ₽');
    expect(text).toContain('Свободно для текущих трат');
    expect(text).toContain('7 837,66 ₽');
  });

  it('says the limit is not set instead of a zero', () => {
    const text = normalize(
      mount(DashboardOverviewPanel, {
        props: {
          dashboard: {
            ...dashboard,
            spendable: { state: 'NEEDS_PERIOD_SETUP', amountMinor: null },
          },
        },
      }).text(),
    );
    expect(text).toContain('Лимит не настроен');
  });

  it('reveals the breakdown on request with valid aria wiring and dl markup', async () => {
    const wrapper = mount(DashboardOverviewPanel, { props: { dashboard } });
    const toggle = wrapper.get('[data-action="toggle-breakdown"]');
    expect(toggle.attributes('aria-expanded')).toBe('false');
    expect(toggle.attributes('aria-controls')).toBeUndefined();
    expect(wrapper.text()).not.toContain('Уже отложено на платежи и накопления');

    await toggle.trigger('click');
    const target = toggle.attributes('aria-controls');
    expect(target).toBeTruthy();
    expect(wrapper.find(`#${target}`).exists()).toBe(true);
    const text = normalize(wrapper.text());
    expect(text).toContain('Остаток текущего периода');
    expect(text).toContain('К оплате до 9 ноября');
    expect(text).toContain('79 843,00 ₽');
    expect(text).toContain('Уже отложено на платежи и накопления');
    expect(text).toContain('Конверты только показывают их назначение');
    for (const dl of wrapper.findAll('dl')) {
      for (const child of Array.from(dl.element.children)) {
        expect(['DIV', 'DT', 'DD']).toContain(child.tagName);
      }
    }
  });
});
