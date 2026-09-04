<script setup lang="ts">
import UiCard from '../ui/Card.vue';
import UiStatus from '../ui/Status.vue';
import FinanceMoney from '../finance/FinanceMoney.vue';
import type { EnvelopeDto } from '../../composables/useBudgetReferenceData.js';

defineOptions({ name: 'EnvelopeCard' });

defineProps<{
  envelope: EnvelopeDto;
}>();

function getEnvelopeTypeLabel(envelopeType: EnvelopeDto['envelopeType']) {
  return {
    CURRENT_EXPENSES: 'Текущие расходы',
    MANDATORY_EXPENSES: 'Обязательные расходы',
    SAVINGS_GOAL: 'Цель накоплений',
    RESERVE: 'Резерв',
    FREE_MONEY: 'Свободные деньги',
    CUSTOM: 'Другое',
  }[envelopeType];
}
</script>

<template>
  <UiCard as="article" class="envelope-card">
    <template #header>
      <div class="envelope-card__header">
        <div>
          <h2 class="envelope-card__title">{{ envelope.name }}</h2>
          <p class="envelope-card__type">{{ getEnvelopeTypeLabel(envelope.envelopeType) }}</p>
        </div>
        <UiStatus
          :label="envelope.archivedAt ? 'В архиве' : 'Активен'"
          :tone="envelope.archivedAt ? 'neutral' : 'success'"
        />
      </div>
    </template>

    <dl class="envelope-card__details">
      <div>
        <dt>Текущий остаток</dt>
        <dd>
          <FinanceMoney
            :minor-units="envelope.currentBalanceMinor"
            :currency="envelope.currency"
            :scale="envelope.scale"
          />
        </dd>
      </div>
      <div>
        <dt>Начальный остаток</dt>
        <dd>
          <FinanceMoney
            :minor-units="envelope.startingBalanceMinor"
            :currency="envelope.currency"
            :scale="envelope.scale"
          />
        </dd>
      </div>
      <div v-if="envelope.monthlyPlannedAmountMinor !== null">
        <dt>План на месяц</dt>
        <dd>
          <FinanceMoney
            :minor-units="envelope.monthlyPlannedAmountMinor"
            :currency="envelope.currency"
            :scale="envelope.scale"
          />
        </dd>
      </div>
      <div v-if="envelope.targetAmountMinor !== null">
        <dt>Целевая сумма</dt>
        <dd>
          <FinanceMoney
            :minor-units="envelope.targetAmountMinor"
            :currency="envelope.currency"
            :scale="envelope.scale"
          />
        </dd>
      </div>
      <div v-if="envelope.targetDate">
        <dt>Дата цели</dt>
        <dd>{{ envelope.targetDate }}</dd>
      </div>
    </dl>

    <p v-if="envelope.comment" class="envelope-card__comment">{{ envelope.comment }}</p>

    <template v-if="$slots.actions" #actions><slot name="actions" /></template>
  </UiCard>
</template>

<style scoped>
.envelope-card__header {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: var(--hf-space-4);
}

.envelope-card__title,
.envelope-card__type,
.envelope-card__comment {
  margin: 0;
}

.envelope-card__title {
  font-size: 1.125rem;
  font-weight: var(--hf-font-weight-semibold);
}

.envelope-card__type,
.envelope-card__comment,
.envelope-card__details dt {
  color: var(--hf-color-text-muted);
}

.envelope-card__type {
  margin-top: var(--hf-space-1);
}

.envelope-card__details {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--hf-space-4);
  margin: 0;
}

.envelope-card__details div {
  display: grid;
  gap: var(--hf-space-1);
}

.envelope-card__details dt {
  font-size: 0.875rem;
}

.envelope-card__details dd {
  margin: 0;
  font-weight: var(--hf-font-weight-medium);
}

.envelope-card__comment {
  margin-top: var(--hf-space-4);
}

@media (max-width: 47.9375rem) {
  .envelope-card__details {
    grid-template-columns: 1fr;
  }
}
</style>
