import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import EnvelopesSummary from './EnvelopesSummary.vue';

function dashboard(overrides: Record<string, unknown> = {}) {
  return {
    period: { start: '2026-10-10', end: '2026-10-24', periodId: 'p1' },
    spendable: { state: 'READY', amountMinor: '3335000' },
    cashMinor: '30748531',
    mandatoryBalanceMinor: '5163531',
    otherProtectedMinor: '21050000',
    freeToAssignMinor: '1200000',
    mandatoryGapMinor: '1036469',
    unbackedMinor: '0',
    warnings: [
      {
        kind: 'COVERAGE',
        code: 'MANDATORY_GAP',
        message: 'Два платежа до 20 октября',
        amountMinor: '1036469',
        envelopeId: null,
        periodId: null,
        balanceMinor: null,
        level: 'ALERT',
        actionPath: '/app/envelopes?cover=mandatory',
      },
    ],
    ...overrides,
  };
}

const stubs = { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } };

describe('EnvelopesSummary', () => {
  it('показывает серверные значения без вычислений', () => {
    const wrapper = mount(EnvelopesSummary, {
      props: { dashboard: dashboard() as never },
      global: { stubs },
    });
    const text = wrapper.text();
    expect(text).toContain('Можно потратить');
    expect(text).toMatch(/33\s350,00/);
    expect(text).toContain('до 24 октября');
    expect(text).toMatch(/51\s635,31/);
    expect(text).toMatch(/210\s500,00/);
    expect(text).toMatch(/307\s485,31/);
  });

  it('строки внимания: «Не распределено» эмитит distribute, «Не хватает» эмитит cover-mandatory', async () => {
    const wrapper = mount(EnvelopesSummary, {
      props: { dashboard: dashboard() as never },
      global: { stubs },
    });
    const free = wrapper.find('[data-testid="summary-free"]');
    expect(free.classes()).toContain('ui-attention-row--info');
    expect(free.text()).toMatch(/Не распределено · 12\s000,00/);
    await free.find('button').trigger('click');
    expect(wrapper.emitted('distribute')).toHaveLength(1);
    const gap = wrapper.find('[data-testid="summary-gap"]');
    expect(gap.classes()).toContain('ui-attention-row--warning');
    expect(gap.text()).toMatch(/Не хватает на обязательные · 10\s364,69/);
    expect(gap.text()).toContain('Два платежа до 20 октября');
    await gap.find('button').trigger('click');
    expect(wrapper.emitted('cover-mandatory')).toHaveLength(1);
  });

  it('MANDATORY_GAP с level INFO — тон info', () => {
    const base = dashboard();
    const wrapper = mount(EnvelopesSummary, {
      props: {
        dashboard: dashboard({
          warnings: [{ ...base.warnings[0], level: 'INFO' }],
        }) as never,
      },
      global: { stubs },
    });
    const gap = wrapper.find('[data-testid="summary-gap"]');
    expect(gap.classes()).toContain('ui-attention-row--info');
    expect(gap.find('button').text()).toContain('Покрыть');
  });

  it('нулевые суммы скрывают строки, NEEDS_PERIOD_SETUP показывает настройку', () => {
    const wrapper = mount(EnvelopesSummary, {
      props: {
        dashboard: dashboard({
          freeToAssignMinor: '0',
          mandatoryGapMinor: '0',
          warnings: [],
          spendable: { state: 'NEEDS_PERIOD_SETUP', amountMinor: null },
        }) as never,
      },
      global: { stubs },
    });
    expect(wrapper.find('[data-testid="summary-free"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="summary-gap"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('Лимит на период не настроен');
    expect(wrapper.find('[data-testid="summary-setup"]').attributes('href')).toBe('/app');
    expect(wrapper.text()).toContain('Всё распределено');
  });

  it('CASH_SHORTFALL — красная строка, «Разобраться» эмитит shortfall', async () => {
    const wrapper = mount(EnvelopesSummary, {
      props: {
        dashboard: dashboard({
          unbackedMinor: '500000',
          warnings: [
            {
              kind: 'COVERAGE',
              code: 'CASH_SHORTFALL',
              message: 'Денег на счетах меньше, чем отложено',
              amountMinor: '500000',
              envelopeId: null,
              periodId: null,
              balanceMinor: null,
              actionPath: '/app/envelopes',
            },
          ],
        }) as never,
      },
      global: { stubs },
    });
    const shortfall = wrapper.find('[data-testid="summary-shortfall"]');
    expect(shortfall.classes()).toContain('ui-attention-row--danger');
    expect(shortfall.text()).toMatch(/Не хватает денег на счетах · 5\s000,00/);
    await shortfall.find('button').trigger('click');
    expect(wrapper.emitted('shortfall')).toHaveLength(1);
  });

  it('hides the "Распределить" action when the viewer cannot manage assignments', () => {
    const wrapper = mount(EnvelopesSummary, {
      props: { dashboard: dashboard() as never, canAllocate: false },
      global: { stubs },
    });
    const free = wrapper.find('[data-testid="summary-free"]');
    expect(free.find('button').exists()).toBe(false);
    expect(wrapper.find('[data-testid="summary-gap"] button').exists()).toBe(false);
  });
});
