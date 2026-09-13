<script setup lang="ts">
import LandingSection from '../ui/LandingSection.vue';
import IncomeComparison from '../mockups/IncomeComparison.vue';

defineOptions({ name: 'VariableIncomeSection' });
</script>

<template>
  <LandingSection
    section-id="income"
    eyebrow="Нестабильный доход"
    title="Получили меньше. Получили больше. Бюджет не ломается."
    description="Плановые значения — это ориентир. HarmoFin работает с фактически полученной суммой."
  >
    <IncomeComparison />
  </LandingSection>
</template>
