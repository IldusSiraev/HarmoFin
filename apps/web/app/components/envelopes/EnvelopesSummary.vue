<script setup lang="ts">
import { computed } from 'vue';
import { CircleCheck } from '@lucide/vue';

import FinanceMoney from '../finance/FinanceMoney.vue';
import UiAttentionRow from '../ui/AttentionRow.vue';
import UiCard from '../ui/Card.vue';
import type { DashboardV2Response } from '../../composables/useEnvelopePlanV2.js';
import { formatDayMonth, formatMoneyText } from './envelope-plan-kind.js';

defineOptions({ name: 'EnvelopesSummary' });

// Money summary of the envelopes page. Every amount is a server minor-units
// string shown as is: nothing is added, subtracted or compared numerically here.
const props = withDefaults(
  defineProps<{ dashboard: DashboardV2Response; canManage?: boolean }>(),
  { canManage: true },
);
const emit = defineEmits<{ distribute: [] }>();

type Warning = DashboardV2Response['warnings'][number];

function isPositive(value: string): boolean {
  return /[1-9]/.test(value) && !value.startsWith('-');
}

function warningFor(code: Warning['code']): Warning | null {
  const warning = props.dashboard.warnings.find((item) => item.code === code);
  return warning && isPositive(warning.amountMinor) ? warning : null;
}

const spendableMinor = computed(() =>
  props.dashboard.spendable.state === 'READY' ? props.dashboard.spendable.amountMinor : null,
);
const periodEnd = computed(() => formatDayMonth(props.dashboard.period.end));
const showsFree = computed(() => isPositive(props.dashboard.freeToAssignMinor));
const gap = computed(() => warningFor('MANDATORY_GAP'));
const shortfall = computed(() => warningFor('CASH_SHORTFALL'));
const hasAttention = computed(
  () => showsFree.value || gap.value !== null || shortfall.value !== null,
);
</script>

<template>
  <UiCard as="section" class="envelopes-summary" aria-label="Сводка по конвертам">
    <div class="envelopes-summary__grid">
      <div class="envelopes-summary__zone envelopes-summary__spend">
        <p class="envelopes-summary__label">Можно потратить</p>
        <template v-if="spendableMinor !== null">
          <FinanceMoney
            class="envelopes-summary__hero"
            :minor-units="spendableMinor"
            currency="RUB"
            :scale="2"
          />
          <p class="envelopes-summary__note">Остаток текущего периода · до {{ periodEnd }}</p>
        </template>
        <template v-else>
          <p class="envelopes-summary__setup-text">Лимит на период не настроен</p>
          <NuxtLink to="/app" class="envelopes-summary__setup-link" data-testid="summary-setup">
            Настроить
          </NuxtLink>
        </template>
      </div>

      <div class="envelopes-summary__zone envelopes-summary__protected">
        <dl class="envelopes-summary__list">
          <div class="envelopes-summary__pair">
            <dt>Отложено на обязательные</dt>
            <dd>
              <FinanceMoney
                :minor-units="dashboard.mandatoryBalanceMinor"
                currency="RUB"
                :scale="2"
              />
            </dd>
          </div>
          <div class="envelopes-summary__pair">
            <dt>Отложено на накопления</dt>
            <dd>
              <FinanceMoney
                :minor-units="dashboard.otherProtectedMinor"
                currency="RUB"
                :scale="2"
              />
            </dd>
          </div>
          <div class="envelopes-summary__pair">
            <dt>На счетах</dt>
            <dd>
              <FinanceMoney :minor-units="dashboard.cashMinor" currency="RUB" :scale="2" />
            </dd>
          </div>
        </dl>
      </div>

      <div class="envelopes-summary__attention">
        <UiAttentionRow
          v-if="showsFree"
          plain
          data-testid="summary-free"
          tone="info"
          :title="`Не распределено · ${formatMoneyText(dashboard.freeToAssignMinor)}`"
          description="Доход ещё не разложен по конвертам"
          :action-label="canManage ? 'Распределить' : undefined"
          @action="emit('distribute')"
        />
        <UiAttentionRow
          v-if="gap"
          plain
          data-testid="summary-gap"
          :tone="gap.level === 'ALERT' ? 'warning' : 'info'"
          :title="`Не хватает на обязательные · ${formatMoneyText(gap.amountMinor)}`"
          :description="
            gap.level === 'ALERT' ? gap.message : 'На следующий период — можно отложить заранее'
          "
          action-label="Покрыть"
          :action-to="gap.actionPath"
        />
        <UiAttentionRow
          v-if="shortfall"
          plain
          data-testid="summary-shortfall"
          tone="danger"
          :title="`Не хватает денег на счетах · ${formatMoneyText(shortfall.amountMinor)}`"
          description="Отложено больше, чем есть на счетах"
          action-label="Разобраться"
          :action-to="shortfall.actionPath"
        />
        <p v-if="!hasAttention" class="envelopes-summary__calm" data-testid="summary-calm">
          <CircleCheck class="envelopes-summary__calm-icon" :size="18" aria-hidden="true" />
          Всё распределено
        </p>
      </div>
    </div>
  </UiCard>
