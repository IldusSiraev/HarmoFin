import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiRequestError } from '../composables/useApiClient.js';

const mocks = vi.hoisted(() => ({
  confirmEmailVerification: vi.fn(),
  route: { query: { token: 'raw-token' } as Record<string, unknown> },
}));
const navigateTo = vi.hoisted(() => vi.fn());
vi.mock('#app', () => ({ useRoute: () => mocks.route, navigateTo }));
vi.mock('../composables/useNotificationSettings.js', () => ({
  useNotificationSettings: () => ({ confirmEmailVerification: mocks.confirmEmailVerification }),
}));

import VerifyEmailPage from './verify-email.vue';

const stubs = {
  NuxtLink: { template: '<a><slot /></a>' },
  AuthForm: {
    props: ['title', 'subtitle', 'submitLabel', 'onSubmit', 'summary'],
    template:
      '<main><h1>{{ title }}</h1><p role="status">{{ summary }}</p><form @submit.prevent="onSubmit()"><button type="submit">{{ submitLabel }}</button></form><slot name="footer" /></main>',
  },
};

describe('verify email page', () => {
  beforeEach(() => {
    mocks.confirmEmailVerification.mockReset();
    navigateTo.mockReset();
    mocks.route.query = { token: 'raw-token' };
    window.history.replaceState(null, '', '/verify-email?token=raw-token');
  });

  it('removes the token from the address bar and does nothing until the button', () => {
    mount(VerifyEmailPage, { global: { stubs } });
    expect(window.location.search).toBe('');
    expect(mocks.confirmEmailVerification).not.toHaveBeenCalled();
  });

  it('confirms and offers the notification settings', async () => {
    mocks.confirmEmailVerification.mockResolvedValue(undefined);
    const wrapper = mount(VerifyEmailPage, { global: { stubs } });
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(mocks.confirmEmailVerification).toHaveBeenCalledWith('raw-token');
    expect(wrapper.text()).toContain('Почта подтверждена.');
    expect(wrapper.get('button').text()).toBe('Перейти к настройкам');

    await wrapper.get('form').trigger('submit');
    expect(navigateTo).toHaveBeenCalledWith('/app/settings/notifications');
    expect(mocks.confirmEmailVerification).toHaveBeenCalledTimes(1);
  });

  it('shows the server message for an invalid link', async () => {
    mocks.confirmEmailVerification.mockRejectedValue(
      new ApiRequestError(422, {
        code: 'EMAIL_VERIFICATION_TOKEN_INVALID',
        detail: 'Ссылка подтверждения недействительна или устарела. Запросите новую в настройках.',
      }),
    );
    const wrapper = mount(VerifyEmailPage, { global: { stubs } });
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.text()).toContain('Запросите новую в настройках');
  });

  it('reports a link without a token without calling the API', async () => {
    mocks.route.query = {};
    const wrapper = mount(VerifyEmailPage, { global: { stubs } });
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(mocks.confirmEmailVerification).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('Ссылка недействительна или устарела.');
  });
});
