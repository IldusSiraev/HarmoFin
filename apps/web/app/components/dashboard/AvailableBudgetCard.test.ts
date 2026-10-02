import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import AvailableBudgetCard from './AvailableBudgetCard.vue';

const period = { id: 'SECOND' as const, start: '2026-09-25', end: '2026-10-09' };

const available = {
  state: 'available' as const,
  envelopeId: 'envelope-id',
  limitMinor: '6300000',
  spentMinor: '4120000',
  remainingMinor: '2180000',
  daysUntilBoundary: 7,
  averageRemainingDailyLimitMinor: '311400',
};

const normalize = (value: string): string => value.replace(/[\u00a0\u202f]/g, ' ');

describe('AvailableBudgetCard', () => {
  it('leads with the amount the user can still spend', () => {
    const wrapper = mount(AvailableBudgetCard, { props: { periodLimit: available, period } });
    const text = normalize(wrapper.text());

    expect(text).toContain('Можно потратить');
    expect(text).toContain('21 800,00 ₽');
    expect(text).toContain('до 9 октября');
    expect(text).toContain('осталось 7 дней');
    expect(text).toContain('Было доступно');
    expect(text).toContain('63 000,00 ₽');
    expect(text).toContain('В среднем в день');
    expect(text).toContain('3 114,00 ₽');
  });

  it('exposes spending progress to assistive technology', () => {
    const wrapper = mount(AvailableBudgetCard, { props: { periodLimit: available, period } });
    const bar = wrapper.get('[role="progressbar"]');

    expect(bar.attributes('aria-valuenow')).toBe('65');
    expect(bar.attributes('aria-valuemin')).toBe('0');
    expect(bar.attributes('aria-valuemax')).toBe('100');
    expect(normalize(bar.attributes('aria-label') ?? '')).toBe(
      'Потрачено 41 200,00 ₽ из лимита 63 000,00 ₽',
    );
  });

  it('names its state in words, not only in colour', () => {
    const warning = mount(AvailableBudgetCard, {
      props: {
        periodLimit: { ...available, spentMinor: '5100000', remainingMinor: '1200000' },
        period,
      },
    });
    expect(normalize(warning.text())).toContain('Лимит периода почти исчерпан');

    const critical = mount(AvailableBudgetCard, {
      props: {
        periodLimit: { ...available, spentMinor: '6100000', remainingMinor: '200000' },
        period,
      },
    });
    expect(normalize(critical.text())).toContain('Остатка хватит меньше чем на день');

    const negative = mount(AvailableBudgetCard, {
      props: {
        periodLimit: { ...available, spentMinor: '6500000', remainingMinor: '-200000' },
        period,
      },
    });
    expect(normalize(negative.text())).toContain('Лимит периода превышен');
  });

  it('explains an unconfigured period instead of showing a fake zero', () => {
    const wrapper = mount(AvailableBudgetCard, {
      props: { periodLimit: { state: 'unavailable' }, period },
    });

    expect(wrapper.text()).toContain('Конверт текущего периода не настроен');
    expect(wrapper.find('[role="progressbar"]').exists()).toBe(false);
  });
});

const v2Base = {
  planModelVersion: 2 as const,
  period: { start: '2026-09-25', end: '2026-10-09', periodId: 'period-id' },
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
  dueMayBeIncomplete: false,
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

describe('AvailableBudgetCard v2', () => {
  it('shows the server spendable amount with period balance and mandatory gap', () => {
    const wrapper = mount(AvailableBudgetCard, { props: { dashboard: v2Base }, global: { stubs } });
    const text = normalize(wrapper.text());

    expect(text).toContain('Можно потратить');
    expect(text).toContain('55 000,00 ₽');
    expect(text).toContain('В конверте периода 65 000,00 ₽');
    expect(text).toContain('Не хватает на обязательные');
    expect(text).toContain('10 000,00 ₽');
    expect(text).toContain('до 20 октября');
    expect(wrapper.get('a[href="/app/plans"]')).toBeTruthy();
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

describe('AvailableBudgetCard v2 breakdown markup', () => {
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
});
