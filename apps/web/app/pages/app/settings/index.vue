<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { definePageMeta, useRuntimeConfig } from '#imports';

import TemplatePreviewSheet from '../../../components/funding/TemplatePreviewSheet.vue';
import ReferencePageLayout from '../../../components/ui/ReferencePageLayout.vue';
import UiButton from '../../../components/ui/Button.vue';
import UiCard from '../../../components/ui/Card.vue';
import UiEmptyState from '../../../components/ui/EmptyState.vue';
import UiStatus from '../../../components/ui/Status.vue';
import { useActiveWorkspace } from '../../../composables/useActiveWorkspace.js';
import { useAuth } from '../../../composables/useAuth.js';
import { usePermissions } from '../../../composables/usePermissions.js';

defineOptions({ name: 'AppSettingsPage' });
definePageMeta({ middleware: 'auth', layout: 'app' });

const { currentData, loadMe } = useAuth();

// Nuxt parses NUXT_PUBLIC_* values, so the version is normalized to text.
const appVersion = String(useRuntimeConfig().public.appVersion).trim();

const loading = ref(true);
const loadError = ref('');
const templateSummary = ref('');
const templateSheetOpen = ref(false);

const { budgetId } = useActiveWorkspace();
// Applying the budget template and changing the financial cycle are
// OWNER-only on the server.
const { canManage } = usePermissions();

async function loadPage() {
  loading.value = true;
  loadError.value = '';
  try {
    if (!currentData.value) await loadMe();
  } catch {
    loadError.value = 'Не удалось загрузить настройки бюджета. Повторите попытку.';
  } finally {
    loading.value = false;
  }
}

function accountEmail() {
  return currentData.value?.user?.email ?? '';
}

function onTemplateApplied() {
  templateSummary.value = 'Базовый шаблон настроен.';
}

function openTemplateSheet() {
  templateSheetOpen.value = true;
}

onMounted(() => {
  void loadPage();
});
</script>

<template>
  <template v-if="loading">
    <UiStatus label="Загрузка настроек…" tone="info" aria-live="polite" />
  </template>
  <UiEmptyState v-else-if="loadError" title="Настройки недоступны" :description="loadError">
    <template #action>
      <UiButton @click="loadPage">Повторить</UiButton>
    </template>
  </UiEmptyState>
  <UiEmptyState
    v-else-if="!budgetId"
    title="Бюджет не выбран"
    description="Создайте или выберите бюджет, чтобы изменить настройки."
  />
  <ReferencePageLayout v-else>
    <template #kicker>Настройки</template>
    <template #title>Настройки</template>
    <template #content>
      <p class="settings-page__help-link">
        <NuxtLink to="/app/help">Как пользоваться HarmoFin</NuxtLink>
      </p>
      <div class="settings-page__grid">
        <UiCard
          as="section"
          class="settings-page__area settings-page__area--budget"
          aria-labelledby="settings-budget-title"
        >
          <template #header><h2 id="settings-budget-title">Бюджет</h2></template>
          <NuxtLink to="/app/settings/general" class="settings-page__row">
            <span>Общие настройки</span>
            <span class="settings-page__row-link">Изменить →</span>
          </NuxtLink>
          <div v-if="canManage" class="settings-page__static-row">
            <div>
              <p class="settings-page__static-row-title">Базовый шаблон</p>
              <p class="settings-page__hint">
                Покажем, что создастся, и вы подтвердите. Суммы можно указать позже.
              </p>
            </div>
            <UiButton
              variant="tertiary"
              size="sm"
              data-action="initialize-template"
              @click="openTemplateSheet"
            >
              Настроить базовый шаблон
            </UiButton>
          </div>
          <TemplatePreviewSheet
            v-if="canManage"
            :open="templateSheetOpen"
            :budget-id="budgetId"
            @close="templateSheetOpen = false"
            @applied="onTemplateApplied"
          />
          <UiStatus
            v-if="templateSummary"
            :label="templateSummary"
            tone="success"
            aria-live="polite"
          />
        </UiCard>

        <UiCard
          as="section"
          class="settings-page__area settings-page__area--cycle"
          aria-labelledby="settings-cycle-title"
        >
          <template #header><h2 id="settings-cycle-title">Финансовый цикл</h2></template>
          <div class="settings-page__cycle-form">
            <p class="settings-page__cycle-note">
              Изменение цикла вступает в силу только с будущего периода: сначала покажем, с какой
              даты, а прошлые периоды останутся без изменений.
            </p>
            <UiButton v-if="canManage" variant="secondary" to="/app/settings/general">
              Изменить цикл
            </UiButton>
          </div>
        </UiCard>

        <UiCard
          as="section"
          class="settings-page__area settings-page__area--account"
          aria-labelledby="settings-account-title"
        >
          <template #header><h2 id="settings-account-title">Аккаунт</h2></template>
          <div class="settings-page__static-row">
            <p class="settings-page__static-row-title">{{ accountEmail() }}</p>
          </div>
          <NuxtLink to="/app/settings/password" class="settings-page__row">
            <span>Пароль</span>
            <span class="settings-page__row-link">Изменить →</span>
          </NuxtLink>
          <NuxtLink to="/app/settings/sessions" class="settings-page__row">
            <span>Сессии</span>
            <span class="settings-page__row-link">Управлять →</span>
          </NuxtLink>
          <NuxtLink to="/app/settings/delete-account" class="settings-page__row">
            <span>Удаление аккаунта</span>
            <span class="settings-page__row-link">Перейти →</span>
          </NuxtLink>
        </UiCard>
      </div>
      <p v-if="appVersion" class="settings-page__version">Версия {{ appVersion }}</p>
    </template>
  </ReferencePageLayout>
