<script setup lang="ts">
import { onMounted, ref } from 'vue';

import FinanceMoney from '../finance/FinanceMoney.vue';
import UiButton from '../ui/Button.vue';
import {
  type LegacyAssignmentItem,
  useEnvelopePlanV2,
} from '../../composables/useEnvelopePlanV2.js';
import { exportErrorText, saveBlob } from './csv-download.js';

// Read-only archive of model 1 assignments. These amounts are history: they are
// not part of any model v2 balance, "Назначено" or "Свободно для назначения".
const props = defineProps<{ budgetId: string; isOwner: boolean }>();
const v2 = useEnvelopePlanV2();
const items = ref<LegacyAssignmentItem[]>([]);
const nextCursor = ref<string | null>(null);
const loading = ref(false);
const loaded = ref(false);
const error = ref('');
const exportPending = ref(false);
const exportError = ref('');

const KIND_LABEL: Record<LegacyAssignmentItem['sourceKind'], string> = {
  LEGACY_ALLOCATION: 'Распределение дохода',
  LEGACY_REALLOCATION: 'Перераспределение',
  LEGACY_ENVELOPE_START: 'Стартовый остаток конверта',
};
const STATUS_LABEL: Record<LegacyAssignmentItem['status'], string> = {
  CONFIRMED: 'Подтверждено',
  CANCELLED: 'Отменено',
  DELETED: 'Удалено',
};

onMounted(() => {
  // The archive is owner-only: other roles neither load nor see it.
  if (props.isOwner) void load(false);
});

async function load(append: boolean) {
  loading.value = true;
  error.value = '';
  try {
    const result = await v2.getLegacyAssignmentHistory(
      props.budgetId,
      append && nextCursor.value ? { cursor: nextCursor.value } : {},
    );
    items.value = append ? [...items.value, ...result.items] : result.items;
    nextCursor.value = result.nextCursor;
    loaded.value = true;
  } catch {
    error.value = 'Не удалось загрузить исторические назначения.';
  } finally {
    loading.value = false;
  }
}

async function download() {
  if (!props.isOwner || exportPending.value) return;
  exportPending.value = true;
  exportError.value = '';
  try {
    saveBlob(
      await v2.exportLegacyAssignments(props.budgetId),
      'harmofin-legacy-assignments-v1.csv',
    );
  } catch (exception) {
    exportError.value = exportErrorText(exception);
  } finally {
    exportPending.value = false;
  }
}
</script>

<template>
  <section v-if="isOwner" class="legacy-archive" aria-labelledby="legacy-archive-title">
    <h2 id="legacy-archive-title">Исторические назначения (до модели v2)</h2>
    <p class="legacy-archive__note">
      Это исторические данные, не средства модели v2: суммы не входят в «На счетах», «Назначено» и
      «Свободно для назначения».
    </p>
    <p v-if="error" role="alert" class="legacy-archive__error">
      {{ error }}
      <UiButton variant="tertiary" data-action="legacy-retry" @click="load(items.length > 0)">
        Повторить
      </UiButton>
    </p>
    <p v-if="loaded && items.length === 0 && !error" class="legacy-archive__note">
      Исторических назначений нет.
    </p>
    <div
      v-if="items.length > 0"
      class="legacy-archive__wrap"
      role="region"
      tabindex="0"
      aria-labelledby="legacy-archive-title"
    >
      <table>
        <thead>
          <tr>
            <th scope="col">Дата</th>
            <th scope="col">Тип</th>
            <th scope="col">Сумма (история)</th>
            <th scope="col">Статус</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in items" :key="`${item.sourceKind}-${item.id}`">
            <td>{{ item.occurredOn }}</td>
            <td>{{ KIND_LABEL[item.sourceKind] }}</td>
            <td><FinanceMoney :minor-units="item.amountMinor" currency="RUB" :scale="2" /></td>
            <td>
              {{ STATUS_LABEL[item.status] }}
              <template v-if="item.isEnvelopeArchived"> · конверт в архиве</template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="legacy-archive__actions">
      <UiButton
        v-if="nextCursor"
        variant="secondary"
        data-action="legacy-more"
        :disabled="loading"
        @click="load(true)"
      >
        Ещё
      </UiButton>
      <UiButton
        v-if="isOwner"
        variant="secondary"
        data-action="export-legacy-assignments"
        :disabled="exportPending"
        @click="download"
      >
        Скачать исторические назначения (CSV)
      </UiButton>
    </div>
    <p
      v-if="exportError"
      role="alert"
      class="legacy-archive__error"
      data-testid="legacy-export-error"
    >
      {{ exportError }}
    </p>
  </section>
</template>

<style scoped>
.legacy-archive {
  display: grid;
  gap: var(--hf-space-3);
}
.legacy-archive h2,
.legacy-archive p {
  margin: 0;
}
.legacy-archive h2 {
  font-size: 1.25rem;
}
.legacy-archive__note {
  color: var(--hf-color-text-muted);
}
.legacy-archive__error {
  color: var(--hf-color-text-danger);
}
.legacy-archive__wrap {
  overflow-x: auto;
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-card-radius);
  background: var(--hf-color-surface);
}
.legacy-archive__wrap:focus-visible {
  box-shadow: var(--hf-focus-indicator);
  outline-offset: 2px;
}
table {
  width: 100%;
  border-collapse: collapse;
}
th,
td {
  padding: var(--hf-space-3);
  border-bottom: 1px solid var(--hf-color-border);
  text-align: left;
  font-variant-numeric: tabular-nums;
}
thead th {
  color: var(--hf-color-text-muted);
  font-size: 0.8rem;
}
.legacy-archive__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-3);
}
</style>
