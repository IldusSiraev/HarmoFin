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

describe('UiModal size and test hooks', () => {
  it('exposes stable test ids and defaults to the medium size', async () => {
    const wrapper = mount(UiModal, {
      props: { open: true, title: 'Диалог' },
      attachTo: document.body,
    });
    await wrapper.vm.$nextTick();
    const dialog = document.querySelector<HTMLElement>('[data-testid="modal"]');
    expect(dialog?.classList.contains('modal--sm')).toBe(false);
    document.querySelector<HTMLElement>('[data-testid="modal-close"]')?.click();
    expect(wrapper.emitted('close')).toHaveLength(1);
    wrapper.unmount();
  });

  it('applies the small size for compact detail dialogs', async () => {
    const wrapper = mount(UiModal, {
      props: { open: true, title: 'Счёт', size: 'sm' },
      attachTo: document.body,
    });
    await wrapper.vm.$nextTick();
    const dialog = document.querySelector<HTMLElement>('[data-testid="modal"]');
    expect(dialog?.classList.contains('modal--sm')).toBe(true);
    wrapper.unmount();
  });
});

describe('UiModal under a native dialog', () => {
  it('leaves Escape to a native confirm dialog stacked on top', async () => {
    const wrapper = mount(UiModal, {
      props: { open: true, title: 'Счёт' },
      attachTo: document.body,
    });
    const confirm = document.createElement('dialog');
    confirm.setAttribute('open', '');
    document.body.append(confirm);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(wrapper.emitted('close')).toBeUndefined();

    confirm.remove();
    wrapper.unmount();
  });
});

describe('UiModal scroll', () => {
  it('scrolls the body with the calm scrollbar and fills it only on request', async () => {
    const wrapper = mount(UiModal, {
      props: { open: true, title: 'Диалог' },
      attachTo: document.body,
    });
    const content = document.querySelector('.modal__content');
    expect(content?.classList.contains('hf-scroll')).toBe(true);
    expect(content?.classList.contains('modal__content--fill')).toBe(false);
    expect(document.querySelector('.modal')?.classList.contains('modal--fill')).toBe(false);

    await wrapper.setProps({ fill: true });
    expect(content?.classList.contains('modal__content--fill')).toBe(true);
    expect(document.querySelector('.modal')?.classList.contains('modal--fill')).toBe(true);
    wrapper.unmount();
  });
});
