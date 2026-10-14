<script setup lang="ts">
import { computed, ref } from 'vue';
import { AlertTriangle, Bell, Check, Pencil, Plus, SkipForward, TrendingUp } from '@lucide/vue';

import type { PlansCalendarItem } from '../../composables/useEnvelopePlanV2.js';
import FinanceMoney from '../finance/FinanceMoney.vue';
import { formatPlainDateShort } from '../obligations/format-plain-date.js';
import UiButton from '../ui/Button.vue';

defineOptions({ name: 'PlanItemList' });

const props = withDefaults(
  defineProps<{
    items: PlansCalendarItem[];
    overdue: PlansCalendarItem[];
    today: string;
    mode: 'upcoming' | 'all';
    hasAnyPlans: boolean;
    busy?: boolean;
    linkedId?: string | null;
  }>(),
  { busy: false, linkedId: null },
);

const emit = defineEmits<{
  'update:mode': [mode: 'upcoming' | 'all'];
  pay: [item: PlansCalendarItem];
  skip: [item: PlansCalendarItem];
  'record-income': [item: PlansCalendarItem];
  'edit-plan': [item: PlansCalendarItem];
  'add-plan': [kind: 'obligation' | 'income'];
}>();

const root = ref<HTMLElement | null>(null);

const statusLabel: Record<string, string> = {
  COMPLETED: 'Выполнено',
  SKIPPED: 'Пропущено',
  CANCELLED: 'Отменено',
};

const isOpen = (item: PlansCalendarItem) => item.status === 'PENDING' || item.status === 'DUE';

const shown = computed<PlansCalendarItem[]>(() => {
  if (props.mode === 'upcoming') {
    const overdueIds = new Set(props.overdue.map((item) => item.occurrenceId));
    const rest = props.items.filter(
      (item) =>
        isOpen(item) &&
        !overdueIds.has(item.occurrenceId) &&
        (item.kind === 'INCOME_PLAN' || item.scheduledOn >= props.today),
    );
    return [...props.overdue, ...rest];
  }
  return [...props.items.filter(isOpen), ...props.items.filter((item) => !isOpen(item))];
});
const hasOpenIncome = computed(() =>
  shown.value.some((item) => item.kind === 'INCOME_PLAN' && isOpen(item)),
);

defineExpose({ focus: () => root.value?.focus() });
</script>

