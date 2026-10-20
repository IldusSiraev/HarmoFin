<script setup lang="ts">
import { computed } from 'vue';
import { AlertTriangle, ChevronDown, ChevronUp, GripVertical, Wallet } from '@lucide/vue';

import UiButton from '../ui/Button.vue';
import UiCard from '../ui/Card.vue';
import UiInfoTooltip from '../ui/InfoTooltip.vue';
import type { FundingRuleType } from '../../composables/useEnvelopePlanV2.js';
import { RULE_TYPE_HINTS, RULE_TYPE_LABELS, ruleTypeOptions } from './funding-rule-text.js';
import type { RuleCard, RuleField } from './rules-editor-state.js';

defineOptions({ name: 'FundingRuleCard' });

const props = defineProps<{
  card: RuleCard;
  /** 1-based queue position; null outside the queue. */
  position: number | null;
  incomeLabel: string | null;
  errors: Partial<Record<RuleField, string>>;
  canMoveUp: boolean;
  canMoveDown: boolean;
  dragging: boolean;
  /** Locks every control while the page is saving. */
  disabled?: boolean;
}>();
const emit = defineEmits<{
  type: [value: FundingRuleType | ''];
  fixed: [value: string];
  percent: [value: string];
  up: [];
  down: [];
  grab: [event: PointerEvent];
}>();

const id = computed(() => props.card.envelopeId);
const options = computed(() => ruleTypeOptions(props.card.envelopeType));
const typeHint = computed(() =>
  props.card.type === ''
    ? 'Тип определяет, как сервер предлагает сумму.'
    : RULE_TYPE_HINTS[props.card.type],
);
const showsFixed = computed(
  () => props.card.type === 'FIXED_PER_PERIOD' || props.card.type === 'SUGGESTED_FIXED',
);
const fixedLabel = computed(() =>
  props.card.type === 'SUGGESTED_FIXED' ? 'Предлагаемая сумма, ₽' : 'Сумма на период, ₽',
);
</script>

<template>
  <UiCard
    as="article"
    class="rule-card"
    :class="{ 'rule-card--dragging': dragging }"
    :data-testid="`rule-card-${id}`"
    :aria-label="position === null ? card.name : `${position}. ${card.name}`"
  >
    <div class="rule-card__head">
      <span
        v-if="position !== null"
        class="rule-card__handle"
        aria-hidden="true"
        :data-testid="`rule-handle-${id}`"
        @pointerdown="!disabled && emit('grab', $event)"
      >
        <GripVertical :size="20" />
      </span>
      <span v-if="position !== null" class="rule-card__position">{{ position }}</span>
      <h3 class="rule-card__name">{{ card.name }}</h3>
      <div v-if="position !== null" class="rule-card__moves">
        <UiButton
          variant="tertiary"
          size="sm"
          :aria-label="`Переместить выше: ${card.name}`"
          tooltip="Выше"
          :disabled="disabled || !canMoveUp"
          :data-testid="`rule-up-${id}`"
          @click="emit('up')"
        >
          <ChevronUp :size="18" aria-hidden="true" />
        </UiButton>
        <UiButton
          variant="tertiary"
          size="sm"
          :aria-label="`Переместить ниже: ${card.name}`"
          tooltip="Ниже"
          :disabled="disabled || !canMoveDown"
          :data-testid="`rule-down-${id}`"
          @click="emit('down')"
        >
          <ChevronDown :size="18" aria-hidden="true" />
        </UiButton>
      </div>
    </div>

    <p v-if="incomeLabel" class="rule-card__badge" :data-testid="`rule-income-${id}`">
      <Wallet :size="14" aria-hidden="true" />
      {{ incomeLabel }}
    </p>
    <p v-if="card.type === ''" class="rule-card__muted">Правило не задано</p>

    <div class="rule-card__field">
      <span class="rule-card__label">
        <label :for="`rule-type-${id}`">Тип правила</label>
        <UiInfoTooltip :text="typeHint" :label="`Подсказка: тип правила, ${card.name}`" />
      </span>
      <select
        :id="`rule-type-${id}`"
        class="rule-card__input"
        :data-testid="`rule-type-${id}`"
        :disabled="disabled"
        :value="card.type"
        :aria-invalid="errors.type ? 'true' : undefined"
        :aria-describedby="errors.type ? `rule-type-error-${id}` : undefined"
        @change="emit('type', ($event.target as HTMLSelectElement).value as FundingRuleType | '')"
      >
        <option value="" disabled>Выберите тип</option>
        <option v-for="value in options" :key="value" :value="value">
          {{ RULE_TYPE_LABELS[value] }}
        </option>
      </select>
      <p v-if="errors.type" :id="`rule-type-error-${id}`" class="rule-card__error">
        <AlertTriangle :size="14" aria-hidden="true" />
        {{ errors.type }}
      </p>
    </div>

    <div v-if="showsFixed" class="rule-card__field">
      <label class="rule-card__label" :for="`rule-fixed-${id}`">{{ fixedLabel }}</label>
      <input
        :id="`rule-fixed-${id}`"
        class="rule-card__input"
        type="text"
        inputmode="decimal"
        autocomplete="off"
        :data-testid="`rule-fixed-${id}`"
        :disabled="disabled"
        :value="card.fixed"
        :aria-invalid="errors.fixedAmount ? 'true' : undefined"
        :aria-describedby="`rule-fixed-hint-${id}${errors.fixedAmount ? ` rule-fixed-error-${id}` : ''}`"
        @input="emit('fixed', ($event.target as HTMLInputElement).value)"
      />
      <p :id="`rule-fixed-hint-${id}`" class="rule-card__muted">
        Сумма больше нуля, не более двух знаков после запятой.
      </p>
      <p v-if="errors.fixedAmount" :id="`rule-fixed-error-${id}`" class="rule-card__error">
        <AlertTriangle :size="14" aria-hidden="true" />
        {{ errors.fixedAmount }}
      </p>
    </div>

    <div v-if="card.type === 'PERCENT_OF_INCOME'" class="rule-card__field">
      <label class="rule-card__label" :for="`rule-percent-${id}`">Процент от дохода, %</label>
      <input
        :id="`rule-percent-${id}`"
        class="rule-card__input"
        type="text"
        inputmode="decimal"
        autocomplete="off"
        :data-testid="`rule-percent-${id}`"
        :disabled="disabled"
        :value="card.percent"
        :aria-invalid="errors.percentBasisPoints ? 'true' : undefined"
        :aria-describedby="`rule-percent-hint-${id}${errors.percentBasisPoints ? ` rule-percent-error-${id}` : ''}`"
        @input="emit('percent', ($event.target as HTMLInputElement).value)"
      />
      <p :id="`rule-percent-hint-${id}`" class="rule-card__muted">
        Значение от 0 до 100, не более двух знаков после запятой.
      </p>
      <p v-if="errors.percentBasisPoints" :id="`rule-percent-error-${id}`" class="rule-card__error">
        <AlertTriangle :size="14" aria-hidden="true" />
        {{ errors.percentBasisPoints }}
      </p>
    </div>
  </UiCard>
