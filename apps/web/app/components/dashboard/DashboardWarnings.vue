<script setup lang="ts">
import { computed } from 'vue';

import UiAttentionRow from '../ui/AttentionRow.vue';
import { formatMoneyText } from '../envelopes/envelope-plan-kind.js';
import type { DashboardV2Response } from '../../composables/useEnvelopePlanV2.js';

defineOptions({ name: 'DashboardWarnings' });

type V2Warning = DashboardV2Response['warnings'][number];
type Row = {
  key: string;
  code: V2Warning['code'] | 'FREE_MONEY';
  tone: 'info' | 'warning' | 'danger';
  title: string;
  description: string;
  actionLabel: string;
  actionTo?: string;
};

// Server texts and paths; the page decides what "assign" opens.
const props = defineProps<{
  v2Warnings: ReadonlyArray<V2Warning>;
  freeToAssignMinor: string;
}>();
const emit = defineEmits<{ assign: [] }>();

const rows = computed<Row[]>(() => {
  const list: Row[] = [];
  props.v2Warnings.forEach((warning, index) => {
    const key = `${warning.code}-${warning.periodId ?? warning.envelopeId ?? index}`;
    if (warning.code === 'MANDATORY_GAP') {
      // A missing level means the current period is affected: treat it as ALERT.
      const info = warning.level === 'INFO';
      list.push({
        key,
        code: warning.code,
        tone: info ? 'info' : 'warning',
        title: info ? 'Заложите на следующий период' : 'Не хватает на обязательные платежи',
        description: warning.message,
        actionLabel: 'Покрыть',
        actionTo: warning.actionPath,
      });
    } else if (warning.code === 'CASH_SHORTFALL') {
      list.push({
        key,
        code: warning.code,
        tone: 'danger',
        title: 'Не хватает денег на счетах',
        description: warning.message,
        actionLabel: 'Проверить счета',
        actionTo: warning.actionPath,
      });
    }
  });
  const free = props.freeToAssignMinor;
  if (free !== '0' && !free.startsWith('-')) {
    list.push({
      key: 'FREE_MONEY',
      code: 'FREE_MONEY',
      tone: 'info',
      title: 'Есть нераспределённый доход',
      description: `${formatMoneyText(free)} можно направить в конверты`,
      actionLabel: 'Распределить',
    });
  }
  return list;
});
</script>

<template>
  <section
    v-if="rows.length > 0"
    class="dashboard-warnings"
    data-testid="dashboard-warnings"
    aria-labelledby="dashboard-warnings-title"
  >
    <h2 id="dashboard-warnings-title" class="dashboard-warnings__title">Требует внимания</h2>
    <ul class="dashboard-warnings__list">
      <li
        v-for="row in rows"
        :key="row.key"
        class="dashboard-warnings__item"
        data-testid="attention-row"
        :data-code="row.code"
      >
        <UiAttentionRow
          plain
          :tone="row.tone"
          :title="row.title"
          :description="row.description"
          :action-label="row.actionLabel"
          :action-to="row.actionTo"
          @action="emit('assign')"
        />
      </li>
    </ul>
  </section>
</template>

<style scoped>
.dashboard-warnings {
  padding: 0 var(--hf-card-padding);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-lg);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-sm);
}

/* Visually hidden, still announced: the rows carry their own titles. */
.dashboard-warnings__title {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.dashboard-warnings__list {
  display: grid;
  grid-template-columns: 1fr;
  margin: 0;
  padding: 0;
  list-style: none;
}

.dashboard-warnings__item + .dashboard-warnings__item {
  border-top: 1px solid var(--hf-color-border);
}

@media (min-width: 1024px) {
  .dashboard-warnings__list {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    column-gap: var(--hf-space-5);
  }

  .dashboard-warnings__item + .dashboard-warnings__item {
    border-top: 0;
  }

  .dashboard-warnings__item:nth-child(even) {
    padding-left: var(--hf-space-5);
    border-left: 1px solid var(--hf-color-border);
  }

  .dashboard-warnings__item:nth-child(n + 3) {
    border-top: 1px solid var(--hf-color-border);
  }

  /* A row without a pair (the only one or the last of an odd count) takes the full width. */
  .dashboard-warnings__item:last-child:nth-child(odd) {
    grid-column: 1 / -1;
  }
}
</style>
