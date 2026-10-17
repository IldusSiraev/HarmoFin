import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import UiTabs from './Tabs.vue';

const tabs = [
  { id: 'a', label: 'Обзор' },
  { id: 'b', label: 'Расходы' },
  { id: 'c', label: 'Конверты' },
];

describe('UiTabs', () => {
  it('отмечает активную вкладку и связывает её с панелью', () => {
    const wrapper = mount(UiTabs, {
      props: { tabs, modelValue: 'b', label: 'Разделы' },
      slots: { default: '<p>панель</p>' },
    });
    const selected = wrapper.get('[role="tab"][aria-selected="true"]');
    expect(selected.text()).toBe('Расходы');
    expect(selected.attributes('tabindex')).toBe('0');
    const panel = wrapper.get('[role="tabpanel"]');
    expect(panel.attributes('aria-labelledby')).toBe(selected.attributes('id'));
    expect(selected.attributes('aria-controls')).toBe(panel.attributes('id'));
    expect(wrapper.findAll('[role="tab"][tabindex="-1"]')).toHaveLength(2);
  });

  it('стрелки, Home и End переключают вкладки по кругу', async () => {
    const wrapper = mount(UiTabs, {
      props: { tabs, modelValue: 'a', label: 'Разделы' },
      attachTo: document.body,
    });
    const list = wrapper.get('[role="tablist"]');
    await list.trigger('keydown', { key: 'ArrowLeft' });
    await list.trigger('keydown', { key: 'ArrowRight' });
    await list.trigger('keydown', { key: 'End' });
    await list.trigger('keydown', { key: 'Home' });
    expect(wrapper.emitted('update:modelValue')).toEqual([['c'], ['b'], ['c'], ['a']]);
    wrapper.unmount();
  });

  it('клик выбирает вкладку', async () => {
    const wrapper = mount(UiTabs, { props: { tabs, modelValue: 'a', label: 'Разделы' } });
    await wrapper.findAll('[role="tab"]')[2]!.trigger('click');
    expect(wrapper.emitted('update:modelValue')).toEqual([['c']]);
  });
});