</template>

<style scoped>
.settings-page__help-link {
  margin: 0 0 var(--hf-space-5);
  font-size: var(--hf-font-size-small);
}

.settings-page__version {
  margin: var(--hf-space-5) 0 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}

/* Single column: the spec orders the cards «Бюджет», «Финансовый цикл»,
   «Аккаунт» — the cycle is promoted as the most frequently used setting. */
.settings-page__grid {
  display: grid;
  gap: var(--hf-space-5);
  grid-template-columns: 1fr;
  grid-template-areas:
    'budget'
    'cycle'
    'account';
  align-items: start;
}

.settings-page__area--budget {
  grid-area: budget;
}

.settings-page__area--cycle {
  grid-area: cycle;
}

.settings-page__area--account {
  grid-area: account;
}

.settings-page__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--hf-space-3);
  min-height: var(--hf-control-height-sm);
  padding: var(--hf-space-2) var(--hf-space-3);
  border-radius: var(--hf-radius-md);
  color: var(--hf-color-text);
  text-decoration: none;
}

.settings-page__row:hover {
  background: var(--hf-color-surface-subtle);
}

.settings-page__row-link {
  color: var(--hf-color-action-primary-hover);
  font-size: var(--hf-font-size-small);
  white-space: nowrap;
}

.settings-page__static-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--hf-space-3);
  min-height: var(--hf-control-height-sm);
  padding: var(--hf-space-2) var(--hf-space-3);
}

.settings-page__static-row-title {
  margin: 0;
  color: var(--hf-color-text);
}

.settings-page__hint {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}

.settings-page__cycle-form {
  display: grid;
  gap: var(--hf-space-5);
  margin-top: var(--hf-space-4);
}

.settings-page__cycle-note {
  margin: 0;
  padding: var(--hf-space-3);
  border-radius: var(--hf-radius-md);
  background: var(--hf-color-surface-subtle);
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}

/* Two columns: «Бюджет» over «Аккаунт» on the left, «Финансовый цикл»
   spanning both rows on the right. */
@media (min-width: 48rem) {
  .settings-page__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    /* The flexible second row absorbs the taller cycle card, so the spanning
       card cannot inflate row 1 and push «Аккаунт» away from «Бюджет». */
    grid-template-rows: auto 1fr;
    grid-template-areas:
      'budget cycle'
      'account cycle';
  }
}
</style>
