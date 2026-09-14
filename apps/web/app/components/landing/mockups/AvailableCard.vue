<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

import { formatLandingMoney } from '../format-money.js';
import { heroBudget } from '../../../data/landing.js';
import { useCountUp } from '../../../composables/useCountUp.js';
import { useRevealOnScroll } from '../../../composables/useRevealOnScroll.js';

defineOptions({ name: 'AvailableCard' });

const { target, revealed, animating } = useRevealOnScroll();
const availableRoubles = Number(BigInt(heroBudget.availableMinor) / 100n);
const { value: animated, start } = useCountUp(availableRoubles);

// Count-up запускается при монтировании, а не по появлению секции: иначе главный
// показатель страницы залипает на нуле везде, где браузер не доставляет колбэк
// IntersectionObserver (фоновая вкладка, троттлинг). До запуска — и в разметке с
// сервера, и без JS — показывается конечная сумма.
const counting = ref(false);

onMounted(() => {
  counting.value = true;
  start();
});

const displayed = computed(() =>
  formatLandingMoney(counting.value ? `${animated.value}00` : heroBudget.availableMinor),
);
const spentPercent = computed(() => {
  const spent = Number(BigInt(heroBudget.spentMinor));
  const limit = Number(BigInt(heroBudget.periodLimitMinor));
  return limit > 0 ? Math.min(100, Math.round((spent / limit) * 100)) : 0;
});
const progressLabel = computed(
  () =>
    `Потрачено ${formatLandingMoney(heroBudget.spentMinor)} из лимита ${formatLandingMoney(
      heroBudget.periodLimitMinor,
    )}`,
);
</script>

<template>
  <div
    ref="target"
    class="available-card"
    :class="{ 'is-reveal-ready': animating, 'is-revealed': revealed }"
  >
    <p class="available-card__label">Можно потратить</p>
    <p class="available-card__value">{{ displayed }}</p>

    <div
      class="available-card__track"
      role="progressbar"
      :aria-label="progressLabel"
      :aria-valuenow="spentPercent"
      aria-valuemin="0"
      aria-valuemax="100"
    >
      <div class="available-card__fill" :style="{ width: `${spentPercent}%` }" />
    </div>

    <dl class="available-card__rows">
      <div class="available-card__row">
        <dt>{{ heroBudget.periodLabel }}</dt>
        <dd>Осталось {{ heroBudget.daysLeft }} дней</dd>
      </div>
      <div class="available-card__row">
        <dt>Потрачено</dt>
        <dd>{{ formatLandingMoney(heroBudget.spentMinor) }}</dd>
      </div>
      <div class="available-card__row">
        <dt>Лимит</dt>
        <dd>{{ formatLandingMoney(heroBudget.periodLimitMinor) }}</dd>
      </div>
      <div class="available-card__row">
        <dt>Сегодня</dt>
        <dd>≈ {{ formatLandingMoney(heroBudget.dailyAverageMinor) }}</dd>
      </div>
    </dl>
  </div>
</template>

<style scoped>
.available-card {
  display: grid;
  gap: var(--hf-space-4);
  max-width: 34rem;
  border-radius: var(--hf-radius-xl);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-md);
  padding: var(--hf-space-8);
}

.available-card.is-reveal-ready {
  opacity: 0;
  transform: translateY(12px) scale(0.98);
  transition:
    opacity 400ms ease-out,
    transform 400ms ease-out;
}

.available-card.is-reveal-ready.is-revealed {
  opacity: 1;
  transform: none;
}

.available-card__label {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
  line-height: var(--hf-line-height-small);
}

.available-card__value {
  margin: 0;
  color: var(--hf-color-brand);
  font-size: var(--hf-font-size-display);
  font-weight: var(--hf-font-weight-semibold);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
}

.available-card__track {
  height: 0.5rem;
  border-radius: var(--hf-radius-sm);
  background: var(--hf-color-slate-200);
  overflow: hidden;
}

.available-card__fill {
  height: 100%;
  border-radius: inherit;
  background: var(--hf-color-brand-bright);
  transition: width var(--hf-transition-base);
}

.available-card__rows {
  margin: 0;
  display: grid;
  gap: var(--hf-space-3);
}

.available-card__row {
  display: flex;
  justify-content: space-between;
  gap: var(--hf-space-2);
  padding-bottom: var(--hf-space-3);
  border-bottom: 1px solid var(--hf-color-border);
  font-size: var(--hf-font-size-small);
  line-height: var(--hf-line-height-small);
}

.available-card__row:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.available-card__row dt {
  color: var(--hf-color-text-muted);
}

.available-card__row dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
  font-weight: var(--hf-font-weight-semibold);
}
</style>