<template>
  <section ref="root" class="plan-list" tabindex="-1" data-testid="plans-list" aria-label="Планы">
    <div class="plan-list__modes" role="tablist" aria-label="Показать планы">
      <UiButton
        role="tab"
        size="sm"
        :variant="mode === 'upcoming' ? 'secondary' : 'tertiary'"
        :aria-selected="mode === 'upcoming' ? 'true' : 'false'"
        data-testid="list-mode-upcoming"
        @click="emit('update:mode', 'upcoming')"
      >
        Ближайшие
      </UiButton>
      <UiButton
        role="tab"
        size="sm"
        :variant="mode === 'all' ? 'secondary' : 'tertiary'"
        :aria-selected="mode === 'all' ? 'true' : 'false'"
        data-testid="list-mode-all"
        @click="emit('update:mode', 'all')"
      >
        За месяц
      </UiButton>
    </div>

    <p v-if="hasOpenIncome" class="plan-list__forecast" data-testid="list-forecast">
      <AlertTriangle :size="14" aria-hidden="true" />
      Это прогноз: пока деньги не пришли и вы не записали их как доход, они не входят в «На счетах»
      и не увеличивают «Можно потратить».
    </p>

    <div v-if="shown.length === 0" class="plan-list__empty">
      <template v-if="!hasAnyPlans">
        <p class="obligation-list__empty">Обязательных платежей пока нет.</p>
        <p class="obligation-list__empty">
          Добавьте аренду, коммунальные платежи, кредиты — «Можно потратить» учтёт их заранее.
        </p>
        <UiButton
          variant="secondary"
          data-testid="plan-add-obligation-empty"
          @click="emit('add-plan', 'obligation')"
        >
          Добавить платёж
        </UiButton>
        <p class="obligation-list__empty">Здесь будут ожидаемые поступления.</p>
        <UiButton
          variant="secondary"
          data-testid="plan-add-income-empty"
          @click="emit('add-plan', 'income')"
        >
          Добавить доход
        </UiButton>
      </template>
      <template v-else>
        <p class="obligation-list__empty">
          {{ mode === 'upcoming' ? 'Ближайших планов нет.' : 'На этот месяц планов нет.' }}
        </p>
        <div class="plan-list__empty-actions">
          <UiButton
            variant="secondary"
            data-testid="plan-add-obligation-empty"
            @click="emit('add-plan', 'obligation')"
          >
            Добавить платёж
          </UiButton>
          <UiButton
            variant="secondary"
            data-testid="plan-add-income-empty"
            @click="emit('add-plan', 'income')"
          >
            Добавить доход
          </UiButton>
        </div>
      </template>
    </div>

    <ul v-else class="obligation-list__items">
      <template v-for="item in shown" :key="item.occurrenceId">
        <li
          v-if="item.kind === 'OBLIGATION'"
          :id="`obligation-${item.occurrenceId}`"
          class="obligation-row"
          :class="{ 'obligation-row--linked': linkedId === item.occurrenceId }"
          :aria-current="linkedId === item.occurrenceId ? 'true' : undefined"
          :data-testid="`obligation-row-${item.occurrenceId}`"
        >
          <div class="obligation-row__main">
            <span class="obligation-row__name">{{ item.name }}</span>
            <span
              v-if="linkedId === item.occurrenceId"
              class="obligation-row__linked"
              data-testid="obligation-linked"
            >
              <Bell :size="14" aria-hidden="true" />
              Из уведомления
            </span>
            <span class="obligation-row__meta">{{ formatPlainDateShort(item.scheduledOn) }}</span>
            <span
              v-if="item.overdue"
              class="obligation-row__badge"
              data-testid="obligation-overdue"
            >
              <AlertTriangle :size="14" aria-hidden="true" />
              Просрочено
            </span>
            <span v-if="statusLabel[item.status]" class="obligation-row__meta">
              {{ statusLabel[item.status] }}
            </span>
          </div>
          <div class="obligation-row__amounts">
            <FinanceMoney :minor-units="item.expectedMinor" currency="RUB" :scale="2" />
            <span v-if="item.unpaidMinor !== '0'" class="obligation-row__meta">
              Остаток
              <FinanceMoney :minor-units="item.unpaidMinor" currency="RUB" :scale="2" />
            </span>
          </div>
          <div class="obligation-row__actions">
            <UiButton
              variant="tertiary"
              size="sm"
              class="obligation-row__icon-btn"
              :aria-label="`Изменить план ${item.name}`"
              :title="`Изменить план ${item.name}`"
              :data-testid="`obligation-edit-${item.occurrenceId}`"
              :disabled="busy"
              @click="emit('edit-plan', item)"
            >
              <Pencil :size="16" aria-hidden="true" />
            </UiButton>
            <UiButton
              v-if="isOpen(item)"
              variant="tertiary"
              size="sm"
              class="obligation-row__icon-btn"
              :aria-label="`Оплатить ${item.name}`"
              :title="`Оплатить ${item.name}`"
              :data-testid="`obligation-pay-${item.occurrenceId}`"
              :disabled="busy"
              @click="emit('pay', item)"
            >
              <Check :size="16" aria-hidden="true" />
            </UiButton>
            <UiButton
              v-if="isOpen(item) && item.paidMinor === '0'"
              size="sm"
              variant="tertiary"
              class="obligation-row__icon-btn"
              :aria-label="`Пропустить ${item.name}`"
              :title="`Пропустить ${item.name}`"
              :data-testid="`obligation-skip-${item.occurrenceId}`"
              :disabled="busy"
              @click="emit('skip', item)"
            >
              <SkipForward :size="16" aria-hidden="true" />
            </UiButton>
          </div>
        </li>
        <li v-else class="obligation-row" :data-testid="`income-row-${item.occurrenceId}`">
          <div class="obligation-row__main">
            <span class="obligation-row__name">{{ item.name }}</span>
            <span class="obligation-row__meta">{{ formatPlainDateShort(item.scheduledOn) }}</span>
            <span v-if="isOpen(item)" class="income-row__forecast">
              <TrendingUp :size="14" aria-hidden="true" />
              Прогноз — не входит в «На счетах»
            </span>
            <span v-else class="obligation-row__meta">
              <Check :size="14" aria-hidden="true" />
              Записан
            </span>
          </div>
          <div class="obligation-row__amounts">
            <FinanceMoney :minor-units="item.expectedMinor" currency="RUB" :scale="2" />
          </div>
          <div class="obligation-row__actions">
            <UiButton
              variant="tertiary"
              size="sm"
              class="obligation-row__icon-btn"
              :aria-label="`Изменить план ${item.name}`"
              :title="`Изменить план ${item.name}`"
              :data-testid="`income-edit-${item.occurrenceId}`"
              :disabled="busy"
              @click="emit('edit-plan', item)"
            >
              <Pencil :size="16" aria-hidden="true" />
            </UiButton>
            <UiButton
              v-if="isOpen(item)"
              variant="tertiary"
              size="sm"
              class="obligation-row__icon-btn"
              :aria-label="`Записать доход ${item.name}`"
              :title="`Записать доход ${item.name}`"
              :data-testid="`income-record-${item.occurrenceId}`"
              :disabled="busy"
              @click="emit('record-income', item)"
            >
              <Plus :size="16" aria-hidden="true" />
            </UiButton>
          </div>
        </li>
      </template>
    </ul>
  </section>
