import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  getPush: vi.fn(),
  savePush: vi.fn(),
  addPushSubscription: vi.fn(),
  removePushSubscription: vi.fn(),
}));
vi.mock('../../../composables/useNotificationSettings.js', () => ({
  useNotificationSettings: () => api,
}));

const push = vi.hoisted(() => {
  class PushPermissionError extends Error {
    constructor(readonly permission: NotificationPermission) {
      super(permission);
    }
  }
  return {
    PushPermissionError,
    pushSupport: vi.fn(),
    notificationPermission: vi.fn(),
    currentPushSubscription: vi.fn(),
    subscribeThisDevice: vi.fn(),
    unsubscribeThisDevice: vi.fn(),
  };
});
vi.mock('../../../pwa/push.js', () => push);

import PushSettingsPage from './push.vue';

const device = {
  id: '0192f3a4-5b6c-7d8e-9f01-23456789abcd',
  label: 'Chrome, Android',
  createdAt: '2026-11-02T09:00:00.000Z',
  lastSuccessAt: null,
  current: true,
};
const empty = {
  available: true,
  vapidPublicKey: 'PUBLIC-KEY',
  enabled: false,
  planOverdueEnabled: true,
  calendarReminderEnabled: true,
  devices: [],
};
const withDevice = { ...empty, enabled: true, devices: [device] };
const subscription = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/x',
  keys: { p256dh: 'p', auth: 'a' },
};

async function mountPage() {
  const wrapper = mount(PushSettingsPage, {
    global: { stubs: { NuxtLink: { template: '<a><slot /></a>' } } },
  });
  await flushPromises();
  return wrapper;
}

const button = (wrapper: Awaited<ReturnType<typeof mountPage>>, text: string) =>
  wrapper.findAll('button').find((item) => item.text().includes(text));

describe('settings push page', () => {
  beforeEach(() => {
    api.getPush.mockReset().mockResolvedValue({ ...empty });
    api.savePush.mockReset().mockImplementation(async (input) => ({ ...withDevice, ...input }));
    api.addPushSubscription.mockReset().mockResolvedValue({ ...withDevice });
    api.removePushSubscription.mockReset().mockResolvedValue(undefined);
    push.pushSupport.mockReset().mockReturnValue('supported');
    push.notificationPermission.mockReset().mockReturnValue('default');
    push.currentPushSubscription.mockReset().mockResolvedValue(null);
    push.subscribeThisDevice.mockReset().mockResolvedValue(subscription);
    push.unsubscribeThisDevice.mockReset().mockResolvedValue(undefined);
  });

  it('explains that push is not configured on the server', async () => {
    api.getPush.mockResolvedValue({ ...empty, available: false, vapidPublicKey: null });
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain('Push-уведомления пока не настроены на сервере');
    expect(button(wrapper, 'Включить на этом устройстве')).toBeUndefined();
  });

  it('asks iPhone users to install the app to the home screen', async () => {
    push.pushSupport.mockReturnValue('ios-install-required');
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain('На экран «Домой»');
    expect(button(wrapper, 'Включить на этом устройстве')).toBeUndefined();
  });

  it('says the browser has no push', async () => {
    push.pushSupport.mockReturnValue('unsupported');
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain('Этот браузер не поддерживает push-уведомления');
  });

  it('explains how to allow notifications after a refusal', async () => {
    push.notificationPermission.mockReturnValue('denied');
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain('Уведомления запрещены в настройках браузера');
    expect(button(wrapper, 'Включить на этом устройстве')).toBeUndefined();
  });

  it('subscribes this device with the server key', async () => {
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain('push-сервис');
    await button(wrapper, 'Включить на этом устройстве')!.trigger('click');
    await flushPromises();
    expect(push.subscribeThisDevice).toHaveBeenCalledWith('PUBLIC-KEY');
    expect(api.addPushSubscription).toHaveBeenCalledWith(subscription);
    expect(wrapper.text()).toContain('Это устройство');
    expect(wrapper.text()).toContain('Уведомления включены на этом устройстве.');
    expect((wrapper.get('[name="enabled"]').element as HTMLInputElement).checked).toBe(true);
  });

  it('offers to enable again when the browser is subscribed but the server lost it', async () => {
    push.currentPushSubscription.mockResolvedValue({ endpoint: subscription.endpoint });
    const wrapper = await mountPage();
    expect(button(wrapper, 'Включить снова')).toBeDefined();
  });

  it('shows the refusal when the permission is denied while enabling', async () => {
    push.subscribeThisDevice.mockRejectedValue(new push.PushPermissionError('denied'));
    const wrapper = await mountPage();
    await button(wrapper, 'Включить на этом устройстве')!.trigger('click');
    await flushPromises();
    expect(api.addPushSubscription).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('Уведомления запрещены в настройках браузера');
  });

  it('saves the type switches', async () => {
    api.getPush.mockResolvedValue({ ...withDevice });
    const wrapper = await mountPage();
    expect(button(wrapper, 'Включить на этом устройстве')).toBeUndefined();
    await wrapper.get('[name="planOverdueEnabled"]').setValue(false);
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(api.savePush).toHaveBeenCalledWith({
      enabled: true,
      planOverdueEnabled: false,
      calendarReminderEnabled: true,
    });
    expect(wrapper.text()).toContain('Настройки сохранены.');
  });

  it('removes this device and drops the browser subscription', async () => {
    api.getPush.mockResolvedValueOnce({ ...withDevice }).mockResolvedValueOnce({ ...empty });
    const wrapper = await mountPage();
    const remove = wrapper.get('button[aria-label="Отключить Chrome, Android"]');
    await remove.trigger('click');
    await flushPromises();
    expect(push.unsubscribeThisDevice).toHaveBeenCalled();
    expect(api.removePushSubscription).toHaveBeenCalledWith(device.id);
    expect(button(wrapper, 'Включить на этом устройстве')).toBeDefined();
  });

  it('removes another device without touching this browser', async () => {
    const other = {
      ...device,
      id: '0192f3a4-5b6c-7d8e-9f01-23456789abce',
      label: 'Safari, iPhone',
      current: false,
    };
    api.getPush.mockResolvedValue({ ...withDevice, devices: [device, other] });
    const wrapper = await mountPage();
    await wrapper.get('button[aria-label="Отключить Safari, iPhone"]').trigger('click');
    await flushPromises();
    expect(push.unsubscribeThisDevice).not.toHaveBeenCalled();
    expect(api.removePushSubscription).toHaveBeenCalledWith(other.id);
  });
});
