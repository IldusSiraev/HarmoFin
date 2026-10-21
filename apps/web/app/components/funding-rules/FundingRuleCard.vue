<script setup lang="ts">
import { computed } from 'vue';
import { ChevronDown, ChevronUp, GripVertical, Wallet } from '@lucide/vue';

import FinanceMoneyInput from '../finance/FinanceMoneyInput.vue';
import EnvelopeTypeIcon from '../envelopes/EnvelopeTypeIcon.vue';
import UiButton from '../ui/Button.vue';
import UiCard from '../ui/Card.vue';
import UiInput from '../ui/Input.vue';
import UiSelect from '../ui/Select.vue';
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
const options = computed(() =>
  ruleTypeOptions(props.card.envelopeType).map((value) => ({
    value,
    label: RULE_TYPE_LABELS[value],
  })),
);
const typeHint = computed(() =>
  props.card.type === ''
    ? 'Тип определяет, какую сумму приложение предложит отложить в этот конверт.'
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
    :class="{ 'rule-card--dragging': dragging, 'rule-card--outside': position === null }"
    :data-testid="`rule-card-${id}`"
    :aria-label="position === null ? card.name : `${position}. ${card.name}`"
  >
    <div class="rule-card__body">
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
        <EnvelopeTypeIcon :envelope-type="card.envelopeType" size="sm" />
        <h3 class="rule-card__name">{{ card.name }}</h3>
      </div>

      <div v-if="incomeLabel || card.type === ''" class="rule-card__meta">
        <p v-if="incomeLabel" class="rule-card__badge" :data-testid="`rule-income-${id}`">
          <Wallet :size="14" aria-hidden="true" />
          {{ incomeLabel }}
        </p>
        <p v-if="card.type === ''" class="rule-card__muted">Правило не задано</p>
      </div>

      <div class="rule-card__fields">
        <UiSelect
          :id="`rule-type-${id}`"
          :name="`rule-type-${id}`"
          :data-testid="`rule-type-${id}`"
          label="Тип правила"
          placeholder="Выберите тип"
          :tooltip="typeHint"
          :model-value="card.type"
          :options="options"
          :error="errors.type"
          :disabled="disabled"
          @update:model-value="emit('type', $event as FundingRuleType | '')"
        />

        <FinanceMoneyInput
          v-if="showsFixed"
          :id="`rule-fixed-${id}`"
          :name="`rule-fixed-${id}`"
          :data-testid="`rule-fixed-${id}`"
          :label="fixedLabel"
          hint="Больше нуля, до двух знаков после запятой."
          :model-value="card.fixed"
          :error="errors.fixedAmount"
          :disabled="disabled"
          @update:model-value="emit('fixed', $event)"
        />

        <UiInput
          v-if="card.type === 'PERCENT_OF_INCOME'"
          :id="`rule-percent-${id}`"
          :name="`rule-percent-${id}`"
          :data-testid="`rule-percent-${id}`"
          label="Процент от дохода, %"
          inputmode="decimal"
          hint="От 0 до 100, до двух знаков после запятой."
          :model-value="card.percent"
          :error="errors.percentBasisPoints"
          :disabled="disabled"
          @update:model-value="emit('percent', $event)"
        />
      </div>

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
  </UiCard>
</template>

<style scoped>
/* Tooltips and the select list open outside the card, so it must not clip them. */
.rule-card.ui-card {
  overflow: visible;
  min-width: 0;
}

.rule-card--dragging {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
}

.rule-card--outside {
  border-style: dashed;
}

.rule-card__body {
  display: grid;
  gap: var(--hf-space-3);
  min-width: 0;
}

/* Desktop queue row: handle, number, icon, name, select, amount, ↑/↓ on one line. */
@media (min-width: 1024px) {
  .rule-card:not(.rule-card--outside) .rule-card__body {
    display: flex;
    flex-wrap: nowrap;
    align-items: center;
  }

  .rule-card:not(.rule-card--outside) .rule-card__head {
    flex: 0 1 auto;
    min-width: 10rem;
  }

  .rule-card:not(.rule-card--outside) .rule-card__meta {
    flex: 0 0 auto;
  }

  .rule-card:not(.rule-card--outside) .rule-card__fields {
    flex: 1 1 auto;
  }

  .rule-card:not(.rule-card--outside) .rule-card__moves {
    flex: 0 0 auto;
  }
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
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  min-width: 1.5rem;
  height: 1.5rem;
  border-radius: 999px;
  background: var(--hf-color-slate-900);
  color: var(--hf-color-slate-50);
  font-size: var(--hf-font-size-small);
  font-variant-numeric: tabular-nums;
  font-weight: var(--hf-font-weight-semibold);
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

.rule-card__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--hf-space-2);
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

.rule-card__fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
  gap: var(--hf-space-3);
  align-items: start;
}

.rule-card__muted {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}
</style>
