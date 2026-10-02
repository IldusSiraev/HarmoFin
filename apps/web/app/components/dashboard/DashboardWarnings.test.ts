import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import DashboardWarnings from './DashboardWarnings.vue';

const NuxtLinkStub = {
  name: 'NuxtLink',
  props: { to: { type: String, required: true } },
  template: '<a :href="to"><slot /></a>',
};

const accounts = [{ id: 'account-id', name: 'Основная карта', balanceMinor: '-450000' }];
const envelopes = [{ id: 'envelope-id', name: 'Ремонт', balanceMinor: '-120000' }];

type WarningsProps = {
  warnings: { subject: 'ACCOUNT' | 'ENVELOPE'; id: string; balanceMinor: string }[];
  accounts: { id: string; name: string; balanceMinor: string }[];
  envelopes: { id: string; name: string; balanceMinor: string }[];
  unallocatedIncomeMinor: string;
  unassignedStartingBalanceMinor: string;
};

const mountWarnings = (props: WarningsProps) =>
  mount(DashboardWarnings, { props, global: { stubs: { NuxtLink: NuxtLinkStub } } });

const normalize = (value: string): string => value.replace(/[\u00a0\u202f]/g, ' ');

describe('DashboardWarnings', () => {
  it('renders nothing when there is nothing to warn about', () => {
    const wrapper = mountWarnings({
      warnings: [],
      accounts,
      envelopes,
      unallocatedIncomeMinor: '0',
      unassignedStartingBalanceMinor: '0',
    });

    expect(wrapper.find('[data-testid="dashboard-warnings"]').exists()).toBe(false);
  });

  it('names the account behind a warning and links to its section', () => {
    const wrapper = mountWarnings({
      warnings: [{ subject: 'ACCOUNT', id: 'account-id', balanceMinor: '-450000' }],
      accounts,
      envelopes,
      unallocatedIncomeMinor: '0',
      unassignedStartingBalanceMinor: '0',
    });

    const text = normalize(wrapper.text());
    expect(text).toContain('Основная карта');
    expect(text).toContain('-4 500,00 ₽');
    expect(wrapper.get('a').attributes('href')).toBe('/app/accounts');
  });

  it('links an envelope warning to the envelopes section', () => {
    const wrapper = mountWarnings({
      warnings: [{ subject: 'ENVELOPE', id: 'envelope-id', balanceMinor: '-120000' }],
      accounts,
      envelopes,
      unallocatedIncomeMinor: '0',
      unassignedStartingBalanceMinor: '0',
    });

    expect(normalize(wrapper.text())).toContain('Ремонт');
    expect(wrapper.get('a').attributes('href')).toBe('/app/envelopes');
  });

  it('reports unallocated income as its own warning', () => {
    const wrapper = mountWarnings({
      warnings: [],
      accounts,
      envelopes,
      unallocatedIncomeMinor: '1200000',
      unassignedStartingBalanceMinor: '0',
    });

    const text = normalize(wrapper.text());
    expect(text).toContain('Доход не распределён');
    expect(text).toContain('12 000,00 ₽');
    expect(wrapper.get('a').attributes('href')).toBe('/app/operations');
  });

  it('survives a warning whose subject is missing from the lists', () => {
    const wrapper = mountWarnings({
      warnings: [{ subject: 'ACCOUNT', id: 'unknown-id', balanceMinor: '-100' }],
      accounts,
      envelopes,
      unallocatedIncomeMinor: '0',
      unassignedStartingBalanceMinor: '0',
    });

    expect(wrapper.text()).toContain('Счёт');
  });

  it('reports unassigned starting balances as an informational warning', () => {
    const wrapper = mountWarnings({
      warnings: [],
      accounts,
      envelopes,
      unallocatedIncomeMinor: '0',
      unassignedStartingBalanceMinor: '900000',
    });

    const text = normalize(wrapper.text());
    expect(text).toContain('Начальные остатки не распределены по конвертам');
    expect(text).toContain('9 000,00 ₽');
    expect(wrapper.get('a').attributes('href')).toBe('/app/envelopes');
  });

  it('flags envelopes that assign more money than accounts hold as a danger warning', () => {
    const wrapper = mountWarnings({
      warnings: [],
      accounts,
      envelopes,
      unallocatedIncomeMinor: '0',
      unassignedStartingBalanceMinor: '-900000',
    });

    const text = normalize(wrapper.text());
    expect(text).toContain('В конвертах указано больше денег, чем есть на счетах');
    expect(text).toContain('9 000,00 ₽');
    expect(wrapper.get('a').attributes('href')).toBe('/app/envelopes');
  });
});

describe('DashboardWarnings v2', () => {
  type V2Code = 'MANDATORY_GAP' | 'CASH_SHORTFALL' | 'PERIOD_DEFICIT' | 'PERIOD_LEFTOVER';
  const v2Warning = (code: V2Code, actionPath: string, index = 0) => ({
    kind: code.startsWith('PERIOD') ? ('PERIOD' as const) : ('COVERAGE' as const),
    code,
    message: `Серверный текст ${code} ${index}`,
    amountMinor: '1000000',
    envelopeId: null,
    periodId: null,
    balanceMinor: null,
    actionPath,
  });
  const mountV2 = (v2Warnings: ReturnType<typeof v2Warning>[]) =>
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
    const wrapper = mountV2([v2Warning(code, path)]);

    expect(wrapper.text()).toContain(`Серверный текст ${code}`);
    const link = wrapper.get('a');
    expect(link.text()).toBe(label);
    expect(link.attributes('href')).toBe(path);
    expect(wrapper.find('.dashboard-warnings__icon--danger').exists()).toBe(danger);
    expect(wrapper.find('svg').exists()).toBe(true);
  });

  it('keeps rows with identical codes and no ids distinct', () => {
    const wrapper = mountV2([
      v2Warning('MANDATORY_GAP', '/a', 0),
      v2Warning('MANDATORY_GAP', '/b', 1),
    ]);
    expect(wrapper.findAll('li')).toHaveLength(2);
  });

  it('renders nothing for empty v2 warnings', () => {
    expect(mountV2([]).find('section').exists()).toBe(false);
  });

  it('keeps v1 props working without v2Warnings', () => {
    const wrapper = mountWarnings({
      warnings: [{ subject: 'ACCOUNT', id: 'account-id', balanceMinor: '-450000' }],
      accounts,
      envelopes,
      unallocatedIncomeMinor: '0',
      unassignedStartingBalanceMinor: '0',
    });
    expect(wrapper.text()).toContain('Счёт «Основная карта» в минусе');
    expect(wrapper.get('a').text()).toBe('Посмотреть');
  });
});
