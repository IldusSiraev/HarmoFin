<script setup lang="ts">
import PlansList from '../mockups/PlansList.vue';
import LandingSection from '../ui/LandingSection.vue';

defineOptions({ name: 'PlansSection' });
</script>

<template>
  <LandingSection
    section-id="plans"
    tone="muted"
    eyebrow="Планы и обязательные платежи"
    title="Заранее знайте, какие платежи вас ждут."
    description="Регулярные планы помогают заранее видеть обязательные платежи, но не превращают плановую сумму в фактическую операцию без подтверждения пользователя."
  >
    <PlansList />
  </LandingSection>
</template>
