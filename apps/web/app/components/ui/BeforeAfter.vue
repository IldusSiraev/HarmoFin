<script setup lang="ts">
import { ArrowRight } from '@lucide/vue';

import FinanceMoney from '../finance/FinanceMoney.vue';

defineOptions({ name: 'UiBeforeAfter' });

defineProps<{ rows: ReadonlyArray<{ label: string; beforeMinor: string; afterMinor: string }> }>();
</script>

<template>
  <dl class="ui-before-after">
    <div
      v-for="row in rows"
      :key="row.label"
      class="ui-before-after__row"
      data-testid="before-after-row"
    >
      <dt class="ui-before-after__label">{{ row.label }}</dt>
      <dd class="ui-before-after__values">
        <span class="ui-before-after__before">
          <FinanceMoney :minor-units="row.beforeMinor" currency="RUB" :scale="2" />
        </span>
        <ArrowRight :size="16" aria-label="станет" />
        <strong><FinanceMoney :minor-units="row.afterMinor" currency="RUB" :scale="2" /></strong>
      </dd>
    </div>
  </dl>
</template>

<style scoped>
.ui-before-after {
  display: grid;
  margin: 0;
  padding: var(--hf-space-3) var(--hf-space-4);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-md);
  background: var(--hf-color-surface-subtle);
}

.ui-before-after__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--hf-space-2);
  padding: var(--hf-space-2) 0;
}

.ui-before-after__row + .ui-before-after__row {
  border-top: 1px solid var(--hf-color-border);
}

.ui-before-after__label {
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}

.ui-before-after__values {
  display: inline-flex;
  align-items: center;
  gap: var(--hf-space-2);
  margin: 0;
  font-variant-numeric: tabular-nums;
}

.ui-before-after__before {
  color: var(--hf-color-text-muted);
}
</style>
