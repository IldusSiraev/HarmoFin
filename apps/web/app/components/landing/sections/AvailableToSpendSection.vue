<script setup lang="ts">
import AvailableCard from '../mockups/AvailableCard.vue';
import LandingSection from '../ui/LandingSection.vue';
import { availableExplainers } from '../../../data/landing.js';

defineOptions({ name: 'AvailableToSpendSection' });
</script>

<template>
  <LandingSection
    section-id="available"
    eyebrow="Главный вопрос"
    title="Главный вопрос — сколько можно потратить сегодня?"
    description="HarmoFin рассчитывает доступный остаток на основе фактических доходов и операций, а не предполагаемой суммы будущей выплаты."
  >
    <div class="available-section__layout">
      <AvailableCard class="available-section__card" />

      <ul class="available-section__points">
        <li
          v-for="point in availableExplainers"
          :key="point.title"
          class="available-section__point"
        >
          <h3 class="available-section__point-title">{{ point.title }}</h3>
          <p class="available-section__point-text">{{ point.text }}</p>
        </li>
      </ul>
    </div>
  </LandingSection>
</template>

<style scoped>
.available-section__layout {
  display: grid;
  gap: var(--hf-space-8);
  align-items: center;
}

.available-section__card {
  justify-self: center;
}

.available-section__points {
  display: grid;
  gap: var(--hf-space-5);
  margin: 0;
  padding: 0;
  list-style: none;
}

.available-section__point {
  display: grid;
  gap: var(--hf-space-1);
  padding-left: var(--hf-space-4);
  border-left: 2px solid var(--hf-color-brand-bright);
}

.available-section__point-title {
  margin: 0;
  font-size: var(--hf-font-size-body);
  line-height: var(--hf-line-height-body);
  font-weight: var(--hf-font-weight-semibold);
}

.available-section__point-text {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
  line-height: var(--hf-line-height-small);
}

@media (min-width: 1024px) {
  .available-section__layout {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: var(--hf-space-12);
  }

  .available-section__card {
    justify-self: start;
  }
}
</style>
