import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import DashboardWarnings from './DashboardWarnings.vue';

const NuxtLinkStub = {
  name: 'NuxtLink',
  props: { to: { type: String, required: true } },
  template: '<a :href="to"><slot /></a>',
};
const normalize = (value: string): string => value.replace(/\p{Zs}/gu, ' ');

type Code = 'MANDATORY_GAP' | 'CASH_SHORTFALL' | 'PERIOD_DEFICIT' | 'PERIOD_LEFTOVER';
const warning = (code: Code, actionPath: string, level?: 'ALERT' | 'INFO', index = 0) => ({
  kind: code.startsWith('PERIOD') ? ('PERIOD' as const) : ('COVERAGE' as const),
  code,
  message: `Серверный текст ${code} ${index}`,
  amountMinor: '1000000',
  envelopeId: null,
  periodId: null,
  balanceMinor: null,
  actionPath,
  ...(level ? { level } : {}),
});
const mountWarnings = (v2Warnings: ReturnType<typeof warning>[], freeToAssignMinor = '0') =>
  mount(DashboardWarnings, {
    props: { v2Warnings, freeToAssignMinor },
    global: { stubs: { NuxtLink: NuxtLinkStub } },
  });

describe('DashboardWarnings', () => {
  it.each([
    ['MANDATORY_GAP', 'ALERT', 'warning', 'Не хватает на обязательные платежи', 'Покрыть'],
    ['MANDATORY_GAP', 'INFO', 'info', 'Заложите на следующий период', 'Покрыть'],
    ['MANDATORY_GAP', undefined, 'warning', 'Не хватает на обязательные платежи', 'Покрыть'],
    ['CASH_SHORTFALL', undefined, 'danger', 'Не хватает денег на счетах', 'Разобраться'],
  ] as const)(
    '%s %s: tone %s, title, server text and server link',
    (code, level, tone, title, label) => {
      const wrapper = mountWarnings([warning(code, '/server/path', level)]);
      const row = wrapper.get('.ui-attention-row');
      expect(row.classes()).toContain(`ui-attention-row--${tone}`);
      expect(row.text()).toContain(title);
      expect(row.text()).toContain(`Серверный текст ${code}`);
      const link = row.get('a');
      expect(link.text()).toBe(label);
      expect(link.attributes('href')).toBe('/server/path');
    },
  );

  it('leaves period warnings to the period decision card', () => {
    const wrapper = mountWarnings([
      warning('PERIOD_LEFTOVER', '/a'),
      warning('PERIOD_DEFICIT', '/b'),
    ]);
    expect(wrapper.find('section').exists()).toBe(false);
  });

  it('offers to assign free income with the server amount and emits assign', async () => {
    const wrapper = mountWarnings([], '1200000');
    const row = wrapper.get('[data-code="FREE_MONEY"]');
    expect(normalize(row.text())).toContain('Есть нераспределённый доход');
    expect(normalize(row.text())).toContain('12 000,00 ₽ можно направить в конверты');
    await row.get('button').trigger('click');
    expect(wrapper.emitted('assign')).toHaveLength(1);
  });

  it('shows no free income row for zero or negative amounts', () => {
    expect(mountWarnings([], '0').find('section').exists()).toBe(false);
    expect(mountWarnings([], '-100').find('section').exists()).toBe(false);
  });

  it('keeps rows with identical codes distinct and names the block for screen readers', () => {
    const wrapper = mountWarnings([
      warning('MANDATORY_GAP', '/a', 'ALERT', 0),
      warning('MANDATORY_GAP', '/b', 'ALERT', 1),
    ]);
    expect(wrapper.findAll('[data-testid="attention-row"]')).toHaveLength(2);
    const section = wrapper.get('section');
    expect(wrapper.get(`#${section.attributes('aria-labelledby')}`).text()).toBe(
      'Требует внимания',
    );
  });
});
