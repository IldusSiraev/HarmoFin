import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiRequestError } from '../../../composables/useApiClient.js';

const api = vi.hoisted(() => ({
  getEmail: vi.fn(),
  saveEmail: vi.fn(),
  requestEmailVerification: vi.fn(),
}));
vi.mock('../../../composables/useNotificationSettings.js', () => ({
  useNotificationSettings: () => api,
}));

import NotificationsSettingsPage from './notifications.vue';

const verified = {
  email: 'a***@example.test',
  emailVerified: true,
  enabled: true,
  urgentEnabled: true,
  digestFrequency: 'DAILY',
  includeAmounts: false,
  amountsConsentAt: null,
  planOverdueEnabled: true,
  calendarReminderEnabled: true,
};

const stubs = {
  NuxtLink: { template: '<a><slot /></a>' },
  UiConfirmDialog: {
    props: ['open', 'title', 'description', 'confirmLabel', 'cancelLabel'],
    emits: ['confirm', 'cancel'],
    template:
      '<div v-if="open" role="dialog"><p>{{ title }}</p><p>{{ description }}</p><button data-test="consent-yes" @click="$emit(\'confirm\')">{{ confirmLabel }}</button><button data-test="consent-no" @click="$emit(\'cancel\')">{{ cancelLabel }}</button></div>',
  },
};

async function mountPage() {
  const wrapper = mount(NotificationsSettingsPage, { global: { stubs } });
  await flushPromises();
  return wrapper;
}

describe('settings notifications page', () => {
  beforeEach(() => {
    api.getEmail.mockReset().mockResolvedValue({ ...verified });
    api.saveEmail.mockReset().mockImplementation(async (input) => ({ ...verified, ...input }));
    api.requestEmailVerification.mockReset().mockResolvedValue(undefined);
  });

  it('shows the masked address and the current settings', async () => {
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain('a***@example.test');
    expect((wrapper.get('[name="enabled"]').element as HTMLInputElement).checked).toBe(true);
    expect(wrapper.text()).toContain('В 08:00 по времени бюджета');
  });

  it('offers to verify an unconfirmed address and keeps the channel switch disabled', async () => {
    api.getEmail.mockResolvedValue({ ...verified, emailVerified: false, enabled: false });
    const wrapper = await mountPage();
    expect(wrapper.get('[name="enabled"]').attributes('disabled')).toBeDefined();

    await wrapper.get('[data-action="request-verification"]').trigger('click');
    await flushPromises();
    expect(api.requestEmailVerification).toHaveBeenCalled();
    expect(wrapper.text()).toContain('Ссылка действует 24 часа');
  });

  it('asks for consent before showing amounts and sends it with the save', async () => {
    const wrapper = await mountPage();
    const amounts = wrapper.get('[name="includeAmounts"]');
    await amounts.setValue(true);
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true);
    expect((amounts.element as HTMLInputElement).checked).toBe(false);

    await wrapper.get('[data-test="consent-yes"]').trigger('click');
    expect((amounts.element as HTMLInputElement).checked).toBe(true);
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(api.saveEmail).toHaveBeenCalledWith({
      enabled: true,
      urgentEnabled: true,
      digestFrequency: 'DAILY',
      includeAmounts: true,
      amountsConsent: true,
      planOverdueEnabled: true,
      calendarReminderEnabled: true,
    });
    expect(wrapper.text()).toContain('Настройки сохранены.');
  });

  it('keeps amounts off when consent is declined', async () => {
    const wrapper = await mountPage();
    await wrapper.get('[name="includeAmounts"]').setValue(true);
    await wrapper.get('[data-test="consent-no"]').trigger('click');
    expect((wrapper.get('[name="includeAmounts"]').element as HTMLInputElement).checked).toBe(
      false,
    );
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
  });

  it('offers the urgent types and sends them with the save', async () => {
    api.getEmail.mockResolvedValue({ ...verified, calendarReminderEnabled: false });
    const wrapper = await mountPage();
    const group = wrapper.get('[role="group"][aria-label="Какие срочные письма присылать"]');
    expect(group.text()).toContain('Просроченные платежи');
    expect(group.text()).toContain('Напоминания календаря');
    const reminders = wrapper.get('[name="calendarReminderEnabled"]');
    expect((reminders.element as HTMLInputElement).checked).toBe(false);

    await wrapper.get('[name="planOverdueEnabled"]').setValue(false);
    await reminders.setValue(true);
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(api.saveEmail).toHaveBeenCalledWith(
      expect.objectContaining({ planOverdueEnabled: false, calendarReminderEnabled: true }),
    );
  });

  it('hides the urgent types while urgent letters are off and keeps their values', async () => {
    api.getEmail.mockResolvedValue({ ...verified, planOverdueEnabled: false });
    const wrapper = await mountPage();
    await wrapper.get('[name="urgentEnabled"]').setValue(false);
    expect(wrapper.find('[name="planOverdueEnabled"]').exists()).toBe(false);

    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(api.saveEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        urgentEnabled: false,
        planOverdueEnabled: false,
        calendarReminderEnabled: true,
      }),
    );
  });

  it('shows a server error', async () => {
    api.saveEmail.mockRejectedValue(
      new ApiRequestError(409, {
        code: 'EMAIL_NOT_VERIFIED',
        detail: 'Сначала подтвердите почту.',
      }),
    );
    const wrapper = await mountPage();
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.text()).toContain('Сначала подтвердите почту.');
  });
});