</template>

<style scoped>
.plan-list {
  display: grid;
  gap: var(--hf-space-3);
}
.plan-list:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
}
.plan-list__modes {
  display: flex;
  gap: var(--hf-space-2);
}
.plan-list__forecast {
  display: flex;
  align-items: center;
  gap: var(--hf-space-1);
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}
.plan-list__empty {
  display: grid;
  justify-items: start;
  gap: var(--hf-space-2);
}
.plan-list__empty-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-2);
}
.obligation-list__empty {
  margin: 0;
  color: var(--hf-color-text-muted);
}
.obligation-list__items {
  display: grid;
  gap: var(--hf-space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}
.obligation-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--hf-space-3);
  padding: var(--hf-space-3) var(--hf-space-4);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-lg);
  background: var(--hf-color-surface);
}
.obligation-row__linked {
  display: inline-flex;
  align-items: center;
  gap: var(--hf-space-1);
  color: var(--hf-color-action-primary-hover);
  font-size: var(--hf-font-size-small);
  font-weight: var(--hf-font-weight-semibold);
}
.obligation-row--linked {
  border-color: var(--hf-color-action-primary);
  box-shadow: 0 0 0 2px var(--hf-color-action-primary);
}
.obligation-row__main,
.obligation-row__amounts {
  display: grid;
  gap: var(--hf-space-1);
  min-width: 0;
}
.obligation-row__name {
  font-weight: var(--hf-font-weight-medium);
  overflow-wrap: anywhere;
}
.obligation-row__meta {
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}
.obligation-row__badge {
  display: inline-flex;
  align-items: center;
  gap: var(--hf-space-1);
  color: var(--hf-color-text-danger);
  font-size: var(--hf-font-size-small);
  font-weight: var(--hf-font-weight-semibold);
}
.obligation-row__icon-btn {
  min-width: 2.75rem;
  min-height: 2.75rem;
  padding-inline: 0;
}
.income-row__forecast {
  display: inline-flex;
  align-items: center;
  gap: var(--hf-space-1);
  color: var(--hf-color-status-info);
  font-size: var(--hf-font-size-small);
  font-weight: var(--hf-font-weight-medium);
}
.obligation-row__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-2);
}
</style>
