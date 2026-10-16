<script setup lang="ts">
import AllocationFlow from '../mockups/AllocationFlow.vue';
import LandingSection from '../ui/LandingSection.vue';
import { allocationExplainers } from '../../../data/landing.js';

defineOptions({ name: 'IncomeAllocationSection' });
</script>

<template>
  <LandingSection
    section-id="allocation"
    eyebrow="Распределение дохода"
    title="Получили деньги — сразу понимаете, куда они пойдут."
    description="Одно поступление можно распределить по нескольким конвертам, а доход в отчётах остаётся одним."
  >
    <div class="allocation-section__layout">
      <AllocationFlow class="allocation-section__flow" />

      <ul class="allocation-section__points">
        <li
          v-for="point in allocationExplainers"
          :key="point.title"
          class="allocation-section__point"
        >
          <h3 class="allocation-section__point-title">{{ point.title }}</h3>
          <p class="allocation-section__point-text">{{ point.text }}</p>
        </li>
      </ul>
    </div>
  </LandingSection>
</template>

<style scoped>
.allocation-section__layout {
  display: grid;
  gap: var(--hf-space-8);
  align-items: center;
}

.allocation-section__flow {
  justify-self: center;
}

.allocation-section__points {
  display: grid;
  gap: var(--hf-space-5);
  margin: 0;
  padding: 0;
  list-style: none;
}

.allocation-section__point {
  display: grid;
  gap: var(--hf-space-1);
  padding-left: var(--hf-space-4);
  border-left: 2px solid var(--hf-color-primary-bright);
}

.allocation-section__point-title {
  margin: 0;
  font-size: var(--hf-font-size-body);
  line-height: var(--hf-line-height-body);
  font-weight: var(--hf-font-weight-semibold);
}

.allocation-section__point-text {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
  line-height: var(--hf-line-height-small);
}

@media (min-width: 1024px) {
  .allocation-section__layout {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: var(--hf-space-12);
  }

  .allocation-section__flow {
    justify-self: start;
  }
}
</style>
