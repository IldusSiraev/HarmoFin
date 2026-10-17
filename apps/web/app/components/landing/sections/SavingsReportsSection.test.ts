import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import SavingsReportsSection from './SavingsReportsSection.vue';

const global = { stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } };

describe('SavingsReportsSection', () => {
  it('показывает четыре инертные витрины аналитики с подписями', () => {
    const wrapper = mount(SavingsReportsSection, { global });

    expect(wrapper.get('section').attributes('id')).toBe('reports');
    const showcases = wrapper.findAll('.landing-showcase');
    expect(showcases).toHaveLength(4);
    for (const showcase of showcases) {
      expect(showcase.get('.landing-showcase__frame').attributes()).toHaveProperty('inert');
      expect(showcase.get('.landing-showcase__caption').text()).not.toBe('');
    }
  });

  it('рисует расходы по категориям, лимиты, циклы и цели без ссылок в журнал', () => {
    const wrapper = mount(SavingsReportsSection, { global });
    const [shares, limits, cycles, goals] = wrapper.findAll('.landing-showcase__frame');

    expect(shares!.findAll('[data-share-row]')).toHaveLength(6);
    expect(shares!.text()).toContain('Продукты');

    expect(limits!.findAll('.limit-bar')).toHaveLength(3);
    expect(limits!.text()).toContain('25.09–09.10 · текущий период');
    expect(limits!.findAll('[data-overspent]')).toHaveLength(1);

    expect(cycles!.findAll('.column-chart__column')).toHaveLength(3);
    expect(cycles!.text()).toContain('Доходы');
    expect(cycles!.text()).toContain('Расходы');

    expect(goals!.text()).toContain('Ремонт');
    expect(goals!.text()).toContain('Отпуск');

    expect(wrapper.findAll('a')).toHaveLength(0);
  });

  it('не показывает витрину «План и факт», но перечисляет отчёт в списке', () => {
    const wrapper = mount(SavingsReportsSection, { global });

    expect(wrapper.find('.plan-vs-actual').exists()).toBe(false);
    expect(wrapper.get('[aria-label="Отчёты в HarmoFin"]').text()).toContain('План и факт');
  });
});
