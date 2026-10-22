<script setup lang="ts">
import FinanceMoney from '../finance/FinanceMoney.vue';

defineOptions({ name: 'UiAmountHero' });

defineProps<{
  label: string;
  amountMinor: string;
  note?: string | undefined;
  /** Test id for the amount itself, so selectors read the sum without the label. */
  amountTestId?: string | undefined;
}>();
</script>

<template>
  <div class="ui-amount-hero">
    <div class="ui-amount-hero__main">
      <p class="ui-amount-hero__label">{{ label }}</p>
      <p class="ui-amount-hero__amount" :data-testid="amountTestId">
        <FinanceMoney :minor-units="amountMinor" currency="RUB" :scale="2" />
      </p>
      <p v-if="note" class="ui-amount-hero__note">{{ note }}</p>
    </div>
    <div v-if="$slots.aside" class="ui-amount-hero__aside"><slot name="aside" /></div>
  </div>
</template>

<style scoped>
.ui-amount-hero {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--hf-space-3);
  padding: var(--hf-space-5);
  border-radius: var(--hf-radius-md);
  background: var(--hf-color-surface-subtle);
}

.ui-amount-hero__label,
.ui-amount-hero__note {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}

.ui-amount-hero__amount {
  margin: var(--hf-space-1) 0;
  font-size: clamp(1.75rem, 3vw, 2.25rem);
  font-weight: var(--hf-font-weight-semibold);
  line-height: 1.15;
  font-variant-numeric: tabular-nums;
}
</style>
