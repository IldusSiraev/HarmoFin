<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { definePageMeta, useRoute } from '#imports';

import EnvelopePlanView from '../../../components/envelopes/EnvelopesPlanView.vue';
import UiButton from '../../../components/ui/Button.vue';
import UiEmptyState from '../../../components/ui/EmptyState.vue';
import { useAuth } from '../../../composables/useAuth.js';

defineOptions({ name: 'AppEnvelopesPage' });
definePageMeta({ middleware: 'auth', layout: 'app' });

const { currentData, loadMe } = useAuth();
const route = useRoute();
const loading = ref(true);
const loadError = ref('');
const hydrated = ref(false);

const budgetId = computed(() => currentData.value?.workspaces[0]?.budgets[0]?.id);
const planQuery = computed(() => route.query as Record<string, string | undefined>);

async function loadPage() {
  loading.value = true;
  loadError.value = '';
  try {
    if (!currentData.value) await loadMe();
  } catch {
    loadError.value = 'Не удалось загрузить конверты. Повторите попытку.';
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  hydrated.value = true;
  void loadPage();
});
</script>

<template>
  <div v-if="hydrated" class="reference-page" data-hydrated="true">
    <EnvelopePlanView v-if="budgetId" :budget-id="budgetId" :query="planQuery" />
    <UiEmptyState v-else-if="loadError" title="Конверты недоступны" :description="loadError">
      <template #action><UiButton @click="loadPage">Повторить</UiButton></template>
    </UiEmptyState>
    <UiEmptyState
      v-else-if="!loading"
      title="Бюджет не выбран"
      description="Выберите бюджет, чтобы управлять конвертами."
    />
  </div>
</template>
