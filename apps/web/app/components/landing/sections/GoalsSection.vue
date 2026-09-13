<script setup lang="ts">
import GoalsGrid from '../mockups/GoalsGrid.vue';
import LandingSection from '../ui/LandingSection.vue';

defineOptions({ name: 'GoalsSection' });
</script>

<template>
  <LandingSection
    section-id="goals"
    eyebrow="Накопительные цели"
    title="Откладывайте на важное, не смешивая его с повседневными расходами."
    description="Деньги на ремонт остаются деньгами на ремонт. Фонд автомобиля не смешивается с текущими расходами."
  >
    <GoalsGrid />
  </LandingSection>
</template>
