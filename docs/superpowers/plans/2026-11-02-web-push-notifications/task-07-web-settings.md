# Задача 7: веб — страница настроек push

Перед началом: прочитать [README](README.md) и [Calm Fintech visual guidelines](../../specs/2026-09-17-calm-fintech-visual-guidelines.md) (разделы о карточках, кнопках и списках). Задачи 1–6 закоммичены.

**Files:**
- Modify: `apps/web/app/composables/useNotificationSettings.ts` — методы push.
- Create: `apps/web/app/pages/app/settings/push.vue`
- Create: `apps/web/app/pages/app/settings/push.test.ts`
- Modify: `apps/web/app/pages/app/settings/index.vue`, `apps/web/app/pages/app/settings/index.test.ts` — пункт «Push-уведомления».

**Interfaces:**
- Consumes (задача 3): `GET`/`PUT /api/v1/me/notification-settings/push`, `POST /api/v1/me/push/subscriptions`, `DELETE /api/v1/me/push/subscriptions/:id`; ответ `{ available, vapidPublicKey, enabled, planOverdueEnabled, calendarReminderEnabled, devices: [{ id, label, createdAt, lastSuccessAt, current }] }`.
- Consumes (задача 6): из `apps/web/app/pwa/push.ts` — `pushSupport()`, `notificationPermission()`, `currentPushSubscription()`, `subscribeThisDevice(vapidPublicKey)`, `unsubscribeThisDevice()`, `PushPermissionError`, типы `PushSupport`, `PushSubscriptionInput`.
- Consumes (существующее): `useApiClient().request<T>(path, init?)` (CSRF добавляется сам); `errorMessage(error)` из `composables/useAuth.ts`; компоненты `ReferencePageLayout`, `UiButton`, `UiCard`, `UiEmptyState`, `UiStatus`; разметка и стили страницы `pages/app/settings/telegram.vue`.
- Produces (использует задача 8): страница `/app/settings/push`; ссылка «Push-уведомления» в `/app/settings`; тексты:
  - «Включить на этом устройстве»;
  - «Это устройство»;
  - «Присылать push-уведомления»;
  - «Просроченные платежи»;
  - «Напоминания календаря»;
  - «Сохранить»;
  - «Настройки сохранены.»;
  - кнопки «Отключить <подпись>» (`aria-label`).

---

- [ ] **Step 1: Методы composable**

В `apps/web/app/composables/useNotificationSettings.ts`:

1. Первую строку `import { useApiClient } from './useApiClient.js';` заменить на:

```ts
import type { PushSubscriptionInput } from '../pwa/push.js';
import { useApiClient } from './useApiClient.js';
```

2. Комментарий `// Thin typed client over the account-level notification endpoints (/api/v1): email and Telegram.` заменить на `// Thin typed client over the account-level notification endpoints (/api/v1): email, Telegram, push.`

3. После `export interface TelegramLink { ... }` добавить:

```ts
export interface PushDevice {
  id: string;
  label: string;
  createdAt: string;
  lastSuccessAt: string | null;
  current: boolean;
}

export interface PushNotificationSettings {
  available: boolean;
  vapidPublicKey: string | null;
  enabled: boolean;
  planOverdueEnabled: boolean;
  calendarReminderEnabled: boolean;
  devices: PushDevice[];
}

export interface PushNotificationSettingsInput {
  enabled: boolean;
  planOverdueEnabled: boolean;
  calendarReminderEnabled: boolean;
}
```

4. После строки `const TELEGRAM_LINK = '/api/v1/me/telegram/link';` добавить:

```ts
const PUSH_SETTINGS = '/api/v1/me/notification-settings/push';
const PUSH_SUBSCRIPTIONS = '/api/v1/me/push/subscriptions';
```

5. В возвращаемом объекте после строки `unlinkTelegram: () => api.request<void>(TELEGRAM_LINK, { method: 'DELETE' }),` добавить:

