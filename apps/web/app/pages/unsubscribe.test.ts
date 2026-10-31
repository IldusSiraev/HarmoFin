import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  unsubscribe: vi.fn(),
  route: { query: { token: 'raw-token' } as Record<string, unknown> },
}));
vi.mock('#app', () => ({ useRoute: () => mocks.route }));
vi.mock('../composables/useNotificationSettings.js', () => ({
  useNotificationSettings: () => ({ unsubscribe: mocks.unsubscribe }),
}));

import UnsubscribePage from './unsubscribe.vue';

const stubs = {
  NuxtLink: { template: '<a><slot /></a>' },
  AuthForm: {
    props: ['title', 'subtitle', 'submitLabel', 'onSubmit', 'summary'],
    template:
      '<main><h1>{{ title }}</h1><p role="status">{{ summary }}</p><form @submit.prevent="onSubmit()"><button type="submit">{{ submitLabel }}</button></form><slot name="footer" /></main>',
  },
};

describe('unsubscribe page', () => {
  beforeEach(() => {
    mocks.unsubscribe.mockReset();
    mocks.route.query = { token: 'raw-token' };
    window.history.replaceState(null, '', '/unsubscribe?token=raw-token');
  });

  it('does not unsubscribe on opening', () => {
    mount(UnsubscribePage, { global: { stubs } });
    expect(mocks.unsubscribe).not.toHaveBeenCalled();
    expect(window.location.search).toBe('');
  });

  it('unsubscribes by the button and confirms it', async () => {
    mocks.unsubscribe.mockResolvedValue(undefined);
    const wrapper = mount(UnsubscribePage, { global: { stubs } });
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(mocks.unsubscribe).toHaveBeenCalledWith('raw-token');
    expect(wrapper.text()).toContain('Письма больше не будут приходить.');
    expect(wrapper.text()).toContain('Включить снова можно в настройках');
  });

  it('reports a link without a token', async () => {
    mocks.route.query = {};
    const wrapper = mount(UnsubscribePage, { global: { stubs } });
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(mocks.unsubscribe).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('Ссылка недействительна или устарела.');
  });
});
