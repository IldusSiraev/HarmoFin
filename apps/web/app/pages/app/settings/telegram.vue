<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { definePageMeta } from '#imports';

import ReferencePageLayout from '../../../components/ui/ReferencePageLayout.vue';
import UiButton from '../../../components/ui/Button.vue';
import UiCard from '../../../components/ui/Card.vue';
import UiConfirmDialog from '../../../components/ui/ConfirmDialog.vue';
import UiEmptyState from '../../../components/ui/EmptyState.vue';
import UiSelect from '../../../components/ui/Select.vue';
import UiStatus from '../../../components/ui/Status.vue';
import { errorMessage } from '../../../composables/useAuth.js';
import {
  type DigestFrequency,
  type TelegramLink,
  type TelegramNotificationSettings,
  useNotificationSettings,
} from '../../../composables/useNotificationSettings.js';

defineOptions({ name: 'AppSettingsTelegramPage' });
definePageMeta({ middleware: 'auth', layout: 'app' });

const POLL_INTERVAL_MS = 3_000;

const api = useNotificationSettings();
const loading = ref(true);
const loadError = ref('');
const saving = ref(false);
const summary = ref('');
const summaryTone = ref<'success' | 'danger'>('success');
const fieldErrors = ref<Record<string, string>>({});
const settings = ref<TelegramNotificationSettings | null>(null);
const form = reactive({
  enabled: false,
  urgentEnabled: true,
  digestFrequency: 'DAILY' as DigestFrequency,
  includeAmounts: false,
});
const consentGiven = ref(false);
const consentOpen = ref(false);
// Consent to link the chat (Telegram is a third-party service), not the amounts consent.
const linkConsent = ref(false);
const linking = ref(false);
const link = ref<TelegramLink | null>(null);
const linkExpired = ref(false);
const unlinkOpen = ref(false);
const unlinking = ref(false);
let pollTimer: ReturnType<typeof setInterval> | null = null;

const digestOptions = [
  { value: 'OFF', label: 'Не присылать' },
  { value: 'DAILY', label: 'Каждый день' },
  { value: 'WEEKLY', label: 'Раз в неделю' },
];

function sync(next: TelegramNotificationSettings) {
  settings.value = next;
  form.enabled = next.enabled;
  form.urgentEnabled = next.urgentEnabled;
  form.digestFrequency = next.digestFrequency;
  form.includeAmounts = next.includeAmounts;
  consentGiven.value = false;
}

function setDigestFrequency(value: string): void {
  form.digestFrequency = value as DigestFrequency;
}

async function load() {
  loading.value = true;
  loadError.value = '';
  try {
    sync(await api.getTelegram());
  } catch {
    loadError.value = 'Не удалось загрузить настройки Telegram. Повторите попытку.';
  } finally {
    loading.value = false;
  }
}

function stopPolling() {
  if (pollTimer !== null) clearInterval(pollTimer);
  pollTimer = null;
}

async function poll() {
  if (!link.value) return stopPolling();
  if (Date.now() >= new Date(link.value.expiresAt).getTime()) {
    stopPolling();
    link.value = null;
    linkExpired.value = true;
    return;
  }
  try {
    const next = await api.getTelegram();
    if (next.linked) {
      stopPolling();
      link.value = null;
      sync(next);
    }
  } catch {
    // A failed poll is retried on the next tick.
  }
}

async function connect() {
  linking.value = true;
  linkExpired.value = false;
  summary.value = '';
  try {
    link.value = await api.createTelegramLink();
    stopPolling();
    pollTimer = setInterval(() => void poll(), POLL_INTERVAL_MS);
  } catch (error) {
    summary.value = errorMessage(error).summary;
    summaryTone.value = 'danger';
  } finally {
    linking.value = false;
  }
}

function onAmountsChange(event: Event) {
  const input = event.target as HTMLInputElement;
  if (input.checked && !settings.value?.includeAmounts && !consentGiven.value) {
    input.checked = false;
    consentOpen.value = true;
    return;
  }
  form.includeAmounts = input.checked;
}

