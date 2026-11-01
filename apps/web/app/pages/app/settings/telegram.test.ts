import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  getTelegram: vi.fn(),
  saveTelegram: vi.fn(),
  createTelegramLink: vi.fn(),
  unlinkTelegram: vi.fn(),
}));
vi.mock('../../../composables/useNotificationSettings.js', () => ({
  useNotificationSettings: () => api,
}));

import TelegramSettingsPage from './telegram.vue';

const unlinked = {
  available: true,
  linked: false,
  enabled: false,
  urgentEnabled: true,
  digestFrequency: 'DAILY',
  includeAmounts: false,
  amountsConsentAt: null,
};
const linked = { ...unlinked, linked: true };

const stubs = {
  NuxtLink: { template: '<a><slot /></a>' },
  UiConfirmDialog: {
    props: ['open', 'title', 'description', 'confirmLabel', 'cancelLabel'],
    emits: ['confirm', 'cancel'],
    template:
      '<div v-if="open" role="dialog"><p>{{ title }}</p><p>{{ description }}</p><button data-test="dialog-yes" @click="$emit(\'confirm\')">{{ confirmLabel }}</button><button data-test="dialog-no" @click="$emit(\'cancel\')">{{ cancelLabel }}</button></div>',
  },
};

async function mountPage() {
  const wrapper = mount(TelegramSettingsPage, { global: { stubs } });
  await flushPromises();
  return wrapper;
}

const button = (wrapper: Awaited<ReturnType<typeof mountPage>>, text: string) =>
  wrapper.findAll('button').find((item) => item.text().includes(text))!;

describe('settings telegram page', () => {
  beforeEach(() => {
    api.getTelegram.mockReset().mockResolvedValue({ ...unlinked });
    api.saveTelegram.mockReset().mockImplementation(async (input) => ({ ...linked, ...input }));
    api.createTelegramLink.mockReset().mockResolvedValue({
      url: 'https://t.me/harmofin_bot?start=code123',
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    });
    api.unlinkTelegram.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('explains that the bot is not configured', async () => {
    api.getTelegram.mockResolvedValue({ ...unlinked, available: false });
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain('Telegram-бот пока не подключён на сервере');
    expect(wrapper.find('[name="telegramConsent"]').exists()).toBe(false);
  });

  it('asks for consent before issuing a link', async () => {
    const wrapper = await mountPage();
    expect(button(wrapper, 'Подключить Telegram').attributes('disabled')).toBeDefined();
    await wrapper.get('[name="telegramConsent"]').setValue(true);
    expect(button(wrapper, 'Подключить Telegram').attributes('disabled')).toBeUndefined();
    await button(wrapper, 'Подключить Telegram').trigger('click');
    await flushPromises();
    expect(api.createTelegramLink).toHaveBeenCalledTimes(1);
    const open = wrapper.get('a[data-action="open-telegram"]');
    expect(open.attributes('href')).toBe('https://t.me/harmofin_bot?start=code123');
    expect(open.attributes('target')).toBe('_blank');
    expect(open.attributes('rel')).toContain('noopener');
    expect(wrapper.text()).toContain('Нажмите Start');
  });

  it('polls until the chat is linked, then shows the settings', async () => {
    // Only intervals and Date: flushPromises relies on real setTimeout/setImmediate.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    const wrapper = await mountPage();
    await wrapper.get('[name="telegramConsent"]').setValue(true);
    await button(wrapper, 'Подключить Telegram').trigger('click');
    await flushPromises();

    api.getTelegram.mockResolvedValue({ ...linked });
    await vi.advanceTimersByTimeAsync(3_000);
    await flushPromises();

    expect(wrapper.text()).toContain('Telegram подключён.');
    expect(wrapper.find('[name="enabled"]').exists()).toBe(true);
    const calls = api.getTelegram.mock.calls.length;
    await vi.advanceTimersByTimeAsync(9_000);
    expect(api.getTelegram.mock.calls.length).toBe(calls);
  });

  it('stops polling when the link expires', async () => {
    // Only intervals and Date: flushPromises relies on real setTimeout/setImmediate.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    api.createTelegramLink.mockResolvedValue({
      url: 'https://t.me/harmofin_bot?start=code123',
      expiresAt: new Date(Date.now() + 5_000).toISOString(),
    });
    const wrapper = await mountPage();
    await wrapper.get('[name="telegramConsent"]').setValue(true);
    await button(wrapper, 'Подключить Telegram').trigger('click');
    await flushPromises();
    await vi.advanceTimersByTimeAsync(6_000);
    await flushPromises();
    expect(wrapper.text()).toContain('Ссылка устарела');
    expect(wrapper.find('a[data-action="open-telegram"]').exists()).toBe(false);
  });

  it('saves settings and asks for a separate amounts consent', async () => {
    api.getTelegram.mockResolvedValue({ ...linked });
    const wrapper = await mountPage();
    await wrapper.get('[name="enabled"]').setValue(true);

    const amounts = wrapper.get('[name="includeAmounts"]');
    (amounts.element as HTMLInputElement).checked = true;
    await amounts.trigger('change');
    expect(wrapper.get('[role="dialog"]').text()).toContain('Telegram');
    await wrapper.get('[data-test="dialog-yes"]').trigger('click');

    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(api.saveTelegram).toHaveBeenCalledWith({
      enabled: true,
      urgentEnabled: true,
      digestFrequency: 'DAILY',
      includeAmounts: true,
      amountsConsent: true,
    });
    expect(wrapper.text()).toContain('Настройки сохранены.');
  });

  it('unlinks after confirmation', async () => {
    api.getTelegram.mockResolvedValueOnce({ ...linked }).mockResolvedValue({ ...unlinked });
    const wrapper = await mountPage();
    await button(wrapper, 'Отключить Telegram').trigger('click');
    await wrapper.get('[data-test="dialog-yes"]').trigger('click');
    await flushPromises();
    expect(api.unlinkTelegram).toHaveBeenCalledTimes(1);
    expect(wrapper.find('[name="telegramConsent"]').exists()).toBe(true);
  });
});
