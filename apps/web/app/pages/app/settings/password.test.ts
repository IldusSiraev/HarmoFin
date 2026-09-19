import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

import { ApiRequestError } from '../../../composables/useApiClient.js';

const mocks = vi.hoisted(() => ({ changePassword: vi.fn() }));

vi.mock('../../../composables/useAuth.js', async () => {
  const actual = await vi.importActual<typeof import('../../../composables/useAuth.js')>(
    '../../../composables/useAuth.js',
  );
  return { ...actual, useAuth: () => ({ changePassword: mocks.changePassword }) };
});

import PasswordSettingsPage from './password.vue';

function mountPage() {
  return mount(PasswordSettingsPage, {
    global: { stubs: { NuxtLink: { template: '<a><slot /></a>' } } },
  });
}

describe('settings password page', () => {
  it('submits current and new password and shows success', async () => {
    mocks.changePassword.mockResolvedValue(undefined);
    const wrapper = mountPage();

    await wrapper.get('[name="currentPassword"]').setValue('old-password');
    await wrapper.get('[name="newPassword"]').setValue('new-password-10');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(mocks.changePassword).toHaveBeenCalledWith({
      currentPassword: 'old-password',
      newPassword: 'new-password-10',
    });
    expect(wrapper.text()).toContain('Пароль изменён.');
    expect((wrapper.get('[name="currentPassword"]').element as HTMLInputElement).value).toBe('');
  });

  it('shows a field error next to the matching control on failure', async () => {
    mocks.changePassword.mockRejectedValue(
      new ApiRequestError(422, {
        code: 'VALIDATION_FAILED',
        detail: 'Не доверять этой детали.',
        fieldErrors: [{ field: 'currentPassword', message: 'Неверный пароль.', code: 'custom' }],
      }),
    );
    const wrapper = mountPage();

    await wrapper.get('[name="currentPassword"]').setValue('wrong-password');
    await wrapper.get('[name="newPassword"]').setValue('new-password-10');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(wrapper.text()).toContain('Неверный пароль.');
    expect(wrapper.get('[name="currentPassword"]').attributes('aria-invalid')).toBe('true');
  });
});
