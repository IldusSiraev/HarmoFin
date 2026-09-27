<script setup lang="ts">
import { computed } from 'vue';

import FinanceMoney from '../finance/FinanceMoney.vue';
import { formatMinorUnits } from '../finance/money-format.js';
import UiButton from '../ui/Button.vue';
import UiDrawer from '../ui/Drawer.vue';
import UiInfoTooltip from '../ui/InfoTooltip.vue';
import UiProgress from '../ui/Progress.vue';
import UiSkeleton from '../ui/Skeleton.vue';
import UiStatus from '../ui/Status.vue';
import type {
  EnvelopeBalanceSummaryDto,
  EnvelopeDto,
  EnvelopeReallocationSummaryDto,
} from '../../composables/useBudgetReferenceData.js';

defineOptions({ name: 'EnvelopeDrawer' });

const props = defineProps<{
  envelope: EnvelopeDto | null;
  balanceSummary?: EnvelopeBalanceSummaryDto | null;
  balanceSummaryLoading?: boolean;
  balanceSummaryError?: string;
}>();

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

const currency = computed(() => props.envelope?.currency ?? 'RUB');

const scale = computed(() => props.envelope?.scale ?? 2);

function money(minor: string): string {
  return formatMinorUnits(minor, currency.value, scale.value);
}

function signedMoney(minor: string): string {
  const value = BigInt(minor);
  if (value === 0n) return money('0');
  const text = money(value < 0n ? (-value).toString() : value.toString());
  return `${value > 0n ? '+' : '−'}${text}`;
}

const movementsNet = computed<string | null>(() => {
  const summary = props.balanceSummary;
  if (!summary) return null;
  const net = BigInt(summary.envelopeTransfersNetMinor) + BigInt(summary.reallocationsNetMinor);
  return net.toString();
});

function reallocationAmount(row: EnvelopeReallocationSummaryDto): string {
  const text = money(row.amountMinor);
  return row.direction === 'OUT' ? `−${text}` : `+${text}`;
}
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

      <template v-if="balanceSummary">
        <section class="envelope-drawer__breakdown" data-testid="envelope-drawer-breakdown">
          <h3 class="envelope-drawer__section-title">Откуда остаток</h3>
          <dl class="envelope-drawer__breakdown-rows">
            <div>
              <dt>Начальный остаток</dt>
              <dd>{{ money(balanceSummary.startingBalanceMinor) }}</dd>
            </div>
            <div>
              <dt>Добавили доходы</dt>
              <dd class="envelope-drawer__positive">
                {{ signedMoney(balanceSummary.incomeAllocatedMinor) }}
              </dd>
            </div>
            <div>
              <dt>Потратили на расходы</dt>
              <dd class="envelope-drawer__negative">
                {{ signedMoney(`-${balanceSummary.expensesMinor}`) }}
              </dd>
            </div>
            <div>
              <dt>
                Движения между конвертами
                <UiInfoTooltip
                  text="Все операции, где деньги ушли из других конвертов или пришли в другие. Пришедшие суммы — со знаком плюс, ушедшие — с минусом."
                />
              </dt>
              <dd>
                {{ movementsNet !== null ? signedMoney(movementsNet) : '' }}
              </dd>
            </div>
            <div class="envelope-drawer__bottom-row">
              <dt>Текущий остаток</dt>
              <dd>{{ money(balanceSummary.currentBalanceMinor) }}</dd>
            </div>
          </dl>
        </section>

        <section class="envelope-drawer__reallocations" data-testid="envelope-drawer-reallocations">
          <h3 class="envelope-drawer__section-title">Переносы между конвертами</h3>
          <ul
            v-if="balanceSummary.reallocations.length > 0"
            class="envelope-drawer__reallocation-list"
          >
            <li v-for="row in balanceSummary.reallocations" :key="row.reallocationId">
              <span data-testid="reallocation-amount">{{ reallocationAmount(row) }}</span>
              <span v-if="row.direction === 'OUT'"
                >в «{{ row.otherEnvelopeName ?? 'конверт' }}»</span
              >
              <span v-else>из «{{ row.otherEnvelopeName ?? 'конверт' }}»</span>
              <time :datetime="row.occurredOn">{{ row.occurredOn }}</time>
            </li>
          </ul>
          <p
            v-else
            class="envelope-drawer__empty"
            data-testid="envelope-drawer-reallocations-empty"
          >
            Переносов пока не было.
          </p>
        </section>
      </template>

      <UiSkeleton v-else-if="balanceSummaryLoading" :count="3" />

      <p
        v-else-if="balanceSummaryError"
        class="envelope-drawer__error"
        data-testid="envelope-drawer-summary-error"
      >
        {{ balanceSummaryError }}
      </p>
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

.envelope-drawer__section-title {
  margin: 0 0 var(--hf-space-2);
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
  font-weight: var(--hf-font-weight-semibold);
}

.envelope-drawer__breakdown-rows {
  display: grid;
  gap: var(--hf-space-2);
  margin: 0;
}

.envelope-drawer__breakdown-rows > div {
  display: flex;
  gap: var(--hf-space-3);
  justify-content: space-between;
}

.envelope-drawer__breakdown-rows dt {
  color: var(--hf-color-text-muted);
}

.envelope-drawer__breakdown-rows dd {
  margin: 0;
  text-align: right;
}

.envelope-drawer__positive {
  color: var(--hf-color-text-muted);
}

.envelope-drawer__negative {
  color: var(--hf-color-text-danger);
}

.envelope-drawer__bottom-row {
  margin-top: var(--hf-space-2);
  padding-top: var(--hf-space-2);
  border-top: 1px solid var(--hf-color-border);
}

.envelope-drawer__bottom-row dt,
.envelope-drawer__bottom-row dd {
  font-weight: var(--hf-font-weight-semibold);
}

.envelope-drawer__reallocation-list {
  display: grid;
  gap: var(--hf-space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.envelope-drawer__reallocation-list li {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-2);
  align-items: baseline;
}

.envelope-drawer__reallocation-list [data-testid='reallocation-amount'] {
  font-weight: var(--hf-font-weight-medium);
  color: var(--hf-color-text);
}

.envelope-drawer__reallocation-list time {
  margin-left: auto;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
}

.envelope-drawer__empty,
.envelope-drawer__error {
  margin: 0;
  color: var(--hf-color-text-muted);
}
</style>
