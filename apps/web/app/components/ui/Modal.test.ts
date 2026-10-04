import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import UiModal from './Modal.vue';

describe('UiModal', () => {
  it('emits close on Escape while open', async () => {
    const wrapper = mount(UiModal, {
      props: { open: true, title: 'Новый счёт' },
      attachTo: document.body,
    });

    await document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(wrapper.emitted('close')).toHaveLength(1);
    wrapper.unmount();
  });

  it('does not listen for Escape once closed', async () => {
    const wrapper = mount(UiModal, {
      props: { open: true, title: 'Новый счёт' },
      attachTo: document.body,
    });
    await wrapper.setProps({ open: false });
    await document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(wrapper.emitted('close')).toBeUndefined();
    wrapper.unmount();
  });
});

describe('UiModal focus', () => {
  it('moves focus into the dialog, traps Tab and returns focus on close', async () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const wrapper = mount(UiModal, {
      props: { open: true, title: 'Диалог' },
      slots: { default: '<input id="a" />', footer: '<button id="z" type="button">OK</button>' },
      attachTo: document.body,
    });
    await wrapper.vm.$nextTick();
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(dialog);

    document.getElementById('z')?.focus();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true });
    document.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Закрыть');

    await wrapper.setProps({ open: false });
    expect(document.activeElement).toBe(opener);
    wrapper.unmount();
    opener.remove();
  });
});

describe('UiModal stacking and Shift+Tab', () => {
  it('wraps Shift+Tab from the first control to the last', async () => {
    const wrapper = mount(UiModal, {
      props: { open: true, title: 'Диалог' },
      slots: { footer: '<button id="z2" type="button">OK</button>' },
      attachTo: document.body,
    });
    await wrapper.vm.$nextTick();
    document.querySelector<HTMLElement>('.modal__close')?.focus();
    const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, cancelable: true });
    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe('z2');
    wrapper.unmount();
  });

  it('lets only the top modal react and unlocks scroll after the last closes', async () => {
    const lower = mount(UiModal, {
      props: { open: true, title: 'Нижний' },
      attachTo: document.body,
    });
    const upper = mount(UiModal, {
      props: { open: true, title: 'Верхний' },
      attachTo: document.body,
    });
    await upper.vm.$nextTick();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    expect(upper.emitted('close')).toHaveLength(1);
    expect(lower.emitted('close')).toBeUndefined();

    const handled = new KeyboardEvent('keydown', {
      key: 'Escape',
      cancelable: true,
      bubbles: true,
    });
    handled.preventDefault();
    document.dispatchEvent(handled);
    expect(upper.emitted('close')).toHaveLength(1);

    await upper.setProps({ open: false });
    expect(document.body.style.overflow).toBe('hidden');
    await lower.setProps({ open: false });
    expect(document.body.style.overflow).toBe('');
    lower.unmount();
    upper.unmount();
  });
});
