import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import UiAttentionRow from './AttentionRow.vue';

describe('UiAttentionRow', () => {
  it('показывает тон, заголовок, описание и кнопку действия', async () => {
    const wrapper = mount(UiAttentionRow, {
      props: {
        tone: 'warning',
        title: 'Не хватает · 10 ₽',
        description: 'Два платежа',
        actionLabel: 'Покрыть',
      },
    });
    expect(wrapper.classes()).toContain('ui-attention-row--warning');
    expect(wrapper.text()).toContain('Не хватает · 10 ₽');
    expect(wrapper.text()).toContain('Два платежа');
    await wrapper.find('button').trigger('click');
    expect(wrapper.emitted('action')).toHaveLength(1);
  });

  it('со ссылкой рендерит NuxtLink', () => {
    const wrapper = mount(UiAttentionRow, {
      props: {
        tone: 'info',
        title: 'Не распределено',
        actionLabel: 'Распределить',
        actionTo: '/app',
      },
      global: { stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } },
    });
    expect(wrapper.find('a').attributes('href')).toBe('/app');
  });

  it('без действия кнопки нет', () => {
    const wrapper = mount(UiAttentionRow, { props: { tone: 'danger', title: 'Перерасход' } });
    expect(wrapper.find('button').exists()).toBe(false);
  });
});
