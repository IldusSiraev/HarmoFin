import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';

import UiDrawer from './Drawer.vue';

const mountDrawer = (open = true) =>
  mount(UiDrawer, {
    props: { open, title: 'Операция' },
    slots: { default: '<button data-testid="inside">Внутри</button>' },
    attachTo: document.body,
  });

afterEach(() => {
  document.body.style.overflow = '';
});

describe('UiDrawer', () => {
  it('renders nothing while closed', () => {
    const wrapper = mountDrawer(false);

    expect(wrapper.find('[data-testid="drawer"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('is a labelled modal dialog', () => {
    const wrapper = mountDrawer();
    const dialog = wrapper.get('[data-testid="drawer"]');

    expect(dialog.attributes('role')).toBe('dialog');
    expect(dialog.attributes('aria-modal')).toBe('true');
    const labelledBy = dialog.attributes('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy ?? '')?.textContent).toBe('Операция');
    wrapper.unmount();
  });

  it('closes from the close button, the backdrop and Escape', async () => {
    const wrapper = mountDrawer();

    await wrapper.get('[data-testid="drawer-close"]').trigger('click');
    await wrapper.get('[data-testid="drawer-backdrop"]').trigger('click');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted('close')).toHaveLength(3);
    wrapper.unmount();
  });

  it('keeps Tab inside the panel', async () => {
    const wrapper = mountDrawer();
    const close = wrapper.get('[data-testid="drawer-close"]').element as HTMLElement;
    const inside = wrapper.get('[data-testid="inside"]').element as HTMLElement;

    inside.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    await wrapper.vm.$nextTick();

    expect(document.activeElement === close || document.activeElement === inside).toBe(true);
    wrapper.unmount();
  });

  it('locks background scrolling while open', async () => {
    const wrapper = mountDrawer();
    expect(document.body.style.overflow).toBe('hidden');

    await wrapper.setProps({ open: false });

    expect(document.body.style.overflow).toBe('');
    wrapper.unmount();
  });

  it('renders on the server without touching `document`', async () => {
    // Nuxt SSR runs in Node, where there is no `document` global. `onMounted`
    // callbacks (unlike an immediate `watch` run during `setup()`) never fire
    // during SSR, so `renderToString` here exercises exactly the code path
    // that used to crash `GET /app/accounts` and `GET /app/envelopes` when
    // this drawer was mounted unconditionally (no `v-if="budget"` guard).
    const originalDocument = globalThis.document;
    // @ts-expect-error -- simulate real Node SSR, which has no `document` global.
    delete globalThis.document;

    try {
      const app = createSSRApp(UiDrawer, { open: true, title: 'Операция' });
      const html = await renderToString(app);
      expect(html).toContain('ui-drawer');
    } finally {
      globalThis.document = originalDocument;
    }
  });
});
