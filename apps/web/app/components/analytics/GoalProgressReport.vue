<script setup lang="ts">
import type { GoalProgressRowDto } from '../../composables/useBudgetReferenceData.js';
import GoalProgress from './charts/GoalProgress.vue';

// The amount is the assigned continuous balance, not money on an account.
defineProps<{ rows: ReadonlyArray<GoalProgressRowDto> }>();
</script>

<template>
  <section class="goal-progress" aria-labelledby="goal-progress-title">
    <div class="goal-progress__heading">
      <h2 id="goal-progress-title">Накопления</h2>
      <p>Отложено на цель — остаток конверта. Это не деньги на счёте.</p>
    </div>
    <p v-if="rows.length === 0" class="goal-progress__empty">Нет конвертов «Накопления».</p>
    <div v-else class="goal-progress__list">
      <GoalProgress v-for="row in rows" :key="row.envelopeId" :row="row" />
    </div>
  </section>
</template>

<style scoped>
.goal-progress {
  display: grid;
  gap: var(--hf-space-4);
}
.goal-progress__heading h2,
.goal-progress__heading p,
.goal-progress__empty {
  margin: 0;
}
.goal-progress__heading h2 {
  font-size: 1.25rem;
}
.goal-progress__heading p,
.goal-progress__empty {
  color: var(--hf-color-text-muted);
}
.goal-progress__list {
  display: grid;
}
</style>
