import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import FilterPanel from './FilterPanel.vue';

describe('FilterPanel', () => {
  it('shows the quick slot always and the default slot only while open', async () => {
    const wrapper = mount(FilterPanel, {
      slots: {
        quick: '<input data-quick />',
        default: '<input data-advanced />',
      },
    });

    expect(wrapper.find('[data-quick]').exists()).toBe(true);
    expect(wrapper.find('[data-advanced]').exists()).toBe(false);

    await wrapper.get('button').trigger('click');
    expect(wrapper.find('[data-advanced]').exists()).toBe(true);
  });

  it('shows a badge with the active filter count', () => {
    const wrapper = mount(FilterPanel, { props: { activeCount: 3 } });
    expect(wrapper.get('.filter-panel__badge').text()).toBe('3');
  });

  it('hides the badge when there are no active filters', () => {
    const wrapper = mount(FilterPanel, { props: { activeCount: 0 } });
    expect(wrapper.find('.filter-panel__badge').exists()).toBe(false);
  });

  it('closes on backdrop click and on Escape', async () => {
    const wrapper = mount(FilterPanel, { slots: { default: '<input data-advanced />' } });
    await wrapper.get('button').trigger('click');
    expect(wrapper.find('[data-advanced]').exists()).toBe(true);

    await wrapper.get('.filter-panel__backdrop').trigger('click');
    expect(wrapper.find('[data-advanced]').exists()).toBe(false);

    await wrapper.get('button').trigger('click');
    await wrapper.get('.filter-panel__trigger').trigger('keydown', { key: 'Escape' });
    expect(wrapper.find('[data-advanced]').exists()).toBe(false);
  });
});
