import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiRequestError } from '../../../composables/useApiClient.js';

const mocks = vi.hoisted(() => ({ requestAccountDeletion: vi.fn(), navigateTo: vi.fn() }));

vi.mock('#imports', () => ({ definePageMeta: () => undefined, navigateTo: mocks.navigateTo }));
vi.mock('../../../composables/useAuth.js', async () => {
  const actual = await vi.importActual<typeof import('../../../composables/useAuth.js')>(
    '../../../composables/useAuth.js',
  );
  return { ...actual, useAuth: () => ({ requestAccountDeletion: mocks.requestAccountDeletion }) };
});

import DeleteAccountPage from './delete-account.vue';

function mountPage() {
  return mount(DeleteAccountPage, {
    global: { stubs: { NuxtLink: { template: '<a><slot /></a>' } } },
  });
}

describe('settings delete account page', () => {
  beforeEach(() => {
    mocks.requestAccountDeletion.mockReset();
    mocks.navigateTo.mockReset();
  });

  it('explains the 30-day window and links to the export first', () => {
    const wrapper = mountPage();

    expect(wrapper.text()).toContain('через 30 дней');
    expect(wrapper.text()).toContain('Сначала выгрузите данные');
  });

  it('keeps the button disabled until the password and the confirmation are given', async () => {
    const wrapper = mountPage();
    const button = () => wrapper.get('button[type="submit"]');

    expect(button().attributes('disabled')).toBeDefined();
    await wrapper.get('[name="password"]').setValue('correct-password-10');
    expect(button().attributes('disabled')).toBeDefined();
    await wrapper.get('[name="confirm"]').setValue(true);
    expect(button().attributes('disabled')).toBeUndefined();
  });

  it('deletes and moves to the confirmation page with the purge date', async () => {
    mocks.requestAccountDeletion.mockResolvedValue({ purgeAfter: '2026-11-17T09:00:00.000Z' });
    const wrapper = mountPage();

    await wrapper.get('[name="password"]').setValue('correct-password-10');
    await wrapper.get('[name="confirm"]').setValue(true);
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(mocks.requestAccountDeletion).toHaveBeenCalledWith('correct-password-10');
    expect(mocks.navigateTo).toHaveBeenCalledWith(
      '/account-deleted?until=2026-11-17T09%3A00%3A00.000Z',
      { replace: true },
    );
  });

  it('shows the password field error next to the control', async () => {
    mocks.requestAccountDeletion.mockRejectedValue(
      new ApiRequestError(422, {
        code: 'CURRENT_PASSWORD_INVALID',
        detail: 'Пароль неверен.',
        fieldErrors: [{ field: 'password', message: 'Пароль неверен.', code: 'invalid' }],
      } as never),
    );
    const wrapper = mountPage();

    await wrapper.get('[name="password"]').setValue('wrong-password');
    await wrapper.get('[name="confirm"]').setValue(true);
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(wrapper.get('[name="password"]').attributes('aria-invalid')).toBe('true');
    expect(wrapper.text()).toContain('Пароль неверен.');
    expect(mocks.navigateTo).not.toHaveBeenCalled();
  });
});