```ts
    getPush: () => api.request<PushNotificationSettings>(PUSH_SETTINGS),
    savePush: (input: PushNotificationSettingsInput) =>
      api.request<PushNotificationSettings>(PUSH_SETTINGS, {
        method: 'PUT',
        body: JSON.stringify(input),
      }),
    addPushSubscription: (input: PushSubscriptionInput) =>
      api.request<PushNotificationSettings>(PUSH_SUBSCRIPTIONS, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    removePushSubscription: (id: string) =>
      api.request<void>(`${PUSH_SUBSCRIPTIONS}/${encodeURIComponent(id)}`, { method: 'DELETE' }),
```

- [ ] **Step 2: Тест страницы (падает)**

Файл `apps/web/app/pages/app/settings/push.test.ts`:

```ts
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
const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys: { p256dh: 'p', auth: 'a' } };

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
    const other = { ...device, id: '0192f3a4-5b6c-7d8e-9f01-23456789abce', label: 'Safari, iPhone', current: false };
    api.getPush.mockResolvedValue({ ...withDevice, devices: [device, other] });
    const wrapper = await mountPage();
    await wrapper.get('button[aria-label="Отключить Safari, iPhone"]').trigger('click');
    await flushPromises();
    expect(push.unsubscribeThisDevice).not.toHaveBeenCalled();
    expect(api.removePushSubscription).toHaveBeenCalledWith(other.id);
  });
});
```

Run: `pnpm --filter @harmofin/web exec vitest run app/pages/app/settings/push.test.ts`
Expected: FAIL (`Failed to resolve import "./push.vue"`).

- [ ] **Step 3: Страница**

Файл `apps/web/app/pages/app/settings/push.vue`:

