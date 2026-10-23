<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  AlertOctagon,
  AlertTriangle,
  Archive,
  ArrowDownToLine,
  ArrowLeftRight,
  Calendar,
  Check,
  Pencil,
  ShoppingCart,
} from '@lucide/vue';

import FinanceMoney from '../finance/FinanceMoney.vue';
import UiAmountHero from '../ui/AmountHero.vue';
import UiButton from '../ui/Button.vue';
import UiModal from '../ui/Modal.vue';
import UiSkeleton from '../ui/Skeleton.vue';
import {
  type EnvelopeHistoryItem,
  type EnvelopePlanDto,
  useEnvelopePlanV2,
} from '../../composables/useEnvelopePlanV2.js';
import { v2ErrorMessage } from '../../composables/useV2Error.js';
import {
  type PlanBadge,
  PLAN_SCOPE_LABELS,
  PLAN_SLOT_LABELS,
  decimalToMinor,
  envelopeCaption,
  historyAmountText,
  historySign,
} from './envelope-plan-kind.js';
import { formatPlainDate } from '../obligations/format-plain-date.js';

defineOptions({ name: 'EnvelopePlanDialog' });

// Details of an assignment envelope: what was assigned, spent and moved, with
// dates. Everything is read from the server; cancelled facts are shown only on
// request and stay read-only.
const props = defineProps<{
  budgetId: string;
  envelope: EnvelopePlanDto | null;
  // Read-only funding rule summary; null or absent hides the line.
  ruleSummary?: string | null;
  // Same badge the card row shows, or null when the envelope is fine.
  badge?: PlanBadge | null;
}>();

const emit = defineEmits<{
  close: [];
  edit: [envelope: EnvelopePlanDto];
  reassign: [envelope: EnvelopePlanDto];
  target: [envelope: EnvelopePlanDto];
  archive: [envelope: EnvelopePlanDto];
}>();

const planV2 = useEnvelopePlanV2();

const KIND_LABELS: Record<EnvelopeHistoryItem['kind'], string> = {
  ASSIGNMENT: 'Распределение',
  MOVEMENT: 'Перенос',
  SPENDING: 'Расход',
};

const KIND_ICONS: Record<EnvelopeHistoryItem['kind'], typeof ArrowDownToLine> = {
  ASSIGNMENT: ArrowDownToLine,
  MOVEMENT: ArrowLeftRight,
  SPENDING: ShoppingCart,
};

const items = ref<EnvelopeHistoryItem[]>([]);
const nextCursor = ref<string | null>(null);
const loading = ref(false);
const error = ref('');
const showDeleted = ref(false);
let seq = 0;

async function load(cursor: string | null): Promise<void> {
  const envelope = props.envelope;
  if (!envelope) return;
  const current = ++seq;
  loading.value = true;
  error.value = '';
  const filter: { cursor?: string; status?: 'DELETED' } = {};
  if (cursor !== null) filter.cursor = cursor;
  if (showDeleted.value) filter.status = 'DELETED';
  try {
    const page = await planV2.getEnvelopeHistory(props.budgetId, envelope.id, filter);
    if (current !== seq) return;
    items.value = cursor === null ? page.items : [...items.value, ...page.items];
    nextCursor.value = page.nextCursor;
  } catch (cause) {
    if (current !== seq) return;
    error.value = v2ErrorMessage(cause, 'Не удалось загрузить историю. Попробуйте ещё раз.');
  } finally {
    if (current === seq) loading.value = false;
  }
}

watch(
  () => props.envelope?.id,
  (id) => {
    seq++;
    items.value = [];
    nextCursor.value = null;
    error.value = '';
    showDeleted.value = false;
    loading.value = false;
    if (id) void load(null);
  },
  { immediate: true },
);

function toggleDeleted(): void {
  showDeleted.value = !showDeleted.value;
  items.value = [];
  nextCursor.value = null;
  void load(null);
}

