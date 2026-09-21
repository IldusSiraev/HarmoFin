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
