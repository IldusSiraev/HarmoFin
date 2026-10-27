<script setup lang="ts">
import { computed } from 'vue';
import { CalendarClock, Landmark } from '@lucide/vue';

import UiAmountHero from '../ui/AmountHero.vue';
import UiButton from '../ui/Button.vue';
import UiModal from '../ui/Modal.vue';
import type { DashboardV2Response } from '../../composables/useEnvelopePlanV2.js';
import { formatMoneyText } from './envelope-plan-kind.js';

defineOptions({ name: 'EnvelopesShortfallDialog' });

// Explains a cash shortfall (more money assigned to envelopes than the accounts
// hold) and offers the ways out. Amounts are server strings shown as is.
type Warning = DashboardV2Response['warnings'][number];

const props = withDefaults(
  defineProps<{
    open: boolean;
    amountMinor: string;
    deficits: ReadonlyArray<{ warning: Warning; name: string }>;
    canAllocate?: boolean;
  }>(),
  { canAllocate: true },
);
const emit = defineEmits<{ close: []; cover: [warning: Warning] }>();

const hasDeficits = computed(() => props.deficits.length > 0);
</script>

<template>
  <UiModal :open="open" title="Не хватает денег на счетах" @close="emit('close')">
    <div class="shortfall" data-testid="shortfall-dialog">
      <UiAmountHero label="Не хватает" :amount-minor="amountMinor" />
      <p class="shortfall__text">
        В конвертах отложено больше, чем есть на всех счетах. Так бывает, когда траты превысили
        отложенное в конверте или остатки счетов в приложении разошлись с банком.
      </p>

      <ul class="shortfall__list">
        <li
          v-for="item in deficits"
          :key="`${item.warning.envelopeId}:${item.warning.periodId}`"
          class="shortfall__row"
          data-testid="shortfall-deficit"
        >
          <span class="shortfall__plaque shortfall__plaque--danger" aria-hidden="true">
            <CalendarClock :size="20" />
          </span>
          <div class="shortfall__body">
            <p class="shortfall__title">
              Перерасход «{{ item.name }}» · {{ formatMoneyText(item.warning.amountMinor) }}
            </p>
            <p class="shortfall__muted">
              {{
                canAllocate
                  ? 'Покройте его из свободных денег или из другого конверта.'
                  : 'Покрыть перерасход может владелец бюджета.'
              }}
            </p>
          </div>
          <UiButton
            v-if="canAllocate"
            variant="secondary"
            size="sm"
            data-testid="shortfall-cover"
            @click="emit('cover', item.warning)"
          >
            Покрыть
          </UiButton>
        </li>
        <li class="shortfall__row">
          <span class="shortfall__plaque" aria-hidden="true">
            <Landmark :size="20" />
          </span>
          <div class="shortfall__body">
            <p class="shortfall__title">
              {{ hasDeficits ? 'Если перерасхода нет' : 'Сверьте остатки счетов' }}
            </p>
            <p class="shortfall__muted">
              Сравните остатки счетов с банком и запишите пропущенные доходы и расходы.
            </p>
          </div>
          <UiButton
            variant="tertiary"
            size="sm"
            to="/app/accounts"
            data-testid="shortfall-accounts"
          >
            К счетам
          </UiButton>
        </li>
      </ul>
    </div>

    <template #footer>
      <div class="shortfall__buttons">
        <UiButton variant="secondary" data-testid="shortfall-close" @click="emit('close')">
          Закрыть
        </UiButton>
      </div>
    </template>
  </UiModal>
</template>

<style scoped>
.shortfall {
  display: grid;
  gap: var(--hf-space-5);
  min-width: 0;
}

.shortfall__text,
.shortfall__title,
.shortfall__muted {
  margin: 0;
}

.shortfall__list {
  display: grid;
  margin: 0;
  padding: 0;
  list-style: none;
}

.shortfall__row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--hf-space-2) var(--hf-space-3);
  align-items: center;
  padding: var(--hf-space-3) 0;
}

.shortfall__row + .shortfall__row {
  border-top: 1px solid var(--hf-color-border);
}

.shortfall__row > :last-child {
  grid-column: 2;
  justify-self: start;
}

@media (width >= 640px) {
  .shortfall__row {
    grid-template-columns: auto minmax(0, 1fr) auto;
  }

  .shortfall__row > :last-child {
    grid-column: auto;
    justify-self: end;
  }
}

.shortfall__plaque {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: var(--hf-radius-md);
  background: var(--hf-color-surface-subtle);
  color: var(--hf-color-text-muted);
}

.shortfall__plaque--danger {
  background: var(--hf-color-danger-soft);
  color: var(--hf-color-text-danger);
}

.shortfall__body {
  display: grid;
  gap: var(--hf-space-1);
  min-width: 0;
}

.shortfall__title {
  font-weight: var(--hf-font-weight-semibold);
  overflow-wrap: anywhere;
}

.shortfall__muted {
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}

.shortfall__buttons {
  display: flex;
  flex: 1 1 100%;
  justify-content: flex-end;
}
</style>
