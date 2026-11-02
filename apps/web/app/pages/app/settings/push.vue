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
// `NotificationPermission` is a type-only DOM global: eslint `no-undef` does not know it,
// so the type is derived from the `notificationPermission()` helper instead.
const permission = ref<ReturnType<typeof notificationPermission>>(null);
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
                  <input
                    v-model="form.planOverdueEnabled"
                    name="planOverdueEnabled"
                    type="checkbox"
                  />
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
                    <span class="push-settings__meta"
                      >Подключено {{ formatDate(device.createdAt) }}</span
                    >
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
