import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import UiTooltip from './Tooltip.vue';

describe('UiTooltip', () => {
  it('renders the trigger with no wrapper when no text is given', () => {
    const wrapper = mount(UiTooltip, {
      slots: { default: '<button type="button">i</button>' },
    });

    expect(wrapper.find('.ui-tooltip').exists()).toBe(false);
    expect(wrapper.get('button').text()).toBe('i');
  });

  it('shows the bubble on focus and hides it on blur', async () => {
    const wrapper = mount(UiTooltip, {
      props: { text: 'Подсказка про поле' },
      slots: { default: '<button type="button">i</button>' },
    });

    expect(wrapper.find('[role="tooltip"]').exists()).toBe(false);
    await wrapper.get('.ui-tooltip').trigger('focusin');
    expect(wrapper.get('[role="tooltip"]').text()).toBe('Подсказка про поле');
    await wrapper.get('.ui-tooltip').trigger('focusout');
    expect(wrapper.find('[role="tooltip"]').exists()).toBe(false);
  });

  it('closes on Escape', async () => {
    const wrapper = mount(UiTooltip, {
      props: { text: 'Подсказка' },
      slots: { default: '<button type="button">i</button>' },
    });

    await wrapper.get('.ui-tooltip').trigger('focusin');
    expect(wrapper.find('[role="tooltip"]').exists()).toBe(true);
    await wrapper.get('.ui-tooltip').trigger('keydown', { key: 'Escape' });
    expect(wrapper.find('[role="tooltip"]').exists()).toBe(false);
  });

  it('connects the trigger to the bubble via aria-describedby', async () => {
    const wrapper = mount(UiTooltip, {
      props: { text: 'Подсказка' },
      slots: {
        default: `<template #default="{ describedby }">
          <button type="button" :aria-describedby="describedby">i</button>
        </template>`,
      },
    });

    await wrapper.get('.ui-tooltip').trigger('focusin');
    expect(wrapper.get('button').attributes('aria-describedby')).toBe(
      wrapper.get('[role="tooltip"]').attributes('id'),
    );
  });
});
