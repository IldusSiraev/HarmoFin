<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';
import { ArrowLeft } from '@lucide/vue';
import { definePageMeta, navigateTo } from '#imports';

import FundingRulesEditor from '../../../components/funding-rules/FundingRulesEditor.vue';
import ReferencePageLayout from '../../../components/ui/ReferencePageLayout.vue';
import UiButton from '../../../components/ui/Button.vue';
import UiConfirmDialog from '../../../components/ui/ConfirmDialog.vue';
import UiEmptyState from '../../../components/ui/EmptyState.vue';
import { useActiveWorkspace } from '../../../composables/useActiveWorkspace.js';
import { useAuth } from '../../../composables/useAuth.js';

defineOptions({ name: 'AppEnvelopeRulesPage' });
definePageMeta({ middleware: 'auth', layout: 'app' });

const { currentData, loadMe } = useAuth();
const hydrated = ref(false);
const loading = ref(true);
const loadError = ref('');
const dirty = ref(false);
const leaveOpen = ref(false);
let pendingPath: string | null = null;
let leaving = false;

const { budgetId } = useActiveWorkspace();

async function loadPage(): Promise<void> {
  loading.value = true;
  loadError.value = '';
  try {
    if (!currentData.value) await loadMe();
  } catch {
    loadError.value = 'Не удалось загрузить правила. Повторите попытку.';
  } finally {
    loading.value = false;
  }
}

onBeforeRouteLeave((to) => {
  if (!dirty.value || leaving) return true;
  pendingPath = to.fullPath;
  leaveOpen.value = true;
  return false;
});

function confirmLeave(): void {
  leaving = true;
  leaveOpen.value = false;
  if (pendingPath) void navigateTo(pendingPath);
}

function onBeforeUnload(event: BeforeUnloadEvent): void {
  if (!dirty.value) return;
  event.preventDefault();
  event.returnValue = '';
}

onMounted(() => {
  hydrated.value = true;
  window.addEventListener('beforeunload', onBeforeUnload);
  void loadPage();
});
onBeforeUnmount(() => window.removeEventListener('beforeunload', onBeforeUnload));
</script>

<template>
  <div v-if="hydrated" class="reference-page" data-hydrated="true">
    <ReferencePageLayout>
      <template #kicker>
        <NuxtLink to="/app/envelopes" class="rules-page__back" data-testid="rules-back">
          <ArrowLeft :size="16" aria-hidden="true" />
          Конверты
        </NuxtLink>
      </template>
      <template #title>Правила пополнения</template>
      <template #description>
        Правила подсказывают, сколько предложить в конверт при распределении дохода. Они ничего не
        распределяют сами и не меняют остатки.
      </template>
      <template #content>
        <FundingRulesEditor v-if="budgetId" :budget-id="budgetId" @dirty="dirty = $event" />
        <UiEmptyState v-else-if="loadError" title="Правила недоступны" :description="loadError">
          <template #action><UiButton @click="loadPage">Повторить</UiButton></template>
        </UiEmptyState>
        <UiEmptyState
          v-else-if="!loading"
          title="Бюджет не выбран"
          description="Выберите бюджет, чтобы настроить правила."
        />
      </template>
    </ReferencePageLayout>

    <UiConfirmDialog
      :open="leaveOpen"
      title="Уйти со страницы?"
      description="Есть несохранённые изменения. Уйти без сохранения?"
      confirm-label="Уйти без сохранения"
      cancel-label="Остаться"
      variant="danger"
      @confirm="confirmLeave"
      @cancel="leaveOpen = false"
    />
  </div>
</template>

<style scoped>
.rules-page__back {
  display: inline-flex;
  align-items: center;
  gap: var(--hf-space-1);
  min-height: 44px;
  color: var(--hf-color-action-primary-text);
  font-size: var(--hf-font-size-small);
  font-weight: var(--hf-font-weight-semibold);
  text-decoration: none;
  text-transform: none;
}

.rules-page__back:focus-visible {
  outline: 2px solid var(--hf-color-focus-ring);
  outline-offset: 2px;
  border-radius: var(--hf-radius-sm);
}
</style>