const scopeLabel = computed(() =>
  props.envelope ? (PLAN_SCOPE_LABELS[props.envelope.envelopeType] ?? 'Свой конверт') : '',
);
const slotLabel = computed(() =>
  props.envelope?.periodSlot ? PLAN_SLOT_LABELS[props.envelope.periodSlot] : null,
);
// The subtitle under the title repeats the card caption word for word.
const subtitle = computed(() => (props.envelope ? envelopeCaption(props.envelope).text : ''));
// The goal arrives as decimal rubles; convert to minor text for display.
const targetMinor = computed(() =>
  props.envelope?.targetAmountMinor == null
    ? null
    : decimalToMinor(props.envelope.targetAmountMinor),
);
const operationsLink = computed(() =>
  props.envelope ? `/app/operations?envelopeId=${encodeURIComponent(props.envelope.id)}` : '',
);

// Status badge next to the "Осталось" amount: an archived envelope always
// reads "В архиве" first; otherwise the same badge the card row shows, or
// "в порядке" when the server reports nothing to flag.
const statusTone = computed<'neutral' | 'success' | 'warning' | 'danger'>(() =>
  props.envelope?.archivedAt ? 'neutral' : (props.badge?.tone ?? 'success'),
);
const statusText = computed(() =>
  props.envelope?.archivedAt ? 'В архиве' : (props.badge?.text ?? 'Конверт в порядке'),
);
const statusIcon = computed(() => {
  if (props.envelope?.archivedAt) return Archive;
  if (statusTone.value === 'danger') return AlertOctagon;
  if (statusTone.value === 'warning') return AlertTriangle;
  return Check;
});
</script>