```vue
<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { definePageMeta } from '#imports';

import ReferencePageLayout from '../../../components/ui/ReferencePageLayout.vue';
import UiButton from '../../../components/ui/Button.vue';
import UiCard from '../../../components/ui/Card.vue';
import UiEmptyState from '../../../components/ui/EmptyState.vue';
import UiStatus from '../../../components/ui/Status.vue';
import { errorMessage } from '../../../composables/useAuth.js';
import {
  type PushDevice,
  type PushNotificationSettings,
  useNotificationSettings,
} from '../../../composables/useNotificationSettings.js';
import {
  PushPermissionError,
  type PushSupport,
  currentPushSubscription,
  notificationPermission,
  pushSupport,
  subscribeThisDevice,
  unsubscribeThisDevice,
} from '../../../pwa/push.js';

defineOptions({ name: 'AppSettingsPushPage' });
definePageMeta({ middleware: 'auth', layout: 'app' });

const DENIED_TEXT =
  'Уведомления запрещены в настройках браузера. Разрешите их для этого сайта и обновите страницу.';
const dateFormat = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

const api = useNotificationSettings();
const loading = ref(true);
const loadError = ref('');
const saving = ref(false);
const enabling = ref(false);
const removingId = ref<string | null>(null);
const summary = ref('');
const summaryTone = ref<'success' | 'danger'>('success');
const settings = ref<PushNotificationSettings | null>(null);
const support = ref<PushSupport>('unsupported');
const permission = ref<NotificationPermission | null>(null);
const browserSubscribed = ref(false);
const form = reactive({ enabled: false, planOverdueEnabled: true, calendarReminderEnabled: true });

const thisDeviceRegistered = computed(
  () => settings.value?.devices.some((device) => device.current) ?? false,
);
const canEnable = computed(
  () =>
    settings.value?.available === true &&
    support.value === 'supported' &&
    permission.value !== 'denied' &&
    !thisDeviceRegistered.value,
);

function sync(next: PushNotificationSettings) {
  settings.value = next;
  form.enabled = next.enabled;
  form.planOverdueEnabled = next.planOverdueEnabled;
  form.calendarReminderEnabled = next.calendarReminderEnabled;
}

function showError(error: unknown) {
  summary.value = errorMessage(error).summary;
  summaryTone.value = 'danger';
}

async function load() {
  loading.value = true;
  loadError.value = '';
  try {
    sync(await api.getPush());
    support.value = pushSupport();
    permission.value = notificationPermission();
    browserSubscribed.value =
      support.value === 'supported' && (await currentPushSubscription()) !== null;
  } catch {
    loadError.value = 'Не удалось загрузить настройки push-уведомлений. Повторите попытку.';
  } finally {
    loading.value = false;
  }
}

async function enableThisDevice() {
  const key = settings.value?.vapidPublicKey;
  if (!key) return;
  enabling.value = true;
  summary.value = '';
  try {
    const subscription = await subscribeThisDevice(key);
    sync(await api.addPushSubscription(subscription));
    browserSubscribed.value = true;
    summary.value = 'Уведомления включены на этом устройстве.';
    summaryTone.value = 'success';
  } catch (error) {
    if (error instanceof PushPermissionError) {
      permission.value = error.permission;
      summary.value =
        error.permission === 'denied' ? DENIED_TEXT : 'Разрешение не выдано. Попробуйте ещё раз.';
      summaryTone.value = 'danger';
    } else {
      showError(error);
    }
  } finally {
    enabling.value = false;
  }
}

async function save() {
  saving.value = true;
  summary.value = '';
  try {
    sync(
      await api.savePush({
        enabled: form.enabled,
        planOverdueEnabled: form.planOverdueEnabled,
        calendarReminderEnabled: form.calendarReminderEnabled,
      }),
    );
    summary.value = 'Настройки сохранены.';
    summaryTone.value = 'success';
  } catch (error) {
    showError(error);
  } finally {
    saving.value = false;
  }
}

async function removeDevice(device: PushDevice) {
  removingId.value = device.id;
  summary.value = '';
  try {
    if (device.current) {
      await unsubscribeThisDevice();
      browserSubscribed.value = false;
    }
    await api.removePushSubscription(device.id);
    sync(await api.getPush());
  } catch (error) {
    showError(error);
  } finally {
    removingId.value = null;
  }
}

function formatDate(value: string): string {
  return dateFormat.format(new Date(value));
}

onMounted(() => {
  void load();
});
</script>

<template>
  <ReferencePageLayout>
    <template #kicker>Настройки</template>
    <template #title>Push-уведомления</template>
    <template #actions>
      <UiButton variant="tertiary" to="/app/settings">← Настройки</UiButton>
    </template>
    <template #content>
      <UiStatus v-if="loading" label="Загрузка настроек…" tone="info" aria-live="polite" />
      <UiEmptyState v-else-if="loadError" title="Настройки недоступны" :description="loadError">
        <template #action>
          <UiButton @click="load">Повторить</UiButton>
        </template>
      </UiEmptyState>
      <UiCard v-else-if="settings" as="section" aria-labelledby="push-settings-title">
        <template #header><h2 id="push-settings-title">Push-уведомления</h2></template>

        <UiStatus
          v-if="!settings.available"
          label="Push-уведомления пока не настроены на сервере."
          tone="info"
        />

        <template v-else>
          <div class="push-settings__device">
            <p class="push-settings__text">
              Сразу сообщим о просроченном платеже и напомним о событии календаря — системным
              уведомлением на этом устройстве. Уведомления доставляет push-сервис вашего браузера
              (Google, Apple, Mozilla или Microsoft); содержимое зашифровано, суммы не показываются.
              Название платежа или события будет видно на экране блокировки.
            </p>

            <p v-if="support === 'ios-install-required'" class="push-settings__text">
              На iPhone и iPad уведомления работают только в приложении, установленном на экран
              «Домой»: нажмите «Поделиться» → «На экран «Домой»», откройте HarmoFin с экрана «Домой»
              и вернитесь в этот раздел.
            </p>
            <UiStatus
              v-else-if="support === 'unsupported'"
              label="Этот браузер не поддерживает push-уведомления."
              tone="info"
            />
            <UiStatus
              v-else-if="permission === 'denied'"
              label="Уведомления запрещены в настройках браузера. Разрешите их для этого сайта и обновите страницу."
              tone="info"
            />

            <UiButton
              v-if="canEnable"
              data-action="enable-push"
              :loading="enabling"
              @click="enableThisDevice"
            >
              {{ browserSubscribed ? 'Включить снова' : 'Включить на этом устройстве' }}
            </UiButton>
            <UiStatus v-if="summary" :label="summary" :tone="summaryTone" aria-live="polite" />
          </div>

          <template v-if="settings.devices.length > 0">
            <form class="push-settings__form" @submit.prevent="save">
              <label class="push-settings__checkbox">
                <input v-model="form.enabled" name="enabled" type="checkbox" />
                <span>Присылать push-уведомления</span>
              </label>

              <fieldset v-if="form.enabled" class="push-settings__options">
                <legend class="push-settings__legend">Что присылать</legend>
                <label class="push-settings__checkbox">
                  <input v-model="form.planOverdueEnabled" name="planOverdueEnabled" type="checkbox" />
                  <span>Просроченные платежи</span>
                </label>
                <label class="push-settings__checkbox">
                  <input
                    v-model="form.calendarReminderEnabled"
                    name="calendarReminderEnabled"
                    type="checkbox"
                  />
                  <span>Напоминания календаря</span>
                </label>
              </fieldset>

              <UiButton type="submit" :loading="saving">Сохранить</UiButton>
            </form>

            <section class="push-settings__devices" aria-labelledby="push-devices-title">
              <h3 id="push-devices-title" class="push-settings__subtitle">Устройства</h3>
              <ul class="push-settings__list">
                <li v-for="device in settings.devices" :key="device.id" class="push-settings__row">
                  <div class="push-settings__row-text">
                    <span class="push-settings__label">{{ device.label }}</span>
                    <span v-if="device.current" class="push-settings__current">Это устройство</span>
                    <span class="push-settings__meta">Подключено {{ formatDate(device.createdAt) }}</span>
                  </div>
                  <UiButton
                    variant="secondary"
                    size="sm"
                    :aria-label="`Отключить ${device.label}`"
                    :loading="removingId === device.id"
                    @click="removeDevice(device)"
                  >
                    Отключить
                  </UiButton>
                </li>
              </ul>
            </section>
          </template>
        </template>
      </UiCard>
    </template>
  </ReferencePageLayout>
</template>

<style scoped>
.push-settings__device,
.push-settings__form,
.push-settings__options {
  display: grid;
  gap: var(--hf-space-4);
  justify-items: start;
  max-width: 32rem;
}

.push-settings__form {
  margin-top: var(--hf-space-6);
}

.push-settings__options {
  padding: 0;
  border: 0;
}

.push-settings__text {
  margin: 0;
  color: var(--hf-color-text);
}

.push-settings__legend {
  margin-bottom: var(--hf-space-2);
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}

.push-settings__checkbox {
  display: flex;
  align-items: center;
  gap: var(--hf-space-3);
  min-height: var(--hf-control-height-sm);
  color: var(--hf-color-text);
}

.push-settings__checkbox input {
  width: 1.25rem;
  height: 1.25rem;
}

.push-settings__devices {
  margin-top: var(--hf-space-6);
  max-width: 32rem;
}

.push-settings__subtitle {
  margin: 0 0 var(--hf-space-3);
  color: var(--hf-color-text);
  font-size: var(--hf-font-size-small);
  font-weight: 600;
}

.push-settings__list {
  display: grid;
  gap: var(--hf-space-3);
  margin: 0;
  padding: 0;
  list-style: none;
}

.push-settings__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--hf-space-4);
}

.push-settings__row-text {
  display: grid;
  gap: var(--hf-space-1);
}

.push-settings__label {
  color: var(--hf-color-text);
}

.push-settings__current,
.push-settings__meta {
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}
</style>
```

