import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import ShareBar from './ShareBar.vue';

const global = { stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } };
const items = Array.from({ length: 7 }, (_, index) => ({
  id: `c${index}`,
  label: `Категория ${index}`,
  amountMinor: String((7 - index) * 10_000),
  shareBasisPoints: (7 - index) * 357,
  href: `/app/operations?categoryId=c${index}`,
}));

describe('ShareBar', () => {
  it('выделяет цветом первые highlight сегментов, остальные — нейтральные', () => {
    const wrapper = mount(ShareBar, { props: { items, highlight: 5 }, global });
    const segments = wrapper.findAll('[data-segment]');
    expect(segments).toHaveLength(7);
    expect(segments[0]!.attributes('data-tone')).toBe('1');
    expect(segments[4]!.attributes('data-tone')).toBe('5');
    expect(segments[5]!.attributes('data-tone')).toBe('rest');
    expect(wrapper.get('svg').attributes('aria-hidden')).toBe('true');
  });

  it('показывает название, сумму и долю текстом, строки ведут в журнал', () => {
    const wrapper = mount(ShareBar, { props: { items }, global });
    const first = wrapper.get('[data-share-row]');
    const link = first.get('a');
    expect(link.text()).toContain('Категория 0');
    expect(link.text()).toContain('24%');
    expect(link.text().replace(/\s/g, ' ')).toContain('700,00');
    expect(link.attributes('href')).toBe('/app/operations?categoryId=c0');
  });

  it('строка-ссылка показывает видимую стрелку-афорданс', () => {
    const wrapper = mount(ShareBar, { props: { items }, global });
    const first = wrapper.get('[data-share-row]');
    expect(first.find('svg.share-bar__chevron').exists()).toBe(true);
  });

  it('без href строка не ссылка и без стрелки', () => {
    const wrapper = mount(ShareBar, {
      props: { items: [{ ...items[0]!, href: undefined }] },
      global,
    });
    expect(wrapper.find('a').exists()).toBe(false);
    expect(wrapper.find('svg.share-bar__chevron').exists()).toBe(false);
  });
});
