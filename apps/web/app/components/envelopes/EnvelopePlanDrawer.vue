<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import FinanceMoney from '../finance/FinanceMoney.vue';
import UiButton from '../ui/Button.vue';
import UiDrawer from '../ui/Drawer.vue';
import UiSkeleton from '../ui/Skeleton.vue';
import UiStatus from '../ui/Status.vue';
import {
  type EnvelopeHistoryItem,
  type EnvelopePlanDto,
  useEnvelopePlanV2,
} from '../../composables/useEnvelopePlanV2.js';
import { v2ErrorMessage } from '../../composables/useV2Error.js';
import {
  PLAN_SCOPE_LABELS,
  PLAN_SLOT_LABELS,
  decimalToMinor,
  planScopeNote,
} from './envelope-plan-kind.js';

defineOptions({ name: 'EnvelopePlanDrawer' });

// Details of an assignment envelope: what was assigned, spent and moved, with
// dates. Everything is read from the server; cancelled facts are shown only on
// request and stay read-only.
const props = defineProps<{ budgetId: string; envelope: EnvelopePlanDto | null }>();

const emit = defineEmits<{
  close: [];
  edit: [envelope: EnvelopePlanDto];
  reassign: [envelope: EnvelopePlanDto];
  archive: [envelope: EnvelopePlanDto];
}>();

const planV2 = useEnvelopePlanV2();

const KIND_LABELS: Record<EnvelopeHistoryItem['kind'], string> = {
  ASSIGNMENT: 'Назначение',
  MOVEMENT: 'Перенос',
  SPENDING: 'Расход',
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
  props.envelope ? (PLAN_SCOPE_LABELS[props.envelope.envelopeType] ?? 'Пользовательская') : '',
);
const slotLabel = computed(() =>
  props.envelope?.periodSlot ? PLAN_SLOT_LABELS[props.envelope.periodSlot] : null,
);
// The goal arrives as decimal rubles; convert to minor text for display.
const targetMinor = computed(() =>
  props.envelope?.targetAmountMinor == null
    ? null
    : decimalToMinor(props.envelope.targetAmountMinor),
);
const operationsLink = computed(() =>
  props.envelope ? `/app/operations?envelopeId=${encodeURIComponent(props.envelope.id)}` : '',
);
</script>