Если `pnpm --filter @harmofin/web typecheck` или lint ругается на неизвестный токен (`--hf-space-1`, `--hf-space-6`), найти ближайший существующий в `apps/web/app/assets` (`grep -r "hf-space-" apps/web/app/assets | head`) и использовать его. Новых токенов не создавать.

Run: `pnpm --filter @harmofin/web exec vitest run app/pages/app/settings/push.test.ts`
Expected: PASS (10 тестов).

Если не находится кнопка по `aria-label` (компонент `UiButton` не пробрасывает атрибуты), проверить `apps/web/app/components/ui/Button.vue`: атрибут `data-action` на странице Telegram пробрасывается, значит `aria-label` тоже должен. Если нет, остановиться и записать в «Ход выполнения».

- [ ] **Step 4: Пункт в настройках (тест падает)**

В `apps/web/app/pages/app/settings/index.test.ts` после теста `'links to the telegram notifications page from the account card'` добавить:

```ts
  it('links to the push notifications page from the account card', async () => {
    const wrapper = mountPage();
    await flushPromises();

    const link = wrapper.find('a[href="/app/settings/push"]');
    expect(link.exists()).toBe(true);
    expect(link.text()).toContain('Push-уведомления');
    wrapper.unmount();
  });
```

Run: `pnpm --filter @harmofin/web exec vitest run app/pages/app/settings/index.test.ts`
Expected: FAIL.

