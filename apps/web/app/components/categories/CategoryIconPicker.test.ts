import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import CategoryIconPicker from './CategoryIconPicker.vue';

describe('CategoryIconPicker', () => {
  it('marks the selected icon as pressed', () => {
    const wrapper = mount(CategoryIconPicker, { props: { modelValue: 'shopping-cart' } });
    const selected = wrapper.get('button[aria-pressed="true"]');
    expect(selected.attributes('aria-label')).toContain('Тележка покупок');
    expect(wrapper.findAll('button[aria-pressed="false"]').length).toBeGreaterThan(0);
  });

  it('emits the clicked icon key', async () => {
    const wrapper = mount(CategoryIconPicker, { props: { modelValue: null } });
    const buttons = wrapper.findAll('button');
    const target = buttons.find((button) => button.attributes('aria-label')?.includes('Кошелёк'));
    await target!.trigger('click');
    expect(wrapper.emitted('update:modelValue')).toEqual([['wallet']]);
  });

  it('clicking the already-selected icon clears it', async () => {
    const wrapper = mount(CategoryIconPicker, { props: { modelValue: 'wallet' } });
    const selected = wrapper.get('button[aria-pressed="true"]');
    await selected.trigger('click');
    expect(wrapper.emitted('update:modelValue')).toEqual([[null]]);
  });
});
