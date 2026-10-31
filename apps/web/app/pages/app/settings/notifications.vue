<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
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
  type EmailNotificationSettings,
  useNotificationSettings,
} from '../../../composables/useNotificationSettings.js';

defineOptions({ name: 'AppSettingsNotificationsPage' });
definePageMeta({ middleware: 'auth', layout: 'app' });

const api = useNotificationSettings();
const loading = ref(true);
const loadError = ref('');
const saving = ref(false);
const summary = ref('');
const summaryTone = ref<'success' | 'danger'>('success');
const fieldErrors = ref<Record<string, string>>({});
const settings = ref<EmailNotificationSettings | null>(null);
const form = reactive({
  enabled: false,
  urgentEnabled: true,
  digestFrequency: 'DAILY' as DigestFrequency,
  includeAmounts: false,
});
// Consent given in the dialog during this edit; sent with the next save only.
const consentGiven = ref(false);
const consentOpen = ref(false);
const verifying = ref(false);
const verificationSent = ref(false);

const digestOptions = [
  { value: 'OFF', label: 'Не присылать' },
  { value: 'DAILY', label: 'Каждый день' },
  { value: 'WEEKLY', label: 'Раз в неделю' },
];

function sync(next: EmailNotificationSettings) {
  settings.value = next;
  form.enabled = next.enabled;
  form.urgentEnabled = next.urgentEnabled;
  form.digestFrequency = next.digestFrequency;
  form.includeAmounts = next.includeAmounts;
  consentGiven.value = false;
}

// UiSelect emits a plain string; the server only accepts the union above.
function setDigestFrequency(value: string): void {
  form.digestFrequency = value as DigestFrequency;
}

async function load() {
  loading.value = true;
  loadError.value = '';
  try {
    sync(await api.getEmail());
  } catch {
    loadError.value = 'Не удалось загрузить настройки уведомлений. Повторите попытку.';
  } finally {
    loading.value = false;
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

function cancelConsent() {
  consentOpen.value = false;
}

async function save() {
  saving.value = true;
  summary.value = '';
  fieldErrors.value = {};
  try {
    sync(
      await api.saveEmail({
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

async function requestVerification() {
  verifying.value = true;
  try {
    await api.requestEmailVerification();
    verificationSent.value = true;
  } catch (error) {
    summary.value = errorMessage(error).summary;
    summaryTone.value = 'danger';
  } finally {
    verifying.value = false;
  }
}

onMounted(() => {
  void load();
});
</script>

<template>
  <ReferencePageLayout>
    <template #kicker>Настройки</template>
    <template #title>Уведомления на почту</template>
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
      <UiCard v-else-if="settings" as="section" aria-labelledby="email-settings-title">
        <template #header><h2 id="email-settings-title">Почта</h2></template>
        <p class="email-settings__address">{{ settings.email }}</p>
        <div v-if="!settings.emailVerified" class="email-settings__verify">
          <UiStatus
            :label="
              verificationSent
                ? 'Письмо со ссылкой отправлено. Ссылка действует 24 часа.'
                : 'Почта не подтверждена. Пока она не подтверждена, письма не отправляются.'
            "
            tone="info"
            aria-live="polite"
          />
          <UiButton
            variant="secondary"
            size="sm"
            data-action="request-verification"
            :loading="verifying"
            @click="requestVerification"
          >
            {{ verificationSent ? 'Отправить ещё раз' : 'Подтвердить почту' }}
          </UiButton>
        </div>

        <UiStatus v-if="summary" :label="summary" :tone="summaryTone" aria-live="polite" />

        <form class="email-settings__form" @submit.prevent="save">
          <label class="email-settings__checkbox">
            <input
              v-model="form.enabled"
              name="enabled"
              type="checkbox"
              :disabled="!settings.emailVerified && !form.enabled"
            />
            <span>Присылать уведомления на почту</span>
          </label>

          <fieldset v-if="form.enabled" class="email-settings__options">
            <legend class="email-settings__legend">Что присылать</legend>
            <label class="email-settings__checkbox">
              <input v-model="form.urgentEnabled" name="urgentEnabled" type="checkbox" />
              <span>Срочные письма</span>
            </label>
            <p class="email-settings__hint">
              Сразу сообщим о просроченном платеже и напомним о событии календаря.
            </p>

            <UiSelect
              :model-value="form.digestFrequency"
              name="digestFrequency"
              label="Дайджест событий семьи"
              hint="В 08:00 по времени бюджета. Если ничего не произошло, письма не будет."
              :options="digestOptions"
              :error="fieldErrors.digestFrequency"
              @update:model-value="setDigestFrequency"
            />

            <label class="email-settings__checkbox">
              <input
                name="includeAmounts"
                type="checkbox"
                :checked="form.includeAmounts"
                :aria-invalid="fieldErrors.includeAmounts ? 'true' : undefined"
                :aria-describedby="
                  fieldErrors.includeAmounts ? 'include-amounts-error' : 'include-amounts-hint'
                "
                @change="onAmountsChange"
              />
              <span>Показывать суммы в письмах</span>
            </label>
            <p id="include-amounts-hint" class="email-settings__hint">
              Без этого в письмах только имена, названия и даты.
            </p>
            <p v-if="fieldErrors.includeAmounts" id="include-amounts-error" class="field-error">
              {{ fieldErrors.includeAmounts }}
            </p>
          </fieldset>

          <UiButton type="submit" :loading="saving">Сохранить</UiButton>
        </form>

        <UiConfirmDialog
          :open="consentOpen"
          title="Показывать суммы в письмах?"
          :description="`Суммы операций и платежей появятся в письмах на ${settings.email}. Письма хранятся у почтового сервиса, на который HarmoFin не влияет. Согласие можно отозвать, сняв этот пункт.`"
          confirm-label="Согласен"
          cancel-label="Отмена"
          variant="primary"
          @confirm="confirmConsent"
          @cancel="cancelConsent"
        />
      </UiCard>
    </template>
  </ReferencePageLayout>
</template>

<style scoped>
.email-settings__address {
  margin: 0 0 var(--hf-space-3);
  color: var(--hf-color-text);
}

.email-settings__verify {
  display: grid;
  gap: var(--hf-space-3);
  justify-items: start;
  margin-bottom: var(--hf-space-4);
}

.email-settings__form,
.email-settings__options {
  display: grid;
  gap: var(--hf-space-4);
  max-width: 32rem;
  margin-top: var(--hf-space-4);
}

.email-settings__options {
  padding: 0;
  border: 0;
}

.email-settings__legend {
  margin-bottom: var(--hf-space-2);
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}

.email-settings__checkbox {
  display: flex;
  align-items: center;
  gap: var(--hf-space-3);
  min-height: var(--hf-control-height-sm);
  color: var(--hf-color-text);
}

.email-settings__checkbox input {
  width: 1.25rem;
  height: 1.25rem;
}

.email-settings__hint {
  margin: calc(-1 * var(--hf-space-2)) 0 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}

/* No global error-text class in the app; same rules as .ui-field__error in Input.vue. */
.field-error {
  margin: 0;
  color: var(--hf-color-text-danger);
  font-size: 0.875rem;
}
</style>