В `apps/web/app/pages/app/settings/index.vue` после блока

```vue
          <NuxtLink to="/app/settings/telegram" class="settings-page__row">
            <span>Уведомления в Telegram</span>
            <span class="settings-page__row-link">Настроить →</span>
          </NuxtLink>
```

добавить:

```vue
          <NuxtLink to="/app/settings/push" class="settings-page__row">
            <span>Push-уведомления</span>
            <span class="settings-page__row-link">Настроить →</span>
          </NuxtLink>
```

Run: `pnpm --filter @harmofin/web exec vitest run app/pages/app/settings/index.test.ts`
Expected: PASS.

- [ ] **Step 5: Прогнать проверки**

Run: `pnpm --filter @harmofin/web test`
Expected: PASS.

Run: `pnpm --filter @harmofin/web typecheck && pnpm --filter @harmofin/web lint`
Expected: PASS, 0 errors.

Run: `pnpm exec prettier --write apps/web/app/composables/useNotificationSettings.ts apps/web/app/pages/app/settings/push.vue apps/web/app/pages/app/settings/push.test.ts apps/web/app/pages/app/settings/index.vue apps/web/app/pages/app/settings/index.test.ts`
Если prettier что-то поменял, повторить `pnpm --filter @harmofin/web test`.

Run: `pnpm --filter @harmofin/web build`
Expected: PASS.

Проверка в браузере — только если владелец прямо попросит (см. Global Constraints). Иначе сценарий проверяет E2E задачи 8 в CI.

- [ ] **Step 6: Review по чек-листу**

```bash
git add apps/web/app/composables/useNotificationSettings.ts apps/web/app/pages/app/settings/push.vue apps/web/app/pages/app/settings/push.test.ts apps/web/app/pages/app/settings/index.vue apps/web/app/pages/app/settings/index.test.ts
git diff --staged
```

Чек-лист:

- UI/UX:
  - карточка и поля как на странице Telegram, только существующие токены;
  - каждый статус передан текстом (`UiStatus`), у сообщений после действий — `aria-live`;
  - у флажков есть подписи, у кнопок «Отключить» — `aria-label` с именем устройства;
  - кнопка включения работает с клавиатуры и запрашивает разрешение только по нажатию;
  - тексты на русском;
  - инструкция для iPhone понятна без цвета.
- security: публичный ключ берётся из ответа API; в `localStorage` ничего не пишется; удаление текущего устройства снимает подписку браузера.
- QA: тесты покрывают все состояния: сервер, iOS, неподдерживаемый браузер, запрет, включение, «Включить снова», отказ при включении, сохранение типов, удаление своего и чужого устройства; плюс ссылку в настройках.
- final: только файлы из списка Files.

- [ ] **Step 7: Commit**

```bash
git branch --show-current
git commit -m "feat(web): страница настроек push-уведомлений"
```

Строку в «Ход выполнения» — как в README.
