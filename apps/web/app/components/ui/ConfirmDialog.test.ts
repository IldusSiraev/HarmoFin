import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import UiConfirmDialog from './ConfirmDialog.vue';

const confirmProps = (overrides: Record<string, unknown> = {}) => ({
  open: true,
  title: 'Переместить счёт в архив?',
  description: 'Счёт останется в истории, но будет недоступен для новых операций.',
  confirmLabel: 'Переместить в архив',
  cancelLabel: 'Отмена',
  variant: 'danger' as const,
  ...overrides,
});

describe('UiConfirmDialog', () => {
  beforeEach(() => {
    vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (
      this: HTMLDialogElement,
    ) {
      this.setAttribute('open', '');
    });
    vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function (
      this: HTMLDialogElement,
    ) {
      this.removeAttribute('open');
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('does not emit confirmation more than once while pending', async () => {
    const wrapper = mount(UiConfirmDialog, {
      attachTo: document.body,
      props: confirmProps({ loading: true }),
    });

    await wrapper.get('button[data-confirm]').trigger('click');

    expect(wrapper.emitted('confirm')).toBeUndefined();
  });

  it('emits confirmation when action is available', async () => {
    const wrapper = mount(UiConfirmDialog, {
      attachTo: document.body,
      props: confirmProps(),
    });

    await wrapper.get('button[data-confirm]').trigger('click');

    expect(wrapper.emitted('confirm')).toHaveLength(1);
  });

  it('emits cancellation on Escape and returns focus to its trigger', async () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    const wrapper = mount(UiConfirmDialog, {
      attachTo: document.body,
      props: confirmProps(),
    });

    await wrapper.get('dialog').trigger('cancel');
    expect(wrapper.emitted('cancel')).toHaveLength(1);

    await wrapper.setProps({ open: false });
    expect(document.activeElement).toBe(trigger);
  });
});
