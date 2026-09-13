<script setup lang="ts">
import { computed } from 'vue';
import { navigateTo, useSeoMeta } from '#imports';

import LandingFooter from '../components/landing/LandingFooter.vue';
import LandingHeader from '../components/landing/LandingHeader.vue';
import AnalyticsSection from '../components/landing/sections/AnalyticsSection.vue';
import AvailableToSpendSection from '../components/landing/sections/AvailableToSpendSection.vue';
import ConceptSection from '../components/landing/sections/ConceptSection.vue';
import FinancialCycleSection from '../components/landing/sections/FinancialCycleSection.vue';
import GoalsSection from '../components/landing/sections/GoalsSection.vue';
import HeroSection from '../components/landing/sections/HeroSection.vue';
import IncomeAllocationSection from '../components/landing/sections/IncomeAllocationSection.vue';
import PlansSection from '../components/landing/sections/PlansSection.vue';
import ProblemSection from '../components/landing/sections/ProblemSection.vue';
import VariableIncomeSection from '../components/landing/sections/VariableIncomeSection.vue';
import { landingSeo } from '../data/landing-seo.js';
import { useAuth } from '../composables/useAuth.js';

const { currentData } = useAuth();
const isAuthenticated = computed(() => !!currentData.value?.user);

useSeoMeta(landingSeo);

if (isAuthenticated.value) {
  await navigateTo('/app');
}
</script>

<template>
  <div v-if="!isAuthenticated" class="landing">
    <LandingHeader />
    <main class="landing__main">
      <HeroSection />
      <ProblemSection />
      <ConceptSection />
      <AvailableToSpendSection />
      <FinancialCycleSection />
      <IncomeAllocationSection />
      <GoalsSection />
      <PlansSection />
      <VariableIncomeSection />
      <AnalyticsSection />
    </main>
    <LandingFooter />
  </div>
</template>

<style scoped>
.landing {
  min-height: 100vh;
  background: var(--hf-color-surface);
  color: var(--hf-color-text);
}
</style>
