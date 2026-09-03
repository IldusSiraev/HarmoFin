<script setup lang="ts">
import { formatMinorUnits } from './money-format.js';

defineOptions({ name: 'FinanceMoney' });

const props = defineProps<{
  minorUnits: string | bigint;
  currency: string;
  scale: number;
  locale?: string | undefined;
}>();

function getFormattedValue() {
  try {
    return formatMinorUnits(props.minorUnits, props.currency, props.scale, props.locale);
  } catch {
    return '—';
  }
}
</script>

<template>
  <span class="finance-money">{{ getFormattedValue() }}</span>
</template>

<style scoped>
.finance-money {
  font-variant-numeric: tabular-nums;
}
</style>
