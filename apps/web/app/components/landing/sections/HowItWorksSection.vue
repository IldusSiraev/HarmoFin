<script setup lang="ts">
import LandingSection from '../ui/LandingSection.vue';
import StepStrip from '../mockups/StepStrip.vue';

defineOptions({ name: 'HowItWorksSection' });
</script>

<template>
  <LandingSection
    section-id="how-it-works"
    eyebrow="Простой сценарий"
    title="Как это работает в реальной жизни"
    description="Один день с HarmoFin: от поступления денег до понятного остатка."
  >
    <StepStrip />
  </LandingSection>
</template>
