import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import DashboardWarnings from './DashboardWarnings.vue';

const NuxtLinkStub = {
  name: 'NuxtLink',
  props: { to: { type: String, required: true } },
  template: '<a :href="to"><slot /></a>',
};

describe('DashboardWarnings', () => {
  type V2Code = 'MANDATORY_GAP' | 'CASH_SHORTFALL' | 'PERIOD_DEFICIT' | 'PERIOD_LEFTOVER';
  const v2Warning = (code: V2Code, actionPath: string, index = 0, level?: 'ALERT' | 'INFO') => {
    const warning = {
      kind: code.startsWith('PERIOD') ? ('PERIOD' as const) : ('COVERAGE' as const),
      code,
      message: `Серверный текст ${code} ${index}`,
      amountMinor: '1000000',
      envelopeId: null,
      periodId: null,
      balanceMinor: null,
      actionPath,
    };
    return level === undefined ? warning : { ...warning, level };
  };
  const mountWarnings = (v2Warnings: ReturnType<typeof v2Warning>[]) =>
    mount(DashboardWarnings, {
      props: { v2Warnings },
      global: { stubs: { NuxtLink: NuxtLinkStub } },
    });

  it.each([
    ['MANDATORY_GAP', 'Покрыть обязательные', '/app/envelopes?cover=mandatory', true],
    ['CASH_SHORTFALL', 'Проверить счета', '/app/accounts', true],
    ['PERIOD_DEFICIT', 'Покрыть превышение', '/app/envelopes?coverPeriod=p1', true],
    ['PERIOD_LEFTOVER', 'Решить, куда направить', '/app/envelopes?leftoverPeriod=p1', false],
  ] as const)('renders %s with action, server path and icon', (code, label, path, danger) => {
    const wrapper = mountWarnings([v2Warning(code, path)]);

    expect(wrapper.text()).toContain(`Серверный текст ${code}`);
    const link = wrapper.get('a');
    expect(link.text()).toBe(label);
    expect(link.attributes('href')).toBe(path);
    expect(wrapper.find('.dashboard-warnings__icon--danger').exists()).toBe(danger);
    expect(wrapper.find('svg').exists()).toBe(true);
  });

  it('renders MANDATORY_GAP with level ALERT as a danger triangle', () => {
    const wrapper = mountWarnings([v2Warning('MANDATORY_GAP', '/x', 0, 'ALERT')]);
    expect(wrapper.find('.dashboard-warnings__icon--danger').exists()).toBe(true);
    expect(wrapper.find('.dashboard-warnings__icon--info').exists()).toBe(false);
  });

  it('renders MANDATORY_GAP with level INFO as a neutral info icon', () => {
    const wrapper = mountWarnings([v2Warning('MANDATORY_GAP', '/x', 0, 'INFO')]);
    expect(wrapper.find('.dashboard-warnings__icon--danger').exists()).toBe(false);
    expect(wrapper.find('.dashboard-warnings__icon--info').exists()).toBe(true);
  });

  it('falls back to ALERT when MANDATORY_GAP has no level', () => {
    const wrapper = mountWarnings([v2Warning('MANDATORY_GAP', '/x', 0)]);
    expect(wrapper.find('.dashboard-warnings__icon--danger').exists()).toBe(true);
    expect(wrapper.find('.dashboard-warnings__icon--info').exists()).toBe(false);
  });

  it('keeps rows with identical codes and no ids distinct', () => {
    const wrapper = mountWarnings([
      v2Warning('MANDATORY_GAP', '/a', 0),
      v2Warning('MANDATORY_GAP', '/b', 1),
    ]);
    expect(wrapper.findAll('li')).toHaveLength(2);
  });

  it('renders nothing for empty warnings', () => {
    expect(mountWarnings([]).find('section').exists()).toBe(false);
  });
});
