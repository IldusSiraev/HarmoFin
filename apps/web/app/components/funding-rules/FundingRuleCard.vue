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
  props.card.type === 'SUGGESTED_FIXED' ? 'Предложить, ₽' : 'Сумма, ₽',
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
        <div class="rule-card__identity">
          <h3 class="rule-card__name">{{ card.name }}</h3>
          <p v-if="incomeLabel" class="rule-card__badge" :data-testid="`rule-income-${id}`">
            <Wallet :size="14" aria-hidden="true" />
            {{ incomeLabel }}
          </p>
          <p v-if="card.type === ''" class="rule-card__muted">Правило не задано</p>
        </div>
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
          tooltip="Больше нуля, до двух знаков после запятой."
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
          label="Процент, %"
          inputmode="decimal"
          tooltip="От 0 до 100, до двух знаков после запятой."
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
  box-shadow: none;
}

.rule-card__body {
  display: grid;
  gap: var(--hf-space-3);
  min-width: 0;
}

/* Desktop queue row: every card uses the same columns, so the type select and
   the amount line up from card to card. */
@media (min-width: 1024px) {
  .rule-card:not(.rule-card--outside) .rule-card__body {
    grid-template-columns: minmax(0, 1fr) 19rem 10rem auto;
    gap: var(--hf-space-4);
    align-items: start;
  }

  .rule-card:not(.rule-card--outside) .rule-card__head {
    align-self: center;
  }

  .rule-card:not(.rule-card--outside) .rule-card__fields {
    display: contents;
  }

  .rule-card:not(.rule-card--outside) .rule-card__fields > :first-child {
    grid-column: 2;
  }

  .rule-card:not(.rule-card--outside) .rule-card__fields > :nth-child(2) {
    grid-column: 3;
  }

  .rule-card:not(.rule-card--outside) .rule-card__moves {
    grid-column: 4;
    align-self: end;
    min-height: var(--hf-control-height-md);
    align-items: center;
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
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  min-width: 2rem;
  min-height: 44px;
  margin-left: calc(var(--hf-space-2) * -1);
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
  width: 1.5rem;
  height: 1.5rem;
  border-radius: 999px;
  background: var(--hf-color-slate-900);
  color: var(--hf-color-slate-50);
  font-size: var(--hf-font-size-caption);
  font-variant-numeric: tabular-nums;
  font-weight: var(--hf-font-weight-semibold);
}

.rule-card__identity {
  display: grid;
  gap: var(--hf-space-1);
  justify-items: start;
  min-width: 0;
}

.rule-card__name {
  margin: 0;
  color: var(--hf-color-text);
  font-size: var(--hf-font-size-body);
  font-weight: var(--hf-font-weight-semibold);
  line-height: 1.3;
  overflow-wrap: anywhere;
}

.rule-card__moves {
  display: flex;
  gap: var(--hf-space-1);
}

.rule-card__moves :deep(.ui-button) {
  color: var(--hf-color-text-muted);
}

.rule-card__moves :deep(.ui-button:disabled) {
  opacity: 0.35;
}

.rule-card__badge {
  display: inline-flex;
  align-items: center;
  gap: var(--hf-space-1);
  margin: 0;
  padding: 0.125rem var(--hf-space-2);
  border-radius: var(--hf-radius-sm);
  background: var(--hf-color-primary-soft);
  color: var(--hf-color-primary-strong);
  font-size: var(--hf-font-size-caption);
  font-weight: var(--hf-font-weight-medium);
}

.rule-card__fields > * {
  width: 100%;
  min-width: 0;
}

.rule-card__fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
  gap: var(--hf-space-3);
  align-items: start;
}

.rule-card__muted {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
}
</style>
