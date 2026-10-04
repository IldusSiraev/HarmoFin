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
      attachTo: document.body,
    });

    await wrapper.get('.ui-tooltip').trigger('focusin');
    expect(wrapper.find('[role="tooltip"]').exists()).toBe(true);
    await wrapper.get('.ui-tooltip').trigger('keydown', { key: 'Escape' });
    expect(wrapper.find('[role="tooltip"]').exists()).toBe(false);
    wrapper.unmount();
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

describe('UiTooltip pinnable', () => {
  it('opens on click only when pinnable and keeps Escape from reaching a modal', async () => {
    const plain = mount(UiTooltip, {
      props: { text: 'Подсказка' },
      slots: { default: '<button type="button">i</button>' },
    });
    await plain.get('.ui-tooltip').trigger('click');
    expect(plain.find('[role="tooltip"]').exists()).toBe(false);

    const pinned = mount(UiTooltip, {
      props: { text: 'Подсказка', pinnable: true },
      slots: { default: '<button type="button">i</button>' },
      attachTo: document.body,
    });
    await pinned.get('.ui-tooltip').trigger('click');
    expect(pinned.find('[role="tooltip"]').exists()).toBe(true);

    const escape = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    pinned.get('.ui-tooltip').element.dispatchEvent(escape);
    await pinned.vm.$nextTick();
    expect(escape.defaultPrevented).toBe(true);
    expect(pinned.find('[role="tooltip"]').exists()).toBe(false);
    pinned.unmount();
  });
});

describe('UiTooltip hover Escape', () => {
  it('closes a hover-opened bubble on Escape while focus is elsewhere', async () => {
    const outside = document.createElement('input');
    document.body.append(outside);
    outside.focus();
    const wrapper = mount(UiTooltip, {
      props: { text: 'Подсказка' },
      slots: { default: '<button type="button">i</button>' },
      attachTo: document.body,
    });
    await wrapper.get('.ui-tooltip').trigger('mouseenter');
    expect(wrapper.find('[role="tooltip"]').exists()).toBe(true);

    const escape = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    outside.dispatchEvent(escape);
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[role="tooltip"]').exists()).toBe(false);
    expect(escape.defaultPrevented).toBe(true);
    wrapper.unmount();
    outside.remove();
  });
});
