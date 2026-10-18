import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiRequestError } from '../composables/useApiClient.js';

const mocks = vi.hoisted(() => ({
  cancelAccountDeletion: vi.fn(),
  route: { query: { token: 'raw-token' } as Record<string, unknown> },
}));
const navigateTo = vi.hoisted(() => vi.fn());
vi.mock('#app', () => ({ useRoute: () => mocks.route, navigateTo }));
vi.mock('../composables/useAuth.js', async () => {
  const actual = await vi.importActual<typeof import('../composables/useAuth.js')>('../composables/useAuth.js');
  return { ...actual, useAuth: () => ({ cancelAccountDeletion: mocks.cancelAccountDeletion }) };
});

import RestoreAccountPage from './restore-account.vue';

const stubs = {
  NuxtLink: { template: '<a><slot /></a>' },
  AuthForm: {
    props: ['title', 'subtitle', 'submitLabel', 'onSubmit', 'summary'],
    template:
      '<main><h1>{{ title }}</h1><p>{{ subtitle }}</p><p role="status">{{ summary }}</p><form @submit.prevent="onSubmit()"><button type="submit">{{ submitLabel }}</button></form><slot name="footer" /></main>',
  },
};

describe('restore account page', () => {
  beforeEach(() => {
    mocks.cancelAccountDeletion.mockReset();
    navigateTo.mockReset();
    mocks.route.query = { token: 'raw-token' };
    window.history.replaceState(null, '', '/restore-account?token=raw-token');
  });

  it('removes the token from the address bar on load', () => {
    mount(RestoreAccountPage, { global: { stubs } });

    expect(window.location.search).toBe('');
  });

  it('cancels the deletion and offers to sign in', async () => {
    mocks.cancelAccountDeletion.mockResolvedValue(undefined);
    const wrapper = mount(RestoreAccountPage, { global: { stubs } });

    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(mocks.cancelAccountDeletion).toHaveBeenCalledWith('raw-token');
    expect(wrapper.text()).toContain('Удаление отменено');
    expect(wrapper.text()).toContain('Войти');
    expect(wrapper.get('button').text()).toBe('Перейти ко входу');
  });

  it('navigates to login on a second submit after success, without calling the API again', async () => {
    mocks.cancelAccountDeletion.mockResolvedValue(undefined);
    const wrapper = mount(RestoreAccountPage, { global: { stubs } });

    await wrapper.get('form').trigger('submit');
    await flushPromises();
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(mocks.cancelAccountDeletion).toHaveBeenCalledTimes(1);
    expect(navigateTo).toHaveBeenCalledWith('/login');
  });

  it('shows the server message for an invalid or expired link', async () => {
    mocks.cancelAccountDeletion.mockRejectedValue(
      new ApiRequestError(422, {
        code: 'ACCOUNT_RESTORE_TOKEN_INVALID',
        detail: 'Ссылка недействительна или устарела.',
      } as never),
    );
    const wrapper = mount(RestoreAccountPage, { global: { stubs } });

    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(wrapper.text()).toContain('Ссылка недействительна или устарела.');
  });

  it('does not call the API without a token', async () => {
    mocks.route.query = {};
    const wrapper = mount(RestoreAccountPage, { global: { stubs } });

    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(mocks.cancelAccountDeletion).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('Ссылка недействительна или устарела.');
  });
});
