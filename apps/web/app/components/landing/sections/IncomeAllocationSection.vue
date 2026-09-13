<script setup lang="ts">
import AllocationFlow from '../mockups/AllocationFlow.vue';
import LandingSection from '../ui/LandingSection.vue';

defineOptions({ name: 'IncomeAllocationSection' });
</script>

<template>
  <LandingSection
    section-id="allocation"
    eyebrow="Распределение дохода"
    title="Получили деньги — сразу понимаете, куда они пойдут."
    description="Одно поступление может получить несколько назначений — без создания фиктивных доходов."
  >
    <AllocationFlow />
  </LandingSection>
</template>
