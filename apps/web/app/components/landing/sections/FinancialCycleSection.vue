<script setup lang="ts">
import CycleTimeline from '../mockups/CycleTimeline.vue';
import LandingSection from '../ui/LandingSection.vue';

defineOptions({ name: 'FinancialCycleSection' });
</script>

<template>
  <LandingSection
    section-id="cycle"
    eyebrow="Гибкий цикл"
    title="Ваш бюджет не обязан начинаться первого числа."
    description="Настройте финансовый цикл под реальные даты ваших доходов и расходов."
  >
    <CycleTimeline />
  </LandingSection>
</template>
