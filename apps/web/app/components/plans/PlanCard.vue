<script setup lang="ts">
import type { RegularPlanDto } from '../../composables/useBudgetReferenceData.js';
import FinanceMoney from '../finance/FinanceMoney.vue';
import UiButton from '../ui/Button.vue';

defineProps<{ plan: RegularPlanDto; pending?: boolean }>();
defineEmits<{ edit: []; disable: []; remove: [] }>();
</script>

<template>
  <article class="plan-card">
    <div>
      <p class="plan-card__type">
        {{
          plan.planType === 'INCOME'
            ? 'Доход'
            : plan.planType === 'EXPENSE'
              ? 'Расход'
              : 'Накопление'
        }}
      </p>
      <h2>{{ plan.name }}</h2>
      <p>
        {{
          plan.recurrence === 'ONE_TIME'
            ? 'Один раз'
            : plan.recurrence === 'MONTHLY'
              ? 'Ежемесячно'
              : plan.recurrence === 'YEARLY'
                ? 'Ежегодно'
                : `Раз в ${plan.intervalMonths} мес.`
        }}
      </p>
    </div>
    <FinanceMoney :minor-units="plan.amountMinor" currency="RUB" :scale="2" />
    <p class="plan-card__state">{{ plan.isActive ? 'Активен' : 'Отключён' }}</p>
    <div class="plan-card__actions">
      <UiButton variant="secondary" :disabled="pending" @click="$emit('edit')">Изменить</UiButton>
      <UiButton
        v-if="plan.isActive"
        variant="tertiary"
        :disabled="pending"
        @click="$emit('disable')"
        >Отключить</UiButton
      >
      <UiButton variant="tertiary" :disabled="pending" @click="$emit('remove')">Удалить</UiButton>
    </div>
  </article>
</template>

<style scoped>
.plan-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--hf-space-3);
  padding: var(--hf-card-padding);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-card);
}
.plan-card h2,
.plan-card p {
  margin: 0;
}
.plan-card__type {
  color: var(--hf-color-action-primary-hover);
  font-size: 0.75rem;
  font-weight: var(--hf-font-weight-bold);
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
.plan-card__state {
  color: var(--hf-color-text-muted);
}
.plan-card__actions {
  display: flex;
  flex-wrap: wrap;
  grid-column: 1 / -1;
  gap: var(--hf-space-2);
}
@media (max-width: 47.9375rem) {
  .plan-card {
    grid-template-columns: 1fr;
  }
}
</style>
