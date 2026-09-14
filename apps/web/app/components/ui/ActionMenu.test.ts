import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import UiActionMenu from './ActionMenu.vue';

const mountMenu = () =>
  mount(UiActionMenu, {
    props: { label: 'Действия над операцией' },
    slots: {
      default:
        '<button type="button" role="menuitem" data-testid="item-confirm">Подтвердить</button>' +
        '<button type="button" role="menuitem" data-testid="item-delete">Удалить</button>',
    },
    attachTo: document.body,
  });

describe('UiActionMenu', () => {
  it('keeps the list closed until the trigger is used', () => {
    const wrapper = mountMenu();
    const trigger = wrapper.get('[data-testid="action-menu-trigger"]');

    expect(trigger.attributes('aria-label')).toBe('Действия над операцией');
    expect(trigger.attributes('aria-expanded')).toBe('false');
    expect(trigger.attributes('aria-haspopup')).toBe('menu');
    expect(wrapper.find('[data-testid="action-menu-list"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('opens the list as a menu', async () => {
    const wrapper = mountMenu();

    await wrapper.get('[data-testid="action-menu-trigger"]').trigger('click');

    expect(wrapper.get('[data-testid="action-menu-list"]').attributes('role')).toBe('menu');
    expect(wrapper.get('[data-testid="action-menu-trigger"]').attributes('aria-expanded')).toBe(
      'true',
    );
    wrapper.unmount();
  });

  it('closes after an item is chosen', async () => {
    const wrapper = mountMenu();
    await wrapper.get('[data-testid="action-menu-trigger"]').trigger('click');

    await wrapper.get('[data-testid="item-confirm"]').trigger('click');

    expect(wrapper.find('[data-testid="action-menu-list"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('moves focus between items with the arrow keys', async () => {
    const wrapper = mountMenu();
    await wrapper.get('[data-testid="action-menu-trigger"]').trigger('click');

    await wrapper.get('[data-testid="action-menu-list"]').trigger('keydown', { key: 'ArrowDown' });

    expect(document.activeElement).toBe(wrapper.get('[data-testid="item-confirm"]').element);
    wrapper.unmount();
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    const wrapper = mountMenu();
    const trigger = wrapper.get('[data-testid="action-menu-trigger"]');
    await trigger.trigger('click');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-testid="action-menu-list"]').exists()).toBe(false);
    expect(document.activeElement).toBe(trigger.element);
    wrapper.unmount();
  });

  it('closes when a click lands outside', async () => {
    const wrapper = mountMenu();
    await wrapper.get('[data-testid="action-menu-trigger"]').trigger('click');

    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-testid="action-menu-list"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