</template>

<style scoped>
.rule-card {
  display: grid;
  gap: var(--hf-space-3);
  min-width: 0;
}

.rule-card--dragging {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
}

.rule-card__head {
  display: flex;
  align-items: center;
  gap: var(--hf-space-2);
  min-width: 0;
}

.rule-card__handle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  min-height: 44px;
  color: var(--hf-color-text-subtle);
  cursor: grab;
  touch-action: none;
}

.rule-card--dragging .rule-card__handle {
  cursor: grabbing;
}

.rule-card__position {
  font-variant-numeric: tabular-nums;
  font-weight: var(--hf-font-weight-semibold);
  color: var(--hf-color-text-muted);
}

.rule-card__name {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  font-size: var(--hf-font-size-h3);
  line-height: var(--hf-line-height-h3);
  overflow-wrap: anywhere;
}

.rule-card__moves {
  display: flex;
  gap: var(--hf-space-1);
}

.rule-card__badge {
  display: inline-flex;
  align-items: center;
  gap: var(--hf-space-1);
  width: fit-content;
  margin: 0;
  padding: var(--hf-space-1) var(--hf-space-2);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-sm);
  background: var(--hf-color-surface-subtle);
  font-size: var(--hf-font-size-small);
}

.rule-card__field {
  display: grid;
  gap: var(--hf-space-1);
  font-size: var(--hf-font-size-small);
}

.rule-card__label {
  display: inline-flex;
  align-items: center;
  gap: var(--hf-space-1);
}

.rule-card__input {
  min-width: 0;
  min-height: 44px;
  padding: 0 var(--hf-space-3);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-control-radius);
  background: var(--hf-color-surface);
  color: var(--hf-color-text);
  font: inherit;
  font-variant-numeric: tabular-nums;
}

.rule-card__input:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
}

.rule-card__input[aria-invalid='true'] {
  border-color: var(--hf-color-border-danger);
}

.rule-card__muted {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}

.rule-card__error {
  display: flex;
  align-items: center;
  gap: var(--hf-space-1);
  margin: 0;
  color: var(--hf-color-text-danger);
  font-size: var(--hf-font-size-small);
}
</style>