<template>
  <UiDrawer :open="envelope !== null" title="Конверт" @close="emit('close')">
    <div v-if="envelope" class="plan-drawer">
      <div>
        <p class="plan-drawer__caption">Осталось</p>
        <p class="plan-drawer__amount">
          <FinanceMoney :minor-units="envelope.balanceMinor" currency="RUB" :scale="2" />
        </p>
      </div>
      <UiStatus
        :label="envelope.archivedAt ? 'В архиве' : 'Активен'"
        :tone="envelope.archivedAt ? 'neutral' : 'success'"
      />
      <p class="plan-drawer__caption">{{ planScopeNote(envelope.envelopeType) }}</p>

      <dl class="plan-drawer__rows">
        <div>
          <dt>Название</dt>
          <dd>{{ envelope.name }}</dd>
        </div>
        <div>
          <dt>Область действия</dt>
          <dd>{{ scopeLabel }}</dd>
        </div>
        <div v-if="slotLabel">
          <dt>Половина периода</dt>
          <dd>{{ slotLabel }}</dd>
        </div>
        <div>
          <dt>Назначено</dt>
          <dd><FinanceMoney :minor-units="envelope.fundedMinor" currency="RUB" :scale="2" /></dd>
        </div>
        <div>
          <dt>Потрачено</dt>
          <dd><FinanceMoney :minor-units="envelope.spentMinor" currency="RUB" :scale="2" /></dd>
        </div>
        <div>
          <dt>Осталось</dt>
          <dd><FinanceMoney :minor-units="envelope.balanceMinor" currency="RUB" :scale="2" /></dd>
        </div>
        <div v-if="targetMinor !== null">
          <dt>Цель</dt>
          <dd>
            <FinanceMoney :minor-units="targetMinor" currency="RUB" :scale="2" />
          </dd>
        </div>
        <div v-if="envelope.comment">
          <dt>Комментарий</dt>
          <dd>{{ envelope.comment }}</dd>
        </div>
      </dl>

      <section
        class="plan-drawer__history"
        data-testid="plan-history"
        aria-labelledby="plan-history-title"
      >
        <h3 id="plan-history-title" class="plan-drawer__section-title">
          {{ showDeleted ? 'Отменённые записи' : 'Назначения, переносы и расходы' }}
        </h3>
        <p v-if="showDeleted" class="plan-drawer__caption">
          Только для чтения: эти записи отменены и не влияют на остаток.
        </p>
        <ul v-if="items.length > 0" class="plan-drawer__list">
          <li v-for="(item, index) in items" :key="`${item.effectiveOn}-${index}`">
            <span class="plan-drawer__kind">{{ KIND_LABELS[item.kind] }}</span>
            <FinanceMoney :minor-units="item.amountMinor" currency="RUB" :scale="2" />
            <time :datetime="item.effectiveOn">{{ item.effectiveOn }}</time>
          </li>
        </ul>
        <UiSkeleton v-else-if="loading" :count="3" />
        <p v-else-if="error" class="plan-drawer__error" role="alert" data-testid="history-error">
          {{ error }}
        </p>
        <p v-else class="plan-drawer__caption" data-testid="history-empty">Записей пока нет.</p>
        <p v-if="error && items.length > 0" class="plan-drawer__error" role="alert">{{ error }}</p>

        <div class="plan-drawer__more">
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
          <UiButton
            variant="tertiary"
            size="sm"
            :disabled="loading"
            data-testid="history-toggle-deleted"
            @click="toggleDeleted"
          >
            {{ showDeleted ? 'Скрыть отменённые записи' : 'Показать отменённые записи' }}
          </UiButton>
        </div>
      </section>
    </div>

    <template v-if="envelope" #footer>
      <UiButton
        v-if="!envelope.archivedAt"
        data-testid="plan-drawer-reassign"
        @click="emit('reassign', envelope)"
      >
        Переназначить
      </UiButton>
      <UiButton
        v-if="!envelope.archivedAt"
        variant="secondary"
        data-testid="plan-drawer-edit"
        @click="emit('edit', envelope)"
      >
        Изменить
      </UiButton>
      <UiButton variant="secondary" data-testid="plan-drawer-operations" :to="operationsLink">
        Операции конверта
      </UiButton>
      <UiButton
        v-if="!envelope.archivedAt"
        variant="tertiary"
        data-testid="plan-drawer-archive"
        @click="emit('archive', envelope)"
      >
        Архивировать
      </UiButton>
    </template>
  </UiDrawer>
</template>

<style scoped>
.plan-drawer {
  display: grid;
  gap: var(--hf-space-4);
}

.plan-drawer__amount {
  margin: 0;
  font-size: var(--hf-font-size-h2);
  font-weight: var(--hf-font-weight-bold);
  line-height: var(--hf-line-height-h2);
}

.plan-drawer__caption {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
  line-height: var(--hf-line-height-caption);
}

.plan-drawer__rows {
  display: grid;
  gap: var(--hf-space-2);
  margin: 0;
}

.plan-drawer__rows div {
  display: flex;
  gap: var(--hf-space-3);
  justify-content: space-between;
}

.plan-drawer__rows dt {
  color: var(--hf-color-text-muted);
}

.plan-drawer__rows dd {
  margin: 0;
  text-align: right;
}

.plan-drawer__section-title {
  margin: 0 0 var(--hf-space-2);
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
  font-weight: var(--hf-font-weight-semibold);
}

.plan-drawer__history {
  display: grid;
  gap: var(--hf-space-2);
}

.plan-drawer__list {
  display: grid;
  gap: var(--hf-space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.plan-drawer__list li {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-2);
  align-items: baseline;
}

.plan-drawer__kind {
  font-weight: var(--hf-font-weight-medium);
}

.plan-drawer__list time {
  margin-left: auto;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
}

.plan-drawer__more {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-2);
}

.plan-drawer__error {
  margin: 0;
  color: var(--hf-color-text-danger);
}
</style>
