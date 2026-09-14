<script setup lang="ts">
import { computed } from 'vue';

import FinanceMoney from '../finance/FinanceMoney.vue';
import { formatMinorUnits } from '../finance/money-format.js';
import UiButton from '../ui/Button.vue';
import UiDrawer from '../ui/Drawer.vue';
import UiProgress from '../ui/Progress.vue';
import UiStatus from '../ui/Status.vue';
import type { EnvelopeDto } from '../../composables/useBudgetReferenceData.js';

defineOptions({ name: 'EnvelopeDrawer' });

const props = defineProps<{ envelope: EnvelopeDto | null }>();

const emit = defineEmits<{
  close: [];
  edit: [envelope: EnvelopeDto];
  archive: [envelope: EnvelopeDto];
}>();

const TYPE_LABELS = {
  CURRENT_EXPENSES: 'Текущие расходы',
  MANDATORY_EXPENSES: 'Обязательные расходы',
  SAVINGS_GOAL: 'Цели накоплений',
  RESERVE: 'Резерв',
  FREE_MONEY: 'Свободные деньги',
  CUSTOM: 'Другое',
} as const;

const PERIOD_LABELS = { FIRST: 'Первая половина', SECOND: 'Вторая половина' } as const;

const typeLabel = computed(() => (props.envelope ? TYPE_LABELS[props.envelope.envelopeType] : ''));

const periodLabel = computed(() =>
  props.envelope?.periodSlot ? PERIOD_LABELS[props.envelope.periodSlot] : null,
);

const goalLabel = computed(() => {
  const envelope = props.envelope;
  if (!envelope || envelope.targetAmountMinor === null) return '';
  const saved = formatMinorUnits(envelope.currentBalanceMinor, envelope.currency, envelope.scale);
  const total = formatMinorUnits(envelope.targetAmountMinor, envelope.currency, envelope.scale);
  return `${saved} из ${total}`;
});

const operationsLink = computed(() =>
  props.envelope ? `/app/operations?envelopeId=${encodeURIComponent(props.envelope.id)}` : '',
);
</script>

<template>
  <UiDrawer :open="envelope !== null" title="Конверт" @close="emit('close')">
    <div v-if="envelope" class="envelope-drawer">
      <p class="envelope-drawer__amount">
        <FinanceMoney
          :minor-units="envelope.currentBalanceMinor"
          :currency="envelope.currency"
          :scale="envelope.scale"
        />
      </p>
      <UiStatus
        :label="envelope.archivedAt ? 'В архиве' : 'Активен'"
        :tone="envelope.archivedAt ? 'neutral' : 'success'"
      />

      <div v-if="envelope.targetAmountMinor !== null" class="envelope-drawer__goal">
        <UiProgress
          :value="envelope.currentBalanceMinor"
          :max="envelope.targetAmountMinor"
          :label="`Накоплено ${goalLabel}`"
        />
        <p class="envelope-drawer__goal-text">{{ goalLabel }}</p>
      </div>

      <dl class="envelope-drawer__rows">
        <div>
          <dt>Название</dt>
          <dd>{{ envelope.name }}</dd>
        </div>
        <div>
          <dt>Тип</dt>
          <dd>{{ typeLabel }}</dd>
        </div>
        <div v-if="periodLabel">
          <dt>Половина периода</dt>
          <dd>{{ periodLabel }}</dd>
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
        <div v-if="envelope.targetDate">
          <dt>Дата цели</dt>
          <dd>{{ envelope.targetDate }}</dd>
        </div>
        <div>
          <dt>Порядок отображения</dt>
          <dd>{{ envelope.displayOrder }}</dd>
        </div>
        <div v-if="envelope.comment">
          <dt>Комментарий</dt>
          <dd>{{ envelope.comment }}</dd>
        </div>
      </dl>
    </div>

    <template v-if="envelope" #footer>
      <UiButton data-testid="envelope-drawer-edit" @click="emit('edit', envelope)">
        Изменить
      </UiButton>
      <UiButton variant="secondary" data-testid="envelope-drawer-operations" :to="operationsLink">
        Операции конверта
      </UiButton>
      <UiButton
        v-if="!envelope.archivedAt"
        variant="tertiary"
        data-testid="envelope-drawer-archive"
        @click="emit('archive', envelope)"
      >
        Переместить в архив
      </UiButton>
    </template>
  </UiDrawer>
</template>

<style scoped>
.envelope-drawer {
  display: grid;
  gap: var(--hf-space-4);
}

.envelope-drawer__amount {
  margin: 0;
  font-size: var(--hf-font-size-h2);
  font-weight: var(--hf-font-weight-bold);
  line-height: var(--hf-line-height-h2);
}

.envelope-drawer__goal {
  display: grid;
  gap: var(--hf-space-2);
}

.envelope-drawer__goal-text {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
  line-height: var(--hf-line-height-caption);
}

.envelope-drawer__rows {
  display: grid;
  gap: var(--hf-space-2);
  margin: 0;
}

.envelope-drawer__rows div {
  display: flex;
  gap: var(--hf-space-3);
  justify-content: space-between;
}

.envelope-drawer__rows dt {
  color: var(--hf-color-text-muted);
}

.envelope-drawer__rows dd {
  margin: 0;
  text-align: right;
}
</style>
