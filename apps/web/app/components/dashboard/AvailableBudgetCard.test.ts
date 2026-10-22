import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import AvailableBudgetCard from './AvailableBudgetCard.vue';

const normalize = (value: string): string => value.replace(/\p{Zs}/gu, ' ');

const v2Base = {
  planModelVersion: 2 as const,
  period: { start: '2026-09-25', end: '2026-10-09', periodId: 'period-id' },
  cycle: { start: '2026-09-10', end: '2026-10-09' },
  asOf: '2026-10-04',
  horizonEnd: '2026-10-20',
  spendable: { state: 'READY' as const, amountMinor: '5500000' },
  suggestedTarget: null,
  cashMinor: '10000000',
  currentBalanceMinor: '6500000',
  mandatoryBalanceMinor: '0',
  mandatoryDueMinor: '1000000',
  protectedMinor: '0',
  otherProtectedMinor: '0',
  freeToAssignMinor: '0',
  unbackedMinor: '0',
  mandatoryGapMinor: '1000000',
  mandatoryDueCurrentMinor: '800000',
  mandatoryDueNextMinor: '200000',
  mandatoryGapCurrentMinor: '800000',
  mandatoryGapNextMinor: '200000',
  dueMayBeIncomplete: false,
  nearestObligations: [],
  periodStats: {
    spentMinor: '348297',
    availableMinor: '6848297',
    daysLeft: 6,
    averagePerDayMinor: '726396',
  },
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
};

const stubs = { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } };

describe('AvailableBudgetCard', () => {
  it('shows the server amount, its deadline and the embedded month timeline', () => {
    const wrapper = mount(AvailableBudgetCard, { props: { dashboard: v2Base }, global: { stubs } });
    const text = normalize(wrapper.text());

    expect(text).toContain('Можно потратить');
    expect(text).toContain('55 000,00 ₽');
    expect(text).toContain('До 9 октября · доступно в текущем конверте');
    expect(wrapper.findComponent({ name: 'FinancialMonthTimeline' }).props('embedded')).toBe(true);
    // The gap and free money now live in the attention block, the breakdown in the overview.
    expect(text).not.toContain('Не хватает на обязательные');
    expect(wrapper.find('[data-action="toggle-breakdown"]').exists()).toBe(false);
  });

  it('keeps the incomplete-due note', () => {
    const wrapper = mount(AvailableBudgetCard, {
      props: { dashboard: { ...v2Base, dueMayBeIncomplete: true } },
      global: { stubs },
    });
    expect(normalize(wrapper.text())).toContain('Сумма может быть неполной');
  });

  it('explains a zero period balance and points to accounts when there are none', () => {
    const dashboard = {
      ...v2Base,
      spendable: { state: 'READY' as const, amountMinor: '0' },
      currentBalanceMinor: '0',
      cashMinor: '0',
      mandatoryGapMinor: '0',
      onboarding: { ...v2Base.onboarding, hasAccounts: false },
    };
    const wrapper = mount(AvailableBudgetCard, { props: { dashboard }, global: { stubs } });
    const hint = wrapper.get('[data-testid="available-budget-empty-hint"]');

    expect(hint.text()).toContain('Деньги в конверте периода закончились или ещё не распределены');
    expect(hint.text()).toContain('Добавьте счёт и распределите деньги в конверт периода');
    expect(hint.get('a').attributes('href')).toBe('/app/accounts');
  });

  it('asks only to assign money when accounts already exist', () => {
    const dashboard = {
      ...v2Base,
      spendable: { state: 'READY' as const, amountMinor: '0' },
      currentBalanceMinor: '0',
      mandatoryGapMinor: '0',
    };
    const wrapper = mount(AvailableBudgetCard, { props: { dashboard }, global: { stubs } });
    const hint = wrapper.get('[data-testid="available-budget-empty-hint"]');

    expect(hint.text()).toContain('Распределите деньги в конверт периода');
    expect(hint.text()).not.toContain('Добавьте счёт');
  });

  it('does not show the empty hint when the period envelope has money or while setup is open', () => {
    const funded = mount(AvailableBudgetCard, { props: { dashboard: v2Base }, global: { stubs } });
    expect(funded.find('[data-testid="available-budget-empty-hint"]').exists()).toBe(false);

    const setup = mount(AvailableBudgetCard, {
      props: {
        dashboard: {
          ...v2Base,
          spendable: { state: 'NEEDS_PERIOD_SETUP' as const, amountMinor: null },
          currentBalanceMinor: '0',
        },
      },
      global: { stubs },
    });
    expect(setup.find('[data-testid="available-budget-empty-hint"]').exists()).toBe(false);

    const overrun = mount(AvailableBudgetCard, {
      props: {
        dashboard: {
          ...v2Base,
          spendable: { state: 'READY' as const, amountMinor: '0' },
          currentBalanceMinor: '-100',
        },
      },
      global: { stubs },
    });
    expect(overrun.find('[data-testid="available-budget-empty-hint"]').exists()).toBe(false);
  });

  it('invites to set up the period limit instead of showing zero', () => {
    const wrapper = mount(AvailableBudgetCard, {
      props: {
        dashboard: {
          ...v2Base,
          spendable: { state: 'NEEDS_PERIOD_SETUP' as const, amountMinor: null },
          mandatoryGapMinor: '0',
        },
      },
      global: { stubs },
    });
    const text = normalize(wrapper.text());

    expect(text).toContain('Настройте лимит на период');
    expect(text).not.toMatch(/(^|[^\d,])0,00 ₽/);
    expect(wrapper.get('a[href="/app/envelopes"]')).toBeTruthy();
  });

  it('names an overrun in words while the spendable amount stays server zero', () => {
    const wrapper = mount(AvailableBudgetCard, {
      props: {
        dashboard: {
          ...v2Base,
          spendable: { state: 'READY' as const, amountMinor: '0' },
          currentBalanceMinor: '-300000',
          mandatoryGapMinor: '0',
        },
      },
      global: { stubs },
    });
    const text = normalize(wrapper.text());

    expect(text).toContain('Превышение');
    expect(text).toContain('3 000,00 ₽');
    expect(text).toMatch(/(^|[^\d,])0,00 ₽/);
  });

  it('shows the period figures and days left from the server', () => {
    const wrapper = mount(AvailableBudgetCard, { props: { dashboard: v2Base }, global: { stubs } });
    const text = normalize(wrapper.text());

    expect(text).not.toContain('осталось 6 дней');
    expect(text).toContain('Потрачено');
    expect(text).toContain('3 482,97 ₽');
    expect(text).toContain('Было доступно');
    expect(text).toContain('68 482,97 ₽');
    expect(text).toContain('В среднем в день');
    expect(text).toContain('7 263,96 ₽');
  });

  it('hides the period figures until the period is set up', () => {
    const setup = mount(AvailableBudgetCard, {
      props: {
        dashboard: {
          ...v2Base,
          spendable: { state: 'NEEDS_PERIOD_SETUP' as const, amountMinor: null },
          periodStats: null,
        },
      },
      global: { stubs },
    });
    expect(setup.find('[data-testid="available-budget-stats"]').exists()).toBe(false);
  });

  it('shows a read-only free-money line when showFreeMoney is on and money is free', () => {
    const wrapper = mount(AvailableBudgetCard, {
      props: { dashboard: { ...v2Base, freeToAssignMinor: '1750000' }, showFreeMoney: true },
      global: { stubs },
    });
    const row = wrapper.get('[data-testid="available-budget-free-row"]');

    expect(row.text()).toContain('Не распределено');
    expect(normalize(row.text())).toContain('17 500,00 ₽');
    expect(row.find('button').exists()).toBe(false);
  });

  it('hides the free-money line by default even when money is free', () => {
    const wrapper = mount(AvailableBudgetCard, {
      props: { dashboard: { ...v2Base, freeToAssignMinor: '1750000' } },
      global: { stubs },
    });
    expect(wrapper.find('[data-testid="available-budget-free-row"]').exists()).toBe(false);
  });

  it('hides the free-money line when showFreeMoney is on but nothing is free', () => {
    const wrapper = mount(AvailableBudgetCard, {
      props: { dashboard: { ...v2Base, freeToAssignMinor: '0' }, showFreeMoney: true },
      global: { stubs },
    });
    expect(wrapper.find('[data-testid="available-budget-free-row"]').exists()).toBe(false);
  });
});
