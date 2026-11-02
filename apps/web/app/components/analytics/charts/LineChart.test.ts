import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import LineChart from './LineChart.vue';

const series = [
  { id: 'income', label: 'Доходы', tone: 'income' as const },
  { id: 'expense', label: 'Расходы', tone: 'expense' as const },
];
const points = [
  {
    id: 'march',
    label: '01.03–31.03',
    values: [
      { seriesId: 'income', amountMinor: '200000' },
      { seriesId: 'expense', amountMinor: '50000' },
    ],
    caption: '+1 500,00 ₽',
  },
  {
    id: 'april',
    label: '01.04–30.04',
    values: [
      { seriesId: 'income', amountMinor: '100000' },
      { seriesId: 'expense', amountMinor: '0' },
    ],
  },
];
const flat = (text: string) => text.replace(/\s/g, ' ');
const stubs = { stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } };

describe('LineChart', () => {
  it('по линии на серию, точка на каждую запись, общая шкала', () => {
    const wrapper = mount(LineChart, { props: { points, series, label: 'По циклам' } });
    expect(wrapper.findAll('.line-chart__line')).toHaveLength(2);
    expect(wrapper.findAll('[data-dot]')).toHaveLength(4);
    // largest value (2000) sits on top, zero on the bottom
    const cy = wrapper.findAll('[data-dot]').map((dot) => Number(dot.attributes('cy')));
    expect(cy[0]).toBe(30);
    expect(cy[3]).toBe(220);
  });

  it('значения, подписи серий и шкала доступны текстом', () => {
    const wrapper = mount(LineChart, { props: { points, series, label: 'По циклам' } });
    const text = flat(wrapper.text());
    expect(text).toContain('Доходы');
    expect(text).toContain('Расходы');
    expect(text).toContain('01.03–31.03');
    expect(text).toContain('+1 500,00 ₽');
    expect(text).toContain('2 000,00');
    expect(wrapper.find('svg[aria-hidden="true"]').exists()).toBe(true);
  });

  it('подпись точки — ссылка в журнал только если задан href', () => {
    expect(
      mount(LineChart, { props: { points, series, label: 'x' } })
        .find('a')
        .exists(),
    ).toBe(false);
    const linked = mount(LineChart, {
      props: {
        points: [{ ...points[0]!, href: '/app/operations?from=2026-03-01&to=2026-03-31' }],
        series,
        label: 'x',
      },
      global: stubs,
    });
    expect(linked.get('a').attributes('aria-label')).toBe('Операции за 01.03–31.03');
  });

  it('одна точка — только маркер, все нули не делят на ноль', () => {
    const wrapper = mount(LineChart, {
      props: {
        points: [{ id: 'z', label: 'Z', values: [{ seriesId: 'income', amountMinor: '0' }] }],
        series: [series[0]!],
        label: 'Пусто',
      },
    });
    expect(wrapper.find('.line-chart__line').exists()).toBe(false);
    expect(wrapper.get('[data-dot]').attributes('cy')).toBe('220');
  });
});

describe('LineChart labels', () => {
  it('подписи оси Y (максимум, середина, ноль), оси X и значения у точек', () => {
    const wrapper = mount(LineChart, { props: { points, series, label: 'По циклам' } });
    expect(wrapper.findAll('[data-axis-y]').map((node) => flat(node.text()))).toEqual([
      '2 000,00 ₽',
      '1 000,00 ₽',
      '0,00 ₽',
    ]);
    expect(wrapper.findAll('[data-axis-x]').map((node) => node.text())).toEqual([
      '01.03–31.03',
      '01.04–30.04',
    ]);
    expect(wrapper.findAll('[data-dot-label]')).toHaveLength(4);
  });

  it('на длинном ряду подписи точек скрыты, значения остаются в списке', () => {
    const many = Array.from({ length: 9 }, (_, index) => ({
      id: `p${index}`,
      label: `П${index}`,
      values: [{ seriesId: 'expense', amountMinor: '1000' }],
    }));
    const wrapper = mount(LineChart, { props: { points: many, series, label: 'x' } });
    expect(wrapper.findAll('[data-dot-label]')).toHaveLength(0);
    expect(wrapper.findAll('[data-axis-x]')).toHaveLength(5);
    expect(wrapper.findAll('.line-chart__point')).toHaveLength(9);
  });
});