</template>

<style scoped>
.envelopes-summary :deep(.ui-card__content) {
  padding: 0;
}

.envelopes-summary__grid {
  display: grid;
}

.envelopes-summary__zone {
  display: grid;
  container-type: inline-size;
  gap: var(--hf-space-2);
  align-content: start;
  min-width: 0;
  padding: var(--hf-space-6);
}

.envelopes-summary__zone + .envelopes-summary__zone,
.envelopes-summary__attention {
  border-top: 1px solid var(--hf-color-border);
}

@media (width >= 1024px) {
  .envelopes-summary__grid {
    grid-template-columns: minmax(0, 1fr) minmax(0, 0.75fr) minmax(0, 1.65fr);
  }

  .envelopes-summary__zone + .envelopes-summary__zone,
  .envelopes-summary__attention {
    border-top: 0;
    border-left: 1px solid var(--hf-color-border);
  }

  .envelopes-summary__spend {
    align-content: center;
  }
}

.envelopes-summary__label {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}

.envelopes-summary__hero {
  color: var(--hf-color-text);
  /* Follows the zone width, so the amount never runs into the next zone. */
  font-size: clamp(1.75rem, 13cqi, 3rem);
  font-weight: var(--hf-font-weight-semibold);
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
  white-space: nowrap;
}

.envelopes-summary__note,
.envelopes-summary__setup-text {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
  line-height: var(--hf-line-height-caption);
}

.envelopes-summary__setup-text {
  color: var(--hf-color-text);
  font-size: inherit;
  font-weight: var(--hf-font-weight-semibold);
}

.envelopes-summary__setup-link {
  display: inline-flex;
  align-items: center;
  justify-self: start;
  min-height: 2.75rem;
  color: var(--hf-color-action-primary-text);
  font-weight: var(--hf-font-weight-medium);
}

.envelopes-summary__setup-link:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
}

.envelopes-summary__list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
  gap: var(--hf-space-4);
  margin: 0;
}

.envelopes-summary__pair {
  display: grid;
  gap: 0.125rem;
}

.envelopes-summary__pair dt {
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
  line-height: var(--hf-line-height-caption);
}

.envelopes-summary__pair dd {
  margin: 0;
  color: var(--hf-color-text);
  font-size: 1.125rem;
  font-weight: var(--hf-font-weight-semibold);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.envelopes-summary__attention {
  display: grid;
  align-content: center;
  min-width: 0;
  padding: 0 var(--hf-space-6);
}

.envelopes-summary__attention > * + * {
  border-top: 1px solid var(--hf-color-border);
}

.envelopes-summary__calm {
  display: inline-flex;
  gap: var(--hf-space-2);
  align-items: center;
  margin: 0;
  padding: var(--hf-space-6) 0;
  color: var(--hf-color-text-muted);
}

.envelopes-summary__calm-icon {
  flex-shrink: 0;
  color: var(--hf-color-status-success);
}
</style>
