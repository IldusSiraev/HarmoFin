import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';

import AppAddMenu from './AppAddMenu.vue';
import { useOperationDialogs } from '../../composables/useOperationDialogs.js';

beforeEach(() => {
  useOperationDialogs().close();
});

describe('AppAddMenu', () => {
  it('keeps the menu closed until the trigger is used', () => {
    const wrapper = mount(AppAddMenu);
    const trigger = wrapper.get('[data-testid="add-menu-trigger"]');

    expect(trigger.attributes('aria-expanded')).toBe('false');
    expect(trigger.attributes('aria-controls')).toBe('app-add-menu');
    expect(wrapper.find('#app-add-menu').exists()).toBe(false);
  });

  it('opens the operation dialog from the expense item', async () => {
    const wrapper = mount(AppAddMenu);
    await wrapper.get('[data-testid="add-menu-trigger"]').trigger('click');

    await wrapper.get('[data-testid="add-menu-expense"]').trigger('click');

    expect(useOperationDialogs().openDialog.value).toBe('operation');
    expect(wrapper.find('#app-add-menu').exists()).toBe(false);
  });

  it('opens the transfer dialog from the transfer item', async () => {
    const wrapper = mount(AppAddMenu);
    await wrapper.get('[data-testid="add-menu-trigger"]').trigger('click');

    await wrapper.get('[data-testid="add-menu-transfer"]').trigger('click');

    expect(useOperationDialogs().openDialog.value).toBe('transfer');
  });

  it('closes on Escape', async () => {
    const wrapper = mount(AppAddMenu, { attachTo: document.body });
    await wrapper.get('[data-testid="add-menu-trigger"]').trigger('click');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await wrapper.vm.$nextTick();

    expect(wrapper.get('[data-testid="add-menu-trigger"]').attributes('aria-expanded')).toBe(
      'false',
    );
    wrapper.unmount();
  });

  it('closes when a click lands outside the menu', async () => {
    const wrapper = mount(AppAddMenu, { attachTo: document.body });
    await wrapper.get('[data-testid="add-menu-trigger"]').trigger('click');
    expect(wrapper.find('#app-add-menu').exists()).toBe(true);

    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await wrapper.vm.$nextTick();

    expect(wrapper.find('#app-add-menu').exists()).toBe(false);
    wrapper.unmount();
  });
});