function confirmConsent() {
  consentGiven.value = true;
  form.includeAmounts = true;
  consentOpen.value = false;
}

async function save() {
  saving.value = true;
  summary.value = '';
  fieldErrors.value = {};
  try {
    sync(
      await api.saveTelegram({
        enabled: form.enabled,
        urgentEnabled: form.urgentEnabled,
        digestFrequency: form.digestFrequency,
        includeAmounts: form.includeAmounts,
        ...(consentGiven.value && form.includeAmounts ? { amountsConsent: true } : {}),
      }),
    );
    summary.value = 'Настройки сохранены.';
    summaryTone.value = 'success';
  } catch (error) {
    const mapped = errorMessage(error);
    summary.value = mapped.summary;
    fieldErrors.value = mapped.fields;
    summaryTone.value = 'danger';
  } finally {
    saving.value = false;
  }
}

async function unlink() {
  unlinking.value = true;
  try {
    await api.unlinkTelegram();
    unlinkOpen.value = false;
    linkConsent.value = false;
    summary.value = '';
    await load();
  } catch (error) {
    summary.value = errorMessage(error).summary;
    summaryTone.value = 'danger';
  } finally {
    unlinking.value = false;
  }
}

onMounted(() => {
  void load();
});

onBeforeUnmount(stopPolling);
</script>

<template>
  <ReferencePageLayout>
    <template #kicker>Настройки</template>
    <template #title>Уведомления в Telegram</template>
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
      <UiCard v-else-if="settings" as="section" aria-labelledby="telegram-settings-title">
        <template #header><h2 id="telegram-settings-title">Telegram</h2></template>

        <UiStatus
          v-if="!settings.available"
          label="Telegram-бот пока не подключён на сервере."
          tone="info"
        />

        <div v-else-if="!settings.linked" class="telegram-settings__connect">
          <p class="telegram-settings__text">
            Бот HarmoFin пришлёт в личный чат срочные сообщения и дайджест событий семьи. Сообщения
            проходят через серверы Telegram — это сторонний сервис, на который HarmoFin не влияет.
            Суммы по умолчанию не показываются.
          </p>
          <label class="telegram-settings__checkbox">
            <input v-model="linkConsent" name="telegramConsent" type="checkbox" />
            <span>Согласен на отправку уведомлений через Telegram</span>
          </label>
          <UiButton
            data-action="connect-telegram"
            :disabled="!linkConsent"
            :loading="linking"
            @click="connect"
          >
            Подключить Telegram
          </UiButton>
          <template v-if="link">
            <UiStatus
              label="Нажмите Start в Telegram. Ссылка действует 15 минут, страница обновится сама."
              tone="info"
              aria-live="polite"
            />
            <a
              class="telegram-settings__open"
              data-action="open-telegram"
              :href="link.url"
              target="_blank"
              rel="noopener noreferrer"
            >
              Открыть Telegram →
            </a>
          </template>
          <UiStatus
            v-else-if="linkExpired"
            label="Ссылка устарела. Получите новую."
            tone="info"
            aria-live="polite"
          />
          <UiStatus v-if="summary" :label="summary" :tone="summaryTone" aria-live="polite" />
        </div>

        <template v-else>
          <UiStatus label="Telegram подключён." tone="success" aria-live="polite" />
          <UiStatus v-if="summary" :label="summary" :tone="summaryTone" aria-live="polite" />

          <form class="telegram-settings__form" @submit.prevent="save">
            <label class="telegram-settings__checkbox">
              <input v-model="form.enabled" name="enabled" type="checkbox" />
              <span>Присылать уведомления в Telegram</span>
            </label>

            <fieldset v-if="form.enabled" class="telegram-settings__options">
              <legend class="telegram-settings__legend">Что присылать</legend>
              <label class="telegram-settings__checkbox">
                <input v-model="form.urgentEnabled" name="urgentEnabled" type="checkbox" />
                <span>Срочные сообщения</span>
              </label>
              <p class="telegram-settings__hint">
                Сразу сообщим о просроченном платеже и напомним о событии календаря.
              </p>

              <UiSelect
                :model-value="form.digestFrequency"
                name="digestFrequency"
                label="Дайджест событий семьи"
                hint="В 08:00 по времени бюджета. Если ничего не произошло, сообщения не будет."
                :options="digestOptions"
                :error="fieldErrors.digestFrequency"
                @update:model-value="setDigestFrequency"
              />

              <label class="telegram-settings__checkbox">
                <input
                  name="includeAmounts"
                  type="checkbox"
                  :checked="form.includeAmounts"
                  :aria-invalid="fieldErrors.includeAmounts ? 'true' : undefined"
                  :aria-describedby="
                    fieldErrors.includeAmounts ? 'telegram-amounts-error' : 'telegram-amounts-hint'
                  "
                  @change="onAmountsChange"
                />
                <span>Показывать суммы в сообщениях</span>
              </label>
              <p id="telegram-amounts-hint" class="telegram-settings__hint">
                Без этого в сообщениях только имена, названия и даты.
              </p>
              <p v-if="fieldErrors.includeAmounts" id="telegram-amounts-error" class="field-error">
                {{ fieldErrors.includeAmounts }}
              </p>
            </fieldset>

            <UiButton type="submit" :loading="saving">Сохранить</UiButton>
          </form>

          <div class="telegram-settings__unlink">
            <UiButton variant="secondary" data-action="unlink-telegram" @click="unlinkOpen = true">
              Отключить Telegram
            </UiButton>
          </div>

          <UiConfirmDialog
            :open="consentOpen"
            title="Показывать суммы в сообщениях?"
            description="Суммы операций и платежей появятся в сообщениях Telegram. Сообщения хранятся у Telegram, на который HarmoFin не влияет. Это согласие отдельно от согласия для почты; его можно отозвать, сняв этот пункт."
            confirm-label="Согласен"
            cancel-label="Отмена"
            variant="primary"
            @confirm="confirmConsent"
            @cancel="consentOpen = false"
          />
          <UiConfirmDialog
            :open="unlinkOpen"
            title="Отключить Telegram?"
            description="Бот перестанет присылать сообщения, неотправленные будут отменены. Подключить снова можно в любой момент."
            confirm-label="Отключить"
            cancel-label="Отмена"
            variant="danger"
            :loading="unlinking"
            @confirm="unlink"
            @cancel="unlinkOpen = false"
          />
        </template>
      </UiCard>
    </template>
  </ReferencePageLayout>
