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
