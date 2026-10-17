import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import ColumnChart from './ColumnChart.vue';

const series = [
  { id: 'income', label: 'Доходы', tone: 2 as const },
  { id: 'expense', label: 'Расходы', tone: 1 as const },
];
const columns = [
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

const globalStubs = {
  stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } },
};

describe('ColumnChart', () => {
  it('общая шкала: самый большой столбец 100%', () => {
    const wrapper = mount(ColumnChart, { props: { columns, series, label: 'По циклам' } });
    const bars = wrapper.findAll('[data-bar]');
    expect(bars.map((bar) => bar.attributes('data-percent'))).toEqual(['100', '25', '50', '0']);
  });

  it('легенда, подписи колонок и значения текстом', () => {
    const wrapper = mount(ColumnChart, { props: { columns, series, label: 'По циклам' } });
    const text = wrapper.text().replace(/\s/g, ' ');
    expect(text).toContain('Доходы');
    expect(text).toContain('Расходы');
    expect(text).toContain('01.03–31.03');
    expect(text).toContain('+1 500,00 ₽');
    expect(text).toContain('2 000,00');
    expect(wrapper.find('svg[aria-hidden="true"]').exists()).toBe(true);
  });

  it('подпись серии видна рядом со значением, не только для screen reader', () => {
    const wrapper = mount(ColumnChart, { props: { columns, series, label: 'По циклам' } });
    const flat = (text: string) => text.replace(/\s/g, ' ');
    const values = wrapper.findAll('.column-chart__value');
    expect(flat(values[0]!.text())).toContain('Доходы');
    expect(flat(values[0]!.text())).toContain('2 000,00');
    expect(flat(values[1]!.text())).toContain('Расходы');
    expect(flat(values[1]!.text())).toContain('500,00');
    expect(wrapper.find('.visually-hidden').exists()).toBe(false);
  });

  it('подпись колонки — ссылка в журнал только если задан href', () => {
    const withoutHref = mount(ColumnChart, { props: { columns, series, label: 'По циклам' } });
    expect(withoutHref.find('a').exists()).toBe(false);

    const withHref = mount(ColumnChart, {
      props: {
        columns: [{ ...columns[0]!, href: '/app/operations?from=2026-03-01&to=2026-03-31' }],
        series,
        label: 'По циклам',
      },
      global: globalStubs,
    });
    const link = withHref.get('a');
    expect(link.attributes('href')).toBe('/app/operations?from=2026-03-01&to=2026-03-31');
    expect(link.attributes('aria-label')).toBe('Операции за 01.03–31.03');
  });

  it('все нули не делят на ноль', () => {
    const wrapper = mount(ColumnChart, {
      props: {
        columns: [{ id: 'z', label: 'Z', values: [{ seriesId: 'income', amountMinor: '0' }] }],
        series: [series[0]!],
        label: 'Пусто',
      },
    });
    expect(wrapper.get('[data-bar]').attributes('data-percent')).toBe('0');
  });
});
