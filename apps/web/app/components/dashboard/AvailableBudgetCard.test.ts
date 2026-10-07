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
  },
};

const stubs = { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } };

describe('AvailableBudgetCard', () => {
  it('shows the server spendable amount with period balance and mandatory gap', () => {
    const wrapper = mount(AvailableBudgetCard, { props: { dashboard: v2Base }, global: { stubs } });
    const text = normalize(wrapper.text());

    expect(text).toContain('Можно потратить');
    expect(text).toContain('55 000,00 ₽');
    expect(text).toContain('В конверте периода 65 000,00 ₽');
    expect(text).toContain('Не хватает на обязательные');
    expect(text).toContain('10 000,00 ₽');
    expect(text).not.toContain('до 20 октября');
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

    expect(hint.text()).toContain('Деньги в конверте периода закончились или ещё не назначены');
    expect(hint.text()).toContain('Добавьте счёт и назначьте деньги конверту периода');
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

    expect(hint.text()).toContain('Назначьте деньги конверту периода');
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

  it('offers to assign free money as an action and shows the server amount', async () => {
    const dashboard = { ...v2Base, freeToAssignMinor: '5215531' };
    const wrapper = mount(AvailableBudgetCard, { props: { dashboard }, global: { stubs } });
    const row = wrapper.get('[data-testid="available-budget-free-row"]');

    expect(normalize(row.text())).toContain('Свободно для назначения');
    expect(normalize(row.text())).toContain('52 155,31 ₽');
    await row.get('[data-action="assign-free-money"]').trigger('click');

    expect(wrapper.emitted('assign')).toHaveLength(1);
  });

  it('hides the free money action when nothing is free to assign', () => {
    const wrapper = mount(AvailableBudgetCard, { props: { dashboard: v2Base }, global: { stubs } });

    expect(wrapper.find('[data-testid="available-budget-free-row"]').exists()).toBe(false);
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

    expect(text).toContain('Настройте лимит периода');
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

  it('marks due obligations as possibly incomplete and reveals breakdown on request', async () => {
    const wrapper = mount(AvailableBudgetCard, {
      props: { dashboard: { ...v2Base, dueMayBeIncomplete: true } },
      global: { stubs },
    });
    expect(normalize(wrapper.text())).toContain('К оплате может быть неполным');
    expect(wrapper.text()).not.toContain('Защищено обязательствами и накоплениями');

    await wrapper.get('[data-action="toggle-breakdown"]').trigger('click');
    const text = normalize(wrapper.text());
    expect(text).toContain('Защищено обязательствами и накоплениями');
    expect(text).toContain('На счетах');
    expect(text).toContain('100 000,00 ₽');
  });
});

describe('AvailableBudgetCard breakdown markup', () => {
  it('omits aria-controls while closed and keeps dl children valid when open', async () => {
    const wrapper = mount(AvailableBudgetCard, { props: { dashboard: v2Base }, global: { stubs } });
    const toggle = wrapper.get('[data-action="toggle-breakdown"]');
    expect(toggle.attributes('aria-controls')).toBeUndefined();

    await toggle.trigger('click');
    const target = toggle.attributes('aria-controls');
    expect(target).toBeTruthy();
    expect(wrapper.find(`#${target}`).exists()).toBe(true);
    for (const dl of wrapper.findAll('dl')) {
      for (const child of Array.from(dl.element.children)) {
        expect(['DIV', 'DT', 'DD']).toContain(child.tagName);
        if (child.tagName === 'DIV') {
          expect(child.querySelector('dt')).not.toBeNull();
        }
      }
    }
  });

  it('keeps the horizon date in the breakdown, not as a separate link line', async () => {
    const wrapper = mount(AvailableBudgetCard, { props: { dashboard: v2Base }, global: { stubs } });
    expect(wrapper.text()).not.toContain('Предстоящие обязательства');
    expect(wrapper.find('a[href="/app/plans"]').exists()).toBe(false);

    await wrapper.get('[data-action="toggle-breakdown"]').trigger('click');
    expect(normalize(wrapper.text())).toContain('К оплате по обязательствам до 20 октября');
  });

  it('shows the period figures and days left from the server', () => {
    const wrapper = mount(AvailableBudgetCard, { props: { dashboard: v2Base }, global: { stubs } });
    const text = normalize(wrapper.text());

    expect(text).toContain('до 9 октября · осталось 6 дней');
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
});