<template>
  <UiModal
    :open="envelope !== null"
    :title="envelope?.name ?? 'Конверт'"
    :subtitle="envelope ? subtitle : undefined"
    size="lg"
    @close="emit('close')"
  >
    <div v-if="envelope" class="plan-dialog">
      <UiAmountHero label="Осталось" :amount-minor="envelope.balanceMinor">
        <template #aside>
          <span
            class="plan-dialog__status"
            :class="`plan-dialog__status--${statusTone}`"
            data-testid="plan-dialog-status"
          >
            <component :is="statusIcon" :size="16" aria-hidden="true" />
            {{ statusText }}
          </span>
        </template>
      </UiAmountHero>

      <div class="plan-dialog__columns">
        <dl class="plan-dialog__rows">
          <div>
            <dt>Область действия</dt>
            <dd>{{ scopeLabel }}</dd>
          </div>
          <div v-if="slotLabel">
            <dt>Половина периода</dt>
            <dd>{{ slotLabel }}</dd>
          </div>
          <div>
            <dt>Отложено</dt>
            <dd><FinanceMoney :minor-units="envelope.fundedMinor" currency="RUB" :scale="2" /></dd>
          </div>
          <div>
            <dt>Потрачено</dt>
            <dd><FinanceMoney :minor-units="envelope.spentMinor" currency="RUB" :scale="2" /></dd>
          </div>
          <div v-if="targetMinor !== null">
            <dt>Цель</dt>
            <dd>
              <FinanceMoney :minor-units="targetMinor" currency="RUB" :scale="2" />
            </dd>
          </div>
          <div v-if="ruleSummary" data-testid="plan-dialog-rule">
            <dt>Правило пополнения</dt>
            <dd>{{ ruleSummary }}</dd>
          </div>
          <div v-if="envelope.comment">
            <dt>Комментарий</dt>
            <dd>{{ envelope.comment }}</dd>
          </div>
        </dl>

        <section
          class="plan-dialog__history"
          data-testid="plan-history"
          aria-labelledby="plan-history-title"
        >
          <h3 id="plan-history-title" class="plan-dialog__section-title">
            {{ showDeleted ? 'Отменённые записи' : 'История' }}
          </h3>
          <p v-if="!showDeleted" class="plan-dialog__section-sub">
            Распределения, переносы и расходы
          </p>
          <p v-if="showDeleted" class="plan-dialog__note">
            Только для чтения: эти записи отменены и не влияют на остаток.
          </p>
          <ul
            v-if="items.length > 0"
            class="plan-dialog__list hf-scroll"
            tabindex="0"
            aria-label="История конверта"
            data-testid="plan-history-list"
          >
            <li v-for="(item, index) in items" :key="`${item.effectiveOn}-${index}`">
              <span class="plan-dialog__kind-icon" aria-hidden="true">
                <component :is="KIND_ICONS[item.kind]" :size="16" />
              </span>
              <span class="plan-dialog__kind-body">
                <span class="plan-dialog__kind-title">{{ KIND_LABELS[item.kind] }}</span>
                <time :datetime="item.effectiveOn">{{ formatPlainDate(item.effectiveOn) }}</time>
              </span>
              <span
                class="plan-dialog__kind-amount"
                :class="{ 'plan-dialog__kind-amount--in': historySign(item.kind) === '+' }"
              >
                {{ historyAmountText(item.kind, item.amountMinor) }}
              </span>
            </li>
          </ul>
          <UiSkeleton v-else-if="loading" :count="3" />
          <p v-else-if="error" class="plan-dialog__error" role="alert" data-testid="history-error">
            {{ error }}
          </p>
          <p v-else class="plan-dialog__note" data-testid="history-empty">Записей пока нет.</p>
          <p v-if="error && items.length > 0" class="plan-dialog__error" role="alert">
            {{ error }}
          </p>

          <div class="plan-dialog__more">
            <UiButton
              v-if="nextCursor !== null"
              variant="secondary"
              size="sm"
              :loading="loading"
              data-testid="history-more"
              @click="load(nextCursor)"
            >
              Ещё
            </UiButton>
            <button
              type="button"
              class="plan-dialog__switch"
              role="switch"
              :aria-checked="showDeleted"
              :disabled="loading"
              data-testid="history-toggle-deleted"
              @click="toggleDeleted"
            >
              <span class="plan-dialog__switch-track" aria-hidden="true">
                <span class="plan-dialog__switch-thumb" />
              </span>
              Показать отменённые записи
            </button>
          </div>
        </section>
      </div>
    </div>

    <template v-if="envelope" #footer>
      <UiButton
        v-if="!envelope.archivedAt"
        data-testid="plan-dialog-reassign"
        @click="emit('reassign', envelope)"
      >
        <ArrowLeftRight :size="18" aria-hidden="true" />
        Переложить
      </UiButton>
      <UiButton
        v-if="!envelope.archivedAt"
        variant="secondary"
        data-testid="plan-dialog-target"
        @click="emit('target', envelope)"
      >
        Изменить цель периода
      </UiButton>
      <UiButton
        v-if="!envelope.archivedAt"
        variant="secondary"
        data-testid="plan-dialog-edit"
        @click="emit('edit', envelope)"
      >
        <Pencil :size="18" aria-hidden="true" />
        Изменить
      </UiButton>
      <UiButton variant="secondary" data-testid="plan-dialog-operations" :to="operationsLink">
        <Calendar :size="18" aria-hidden="true" />
        Операции конверта
      </UiButton>
      <UiButton
        v-if="!envelope.archivedAt"
        variant="tertiary"
        class="plan-dialog__archive"
        data-testid="plan-dialog-archive"
        @click="emit('archive', envelope)"
      >
        <Archive :size="18" aria-hidden="true" />
        Архивировать
      </UiButton>
    </template>
  </UiModal>
</template>

<style scoped>
.plan-dialog {
  container-type: inline-size;
  display: grid;
  gap: var(--hf-space-4);
}

.plan-dialog__status {
  display: inline-flex;
  gap: var(--hf-space-1);
  align-items: center;
  padding: var(--hf-space-1) var(--hf-space-2);
  border-radius: var(--hf-radius-sm);
  font-size: var(--hf-font-size-small);
  font-weight: var(--hf-font-weight-medium);
}

.plan-dialog__status--neutral {
  color: var(--hf-color-status-neutral);
  background: var(--hf-color-status-neutral-background);
}

.plan-dialog__status--success {
  color: var(--hf-color-status-success);
  background: var(--hf-color-status-success-background);
}

.plan-dialog__status--warning {
  background: var(--hf-color-warning-soft);
  color: var(--hf-color-status-warning);
}

.plan-dialog__status--danger {
  background: var(--hf-color-danger-soft);
  color: var(--hf-color-text-danger);
}

