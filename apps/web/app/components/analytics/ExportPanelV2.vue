<script setup lang="ts">
import { ref } from 'vue';

import UiButton from '../ui/Button.vue';
import { useEnvelopePlanV2 } from '../../composables/useEnvelopePlanV2.js';
import { exportErrorText, saveBlob } from './csv-download.js';

// Model v2 CSV exports. Owner only: the server enforces it, the hidden buttons
// are just honest UI. No envelope-balance export exists in v2.
const props = defineProps<{ budgetId: string; isOwner: boolean }>();
const v2 = useEnvelopePlanV2();
const pending = ref<'' | 'transactions' | 'assignments'>('');
const status = ref('');
const error = ref('');

async function download(kind: 'transactions' | 'assignments') {
  if (!props.isOwner || pending.value) return;
  pending.value = kind;
  status.value = '';
  error.value = '';
  try {
    const blob =
      kind === 'transactions'
        ? await v2.exportTransactions(props.budgetId)
        : await v2.exportAssignments(props.budgetId);
    saveBlob(
      blob,
      kind === 'transactions' ? 'harmofin-transactions-v2.csv' : 'harmofin-assignments-v2.csv',
    );
    status.value = 'Файл CSV подготовлен.';
  } catch (exception) {
    error.value = exportErrorText(exception);
  } finally {
    pending.value = '';
  }
}
</script>

<template>
  <section class="export-panel" aria-labelledby="export-panel-title">
    <h2 id="export-panel-title">Экспорт</h2>
    <p v-if="!isOwner" class="export-panel__note">Экспорт доступен только владельцу бюджета.</p>
    <div v-else class="export-panel__actions">
      <UiButton
        variant="secondary"
        data-action="export-transactions"
        :disabled="pending !== ''"
        @click="download('transactions')"
      >
        Скачать операции (CSV)
      </UiButton>
      <UiButton
        variant="secondary"
        data-action="export-assignments"
        :disabled="pending !== ''"
        @click="download('assignments')"
      >
        Скачать назначения (CSV)
      </UiButton>
    </div>
    <p v-if="status" role="status" class="export-panel__note">{{ status }}</p>
    <p v-if="error" role="alert" class="export-panel__error" data-testid="export-error">
      {{ error }}
    </p>
  </section>
</template>

<style scoped>
.export-panel {
  display: grid;
  gap: var(--hf-space-3);
}
.export-panel h2,
.export-panel p {
  margin: 0;
}
.export-panel h2 {
  font-size: 1.25rem;
}
.export-panel__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-3);
}
.export-panel__note {
  color: var(--hf-color-text-muted);
}
.export-panel__error {
  color: var(--hf-color-text-danger);
}
</style>
