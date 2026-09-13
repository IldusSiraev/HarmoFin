<script setup lang="ts">
import AvailableCard from '../mockups/AvailableCard.vue';
import LandingSection from '../ui/LandingSection.vue';

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
    </div>
  </LandingSection>
</template>

<style scoped>
.available-section__layout {
  display: grid;
}

.available-section__card {
  justify-self: center;
}

@media (min-width: 1024px) {
  .available-section__card {
    justify-self: start;
  }
}
</style>