.plan-dialog__columns {
  display: grid;
  gap: var(--hf-space-5);
}

.plan-dialog__rows {
  display: grid;
  align-content: start;
  margin: 0;
}

.plan-dialog__rows div {
  display: grid;
  gap: 0.125rem;
  padding: var(--hf-space-3) 0;
  border-bottom: 1px solid var(--hf-color-border);
}

.plan-dialog__rows div:first-child {
  padding-top: 0;
}

.plan-dialog__rows dt {
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
  line-height: var(--hf-line-height-caption);
}

.plan-dialog__rows dd {
  margin: 0;
  color: var(--hf-color-text);
  font-variant-numeric: tabular-nums;
}

.plan-dialog__section-title {
  margin: 0;
  color: var(--hf-color-text);
  font-size: var(--hf-font-size-body);
  font-weight: var(--hf-font-weight-semibold);
}

.plan-dialog__archive {
  margin-left: auto;
}

.plan-dialog__section-sub {
  margin: 0.125rem 0 var(--hf-space-3);
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
  line-height: var(--hf-line-height-caption);
}

.plan-dialog__note {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
  line-height: var(--hf-line-height-caption);
}

.plan-dialog__history {
  display: grid;
  gap: var(--hf-space-2);
}

/* The history scrolls inside the dialog; it holds no controls, so the list
   itself takes focus for keyboard scrolling. */
.plan-dialog__list {
  display: grid;
  gap: var(--hf-space-2);
  max-height: 20rem;
  margin: 0;
  padding: var(--hf-space-1) var(--hf-space-2) var(--hf-space-1) 0;
  overflow-y: auto;
  list-style: none;
  border-radius: var(--hf-radius-md);
}

.plan-dialog__list:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
}

.plan-dialog__list li {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-2);
  align-items: center;
}

.plan-dialog__kind-icon {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border-radius: var(--hf-radius-sm);
  background: var(--hf-color-surface-subtle);
  color: var(--hf-color-text-muted);
}

.plan-dialog__kind-body {
  display: grid;
  gap: 0.125rem;
  min-width: 0;
}

.plan-dialog__kind-title {
  font-weight: var(--hf-font-weight-medium);
}

.plan-dialog__kind-body time {
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
}

.plan-dialog__kind-amount {
  margin-left: auto;
  font-weight: var(--hf-font-weight-medium);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.plan-dialog__kind-amount--in {
  color: var(--hf-color-status-success);
}

.plan-dialog__more {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-3);
  align-items: center;
}

.plan-dialog__switch {
  display: inline-flex;
  gap: var(--hf-space-2);
  align-items: center;
  min-height: 44px;
  padding: var(--hf-space-1) var(--hf-space-2);
  color: var(--hf-color-text);
  border: none;
  border-radius: var(--hf-radius-sm);
  background: transparent;
  font: inherit;
  cursor: pointer;
}

.plan-dialog__switch:disabled {
  cursor: default;
  opacity: 0.6;
}

.plan-dialog__switch:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
}

.plan-dialog__switch-track {
  position: relative;
  flex: 0 0 auto;
  width: 2rem;
  height: 1.125rem;
  border-radius: var(--hf-radius-pill, 999px);
  background: var(--hf-color-border-strong);
  transition: background var(--hf-transition-fast);
}

.plan-dialog__switch[aria-checked='true'] .plan-dialog__switch-track {
  background: var(--hf-color-action-primary);
}

.plan-dialog__switch-thumb {
  position: absolute;
  top: 0.125rem;
  left: 0.125rem;
  width: 0.875rem;
  height: 0.875rem;
  border-radius: 50%;
  background: var(--hf-color-surface);
  transition: transform var(--hf-transition-fast);
}

.plan-dialog__switch[aria-checked='true'] .plan-dialog__switch-thumb {
  transform: translateX(0.875rem);
}

.plan-dialog__error {
  margin: 0;
  color: var(--hf-color-text-danger);
}

/* Two columns only when the dialog body itself is wide enough. */
@container (min-width: 36rem) {
  .plan-dialog__columns {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr);
    column-gap: var(--hf-space-8);
  }
}
</style>