</template>

<style scoped>
.telegram-settings__connect,
.telegram-settings__form,
.telegram-settings__options {
  display: grid;
  gap: var(--hf-space-4);
  justify-items: start;
  max-width: 32rem;
}

.telegram-settings__form {
  margin-top: var(--hf-space-4);
}

.telegram-settings__options {
  padding: 0;
  border: 0;
}

.telegram-settings__text {
  margin: 0;
  color: var(--hf-color-text);
}

.telegram-settings__legend {
  margin-bottom: var(--hf-space-2);
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}

.telegram-settings__checkbox {
  display: flex;
  align-items: center;
  gap: var(--hf-space-3);
  min-height: var(--hf-control-height-sm);
  color: var(--hf-color-text);
}

.telegram-settings__checkbox input {
  width: 1.25rem;
  height: 1.25rem;
}

.telegram-settings__hint {
  margin: calc(-1 * var(--hf-space-2)) 0 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}

.telegram-settings__open {
  display: inline-flex;
  align-items: center;
  min-height: var(--hf-control-height-sm);
  color: var(--hf-color-action-primary-hover);
  font-weight: 600;
}

.telegram-settings__open:focus-visible {
  outline: 2px solid var(--hf-color-focus-ring);
  outline-offset: 2px;
}

.telegram-settings__unlink {
  margin-top: var(--hf-space-6);
}

/* No global error-text class in the app; same rules as .ui-field__error in Input.vue. */
.field-error {
  margin: 0;
  color: var(--hf-color-text-danger);
  font-size: 0.875rem;
}
</style>
