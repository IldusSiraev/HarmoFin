# Задача 7: веб — страница «Уведомления в Telegram»

Перед началом: прочитать [README](README.md) и раздел о кнопках/карточках в [Calm Fintech guidelines](../../specs/2026-09-17-calm-fintech-visual-guidelines.md) (только разделы про кнопки, карточки и статусы). Задачи 1–6 закоммичены.

Страница почты `apps/web/app/pages/app/settings/notifications.vue` **не меняется**: разметка полей копируется в новую страницу.

**Files:**
- Modify: `apps/web/app/composables/useNotificationSettings.ts` — методы Telegram.
- Create: `apps/web/app/pages/app/settings/telegram.vue`
- Create: `apps/web/app/pages/app/settings/telegram.test.ts`
- Modify: `apps/web/app/pages/app/settings/index.vue` — пункт меню.
- Modify: `apps/web/app/pages/app/settings/index.test.ts` — тест пункта.

**Interfaces:**
- Consumes (задачи 3–4): `GET`/`PUT /api/v1/me/notification-settings/telegram` → `{available, linked, enabled, urgentEnabled, digestFrequency, includeAmounts, amountsConsentAt}`; `POST /api/v1/me/telegram/link` с `{consent: true}` → `{url, expiresAt}`; `DELETE /api/v1/me/telegram/link` → 204. Ошибки — problem details (`errorMessage(error)` из `composables/useAuth.js` превращает их в `{summary, fields}`).
- Produces (использует задача 8, E2E): страница `/app/settings/telegram`; подписи и тексты, на которые опирается E2E:
  - флажок `Согласен на отправку уведомлений через Telegram`, кнопка `Подключить Telegram`;
  - ссылка `Открыть Telegram` с `href` = `url` из ответа;
  - статус `Telegram подключён.`;
  - флажок `Присылать уведомления в Telegram`, кнопка `Сохранить`, статус `Настройки сохранены.`;
  - кнопка `Отключить Telegram`, в диалоге — кнопка `Отключить`;
  - пункт меню настроек `Уведомления в Telegram` со ссылкой `/app/settings/telegram`.

---

- [ ] **Step 1: Composable**

В `apps/web/app/composables/useNotificationSettings.ts`:

1. После `export interface EmailNotificationSettingsInput { ... }` добавить:

```ts
export interface TelegramNotificationSettings {
  available: boolean;
  linked: boolean;
  enabled: boolean;
  urgentEnabled: boolean;
  digestFrequency: DigestFrequency;
  includeAmounts: boolean;
  amountsConsentAt: string | null;
}

export type TelegramNotificationSettingsInput = EmailNotificationSettingsInput;

export interface TelegramLink {
  url: string;
  expiresAt: string;
}
```

2. После `const SETTINGS = '/api/v1/me/notification-settings/email';` добавить:

```ts
const TELEGRAM_SETTINGS = '/api/v1/me/notification-settings/telegram';
const TELEGRAM_LINK = '/api/v1/me/telegram/link';
```

3. В объект, который возвращает `useNotificationSettings()`, после `unsubscribe: ...,` добавить:

```ts
    getTelegram: () => api.request<TelegramNotificationSettings>(TELEGRAM_SETTINGS),
    saveTelegram: (input: TelegramNotificationSettingsInput) =>
      api.request<TelegramNotificationSettings>(TELEGRAM_SETTINGS, {
        method: 'PUT',
        body: JSON.stringify(input),
      }),
    createTelegramLink: () =>
      api.request<TelegramLink>(TELEGRAM_LINK, {
        method: 'POST',
        body: JSON.stringify({ consent: true }),
      }),
    unlinkTelegram: () => api.request<void>(TELEGRAM_LINK, { method: 'DELETE' }),
```

Комментарий в начале файла заменить на `// Thin typed client over the account-level notification endpoints (/api/v1): email and Telegram.`

- [ ] **Step 2: Тест страницы (падает)**

Файл `apps/web/app/pages/app/settings/telegram.test.ts`:

```ts
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
```

Run: `pnpm --filter @harmofin/web exec vitest run --config vitest.config.ts app/pages/app/settings/telegram.test.ts`
Expected: FAIL (страницы нет).

- [ ] **Step 3: Страница**

Файл `apps/web/app/pages/app/settings/telegram.vue`:

```vue
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
                    fieldErrors.includeAmounts
                      ? 'telegram-amounts-error'
                      : 'telegram-amounts-hint'
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
```

Все CSS-переменные выше уже есть в `apps/web/app/assets/styles/tokens.css` (цвет ссылки — как у `.settings-page__row-link`, фокус — как в `Tabs.vue`). Новых цветов не вводить.

Run: тест из Step 2. Expected: PASS.

- [ ] **Step 4: Пункт меню настроек**

В `apps/web/app/pages/app/settings/index.vue` после блока

```vue
          <NuxtLink to="/app/settings/notifications" class="settings-page__row">
            <span>Уведомления на почту</span>
            <span class="settings-page__row-link">Настроить →</span>
          </NuxtLink>
```

добавить:

```vue
          <NuxtLink to="/app/settings/telegram" class="settings-page__row">
            <span>Уведомления в Telegram</span>
            <span class="settings-page__row-link">Настроить →</span>
          </NuxtLink>
```

В `apps/web/app/pages/app/settings/index.test.ts` после теста `'links to the email notifications page from the account card'` добавить:

```ts
  it('links to the telegram notifications page from the account card', async () => {
    const wrapper = mountPage();
    await flushPromises();

    const link = wrapper.find('a[href="/app/settings/telegram"]');
    expect(link.exists()).toBe(true);
    expect(link.text()).toContain('Уведомления в Telegram');
    wrapper.unmount();
  });
```

- [ ] **Step 5: Общие проверки**

Run: `pnpm --filter @harmofin/web test`
Expected: PASS весь веб (включая неизменённый `notifications.test.ts`).
Run: `pnpm --filter @harmofin/web typecheck && pnpm --filter @harmofin/web lint`
Expected: PASS, 0 errors.
Run: `pnpm exec prettier --check apps/web/app/pages/app/settings apps/web/app/composables/useNotificationSettings.ts`
Expected: PASS.

Браузер локально не запускать (Playwright — только CI). Сценарий для CI — в задаче 8.

- [ ] **Step 6: Review по чек-листу**

`git add apps/web/app/composables/useNotificationSettings.ts apps/web/app/pages/app/settings` и `git diff --staged`:

- UI/UX: карточка и поля как на странице почты; только существующие токены; статусы текстом с `aria-live`; у всех полей подписи; кнопка подключения недоступна без согласия; ссылка `Открыть Telegram` — `target="_blank"` с `rel="noopener noreferrer"` и видимым фокусом; отключение — через диалог подтверждения; кнопки не только иконками.
- security: в вебе не хранится ни код, ни ссылка за пределами памяти страницы (нет `localStorage`); опрос останавливается при привязке, истечении срока и уходе со страницы.
- QA: тесты — бот не настроен, согласие, ссылка, опрос до привязки, истечение срока, отдельное согласие на суммы, отвязка.
- final: `notifications.vue` и его тест не изменены.

- [ ] **Step 7: Commit**

```bash
git branch --show-current
git commit -m "feat(web): страница уведомлений в Telegram"
```

Добавить строку в «Ход выполнения» README.
